import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Wallet, CalendarClock, Coins } from "lucide-react";
import { formatCurrency, formatPercent, CashBalances, AssetPosition, calculateDailyPerformance, getMarketStatusForPositions, MarketStatus } from "@/lib/calculations";
import { useMemo } from "react";
import { AssetCache, Transaction } from "@/hooks/usePortfolios";

export interface PortfolioPerformance {
  id: string;
  name: string;
  color: string;
  dailyChange: number;
  dailyChangePct: number;
  currency: string;
  totalValue: number;
  hasAnyOpenMarket: boolean;
  marketsInfo: MarketStatus[];
}

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
  portfolioPerformances?: PortfolioPerformance[];
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
  portfolioPerformances = [],
}: KPICardsProps) {
  const isPositive = totalGainLoss >= 0;
  const currencies = Object.entries(cashBalances || {}).filter(
    ([, amount]) => Math.abs(amount) >= 0.01
  );

  // Calculate daily performance: sum of (qty * (currentPrice - previousClose)) per position, in base currency
  const dailyPerf = useMemo(() => {
    return calculateDailyPerformance(
      positions,
      cashBalances,
      assetsCache,
      totalValue,
      baseCurrency,
      previousCloseMap
    );
  }, [positions, cashBalances, assetsCache, baseCurrency, previousCloseMap, totalValue]);

  const isDayPositive = dailyPerf.change >= 0;

  // Compute market status for the current positions (portfolio view)
  const marketsInfo = useMemo(() => {
    if (portfolioPerformances && portfolioPerformances.length > 0) return []; // global view, handled differently
    return getMarketStatusForPositions(positions);
  }, [positions, portfolioPerformances]);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 lg:gap-4">
      <Card className="border-border/50">
        <CardContent className="p-4 flex flex-col items-center h-full text-center">
          <div className="flex items-center justify-center gap-2 text-muted-foreground mb-2 w-full">
            <Wallet className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">Valeur totale</span>
          </div>
          <div className="flex-1 flex flex-col justify-center w-full">
            <p className="text-2xl font-bold tracking-tight">{formatCurrency(totalValue, baseCurrency)}</p>
            <p className="text-sm text-muted-foreground mt-1">
              Investi: {formatCurrency(totalInvested, baseCurrency)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardContent className="p-4 flex flex-col items-center h-full text-center">
          <div className="flex items-center justify-center gap-2 text-muted-foreground mb-2 w-full">
            {isPositive ? (
              <TrendingUp className="h-4 w-4 text-emerald-500" />
            ) : (
              <TrendingDown className="h-4 w-4 text-rose-500" />
            )}
            <span className="text-xs font-medium uppercase tracking-wider">Performance</span>
          </div>
          <div className="flex-1 flex flex-col justify-center w-full">
            <p className={`text-2xl font-bold tracking-tight ${isPositive ? "text-emerald-500" : "text-rose-500"}`}>
              {formatPercent(totalGainLossPercent)}
            </p>
            <p className={`text-sm mt-1 ${isPositive ? "text-emerald-500/70" : "text-rose-500/70"}`}>
              {formatCurrency(totalGainLoss, baseCurrency)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardContent className="p-4 flex flex-col items-center h-full text-center">
          <div className="flex items-center justify-center gap-2 text-muted-foreground mb-2 w-full">
            <CalendarClock className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">Perf du jour</span>
          </div>
          <div className="flex-1 flex flex-col justify-center w-full">
            <p className={`text-2xl font-bold tracking-tight ${isDayPositive ? "text-emerald-500" : "text-rose-500"}`}>
              {formatPercent(dailyPerf.changePct)}
            </p>
            <p className={`text-sm mt-1 ${isDayPositive ? "text-emerald-500/70" : "text-rose-500/70"}`}>
              {formatCurrency(dailyPerf.change, baseCurrency)}
            </p>
          </div>
          {/* Portfolio view: show market open/closed status */}
          {marketsInfo.length > 0 && (
            <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-2 pt-2 border-t border-border/30 w-full">
              {marketsInfo.map((m) => (
                <span key={m.name} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className={`w-1.5 h-1.5 rounded-full ${m.isOpen ? "bg-emerald-500" : "bg-rose-500/60"}`} />
                  {m.name}
                </span>
              ))}
            </div>
          )}
          {/* Global view: show which portfolios are contributing */}
          {portfolioPerformances && portfolioPerformances.length > 0 && (
            <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-2 pt-2 border-t border-border/30 w-full">
              {portfolioPerformances.map((p) => (
                <span key={p.id} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className={`w-1.5 h-1.5 rounded-full ${p.hasAnyOpenMarket ? "bg-emerald-500" : "bg-rose-500/60"}`} />
                  {p.name}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardContent className="p-4 h-full flex flex-col items-center text-center">
          {portfolioPerformances && portfolioPerformances.length > 0 ? (
            <>
              <div className="flex items-center justify-center gap-2 text-muted-foreground mb-2 w-full">
                <TrendingUp className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-wider">Détail par portefeuille</span>
              </div>
              <div className="flex-1 flex flex-col justify-center w-full divide-y divide-border/40">
                {portfolioPerformances.map((perf) => (
                  <div key={perf.id} className="flex items-center justify-between w-full min-w-0 gap-3 py-2 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0 ring-2 ring-background"
                        style={{ backgroundColor: perf.color }}
                      />
                      <span className="text-sm font-semibold truncate" title={perf.name}>
                        {perf.name}
                      </span>
                    </div>

                    <div className="flex flex-col items-end shrink-0 ml-auto">
                      <span className="text-base font-bold tabular-nums leading-tight">
                        {formatCurrency(perf.totalValue, perf.currency)}
                      </span>
                      <span className={`text-xs tabular-nums leading-tight ${perf.dailyChange >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                        {perf.dailyChange > 0 ? "+" : ""}{formatCurrency(perf.dailyChange, perf.currency)} ({formatPercent(perf.dailyChangePct)})
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-center gap-2 text-muted-foreground mb-2 w-full">
                <Coins className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-wider">Cash</span>
              </div>
              <div className="flex-1 flex flex-col justify-center w-full">
                {currencies.length === 0 ? (
                  <>
                    <p className="text-2xl font-bold tracking-tight">
                      {formatCurrency(0, baseCurrency)}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">Disponible</p>
                  </>
                ) : currencies.length === 1 ? (
                  <>
                    <p className="text-2xl font-bold tracking-tight">
                      {formatCurrency(currencies[0][1], currencies[0][0])}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">Disponible</p>
                  </>
                ) : (
                  <div className="space-y-0.5">
                    {currencies.map(([cur, amount]) => (
                      <p key={cur} className="text-sm font-bold tracking-tight">
                        {formatCurrency(amount, cur)}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
