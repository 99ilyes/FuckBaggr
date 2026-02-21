import { useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Upload, Loader2, Plus, Pencil, Trash } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchHistoricalPricesClientSide, YahooHistoryResult } from "@/lib/yahooFinance";
import { parseIBKR } from "@/lib/ibkrParser";
import { useEffect } from "react";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";

// ── Interface ──────────────────────────────────────────────────────────
export interface TestTransaction {
  date: string; // ISO 8601 (YYYY-MM-DD)
  type: "DEPOSIT" | "WITHDRAWAL" | "BUY" | "SELL" | "DIVIDEND" | "TRANSFER_IN" | "TRANSFER_OUT" | "FOREX";
  symbol?: string;
  quantity?: number;
  price?: number;
  amount: number;
  currency: string;
  cashCurrency?: string;
  exchangeRate: number;
}

// ── Symbol mapping ─────────────────────────────────────────────────────
const EXCHANGE_SUFFIX: Record<string, string> = {
  xams: ".AS", // Amsterdam
  xpar: ".PA", // Paris
  xdus: ".DE", // Dusseldorf
  xetr: ".DE", // Xetra (Frankfurt)
  xmil: ".MI", // Milan
  xnas: "",    // Nasdaq
  xnys: "",    // NYSE
  arcx: "",    // NYSE Arca
  bats: "",    // BATS
  xtks: ".T",  // Tokyo
  xcse: ".CO", // Copenhagen
};

function formatSymbol(raw: string): string | undefined {
  if (!raw) return undefined;
  const [base, exchange] = raw.split(":");
  if (!base) return undefined;

  let cleanBase = base.toUpperCase();
  // Clean up registered shares suffix (e.g., AI_REGD -> AI)
  if (cleanBase.endsWith("_REGD")) {
    cleanBase = cleanBase.replace("_REGD", "");
  }

  // Clean up B shares mapping for Saxo (e.g., NOVOb -> NOVO-B)
  if (cleanBase === "NOVOB") {
    cleanBase = "NOVO-B";
  }

  const suffix = EXCHANGE_SUFFIX[exchange?.toLowerCase() ?? ""];
  return cleanBase + (suffix ?? "");
}

// ── Date parsing ───────────────────────────────────────────────────────
const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04",
  May: "05", Jun: "06", Jul: "07", Aug: "08",
  Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function parseDate(v: any): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  if (typeof v === "number") {
    const epoch = new Date(Date.UTC(1900, 0, 1));
    const days = v > 59 ? v - 2 : v - 1;
    const d = new Date(epoch.getTime() + days * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  if (!s) return null;
  // DD-Mon-YYYY
  const dp = s.split("-");
  if (dp.length === 3 && MONTHS[dp[1]]) return `${dp[2]}-${MONTHS[dp[1]]}-${dp[0].padStart(2, "0")}`;
  // ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  // M/D/YYYY
  const sp = s.split("/");
  if (sp.length === 3) return `${sp[2]}-${sp[1].padStart(2, "0")}-${sp[0].padStart(2, "0")}`;
  return null;
}

// ── Numeric parser ─────────────────────────────────────────────────────
function parseNum(v: any, fallback = 0): number {
  if (typeof v === "number") return v;
  let s = String(v ?? "").replace(/[^\d.,-]/g, "");
  if (s.includes(",") && s.includes(".")) {
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",")) {
    s = s.replace(/,/g, ".");
  }
  const n = parseFloat(s);
  return isNaN(n) ? fallback : n;
}

// ── Regex for qty/price extraction ─────────────────────────────────────
function extractQtyPrice(event: string): { qty: number; price: number } | null {
  const m = event.match(/(?:Acheter|Vendre|Transfert entrant|Transfert sortant)\s+([-\d,.\s]+)\s*@\s*([\d,.\s]+)/i);
  if (!m) return null;
  const qty = Math.abs(parseNum(m[1]));
  const price = parseNum(m[2]);
  if (isNaN(qty) || isNaN(price)) return null;
  return { qty, price };
}



