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

const PRICE_FORWARD_TOLERANCE_SEC = 24 * 3600;
const CREDIT_FREEZE_WINDOW = {
  from: "2025-02-26",
  to: "2025-10-31",
} as const;

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

function resolveTickerAlias(ticker: string): string {
  // Legacy Saxo imports used GOLD-EUR.PA, but Yahoo historical coverage is
  // reliable on GOLD.PA. Keep this fallback for already-imported rows.
  if (ticker === "GOLD-EUR.PA") return "GOLD.PA";
  return ticker;
}

function normalizePortfolioName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function getFreezeWindowForPortfolio(portfolioName: string): { from: string; to: string } | null {
  const normalized = normalizePortfolioName(portfolioName);
  if (normalized.includes("credit")) return CREDIT_FREEZE_WINDOW;
  return null;
}

function isWithinFreezeWindow(date: string, window: { from: string; to: string } | null): boolean {
  if (!window) return false;
  return date >= window.from && date <= window.to;
}

/**
 * Forward-fill lookup with +1 day tolerance to handle timestamp misalignment
 * between midnight UTC points and market-close timestamps.
 * Returns the last known price at or before (timestamp + tolerance).
 */
export function getPriceAt(
  sorted: { time: number; price: number }[],
  timestamp: number
): number | null {
  if (!sorted || sorted.length === 0) return null;

  // A close stamped later in the same UTC day still counts for that day.
  const cutoff = timestamp + PRICE_FORWARD_TOLERANCE_SEC;

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
  // If no FX series available, return 0 instead of 1:1 fallback to avoid
  // inflating portfolio value with unconverted foreign-currency cash
  if (!fxSeries || fxSeries.length === 0) return 0;
  const rate = getPriceAt(fxSeries, timestamp);
  if (rate === null || rate === 0) return 0; // no conversion data → skip rather than inflate
  return amount * rate;
}

// ─── Position state replay ────────────────────────────────────────────────────

