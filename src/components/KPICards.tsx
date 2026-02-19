import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Wallet, CalendarClock, Coins } from "lucide-react";
import { SaxoLogo, IBKRLogo, getBrokerForPortfolio } from "@/components/BrokerLogos";
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
  onSelectPortfolio?: (id: string) => void;
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
  onSelectPortfolio,
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
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4 lg:gap-6">
      <Card className="border-0 bg-transparent shadow-none">
        <CardContent className="p-0 flex flex-col items-center justify-center h-full text-center">
          <div className="flex items-center justify-center gap-2 text-muted-foreground/60 mb-1 w-full">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em]">Valeur Totale</span>
          </div>
          <div className="flex-1 flex flex-col justify-center w-full">
            <p className="text-4xl sm:text-3xl md:text-4xl font-bold tracking-tighter text-foreground">
              {formatCurrency(totalValue, baseCurrency)}
            </p>
            <p className="text-xs text-muted-foreground/50 mt-1 font-medium">
              Investi: {formatCurrency(totalInvested, baseCurrency)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 bg-transparent shadow-none">
        <CardContent className="p-0 flex flex-col items-center justify-center h-full text-center">
          <div className="flex items-center justify-center gap-2 text-muted-foreground/60 mb-1 w-full">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em]">Performance</span>
          </div>
          <div className="flex-1 flex flex-col justify-center w-full">
            <div className="flex items-baseline justify-center gap-2">
              <p className={`text-4xl sm:text-3xl md:text-4xl font-bold tracking-tighter ${isPositive ? "text-emerald-500" : "text-rose-500"}`}>
                {formatPercent(totalGainLossPercent)}
              </p>
            </div>
            <p className={`text-xs mt-1 font-medium ${isPositive ? "text-emerald-500/60" : "text-rose-500/60"}`}>
              {isPositive ? "+" : ""}{formatCurrency(totalGainLoss, baseCurrency)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 bg-transparent shadow-none">
        <CardContent className="p-0 flex flex-col items-center justify-center h-full text-center">
          <div className="flex items-center justify-center gap-2 text-muted-foreground/60 mb-1 w-full">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em]">Jour</span>
          </div>
          <div className="flex-1 flex flex-col justify-center w-full">
            <p className={`text-4xl sm:text-3xl md:text-4xl font-bold tracking-tighter ${isDayPositive ? "text-emerald-500" : "text-rose-500"}`}>
              {formatPercent(dailyPerf.changePct)}
            </p>
            <p className={`text-xs mt-1 font-medium ${isDayPositive ? "text-emerald-500/60" : "text-rose-500/60"}`}>
              {isDayPositive ? "+" : ""}{formatCurrency(dailyPerf.change, baseCurrency)}
            </p>
          </div>
          {/* Market Status Indicators */}
          {marketsInfo.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2 mt-3 w-full">
              {marketsInfo.map((m) => (
                <div key={m.name} className="flex items-center gap-1.5" title={`${m.name}: ${m.isOpen ? "Ouvert" : "Fermé"}`}>
                  <span className={`relative flex h-1.5 w-1.5`}>
                    {m.isOpen && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                    <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${m.isOpen ? "bg-emerald-500" : "bg-zinc-700"}`}></span>
                  </span>
                  <span className="text-[9px] font-medium text-muted-foreground uppercase">{m.name}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-0 bg-transparent shadow-none">
        <CardContent className="p-0 h-full flex flex-col items-center text-center justify-center">
          {portfolioPerformances && portfolioPerformances.length > 0 ? (
            <>
              <div className="flex items-center justify-center gap-2 text-muted-foreground/60 mb-1 w-full">
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em]">Portefeuilles</span>
              </div>
              <div className="w-full space-y-1">
                {portfolioPerformances.map((perf) => (
                  <div
                    key={perf.id}
                    className="flex items-center justify-between w-full min-w-0 gap-3 cursor-pointer hover:bg-zinc-900/50 rounded-md p-1 -mx-1 transition-colors"
                    onClick={() => onSelectPortfolio?.(perf.id)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {getBrokerForPortfolio(perf.name) === "saxo" && <SaxoLogo className="w-5 h-5 rounded-[2px] opacity-80" />}
                      {getBrokerForPortfolio(perf.name) === "ibkr" && <IBKRLogo className="w-5 h-5 rounded-[2px] opacity-80" />}
                      <span className="text-sm font-semibold text-muted-foreground truncate" title={perf.name}>
                        {perf.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 ml-auto">
                      <span className="text-lg font-bold text-foreground tabular-nums tracking-tight">
                        {formatCurrency(perf.totalValue, perf.currency)}
                      </span>
                      <span className={`text-xs font-semibold tabular-nums ${perf.dailyChange >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                        {formatPercent(perf.dailyChangePct)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-center gap-2 text-muted-foreground/60 mb-1 w-full">
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em]">Cash</span>
              </div>
              <div className="flex-1 flex flex-col justify-center w-full">
                {/* Existing Cash Logic can remain simplified */}
                <p className="text-2xl font-bold tracking-tight text-foreground">
                  {formatCurrency(cashBalance, baseCurrency)}
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
