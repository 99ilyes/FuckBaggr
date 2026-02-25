import { Transaction, AssetCache } from "@/hooks/usePortfolios";

export interface AssetPosition {
  ticker: string;
  name: string;
  quantity: number;
  pru: number;
  currentPrice: number;
  totalInvested: number;
  currentValue: number;
  currentValueBase: number;
  gainLoss: number;
  gainLossBase: number;
  gainLossPercent: number;
  sector: string;
  currency: string;
}

export interface CashBalances {
  [currency: string]: number;
}

export function calculatePositions(
  transactions: Transaction[],
  assetsCache: AssetCache[],
  baseCurrency = "EUR"
): AssetPosition[] {
  const cacheMap = new Map(assetsCache.map((a) => [a.ticker, a]));
  const positions = new Map<string, { quantity: number; totalCost: number; currency: string }>();

  const sortedTransactions = [...transactions].sort((a, b) => {
    const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
    if (dateDiff !== 0) return dateDiff;
    // Tie-breaker: Process buys/deposits before sells/withdrawals to ensure sufficient quantity
    const typePriority = { deposit: 0, buy: 1, conversion: 2, sell: 3, withdrawal: 4 };
    return (typePriority[a.type as keyof typeof typePriority] || 99) - (typePriority[b.type as keyof typeof typePriority] || 99);
  });

  for (const tx of sortedTransactions) {
    if (!tx.ticker || !tx.quantity || !tx.unit_price) continue;
    if (tx.type !== "buy" && tx.type !== "sell" && tx.type !== "transfer_in" && tx.type !== "transfer_out") continue;

    const pos = positions.get(tx.ticker) || {
      quantity: 0,
      totalCost: 0,
      currency: (tx as any).currency || "EUR",
    };

    if (tx.type === "buy" || tx.type === "transfer_in") {
      pos.totalCost += tx.quantity * tx.unit_price + tx.fees;
      pos.quantity += tx.quantity;
    } else if (tx.type === "sell" || tx.type === "transfer_out") {
      if (pos.quantity > 0) {
        const pru = pos.totalCost / pos.quantity;
        pos.quantity -= tx.quantity;
        pos.totalCost -= tx.quantity * pru;
        // If quantity drops to 0 or negative, reset the cost basis
        if (pos.quantity <= 0) {
          pos.quantity = 0;
          pos.totalCost = 0;
        }
      }
    }

    positions.set(tx.ticker, pos);
  }

  const result: AssetPosition[] = [];
  for (const [ticker, pos] of positions) {
    if (pos.quantity <= 0) continue;
    const cached = cacheMap.get(ticker);
    const currentPrice = cached?.last_price || 0;
    const pru = pos.totalCost / pos.quantity;
    const currentValue = pos.quantity * currentPrice;
    const gainLoss = currentValue - pos.totalCost;
    const gainLossPercent = pos.totalCost > 0 ? (gainLoss / pos.totalCost) * 100 : 0;

    // Calculate gain/loss and current value in base currency
    const rate = getExchangeRate(pos.currency, baseCurrency, assetsCache);
    const gainLossBase = gainLoss * rate;
    const currentValueBase = currentValue * rate;

    result.push({
      ticker,
      name: cached?.name || ticker,
      quantity: pos.quantity,
      pru,
      currentPrice,
      totalInvested: pos.totalCost,
      currentValue,
      currentValueBase,
      gainLoss,
      gainLossBase,
      gainLossPercent,
      sector: cached?.sector || "Autre",
      currency: cached?.currency || pos.currency || "EUR",
    });
  }

  return result.sort((a, b) => b.currentValueBase - a.currentValueBase);
}

