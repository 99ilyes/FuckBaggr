import { readFileSync } from 'fs';
import { read, utils } from 'xlsx';
import { parseSaxoXLSX } from './src/lib/xlsxParser.ts';
import { parseIBKR } from './src/lib/ibkrParser.ts';

// 1. Test Excel
console.log("--- EXCEL ---");
const buf = readFileSync('Transactions_19346705_2024-06-14_2026-02-20.xlsx');
const wb = read(buf, { type: 'buffer', cellDates: true });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = utils.sheet_to_json(ws, { defval: "" });
const resExcel = parseSaxoXLSX(rows as any[], "test-portfolio");

let cash = 0;
for(const t of resExcel.transactions) {
    if ((t as any)._totalEUR !== undefined) cash += (t as any)._totalEUR;
}
console.log("Excel parsed:", resExcel.transactions.length, "skipped:", resExcel.skippedCount);
console.log("Cash balance:", cash);

const jpyTrades = resExcel.transactions.filter(t => t.currency === 'JPY');
console.log("JPY trades count:", jpyTrades.length);
if (jpyTrades.length > 0) {
    console.log("Sample JPY trade:", jpyTrades[0]);
}

// 2. Test IBKR
console.log("\n--- IBKR ---");
const htm = readFileSync('U19321556_20250224_20260205.htm', 'utf8');
const resIbkr = parseIBKR(htm);
console.log("IBKR parsed:", resIbkr.transactions.length, "skipped:", resIbkr.skipped);
const sampleIbkr = resIbkr.transactions.slice(0, 3);
console.log("Sample IBKR transactions:", sampleIbkr);
