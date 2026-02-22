import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
const { window } = new JSDOM();
(global as any).DOMParser = window.DOMParser;
(global as any).Element = window.Element;
(global as any).Node = window.Node;

import { parseIBKR, TestTransaction } from './src/lib/ibkrParser.ts';
import { calculatePositions, calculateCashBalances, calculatePortfolioStats } from './src/lib/calculations.ts';

// Extract exactly the grouping code from ImportTransactionsDialog.tsx
function groupForexToConversions(forexTxs: TestTransaction[], portfolioId: string): any[] {
    const results: any[] = [];
    let i = 0;
    while (i < forexTxs.length) {
        const tx1 = forexTxs[i];
        const tx2 = i + 1 < forexTxs.length ? forexTxs[i + 1] : null;

        if (!tx2 || tx1.date !== tx2.date) {
            results.push({
                portfolio_id: portfolioId, date: tx1.date, type: "interest", ticker: null,
                quantity: tx1.amount, unit_price: 1, fees: 0, currency: tx1.currency, _totalEUR: tx1.amount, _raw: tx1
            });
            i++; continue;
        }

        let source: TestTransaction, target: TestTransaction;
        if (tx1.amount < 0 && tx2.amount > 0) { source = tx1; target = tx2; }
        else if (tx2.amount < 0 && tx1.amount > 0) { source = tx2; target = tx1; }
        else {
            // Both same sign! This usually means the first one is an isolated fee, followed by a valid pair later.
            results.push({
                portfolio_id: portfolioId, date: tx1.date, type: "interest", ticker: null,
                quantity: tx1.amount, unit_price: 1, fees: 0, currency: tx1.currency, _totalEUR: tx1.amount, _raw: tx1
            });
            i++; continue;
        }

        const sourceAmount = Math.abs(source!.amount);
        const targetAmount = Math.abs(target!.amount);
        const rate = sourceAmount / targetAmount;

        results.push({
            portfolio_id: portfolioId, date: tx1.date, type: "conversion",
            ticker: source!.currency, quantity: targetAmount, unit_price: rate, fees: 0, currency: target!.currency, _totalEUR: 0, _raw1: source, _raw2: target
        });

        i += 2;
    }

    // Check missing conversion sum
    let eurGFC = 0; let usdGFC = 0;
    for (const r of results) {
        if (r.type === "interest") {
            if (r.currency === "EUR") eurGFC += r.quantity;
            if (r.currency === "USD") usdGFC += r.quantity;
        } else if (r.type === "conversion") {
            if (r.ticker === "EUR") eurGFC -= (r.quantity * r.unit_price) + r.fees;
            if (r.ticker === "USD") usdGFC -= (r.quantity * r.unit_price) + r.fees;
            if (r.currency === "EUR") eurGFC += r.quantity;
            if (r.currency === "USD") usdGFC += r.quantity;
        }
    }
    console.log(`GFC BALANCES: EUR=${eurGFC.toFixed(2)} USD=${usdGFC.toFixed(2)}`);

    return results;
}

function mapTestTransactionToParsed(tx: TestTransaction, portfolioId: string): any {
    let mappedType: string = tx.type.toLowerCase();
    switch (tx.type) {
        case "BUY": mappedType = "buy"; break;
        case "SELL": mappedType = "sell"; break;
        case "DEPOSIT": mappedType = "deposit"; break;
        case "WITHDRAWAL": mappedType = "withdrawal"; break;
        case "DIVIDEND": mappedType = "dividend"; break;
        case "INTEREST": mappedType = "interest"; break;
        case "TRANSFER_IN": mappedType = "buy"; break;
        case "TRANSFER_OUT": mappedType = "sell"; break;
    }

    let calculatedFees = 0;
    if (tx.type === "BUY" && tx.quantity != null && tx.price != null) {
        calculatedFees = Math.max(0, Math.abs(tx.amount) - (tx.quantity * tx.price));
    } else if (tx.type === "SELL" && tx.quantity != null && tx.price != null) {
        calculatedFees = Math.max(0, (tx.quantity * tx.price) - tx.amount);
    }

    return {
        portfolio_id: portfolioId, date: tx.date, type: mappedType as any,
        ticker: tx.symbol || null, quantity: (mappedType === "interest" || mappedType === "dividend") ? tx.amount : (tx.quantity || Math.abs(tx.amount)), unit_price: tx.price || 1,
        fees: calculatedFees, currency: tx.currency, _totalEUR: tx.amount, _raw: tx
    };
}

const file = process.argv[2] || "U19321556_20250224_20260205.htm";
const htmlContent = readFileSync(file, 'utf-8');
const { transactions } = parseIBKR(htmlContent);

const forexTxs = transactions.filter(t => t.type === "FOREX");
const otherTxs = transactions.filter(t => t.type !== "FOREX");

const mappedOthers = otherTxs.map(t => mapTestTransactionToParsed(t, "port"));
const mappedForex = groupForexToConversions(forexTxs, "port");
const mapped = [...mappedOthers, ...mappedForex].sort((a, b) => a.date.localeCompare(b.date));

