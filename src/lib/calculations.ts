import { Transaction, AssetCache } from "@/hooks/usePortfolios";

export interface AssetPosition {
  ticker: string;
  name: string;
  quantity: number;
  pru: number;
  currentPrice: number;
  totalInvested: number;
  currentValue: number;
  gainLoss: number;
  gainLossPercent: number;
  sector: string;
}

export interface CashBalances {
  [currency: string]: number;
}

export function calculatePositions(
  transactions: Transaction[],
  assetsCache: AssetCache[]
): AssetPosition[] {
  const cacheMap = new Map(assetsCache.map((a) => [a.ticker, a]));
  const positions = new Map<string, { quantity: number; totalCost: number }>();

  for (const tx of transactions) {
    if (!tx.ticker || !tx.quantity || !tx.unit_price) continue;
    if (tx.type !== "buy" && tx.type !== "sell") continue;

    const pos = positions.get(tx.ticker) || { quantity: 0, totalCost: 0 };

    if (tx.type === "buy") {
      pos.totalCost += tx.quantity * tx.unit_price + tx.fees;
      pos.quantity += tx.quantity;
    } else if (tx.type === "sell") {
      if (pos.quantity > 0) {
        const pru = pos.totalCost / pos.quantity;
        pos.totalCost -= tx.quantity * pru;
        pos.quantity -= tx.quantity;
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

    result.push({
      ticker,
      name: cached?.name || ticker,
      quantity: pos.quantity,
      pru,
      currentPrice,
      totalInvested: pos.totalCost,
      currentValue,
      gainLoss,
      gainLossPercent,
      sector: cached?.sector || "Autre",
    });
  }

  return result.sort((a, b) => b.currentValue - a.currentValue);
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
