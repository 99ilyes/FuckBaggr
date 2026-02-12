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

  // Calculate daily performance: sum of (qty * (currentPrice - previousClose)) per position, in base currency
  const dailyPerf = useMemo(() => {
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
  }, [positions, cashBalances, assetsCache, baseCurrency, previousCloseMap, totalValue]);

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
