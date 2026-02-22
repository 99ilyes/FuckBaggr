import { Transaction } from "@/hooks/usePortfolios";

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
  xnas: "",
  xnys: "",
  arcx: "",
  bats: "",
};

function toYahooTicker(symbol: string): string | null {
  const raw = String(symbol || "").trim();
  if (!raw) return null;
  const [baseRaw, exchangeRaw] = raw.split(":");
  if (!baseRaw) return null;

  let base = baseRaw.toUpperCase();
  if (base.endsWith("_REGD")) base = base.replace("_REGD", "");
  if (base === "NOVOB") base = "NOVO-B";

  const exchange = (exchangeRaw || "").toLowerCase();
  const suffix = EXCHANGE_SUFFIX_MAP[exchange];
  return base + (suffix ?? "");
}

function parseDate(dateVal: unknown): string | null {
  if (dateVal == null || dateVal === "") return null;

  if (dateVal instanceof Date) {
    const y = dateVal.getUTCFullYear();
    const m = String(dateVal.getUTCMonth() + 1).padStart(2, "0");
    const d = String(dateVal.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  if (typeof dateVal === "number") {
    const epoch = new Date(Date.UTC(1900, 0, 1));
    const days = dateVal > 59 ? dateVal - 2 : dateVal - 1;
    const date = new Date(epoch.getTime() + days * 86400000);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  const dateStr = String(dateVal).trim();
  if (!dateStr) return null;

  const months: Record<string, string> = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04",
    May: "05", Jun: "06", Jul: "07", Aug: "08",
    Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };

  const dashParts = dateStr.split("-");
  if (dashParts.length === 3 && months[dashParts[1]]) {
    return `${dashParts[2]}-${months[dashParts[1]]}-${dashParts[0].padStart(2, "0")}`;
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr.substring(0, 10);

  const slashParts = dateStr.split("/");
  if (slashParts.length === 3) {
    const [d, m, y] = slashParts;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  return null;
}

function looksLikeThousandsWithComma(raw: string): boolean {
  const clean = raw.replace(/^-/, "");
  const parts = clean.split(",");
  if (parts.length <= 1) return false;
  if (parts[0] === "0") return false;
  return parts.slice(1).every((p) => p.length === 3);
}

function parseNumber(v: unknown, fallback = 0): number {
  if (typeof v === "number") return v;
  let s = String(v ?? "").replace(/[^\d.,-]/g, "");
  if (!s) return fallback;

  if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",")) {
    s = looksLikeThousandsWithComma(s) ? s.replace(/,/g, "") : s.replace(/,/g, ".");
  }

  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
}

type TradeAction = "buy" | "sell" | "transfer_in" | "transfer_out";

function parseTradeEvent(event: string): { action: TradeAction; qty: number; price: number; currency: string } | null {
  const m = String(event || "")
    .trim()
    .match(/^(Acheter|Vendre|Transfert entrant|Transfert sortant)\s+([-\d,.\s]+)\s*@\s*([-\d,.\s]+)\s*([A-Z]{3})?/i);
  if (!m) return null;

  const actionRaw = m[1].toLowerCase();
  const qty = Math.abs(parseNumber(m[2]));
  const price = parseNumber(m[3]);
  const currency = String(m[4] || "").toUpperCase();

  let action: TradeAction;
  if (actionRaw.startsWith("acheter")) action = "buy";
  else if (actionRaw.startsWith("vendre")) action = "sell";
  else if (actionRaw.includes("entrant")) action = "transfer_in";
  else action = "transfer_out";

  if (qty <= 0 || price <= 0) return null;
  return { action, qty, price, currency };
}

export interface ParsedTransaction extends Omit<Transaction, "id" | "created_at" | "notes"> {
  _isin?: string;
  _instrument?: string;
  _totalEUR?: number;
  _sourceTag?: string;
}

export interface ParseResult {
  transactions: ParsedTransaction[];
  skippedCount: number;
  negativeBalanceWarnings: Array<{ date: string; balance: number }>;
}

function pushTx(
  out: ParsedTransaction[],
  tx: ParsedTransaction,
  rowIndex: number,
  txIndexInRow: number
) {
  out.push({
    ...tx,
    _sourceTag: `SAXO-R${rowIndex}-T${txIndexInRow}`,
  });
}

export function parseSaxoXLSX(rows: Record<string, unknown>[], portfolioId: string): ParseResult {
  const transactions: ParsedTransaction[] = [];
  let skippedCount = 0;

  rows.forEach((row, idx) => {
    const type = String(row["Type"] ?? "").trim();
    const event = String(row["Événement"] ?? "").trim();
    const symbol = String(row["Symbole"] ?? "").trim();
    const isin = String(row["Code ISIN de l'instrument"] ?? "").trim();
    const instrument = String(row["Instrument "] ?? "").trim();
    const instrumentCurrency = String(row["Devise de l'instrument"] ?? "EUR").trim().toUpperCase();
    const bookedAmountEUR = parseNumber(row["Montant comptabilisé"]);
    const fxRate = parseNumber(row["Taux de change"], 1);
    const date = parseDate(row["Date d'opération"]);

    if (!date) {
      skippedCount++;
      return;
    }

    // Deposits / withdrawals are external flows (base for KPI "Investi")
    if (type === "Transfert d'espèces" || type === "Transfert d’espèces") {
      const ev = event.toLowerCase();
      if (ev.includes("dépôt")) {
        pushTx(transactions, {
          portfolio_id: portfolioId,
          date,
          type: "deposit",
          ticker: null,
          quantity: Math.abs(bookedAmountEUR),
          unit_price: 1,
          fees: 0,
          currency: "EUR",
          _isin: "",
          _instrument: "Dépôt",
          _totalEUR: Math.abs(bookedAmountEUR),
        }, idx, 0);
        return;
      }
      if (ev.includes("retrait")) {
        pushTx(transactions, {
          portfolio_id: portfolioId,
          date,
          type: "withdrawal",
          ticker: null,
          quantity: Math.abs(bookedAmountEUR),
          unit_price: 1,
          fees: 0,
          currency: "EUR",
          _isin: "",
          _instrument: "Retrait",
          _totalEUR: -Math.abs(bookedAmountEUR),
        }, idx, 0);
        return;
      }

      // Fallback: unknown cash transfer event -> interest in EUR
      pushTx(transactions, {
        portfolio_id: portfolioId,
        date,
        type: "interest",
        ticker: null,
        quantity: bookedAmountEUR,
        unit_price: 1,
        fees: 0,
        currency: "EUR",
        _isin: "",
        _instrument: event || "Mouvement cash",
        _totalEUR: bookedAmountEUR,
      }, idx, 0);
      return;
    }

    // Service fees / credit interests are cash adjustments in account currency (EUR)
    if (type === "Montant de liquidités") {
      pushTx(transactions, {
        portfolio_id: portfolioId,
        date,
        type: "interest",
        ticker: null,
        quantity: bookedAmountEUR,
        unit_price: 1,
        fees: 0,
        currency: "EUR",
        _isin: "",
        _instrument: event || "Montant de liquidités",
        _totalEUR: bookedAmountEUR,
      }, idx, 0);
      return;
    }

    // Dividends booked in EUR; for non-EUR assets we also add conversion to avoid residual foreign cash
    if (type === "Opération sur titres" && event.toLowerCase().includes("dividende")) {
      const ticker = toYahooTicker(symbol) || isin || null;
      const safeFx = fxRate > 0 ? fxRate : 1;
      const foreignAmount = instrumentCurrency === "EUR" ? bookedAmountEUR : bookedAmountEUR / safeFx;

      pushTx(transactions, {
        portfolio_id: portfolioId,
        date,
        type: "dividend",
        ticker,
        quantity: foreignAmount,
        unit_price: 1,
        fees: 0,
        currency: instrumentCurrency || "EUR",
        _isin: isin,
        _instrument: event,
        _totalEUR: bookedAmountEUR,
      }, idx, 0);

      if (instrumentCurrency !== "EUR" && Math.abs(bookedAmountEUR) > 0.000001 && Math.abs(foreignAmount) > 0.000001) {
        if (foreignAmount > 0 && bookedAmountEUR > 0) {
          // foreign -> EUR
          pushTx(transactions, {
            portfolio_id: portfolioId,
            date,
            type: "conversion",
            ticker: instrumentCurrency,
            quantity: bookedAmountEUR,
            unit_price: foreignAmount / bookedAmountEUR,
            fees: 0,
            currency: "EUR",
            _isin: isin,
            _instrument: "Conversion auto dividende",
            _totalEUR: 0,
          }, idx, 1);
        } else if (foreignAmount < 0 && bookedAmountEUR < 0) {
          // EUR -> foreign
          const targetAmount = Math.abs(foreignAmount);
          pushTx(transactions, {
            portfolio_id: portfolioId,
            date,
            type: "conversion",
            ticker: "EUR",
            quantity: targetAmount,
            unit_price: Math.abs(bookedAmountEUR) / targetAmount,
            fees: 0,
            currency: instrumentCurrency,
            _isin: isin,
            _instrument: "Conversion auto dividende",
            _totalEUR: 0,
          }, idx, 1);
        }
      }
      return;
    }

    if (type === "Opération") {
      const parsed = parseTradeEvent(event);
      if (!parsed) {
        skippedCount++;
        return;
      }

      const ticker = toYahooTicker(symbol) || isin || null;
      const tradeCurrency = parsed.currency || instrumentCurrency || "EUR";
      const safeFx = fxRate > 0 ? fxRate : 1;
      const bookedAbsEUR = Math.abs(bookedAmountEUR);
      const netTradeAmountFromBooked = bookedAbsEUR / safeFx;
      const action = parsed.action;

      if (action === "transfer_in" || action === "transfer_out") {
        // Saxo sometimes truncates transfer prices to 2 decimals in the export.
        // Keep the historical correction for the known WPEA transfer row.
        let transferPrice = parsed.price;
        if (ticker === "WPEA.PA" && action === "transfer_in" && parsed.qty === 1165 && Math.abs(parsed.price - 5.1) < 0.000001) {
          transferPrice = 6003.63 / 1165;
        }

        pushTx(transactions, {
          portfolio_id: portfolioId,
          date,
          type: action,
          ticker,
          quantity: parsed.qty,
          unit_price: transferPrice,
          fees: 0,
          currency: tradeCurrency,
          _isin: isin,
          _instrument: instrument,
          _totalEUR: 0,
        }, idx, 0);
        return;
      }

      // Rebuild trade cash impact from booked amount (truth source), including fees.
      // For buy: cash out in trade currency = qty*price + fees
      // For sell: cash in  in trade currency = qty*price - fees
      let unitPrice = parsed.price;
      let fees = action === "buy"
        ? netTradeAmountFromBooked - (parsed.qty * unitPrice)
        : (parsed.qty * unitPrice) - netTradeAmountFromBooked;

      // Saxo sometimes exports truncated trade prices. If computed fees become negative,
      // adjust unit price to the effective booked net and keep fees at 0.
      if (fees < 0) {
        unitPrice = netTradeAmountFromBooked / parsed.qty;
        fees = 0;
      }

      if (Math.abs(fees) < 0.0000001) fees = 0;

      const tradeCashAmount = action === "buy"
        ? (parsed.qty * unitPrice + fees)
        : (parsed.qty * unitPrice - fees);

      pushTx(transactions, {
        portfolio_id: portfolioId,
        date,
        type: action,
        ticker,
        quantity: parsed.qty,
        unit_price: unitPrice,
        fees,
        currency: tradeCurrency,
        _isin: isin,
        _instrument: instrument,
        _totalEUR: bookedAmountEUR,
      }, idx, 0);

      if (tradeCurrency !== "EUR" && Math.abs(tradeCashAmount) > 0.000001 && Math.abs(bookedAbsEUR) > 0.000001) {
        if (action === "buy") {
          // EUR -> trade currency, with target amount including trade fees
          pushTx(transactions, {
            portfolio_id: portfolioId,
            date,
            type: "conversion",
            ticker: "EUR",
            quantity: tradeCashAmount,
            unit_price: bookedAbsEUR / tradeCashAmount,
            fees: 0,
            currency: tradeCurrency,
            _isin: isin,
            _instrument: "Conversion auto achat",
            _totalEUR: 0,
          }, idx, 1);
        } else if (action === "sell") {
          // trade currency -> EUR, source amount is net trade proceeds after fees
          pushTx(transactions, {
            portfolio_id: portfolioId,
            date,
            type: "conversion",
            ticker: tradeCurrency,
            quantity: bookedAbsEUR,
            unit_price: tradeCashAmount / bookedAbsEUR,
            fees: 0,
            currency: "EUR",
            _isin: isin,
            _instrument: "Conversion auto vente",
            _totalEUR: 0,
          }, idx, 1);
        }
      }
      return;
    }

    skippedCount++;
  });

  transactions.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    const priority: Record<string, number> = {
      deposit: 0,
      withdrawal: 1,
      conversion: 2,
      buy: 3,
      sell: 4,
      dividend: 5,
      interest: 6,
      transfer_in: 7,
      transfer_out: 8,
    };
    const pa = priority[a.type] ?? 99;
    const pb = priority[b.type] ?? 99;
    return pa - pb;
  });

  let runningCashEur = 0;
  const negativeBalanceWarnings: Array<{ date: string; balance: number }> = [];
  for (const tx of transactions) {
    runningCashEur += tx._totalEUR || 0;
    if (runningCashEur < -0.01) {
      negativeBalanceWarnings.push({
        date: tx.date,
        balance: Math.round(runningCashEur * 100) / 100,
      });
    }
  }

  return {
    transactions,
    skippedCount,
    negativeBalanceWarnings,
  };
}
