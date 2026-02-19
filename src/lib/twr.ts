/**
 * Time-Weighted Return (TWR) calculation library
 *
 * TWR divides the global period into sub-periods each time an external cash
 * flow (deposit or withdrawal) occurs. Returns for each sub-period are then
 * chained geometrically:
 *   TWR = (1 + R1) × (1 + R2) × ... × (1 + Rn) - 1
 *
 * All values are converted to EUR using historical FX rates.
 */

import { Transaction } from "@/hooks/usePortfolios";
import { AssetHistory } from "@/hooks/usePortfolios";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TWRDataPoint {
  time: number;          // Unix timestamp in seconds
  date: string;          // ISO date string
  valueEUR: number;      // Portfolio value in EUR
  twr: number;           // Cumulative TWR as decimal (0.15 = +15%)
  netFlow: number;       // Net external flows during this period
}

export interface PortfolioTWRResult {
  portfolioId: string;
  portfolioName: string;
  color: string;
  dataPoints: TWRDataPoint[];
  totalTWR: number;
  annualisedTWR: number;
}

// ─── FX helpers ───────────────────────────────────────────────────────────────

export function getFxTicker(currency: string): string | null {
  const upper = currency.toUpperCase();
  if (upper === "EUR") return null;
  // USDEUR=X: how many EUR per 1 USD
  return `${upper}EUR=X`;
}

// ─── Price lookup helpers ─────────────────────────────────────────────────────

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
 * Forward-fill lookup with ±5 day tolerance to handle timestamp misalignment
 * between our weekly Monday-00:00-UTC timeline and Yahoo's market-open timestamps.
 * Returns the last known price at or before (timestamp + 5 days).
 */
export function getPriceAt(
  sorted: { time: number; price: number }[],
  timestamp: number
): number | null {
  if (!sorted || sorted.length === 0) return null;

  // 5-day forward tolerance: a price stamped at Monday 14:30 UTC still counts for Monday 00:00 UTC
  const FORWARD_TOLERANCE = 5 * 24 * 3600;
  const cutoff = timestamp + FORWARD_TOLERANCE;

  let last: number | null = null;
  for (const p of sorted) {
    if (p.time <= cutoff) {
      last = p.price;
    } else {
      break;
    }
  }
  return last;
}

/**
 * Convert amount in `currency` to EUR using historical FX data at `timestamp`.
 * Falls back to 1:1 if no FX data is available.
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
  if (!fxSeries) return amount;
  const rate = getPriceAt(fxSeries, timestamp);
  if (rate === null || rate === 0) return amount; // fallback: no conversion
  return amount * rate;
}

// ─── Position state replay ────────────────────────────────────────────────────

/**
 * Replay transactions up to `upToTimestamp` (seconds).
 * Mirrors the logic of calculatePositions + calculateCashBalances from calculations.ts
 * so that the replayed values are consistent with the dashboard.
 */
