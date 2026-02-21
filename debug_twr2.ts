import * as XLSX from "xlsx";
import * as fs from "fs";

// ... omit some copy paste ...
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

async function fetchHistoricalPrices(tickers: string[]) {
  const results: any = {};
  for (const ticker of tickers) {
    try {
      const resp = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=10y`);
      if (!resp.ok) continue;
      const data = await resp.json();
      const result = data?.chart?.result?.[0];
      if (!result) continue;
      
      const timestamps = result.timestamp;
      const closes = result.indicators.quote[0].close;
      const validTimestamps: number[] = [];
      const validCloses: number[] = [];
      for (let i = 0; i < timestamps.length; i++) {
        if (closes[i] != null) {
          validTimestamps.push(timestamps[i]);
          validCloses.push(closes[i]);
        }
      }
      if (validTimestamps.length > 0) {
        results[ticker] = { timestamps: validTimestamps, closes: validCloses };
      }
    } catch(e) {}
  }
  return results;
}

function getPriceForDay(hist: any, targetDateStr: string) {
  if (!hist || hist.timestamps.length === 0) return 0;
  const targetTime = Math.floor(new Date(targetDateStr).getTime() / 1000);
  let idx = -1;
  for (let i = hist.timestamps.length - 1; i >= 0; i--) {
    if (hist.timestamps[i] <= targetTime + 86400) { idx = i; break; }
  }
  if (idx === -1) idx = 0;
  return hist.closes[idx];
}

async function main() {
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
      
      if (isTransferIn) { txType = "TRANSFER_IN"; finalPrice = 0; }
      else if (isTransferOut) { txType = "TRANSFER_OUT"; finalPrice = 0; }
      
      transactions.push({
        date, type: txType, symbol: formatSymbol(symbolRaw),
        quantity: parsed.qty, price: finalPrice, amount, currency, exchangeRate
      });
    } else if (type === "Opération sur titres" && event.toLowerCase().includes("dividende")) {
      transactions.push({
        date, amount, currency, exchangeRate, type: "DIVIDEND", symbol: formatSymbol(symbolRaw)
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

  const symbols = Array.from(new Set(transactions.map(t => t.symbol).filter(Boolean)));
  const histories = await fetchHistoricalPrices(symbols);

  const txByDate = new Map<string, any[]>();
  for (const t of transactions) {
     const l = txByDate.get(t.date) || [];
     l.push(t);
     txByDate.set(t.date, l);
  }

  let start = new Date(transactions[0].date);
  let end = new Date();
  const days: string[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push(d.toISOString().split("T")[0]);
  }

  const latestFx = new Map<string, number>();
  let cashBalance = 0;
  const positions = new Map<string, number>();
  let cumulativeTwr = 0;
  let lastNav = 0;

  for (const day of days) {
    let dayNetCashFlow = 0;
    const dayTxs = txByDate.get(day) || [];
    
    for (const tx of dayTxs) {
      if (tx.currency && tx.exchangeRate) latestFx.set(tx.currency, tx.exchangeRate);
      
      if (tx.type === "DEPOSIT" || tx.type === "WITHDRAWAL") {
        cashBalance += tx.amount;
        dayNetCashFlow += tx.amount;
      } else if (tx.type === "DIVIDEND") {
        cashBalance += tx.amount;
      } else if (tx.type === "BUY") {
        cashBalance += tx.amount;
        positions.set(tx.symbol, (positions.get(tx.symbol) || 0) + tx.quantity);
      } else if (tx.type === "SELL") {
        cashBalance += tx.amount;
        positions.set(tx.symbol, (positions.get(tx.symbol) || 0) - tx.quantity);
      } else if (tx.type === "TRANSFER_IN") {
        positions.set(tx.symbol, (positions.get(tx.symbol) || 0) + tx.quantity);
        const price = getPriceForDay(histories[tx.symbol], day);
        const fx = latestFx.get(tx.currency) || 1;
        const eurPrice = (tx.currency === "USD" || tx.currency === "GBP") && fx > 1 ? price / fx : price;
        dayNetCashFlow += tx.quantity * eurPrice; 
      } else if (tx.type === "TRANSFER_OUT") {
        positions.set(tx.symbol, (positions.get(tx.symbol) || 0) - tx.quantity);
        const price = getPriceForDay(histories[tx.symbol], day);
        const fx = latestFx.get(tx.currency) || 1;
        const eurPrice = (tx.currency === "USD" || tx.currency === "GBP") && fx > 1 ? price / fx : price;
        dayNetCashFlow -= tx.quantity * eurPrice;
      }
    }

    let nav = cashBalance;
    for (const [symbol, qty] of positions.entries()) {
      if (qty <= 0) continue;
      const price = getPriceForDay(histories[symbol], day);
      let eurPrice = price;
      let symCurrency = "EUR";
      const pastTx = transactions.find(t => t.symbol === symbol);
      if (pastTx) symCurrency = pastTx.currency;
      
      const fx = latestFx.get(symCurrency) || 1;
      if (symCurrency !== "EUR" && fx !== 1) {
        eurPrice = price / fx;
      }
      nav += qty * eurPrice;
    }
    nav = Math.max(0, nav);

    if (lastNav === 0) {
      if (dayNetCashFlow !== 0) lastNav = nav;
    } else {
      let returnPct = 0;
      if (lastNav > 0) {
         returnPct = (nav - dayNetCashFlow) / lastNav - 1;
      } else if (dayNetCashFlow > 0) {
         // Special case where lastNav went to 0, and we add money
         returnPct = 0; // Return is undefined, just resume tracking
      }
      
      // If lastNav goes to 0 (all sold and withdrawn), we can't calculate a return safely
      if (lastNav > 0 || returnPct !== 0) {
        cumulativeTwr = (1 + cumulativeTwr) * (1 + returnPct) - 1;
        
        if (Math.abs(returnPct) > 0.02) {
             console.log(`[!] Move >2% on ${day}: Return = ${(returnPct*100).toFixed(2)}%, NAV = ${nav.toFixed(2)}, LastNAV = ${lastNav.toFixed(2)}, CashFlow = ${dayNetCashFlow.toFixed(2)}`);
        }
      }
      if (nav > 0) lastNav = nav; // don't reset lastNav to 0 if we temporarily hit 0 nav unless we really withdrew everything. wait, if nav=0, next returnPct will divide by 0!
    }
  }
  
  console.log(`Final TWR: ${(cumulativeTwr*100).toFixed(2)}%`);
  console.log(`Final NAV: ${lastNav.toFixed(2)}`);
}
main();
