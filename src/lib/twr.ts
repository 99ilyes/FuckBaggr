/**
 * Time-Weighted Return (TWR) calculation library
 *
 * TWR neutralises the impact of cash flows (deposits/withdrawals) to measure
 * only the manager's investment performance. Sub-periods are chained:
 *   TWR = (1 + R1) × (1 + R2) × ... × (1 + Rn) - 1
 *
 * All values are converted to EUR using historical FX rates.
 */

import { Transaction } from "@/hooks/usePortfolios";
import { AssetHistory } from "@/hooks/usePortfolios";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TWRDataPoint {
  /** Unix timestamp in seconds (start of week) */
  time: number;
  /** ISO date string for display */
  date: string;
  /** Portfolio value in EUR */
  valueEUR: number;
  /** Cumulative TWR as a decimal (0.15 = +15%) */
  twr: number;
  /** Net cash flows (deposits - withdrawals) in EUR for this period */
  netFlow: number;
}

export interface PortfolioTWRResult {
  portfolioId: string;
  portfolioName: string;
  color: string;
  dataPoints: TWRDataPoint[];
  totalTWR: number;
  annualisedTWR: number;
  currentValueEUR: number;
  totalInvestedEUR: number;
}

// ─── FX helpers ───────────────────────────────────────────────────────────────

/**
 * Returns the FX ticker needed to convert `currency` → EUR.
 * EUR is the base; if currency is already EUR, return null.
 */
export function getFxTicker(currency: string): string | null {
  const upper = currency.toUpperCase();
  if (upper === "EUR") return null;
  // Yahoo uses USDEUR=X to get how many EUR per 1 USD
  return `${upper}EUR=X`;
}

/**
 * Given the historical prices map and a list of currencies, return the set of
 * FX tickers that must also be fetched.
 */
export function getRequiredFxTickers(currencies: string[]): string[] {
  const set = new Set<string>();
  for (const c of currencies) {
    const fx = getFxTicker(c);
    if (fx) set.add(fx);
  }
  return Array.from(set);
}

// ─── Price lookup helpers ─────────────────────────────────────────────────────

/**
 * Build a lookup map: ticker → sorted array of { time, price }.
 */
export function buildPriceLookup(
  historyMap: Record<string, AssetHistory>
): Record<string, { time: number; price: number }[]> {
  const out: Record<string, { time: number; price: number }[]> = {};
  for (const [ticker, asset] of Object.entries(historyMap)) {
    out[ticker] = [...asset.history].sort((a, b) => a.time - b.time);
  }
  return out;
}

/**
 * Forward-fill lookup: returns the last known price at or before `timestamp`.
 * Returns null if no price is available before `timestamp`.
 */
export function getPriceAt(
  sorted: { time: number; price: number }[],
  timestamp: number
): number | null {
  if (!sorted || sorted.length === 0) return null;
  let last: number | null = null;
  for (const p of sorted) {
    if (p.time <= timestamp) {
      last = p.price;
    } else {
      break;
    }
  }
  return last;
}

/**
 * Convert an amount in `currency` to EUR using historical FX rates.
 * Falls back to 1:1 if no FX data available.
 */
export function toEUR(
  amount: number,
  currency: string,
  timestamp: number,
  priceLookup: Record<string, { time: number; price: number }[]>
): number {
  if (!currency || currency.toUpperCase() === "EUR") return amount;
  const fxTicker = getFxTicker(currency);
  if (!fxTicker) return amount;
  const fxSeries = priceLookup[fxTicker];
  if (!fxSeries) return amount; // fallback: no conversion
  const rate = getPriceAt(fxSeries, timestamp);
  if (rate === null) return amount; // fallback
  return amount * rate;
}

// ─── Portfolio state replay ───────────────────────────────────────────────────

interface PositionState {
  quantity: number;
  currency: string;
}

interface PortfolioState {
  positions: Record<string, PositionState>;
  /** Cash balances per currency */
  cash: Record<string, number>;
}

/**
 * Replay all transactions up to (and including) `upToTimestamp` to get the
 * portfolio state at that point in time.
 */
