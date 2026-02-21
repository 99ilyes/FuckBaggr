import { parseIBKR } from "./src/lib/ibkrParser.js";
import * as fs from "fs";
import { JSDOM } from "jsdom";

const dom = new JSDOM("");
(global as any).DOMParser = dom.window.DOMParser;

const html = fs.readFileSync("U19321556_20250224_20260205.htm", "utf-8");
const { transactions, skipped } = parseIBKR(html);
console.log(`Parsed ${transactions.length} transactions. Skipped ${skipped}.`);

// Separate out cash movements by currency
const txByType = transactions.reduce((acc, tx) => {
    acc[tx.type] = (acc[tx.type] || 0) + 1;
    return acc;
}, {} as Record<string, number>);
console.log("Tx by type:", txByType);

const forex = transactions.filter(t => t.type === "FOREX");
console.log("\nFOREX sample:");
console.log(forex.slice(0, 4));

const deposits = transactions.filter(t => t.type === "DEPOSIT" || t.type === "WITHDRAWAL");
console.log("\nEXTERNAL DEPOSITS/WITHDRAWALS:");
for (const d of deposits.filter(d => Math.abs(d.amount) > 0)) {
    console.log(`${d.date}: ${d.type} ${d.amount} ${d.currency}`);
}

const usdCash = transactions.filter(t => t.currency === "USD").reduce((sum, t) => sum + (t.amount||0), 0);
const eurCash = transactions.filter(t => t.currency === "EUR").reduce((sum, t) => sum + (t.amount||0), 0);
console.log("\nAbsolute Cash sum (USD):", usdCash);
console.log("Absolute Cash sum (EUR):", eurCash);

