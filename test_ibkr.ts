import { parseIBKR } from "./src/lib/ibkrParser.ts";
import * as fs from "fs";
import { JSDOM } from "jsdom";

const dom = new JSDOM("");
(global as any).DOMParser = dom.window.DOMParser;

const html = fs.readFileSync("U19321556_20250224_20260205.htm", "utf-8");
const parsed = parseIBKR(html);

const forex = parsed.transactions.filter(t => !t.symbol && (t.type === "DEPOSIT" || t.type === "WITHDRAWAL") && t.amount > 10000);
const nans = parsed.transactions.filter(t => isNaN(t.amount) || (t.quantity && isNaN(t.quantity)));

console.log(`Extracted: ${parsed.transactions.length}, Skipped: ${parsed.skipped}`);
console.log(`Transactions with NaN: ${nans.length}`);
if (nans.length > 0) {
    console.log("NaN examples:", nans.slice(0, 3));
}

console.log("Large Forex/Cash transfers:");
for (const t of forex.slice(0, 10)) {
    console.log(t);
}

const div = parsed.transactions.filter(t => t.type === "DIVIDEND");
console.log("Dividends count:", div.length);
if (div.length > 0) console.log(div.slice(0, 2));