export function calculateCashBalances(transactions: Transaction[]): CashBalances {
  const balances: CashBalances = {};

  for (const tx of transactions) {
    const currency = (tx as any).currency || "EUR";

    if (tx.type === "deposit") {
      balances[currency] = (balances[currency] || 0) + (tx.quantity || 0) * (tx.unit_price || 1);
    } else if (tx.type === "withdrawal") {
      balances[currency] = (balances[currency] || 0) - (tx.quantity || 0) * (tx.unit_price || 1);
    } else if (tx.type === "buy" && tx.quantity && tx.unit_price) {
      balances[currency] = (balances[currency] || 0) - (tx.quantity * tx.unit_price + tx.fees);
    } else if (tx.type === "sell" && tx.quantity && tx.unit_price) {
      balances[currency] = (balances[currency] || 0) + (tx.quantity * tx.unit_price - tx.fees);
    } else if (tx.type === "conversion" && tx.quantity && tx.unit_price) {
      // ticker = source currency, currency = target currency
      // quantity = amount in target currency, unit_price = exchange rate
      // So source amount = quantity * unit_price
      const sourceCurrency = tx.ticker || "EUR";
      balances[sourceCurrency] = (balances[sourceCurrency] || 0) - (tx.quantity * tx.unit_price + tx.fees);
      balances[currency] = (balances[currency] || 0) + tx.quantity;
    } else if (tx.type === "dividend") {
      balances[currency] = (balances[currency] || 0) + (tx.quantity || 0) * (tx.unit_price || 1);
    } else if (tx.type === "interest") {
      balances[currency] = (balances[currency] || 0) + (tx.quantity || 0) * (tx.unit_price || 1);
    }
  }

  // Remove zero balances
  for (const key of Object.keys(balances)) {
    if (Math.abs(balances[key]) < 0.001) delete balances[key];
  }

  return balances;
}

function isValidRate(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function getDirectOrInverseRate(
  from: string,
  to: string,
  cache: AssetCache[],
  field: "last_price" | "previous_close"
): number | null {
  const directTicker = `${from}${to}=X`;
  const inverseTicker = `${to}${from}=X`;

  const direct = cache.find((a) => a.ticker.toUpperCase() === directTicker);
  const directRate = direct?.[field];
  if (isValidRate(directRate)) return directRate;

  const inverse = cache.find((a) => a.ticker.toUpperCase() === inverseTicker);
  const inverseRate = inverse?.[field];
  if (isValidRate(inverseRate)) return 1 / inverseRate;

  return null;
}

function getMarketExchangeRate(from: string, to: string, cache: AssetCache[]): number | null {
  const source = (from || "EUR").toUpperCase();
  const target = (to || "EUR").toUpperCase();
  if (source === target) return 1;

  const direct = getDirectOrInverseRate(source, target, cache, "last_price");
  if (direct !== null) return direct;

  // Bridge through EUR so cross-currency cash/positions are still converted
  // even when the direct pair (e.g. GBPUSD=X) is not cached.
  if (source !== "EUR" && target !== "EUR") {
    const sourceToEur = getDirectOrInverseRate(source, "EUR", cache, "last_price");
    const targetToEur = getDirectOrInverseRate(target, "EUR", cache, "last_price");
    if (sourceToEur !== null && targetToEur !== null && targetToEur !== 0) {
      return sourceToEur / targetToEur;
    }
  }

  return null;
}

// Helper to get exchange rate from cache
export function getExchangeRate(from: string, to: string, cache: AssetCache[]): number {
  const marketRate = getMarketExchangeRate(from, to, cache);
  return marketRate ?? 1; // Fallback assumes 1:1 if rate missing
}

function getExchangeRateFromConversions(
  from: string,
  to: string,
  transactions: Transaction[]
): number | null {
  if (from === to) return 1;

  const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date));
  for (const tx of sorted) {
    if (tx.type !== "conversion") continue;
    const source = (tx.ticker || "").toUpperCase();
    const target = (tx.currency || "").toUpperCase();
    const unit = tx.unit_price || 0;
    if (!source || !target || !unit || unit <= 0) continue;

    // Example EUR -> USD conversion stores unit as EUR per USD.
    if (source === to.toUpperCase() && target === from.toUpperCase()) {
      return unit;
    }
    // Example USD -> EUR conversion stores unit as USD per EUR.
    if (source === from.toUpperCase() && target === to.toUpperCase()) {
      return 1 / unit;
    }
  }

  return null;
}

