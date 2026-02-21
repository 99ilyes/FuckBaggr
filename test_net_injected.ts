import * as XLSX from "xlsx";
import * as fs from "fs";

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
    const currency = String(row["Devise de l'instrument"] ?? "EUR").trim().toUpperCase();
    const exchangeRate = parseNum(row["Taux de change"], 1);
    const evLower = event.toLowerCase();
    const isTransferIn = evLower.includes("transfert entrant");
    const isTransferOut = evLower.includes("transfert sortant");
    const symbolRaw = String(row["Symbole"] ?? "").trim();
    let date = row["Date d'opération"];
    if (date instanceof Date) {
         date = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    } else continue;
    
    if (type === "Transfert d'espèces" || type === "Transfert d’espèces") {
      transactions.push({ date, amount, currency, exchangeRate, type: amount > 0 ? "DEPOSIT" : "WITHDRAWAL" });
      continue;
    }
    
    if (amount === 0 && !isTransferIn && !isTransferOut) continue;

    if (type === "Opération") {
      const parsed = extractQtyPrice(event);
      if (!parsed) continue;
      
      let txType = amount < 0 ? "BUY" : "SELL";
      let finalPrice = parsed.price;
      
      if (isTransferIn) { txType = "TRANSFER_IN"; finalPrice = parsed.price; }
      else if (isTransferOut) { txType = "TRANSFER_OUT"; finalPrice = parsed.price; }
      
      transactions.push({
        date, type: txType, symbol: formatSymbol(symbolRaw),
        quantity: parsed.qty, price: finalPrice, amount, currency, exchangeRate
      });
    }
  }

  let netInjected = 0;
  for (const tx of transactions) {
     if (["DEPOSIT", "WITHDRAWAL"].includes(tx.type)) {
      netInjected += tx.amount;
     } else if (tx.type === "TRANSFER_IN") {
      const price = tx.price || 0;
      const fx = tx.exchangeRate || 1;
      const eurPrice = (tx.currency === "USD" || tx.currency === "GBP") && fx !== 1 ? price * fx : price;
      const transferValue = (tx.quantity || 0) * eurPrice;
      netInjected += transferValue;
      console.log(`Transfer In: ${tx.symbol} Qty ${tx.quantity} Price ${price} = ${transferValue}`);
     } else if (tx.type === "TRANSFER_OUT") {
      const price = tx.price || 0;
      const fx = tx.exchangeRate || 1;
      const eurPrice = (tx.currency === "USD" || tx.currency === "GBP") && fx !== 1 ? price * fx : price;
      const transferValue = (tx.quantity || 0) * eurPrice;
      netInjected -= transferValue;
      console.log(`Transfer Out: ${tx.symbol} Qty ${tx.quantity} Price ${price} = ${transferValue}`);
     }
  }

  console.log("Net Injected:", netInjected);
}
main();
