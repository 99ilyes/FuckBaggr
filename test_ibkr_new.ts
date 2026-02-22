import { readFileSync } from "fs";
import { parseIBKR } from "./src/lib/ibkrParser";

const htmlContent = readFileSync("U19321556_20250224_20260205.htm", "utf-8");
const { transactions, skipped } = parseIBKR(htmlContent);

console.log("Total transactions:", transactions.length);
console.log("Skipped rows:", skipped);

const cashMovements = transactions.filter(t => t.type === "DEPOSIT" || t.type === "WITHDRAWAL" || t.type === "INTEREST" || t.type === "DIVIDEND");
console.log("\nCash Movements (Deposits/Withdrawals/Interest/Dividends):");
console.log(cashMovements.slice(0, 20)); // Print some cash movements

const forexMovements = transactions.filter(t => t.type === "FOREX");
console.log("\nForex Movements:");
console.log(forexMovements.slice(0, 10));

let cashBalanceEUR = 0;
let cashBalanceUSD = 0;

for (const tx of transactions) {
    let amount = 0;
    if (tx.type === "DEPOSIT" || tx.type === "WITHDRAWAL" || tx.type === "INTEREST" || tx.type === "DIVIDEND") {
        amount = tx.amount;
    } else if (tx.type === "BUY" && tx.quantity != null && tx.price != null) {
        amount = tx.amount; // amount is already negative and includes comms
    } else if (tx.type === "SELL" && tx.quantity != null && tx.price != null) {
        amount = tx.amount;
    } else if (tx.type === "FOREX") {
        amount = tx.amount;
    }

    if (tx.currency === "EUR") cashBalanceEUR += amount;
    if (tx.currency === "USD") cashBalanceUSD += amount;
}

console.log("\nCalculated Cash Balance EUR:", cashBalanceEUR);
console.log("Calculated Cash Balance USD:", cashBalanceUSD);
