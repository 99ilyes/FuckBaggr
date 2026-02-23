import { useMemo, useState, useEffect } from "react";
import { Transaction, AssetHistory } from "@/hooks/usePortfolios";
import { computeTWR, filterByRange, rebaseTWR, rebaseBenchmark, TimeRange } from "@/lib/twr";
import { formatCurrency, formatPercent } from "@/lib/calculations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TickerSearch } from "@/components/TickerSearch";
import { CalendarIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
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
  benchmarkHistory?: { time: number; price: number }[];
  benchmarkTicker?: string | null;
}

const RANGES: TimeRange[] = ["6M", "1Y", "2Y", "5Y", "MAX"];

const STORAGE_KEY = "perf_benchmark_ticker";

function fmtDate(date: string): string {
  return new Date(date).toLocaleDateString("fr-FR", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function fmtCompactCurrency(v: number): string {
  if (!Number.isFinite(v)) return "0";
  return new Intl.NumberFormat("fr-FR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(v);
}

/* Custom tooltip for a clean dark aesthetic */
function ChartTooltip({ active, payload, label, valueLabel, formatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border/50 bg-card/95 backdrop-blur px-3 py-2 shadow-xl">
      <p className="text-[11px] text-muted-foreground mb-1">{fmtDate(label)}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-foreground font-medium">
            {formatter ? formatter(entry.value, entry.dataKey) : entry.value}
          </span>
        </div>
      ))}
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
  benchmarkHistory,
  benchmarkTicker,
}: Props) {
  const [range, setRange] = useState<TimeRange>("1Y");
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();

  const accentColor = portfolioColor || "hsl(var(--chart-2))";

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
        range,
        customFrom?.toISOString().split("T")[0],
        customTo?.toISOString().split("T")[0]
      ),
    [twr.dataPoints, range, customFrom, customTo]
  );
  const rebased = useMemo(() => rebaseTWR(visiblePoints), [visiblePoints]);

  const valueData = useMemo(
    () => visiblePoints.map((p) => ({ date: p.date, value: p.valueEUR })),
    [visiblePoints]
  );

  const benchData = useMemo(() => {
    if (!benchmarkHistory || benchmarkHistory.length === 0) return [];
    const dates = rebased.map((p) => p.date);
    return rebaseBenchmark(benchmarkHistory, dates);
  }, [benchmarkHistory, rebased]);

  const twrData = useMemo(() => {
    const benchMap = new Map(benchData.map((b) => [b.date, b.benchPct]));
    return rebased.map((p) => ({
      date: p.date,
      twrPct: p.twr * 100,
      ...(benchMap.has(p.date) ? { benchPct: benchMap.get(p.date) } : {}),
    }));
  }, [rebased, benchData]);

  // KPI summary for visible range
  const rangeTWR = rebased.length > 0 ? rebased[rebased.length - 1].twr : 0;
  const rangeBench = benchData.length > 0 ? benchData[benchData.length - 1].benchPct / 100 : null;

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
      {/* ── Controls Card ── */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3">
            {/* Title + KPI row */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base font-semibold text-foreground">{portfolioName}</CardTitle>
                <div className="flex flex-wrap gap-4 mt-1 text-xs text-muted-foreground">
                  <span>
                    TWR période :{" "}
                    <span className={rangeTWR >= 0 ? "text-[hsl(var(--gain))]" : "text-[hsl(var(--loss))]"}>
                      {formatPercent(rangeTWR * 100)}
                    </span>
                  </span>
                  <span>TWR annualisé : {formatPercent(twr.annualisedTWR * 100)}</span>
                  {rangeBench !== null && benchmarkTicker && (
                    <span>
                      {benchmarkTicker} :{" "}
                      <span className={rangeBench >= 0 ? "text-[hsl(var(--gain))]" : "text-[hsl(var(--loss))]"}>
                        {formatPercent(rangeBench * 100)}
                      </span>
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Range buttons + custom date pickers */}
            <div className="flex flex-wrap items-center gap-2">
              {RANGES.map((r) => (
                <Button
                  key={r}
                  size="sm"
                  variant={range === r ? "default" : "ghost"}
                  className={cn("h-7 px-3 text-xs", range === r && "bg-primary text-primary-foreground")}
                  onClick={() => { setRange(r); setCustomFrom(undefined); setCustomTo(undefined); }}
                >
                  {r}
                </Button>
              ))}

              <div className="h-4 w-px bg-border/50 mx-1" />

              {/* Custom from */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={range === "CUSTOM" ? "default" : "ghost"}
                    size="sm"
                    className={cn("h-7 px-2 text-xs gap-1", range === "CUSTOM" && "bg-primary text-primary-foreground")}
                  >
                    <CalendarIcon className="h-3 w-3" />
                    {customFrom ? format(customFrom, "dd MMM yy", { locale: fr }) : "Du"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={customFrom}
                    onSelect={(d) => { setCustomFrom(d); setRange("CUSTOM"); }}
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>

              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={range === "CUSTOM" ? "default" : "ghost"}
                    size="sm"
                    className={cn("h-7 px-2 text-xs gap-1", range === "CUSTOM" && "bg-primary text-primary-foreground")}
                  >
                    <CalendarIcon className="h-3 w-3" />
                    {customTo ? format(customTo, "dd MMM yy", { locale: fr }) : "Au"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={customTo}
                    onSelect={(d) => { setCustomTo(d); setRange("CUSTOM"); }}
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* ── Value Chart ── */}
      <Card className="border-border/50">
        <CardHeader className="pb-1">
          <CardTitle className="text-xs font-medium text-muted-foreground tracking-wide uppercase">
            Évolution de la valeur
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={valueData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="valueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.3} vertical={false} />
                <XAxis
                  dataKey="date"
                  minTickGap={40}
                  tickFormatter={(v) => new Date(v).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" })}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v) => fmtCompactCurrency(v)}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  width={50}
                />
                <RechartsTooltip
                  content={
                    <ChartTooltip
                      formatter={(v: number) => formatCurrency(v, "EUR")}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="hsl(var(--chart-2))"
                  strokeWidth={2}
                  fill="url(#valueGradient)"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0, fill: "hsl(var(--chart-2))" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* ── TWR Chart ── */}
      <Card className="border-border/50">
        <CardHeader className="pb-1">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs font-medium text-muted-foreground tracking-wide uppercase">
              Performance TWR
            </CardTitle>
            {benchmarkTicker && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-[hsl(var(--chart-1))]" />
                <span>Portefeuille</span>
                <span className="h-2 w-2 rounded-full bg-[hsl(var(--chart-3))]" />
                <span>{benchmarkTicker}</span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={twrData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.3} vertical={false} />
                <XAxis
                  dataKey="date"
                  minTickGap={40}
                  tickFormatter={(v) => new Date(v).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" })}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  width={50}
                />
                <RechartsTooltip
                  content={
                    <ChartTooltip
                      formatter={(v: number, key: string) => {
                        const label = key === "benchPct" ? benchmarkTicker : "TWR";
                        return `${v >= 0 ? "+" : ""}${v.toFixed(2)}% ${label}`;
                      }}
                    />
                  }
                />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.3} strokeDasharray="4 4" />
                <Line
                  type="monotone"
                  dataKey="twrPct"
                  stroke="hsl(var(--chart-1))"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0, fill: "hsl(var(--chart-1))" }}
                />
                {benchmarkTicker && (
                  <Line
                    type="monotone"
                    dataKey="benchPct"
                    stroke="hsl(var(--chart-3))"
                    strokeWidth={1.5}
                    strokeDasharray="6 3"
                    dot={false}
                    activeDot={{ r: 3, strokeWidth: 0, fill: "hsl(var(--chart-3))" }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
