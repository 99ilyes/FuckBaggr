import { parseIBKR } from "./src/lib/ibkrParser.ts";
import * as fs from "fs";
import { JSDOM } from "jsdom";

const dom = new JSDOM("");
(global as any).DOMParser = dom.window.DOMParser;

const html = fs.readFileSync("U19321556_20250224_20260205.htm", "utf-8");
const parsed = parseIBKR(html);

let cashBalance = 0;
for (const tx of parsed.transactions) {
    // Mimicking TestImport.tsx
    if (tx.type === "DEPOSIT") {
        cashBalance += tx.amount;
    } else if (tx.type === "WITHDRAWAL") {
        // TestImport.tsx DOES THIS EXACTLY: cashBalance += tx.amount;
        cashBalance += tx.amount;
    } else if (tx.type === "DIVIDEND") {
        cashBalance += tx.amount;
    } else if (tx.type === "BUY") {
        cashBalance += tx.amount; // Should be negative
    } else if (tx.type === "SELL") {
        cashBalance += tx.amount; // Should be positive
    }
}

console.log("FINAL CASH MIMICKING UI BUG:", cashBalance);

let validCash = 0;
for (const tx of parsed.transactions) {
    if (tx.type === "DEPOSIT") {
        validCash += tx.amount;
    } else if (tx.type === "WITHDRAWAL") {
        validCash -= Math.abs(tx.amount); // Force correct math
    } else if (tx.type === "DIVIDEND") {
        validCash += tx.amount;
    } else if (tx.type === "BUY") {
        validCash -= Math.abs(tx.amount);
    } else if (tx.type === "SELL") {
        validCash += Math.abs(tx.amount);
    }
}

console.log("FINAL CASH WITH CORRECTED MATH:", validCash);