/**
 * Replay transactions up to `upToTimestamp` (seconds).
 *
 * Key design decision for multi-currency portfolios:
 * - Positions (stocks) are tracked by quantity; their EUR value is computed
 *   via historical price × FX rate at each point in time.
 * - Cash is tracked ONLY in EUR. Foreign-currency cash from buy/sell flows
 *   (e.g. USD proceeds from selling NVDA) is intentionally ignored because:
 *   1. The broker recycles it internally between trades.
 *   2. Without per-trade FX conversion records, we cannot accurately convert
 *      it historically — leading to large aberrant values.
 *   3. Deposits/withdrawals in EUR and explicit EUR↔FX conversions correctly
 *      capture the real external capital flows.
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
    const typePriority: Record<string, number> = {
      deposit: 0,
      transfer_in: 1,
      buy: 2,
      conversion: 3,
      sell: 4,
      transfer_out: 5,
      withdrawal: 6,
    };
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
        // Only track cash impact for EUR buys — foreign-currency cash is
        // recycled by the broker and not meaningful for historical TWR.
        if (currency === "EUR") {
          cash["EUR"] = (cash["EUR"] ?? 0) - (qty * price + fees);
        }
        break;
      }
      case "sell": {
        if (!tx.ticker || qty === 0) break;
        if (positions[tx.ticker]) {
          positions[tx.ticker].quantity -= qty;
          if (positions[tx.ticker].quantity <= 1e-9) delete positions[tx.ticker];
        }
        // Same: only track EUR cash proceeds
        if (currency === "EUR") {
          cash["EUR"] = (cash["EUR"] ?? 0) + (qty * price - fees);
        }
        break;
      }
      case "transfer_in": {
        if (!tx.ticker || qty === 0) break;
        if (!positions[tx.ticker]) positions[tx.ticker] = { quantity: 0, currency };
        positions[tx.ticker].quantity += qty;
        break;
      }
      case "transfer_out": {
        if (!tx.ticker || qty === 0) break;
        if (positions[tx.ticker]) {
          positions[tx.ticker].quantity -= qty;
          if (positions[tx.ticker].quantity <= 1e-9) delete positions[tx.ticker];
        }
        break;
      }
      case "deposit": {
        const amount = resolveTransactionAmountAbs(tx);
        // Convert non-EUR deposits to EUR using a rough approximation;
        // explicit conversions below are more accurate.
        if (currency === "EUR" && amount > 0) {
          cash["EUR"] = (cash["EUR"] ?? 0) + amount;
        }
        // Non-EUR deposits are handled via conversion transactions
        break;
      }
      case "withdrawal": {
        const amount = resolveTransactionAmountAbs(tx);
        if (currency === "EUR" && amount > 0) {
          cash["EUR"] = (cash["EUR"] ?? 0) - amount;
        }
        break;
      }
      case "dividend":
      case "interest":
      case "coupon": {
        // Track only EUR side; non-EUR flows are represented by conversion txs.
        const amount = resolveTransactionAmountAbs(tx);
        if (currency === "EUR" && amount > 0) {
          cash["EUR"] = (cash["EUR"] ?? 0) + amount;
        }
        break;
      }
      case "conversion": {
        // Explicit EUR↔FX conversion recorded by the user.
        // ticker = source currency, currency = target currency, qty = target amount
        const sourceCurrency = (tx.ticker ?? "EUR").toUpperCase();
        const targetCurrency = currency.toUpperCase();
        const targetAmount = qty;
        const sourceAmount = qty * price + fees;

        // Only update EUR side — foreign cash is ignored
        if (sourceCurrency === "EUR") {
          cash["EUR"] = (cash["EUR"] ?? 0) - sourceAmount;
        }
        if (targetCurrency === "EUR") {
          cash["EUR"] = (cash["EUR"] ?? 0) + targetAmount;
        }
        break;
      }
    }
  }

  return { positions, cash };
}

function resolveTransactionAmountAbs(tx: Transaction): number {
  const qty = Math.abs(tx.quantity ?? 0);
  const price = Math.abs(tx.unit_price ?? 0);
  if (qty > 0 && price > 0) return qty * price;
  return price;
}


/**
 * Compute the total portfolio value in EUR at a given timestamp.
 * Uses forward-fill (getPriceAt with tolerance) for timestamp alignment.
 *
 * Cash is always in EUR (see replayState), so no FX conversion needed for it.
 * Positions are converted from their native currency via historical FX rates.
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
    const priceSeries = priceLookup[ticker] ?? priceLookup[resolveTickerAlias(ticker)];
    if (!priceSeries) continue;
    const price = getPriceAt(priceSeries, timestamp);
    if (price === null || price === 0) continue;
    const currency = assetCurrencies[ticker] ?? pos.currency ?? "EUR";
    total += toEUR(pos.quantity * price, currency, timestamp, priceLookup);
  }

  // Cash is only in EUR after replayState simplification
  const eurCash = cash["EUR"] ?? 0;
  if (Math.abs(eurCash) > 0.001) total += eurCash;

  return total;
}

// ─── External flows per period ────────────────────────────────────────────────

/**
 * Returns net external flows in EUR strictly within (fromSec, toSec].
 *
 * To avoid distortion from compensating intra-day broker movements
 * (e.g. broker temporarily depositing and withdrawing the same amount),
 * we compute day-level nets and ignore days with near-zero net flow.
 */
