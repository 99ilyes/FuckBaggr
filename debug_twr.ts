import * as XLSX from "xlsx";
import * as fs from "fs";

// ── Symbol mapping ─────────────────────────────────────────────────────
const EXCHANGE_SUFFIX: Record<string, string> = {
  xams: ".AS", xpar: ".PA", xdus: ".DE", xetr: ".DE",
  xmil: ".MI", xnas: "", xnys: "", arcx: "", bats: "",
};
function formatSymbol(raw: string): string | undefined {
  if (!raw) return undefined;
  const [base, exchange] = raw.split(":");
  if (!base) return undefined;
  let cleanBase = base.toUpperCase();
  if (cleanBase.endsWith("_REGD")) cleanBase = cleanBase.replace("_REGD", "");
  const suffix = EXCHANGE_SUFFIX[exchange?.toLowerCase() ?? ""];
  return cleanBase + (suffix ?? "");
}

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

function extractQtyPrice(event: string): { qty: number; price: number } | null {
  const m = event.match(/(?:Acheter|Vendre|Transfert entrant|Transfert sortant)\s+([-\d,.\s]+)\s*@\s*([\d,.\s]+)/i);
  if (!m) return null;
  const qty = Math.abs(parseNum(m[1]));
  const price = parseNum(m[2]);
  if (isNaN(qty) || isNaN(price)) return null;
  return { qty, price };
}

function main() {
  const wb = XLSX.read(fs.readFileSync("Transactions_19346705_2024-07-31_2026-02-19.xlsx"), { type: "buffer", cellDates: true, raw: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);
  
  const transactions: any[] = [];
  
  for (const row of rows) {
    const type = String(row["Type"] ?? "").trim();
    const event = String(row["Événement"] ?? "").trim();
    const amount = parseNum(row["Montant comptabilisé"]);
    const evLower = event.toLowerCase();
    const isTransferIn = evLower.includes("transfert entrant");
    const isTransferOut = evLower.includes("transfert sortant");
    
    // date validation mock
    let date = row["Date d'opération"];
    if (date instanceof Date) {
         date = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    } else continue;
    
    if (type === "Transfert d'espèces" || type === "Transfert d’espèces") {
      transactions.push({ date, amount, type: amount > 0 ? "DEPOSIT" : "WITHDRAWAL" });
      continue;
    }
    
    if (amount === 0 && !isTransferIn && !isTransferOut) continue;

    if (type === "Opération") {
      const parsed = extractQtyPrice(event);
      if (!parsed) continue;
      
      let txType = amount < 0 ? "BUY" : "SELL";
      let finalPrice = parsed.price;
      
      if (isTransferIn) { txType = "TRANSFER_IN"; finalPrice = 0; }
      else if (isTransferOut) { txType = "TRANSFER_OUT"; finalPrice = 0; }
      
      transactions.push({
        date,
        type: txType,
        symbol: formatSymbol(String(row["Symbole"] ?? "").trim()),
        quantity: parsed.qty,
        price: finalPrice,
        amount
      });
    } else if (type === "Opération sur titres" && event.toLowerCase().includes("dividende")) {
      transactions.push({
        date, amount, type: "DIVIDEND", symbol: formatSymbol(String(row["Symbole"] ?? "").trim())
      });
    }
  }

  transactions.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      const aIsAddition = ["BUY", "TRANSFER_IN", "DEPOSIT", "DIVIDEND"].includes(a.type);
      const bIsAddition = ["BUY", "TRANSFER_IN", "DEPOSIT", "DIVIDEND"].includes(b.type);
      if (aIsAddition && !bIsAddition) return -1;
      if (!aIsAddition && bIsAddition) return 1;
      return 0;
  });

  const summary = transactions.reduce((acc, tx) => {
     let cashFlow = 0;
     if (tx.type === "DEPOSIT" || tx.type === "WITHDRAWAL" || tx.type === "BUY" || tx.type === "SELL") {
         cashFlow = tx.amount;
     }
     acc.cash += cashFlow;
     if (tx.type === "DIVIDEND") acc.cash += tx.amount;
     return acc;
  }, { cash: 0 });

  console.log("Total cash balance at end:", summary.cash);
  
  let netDeposits = 0;
  for (const t of transactions) {
     if (t.type === "DEPOSIT" || t.type === "WITHDRAWAL") netDeposits += t.amount;
     if (t.type === "TRANSFER_IN") { 
         // Need to know what transfer in value is...
         netDeposits += t.quantity * t.price; 
     }
  }
  console.log("Net purely deposited cash:", netDeposits);
}
main();
