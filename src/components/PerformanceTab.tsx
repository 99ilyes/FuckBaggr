import { useMemo, useState, useCallback } from "react";
import { Transaction, AssetHistory } from "@/hooks/usePortfolios";
import { computeTWR, filterByRange, rebaseTWR, rebaseBenchmark, TimeRange } from "@/lib/twr";
import { formatCurrency, formatPercent } from "@/lib/calculations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TickerSearch } from "@/components/TickerSearch";
import { X, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ReferenceLine,
} from "recharts";

interface Props {
  transactions: Transaction[];
  historicalPrices: Record<string, AssetHistory>;
  portfolioId: string | null;
  portfolioName: string;
  portfolioColor?: string | null;
  loading?: boolean;
  benchmarkHistories?: Record<string, { time: number; price: number }[]>;
  benchmarkTickers?: string[];
  benchSearch?: string;
  onBenchSearchChange?: (value: string) => void;
  onBenchmarkTickersChange?: (tickers: string[]) => void;
  maxBenchmarks?: number;
}

const RANGES: TimeRange[] = ["1W", "1M", "YTD", "6M", "1Y", "2Y", "MAX"];
const BENCH_COLORS = [
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-1))",
];

function fmtDate(date: string): string {
  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) return date || "-";
  return parsedDate.toLocaleDateString("fr-FR", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function fmtCompactCurrency(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("fr-FR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function fmtSignedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function computeStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function computeMaxDrawdown(data: { date: string; value: number }[]): { value: number; date: string } {
  if (data.length === 0) return { value: 0, date: "" };

  let peak = data[0].value;
  let maxDrawdown = 0;
  let drawdownDate = data[0].date;

  for (const point of data) {
    if (point.value > peak) peak = point.value;
    if (peak <= 0) continue;

    const drawdown = ((point.value - peak) / peak) * 100;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
      drawdownDate = point.date;
    }
  }

  return { value: maxDrawdown, date: drawdownDate };
}

interface TooltipEntry {
  color?: string;
  dataKey?: string;
  name?: string;
  value?: number;
}

interface TooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  formatter?: (value: number, key: string) => string;
}