function getBestExchangeRate(
  from: string,
  to: string,
  cache: AssetCache[],
  transactions: Transaction[]
): number {
  const source = (from || "EUR").toUpperCase();
  const target = (to || "EUR").toUpperCase();
  if (source === target) return 1;

  const marketRate = getMarketExchangeRate(source, target, cache);
  if (marketRate !== null) return marketRate;

  const fallbackRate = getExchangeRateFromConversions(source, target, transactions);
  if (fallbackRate && isFinite(fallbackRate) && fallbackRate > 0) {
    return fallbackRate;
  }

  return 1;
}

function getPreviousDirectOrInverseRate(
  from: string,
  to: string,
  cache: AssetCache[],
  previousCloseMap: Record<string, number>
): number | null {
  const directTicker = `${from}${to}=X`;
  const inverseTicker = `${to}${from}=X`;

  const directMapRate = previousCloseMap[directTicker];
  if (isValidRate(directMapRate)) return directMapRate;

  const directCache = cache.find((a) => a.ticker.toUpperCase() === directTicker)?.previous_close;
  if (isValidRate(directCache)) return directCache;

  const inverseMapRate = previousCloseMap[inverseTicker];
  if (isValidRate(inverseMapRate)) return 1 / inverseMapRate;

  const inverseCache = cache.find((a) => a.ticker.toUpperCase() === inverseTicker)?.previous_close;
  if (isValidRate(inverseCache)) return 1 / inverseCache;

  return null;
}

function getPreviousExchangeRate(
  from: string,
  to: string,
  cache: AssetCache[],
  previousCloseMap: Record<string, number>,
  transactions: Transaction[]
): number {
  const source = (from || "EUR").toUpperCase();
  const target = (to || "EUR").toUpperCase();
  if (source === target) return 1;

  const direct = getPreviousDirectOrInverseRate(source, target, cache, previousCloseMap);
  if (direct !== null) return direct;

  if (source !== "EUR" && target !== "EUR") {
    const sourceToEur = getPreviousDirectOrInverseRate(source, "EUR", cache, previousCloseMap);
    const targetToEur = getPreviousDirectOrInverseRate(target, "EUR", cache, previousCloseMap);
    if (sourceToEur !== null && targetToEur !== null && targetToEur !== 0) {
      return sourceToEur / targetToEur;
    }
  }

  // If we don't have a previous close for FX, use the best current conversion
  // so the asset remains valued rather than dropped.
  return getBestExchangeRate(source, target, cache, transactions);
}

export function calculatePortfolioStats(
  positions: AssetPosition[],
  cashBalances: CashBalances,
  assetsCache: AssetCache[],
  transactions: Transaction[],
  baseCurrency = "EUR"
) {
  // "Investi" = external capital injected by the user.
  // Includes: deposits/withdrawals + in-kind transfers of securities.
  // Excludes: realized gains reinvested via buy/sell/dividends.
  let totalInvested = 0;
  for (const tx of transactions) {
    if (tx.type !== "deposit" && tx.type !== "withdrawal" && tx.type !== "transfer_in" && tx.type !== "transfer_out") continue;
    const amount = (tx.quantity || 0) * (tx.unit_price || 1);
    const currency = (tx as any).currency || "EUR";
    const rate = getBestExchangeRate(currency, baseCurrency, assetsCache, transactions);
    if (tx.type === "deposit") totalInvested += amount * rate;
    if (tx.type === "withdrawal") totalInvested -= amount * rate;
    if (tx.type === "transfer_in") totalInvested += amount * rate;
    if (tx.type === "transfer_out") totalInvested -= amount * rate;
  }

  const positionsValue = positions.reduce(
    (sum, p) => sum + p.currentValue * getBestExchangeRate(p.currency, baseCurrency, assetsCache, transactions),
    0
  );

  const cashValue = Object.entries(cashBalances || {}).reduce(
    (sum, [currency, amount]) => sum + amount * getBestExchangeRate(currency, baseCurrency, assetsCache, transactions),
    0
  );

  return {
    totalValue: positionsValue + cashValue,
    totalInvested,
  };
}

