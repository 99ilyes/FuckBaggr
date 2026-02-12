import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Wallet, CalendarClock, Coins } from "lucide-react";
import { formatCurrency, formatPercent, CashBalances, AssetPosition, getExchangeRate } from "@/lib/calculations";
import { useMemo } from "react";
import { AssetCache, Transaction } from "@/hooks/usePortfolios";

interface KPICardsProps {
  totalValue: number;
  totalInvested: number;
  totalGainLoss: number;
  totalGainLossPercent: number;
  assetCount: number;
  cashBalances: CashBalances;
  cashBalance: number;
  positions: AssetPosition[];
  assetsCache: AssetCache[];
  baseCurrency?: string;
  previousCloseMap?: Record<string, number>;
  transactions?: Transaction[];
}

export function KPICards({
  totalValue,
  totalInvested,
  totalGainLoss,
  totalGainLossPercent,
  assetCount,
  cashBalances,
  cashBalance,
  positions,
  assetsCache,
  baseCurrency = "EUR",
  previousCloseMap = {},
  transactions = [],
}: KPICardsProps) {
  const isPositive = totalGainLoss >= 0;
  const currencies = Object.entries(cashBalances || {}).filter(
    ([, amount]) => Math.abs(amount) >= 0.01
  );

  // Calculate daily performance (True P&L: Change in Portfolio Value adjusted for Net Flows)
  const dailyPerf = useMemo(() => {
    // Helper to get previous exchange rate
    const getPrevRate = (currency: string) => {
      if (currency === baseCurrency) return 1;
      // Direct pair: e.g. USDEUR=X
      const directTicker = `${currency}${baseCurrency}=X`;
      if (previousCloseMap[directTicker]) return previousCloseMap[directTicker];
      const directCached = assetsCache.find(a => a.ticker === directTicker);
      if (directCached?.previous_close) return directCached.previous_close;
      if (directCached?.last_price) return directCached.last_price;

      // Inverted pair
      const invertedTicker = `${baseCurrency}${currency}=X`;
      if (previousCloseMap[invertedTicker]) return 1 / previousCloseMap[invertedTicker];
      const invertedCached = assetsCache.find(a => a.ticker === invertedTicker);
      if (invertedCached?.previous_close) return 1 / invertedCached.previous_close;
      if (invertedCached?.last_price) return 1 / invertedCached.last_price;

      console.warn(`Missing FX rate for ${currency}. Available keys:`, Object.keys(previousCloseMap));
      return 1;
    };

    // 1. Reconstruct Previous Portfolio State
    const prevAssets = new Map<string, number>(); // ticker -> qty
    positions.forEach(p => prevAssets.set(p.ticker, p.quantity));

    const prevCash = { ...cashBalances };
    let netFlowsValue = 0;

    // Filter for TODAY's transactions
    // Assuming t.date is ISO or parseable and consistent timezone
    const todayString = new Date().toDateString();

    const todayTxs = transactions.filter(t => new Date(t.date).toDateString() === todayString);

    todayTxs.forEach(tx => {
      const cur = tx.currency || "EUR";
      const quantity = tx.quantity || 0;
      const price = tx.unit_price || 0;
      const fees = tx.fees || 0;
      const amount = quantity * price;

      const currentRate = getExchangeRate(cur, baseCurrency, assetsCache);

      if (tx.type === 'buy') {
        // Revert buy: Cash + (Amount + Fees), Asset - Qty
        prevCash[cur] = (prevCash[cur] || 0) + (amount + fees);
        if (tx.ticker) prevAssets.set(tx.ticker, (prevAssets.get(tx.ticker) || 0) - quantity);
      } else if (tx.type === 'sell') {
        // Revert sell: Cash - (Amount - Fees), Asset + Qty
        prevCash[cur] = (prevCash[cur] || 0) - (amount - fees);
        if (tx.ticker) prevAssets.set(tx.ticker, (prevAssets.get(tx.ticker) || 0) + quantity);
      } else if (tx.type === 'deposit') {
        // Revert deposit: Cash - Amount
        prevCash[cur] = (prevCash[cur] || 0) - amount;
        netFlowsValue += (amount * currentRate);
      } else if (tx.type === 'withdrawal') {
        // Revert withdrawal: Cash + Amount
        prevCash[cur] = (prevCash[cur] || 0) + amount;
        netFlowsValue -= (amount * currentRate);
      } else if (tx.type === 'conversion') {
        const src = tx.ticker || "EUR";
        // Revert conversion: Src + (Cost + Fees), Dest - Qty
        prevCash[src] = (prevCash[src] || 0) + (amount + fees);
        prevCash[cur] = (prevCash[cur] || 0) - quantity;
      }
    });

    // 2. Calculate Previous Total Value
    let previousTotalBase = 0;

    prevAssets.forEach((qty, ticker) => {
      if (qty <= 0.000001) return;
      const cached = assetsCache.find(a => a.ticker === ticker);
      const prevPrice = previousCloseMap[ticker] || cached?.previous_close || cached?.last_price || 0;
      const currency = cached?.currency || "USD";
      const rate = getPrevRate(currency);
      previousTotalBase += qty * prevPrice * rate;
    });

    Object.entries(prevCash).forEach(([cur, amount]) => {
      if (Math.abs(amount) < 0.01) return;
      const rate = getPrevRate(cur);
      previousTotalBase += amount * rate;
    });

    // 3. P&L
    const change = totalValue - previousTotalBase - netFlowsValue;
    const changePct = previousTotalBase > 0 ? (change / previousTotalBase) * 100 : 0;

    return { change, changePct };
  }, [positions, cashBalances, transactions, assetsCache, baseCurrency, previousCloseMap, totalValue]);

  const isDayPositive = dailyPerf.change >= 0;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:gap-4">
      <Card className="border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Wallet className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">Valeur totale</span>
          </div>
          <p className="text-xl font-semibold tracking-tight">{formatCurrency(totalValue, baseCurrency)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Investi: {formatCurrency(totalInvested, baseCurrency)}
          </p>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            {isPositive ? (
              <TrendingUp className="h-4 w-4 text-gain" />
            ) : (
              <TrendingDown className="h-4 w-4 text-loss" />
            )}
            <span className="text-xs font-medium uppercase tracking-wider">Performance</span>
          </div>
          <p className={`text-xl font-semibold tracking-tight ${isPositive ? "text-gain" : "text-loss"}`}>
            {formatPercent(totalGainLossPercent)}
          </p>
          <p className={`text-xs mt-1 ${isPositive ? "text-gain/70" : "text-loss/70"}`}>
            {formatCurrency(totalGainLoss, baseCurrency)}
          </p>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <CalendarClock className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">Perf du jour</span>
          </div>
          <p className={`text-xl font-semibold tracking-tight ${isDayPositive ? "text-gain" : "text-loss"}`}>
            {formatPercent(dailyPerf.changePct)}
          </p>
          <p className={`text-xs mt-1 ${isDayPositive ? "text-gain/70" : "text-loss/70"}`}>
            {formatCurrency(dailyPerf.change, baseCurrency)}
          </p>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Coins className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">Cash</span>
          </div>
          {currencies.length === 0 ? (
            <>
              <p className="text-xl font-semibold tracking-tight">
                {formatCurrency(0, baseCurrency)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Disponible</p>
            </>
          ) : currencies.length === 1 ? (
            <>
              <p className="text-xl font-semibold tracking-tight">
                {formatCurrency(currencies[0][1], currencies[0][0])}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Disponible</p>
            </>
          ) : (
            <div className="space-y-0.5">
              {currencies.map(([cur, amount]) => (
                <p key={cur} className="text-sm font-semibold tracking-tight">
                  {formatCurrency(amount, cur)}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