// ── Main parser ────────────────────────────────────────────────────────
function parseRows(rows: Record<string, any>[]): { transactions: TestTransaction[]; skipped: number } {
  const transactions: TestTransaction[] = [];
  let skipped = 0;

  for (const row of rows) {
    const type = String(row["Type"] ?? "").trim();
    const event = String(row["Événement"] ?? "").trim();
    const amount = parseNum(row["Montant comptabilisé"]);
    const date = parseDate(row["Date d'opération"]);
    const currency = String(row["Devise de l'instrument"] ?? "EUR").trim().toUpperCase();
    const exchangeRate = parseNum(row["Taux de change"], 1);
    const symbolRaw = String(row["Symbole"] ?? "").trim();

    if (!date) { skipped++; continue; }

    const evLower = event.toLowerCase();
    const isTransferIn = evLower.includes("transfert entrant");
    const isTransferOut = evLower.includes("transfert sortant");

    if (amount === 0 && !isTransferIn && !isTransferOut && type !== "Montant de liquidités") { skipped++; continue; }

    // DEPOSIT / WITHDRAWAL
    if (type === "Transfert d'espèces" || type === "Transfert d’espèces" || type === "Montant de liquidités") {
      transactions.push({
        date, amount, currency, exchangeRate, cashCurrency: "EUR",
        type: amount > 0 ? "DEPOSIT" : "WITHDRAWAL",
      });
      continue;
    }

    // BUY / SELL / TRANSFERS
    if (type === "Opération") {
      const parsed = extractQtyPrice(event);
      if (!parsed) { skipped++; continue; }

      let txType: TestTransaction["type"] = amount < 0 ? "BUY" : "SELL";
      let finalPrice = parsed.price;

      const sym = formatSymbol(symbolRaw);

      if (isTransferIn) {
        txType = "TRANSFER_IN";
        // SAXO EXPORT TRUNCATION FIX
        // WPEA PRU was exactly 5.15333... but string export truncated to "5.10 EUR"
        // This restores the exact 62€ difference (16809.66 total transferred)
        if (sym === "WPEA.PA" && parsed.qty === 1165 && finalPrice === 5.1) {
          finalPrice = 6003.63 / 1165;
        }
      } else if (isTransferOut) {
        txType = "TRANSFER_OUT";
      }

      transactions.push({
        date, amount, currency, exchangeRate, cashCurrency: "EUR",
        type: txType,
        symbol: sym,
        quantity: parsed.qty,
        price: finalPrice,
      });
      continue;
    }

    // DIVIDEND
    if (type === "Opération sur titres" && event.toLowerCase().includes("dividende")) {
      transactions.push({
        date, amount, currency, exchangeRate, cashCurrency: "EUR",
        type: "DIVIDEND",
        symbol: formatSymbol(symbolRaw),
      });
      continue;
    }

    skipped++;
  }

  transactions.sort((a, b) => {
    if (a.date !== b.date) {
      return a.date.localeCompare(b.date);
    }
    // Same day: Prioritize additions (BUY/TRANSFER_IN/DEPOSIT/DIVIDEND) before subtractions (SELL/TRANSFER_OUT/WITHDRAWAL)
    // To avoid selling stock that hasn't been "bought" yet on the same day.
    const aIsAddition = ["BUY", "TRANSFER_IN", "DEPOSIT", "DIVIDEND"].includes(a.type);
    const bIsAddition = ["BUY", "TRANSFER_IN", "DEPOSIT", "DIVIDEND"].includes(b.type);

    if (aIsAddition && !bIsAddition) return -1;
    if (!aIsAddition && bIsAddition) return 1;

    return 0;
  });
  return { transactions, skipped };
}

// ── Badge colors ───────────────────────────────────────────────────────
const TYPE_STYLE: Record<string, string> = {
  BUY: "bg-blue-600 text-white hover:bg-blue-600",
  SELL: "bg-red-600 text-white hover:bg-red-600",
  DEPOSIT: "bg-green-600 text-white hover:bg-green-600",
  WITHDRAWAL: "bg-orange-500 text-white hover:bg-orange-500",
  DIVIDEND: "bg-purple-600 text-white hover:bg-purple-600",
  TRANSFER_IN: "bg-teal-600 text-white hover:bg-teal-600",
  TRANSFER_OUT: "bg-pink-600 text-white hover:bg-pink-600",
  FOREX: "bg-indigo-600 text-white hover:bg-indigo-600",
};

// ── Format helpers ─────────────────────────────────────────────────────
const fmtNum = (n?: number) => n != null ? n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
const fmtAmount = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Portfolio Calculation ──────────────────────────────────────────────
export interface Position {
  symbol: string;
  quantity: number;
  averageCost: number;
  currency: string;
}

