import { Transaction } from "@/hooks/usePortfolios";

// Mapping exchange suffix → Yahoo Finance suffix
const EXCHANGE_SUFFIX_MAP: Record<string, string> = {
  xpar: ".PA",
  xetr: ".DE",
  xtks: ".T",
  xlon: ".L",
  xams: ".AS",
  xbru: ".BR",
  xmil: ".MI",
  xhel: ".HE",
  xlis: ".LS",
  xmad: ".MC",
  xsto: ".ST",
  xosl: ".OL",
  xcse: ".CO",
  xswx: ".SW",
  // US exchanges → no suffix
  xnas: "",
  xnys: "",
  arcx: "",
  bats: "",
};

/**
 * Converts a Saxo Bank symbol (e.g. "PLTR:xnas", "B28A:xpar") to a Yahoo Finance ticker.
 * If the exchange is not in the map, the suffix ".XX" is used as a fallback.
 */
function toYahooTicker(symbol: string, instrumentCurrency: string): string {
  if (!symbol) return "";
  const parts = symbol.split(":");
  const base = parts[0].toUpperCase();
  const exchange = parts[1]?.toLowerCase() ?? "";

  const suffix = EXCHANGE_SUFFIX_MAP[exchange];
  if (suffix === undefined) {
    // Unknown exchange — try to use base only, or add suffix based on currency
    return base;
  }
  return base + suffix;
}

/**
 * Parse the "Événement" field to extract quantity, price, and event currency.
 * Examples:
 *   "Acheter 19 @ 149.00 USD"
 *   "Vendre -884 @ 5.67 EUR"
 *   "Acheter 100 @ 24,540 JPY"
 */
function parseEvent(event: string): { qty: number; price: number; currency: string } | null {
  // Match "Acheter/Vendre [-]N @ PRICE CUR"  (price can have comma thousands separator)
  const match = event.match(/(?:Acheter|Vendre)\s+([-\d,. ]+)\s*@\s*([\d,. ]+)\s+([A-Z]+)/i);
  if (!match) return null;

  // Remove spaces used as thousands separator, replace comma decimal with dot
  const rawQty = match[1].replace(/\s/g, "").replace(",", ".");
  const rawPrice = match[2].replace(/\s/g, "").replace(",", ".");

  const qty = Math.abs(parseFloat(rawQty));
  const price = parseFloat(rawPrice);
  const currency = match[3].toUpperCase();

  if (isNaN(qty) || isNaN(price)) return null;
  return { qty, price, currency };
}

/**
 * Parse a date string like "12-Feb-2026" → "2026-02-12"
 */
function parseDate(dateStr: string): string | null {
  if (!dateStr) return null;
  // Format: DD-Mon-YYYY
  const months: Record<string, string> = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04",
    May: "05", Jun: "06", Jul: "07", Aug: "08",
    Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };
  const parts = dateStr.split("-");
  if (parts.length !== 3) return null;
  const month = months[parts[1]];
  if (!month) return null;
  return `${parts[2]}-${month}-${parts[0].padStart(2, "0")}`;
}

/**
 * Calculate fees for a trade.
 * fees = |Montant comptabilisé| - (qty × price × exchangeRate)
 * If negative or > 50€ → 0
 */
function calcFees(
  montant: number,
  qty: number,
  price: number,
  exchangeRate: number,
  txType: "buy" | "sell"
): number {
  const grossEUR = qty * price * exchangeRate;
  let fees: number;
  if (txType === "buy") {
    fees = Math.abs(montant) - grossEUR;
  } else {
    fees = grossEUR - Math.abs(montant);
  }
  if (isNaN(fees) || fees < 0 || fees > 50) return 0;
  return Math.round(fees * 100) / 100;
}

export interface ParsedTransaction extends Omit<Transaction, "id" | "created_at" | "notes"> {
  // Extra fields for display in the preview (not stored in DB)
  _isin?: string;
  _instrument?: string;
  _totalEUR?: number;
}

export interface ParseResult {
  transactions: ParsedTransaction[];
  skippedCount: number;
  negativeBalanceWarnings: Array<{ date: string; balance: number }>;
}

/**
 * Main parser: takes raw rows from SheetJS (array of objects with header keys)
 * and returns normalized transactions ready for import.
 */