export function calculateCashBalance(
  transactions: Transaction[],
  assetsCache: AssetCache[] = [],
  baseCurrency = "EUR"
): number {
  const balances = calculateCashBalances(transactions);
  return Object.entries(balances).reduce(
    (s, [currency, amount]) => s + amount * getBestExchangeRate(currency, baseCurrency, assetsCache, transactions),
    0
  );
}

export function formatCurrency(value: number, currency = "EUR"): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export interface MarketStatus {
  name: string;
  isOpen: boolean;
}

/**
 * Returns { openMinutes, closeMinutes } in UTC for the exchange of a given ticker.
 * Returns null for FX pairs (trade 24/5).
 * Uses winter-time approximations (CET=UTC+1, EST=UTC-5, JST=UTC+9, HKT=UTC+8).
 */
export function getMarketScheduleUTC(ticker: string): { openMinutes: number; closeMinutes: number } | null {
  if (ticker.includes("=X")) return null; // FX pairs — always active on weekdays

  const dotIndex = ticker.lastIndexOf(".");
  const suffix = dotIndex >= 0 ? ticker.substring(dotIndex + 1).toUpperCase() : "";

  // Tokyo Stock Exchange — 9:00–15:00 JST = 0:00–6:00 UTC
  if (suffix === "T") return { openMinutes: 0, closeMinutes: 6 * 60 };

  // European exchanges — 9:00–17:30 CET = 8:00–16:30 UTC
  if (["PA", "AS", "MI", "DE", "BR", "SW", "MC", "L"].includes(suffix))
    return { openMinutes: 8 * 60, closeMinutes: 16 * 60 + 30 };

  // Hong Kong — 9:30–16:00 HKT = 1:30–8:00 UTC
  if (suffix === "HK") return { openMinutes: 1 * 60 + 30, closeMinutes: 8 * 60 };

  // US exchanges (no dot suffix) — 9:30–16:00 EST = 14:30–21:00 UTC
  return { openMinutes: 14 * 60 + 30, closeMinutes: 21 * 60 };
}

/**
 * Returns a human-readable exchange name from a ticker symbol.
 */
export function getMarketName(ticker: string): string {
  if (ticker.includes("=X")) return "Forex";

  const dotIndex = ticker.lastIndexOf(".");
  const suffix = dotIndex >= 0 ? ticker.substring(dotIndex + 1).toUpperCase() : "";

  const names: Record<string, string> = {
    PA: "Euronext Paris",
    AS: "Euronext Amsterdam",
    MI: "Borsa Italiana",
    DE: "Xetra",
    BR: "Euronext Bruxelles",
    SW: "SIX Swiss",
    MC: "BME Madrid",
    L: "LSE London",
    T: "Tokyo",
    HK: "Hong Kong",
  };

  return names[suffix] || "NYSE/NASDAQ";
}

/**
 * Returns true if the ticker's exchange is currently in its trading session.
 * On weekends, returns false for all tickers.
 */
export function isMarketCurrentlyOpen(ticker: string): boolean {
  const schedule = getMarketScheduleUTC(ticker);
  if (schedule === null) {
    // FX: open Mon–Fri
    const day = new Date().getUTCDay();
    return day !== 0 && day !== 6;
  }

  const now = new Date();
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;

  const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return currentMinutes >= schedule.openMinutes && currentMinutes < schedule.closeMinutes;
}

/**
 * Returns true if the ticker's exchange has already opened for today's session.
 * On weekends, returns false for all tickers.
 */
