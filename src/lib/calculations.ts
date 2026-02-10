import { Transaction, AssetCache } from "@/hooks/usePortfolios";

export interface AssetPosition {
  ticker: string;
  name: string;
  quantity: number;
  pru: number; // Prix de Revient Unitaire
  currentPrice: number;
  totalInvested: number;
  currentValue: number;
  gainLoss: number;
  gainLossPercent: number;
  sector: string;
}

export function calculatePositions(
  transactions: Transaction[],
  assetsCache: AssetCache[]
): AssetPosition[] {
  const cacheMap = new Map(assetsCache.map((a) => [a.ticker, a]));
  const positions = new Map<string, { quantity: number; totalCost: number }>();

  // Process buy/sell transactions
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

export function calculateCashBalance(transactions: Transaction[]): number {
  let cash = 0;
  for (const tx of transactions) {
    if (tx.type === "deposit") {
      cash += (tx.quantity || 0) * (tx.unit_price || 1);
    } else if (tx.type === "withdrawal") {
      cash -= (tx.quantity || 0) * (tx.unit_price || 1);
    } else if (tx.type === "buy" && tx.quantity && tx.unit_price) {
      cash -= tx.quantity * tx.unit_price + tx.fees;
    } else if (tx.type === "sell" && tx.quantity && tx.unit_price) {
      cash += tx.quantity * tx.unit_price - tx.fees;
    }
  }
  return cash;
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}