export function parseSaxoXLSX(rows: Record<string, any>[], portfolioId: string): ParseResult {
  const transactions: ParsedTransaction[] = [];
  let skippedCount = 0;

  for (const row of rows) {
    const type: string = (row["Type"] ?? "").trim();
    const event: string = (row["Événement"] ?? "").trim();
    const symbol: string = (row["Symbole"] ?? "").trim();
    const isin: string = (row["Code ISIN de l'instrument"] ?? "").trim();
    const instrument: string = (row["Instrument"] ?? "").trim();
    const instrumentCurrency: string = (row["Devise de l'instrument"] ?? "EUR").trim().toUpperCase();
    const montantRaw = row["Montant comptabilisé"];
    const montant = typeof montantRaw === "number" ? montantRaw : parseFloat(String(montantRaw ?? "").replace(",", "."));
    const exchangeRateRaw = row["Taux de change"];
    const exchangeRate = typeof exchangeRateRaw === "number" ? exchangeRateRaw : parseFloat(String(exchangeRateRaw ?? "1").replace(",", ".")) || 1;
    const dateStr: string = (row["Date d'opération"] ?? "").trim();

    // Skip rows with 0 or missing amount
    if (!montantRaw && montantRaw !== 0) { skippedCount++; continue; }
    if (montant === 0) { skippedCount++; continue; }

    const date = parseDate(dateStr);
    if (!date) { skippedCount++; continue; }

    // --- DEPOSIT / WITHDRAWAL ---
    if (type === "Transfert d'espèces") {
      if (event === "Dépôts") {
        const amount = Math.abs(montant);
        transactions.push({
          portfolio_id: portfolioId,
          date,
          type: "deposit",
          ticker: null,
          quantity: amount,
          unit_price: 1,
          fees: 0,
          currency: "EUR",
          _isin: "",
          _instrument: "Dépôt",
          _totalEUR: amount,
        });
      } else if (event === "Retrait") {
        const amount = Math.abs(montant);
        transactions.push({
          portfolio_id: portfolioId,
          date,
          type: "withdrawal",
          ticker: null,
          quantity: amount,
          unit_price: 1,
          fees: 0,
          currency: "EUR",
          _isin: "",
          _instrument: "Retrait",
          _totalEUR: -amount,
        });
      } else {
        skippedCount++;
      }
      continue;
    }

    // --- BUY / SELL ---
    if (type === "Opération") {
      const isBuy = event.startsWith("Acheter");
      const isSell = event.startsWith("Vendre");
      if (!isBuy && !isSell) { skippedCount++; continue; }

      const parsed = parseEvent(event);
      if (!parsed) { skippedCount++; continue; }

      const { qty, price } = parsed;
      if (qty <= 0 || price <= 0) { skippedCount++; continue; }

      const ticker = toYahooTicker(symbol, instrumentCurrency);
      const txType: "buy" | "sell" = isBuy ? "buy" : "sell";

      // Exchange rate: for EUR instruments it's always 1
      const effectiveRate = instrumentCurrency === "EUR" ? 1 : exchangeRate;
      const fees = calcFees(montant, qty, price, effectiveRate, txType);
      const totalEUR = montant; // already in EUR (negative for buy, positive for sell)

      transactions.push({
        portfolio_id: portfolioId,
        date,
        type: txType,
        ticker: ticker || null,
        quantity: qty,
        unit_price: price,
        fees,
        currency: instrumentCurrency,
        _isin: isin,
        _instrument: instrument,
        _totalEUR: totalEUR,
      });
      continue;
    }

    // All other types (Montant de liquidités, Opération sur titres, etc.) → skip
    skippedCount++;
  }

  // Sort transactions chronologically (oldest first) for cash balance validation
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));

  // Cash balance simulation (deposits/withdrawals affect cash; buys reduce it; sells increase it)
  let cashBalance = 0;
  const negativeBalanceWarnings: Array<{ date: string; balance: number }> = [];

  for (const tx of sorted) {
    if (tx.type === "deposit") {
      cashBalance += tx.quantity ?? 0;
    } else if (tx.type === "withdrawal") {
      cashBalance -= tx.quantity ?? 0;
    } else if (tx.type === "buy") {
      cashBalance += tx._totalEUR ?? 0; // negative value reduces cash
    } else if (tx.type === "sell") {
      cashBalance += tx._totalEUR ?? 0; // positive value increases cash
    }
    if (cashBalance < -0.01) {
      negativeBalanceWarnings.push({ date: tx.date, balance: Math.round(cashBalance * 100) / 100 });
    }
  }

  return { transactions, skippedCount, negativeBalanceWarnings };
}
