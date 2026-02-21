import * as XLSX from "xlsx";
import * as fs from "fs";

function parseNum(v: any, fallback = 0): number {
  if (typeof v === "number") return v;
  let s = String(v ?? "").replace(/[^\d.,-]/g, "");
  if (s.includes(",") && s.includes(".")) {
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (s.includes(",")) s = s.replace(/,/g, ".");
  const n = parseFloat(s);
  return isNaN(n) ? fallback : n;
}

function main() {
  const wb = XLSX.read(fs.readFileSync("AccountStatement_19346705_2024-01-01_2026-02-19.xlsx"), { type: "buffer", cellDates: true, raw: true });
  const sheet = wb.Sheets[wb.SheetNames[1]];
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);
  
  let totalDeposits = 0;
  for (const row of rows) {
    const event = String(row["Événement"] ?? "").trim();
    const variation = parseNum(row["Variation nette"]);
    if (event.includes("Transfert d'espèces") || event.includes("Transfert d’espèces")) {
      totalDeposits += variation;
    }
  }
  
  console.log("Total Deposits from Account Statement:", totalDeposits);
}
main();
