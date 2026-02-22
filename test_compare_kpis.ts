import { readFileSync } from 'fs';
import XLSX from 'xlsx';
import { parseSaxoTest } from './src/lib/saxoParser.ts';
import { calculatePositions, calculateCashBalances, calculatePortfolioStats } from './src/lib/calculations.ts';
import { TestTransaction } from './src/lib/ibkrParser.ts';

function mapTransactionsBulk(transactions: TestTransaction[], portfolioId: string) {
    const result: any[] = [];
    const forexByDate = new Map<string, TestTransaction[]>();
    for (const tx of transactions) {
        if (tx.type === "FOREX") {
            const list = forexByDate.get(tx.date) || [];
            list.push(tx);
            forexByDate.set(tx.date, list);
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
            fees: calculatedFees, currency: finalCurrency, _totalEUR: tx.amount
        });

        if (!isCashFlow && tx.cashCurrency && tx.cashCurrency !== tx.currency && tradeValueAssetCurrency > 0) {
            const absAmount = Math.abs(tx.amount);
            if (tx.type === "BUY") {
                result.push({ portfolio_id: portfolioId, date: tx.date, type: "conversion", ticker: tx.cashCurrency, currency: tx.currency, quantity: tradeValueAssetCurrency, unit_price: absAmount / tradeValueAssetCurrency, fees: 0, _totalEUR: 0 });
            } else if (tx.type === "SELL" || tx.type === "DIVIDEND") {
                result.push({ portfolio_id: portfolioId, date: tx.date, type: "conversion", ticker: tx.currency, currency: tx.cashCurrency, quantity: absAmount, unit_price: tradeValueAssetCurrency / absAmount, fees: 0, _totalEUR: 0 });
            }
        }
    }
    return result.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

function getTestImportKpis(transactions: TestTransaction[]) {
    let totalCashEur = 0; let netInjected = 0;
    for (const tx of transactions) {
        if (["DEPOSIT", "WITHDRAWAL", "BUY", "SELL", "DIVIDEND", "FOREX"].includes(tx.type)) {
            totalCashEur += tx.amount;
        }
        if (["DEPOSIT", "WITHDRAWAL"].includes(tx.type)) {
            netInjected += tx.amount;
        }
    }
    return { cash: totalCashEur, totalInvested: netInjected };
}

const file = process.argv[2];
const rb = XLSX.readFile(file);
const sheet = rb.Sheets[rb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
const { transactions } = parseSaxoTest(rows as any[]);

const testKpis = getTestImportKpis(transactions);
console.log("TEST IMPORT KPIS:", testKpis);

const mapped = mapTransactionsBulk(transactions, "port1");

const cashBalances = calculateCashBalances(mapped);
console.log("\nDASHBOARD CASH BALANCES:", cashBalances);

let totalInvestedDash = 0;
for (const tx of mapped) {
    if (tx.type === "deposit") {
        const amount = (tx.quantity || 0) * (tx.unit_price || 1);
        totalInvestedDash += amount;
    } else if (tx.type === "withdrawal") {
        const amount = (tx.quantity || 0) * (tx.unit_price || 1);
        totalInvestedDash -= amount;
    }
}
console.log("DASHBOARD TOTAL INVESTED: ", totalInvestedDash);

const positions = calculatePositions(mapped, [], "EUR");
const adv = positions.find(p => p.name.includes("6857"));
if (adv) {
    console.log("\nADVANTEST DASHBOARD POS:", "PRU (JPY):", adv.pru, "Qty:", adv.quantity, "TotalCost (JPY):", adv.totalInvested);
}

