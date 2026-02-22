import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
const { window } = new JSDOM();
(global as any).DOMParser = window.DOMParser;
(global as any).Element = window.Element;
(global as any).Node = window.Node;

import { parseIBKR, TestTransaction } from './src/lib/ibkrParser.ts';
import { calculatePositions, calculateCashBalances, calculatePortfolioStats } from './src/lib/calculations.ts';

function mapTransactionsBulk(transactions: TestTransaction[], portfolioId: string) {
    const result: any[] = [];
    const forexByDate = new Map<string, TestTransaction[]>();
    for (const tx of transactions) {
        if (tx.type === "FOREX") {
            result.push({
                portfolio_id: portfolioId, date: tx.date,
                type: tx.amount > 0 ? "deposit" : "withdrawal",
                ticker: "FOREX",
                quantity: Math.abs(tx.amount), unit_price: 1,
                fees: 0, currency: tx.currency, _totalEUR: tx.amount, _raw: tx
            });
            continue;
        }

        let mappedType = tx.type.toLowerCase() as any;
        if (tx.type === "DIVIDEND" && tx.amount < 0) mappedType = "withdrawal";

        const isCashFlow = tx.type === "DEPOSIT" || tx.type === "WITHDRAWAL" || tx.type === "DIVIDEND" || mappedType === "withdrawal";
        const finalCurrency = isCashFlow ? (tx.cashCurrency || tx.currency) : tx.currency;

        let calculatedFees = 0;
        const isCrossCurrency = !isCashFlow && tx.cashCurrency && tx.cashCurrency !== tx.currency;
        if (!isCrossCurrency) {
            if (tx.type === "BUY" && tx.quantity != null && tx.price != null) {
                calculatedFees = Math.max(0, Math.abs(tx.amount) - (tx.quantity * tx.price));
            } else if (tx.type === "SELL" && tx.quantity != null && tx.price != null) {
                calculatedFees = Math.max(0, (tx.quantity * tx.price) - tx.amount);
            }
        }
        const tradeValueAssetCurrency = (tx.quantity || 0) * (tx.price || 1);

        result.push({
            portfolio_id: portfolioId, date: tx.date, type: mappedType, ticker: tx.symbol || null,
            quantity: tx.quantity || Math.abs(tx.amount), unit_price: tx.price || 1,
            fees: calculatedFees, currency: finalCurrency, _totalEUR: tx.amount, _raw: tx
        });

        // Implicit conversion for Saxo Bank cases where a trade in USD deducts EUR cash directly
        if (!isCashFlow && tx.cashCurrency && tx.cashCurrency !== tx.currency && tradeValueAssetCurrency > 0) {
            const absAmount = Math.abs(tx.amount); // Account currency (EUR) amount
            if (tx.type === "BUY") {
                result.push({ portfolio_id: portfolioId, date: tx.date, type: "withdrawal", ticker: "CONVERSION", currency: tx.cashCurrency, quantity: absAmount, unit_price: 1, fees: 0, _totalEUR: 0 });
                result.push({ portfolio_id: portfolioId, date: tx.date, type: "deposit", ticker: "CONVERSION", currency: tx.currency, quantity: tradeValueAssetCurrency, unit_price: 1, fees: 0, _totalEUR: 0 });
            } else if (tx.type === "SELL" || tx.type === "DIVIDEND") {
                result.push({ portfolio_id: portfolioId, date: tx.date, type: "withdrawal", ticker: "CONVERSION", currency: tx.currency, quantity: tradeValueAssetCurrency, unit_price: 1, fees: 0, _totalEUR: 0 });
                result.push({ portfolio_id: portfolioId, date: tx.date, type: "deposit", ticker: "CONVERSION", currency: tx.cashCurrency, quantity: absAmount, unit_price: 1, fees: 0, _totalEUR: 0 });
            }
        }
    }

    return result.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

const file = process.argv[2];
const htmlContent = readFileSync(file, 'utf-8');
const { transactions } = parseIBKR(htmlContent);

// TestImport.tsx raw logic for KPIs
let testTotalCashEur = 0;
let testNetInjected = 0;
const testCashByCur: Record<string, number> = {};

for (const tx of transactions) {
    if (["DEPOSIT", "WITHDRAWAL", "BUY", "SELL", "DIVIDEND", "FOREX"].includes(tx.type)) {
        const c = tx.cashCurrency || tx.currency;
        testCashByCur[c] = (testCashByCur[c] || 0) + tx.amount;
    }
    if (["DEPOSIT", "WITHDRAWAL"].includes(tx.type)) {
        // Assume FX=1.04 roughly for USD just to see magnitude
        const c = tx.cashCurrency || tx.currency;
        if (c === 'USD') testNetInjected += tx.amount / 1.04;
        else testNetInjected += tx.amount;
    }
}
console.log("TEST IMPORT CASH BALANCES RAW:", testCashByCur);
console.log("TEST IMPORT TOTAL INVESTED (approx EUR):", testNetInjected);


const mapped = mapTransactionsBulk(transactions, "port1");
const cashBalances = calculateCashBalances(mapped);
console.log("\nDASHBOARD CASH BALANCES:", cashBalances);

let totalInvestedDash = 0;
for (const tx of mapped) {
    if (tx.type === "deposit") {
        if (tx.ticker === "FOREX" || tx.ticker === "CONVERSION") continue;
        const amount = (tx.quantity || 0) * (tx.unit_price || 1);
        if (tx.currency === 'USD') totalInvestedDash += amount / 1.04;
        else totalInvestedDash += amount;
    } else if (tx.type === "withdrawal") {
        if (tx.ticker === "FOREX" || tx.ticker === "CONVERSION") continue;
        const amount = (tx.quantity || 0) * (tx.unit_price || 1);
        if (tx.currency === 'USD') totalInvestedDash -= amount / 1.04;
        else totalInvestedDash -= amount;
    }
}
console.log("DASHBOARD TOTAL INVESTED (approx EUR): ", totalInvestedDash);

// Check if any FOREX got parsed correctly
console.log("\nFOREX TXs DASHBOARD:", mapped.filter(t => t.type === 'conversion').slice(0, 3));

console.log("\nDASHBOARD DEPOSITS/WITHDRAWALS:");
console.log(mapped.filter(t => t.type === 'deposit' || t.type === 'withdrawal').map(t => ({ date: t.date, type: t.type, amount: t.quantity, curr: t.currency })));
