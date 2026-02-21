import { parseIBKR } from "./src/lib/ibkrParser.ts";
import * as fs from "fs";
import { JSDOM } from "jsdom";

const dom = new JSDOM("");
(global as any).DOMParser = dom.window.DOMParser;

const html = fs.readFileSync("U19321556_20250224_20260205.htm", "utf-8");
const parsed = parseIBKR(html);

console.log(`TOTAL PARSED: ${parsed.transactions.length}`);
console.log(`SKIPPED: ${parsed.skipped}`);

const buys = parsed.transactions.filter(t => t.type === "BUY");
const sells = parsed.transactions.filter(t => t.type === "SELL");
const deposits = parsed.transactions.filter(t => t.type === "DEPOSIT");
const withdrawals = parsed.transactions.filter(t => t.type === "WITHDRAWAL");
const dividends = parsed.transactions.filter(t => t.type === "DIVIDEND");

console.log(`BUYS: ${buys.length}`);
console.log(`SELLS: ${sells.length}`);
console.log(`DEPOSITS: ${deposits.length}`);
console.log(`WITHDRAWALS: ${withdrawals.length}`);
console.log(`DIVIDENDS: ${dividends.length}`);

console.log("-------------------");
console.log("ALL DEPOSITS:");
deposits.forEach(d => console.log(`${d.date} | ${d.currency} | ${d.amount}`));
console.log("ALL WITHDRAWALS:");
withdrawals.forEach(w => console.log(`${w.date} | ${w.currency} | ${w.amount}`));