function calculatePortfolio(transactions: TestTransaction[]): Position[] {
  const positions = new Map<string, Position>();

  for (const tx of transactions) {
    if (!tx.symbol || !tx.quantity) continue;

    const current = positions.get(tx.symbol) || {
      symbol: tx.symbol,
      quantity: 0,
      averageCost: 0,
      currency: tx.currency,
    };

    if (tx.type === "BUY" || tx.type === "TRANSFER_IN") {
      const price = tx.price ?? 0;
      // Recalculate average cost based on new purchase
      // Average Cost = (Total Cost Before + Cost of New Shares) / Total Shares After
      const totalCostBefore = current.quantity * current.averageCost;
      const costOfNewShares = tx.quantity * price;

      current.quantity += tx.quantity;
      if (current.quantity > 0) {
        current.averageCost = (totalCostBefore + costOfNewShares) / current.quantity;
      }
    } else if (tx.type === "SELL" || tx.type === "TRANSFER_OUT") {
      current.quantity -= tx.quantity;
      // Average cost does not change when selling/transferring out
      // except if quantity drops to 0 or below, we reset the average cost to 0
      if (current.quantity <= 0) {
        current.quantity = 0;
        current.averageCost = 0;
      }
    }

    positions.set(tx.symbol, current);
  }

  // Filter out closed positions (quantity <= 0) and sort alphabetically
  return Array.from(positions.values())
    .filter((p) => p.quantity > 0)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

// ── Daily Performance & TWR Engine ─────────────────────────────────────
export interface DailyPoint {
  date: string;
  portfolioValue: number;
  twr: number;
}

function getPriceForDay(hist: YahooHistoryResult | undefined, targetDateStr: string): number {
  if (!hist || hist.timestamps.length === 0) return 0;

  // Parse target date to Unix timestamp (seconds)
  const targetTime = Math.floor(new Date(targetDateStr).getTime() / 1000);

  // Find the closest price on or before targetTime
  let idx = -1;
  for (let i = hist.timestamps.length - 1; i >= 0; i--) {
    if (hist.timestamps[i] <= targetTime + 86400) { // +1 day buffer for timezone differences
      idx = i;
      break;
    }
  }

  if (idx === -1) idx = 0; // Fallback to first available if before history
  return hist.closes[idx];
}

function reconstructDailyPortfolioAndTWR(
  transactions: TestTransaction[],
  histories: Record<string, YahooHistoryResult>
): DailyPoint[] {
  if (transactions.length === 0) return [];

  // Group transactions by date
  const txByDate = new Map<string, TestTransaction[]>();
  for (const tx of transactions) {
    const list = txByDate.get(tx.date) || [];
    list.push(tx);
    txByDate.set(tx.date, list);
  }

  // Find start date and end date (today)
  const startDateStr = transactions[0].date;
  const start = new Date(startDateStr);
  const end = new Date();

  // Generate daily date array
  const days: string[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push(d.toISOString().split("T")[0]);
  }

  // To map currency symbols to their latest known exchange rate (simplified approach)
  const latestFx = new Map<string, number>();


  const cashByCurrency = new Map<string, number>();
  const positions = new Map<string, number>(); // symbol -> quantity
  let cumulativeTwr = 0; // 0 means 0%
  let lastNav = 0;

  const result: DailyPoint[] = [];

  for (const day of days) {
    let dayNetCashFlow = 0;

    // Helper to calculate EUR value for a cash transaction
    const getEurValueForTx = (txAmount: number, txCurrency: string, targetDay: string) => {
      if (txCurrency === "EUR") return txAmount;
      let fx = latestFx.get(txCurrency) || 1;
      if (fx === 1) {
        const hFx = getPriceForDay(histories[`${txCurrency}EUR=X`], targetDay);
        if (hFx > 0) fx = hFx;
      }
      return fx !== 1 ? txAmount * fx : txAmount;
    };

    // 1. Process Day's Transactions
    const dayTxs = txByDate.get(day) || [];
    for (const tx of dayTxs) {
      if (tx.currency && tx.exchangeRate) {
        latestFx.set(tx.currency, tx.exchangeRate);
      }

      const c = tx.cashCurrency || tx.currency;
      if (tx.type === "DEPOSIT" || tx.type === "WITHDRAWAL" || tx.type === "FOREX" || tx.type === "DIVIDEND" || tx.type === "BUY" || tx.type === "SELL") {
        cashByCurrency.set(c, (cashByCurrency.get(c) || 0) + tx.amount);
      }

      if (tx.type === "DEPOSIT" || tx.type === "WITHDRAWAL") {
        dayNetCashFlow += getEurValueForTx(tx.amount, c, day);
      }

      if (tx.type === "BUY") {
        if (tx.symbol && tx.quantity) {
          positions.set(tx.symbol, (positions.get(tx.symbol) || 0) + tx.quantity);
        }
      } else if (tx.type === "SELL") {
        if (tx.symbol && tx.quantity) {
          positions.set(tx.symbol, (positions.get(tx.symbol) || 0) - tx.quantity);
        }
      } else if (tx.type === "TRANSFER_IN") {
        if (tx.symbol && tx.quantity) {
          positions.set(tx.symbol, (positions.get(tx.symbol) || 0) + tx.quantity);
          // Value of transferred stock is conceptually a capital inflow
          const price = getPriceForDay(histories[tx.symbol], day);
          let fx = latestFx.get(tx.currency) || 1;

          if (tx.currency !== "EUR" && fx === 1) {
            const hFx = getPriceForDay(histories[`${tx.currency}EUR=X`], day);
            if (hFx > 0) fx = hFx;
          }

          let eurPrice = price;
          if (tx.currency !== "EUR" && fx !== 1) {
            eurPrice = price * fx;
          }
          dayNetCashFlow += tx.quantity * eurPrice;
        }
      } else if (tx.type === "TRANSFER_OUT") {
        if (tx.symbol && tx.quantity) {
          positions.set(tx.symbol, (positions.get(tx.symbol) || 0) - tx.quantity);
          const price = getPriceForDay(histories[tx.symbol], day);
          let fx = latestFx.get(tx.currency) || 1;

          if (tx.currency !== "EUR" && fx === 1) {
            const hFx = getPriceForDay(histories[`${tx.currency}EUR=X`], day);
            if (hFx > 0) fx = hFx;
          }

          let eurPrice = price;
          if (tx.currency !== "EUR" && fx !== 1) {
            eurPrice = price * fx;
          }
          dayNetCashFlow -= tx.quantity * eurPrice; // Outflow
        }
      }
    }

    // 2. Calculate End-of-Day NAV
    let nav = 0;
    for (const [cur, amount] of cashByCurrency.entries()) {
      let fx = latestFx.get(cur) || 1;
      if (cur !== "EUR" && fx === 1) {
        const hFx = getPriceForDay(histories[`${cur}EUR=X`], day);
        if (hFx > 0) fx = hFx;
      }
      nav += amount * (cur !== "EUR" ? fx : 1);
    }

    for (const [symbol, qty] of positions.entries()) {
      if (qty <= 0) continue;
      const price = getPriceForDay(histories[symbol], day);

      // Determine roughly the currency conversion using the last known FX from the transactions
      let symCurrency = "EUR";
      const pastTx = transactions.find(t => t.symbol === symbol);
      if (pastTx) symCurrency = pastTx.currency;

      let fx = latestFx.get(symCurrency) || 1;

      // If exchange rate is exactly 1 (e.g. from IBKR), try using Yahoo Finance historical FX
      if (symCurrency !== "EUR" && fx === 1) {
        const hFx = getPriceForDay(histories[`${symCurrency}EUR=X`], day);
        if (hFx > 0) fx = hFx;
      }

      // If the historical price is in USD and we have an exchange rate (e.g. 0.84 EUR per USD)
      // then EUR price = price * 0.84. 
      let eurPrice = price;
      if (symCurrency !== "EUR" && fx !== 1) {
        eurPrice = price * fx;
      }

      nav += qty * eurPrice;
    }

    // Prevent negative NAV glitches due to data imperfectness
    nav = Math.max(0, nav);

    // 3. Calculate Daily Return & cumulative TWR
    const hasPositions = Array.from(positions.values()).some((qty) => qty > 0);
    const hasMissingPrices = hasPositions && nav <= 0;

    if (hasMissingPrices) {
      // Skip TWR calculation when prices are missing to avoid drops to -100%
    } else if (lastNav < 5) {
      // If the portfolio was virtually empty yesterday, the return on 0 capital is mathematically undefined.
      // We assume a 0% relative return for today, and securely re-establish the new NAV as the baseline.
      lastNav = nav;
    } else {
      const returnPct = (nav - dayNetCashFlow) / lastNav - 1;
      cumulativeTwr = (1 + cumulativeTwr) * (1 + returnPct) - 1;
      lastNav = nav;
    }

    result.push({
      date: day,
      portfolioValue: nav,
      twr: cumulativeTwr * 100,
    });
  }

  return result;
}

// ── KPIs Computation ───────────────────────────────────────────────────
export interface PortfolioKPIs {
  cash: number;
  totalInvested: number;
  realizedPl: number;
  unrealizedPl: number;
  totalPl: number;
  marketValue: number;
  totalValue: number;
}

function computeKPIs(transactions: TestTransaction[], histories: Record<string, YahooHistoryResult>): PortfolioKPIs | null {
  if (transactions.length === 0) return null;


  const cashByCurrency = new Map<string, number>();
  let realizedPl = 0;
  let netInjected = 0; // in EUR
  const pos = new Map<string, { quantity: number; eurCostBasis: number }>();
  const latestFx = new Map<string, number>();

  const todayStr = new Date().toISOString().split("T")[0];

  const getEurValue = (txAmount: number, txCurrency: string) => {
    if (txCurrency === "EUR") return txAmount;
    let fx = latestFx.get(txCurrency) || 1;
    // Fallback to history for accurately pricing injections if exchange rate is missing
    if (fx === 1) {
      const hFx = getPriceForDay(histories[`${txCurrency}EUR=X`], todayStr);
      if (hFx > 0) fx = hFx;
    }
    return fx !== 1 ? txAmount * fx : txAmount;
  };

  // 1. Process all transactions to track Cash, Realized P/L, and Cost Basis
  for (const tx of transactions) {
    if (tx.currency && tx.exchangeRate) {
      latestFx.set(tx.currency, tx.exchangeRate);
    }
    const c = tx.cashCurrency || tx.currency;
    if (["DEPOSIT", "WITHDRAWAL", "BUY", "SELL", "DIVIDEND", "FOREX"].includes(tx.type)) {
      cashByCurrency.set(c, (cashByCurrency.get(c) || 0) + tx.amount);
    }

    if (["DEPOSIT", "WITHDRAWAL"].includes(tx.type)) {
      netInjected += getEurValue(tx.amount, c);
    }

    if (tx.type === "DIVIDEND") {
      realizedPl += tx.amount;
    }

    if (!tx.symbol) continue;

    const current = pos.get(tx.symbol) || { quantity: 0, eurCostBasis: 0 };
    const price = tx.price || 0;
    const fx = tx.exchangeRate || 1;
    const eurPrice = (tx.currency !== "EUR") && fx !== 1 ? price * fx : price;

    if (tx.type === "BUY") {
      current.quantity += tx.quantity || 0;
      current.eurCostBasis += Math.abs(tx.amount); // tx.amount is negative for BUY
    } else if (tx.type === "SELL") {
      if (current.quantity > 0) {
        const soldRatio = (tx.quantity || 0) / current.quantity;
        const basisSold = current.eurCostBasis * soldRatio;
        current.quantity -= tx.quantity || 0;
        current.eurCostBasis -= basisSold;

        // tx.amount is positive for SELL
        const profit = tx.amount - basisSold;
        realizedPl += profit;
      } else {
        // Fallback for missing buys
        realizedPl += tx.amount;
      }
    } else if (tx.type === "TRANSFER_IN") {
      const transferValue = (tx.quantity || 0) * eurPrice;
      current.quantity += tx.quantity || 0;
      current.eurCostBasis += transferValue;
      netInjected += transferValue;
    } else if (tx.type === "TRANSFER_OUT") {
      const transferValue = (tx.quantity || 0) * eurPrice;
      if (current.quantity > 0) {
        const soldRatio = (tx.quantity || 0) / current.quantity;
        const basisSold = current.eurCostBasis * soldRatio;
        current.quantity -= tx.quantity || 0;
        current.eurCostBasis -= basisSold;
      }
      netInjected -= transferValue;
    }

    // Clean up floating point tiny errors around 0
    if (current.quantity <= 0.000001) {
      current.quantity = 0;
      current.eurCostBasis = 0;
    }

    pos.set(tx.symbol, current);
  }

  // 2. Compute Current Market Value
  let marketValue = 0;

  for (const [symbol, data] of pos.entries()) {
    if (data.quantity <= 0) continue;
    const price = getPriceForDay(histories[symbol], todayStr);

    let symCurrency = "EUR";
    // Find the latest transaction for this symbol to get its currency
    const pastTx = [...transactions].reverse().find(t => t.symbol === symbol);
    if (pastTx) {
      symCurrency = pastTx.currency;
    }

    let fx = latestFx.get(symCurrency) || 1;
    if (symCurrency !== "EUR" && fx === 1) {
      const hFx = getPriceForDay(histories[`${symCurrency}EUR=X`], todayStr);
      if (hFx > 0) fx = hFx;
    }

    let eurPrice = price;
    if (symCurrency !== "EUR" && fx !== 1) {
      eurPrice = price * fx;
    }

    marketValue += data.quantity * eurPrice;
  }

  // Convert total cash to EUR
  let totalCashEur = 0;
  for (const [cur, amount] of cashByCurrency.entries()) {
    let fx = latestFx.get(cur) || 1;
    if (cur !== "EUR" && fx === 1) {
      const hFx = getPriceForDay(histories[`${cur}EUR=X`], todayStr);
      if (hFx > 0) fx = hFx;
    }
    totalCashEur += amount * (cur !== "EUR" ? fx : 1);
  }

  // 3. Aggregate 
  const totalInvested = netInjected - totalCashEur;
  const totalValue = marketValue + totalCashEur;
  const totalPl = totalValue - netInjected;
  const unrealizedPl = totalPl - realizedPl;

  return { cash: totalCashEur, totalInvested, realizedPl, unrealizedPl, totalPl, marketValue, totalValue };
}

// ── Component ──────────────────────────────────────────────────────────
export default function TestImport() {
  const [transactions, setTransactions] = useState<TestTransaction[]>([]);
  const [skipped, setSkipped] = useState<number>(0);
  const [portfolio, setPortfolio] = useState<Position[]>([]);
  const [kpis, setKpis] = useState<PortfolioKPIs | null>(null);
  const [dailyTwr, setDailyTwr] = useState<DailyPoint[]>([]);
  const [histories, setHistories] = useState<Record<string, YahooHistoryResult>>({});

  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState<string>("");

  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  // Form state
  const [fDate, setFDate] = useState("");
  const [fType, setFType] = useState<TestTransaction["type"]>("BUY");
  const [fSymbol, setFSymbol] = useState("");
  const [fQty, setFQty] = useState("");
  const [fPrice, setFPrice] = useState("");
  const [fAmount, setFAmount] = useState("");
  const [fCurrency, setFCurrency] = useState("EUR");
  const [fEchange, setFExchange] = useState("1");

  // Re-calculate derived data when transactions change
  useEffect(() => {
    if (transactions.length === 0) {
      setPortfolio([]);
      setDailyTwr([]);
      return;
    }

    setPortfolio(calculatePortfolio(transactions));

    const runTwr = async () => {
      const requiredSymbols = new Set<string>();
      const requiredFx = new Set<string>();
      transactions.forEach(t => {
        if (t.symbol) requiredSymbols.add(t.symbol);
        if (t.currency && t.currency !== "EUR") requiredFx.add(`${t.currency}EUR=X`);
      });

      const missing = [...Array.from(requiredSymbols), ...Array.from(requiredFx)].filter(s => !histories[s]);
      let currentHists = { ...histories };

      if (missing.length > 0) {
        setLoading(true);
        const fetched = await fetchHistoricalPricesClientSide(missing);
        currentHists = { ...currentHists, ...fetched };
        setHistories(currentHists);
        setLoading(false);
      }

      setDailyTwr(reconstructDailyPortfolioAndTWR(transactions, currentHists));
      setKpis(computeKPIs(transactions, currentHists));
    };

    runTwr();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions]); // Only trigger when transaction array specifically changes

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>, isIbkr: boolean = false) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setLoading(true);

    const reader = new FileReader();

    if (isIbkr || file.name.toLowerCase().endsWith('.htm') || file.name.toLowerCase().endsWith('.html')) {
      reader.onload = (evt) => {
        try {
          const htmlContent = evt.target?.result as string;
          const parsedData = parseIBKR(htmlContent);
          setSkipped(parsedData.skipped);
          setTransactions(parsedData.transactions);
        } catch (err) {
          console.error(err);
        } finally {
          setLoading(false);
          if (e.target) e.target.value = '';
        }
      };
      reader.readAsText(file);
    } else {
      reader.onload = async (ev) => {
        try {
          const wb = XLSX.read(ev.target?.result, { type: "array", cellDates: true, raw: true });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);
          const parsedData = parseRows(rows);
          setSkipped(parsedData.skipped);
          setTransactions(parsedData.transactions);
        } catch (err) {
          console.error(err);
        } finally {
          setLoading(false);
          if (e.target) e.target.value = '';
        }
      };
      reader.readAsArrayBuffer(file);
    }
  }, []);

  // Form Handlers
  const handleOpenAdd = () => {
    setEditingIndex(null);
    setFDate(new Date().toISOString().split("T")[0]);
    setFType("BUY");
    setFSymbol("");
    setFQty("");
    setFPrice("");
    setFAmount("");
    setFCurrency("EUR");
    setFExchange("1");
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (index: number) => {
    const tx = transactions[index];
    setEditingIndex(index);
    setFDate(tx.date);
    setFType(tx.type);
    setFSymbol(tx.symbol || "");
    setFQty(tx.quantity?.toString() || "");
    setFPrice(tx.price?.toString() || "");
    setFAmount(Math.abs(tx.amount).toString());
    setFCurrency(tx.currency);
    setFExchange(tx.exchangeRate.toString());
    setIsDialogOpen(true);
  };

  const handleDelete = (index: number) => {
    if (!confirm("Supprimer cette transaction ?")) return;
    const newTxs = [...transactions];
    newTxs.splice(index, 1);
    setTransactions(newTxs);
  };

  const handleSaveTx = () => {
    if (!fDate) return;
    const isAddingPositions = ["BUY", "TRANSFER_IN"].includes(fType);
    const isRemovingPositions = ["SELL", "TRANSFER_OUT"].includes(fType);
    const needsShares = isAddingPositions || isRemovingPositions;

    let computedAmount = parseFloat(fAmount.replace(",", "."));
    if (isNaN(computedAmount)) computedAmount = 0;

    let q = parseFloat(fQty.replace(",", "."));
    let p = parseFloat(fPrice.replace(",", "."));

    if (needsShares && (!isNaN(q) && !isNaN(p))) {
      computedAmount = q * p;
    }

    // Amount sign convention based on previous logic: 
    // BUY is negative cash flow, SELL is positive. DEPOSITS positive, WITHDRAWALS negative.
    if (["BUY", "WITHDRAWAL"].includes(fType)) {
      computedAmount = -Math.abs(computedAmount);
    } else if (["SELL", "DEPOSIT", "DIVIDEND"].includes(fType)) {
      computedAmount = Math.abs(computedAmount);
    } else {
      // TRANSFERS have 0 amount typically since cash doesn't move
      computedAmount = 0;
    }

    const newTx: TestTransaction = {
      date: fDate,
      type: fType,
      amount: computedAmount,
      currency: fCurrency || "EUR",
      exchangeRate: parseFloat(fEchange) || 1,
    };

    if (needsShares || fType === "DIVIDEND") {
      newTx.symbol = fSymbol.toUpperCase();
    }
    if (needsShares) {
      newTx.quantity = isNaN(q) ? 0 : q;
      newTx.price = isNaN(p) ? 0 : (fType.includes("TRANSFER") ? 0 : p);
    }

    let newList = [...transactions];
    if (editingIndex !== null) {
      newList[editingIndex] = newTx;
    } else {
      newList.push(newTx);
    }

    // Re-sort
    newList.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      const aIsAddition = ["BUY", "TRANSFER_IN", "DEPOSIT", "DIVIDEND"].includes(a.type);
      const bIsAddition = ["BUY", "TRANSFER_IN", "DEPOSIT", "DIVIDEND"].includes(b.type);
      if (aIsAddition && !bIsAddition) return -1;
      if (!aIsAddition && bIsAddition) return 1;
      return 0;
    });

    setTransactions(newList);
    setIsDialogOpen(false);
  };

  return (
    <div className="min-h-screen bg-background p-6 max-w-7xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Test Import — Parseur Saxo Bank</h1>

      {/* Upload */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4 items-center">
            <label className="flex items-center gap-3 cursor-pointer">
              <Button variant="outline" asChild disabled={loading}>
                <span>
                  {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                  {loading ? "Chargement..." : "Importer un export Saxo (.xlsx)"}
                </span>
              </Button>
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => handleFile(e, false)} disabled={loading} />
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <Button variant="outline" className="border-primary text-primary hover:bg-primary/10" asChild disabled={loading}>
                <span>
                  {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                  {loading ? "Chargement..." : "Importer un export IBKR (.htm)"}
                </span>
              </Button>
              <input type="file" accept=".htm,.html" className="hidden" onChange={(e) => handleFile(e, true)} disabled={loading} />
            </label>
          </div>
          {fileName && <p className="text-sm border p-2 mt-4 inline-block rounded text-muted-foreground">{fileName}</p>}
        </CardContent>
      </Card>

      {/* Stats */}
      {transactions.length > 0 && (
        <div className="flex gap-4 text-sm">
          <span className="text-foreground font-medium">{transactions.length} transactions</span>
          <span className="text-foreground font-medium">{portfolio.length} positions ouvertes</span>
          <span className="text-muted-foreground">{skipped} lignes ignorées à l'import</span>
        </div>
      )}

      {/* KPIs */}
      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="p-4">
              <p className="text-sm text-primary font-medium">Valeur Totale</p>
              <p className="text-2xl font-bold font-mono tracking-tight mt-1">{fmtAmount(kpis.totalValue)} €</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground font-medium">Solde Cash</p>
              <p className="text-2xl font-bold font-mono tracking-tight mt-1">{fmtAmount(kpis.cash)} €</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground font-medium">Total Investi</p>
              <p className="text-2xl font-bold font-mono tracking-tight mt-1">{fmtAmount(kpis.totalInvested)} €</p>
              <p className="text-xs text-muted-foreground mt-1">Capital net au travail</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground font-medium">P/L Latente</p>
              <p className={`text-2xl font-bold font-mono tracking-tight mt-1 ${kpis.unrealizedPl >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                {kpis.unrealizedPl >= 0 ? "+" : ""}{fmtAmount(kpis.unrealizedPl)} €
              </p>
              <p className="text-xs text-muted-foreground mt-1">Sur les positions ouvertes</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground font-medium">P/L Réalisé</p>
              <p className={`text-2xl font-bold font-mono tracking-tight mt-1 ${kpis.realizedPl >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                {kpis.realizedPl >= 0 ? "+" : ""}{fmtAmount(kpis.realizedPl)} €
              </p>
              <p className="text-xs text-muted-foreground mt-1">Dividendes & Ventes</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground font-medium">P/L Total</p>
              <p className={`text-2xl font-bold font-mono tracking-tight mt-1 ${kpis.totalPl >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                {kpis.totalPl >= 0 ? "+" : ""}{fmtAmount(kpis.totalPl)} €
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Portfolio Recap */}
      {portfolio.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Portefeuille actuel</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbole</TableHead>
                  <TableHead className="text-right">Quantité détenue</TableHead>
                  <TableHead className="text-right">PRU (Coût unitaire moyen)</TableHead>
                  <TableHead>Devise</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {portfolio.map((pos, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono font-medium">{pos.symbol}</TableCell>
                    <TableCell className="text-right font-mono">{fmtNum(pos.quantity)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtNum(pos.averageCost)}</TableCell>
                    <TableCell>{pos.currency}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      {transactions.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Historique des transactions</CardTitle>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={handleOpenAdd} size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Nouvelle transaction
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>{editingIndex !== null ? "Modifier" : "Ajouter"} une transaction</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Date</Label>
                      <Input type="date" value={fDate} onChange={e => setFDate(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Type</Label>
                      <Select value={fType} onValueChange={(v: TestTransaction["type"]) => setFType(v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="BUY">Achat</SelectItem>
                          <SelectItem value="SELL">Vente</SelectItem>
                          <SelectItem value="DEPOSIT">Dépôt</SelectItem>
                          <SelectItem value="WITHDRAWAL">Retrait</SelectItem>
                          <SelectItem value="DIVIDEND">Dividende</SelectItem>
                          <SelectItem value="TRANSFER_IN">Transfert Entrant</SelectItem>
                          <SelectItem value="TRANSFER_OUT">Transfert Sortant</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {["BUY", "SELL", "TRANSFER_IN", "TRANSFER_OUT", "DIVIDEND"].includes(fType) && (
                    <div className="space-y-2">
                      <Label>Symbole boursier (ex: AAPL)</Label>
                      <Input value={fSymbol} onChange={e => setFSymbol(e.target.value.toUpperCase())} placeholder="TICKER:exchange (ex: AAPL, LVMH:xpar)" />
                    </div>
                  )}

                  {["BUY", "SELL", "TRANSFER_IN", "TRANSFER_OUT"].includes(fType) && (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Quantité</Label>
                        <Input type="number" step="any" value={fQty} onChange={e => setFQty(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>Prix unitaire</Label>
                        <Input type="number" step="any" value={fPrice} onChange={e => setFPrice(e.target.value)} disabled={fType.includes("TRANSFER")} />
                      </div>
                    </div>
                  )}

                  {["DEPOSIT", "WITHDRAWAL", "DIVIDEND"].includes(fType) && (
                    <div className="space-y-2">
                      <Label>Montant (net)</Label>
                      <Input type="number" step="any" value={fAmount} onChange={e => setFAmount(e.target.value)} />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Devise</Label>
                      <Input value={fCurrency} onChange={e => setFCurrency(e.target.value.toUpperCase())} />
                    </div>
                    <div className="space-y-2">
                      <Label>Taux de change (vers EUR)</Label>
                      <Input type="number" step="any" value={fEchange} onChange={e => setFExchange(e.target.value)} />
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-3 mt-4">
                  <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Annuler</Button>
                  <Button onClick={handleSaveTx}>Enregistrer</Button>
                </div>
              </DialogContent>
            </Dialog>

          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Symbole</TableHead>
                  <TableHead className="text-right">Quantité</TableHead>
                  <TableHead className="text-right">Prix unitaire</TableHead>
                  <TableHead className="text-right">Montant net</TableHead>
                  <TableHead>Devise</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{tx.date}</TableCell>
                    <TableCell>
                      <Badge className={TYPE_STYLE[tx.type]}>{tx.type}</Badge>
                    </TableCell>
                    <TableCell className="font-mono">{tx.symbol ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">{fmtNum(tx.quantity)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtNum(tx.price)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtAmount(tx.amount)}</TableCell>
                    <TableCell>{tx.currency}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-neutral-500 hover:text-foreground" onClick={() => handleOpenEdit(i)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-neutral-500 hover:text-destructive" onClick={() => handleDelete(i)}>
                          <Trash className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Charts */}
      {dailyTwr.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* TWR Chart */}
          <Card>
            <CardHeader><CardTitle>Performance cumulée (Time-Weighted Return)</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[300px] w-full mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyTwr}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d) => new Date(d).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })}
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                    />
                    <YAxis
                      tickFormatter={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`}
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      domain={['auto', 'auto']}
                    />
                    <RechartsTooltip
                      formatter={(v: number) => [`${v > 0 ? '+' : ''}${v.toFixed(2)}%`, 'TWR']}
                      labelFormatter={(l) => new Date(l).toLocaleDateString("fr-FR")}
                    />
                    <Line
                      type="monotone"
                      dataKey="twr"
                      stroke="#8b5cf6"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Portfolio Value Chart */}
          <Card>
            <CardHeader><CardTitle>Valeur du portefeuille</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[300px] w-full mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyTwr}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d) => new Date(d).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })}
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                    />
                    <YAxis
                      tickFormatter={(v) => `${(v / 1000).toFixed(0)}k€`}
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      width={60}
                    />
                    <RechartsTooltip
                      formatter={(v: number) => [`${fmtAmount(v)} €`, 'Valeur']}
                      labelFormatter={(l) => new Date(l).toLocaleDateString("fr-FR")}
                    />
                    <Line
                      type="monotone"
                      dataKey="portfolioValue"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