function getNetFlowsEUR(
  transactions: Transaction[],
  fromSec: number,
  toSec: number,
  priceLookup: Record<string, { time: number; price: number }[]>,
  assetCurrencies: Record<string, string>
): number {
  // Aggregate flows by calendar day (UTC date string)
  const byDay: Record<string, number> = {};

  for (const tx of transactions) {
    const txSec = new Date(tx.date).getTime() / 1000;
    if (txSec <= fromSec || txSec > toSec) continue;
    if (
      tx.type !== "deposit" &&
      tx.type !== "withdrawal" &&
      tx.type !== "transfer_in" &&
      tx.type !== "transfer_out"
    ) continue;

    let amountEUR = 0;

    if (tx.type === "deposit" || tx.type === "withdrawal") {
      // Keep external-flow logic consistent with replayState cash handling.
      const currency = (tx.currency ?? "EUR").toUpperCase();
      if (currency !== "EUR") continue;

      const amount = resolveTransactionAmountAbs(tx);
      if (amount <= 0) continue;
      amountEUR = tx.type === "deposit" ? amount : -amount;
    } else {
      // transfer_in / transfer_out of positions are external flows:
      // value them at market price on transfer date when possible.
      const ticker = tx.ticker;
      const qty = Math.abs(tx.quantity ?? 0);
      if (!ticker || qty <= 0) continue;

      const series = priceLookup[ticker] ?? priceLookup[resolveTickerAlias(ticker)];
      const marketPrice = series ? getPriceAt(series, txSec) : null;
      const txPrice = Math.abs(tx.unit_price ?? 0);
      const unitPrice = marketPrice && marketPrice > 0 ? marketPrice : txPrice;
      if (!unitPrice || unitPrice <= 0) continue;

      const amount = qty * unitPrice;
      const signed = tx.type === "transfer_in" ? amount : -amount;
      const currency = (tx.currency ?? assetCurrencies[ticker] ?? "EUR").toUpperCase();
      amountEUR = currency === "EUR" ? signed : toEUR(signed, currency, txSec, priceLookup);
    }

    const day = new Date(tx.date).toISOString().split("T")[0];
    byDay[day] = (byDay[day] ?? 0) + amountEUR;
  }

  let netFlow = 0;
  for (const dayFlow of Object.values(byDay)) {
    // Neutralize compensating same-day movements.
    if (Math.abs(dayFlow) < 1e-6) continue;
    netFlow += dayFlow;
  }

  return netFlow;
}

// ─── Daily timeline ───────────────────────────────────────────────────────────