// Calculate expected vs actual cash delta per transaction
let diffFound = false;
for (const m of mapped) {
    let expectedDelta = 0;
    let expectedCurrency = m.currency;
    let expectedDelta2 = 0;
    let expectedCurrency2 = "";

    if (m.type === "conversion") {
        expectedCurrency = m.ticker; // source
        expectedDelta = - (m.quantity * m.unit_price) - m.fees;
        expectedCurrency2 = m.currency; // target
        expectedDelta2 = m.quantity;
    } else {
        expectedDelta = m._totalEUR; // For non-conversion, _totalEUR is tx.amount
        if (m._totalEUR === undefined) {
            console.log("NO _totaleur:", m);
        }
    }

    let actualDelta = 0;
    if (m.type === "deposit") actualDelta = m.quantity * m.unit_price;
    else if (m.type === "withdrawal") actualDelta = - m.quantity * m.unit_price;
    else if (m.type === "buy") actualDelta = - (m.quantity * m.unit_price + m.fees);
    else if (m.type === "sell") actualDelta = m.quantity * m.unit_price - m.fees;
    else if (m.type === "dividend" || m.type === "interest") actualDelta = m.quantity * m.unit_price;
    else if (m.type === "conversion") actualDelta = - (m.quantity * m.unit_price + m.fees);// tested above

    if (m.type !== "conversion" && Math.abs(actualDelta - expectedDelta) > 0.01) {
        console.log(`MISMATCH ON ${m.date} ${m.type} ${m.ticker || ""} | Expected: ${expectedDelta} | Actual calculated: ${actualDelta} | Raw amount: ${m._raw?.amount}`);
        diffFound = true;
    } else if (m.type === "conversion") {
        // Conversions must match perfectly, but let's check if the raw amounts matched
        const rawSource = m._raw1?.amount || 0;
        const rawTarget = m._raw2?.amount || 0;
        if (Math.abs(actualDelta - rawSource) > 0.01 && Math.abs(expectedDelta2 - rawTarget) > 0.01) {
            console.log("CONVERSION MISMATCH", m);
        }
    }
}

let expectedEur = 0; let expectedUsd = 0;
let actualEur = 0; let actualUsd = 0;
let aEUR = 0; let aUSD = 0;

for (const m of mapped) {
    let actualDelta = 0;
    if (m.type === "deposit") actualDelta = m.quantity * m.unit_price;
    else if (m.type === "withdrawal") actualDelta = - m.quantity * m.unit_price;
    else if (m.type === "buy") actualDelta = - (m.quantity * m.unit_price + m.fees);
    else if (m.type === "sell") actualDelta = m.quantity * m.unit_price - m.fees;
    else if (m.type === "dividend" || m.type === "interest") actualDelta = m.quantity * m.unit_price;
    else if (m.type === "conversion") actualDelta = - (m.quantity * m.unit_price + m.fees);

    if (m.currency === "EUR") actualEur += actualDelta;
    else if (m.currency === "USD") actualUsd += actualDelta;

    if (m.type === "conversion") {
        if (m.ticker === "EUR") { actualEur += actualDelta; aEUR += m._raw1?.amount || 0; }
        else if (m.ticker === "USD") { actualUsd += actualDelta; aUSD += m._raw1?.amount || 0; }
        if (m.currency === "EUR") { actualEur += m.quantity; }
        else if (m.currency === "USD") { actualUsd += m.quantity; }
    } else {
        if (m.currency === "EUR") aEUR += m._totalEUR || 0;
        else if (m.currency === "USD") aUSD += m._totalEUR || 0;
    }
}

let rawEUR = 0; let rawUSD = 0;
let droppedEUR = 0; let droppedUSD = 0;
for (const tx of transactions) {
    let found = false;
    for (const m of mapped) {
        if (m._raw === tx || m._raw1 === tx || m._raw2 === tx) { found = true; break; }
    }
    if (!found) {
        console.log(`DROPPED TX: ${tx.date} ${tx.type} ${tx.symbol || tx.currency} ${tx.amount}`);
        if (tx.currency === "EUR") droppedEUR += tx.amount;
        else if (tx.currency === "USD") droppedUSD += tx.amount;
    }
    if (tx.currency === "EUR") rawEUR += tx.amount;
    else if (tx.currency === "USD") rawUSD += tx.amount;
}

console.log(`RAW SUMS: EUR=${rawEUR.toFixed(2)}, USD=${rawUSD.toFixed(2)}`);
console.log(`DROPPED SUMS: EUR=${droppedEUR.toFixed(2)}, USD=${droppedUSD.toFixed(2)}`);
console.log(`MAPPED SUMS: EUR=${actualEur.toFixed(2)}, USD=${actualUsd.toFixed(2)}`);

const finalBalances = calculateCashBalances(mapped);
console.log("CALCULATED FINAL BALANCES:", finalBalances);

if (!diffFound) console.log("NO INDIVIDUAL MISMATCHES FOUND?!");