function replayState(
  transactions: Transaction[],
  upToTimestamp: number
): {
  positions: Record<string, { quantity: number; currency: string }>;
  cash: Record<string, number>;
} {
  const positions: Record<string, { quantity: number; currency: string }> = {};
  const cash: Record<string, number> = {};

  const sorted = [...transactions].sort((a, b) => {
    const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
    if (diff !== 0) return diff;
    const typePriority: Record<string, number> = { deposit: 0, buy: 1, conversion: 2, sell: 3, withdrawal: 4 };
    return (typePriority[a.type] ?? 99) - (typePriority[b.type] ?? 99);
  });

  for (const tx of sorted) {
    const txSec = new Date(tx.date).getTime() / 1000;
    if (txSec > upToTimestamp) break;

    const currency = tx.currency ?? "EUR";
    const qty = tx.quantity ?? 0;
    const price = tx.unit_price ?? 0;
    const fees = tx.fees ?? 0;

    switch (tx.type) {
      case "buy": {
        if (!tx.ticker || qty === 0 || price === 0) break;
        if (!positions[tx.ticker]) positions[tx.ticker] = { quantity: 0, currency };
        positions[tx.ticker].quantity += qty;
        cash[currency] = (cash[currency] ?? 0) - (qty * price + fees);
        break;
      }
      case "sell": {
        if (!tx.ticker || qty === 0) break;
        if (positions[tx.ticker]) {
          positions[tx.ticker].quantity -= qty;
          if (positions[tx.ticker].quantity <= 1e-9) delete positions[tx.ticker];
        }
        cash[currency] = (cash[currency] ?? 0) + (qty * price - fees);
        break;
      }
      case "deposit": {
        // calculateCashBalances: amount = qty * price (qty defaults to 1 when null, price = amount)
        const amount = qty !== 0 ? qty * price : price;
        cash[currency] = (cash[currency] ?? 0) + amount;
        break;
      }
      case "withdrawal": {
        const amount = qty !== 0 ? qty * price : price;
        cash[currency] = (cash[currency] ?? 0) - amount;
        break;
      }
      case "conversion": {
        // source: ticker currency, amount = qty * price; target: currency, amount = qty
        const sourceCurrency = tx.ticker ?? "EUR";
        cash[sourceCurrency] = (cash[sourceCurrency] ?? 0) - (qty * price + fees);
        cash[currency] = (cash[currency] ?? 0) + qty;
        break;
      }
    }
  }

  return { positions, cash };
}

/**
 * Compute the total portfolio value in EUR at a given timestamp.
 * Uses forward-fill (getPriceAt with tolerance) for missing weekly data.
 */
function computeValueEUR(
  positions: Record<string, { quantity: number; currency: string }>,
  cash: Record<string, number>,
  timestamp: number,
  priceLookup: Record<string, { time: number; price: number }[]>,
  assetCurrencies: Record<string, string>
): number {
  let total = 0;

  for (const [ticker, pos] of Object.entries(positions)) {
    if (pos.quantity <= 1e-9) continue;
    const priceSeries = priceLookup[ticker];
    if (!priceSeries) continue;
    const price = getPriceAt(priceSeries, timestamp);
    if (price === null || price === 0) continue;
    const currency = assetCurrencies[ticker] ?? pos.currency ?? "EUR";
    total += toEUR(pos.quantity * price, currency, timestamp, priceLookup);
  }

  for (const [currency, amount] of Object.entries(cash)) {
    if (Math.abs(amount) < 0.001) continue;
    total += toEUR(amount, currency, timestamp, priceLookup);
  }

  return total;
}

// ─── External flows per week ──────────────────────────────────────────────────

/**
 * Returns net external EUR flows (deposits - withdrawals) strictly within
 * (fromSec, toSec].
 */
function getNetFlowsEUR(
  transactions: Transaction[],
  fromSec: number,
  toSec: number,
  priceLookup: Record<string, { time: number; price: number }[]>
): number {
  let net = 0;
  for (const tx of transactions) {
    const txSec = new Date(tx.date).getTime() / 1000;
    if (txSec <= fromSec || txSec > toSec) continue;
    if (tx.type !== "deposit" && tx.type !== "withdrawal") continue;
    const currency = tx.currency ?? "EUR";
    const qty = tx.quantity ?? 0;
    const price = tx.unit_price ?? 0;
    const amount = qty !== 0 ? qty * price : price;
    const amountEUR = toEUR(amount, currency, txSec, priceLookup);
    if (tx.type === "deposit") net += amountEUR;
    else net -= amountEUR;
  }
  return net;
}

// ─── Weekly timeline ──────────────────────────────────────────────────────────

function buildWeeklyTimeline(startDate: Date, endDate: Date): number[] {
  const times: number[] = [];
  const d = new Date(startDate);
  d.setUTCHours(0, 0, 0, 0);
  // Snap to previous Monday
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));

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
  assetCurrencies: Record<string, string>;
  portfolioId: string;
  portfolioName: string;
  color: string;
}

