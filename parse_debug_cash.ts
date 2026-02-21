import { parseIBKR } from "./src/lib/ibkrParser.js";
import * as fs from "fs";
import { JSDOM } from "jsdom";

const dom = new JSDOM("");
(global as any).DOMParser = dom.window.DOMParser;

const html = fs.readFileSync("U19321556_20250224_20260205.htm", "utf-8");
const { transactions } = parseIBKR(html);

// Group by type
const txByType = transactions.reduce((acc, tx) => {
    acc[tx.type] = (acc[tx.type] || 0) + 1;
    return acc;
}, {} as Record<string, number>);
console.log("Tx by type:", txByType);

// Sum cash impacts by type
const cashImpacts = { EUR: 0, USD: 0 };
transactions.forEach(tx => {
    if (tx.currency === "EUR" || tx.currency === "USD") {
        cashImpacts[tx.currency] += (tx.amount || 0);
    }
});

console.log("\nRaw Cash Sums (All Tx):");
console.log("EUR:", cashImpacts.EUR.toFixed(2));
console.log("USD:", cashImpacts.USD.toFixed(2));

const byCategory: any = { EUR: {}, USD: {} };
transactions.forEach(tx => {
    if (tx.currency !== "EUR" && tx.currency !== "USD") return;
    byCategory[tx.currency][tx.type] = (byCategory[tx.currency][tx.type] || 0) + (tx.amount || 0);
});

console.log("\nCash Impacts by Category:");
console.dir(byCategory, { depth: null });

