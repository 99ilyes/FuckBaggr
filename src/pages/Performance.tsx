import { useState, useMemo } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  usePortfolios,
  useTransactions,
  useAssetsCache,
  useHistoricalPrices,
} from "@/hooks/usePortfolios";
import { PortfolioSelector } from "@/components/PortfolioSelector";
import { CreatePortfolioDialog } from "@/components/CreatePortfolioDialog";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { TrendingUp, TrendingDown, Wallet, BarChart3, Loader2 } from "lucide-react";
import {
  computeTWR,
  filterByRange,
  rebaseTWR,
  getFxTicker,
  TimeRange,
  PortfolioTWRResult,
} from "@/lib/twr";
import {
  calculatePositions,
  calculateCashBalances,
  calculatePortfolioStats,
  formatCurrency,
  formatPercent,
} from "@/lib/calculations";

// ─── Range selector ────────────────────────────────────────────────────────────

const RANGES: TimeRange[] = ["6M", "1Y", "2Y", "5Y", "MAX"];

function RangeSelector({ value, onChange }: { value: TimeRange; onChange: (r: TimeRange) => void }) {
  return (
    <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
      {RANGES.map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
            value === r
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KPICard({
  label,
  value,
  sub,
  positive,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
            <p
              className={`text-2xl font-bold tabular-nums ${
                positive === undefined
                  ? "text-foreground"
                  : positive
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-500"
              }`}
            >
              {value}
            </p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className="text-muted-foreground mt-1">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Custom tooltip ────────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-popover border border-border rounded-lg shadow-lg p-3 text-sm">
      <p className="text-muted-foreground mb-2 font-medium">{label}</p>
      {payload.map((entry: any) => (
        <div key={entry.dataKey} className="flex items-center gap-2 mb-1">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ background: entry.color }}
          />
          <span className="text-foreground font-medium">{entry.name}:</span>
          <span className="text-foreground">
            {entry.name === "TWR" || String(entry.name).includes("%")
              ? `${(entry.value * 100).toFixed(2)}%`
              : formatCurrency(entry.value, "EUR")}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Performance() {
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(null);
  const [range, setRange] = useState<TimeRange>("1Y");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const { data: portfolios = [] } = usePortfolios();
  const { data: allTransactions = [] } = useTransactions();
  const { data: assetsCache = [] } = useAssetsCache();

  // Transactions filtered to selected portfolio (or all)
  const activeTx = useMemo(
    () =>
      selectedPortfolioId
        ? allTransactions.filter((tx) => tx.portfolio_id === selectedPortfolioId)
        : allTransactions,
    [allTransactions, selectedPortfolioId]
  );

  // ── Live KPIs (match dashboard exactly) ──────────────────────────────────
  const livePositions = useMemo(
    () => calculatePositions(activeTx, assetsCache),
    [activeTx, assetsCache]
  );
  const liveCashBalances = useMemo(() => calculateCashBalances(activeTx), [activeTx]);
  const { totalValue: currentValueEUR, totalInvested: totalInvestedEUR } = useMemo(
    () => calculatePortfolioStats(livePositions, liveCashBalances, assetsCache, activeTx),
    [livePositions, liveCashBalances, assetsCache, activeTx]
  );

  // ── Historical data for TWR chart ─────────────────────────────────────────

  // Build asset currencies from assets cache
  const assetCurrencies = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of assetsCache) {
      if (a.ticker && a.currency) map[a.ticker] = a.currency;
    }
    return map;
  }, [assetsCache]);

  // Unique tickers from buy/sell transactions
  const allTickers = useMemo(() => {
    const s = new Set<string>();
    for (const tx of allTransactions) {
      if (tx.ticker && (tx.type === "buy" || tx.type === "sell")) s.add(tx.ticker);
    }
    return Array.from(s);
  }, [allTransactions]);

  // FX tickers needed to convert non-EUR currencies to EUR historically
  const fxTickers = useMemo(() => {
    const currencies = new Set<string>();
    for (const tx of allTransactions) {
      if (tx.currency && tx.currency !== "EUR") currencies.add(tx.currency);
    }
    for (const ticker of allTickers) {
      const c = assetCurrencies[ticker];
      if (c && c !== "EUR") currencies.add(c);
    }
    return Array.from(currencies)
      .map(getFxTicker)
      .filter(Boolean) as string[];
  }, [allTransactions, allTickers, assetCurrencies]);

  const tickersToFetch = useMemo(
    () => [...new Set([...allTickers, ...fxTickers])],
    [allTickers, fxTickers]
  );

  const { data: historyMap = {}, isLoading: historyLoading } = useHistoricalPrices(
    tickersToFetch,
    "5y",
    "1wk"
  );

  // Enrich assetCurrencies from history (Yahoo tells us the currency)
  const enrichedCurrencies = useMemo(() => {
    const map = { ...assetCurrencies };
    for (const [ticker, asset] of Object.entries(historyMap)) {
      if (!map[ticker] && asset.currency) map[ticker] = asset.currency;
    }
    return map;
  }, [assetCurrencies, historyMap]);

  // ── Compute TWR per portfolio ─────────────────────────────────────────────

  /**
   * Build a filtered historyMap containing only the tickers relevant to a
   * specific set of transactions (+ FX tickers needed for that portfolio's currencies).
   */
  const buildScopedHistory = useMemo(() => {
    return (txs: typeof allTransactions) => {
      const relevant = new Set<string>();
      // Include only tickers that appear in these specific transactions
      for (const tx of txs) {
        if (tx.ticker && (tx.type === "buy" || tx.type === "sell")) {
          relevant.add(tx.ticker);
        }
      }
      // Include FX tickers for currencies used in this portfolio's transactions
      const portfolioCurrencies = new Set<string>();
      for (const tx of txs) {
        if (tx.currency && tx.currency !== "EUR") portfolioCurrencies.add(tx.currency);
        // conversion source currency
        if (tx.type === "conversion" && tx.ticker && tx.ticker !== "EUR") portfolioCurrencies.add(tx.ticker);
      }
      // Also include FX for asset currencies of tickers in this portfolio
      for (const t of relevant) {
        const c = assetCurrencies[t] || historyMap[t]?.currency;
        if (c && c !== "EUR") portfolioCurrencies.add(c);
      }
      for (const c of portfolioCurrencies) {
        const fx = getFxTicker(c);
        if (fx) relevant.add(fx);
      }
      const scoped: typeof historyMap = {};
      for (const t of relevant) {
        if (historyMap[t]) scoped[t] = historyMap[t];
      }
      return scoped;
    };
  }, [historyMap, assetCurrencies]);

  const portfolioResults = useMemo((): PortfolioTWRResult[] => {
    if (historyLoading || allTransactions.length === 0) return [];
    return portfolios.map((p) => {
      const pTxs = allTransactions.filter((tx) => tx.portfolio_id === p.id);
      const scopedHistory = buildScopedHistory(pTxs);
      // Build assetCurrencies scoped to this portfolio only
      const scopedCurrencies: Record<string, string> = {};
      for (const a of assetsCache) {
        if (a.ticker && a.currency) scopedCurrencies[a.ticker] = a.currency;
      }
      for (const [ticker, asset] of Object.entries(scopedHistory)) {
        if (!scopedCurrencies[ticker] && asset.currency) scopedCurrencies[ticker] = asset.currency;
      }
      return computeTWR({
        transactions: pTxs,
        historyMap: scopedHistory,
        assetCurrencies: scopedCurrencies,
        portfolioId: p.id,
        portfolioName: p.name,
        color: p.color,
      });
    });
  }, [portfolios, allTransactions, historyMap, assetsCache, buildScopedHistory, historyLoading]);

  // Total TWR (all portfolios combined)
  const totalResult = useMemo((): PortfolioTWRResult | null => {
    if (historyLoading || allTransactions.length === 0) return null;
    if (portfolios.length === 1) return portfolioResults[0] ?? null;
    return computeTWR({
      transactions: allTransactions,
      historyMap,
      assetCurrencies: enrichedCurrencies,
      portfolioId: "total",
      portfolioName: "Total",
      color: "hsl(var(--primary))",
    });
  }, [portfolios, portfolioResults, allTransactions, historyMap, enrichedCurrencies, historyLoading]);

  const activeResult = useMemo(() => {
    if (selectedPortfolioId === null) return totalResult;
    return portfolioResults.find((r) => r.portfolioId === selectedPortfolioId) ?? null;
  }, [selectedPortfolioId, totalResult, portfolioResults]);

  // ── Chart data: filter range + rebase TWR ────────────────────────────────
  const chartData = useMemo(() => {
    if (!activeResult) return [];
    const filtered = filterByRange(activeResult.dataPoints, range);
    const rebased = rebaseTWR(filtered);
    return rebased.map((d) => ({
      date: d.date,
      value: Math.round(d.valueEUR * 100) / 100,
      twr: Math.round(d.twr * 10000) / 10000,
    }));
  }, [activeResult, range]);

  // ── Displayed TWR for the selected range (rebased) ───────────────────────
  const displayedTWR = useMemo(() => {
    if (!activeResult || activeResult.dataPoints.length === 0) return 0;
    const filtered = filterByRange(activeResult.dataPoints, range);
    const rebased = rebaseTWR(filtered);
    return rebased.length > 0 ? rebased[rebased.length - 1].twr : 0;
  }, [activeResult, range]);

  // Annualised TWR for selected range
  const annualisedTWR = useMemo(() => {
    if (!activeResult) return 0;
    const filtered = filterByRange(activeResult.dataPoints, range);
    if (filtered.length < 2) return 0;
    const rebased = rebaseTWR(filtered);
    const first = new Date(rebased[0].date).getTime();
    const last = new Date(rebased[rebased.length - 1].date).getTime();
    const years = (last - first) / (365.25 * 24 * 3600 * 1000);
    if (years <= 0) return 0;
    const twr = rebased[rebased.length - 1].twr;
    return Math.pow(1 + twr, 1 / years) - 1;
  }, [activeResult, range]);

  // ── Multi-portfolio comparison ───────────────────────────────────────────
  const comparisonChartData = useMemo(() => {
    if (selectedPortfolioId !== null || portfolioResults.length <= 1) return [];
    const allDates = new Set<string>();
    const rebasedByPortfolio: Record<string, Record<string, number>> = {};
    for (const result of portfolioResults) {
      const filtered = filterByRange(result.dataPoints, range);
      const rebased = rebaseTWR(filtered);
      rebasedByPortfolio[result.portfolioId] = {};
      for (const d of rebased) {
        allDates.add(d.date);
        rebasedByPortfolio[result.portfolioId][d.date] = d.twr;
      }
    }
    return Array.from(allDates)
      .sort()
      .map((date) => {
        const point: Record<string, any> = { date };
        for (const result of portfolioResults) {
          point[result.portfolioId] = rebasedByPortfolio[result.portfolioId]?.[date] ?? null;
        }
        return point;
      });
  }, [selectedPortfolioId, portfolioResults, range]);

  const showComparison = selectedPortfolioId === null && portfolioResults.length > 1;
  const twrPositive = displayedTWR >= 0;
  const latentGain = currentValueEUR - totalInvestedEUR;
  const isLoading = historyLoading;

  // ── Date formatter ──────────────────────────────────────────────────────
  const fmtDate = (v: string) => {
    const d = new Date(v);
    return `${d.toLocaleString("fr", { month: "short" })} ${d.getFullYear().toString().slice(2)}`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10">
        <SidebarTrigger />
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Performance</h1>
        </div>
        <div className="ml-auto">
          <RangeSelector value={range} onChange={setRange} />
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 space-y-4">
        {/* Portfolio selector */}
        <PortfolioSelector
          portfolios={portfolios}
          selectedId={selectedPortfolioId}
          onSelect={setSelectedPortfolioId}
          onCreateClick={() => setCreateDialogOpen(true)}
        />

        {/* KPI Cards — always visible, use live prices (matches dashboard) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPICard
            label="TWR (période)"
            value={`${displayedTWR >= 0 ? "+" : ""}${(displayedTWR * 100).toFixed(2)}%`}
            sub={`Annualisé : ${annualisedTWR >= 0 ? "+" : ""}${(annualisedTWR * 100).toFixed(2)}%`}
            positive={twrPositive}
            icon={
              twrPositive ? (
                <TrendingUp className="h-5 w-5 text-green-600 dark:text-green-400" />
              ) : (
                <TrendingDown className="h-5 w-5 text-red-500" />
              )
            }
          />
          <KPICard
            label="Valeur actuelle"
            value={formatCurrency(currentValueEUR, "EUR")}
            positive={undefined}
            icon={<Wallet className="h-5 w-5" />}
          />
          <KPICard
            label="Capital investi"
            value={formatCurrency(totalInvestedEUR, "EUR")}
            positive={undefined}
            icon={<BarChart3 className="h-5 w-5" />}
          />
          <KPICard
            label="Plus-value latente"
            value={formatCurrency(latentGain, "EUR")}
            sub={
              totalInvestedEUR > 0
                ? formatPercent((latentGain / totalInvestedEUR) * 100)
                : undefined
            }
            positive={latentGain >= 0}
            icon={
              latentGain >= 0 ? (
                <TrendingUp className="h-5 w-5 text-green-600 dark:text-green-400" />
              ) : (
                <TrendingDown className="h-5 w-5 text-red-500" />
              )
            }
          />
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
            <Loader2 className="h-7 w-7 animate-spin" />
            <p className="text-sm">Chargement des cours historiques…</p>
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
            <BarChart3 className="h-8 w-8 opacity-40" />
            <p className="text-sm">Aucune donnée disponible. Ajoutez des transactions pour commencer.</p>
          </div>
        ) : (
          <>
            {/* Value chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">
                  Valeur du portefeuille (EUR)
                  <span className="text-xs text-muted-foreground font-normal ml-2">cours hebdomadaires historiques</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="valueGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={fmtDate}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) =>
                        v >= 1000 ? `${(v / 1000).toFixed(0)}k€` : `${v.toFixed(0)}€`
                      }
                      width={58}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="value"
                      name="Valeur"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      fill="url(#valueGradient)"
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* TWR chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">
                  Performance TWR (%)
                  <span className="text-xs text-muted-foreground font-normal ml-2">
                    — hors flux de trésorerie, rebasé sur la période
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ResponsiveContainer width="100%" height={210}>
                  <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="twrGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="5%"
                          stopColor={twrPositive ? "hsl(142 72% 29%)" : "hsl(0 72% 51%)"}
                          stopOpacity={0.2}
                        />
                        <stop
                          offset="95%"
                          stopColor={twrPositive ? "hsl(142 72% 29%)" : "hsl(0 72% 51%)"}
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={fmtDate}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `${(v * 100).toFixed(1)}%`}
                      width={58}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="twr"
                      name="TWR"
                      stroke={twrPositive ? "hsl(142 72% 29%)" : "hsl(0 72% 51%)"}
                      strokeWidth={2}
                      fill="url(#twrGradient)"
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Comparison chart */}
            {showComparison && comparisonChartData.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold">
                    Comparaison des portefeuilles (TWR %)
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <ResponsiveContainer width="100%" height={230}>
                    <LineChart
                      data={comparisonChartData}
                      margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={fmtDate}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => `${(v * 100).toFixed(1)}%`}
                        width={58}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend
                        formatter={(value) =>
                          portfolioResults.find((r) => r.portfolioId === value)?.portfolioName ?? value
                        }
                      />
                      {portfolioResults.map((result) => (
                        <Line
                          key={result.portfolioId}
                          type="monotone"
                          dataKey={result.portfolioId}
                          name={result.portfolioId}
                          stroke={result.color}
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4 }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>

      <CreatePortfolioDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
    </div>
  );
}