export function hasMarketOpenedToday(ticker: string): boolean {
  const schedule = getMarketScheduleUTC(ticker);
  if (schedule === null) return true; // FX always considered active

  const now = new Date();
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;

  const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return currentMinutes >= schedule.openMinutes;
}

/**
 * Returns a deduplicated list of markets with their open/closed status
 * for a given set of positions.
 */
export function getMarketStatusForPositions(positions: AssetPosition[]): MarketStatus[] {
  const seen = new Map<string, boolean>();
  for (const pos of positions) {
    if (pos.ticker.includes("=X")) continue; // skip FX
    const name = getMarketName(pos.ticker);
    if (!seen.has(name)) {
      seen.set(name, isMarketCurrentlyOpen(pos.ticker));
    }
  }
  return Array.from(seen.entries()).map(([name, isOpen]) => ({ name, isOpen }));
}

export function calculateDailyPerformance(
  positions: AssetPosition[],
  cashBalances: CashBalances,
  assetsCache: AssetCache[],
  totalValue: number,
  baseCurrency = "EUR",
  previousCloseMap: Record<string, number> = {},
  liveChangeMap: Record<string, number> = {},
  transactions: Transaction[] = []
) {
  let change = 0;

  // If at least one position's market has opened today, exclude stale ones.
  // If none have opened (weekend), include all to avoid showing empty data.
  const anyOpen = positions.some((p) => hasMarketOpenedToday(p.ticker));

  for (const pos of positions) {
    if (anyOpen && !hasMarketOpenedToday(pos.ticker)) continue;

    const cached = assetsCache.find(a => a.ticker === pos.ticker);

    // Priority 1: Use direct change percent from Yahoo if available (most accurate)
    if (liveChangeMap[pos.ticker] != null) {
      // varied value = currentValue / (1 + changePercent/100) -> this is previous value
      // change = currentValue - previousValue
      // simplified: change = currentValue - (currentValue / (1 + changePct)) 
      // Actually simpler: changeAmount = currentValue * (changePct / (1 + changePct)) if we assume current is the 'post-change' value.
      // Wait, Yahoo gives changePercent = (Price - Prev) / Prev.
      // So Price = Prev * (1 + Pct).
      // Prev = Price / (1 + Pct).
      // Diff = Price - Prev.

      const pct = liveChangeMap[pos.ticker] / 100;
      const denominator = 1 + pct;
      const prevCloseCalculated = denominator > 0 ? pos.currentPrice / denominator : null;
      const prevClose =
        (prevCloseCalculated && Number.isFinite(prevCloseCalculated) && prevCloseCalculated > 0)
          ? prevCloseCalculated
          : (previousCloseMap[pos.ticker] ?? (cached as any)?.previous_close ?? pos.currentPrice);
      const priceDiff = pos.currentPrice - prevClose;
      const rate = getBestExchangeRate(pos.currency, baseCurrency, assetsCache, transactions);
      change += pos.quantity * priceDiff * rate;
    } else {
      // Priority 2: Fallback to previous close calculation
      const prevClose = previousCloseMap[pos.ticker] ?? (cached as any)?.previous_close ?? pos.currentPrice;
      const priceDiff = pos.currentPrice - prevClose;
      const rate = getBestExchangeRate(pos.currency, baseCurrency, assetsCache, transactions);
      change += pos.quantity * priceDiff * rate;
    }
  }

  // FX impact on cash balances (FX trades 24/5, always included)
  for (const [cur, amount] of Object.entries(cashBalances || {})) {
    if (cur === baseCurrency || Math.abs(amount) < 0.01) continue;
    const currentRate = getBestExchangeRate(cur, baseCurrency, assetsCache, transactions);
    const prevRate = getPreviousExchangeRate(cur, baseCurrency, assetsCache, previousCloseMap, transactions);
    change += amount * (currentRate - prevRate);
  }

  const previousTotal = totalValue - change;
  const changePct = previousTotal > 0 ? (change / previousTotal) * 100 : 0;

  return { change, changePct };
}
