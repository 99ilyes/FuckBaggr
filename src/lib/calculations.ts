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
    if (tx.type !== "buy" && tx.type !== "sell") continue;

    const pos = positions.get(tx.ticker) || {
      quantity: 0,
      totalCost: 0,
      currency: (tx as any).currency || "EUR",
    };

    if (tx.type === "buy") {
      pos.totalCost += tx.quantity * tx.unit_price + tx.fees;
      pos.quantity += tx.quantity;
    } else if (tx.type === "sell") {
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
    }
  }

  // Remove zero balances
  for (const key of Object.keys(balances)) {
    if (Math.abs(balances[key]) < 0.001) delete balances[key];
  }

  return balances;
}

// Helper to get exchange rate from cache
export function getExchangeRate(from: string, to: string, cache: AssetCache[]): number {
  if (from === to) return 1;
  // Try direct pair
  const direct = cache.find(a => a.ticker === `${from}${to}=X`);
  if (direct?.last_price) return direct.last_price;

  // Try inverted pair
  const inverted = cache.find(a => a.ticker === `${to}${from}=X`);
  if (inverted?.last_price) return 1 / inverted.last_price;

  return 1; // Fallback assumes 1:1 if rate missing (should ideally warn)
}

export function calculatePortfolioStats(
  positions: AssetPosition[],
  cashBalances: CashBalances,
  assetsCache: AssetCache[],
  transactions: Transaction[],
  baseCurrency = "EUR"
) {
  let totalInvested = 0;

  for (const tx of transactions) {
    if (tx.type === "deposit") {
      const amount = (tx.quantity || 0) * (tx.unit_price || 1);
      const currency = (tx as any).currency || "EUR";
      const rate = getExchangeRate(currency, baseCurrency, assetsCache);
      totalInvested += amount * rate;
    } else if (tx.type === "withdrawal") {
      const amount = (tx.quantity || 0) * (tx.unit_price || 1);
      const currency = (tx as any).currency || "EUR";
      const rate = getExchangeRate(currency, baseCurrency, assetsCache);
      totalInvested -= amount * rate;
    }
  }

  return {
    totalValue: positions.reduce((s, p) => s + p.currentValue * getExchangeRate(p.currency, baseCurrency, assetsCache), 0) +
      Object.entries(cashBalances).reduce((s, [c, a]) => s + a * getExchangeRate(c, baseCurrency, assetsCache), 0),
    totalInvested,
  };
}

/** Legacy single-currency cash balance (sum of all) */
export function calculateCashBalance(transactions: Transaction[]): number {
  const balances = calculateCashBalances(transactions);
  return Object.values(balances).reduce((s, v) => s + v, 0);
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

export function calculateDailyPerformance(
  positions: AssetPosition[],
  cashBalances: CashBalances,
  assetsCache: AssetCache[],
  totalValue: number,
  baseCurrency = "EUR",
  previousCloseMap: Record<string, number> = {}
) {
  let change = 0;

  for (const pos of positions) {
    const cached = assetsCache.find(a => a.ticker === pos.ticker);
    const prevClose = previousCloseMap[pos.ticker] ?? (cached as any)?.previous_close ?? pos.currentPrice;
    const priceDiff = pos.currentPrice - prevClose;
    const rate = getExchangeRate(pos.currency, baseCurrency, assetsCache);
    change += pos.quantity * priceDiff * rate;
  }

  // FX impact on cash balances
  for (const [cur, amount] of Object.entries(cashBalances || {})) {
    if (cur === baseCurrency || Math.abs(amount) < 0.01) continue;
    const currentRate = getExchangeRate(cur, baseCurrency, assetsCache);
    const fxTicker = `${cur}${baseCurrency}=X`;
    const fxTickerInv = `${baseCurrency}${cur}=X`;
    const cached = assetsCache.find(a => a.ticker === fxTicker);
    const cachedInv = assetsCache.find(a => a.ticker === fxTickerInv);
    const prevRate = previousCloseMap[fxTicker] ?? (cached as any)?.previous_close ??
      (previousCloseMap[fxTickerInv] ? 1 / previousCloseMap[fxTickerInv] : null) ??
      ((cachedInv as any)?.previous_close ? 1 / (cachedInv as any).previous_close : currentRate);
    change += amount * (currentRate - prevRate);
  }

  const previousTotal = totalValue - change;
  const changePct = previousTotal > 0 ? (change / previousTotal) * 100 : 0;

  return { change, changePct };
}