function ChartTooltip({ active, payload, label, formatter }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/50 bg-card/95 px-3 py-2 shadow-xl backdrop-blur">
      <p className="mb-1 text-[11px] text-muted-foreground">{fmtDate(String(label ?? ""))}</p>
      <div className="space-y-1">
        {payload.map((entry, idx) => (
          <div key={idx} className="flex items-center justify-between gap-3 text-xs">
            <div className="min-w-0 flex items-center gap-2">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color || "hsl(var(--muted-foreground))" }}
              />
              <span className="truncate text-muted-foreground">{entry.name || entry.dataKey}</span>
            </div>
            <span className="tabular-nums font-medium text-foreground">
              {formatter
                ? formatter(Number(entry.value ?? 0), String(entry.dataKey ?? ""))
                : String(entry.value ?? 0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PerformanceTab({
  transactions,
  historicalPrices,
  portfolioId,
  portfolioName,
  portfolioColor,
  loading = false,
  benchmarkHistories = {},
  benchmarkTickers = [],
  benchSearch = "",
  onBenchSearchChange,
  onBenchmarkTickersChange,
  maxBenchmarks = 5,
}: Props) {
  const [range, setRange] = useState<TimeRange>("YTD");
  const [customFromStr, setCustomFromStr] = useState("");
  const [customToStr, setCustomToStr] = useState("");
  const [benchOpen, setBenchOpen] = useState(false);

  // Parse dd/mm/yyyy or yyyy-mm-dd text inputs into Date objects
  const parseDateInput = useCallback((str: string): Date | undefined => {
    if (!str) return undefined;
    const trimmed = str.trim();
    // Try dd/mm/yyyy
    const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      const d = new Date(Number(slashMatch[3]), Number(slashMatch[2]) - 1, Number(slashMatch[1]));
      return Number.isNaN(d.getTime()) ? undefined : d;
    }
    // Try yyyy-mm-dd
    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const d = new Date(trimmed);
      return Number.isNaN(d.getTime()) ? undefined : d;
    }
    return undefined;
  }, []);

  const customFrom = parseDateInput(customFromStr);
  const customTo = parseDateInput(customToStr);

  const accentColor = portfolioColor || "hsl(var(--chart-2))";
  const hasCustomDates = Boolean(customFrom || customTo);
  const effectiveRange: TimeRange = range === "CUSTOM" && !customFrom ? "1Y" : range;

  const assetCurrencies = useMemo(() => {
    const map: Record<string, string> = {};
    for (const tx of transactions) {
      if (!tx.ticker || tx.ticker.includes("=X")) continue;
      if (tx.type !== "buy" && tx.type !== "sell" && tx.type !== "transfer_in" && tx.type !== "transfer_out") continue;
      map[tx.ticker] = (tx.currency || "EUR").toUpperCase();
    }

    for (const [ticker, history] of Object.entries(historicalPrices)) {
      if (!map[ticker] && !ticker.includes("=X")) {
        map[ticker] = (history.currency || "EUR").toUpperCase();
      }
    }

    return map;
  }, [transactions, historicalPrices]);

  const twr = useMemo(
    () =>
      computeTWR({
        transactions,
        historyMap: historicalPrices,
        assetCurrencies,
        portfolioId: portfolioId || "global",
        portfolioName,
        color: accentColor,
      }),
    [transactions, historicalPrices, assetCurrencies, portfolioId, portfolioName, accentColor]
  );

  const visiblePoints = useMemo(
    () =>
      filterByRange(
        twr.dataPoints,
        effectiveRange,
        customFrom?.toISOString().split("T")[0],
        customTo?.toISOString().split("T")[0]
      ),
    [twr.dataPoints, effectiveRange, customFrom, customTo]
  );

  const rebased = useMemo(() => rebaseTWR(visiblePoints), [visiblePoints]);

  const valueData = useMemo(
    () => visiblePoints.map((point) => ({ date: point.date, value: point.valueEUR })),
    [visiblePoints]
  );

  const dailyVariationData = useMemo(() => {
    const rows: Array<{ date: string; dailyPct: number }> = [];

    for (let idx = 1; idx < rebased.length; idx++) {
      const prevMultiplier = 1 + rebased[idx - 1].twr;
      const currentMultiplier = 1 + rebased[idx].twr;
      if (prevMultiplier <= 0 || currentMultiplier <= 0) continue;

      rows.push({
        date: rebased[idx].date,
        dailyPct: ((currentMultiplier / prevMultiplier) - 1) * 100,
      });
    }

    return rows;
  }, [rebased]);

  const benchmarkColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    benchmarkTickers.forEach((ticker, idx) => {
      map[ticker] = BENCH_COLORS[idx % BENCH_COLORS.length];
    });
    return map;
  }, [benchmarkTickers]);

  const benchmarkDataKeys = useMemo(() => {
    const map: Record<string, string> = {};
    benchmarkTickers.forEach((ticker, idx) => {
      map[ticker] = `bench_${idx}`;
    });
    return map;
  }, [benchmarkTickers]);

  const benchmarkSeriesByTicker = useMemo(() => {
    if (benchmarkTickers.length === 0 || rebased.length === 0) {
      return {} as Record<string, { date: string; benchPct: number }[]>;
    }

    const visibleDates = rebased.map((point) => point.date);
    const byTicker: Record<string, { date: string; benchPct: number }[]> = {};

    for (const ticker of benchmarkTickers) {
      const history = benchmarkHistories[ticker];
      if (!history || history.length === 0) continue;
      const series = rebaseBenchmark(history, visibleDates);
      if (series.length > 0) byTicker[ticker] = series;
    }

    return byTicker;
  }, [benchmarkHistories, benchmarkTickers, rebased]);

  const activeBenchmarkTickers = useMemo(
    () => benchmarkTickers.filter((ticker) => (benchmarkSeriesByTicker[ticker] || []).length > 0),
    [benchmarkTickers, benchmarkSeriesByTicker]
  );

  const twrData = useMemo(() => {
    const benchmarkValuesByDate: Record<string, Record<string, number>> = {};

    for (const ticker of activeBenchmarkTickers) {
      const dataKey = benchmarkDataKeys[ticker];
      for (const point of benchmarkSeriesByTicker[ticker]) {
        if (!benchmarkValuesByDate[point.date]) benchmarkValuesByDate[point.date] = {};
        benchmarkValuesByDate[point.date][dataKey] = point.benchPct;
      }
    }

    return rebased.map((point) => ({
      date: point.date,
      twrPct: point.twr * 100,
      ...(benchmarkValuesByDate[point.date] || {}),
    }));
  }, [rebased, activeBenchmarkTickers, benchmarkDataKeys, benchmarkSeriesByTicker]);

  const rangeTWR = rebased.length > 0 ? rebased[rebased.length - 1].twr : 0;

  const rangeBenchmarkReturns = useMemo(() => {
    const byTicker: Record<string, number> = {};
    for (const ticker of activeBenchmarkTickers) {
      const series = benchmarkSeriesByTicker[ticker];
      if (!series || series.length === 0) continue;
      byTicker[ticker] = series[series.length - 1].benchPct / 100;
    }
    return byTicker;
  }, [activeBenchmarkTickers, benchmarkSeriesByTicker]);

  const variationStats = useMemo(() => {
    if (valueData.length < 2) return null;

    const firstValue = valueData[0].value;
    const lastValue = valueData[valueData.length - 1].value;
    const deltaValue = lastValue - firstValue;
    const deltaValuePct = firstValue > 0 ? (deltaValue / firstValue) * 100 : 0;

    const avgDailyReturn =
      dailyVariationData.length > 0
        ? dailyVariationData.reduce((sum, day) => sum + day.dailyPct, 0) / dailyVariationData.length
        : 0;

    const dailyVolatility = computeStdDev(dailyVariationData.map((day) => day.dailyPct));

    const bestWeek =
      dailyVariationData.length > 0
        ? dailyVariationData.reduce((best, day) => (day.dailyPct > best.dailyPct ? day : best))
        : null;

    const worstWeek =
      dailyVariationData.length > 0
        ? dailyVariationData.reduce((worst, day) => (day.dailyPct < worst.dailyPct ? day : worst))
        : null;

    const maxDrawdown = computeMaxDrawdown(valueData);

    return {
      firstValue,
      lastValue,
      deltaValue,
      deltaValuePct,
      avgDailyReturn,
      dailyVolatility,
      bestWeek,
      worstWeek,
      maxDrawdown,
    };
  }, [valueData, dailyVariationData]);

  const benchmarkStats = useMemo(
    () =>
      activeBenchmarkTickers.map((ticker) => {
        const benchmarkReturn = rangeBenchmarkReturns[ticker] ?? 0;
        const spread = (rangeTWR - benchmarkReturn) * 100;
        return {
          ticker,
          benchmarkReturn,
          spread,
        };
      }),
    [activeBenchmarkTickers, rangeBenchmarkReturns, rangeTWR]
  );

  const visiblePeriodStart = visiblePoints[0]?.date;
  const visiblePeriodEnd = visiblePoints[visiblePoints.length - 1]?.date;

  const periodNetFlows = useMemo(
    () => visiblePoints.reduce((sum, point) => sum + point.netFlow, 0),
    [visiblePoints]
  );
  const isShortRangeView = twrData.length <= 90;
  const showDailyDots = twrData.length <= 240;
  const showValueDots = valueData.length <= 240;
  const showVariationDots = dailyVariationData.length <= 240;

  const xTickFormatter = (value: string) => {
    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime())) return value;

    if (isShortRangeView) {
      return parsedDate.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
    }

    return parsedDate.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
  };

  if (transactions.length === 0) {
    return (
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Performance</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Aucune transaction dans ce portefeuille.</CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Performance</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Chargement des historiques…</CardContent>
      </Card>
    );
  }

  if (valueData.length < 2 || twrData.length < 2) {
    return (
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Performance</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Données historiques insuffisantes.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Sticky control bar ── */}
      <div className="sticky top-[56px] z-40 -mx-4 md:-mx-6 px-4 md:px-6 py-3 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border/50">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          {/* Left side: Period info */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{portfolioName}</p>
              {visiblePeriodStart && visiblePeriodEnd && (
                <p className="text-[11px] text-muted-foreground">
                  {fmtDate(visiblePeriodStart)} – {fmtDate(visiblePeriodEnd)}
                </p>
              )}
            </div>
          </div>

          {/* Right side: Range buttons + date pickers + benchmark */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Range buttons */}
            {RANGES.map((currentRange) => (
              <Button
                key={currentRange}
                size="sm"
                variant={range === currentRange ? "default" : "ghost"}
                className={cn("h-7 px-2.5 text-xs", range === currentRange && "bg-primary text-primary-foreground")}
                onClick={() => {
                  setRange(currentRange);
                  setCustomFromStr("");
                  setCustomToStr("");
                }}
              >
                {currentRange}
              </Button>
            ))}

            <div className="mx-0.5 h-4 w-px bg-border/50" />

            {/* Custom date text inputs */}
            <input
              type="text"
              placeholder="Du (jj/mm/aaaa)"
              value={customFromStr}
              onChange={(e) => {
                setCustomFromStr(e.target.value);
                if (parseDateInput(e.target.value)) setRange("CUSTOM");
              }}
              className={cn(
                "h-7 w-[120px] rounded-md border bg-transparent px-2 text-xs tabular-nums placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary",
                range === "CUSTOM" ? "border-primary text-foreground" : "border-border/50 text-muted-foreground"
              )}
            />
            <input
              type="text"
              placeholder="Au (jj/mm/aaaa)"
              value={customToStr}
              onChange={(e) => {
                setCustomToStr(e.target.value);
                if (parseDateInput(e.target.value)) setRange("CUSTOM");
              }}
              className={cn(
                "h-7 w-[120px] rounded-md border bg-transparent px-2 text-xs tabular-nums placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary",
                range === "CUSTOM" ? "border-primary text-foreground" : "border-border/50 text-muted-foreground"
              )}
            />

            {hasCustomDates && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                onClick={() => {
                  setCustomFromStr("");
                  setCustomToStr("");
                  if (range === "CUSTOM") setRange("1Y");
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            )}

            <div className="mx-0.5 h-4 w-px bg-border/50" />

            {/* Benchmark search */}
            <Popover open={benchOpen} onOpenChange={setBenchOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                >
                  <Search className="h-3 w-3" />
                  <span>Benchmark</span>
                  {benchmarkTickers.length > 0 && (
                    <span className="ml-0.5 rounded-full bg-primary/20 px-1.5 text-[10px] font-semibold text-primary">
                      {benchmarkTickers.length}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-3" align="end">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">
                      Benchmarks (max {maxBenchmarks})
                    </p>
                    {benchmarkTickers.length > 0 && (
                      <button
                        onClick={() => {
                          onBenchmarkTickersChange?.([]);
                          onBenchSearchChange?.("");
                        }}
                        className="rounded-md px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
                      >
                        Tout effacer
                      </button>
                    )}
                  </div>
                  <TickerSearch
                    value={benchSearch}
                    onChange={(v) => onBenchSearchChange?.(v)}
                    onSelect={(r) => {
                      const ticker = r.symbol.toUpperCase();
                      onBenchmarkTickersChange?.(
                        benchmarkTickers.includes(ticker) || benchmarkTickers.length >= maxBenchmarks
                          ? benchmarkTickers
                          : [...benchmarkTickers, ticker]
                      );
                      onBenchSearchChange?.("");
                    }}
                  />
                  {benchmarkTickers.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {benchmarkTickers.map((ticker, idx) => (
                        <div
                          key={ticker}
                          className="flex items-center gap-1.5 rounded-md border border-border/50 bg-secondary/50 px-2 py-0.5 text-xs"
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: BENCH_COLORS[idx % BENCH_COLORS.length] }}
                          />
                          <span className="font-medium">{ticker}</span>
                          <button
                            onClick={() => {
                              onBenchmarkTickersChange?.(benchmarkTickers.filter((t) => t !== ticker));
                            }}
                            className="ml-0.5 rounded-sm p-0.5 hover:bg-accent"
                          >
                            <X className="h-3 w-3 text-muted-foreground" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      Ajoute un indice pour comparer la trajectoire TWR.
                    </p>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Inline benchmark tags when popover is closed */}
        {
          benchmarkTickers.length > 0 && !benchOpen && (
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {benchmarkStats.map((benchmark) => (
                <div key={benchmark.ticker} className="flex items-center gap-1.5 text-xs">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: benchmarkColorMap[benchmark.ticker] }} />
                  <span className="font-medium text-foreground">{benchmark.ticker}</span>
                  <span className={benchmark.benchmarkReturn >= 0 ? "text-[hsl(var(--gain))]" : "text-[hsl(var(--loss))]"}>
                    {formatPercent(benchmark.benchmarkReturn * 100)}
                  </span>
                  <span className="text-muted-foreground">•</span>
                  <span className={benchmark.spread >= 0 ? "text-[hsl(var(--gain))]" : "text-[hsl(var(--loss))]"}>
                    écart {fmtSignedPercent(benchmark.spread)}
                  </span>
                </div>
              ))}
            </div>
          )
        }
      </div >

      {/* ── KPI row ── */}
      < div className="grid gap-2 grid-cols-2 xl:grid-cols-4" >
        <div className="rounded-lg border border-border/50 bg-card/50 px-3 py-2.5">
          <p className="text-[11px] text-muted-foreground">TWR période</p>
          <p className={cn("text-base font-bold tabular-nums mt-0.5", rangeTWR >= 0 ? "text-[hsl(var(--gain))]" : "text-[hsl(var(--loss))]")}>
            {formatPercent(rangeTWR * 100)}
          </p>
        </div>
        <div className="rounded-lg border border-border/50 bg-card/50 px-3 py-2.5">
          <p className="text-[11px] text-muted-foreground">Valeur actuelle</p>
          <p className="text-base font-bold tabular-nums mt-0.5 text-foreground">
            {formatCurrency(valueData[valueData.length - 1].value)}
          </p>
        </div>
        <div className="rounded-lg border border-border/50 bg-card/50 px-3 py-2.5">
          <p className="text-[11px] text-muted-foreground">Flux nets période</p>
          <p className={cn("text-base font-bold tabular-nums mt-0.5", periodNetFlows >= 0 ? "text-[hsl(var(--gain))]" : "text-[hsl(var(--loss))]")}>
            {formatCurrency(periodNetFlows)}
          </p>
        </div>
        <div className="rounded-lg border border-border/50 bg-card/50 px-3 py-2.5">
          <p className="text-[11px] text-muted-foreground">TWR annualisé</p>
          <p className={cn("text-base font-bold tabular-nums mt-0.5", twr.annualisedTWR >= 0 ? "text-[hsl(var(--gain))]" : "text-[hsl(var(--loss))]")}>
            {formatPercent(twr.annualisedTWR * 100)}
          </p>
        </div>
      </div >

      {/* ── TWR Chart (full width, prominent) ── */}
      < Card className="border-border/50" >
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Performance TWR (%)
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[hsl(var(--chart-1))]" />
                <span>Portefeuille</span>
              </div>
              {activeBenchmarkTickers.map((ticker) => (
                <div key={ticker} className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: benchmarkColorMap[ticker] }} />
                  <span>{ticker}</span>
                </div>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="h-[420px] rounded-lg bg-gradient-to-b from-muted/20 to-transparent p-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={twrData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.3} vertical={false} />
                <XAxis
                  dataKey="date"
                  minTickGap={isShortRangeView ? 14 : 32}
                  tickFormatter={xTickFormatter}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(value) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  width={64}
                />
                <RechartsTooltip content={<ChartTooltip formatter={(value) => fmtSignedPercent(value)} />} />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.35} strokeDasharray="4 4" />

                <Line
                  type="monotone"
                  dataKey="twrPct"
                  name="Portefeuille"
                  stroke="hsl(var(--chart-1))"
                  strokeWidth={2.25}
                  dot={showDailyDots ? { r: 1.7, fill: "hsl(var(--chart-1))", strokeWidth: 0 } : false}
                  activeDot={{ r: 4, strokeWidth: 0, fill: "hsl(var(--chart-1))" }}
                />

                {activeBenchmarkTickers.map((ticker) => (
                  <Line
                    key={ticker}
                    type="monotone"
                    dataKey={benchmarkDataKeys[ticker]}
                    name={ticker}
                    stroke={benchmarkColorMap[ticker]}
                    strokeWidth={1.75}
                    strokeDasharray="5 4"
                    dot={showDailyDots ? { r: 1.2, fill: benchmarkColorMap[ticker], strokeWidth: 0 } : false}
                    activeDot={{ r: 3, strokeWidth: 0, fill: benchmarkColorMap[ticker] }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card >

      {/* ── Value chart (full width) ── */}
      < Card className="border-border/50" >
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Évolution de la valeur (€)
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="h-[360px] rounded-lg bg-gradient-to-b from-muted/20 to-transparent p-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={valueData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="valueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={accentColor} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={accentColor} stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.3} vertical={false} />
                <XAxis
                  dataKey="date"
                  minTickGap={isShortRangeView ? 14 : 32}
                  tickFormatter={xTickFormatter}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(value) => fmtCompactCurrency(value)}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  width={64}
                />
                <RechartsTooltip content={<ChartTooltip formatter={(value) => formatCurrency(value, "EUR")} />} />
                <Area
                  type="monotone"
                  dataKey="value"
                  name="Valeur portefeuille"
                  stroke={accentColor}
                  strokeWidth={2}
                  fill="url(#valueGradient)"
                  dot={showValueDots ? { r: 1.6, fill: accentColor, strokeWidth: 0 } : false}
                  activeDot={{ r: 4, strokeWidth: 0, fill: accentColor }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card >
    </div >
  );
}
