import { parseIBKR } from "./src/lib/ibkrParser";
import * as fs from "fs";
import { JSDOM } from "jsdom";

const dom = new JSDOM("");
(global as any).DOMParser = dom.window.DOMParser;

const html = fs.readFileSync("U19321556_20250224_20260205.htm", "utf-8");
const parsed = parseIBKR(html);
const eurSells = parsed.transactions.filter(t => t.type === "WITHDRAWAL" && t.currency === "EUR" && t.amount > 1000);
console.log("EUR LARGE WITHDRAWALS:", eurSells.slice(0, 4));

const badSyms = parsed.transactions.filter(t => t.symbol === "WITHHOLDING");
console.log("BAD SYMBOLS WITHHOLDING:", badSyms.length);

const nanTxs = parsed.transactions.filter(t => isNaN(t.amount) || (t.quantity && isNaN(t.quantity)) || isNaN(t.price || 0));
console.log("NaN entries:", nanTxs.length);
if (nanTxs.length > 0) console.log(nanTxs[0]);