export function computeTWR(opts: ComputeTWROptions): PortfolioTWRResult {
  const { transactions, historyMap, assetCurrencies, portfolioId, portfolioName, color } = opts;

  const txs = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const empty: PortfolioTWRResult = { portfolioId, portfolioName, color, dataPoints: [], totalTWR: 0, annualisedTWR: 0 };
  if (txs.length === 0) return empty;

  const priceLookup = buildPriceLookup(historyMap);

  const firstTxDate = new Date(txs[0].date);
  const now = new Date();
  const weeklyTimes = buildWeeklyTimeline(firstTxDate, now);
  if (weeklyTimes.length < 2) return empty;

  const dataPoints: TWRDataPoint[] = [];

  // TWR state
  let cumulativeFactor = 1; // product of (1 + R_i)
  let prevValueEUR = 0;
  let prevTime = weeklyTimes[0] - 7 * 24 * 3600;

  for (let i = 0; i < weeklyTimes.length; i++) {
    const t = weeklyTimes[i];

    const state = replayState(txs, t);
    const valueEUR = computeValueEUR(state.positions, state.cash, t, priceLookup, assetCurrencies);

    // Net external flows during this week
    const netFlow = getNetFlowsEUR(txs, prevTime, t, priceLookup);

    // Compute sub-period return
    // R_i = V_end / (V_start + external_flows_this_period) - 1
    // We only chain when the denominator is meaningful
    if (i > 0) {
      const denominator = prevValueEUR + netFlow;
      if (denominator > 1 && valueEUR > 0) {
        const subReturn = valueEUR / denominator - 1;
        cumulativeFactor *= (1 + subReturn);
      } else if (denominator <= 0 && netFlow > 0 && valueEUR > 0) {
        // Fresh start after zero value (initial deposit)
        cumulativeFactor = 1;
      }
    }

    if (valueEUR > 0 || (i > 0 && dataPoints.length > 0)) {
      dataPoints.push({
        time: t,
        date: new Date(t * 1000).toISOString().split("T")[0],
        valueEUR: Math.max(0, valueEUR),
        twr: cumulativeFactor - 1,
        netFlow,
      });
    }

    prevValueEUR = valueEUR;
    prevTime = t;
  }

  if (dataPoints.length === 0) return empty;

  const totalTWR = cumulativeFactor - 1;

  // Annualised TWR
  let annualisedTWR = 0;
  if (dataPoints.length >= 2) {
    const first = new Date(dataPoints[0].date);
    const last = new Date(dataPoints[dataPoints.length - 1].date);
    const years = (last.getTime() - first.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (years > 0) {
      annualisedTWR = Math.pow(Math.abs(1 + totalTWR), 1 / years) * Math.sign(1 + totalTWR) - 1;
    }
  }

  return { portfolioId, portfolioName, color, dataPoints, totalTWR, annualisedTWR };
}

// ─── Range filter & TWR rebase ────────────────────────────────────────────────

export type TimeRange = "6M" | "1Y" | "2Y" | "5Y" | "MAX";

export function filterByRange(dataPoints: TWRDataPoint[], range: TimeRange): TWRDataPoint[] {
  if (range === "MAX" || dataPoints.length === 0) return dataPoints;
  const now = Date.now() / 1000;
  const monthsMap: Record<TimeRange, number> = { "6M": 6, "1Y": 12, "2Y": 24, "5Y": 60, "MAX": 9999 };
  const cutoff = now - monthsMap[range] * 30.44 * 24 * 3600;
  const filtered = dataPoints.filter((d) => d.time >= cutoff);
  return filtered.length === 0 ? dataPoints.slice(-1) : filtered;
}

/**
 * Rebase TWR so the first visible point starts at 0%.
 * This allows comparing performance over the selected range regardless of past history.
 */
export function rebaseTWR(dataPoints: TWRDataPoint[]): TWRDataPoint[] {
  if (dataPoints.length === 0) return [];
  const baseMultiplier = 1 + dataPoints[0].twr;
  if (baseMultiplier === 0) return dataPoints;
  return dataPoints.map((d) => ({
    ...d,
    twr: (1 + d.twr) / baseMultiplier - 1,
  }));
}