function replayTransactions(
  transactions: Transaction[],
  upToTimestamp: number // seconds
): PortfolioState {
  const state: PortfolioState = { positions: {}, cash: {} };

  const sorted = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  for (const tx of sorted) {
    const txTime = new Date(tx.date).getTime() / 1000;
    if (txTime > upToTimestamp) break;

    const currency = tx.currency ?? "EUR";
    const amount = (tx.quantity ?? 0) * (tx.unit_price ?? 0);

    switch (tx.type) {
      case "buy": {
        const ticker = tx.ticker!;
        if (!state.positions[ticker]) {
          state.positions[ticker] = { quantity: 0, currency };
        }
        state.positions[ticker].quantity += tx.quantity ?? 0;
        // Cash outflow
        state.cash[currency] = (state.cash[currency] ?? 0) - amount - (tx.fees ?? 0);
        break;
      }
      case "sell": {
        const ticker = tx.ticker!;
        if (state.positions[ticker]) {
          state.positions[ticker].quantity -= tx.quantity ?? 0;
          if (state.positions[ticker].quantity <= 0) {
            delete state.positions[ticker];
          }
        }
        // Cash inflow
        state.cash[currency] = (state.cash[currency] ?? 0) + amount - (tx.fees ?? 0);
        break;
      }
      case "deposit": {
        state.cash[currency] = (state.cash[currency] ?? 0) + (tx.unit_price ?? 0);
        break;
      }
      case "withdrawal": {
        state.cash[currency] = (state.cash[currency] ?? 0) - (tx.unit_price ?? 0);
        break;
      }
      case "conversion": {
        // unit_price is the exchange rate, quantity is the from-amount
        // Notes typically encode from/to; we treat it as a cash rebalancing
        // Simplified: subtract source currency, add target currency
        // For TWR purposes, conversions are not external flows, just internal.
        // We skip them as they don't affect total portfolio value.
        break;
      }
    }
  }

  return state;
}

/**
 * Compute the total EUR value of a portfolio state at a given timestamp.
 */
function computePortfolioValueEUR(
  state: PortfolioState,
  timestamp: number,
  priceLookup: Record<string, { time: number; price: number }[]>,
  assetCurrencies: Record<string, string>
): number {
  let total = 0;

  // Position values
  for (const [ticker, pos] of Object.entries(state.positions)) {
    if (pos.quantity <= 0) continue;
    const priceSeries = priceLookup[ticker];
    const price = priceSeries ? getPriceAt(priceSeries, timestamp) : null;
    if (price === null) continue; // no history for this ticker yet
    const currency = assetCurrencies[ticker] ?? pos.currency ?? "EUR";
    const valueInCurrency = pos.quantity * price;
    total += toEUR(valueInCurrency, currency, timestamp, priceLookup);
  }

  // Cash values
  for (const [currency, amount] of Object.entries(state.cash)) {
    if (amount === 0) continue;
    total += toEUR(amount, currency, timestamp, priceLookup);
  }

  return total;
}

// ─── External flow detection ──────────────────────────────────────────────────

/**
 * Compute net external cash flows (deposits - withdrawals) between two timestamps
 * in EUR using historical FX rates at the flow timestamp.
 */
function getNetFlowsEUR(
  transactions: Transaction[],
  fromTimestamp: number, // exclusive
  toTimestamp: number, // inclusive
  priceLookup: Record<string, { time: number; price: number }[]>
): number {
  let netFlow = 0;
  for (const tx of transactions) {
    const txTime = new Date(tx.date).getTime() / 1000;
    if (txTime <= fromTimestamp || txTime > toTimestamp) continue;
    const currency = tx.currency ?? "EUR";
    const amount = tx.unit_price ?? 0;
    if (tx.type === "deposit") {
      netFlow += toEUR(amount, currency, txTime, priceLookup);
    } else if (tx.type === "withdrawal") {
      netFlow -= toEUR(amount, currency, txTime, priceLookup);
    }
  }
  return netFlow;
}

// ─── Weekly timeline builder ──────────────────────────────────────────────────

/**
 * Generate weekly timestamps from `startDate` to now (Monday of each week).
 */
function buildWeeklyTimeline(startDate: Date, endDate: Date): number[] {
  const times: number[] = [];
  // Align to Monday
  const d = new Date(startDate);
  d.setUTCHours(0, 0, 0, 0);
  // Roll back to previous Monday
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);

  const end = endDate.getTime();
  while (d.getTime() <= end) {
    times.push(d.getTime() / 1000);
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return times;
}

// ─── Main TWR computation ─────────────────────────────────────────────────────

export interface ComputeTWROptions {
  transactions: Transaction[];
  historyMap: Record<string, AssetHistory>;
  /** Currency of each asset ticker (from assets_cache) */
  assetCurrencies: Record<string, string>;
  portfolioId: string;
  portfolioName: string;
  color: string;
}

