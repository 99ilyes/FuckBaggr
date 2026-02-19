import { useState, useMemo } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePortfolios, useTransactions, useAssetsCache, useHistoricalPrices } from "@/hooks/usePortfolios";
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
import { computeTWR, filterByRange, rebaseTWR, getFxTicker, PortfolioTWRResult } from "@/lib/twr";
import { formatCurrency, formatPercent } from "@/lib/calculations";

// ─── Range selector ────────────────────────────────────────────────────────────

type Range = "6M" | "1Y" | "2Y" | "5Y" | "MAX";
const RANGES: Range[] = ["6M", "1Y", "2Y", "5Y", "MAX"];

function RangeSelector({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
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
            {entry.name.includes("TWR") || entry.name.includes("%")
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
  const [range, setRange] = useState<Range>("1Y");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const { data: portfolios = [] } = usePortfolios();
  const { data: allTransactions = [] } = useTransactions();
  const { data: assetsCache = [] } = useAssetsCache();

  // Build currency map from assets cache
  const assetCurrencies = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of assetsCache) {
      if (a.ticker && a.currency) map[a.ticker] = a.currency;
    }
    return map;
  }, [assetsCache]);

  // Collect all unique tickers from transactions + FX tickers needed
  const allTickers = useMemo(() => {
    const tickers = new Set<string>();
    for (const tx of allTransactions) {
      if (tx.ticker && (tx.type === "buy" || tx.type === "sell")) {
        tickers.add(tx.ticker);
      }
    }
    return Array.from(tickers);
  }, [allTransactions]);

  // Determine which FX tickers we need
  const fxTickers = useMemo(() => {
    const currencies = new Set<string>();
    for (const tx of allTransactions) {
      if (tx.currency && tx.currency !== "EUR") currencies.add(tx.currency);
    }
    for (const ticker of allTickers) {
      const currency = assetCurrencies[ticker];
      if (currency && currency !== "EUR") currencies.add(currency);
    }
    return Array.from(currencies)
      .map((c) => getFxTicker(c))
      .filter(Boolean) as string[];
  }, [allTransactions, allTickers, assetCurrencies]);

  const allTickersToFetch = useMemo(
    () => [...new Set([...allTickers, ...fxTickers])],
    [allTickers, fxTickers]
  );

  // Fetch historical prices (includes FX)
  const { data: historyMap = {}, isLoading: historyLoading } = useHistoricalPrices(
    allTickersToFetch,
    "5y",
    "1wk"
  );

  // Merge asset currencies from historyMap
  const enrichedCurrencies = useMemo(() => {
    const map = { ...assetCurrencies };
    for (const [ticker, asset] of Object.entries(historyMap)) {
      if (!map[ticker] && asset.currency) map[ticker] = asset.currency;
    }
    return map;
  }, [assetCurrencies, historyMap]);

  // Compute TWR per portfolio
  const portfolioResults = useMemo((): PortfolioTWRResult[] => {
    if (historyLoading || allTransactions.length === 0) return [];

    return portfolios.map((p) => {
      const txs = allTransactions.filter((tx) => tx.portfolio_id === p.id);
      return computeTWR({
        transactions: txs,
        historyMap,
        assetCurrencies: enrichedCurrencies,
        portfolioId: p.id,
        portfolioName: p.name,
        color: p.color,
      });
    });
  }, [portfolios, allTransactions, historyMap, enrichedCurrencies, historyLoading]);

  // Aggregate "Total" result by merging all portfolios' datapoints
  const totalResult = useMemo((): PortfolioTWRResult | null => {
    if (portfolioResults.length === 0) return null;

    // If single portfolio, just use it
    if (portfolioResults.length === 1) return portfolioResults[0];

    // Compute TWR on ALL transactions together
    if (historyLoading || allTransactions.length === 0) return null;

    return computeTWR({
      transactions: allTransactions,
      historyMap,
      assetCurrencies: enrichedCurrencies,
      portfolioId: "total",
      portfolioName: "Total",
      color: "hsl(var(--primary))",
    });
  }, [portfolioResults, allTransactions, historyMap, enrichedCurrencies, historyLoading]);

  // Active result: either selected portfolio or total
  const activeResult = useMemo(() => {
    if (selectedPortfolioId === null) return totalResult;
    return portfolioResults.find((r) => r.portfolioId === selectedPortfolioId) ?? null;
  }, [selectedPortfolioId, totalResult, portfolioResults]);

  // Filter + rebase data for chart
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

  // Multi-portfolio comparison data (for Total view)
  const comparisonChartData = useMemo(() => {
    if (selectedPortfolioId !== null || portfolioResults.length <= 1) return [];

    // Build a unified timeline
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

  // KPI values
  const displayedTWR = useMemo(() => {
    if (!activeResult || activeResult.dataPoints.length === 0) return 0;
    const filtered = filterByRange(activeResult.dataPoints, range);
    const rebased = rebaseTWR(filtered);
    return rebased.length > 0 ? rebased[rebased.length - 1].twr : 0;
  }, [activeResult, range]);

  const twrPositive = displayedTWR >= 0;

  const totalInvestedEUR = useMemo(() => {
    if (selectedPortfolioId === null) {
      return portfolioResults.reduce((sum, r) => sum + r.totalInvestedEUR, 0);
    }
    return activeResult?.totalInvestedEUR ?? 0;
  }, [selectedPortfolioId, portfolioResults, activeResult]);

  const currentValueEUR = useMemo(() => {
    if (selectedPortfolioId === null) {
      return portfolioResults.reduce((sum, r) => sum + r.currentValueEUR, 0);
    }
    return activeResult?.currentValueEUR ?? 0;
  }, [selectedPortfolioId, portfolioResults, activeResult]);

  // Annualised TWR for display range
  const annualisedTWR = useMemo(() => {
    if (!activeResult || activeResult.dataPoints.length < 2) return 0;
    const filtered = filterByRange(activeResult.dataPoints, range);
    if (filtered.length < 2) return 0;
    const rebased = rebaseTWR(filtered);
    const first = new Date(rebased[0].date);
    const last = new Date(rebased[rebased.length - 1].date);
    const years = (last.getTime() - first.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (years <= 0) return 0;
    const twr = rebased[rebased.length - 1].twr;
    return Math.pow(1 + twr, 1 / years) - 1;
  }, [activeResult, range]);

  const isLoading = historyLoading;

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

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Chargement des cours historiques…</p>
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
            <BarChart3 className="h-8 w-8 opacity-40" />
            <p className="text-sm">Aucune donnée disponible. Ajoutez des transactions pour commencer.</p>
          </div>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KPICard
                label="TWR (période)"
                value={formatPercent(displayedTWR)}
                sub={`Annualisé: ${formatPercent(annualisedTWR)}`}
                positive={twrPositive}
                icon={
                  twrPositive ? (
                    <TrendingUp className="h-5 w-5 text-green-500" />
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
                value={formatCurrency(currentValueEUR - totalInvestedEUR, "EUR")}
                sub={
                  totalInvestedEUR > 0
                    ? formatPercent((currentValueEUR - totalInvestedEUR) / totalInvestedEUR)
                    : undefined
                }
                positive={currentValueEUR >= totalInvestedEUR}
                icon={
                  currentValueEUR >= totalInvestedEUR ? (
                    <TrendingUp className="h-5 w-5 text-green-500" />
                  ) : (
                    <TrendingDown className="h-5 w-5 text-red-500" />
                  )
                }
              />
            </div>

            {/* Main chart: Portfolio value in EUR */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">
                  Valeur du portefeuille (EUR)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ResponsiveContainer width="100%" height={260}>
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
                      tickFormatter={(v) => {
                        const d = new Date(v);
                        return `${d.toLocaleString("fr", { month: "short" })} ${d.getFullYear().toString().slice(2)}`;
                      }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) =>
                        v >= 1000 ? `${(v / 1000).toFixed(0)}k€` : `${v.toFixed(0)}€`
                      }
                      width={56}
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

            {/* TWR Chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">
                  Performance TWR (%){" "}
                  <span className="text-xs text-muted-foreground font-normal ml-1">
                    — hors flux de trésorerie
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="twrGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="5%"
                          stopColor={twrPositive ? "hsl(142 72% 29%)" : "hsl(0 84% 60%)"}
                          stopOpacity={0.2}
                        />
                        <stop
                          offset="95%"
                          stopColor={twrPositive ? "hsl(142 72% 29%)" : "hsl(0 84% 60%)"}
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
                      tickFormatter={(v) => {
                        const d = new Date(v);
                        return `${d.toLocaleString("fr", { month: "short" })} ${d.getFullYear().toString().slice(2)}`;
                      }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `${(v * 100).toFixed(1)}%`}
                      width={56}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="twr"
                      name="TWR"
                      stroke={twrPositive ? "hsl(142,72%,29%)" : "hsl(0,84%,60%)"}
                      strokeWidth={2}
                      fill="url(#twrGradient)"
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Comparison chart: multiple portfolios TWR */}
            {showComparison && comparisonChartData.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold">
                    Comparaison des portefeuilles (TWR %)
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <ResponsiveContainer width="100%" height={240}>
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
                        tickFormatter={(v) => {
                          const d = new Date(v);
                          return `${d.toLocaleString("fr", { month: "short" })} ${d.getFullYear().toString().slice(2)}`;
                        }}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => `${(v * 100).toFixed(1)}%`}
                        width={56}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend
                        formatter={(value) =>
                          portfolioResults.find((r) => r.portfolioId === value)?.portfolioName ??
                          value
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
