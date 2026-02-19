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
 * Parse a date value from SheetJS.
 * Handles multiple formats:
 *   - "12-Feb-2026"         (Saxo native string)
 *   - "2/12/2026"           (SheetJS raw:false US format)
 *   - "12/2/2026"           (SheetJS raw:false EU format)
 *   - "2026-02-12"          (ISO)
 *   - Date object           (when cellDates:true)
 *   - number                (Excel serial)
 */
function parseDate(dateVal: any): string | null {
  if (!dateVal && dateVal !== 0) return null;

  // Already a Date object (cellDates: true)
  if (dateVal instanceof Date) {
    const y = dateVal.getFullYear();
    const m = String(dateVal.getMonth() + 1).padStart(2, "0");
    const d = String(dateVal.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // Excel serial number
  if (typeof dateVal === "number") {
    // Excel epoch: Jan 1 1900 = 1, with the leap year bug (day 60 = Feb 29 1900 doesn't exist)
    const excelEpoch = new Date(Date.UTC(1900, 0, 1));
    const offsetDays = dateVal > 59 ? dateVal - 2 : dateVal - 1; // skip the phantom Feb 29 1900
    const date = new Date(excelEpoch.getTime() + offsetDays * 86400000);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  const dateStr = String(dateVal).trim();
  if (!dateStr) return null;

  // Format: DD-Mon-YYYY  (e.g. "12-Feb-2026")
  const months: Record<string, string> = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04",
    May: "05", Jun: "06", Jul: "07", Aug: "08",
    Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };
  const dashParts = dateStr.split("-");
  if (dashParts.length === 3 && isNaN(Number(dashParts[1]))) {
    const month = months[dashParts[1]];
    if (month) return `${dashParts[2]}-${month}-${dashParts[0].padStart(2, "0")}`;
  }

  // Format: ISO "2026-02-12"
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr.substring(0, 10);

  // Format: M/D/YYYY or D/M/YYYY (SheetJS raw:false)
  const slashParts = dateStr.split("/");
  if (slashParts.length === 3) {
    const [a, b, y] = slashParts;
    const month = String(b).padStart(2, "0");
    const day = String(a).padStart(2, "0");
    return `${y}-${month}-${day}`;
  }

  // Format: "2026-02-12 00:00:00" (SQL timestamp string)
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/.test(dateStr)) return dateStr.substring(0, 10);

  return null;
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
    const type: string = String(row["Type"] ?? "").trim();
    const event: string = String(row["Événement"] ?? "").trim();
    const symbol: string = String(row["Symbole"] ?? "").trim();
    const isin: string = String(row["Code ISIN de l'instrument"] ?? "").trim();
    const instrument: string = String(row["Instrument"] ?? "").trim();
    const instrumentCurrency: string = String(row["Devise de l'instrument"] ?? "EUR").trim().toUpperCase();

    // Montant: with raw:false comes as formatted string like "-2,396.06" or "-2396.06"
    const montantRaw = row["Montant comptabilisé"];
    const montant = typeof montantRaw === "number"
      ? montantRaw
      : parseFloat(String(montantRaw ?? "").replace(/[^\d.,-]/g, "").replace(",", "."));

    // Exchange rate: with raw:false comes as string like "0.84569196"
    const exchangeRateRaw = row["Taux de change"];
    const exchangeRate = typeof exchangeRateRaw === "number"
      ? exchangeRateRaw
      : parseFloat(String(exchangeRateRaw ?? "1").replace(",", ".")) || 1;

    // Date: can be a Date object (cellDates:true), a number (serial), or a string
    const dateVal = row["Date d'opération"];

    // Skip rows with 0 or missing amount (unless it's a corporate action with 0 amount but relevant?)
    // For cash flow, we need amount.
    if (montantRaw === "" || montantRaw === undefined || montantRaw === null || isNaN(montant) || montant === 0) {
      // console.log("Skipping row (empty/zero amount):", row);
      skippedCount++;
      continue;
    }

    const date = parseDate(dateVal);
    if (!date) {
      console.warn("Skipping row (invalid date):", row);
      skippedCount++;
      continue;
    }

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
        continue;
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
        continue;
      }
    }

    // --- DIVIDENDS / INTERESTS / COUPONS ---
    // "Opération sur titres" -> "Dividendes en espèces"
    // "Intérêts" -> "Intérêts débiteurs" or "Intérêts créditeurs" (amount sign tells us)
    if (
      (type === "Opération sur titres" && event.includes("Dividendes")) ||
      type === "Intérêts" ||
      event.includes("Coupons")
    ) {
      // Dividend/Interest adds to cash if positive, subtracts if negative (but usually positive for dividends)
      // We act like it's a "deposit" (inflow) or "withdrawal" (outflow) regarding cash,
      // but strict typing might require mapping to 'deposit'/'withdrawal' OR adding new types.
      // For now, let's map to 'dividend' type if possible, or 'deposit' with a note.
      // Since Transaction type is strict (check DB enum), we might need to cast or stick to known types.
      // DB 'transactions.type' is text/varchar, so we can use "dividend".

      const isDividend = event.includes("Dividendes") || event.includes("Coupons");
      const txType = isDividend ? "dividend" : "interest"; // custom types, handle in UI

      const tickerFromSymbol = toYahooTicker(symbol, instrumentCurrency);
      const ticker = tickerFromSymbol || isin || null;

      transactions.push({
        portfolio_id: portfolioId,
        date,
        type: txType as any, // Cast to allow custom types if TS restricts
        ticker,
        quantity: Math.abs(montant), // Just for display
        unit_price: 1,
        fees: 0,
        currency: "EUR", // Usually these are booked in EUR in the 'Montant comptabilisé' column
        _isin: isin,
        _instrument: event, // Use event description (e.g. "Dividendes en espèces")
        _totalEUR: montant,
      });
      continue;
    }

    // --- BUY / SELL ---
    if (type === "Opération") {
      const isBuy = event.startsWith("Acheter") || event.startsWith("Achat");
      const isSell = event.startsWith("Vendre") || event.startsWith("Vente");

      if (!isBuy && !isSell) {
        console.log("Skipping Opération (unknown event):", event, row);
        skippedCount++;
        continue;
      }

      const parsed = parseEvent(event);
      if (!parsed) {
        console.warn("Skipping Opération (parse error):", event, row);
        skippedCount++;
        continue;
      }

      const { qty, price } = parsed;
      if (qty <= 0 || price <= 0) {
        // console.warn("Skipping Opération (invalid qty/price):", row);
        skippedCount++;
        continue;
      }

      const tickerFromSymbol = toYahooTicker(symbol, instrumentCurrency);
      const ticker = tickerFromSymbol || isin || null;
      const txType: "buy" | "sell" = isBuy ? "buy" : "sell";

      // Exchange rate: for EUR instruments it's always 1
      const effectiveRate = instrumentCurrency === "EUR" ? 1 : exchangeRate;
      const fees = calcFees(montant, qty, price, effectiveRate, txType);
      const totalEUR = montant; // already in EUR (negative for buy, positive for sell)

      transactions.push({
        portfolio_id: portfolioId,
        date,
        type: txType,
        ticker,
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

    // All other tags
    console.log("Skipping row (unhandled type):", type, event, row);
    skippedCount++;
  }

  // Sort transactions chronologically (oldest first) for cash balance validation
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));

  // Cash balance simulation
  let cashBalance = 0;
  const negativeBalanceWarnings: Array<{ date: string; balance: number }> = [];

  for (const tx of sorted) {
    // _totalEUR is the net impact on cash in EUR
    // For deposits: +amount
    // For withdrawals: -amount
    // For buys: -amount (usually negative in file)
    // For sells: +amount
    // For dividends/interest: +amount

    // We can simply trust _totalEUR if we set it correctly for all types.
    // Let's verify:
    // Deposit: _totalEUR = +amount. Correct.
    // Withdrawal: _totalEUR = -amount. Correct.
    // Buy: _totalEUR = montant (negative in file). Correct.
    // Sell: _totalEUR = montant (positive in file). Correct.
    // Dividend: _totalEUR = montant (positive). Correct.

    cashBalance += tx._totalEUR ?? 0;

    if (cashBalance < -0.01) {
      negativeBalanceWarnings.push({ date: tx.date, balance: Math.round(cashBalance * 100) / 100 });
    }
  }

  return { transactions, skippedCount, negativeBalanceWarnings };
}