export function computeTWR(opts: ComputeTWROptions): PortfolioTWRResult {
  const { transactions, historyMap, assetCurrencies, portfolioId, portfolioName, color } = opts;

  // Filter to only this portfolio's transactions, sorted ascending
  const txs = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  if (txs.length === 0) {
    return {
      portfolioId,
      portfolioName,
      color,
      dataPoints: [],
      totalTWR: 0,
      annualisedTWR: 0,
      currentValueEUR: 0,
      totalInvestedEUR: 0,
    };
  }

  const priceLookup = buildPriceLookup(historyMap);

  const firstTxDate = new Date(txs[0].date);
  const now = new Date();
  const weeklyTimes = buildWeeklyTimeline(firstTxDate, now);

  if (weeklyTimes.length < 2) {
    return {
      portfolioId,
      portfolioName,
      color,
      dataPoints: [],
      totalTWR: 0,
      annualisedTWR: 0,
      currentValueEUR: 0,
      totalInvestedEUR: 0,
    };
  }

  const dataPoints: TWRDataPoint[] = [];
  let cumulativeTWR = 1; // starts at 1, multiply by (1 + R_i)
  let prevValueEUR = 0;

  for (let i = 0; i < weeklyTimes.length; i++) {
    const t = weeklyTimes[i];
    const prevT = i > 0 ? weeklyTimes[i - 1] : t - 7 * 24 * 3600;

    // Portfolio state at time t
    const state = replayTransactions(txs, t);
    const valueEUR = computePortfolioValueEUR(state, t, priceLookup, assetCurrencies);

    // Net external flows during this period
    const netFlow = getNetFlowsEUR(txs, prevT, t, priceLookup);

    // TWR sub-period: only compute after first period with value
    if (i > 0 && prevValueEUR > 0) {
      const denominator = prevValueEUR + netFlow;
      if (denominator > 0 && valueEUR > 0) {
        const subReturn = valueEUR / denominator - 1;
        cumulativeTWR *= 1 + subReturn;
      }
    } else if (i === 0) {
      // First week: initialize
      cumulativeTWR = 1;
    }

    if (valueEUR > 0 || netFlow > 0) {
      dataPoints.push({
        time: t,
        date: new Date(t * 1000).toISOString().split("T")[0],
        valueEUR: Math.max(0, valueEUR),
        twr: cumulativeTWR - 1,
        netFlow,
      });
    }

    prevValueEUR = valueEUR;
  }

  const totalTWR = cumulativeTWR - 1;

  // Annualised TWR
  let annualisedTWR = 0;
  if (dataPoints.length >= 2) {
    const firstDate = new Date(dataPoints[0].date);
    const lastDate = new Date(dataPoints[dataPoints.length - 1].date);
    const years = (lastDate.getTime() - firstDate.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (years > 0) {
      annualisedTWR = Math.pow(1 + totalTWR, 1 / years) - 1;
    }
  }

  // Total invested (cumulative deposits in EUR)
  let totalInvestedEUR = 0;
  for (const tx of txs) {
    if (tx.type === "deposit") {
      const currency = tx.currency ?? "EUR";
      const txTime = new Date(tx.date).getTime() / 1000;
      totalInvestedEUR += toEUR(tx.unit_price ?? 0, currency, txTime, priceLookup);
    }
  }

  const currentValueEUR = dataPoints.length > 0 ? dataPoints[dataPoints.length - 1].valueEUR : 0;

  return {
    portfolioId,
    portfolioName,
    color,
    dataPoints,
    totalTWR,
    annualisedTWR,
    currentValueEUR,
    totalInvestedEUR,
  };
}

/**
 * Filter data points to a specific time range.
 */
export function filterByRange(
  dataPoints: TWRDataPoint[],
  range: "6M" | "1Y" | "2Y" | "5Y" | "MAX"
): TWRDataPoint[] {
  if (range === "MAX" || dataPoints.length === 0) return dataPoints;
  const now = Date.now() / 1000;
  const monthsMap = { "6M": 6, "1Y": 12, "2Y": 24, "5Y": 60 };
  const months = monthsMap[range];
  const cutoff = now - months * 30.44 * 24 * 3600;
  const filtered = dataPoints.filter((d) => d.time >= cutoff);
  // Always include at least a reference point for TWR rebasing
  if (filtered.length === 0) return dataPoints.slice(-1);
  return filtered;
}

/**
 * Rebase TWR data points so the first visible point is 0%.
 */
export function rebaseTWR(dataPoints: TWRDataPoint[]): TWRDataPoint[] {
  if (dataPoints.length === 0) return [];
  const baseMultiplier = 1 + dataPoints[0].twr;
  return dataPoints.map((d) => ({
    ...d,
    twr: (1 + d.twr) / baseMultiplier - 1,
  }));
}