function buildDailyTimeline(startDate: Date, endDate: Date): number[] {
  const times: number[] = [];
  const d = new Date(startDate);
  d.setUTCHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setUTCHours(0, 0, 0, 0);
  while (d.getTime() <= end.getTime()) {
    times.push(d.getTime() / 1000);
    d.setUTCDate(d.getUTCDate() + 1);
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
  const freezeWindow = getFreezeWindowForPortfolio(portfolioName);

  const firstTxDate = new Date(txs[0].date);
  const now = new Date();
  const dailyTimes = buildDailyTimeline(firstTxDate, now);
  if (dailyTimes.length < 2) return empty;

  const dataPoints: TWRDataPoint[] = [];

  // TWR state
  let cumulativeFactor = 1; // product of (1 + R_i)
  let prevValueEUR = 0;
  let prevTime = dailyTimes[0] - 24 * 3600;
  const MIN_CHAIN_BASE_EUR = 100;

  for (let i = 0; i < dailyTimes.length; i++) {
    const t = dailyTimes[i];
    const date = new Date(t * 1000).toISOString().split("T")[0];

    // Business rule: for portfolio "Crédit", freeze value/performance during
    // the known near-zero interval to avoid artificial spikes.
    // Still compute netFlow so cumulative deposits curve tracks cash movements.
    if (isWithinFreezeWindow(date, freezeWindow)) {
      const freezeNetFlow = getNetFlowsEUR(txs, prevTime, t, priceLookup, assetCurrencies);
      dataPoints.push({
        time: t,
        date,
        valueEUR: 0,
        twr: cumulativeFactor - 1,
        netFlow: freezeNetFlow,
      });
      prevValueEUR = 0;
      prevTime = t;
      continue;
    }

    const state = replayState(txs, t);
    const valueEUR = computeValueEUR(state.positions, state.cash, t, priceLookup, assetCurrencies);

    // External flows during this period.
    const netFlow = getNetFlowsEUR(txs, prevTime, t, priceLookup, assetCurrencies);

    // Determine if this point has meaningful data.
    // A zero value when positions exist likely means missing price data for a ticker
    // — we skip TWR chaining for that point to avoid aberrant spikes.
    const hasPositions = Object.keys(state.positions).length > 0;
    const hasMissingPrices = hasPositions && valueEUR <= 0;

    // Compute sub-period return.
    // Daily granularity can be unstable when the portfolio is nearly empty
    // (tiny base, admin fee, then large redeposit). We skip chaining when the
    // base is too small and treat large inflows on tiny bases as restart points.
    if (i > 0 && !hasMissingPrices && valueEUR > 0) {
      const isFreshRestart = prevValueEUR < MIN_CHAIN_BASE_EUR && netFlow > MIN_CHAIN_BASE_EUR;
      if (!isFreshRestart) {
        // Start-of-period flow convention:
        // R_i = V_end / (V_start + external_flows_this_period) - 1
        const denominator = prevValueEUR + netFlow;
        if (denominator > MIN_CHAIN_BASE_EUR) {
          let subReturn = valueEUR / denominator - 1;
          if (subReturn < -0.999999) subReturn = -0.999999;
          if (Number.isFinite(subReturn)) {
            cumulativeFactor *= (1 + subReturn);
          }
        }
      }
    }

    // Only record a data point when we have a real, non-zero portfolio value.
    // Skip points where price data is missing (would distort the chart).
    if (valueEUR > 0) {
      dataPoints.push({
        time: t,
        date,
        valueEUR,
        twr: cumulativeFactor - 1,
        netFlow,
      });
    }

    // Only update prevValueEUR when data is meaningful (not missing-price zeros)
    if (!hasMissingPrices) {
      prevValueEUR = valueEUR;
    }
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

export type TimeRange = "YTD" | "6M" | "1Y" | "2Y" | "5Y" | "MAX" | "CUSTOM";

export function filterByRange(
  dataPoints: TWRDataPoint[],
  range: TimeRange,
  customFrom?: string,
  customTo?: string
): TWRDataPoint[] {
  if (dataPoints.length === 0) return dataPoints;

  if (range === "CUSTOM" && customFrom) {
    const fromSec = new Date(customFrom).getTime() / 1000;
    const toSec = customTo ? new Date(customTo).getTime() / 1000 : Date.now() / 1000;
    const filtered = dataPoints.filter((d) => d.time >= fromSec && d.time <= toSec);
    return filtered.length === 0 ? dataPoints.slice(-1) : filtered;
  }

  if (range === "MAX") return dataPoints;

  if (range === "YTD") {
    const jan1 = new Date(new Date().getFullYear(), 0, 1);
    const cutoff = jan1.getTime() / 1000;
    const filtered = dataPoints.filter((d) => d.time >= cutoff);
    return filtered.length === 0 ? dataPoints.slice(-1) : filtered;
  }

  const now = Date.now() / 1000;
  const monthsMap: Record<string, number> = { "6M": 6, "1Y": 12, "2Y": 24, "5Y": 60 };
  const cutoff = now - (monthsMap[range] ?? 12) * 30.44 * 24 * 3600;
  const filtered = dataPoints.filter((d) => d.time >= cutoff);
  return filtered.length === 0 ? dataPoints.slice(-1) : filtered;
}

/**
 * Rebase TWR so the first visible point starts at 0%.
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

/**
 * Rebase a benchmark price series to percentage returns starting from 0%,
 * aligned with the given date range.
 */
export function rebaseBenchmark(
  history: { time: number; price: number }[],
  visibleDates: string[]
): { date: string; benchPct: number }[] {
  if (history.length === 0 || visibleDates.length === 0) return [];

  const sorted = [...history].sort((a, b) => a.time - b.time);
  const result: { date: string; benchPct: number }[] = [];

  // Find initial price at or before first visible date
  const firstVisibleSec = new Date(visibleDates[0]).getTime() / 1000;
  let basePrice: number | null = null;
  for (const p of sorted) {
    if (p.time <= firstVisibleSec + PRICE_FORWARD_TOLERANCE_SEC) basePrice = p.price;
    else break;
  }
  if (!basePrice) return [];

  for (const date of visibleDates) {
    const sec = new Date(date).getTime() / 1000;
    let price: number | null = null;
    for (const p of sorted) {
      if (p.time <= sec + PRICE_FORWARD_TOLERANCE_SEC) price = p.price;
      else break;
    }
    if (price !== null) {
      result.push({ date, benchPct: ((price / basePrice) - 1) * 100 });
    }
  }

  return result;
}
