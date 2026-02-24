import { useMemo, useState } from "react";
import { AssetHistory, Transaction } from "@/hooks/usePortfolios";
import { computeTWR, filterByRange, rebaseBenchmark, rebaseTWR, TimeRange } from "@/lib/twr";
import { formatPercent, formatCurrency } from "@/lib/calculations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

type PerformanceMode = "twr" | "value";

interface Props {
  transactions: Transaction[];
  historicalPrices: Record<string, AssetHistory>;
  portfolioId: string | null;
  portfolioName: string;
  portfolioColor?: string | null;
  loading?: boolean;
  benchmarkHistories?: Record<string, { time: number; price: number }[]>;
  benchmarkTickers?: string[];
}

type DashboardRange = Exclude<TimeRange, "CUSTOM">;

const RANGES: DashboardRange[] = ["YTD", "6M", "1Y", "2Y", "5Y", "MAX"];
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

function fmtSignedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
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
}

function ChartTooltip({ active, payload, label }: TooltipProps) {
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
              {fmtSignedPercent(Number(entry.value ?? 0))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ValueTooltip({ active, payload, label }: TooltipProps) {
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
              {formatCurrency(Number(entry.value ?? 0))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardPerformanceChart({
  transactions,
  historicalPrices,
  portfolioId,
  portfolioName,
  portfolioColor,
  loading = false,
  benchmarkHistories = {},
  benchmarkTickers = [],
}: Props) {
  const [range, setRange] = useState<DashboardRange>("YTD");
  const [perfMode, setPerfMode] = useState<PerformanceMode>("twr");

  const accentColor = portfolioColor || "hsl(var(--chart-1))";

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
    () => filterByRange(twr.dataPoints, range),
    [twr.dataPoints, range]
  );

  const rebased = useMemo(() => rebaseTWR(visiblePoints), [visiblePoints]);

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

  // Value evolution data: portfolio value + cumulative deposits
  const valueData = useMemo(() => {
    if (visiblePoints.length === 0) return [];
    // Compute cumulative net deposits up to range start
    const allPoints = twr.dataPoints;
    const rangeStartTime = visiblePoints[0].time;
    let cumulativeFlowBefore = 0;
    for (const dp of allPoints) {
      if (dp.time >= rangeStartTime) break;
      cumulativeFlowBefore += dp.netFlow;
    }

    let cumulativeFlow = cumulativeFlowBefore;
    return visiblePoints.map((dp) => {
      cumulativeFlow += dp.netFlow;
      return {
        date: dp.date,
        portfolioValue: Math.round(dp.valueEUR * 100) / 100,
        cumulativeDeposits: Math.round(cumulativeFlow * 100) / 100,
      };
    });
  }, [visiblePoints, twr.dataPoints]);

  const rangeTWR = rebased.length > 0 ? rebased[rebased.length - 1].twr : 0;
  const visiblePeriodStart = visiblePoints[0]?.date;
  const visiblePeriodEnd = visiblePoints[visiblePoints.length - 1]?.date;
  const isShortRangeView = twrData.length <= 90;
  const showDailyDots = twrData.length <= 240;

  const lastValue = valueData.length > 0 ? valueData[valueData.length - 1].portfolioValue : 0;

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

  if (twrData.length < 2) {
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

  const depositsColor = "hsl(var(--chart-4))";
  const valueColor = accentColor;

  const fmtEurCompact = (value: number) => {
    if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(0)}k€`;
    return `${value.toFixed(0)}€`;
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-semibold text-foreground">
                {perfMode === "twr" ? "Performance TWR" : "Valeur du portefeuille"}
              </CardTitle>
              <ToggleGroup
                type="single"
                value={perfMode}
                onValueChange={(v) => {
                  if (v === "twr" || v === "value") setPerfMode(v);
                }}
                variant="outline"
                size="sm"
                className="gap-0.5"
              >
                <ToggleGroupItem value="twr" aria-label="Performance TWR" className="text-[11px] px-2 h-6">
                  TWR %
                </ToggleGroupItem>
                <ToggleGroupItem value="value" aria-label="Valeur" className="text-[11px] px-2 h-6">
                  Valeur €
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            {visiblePeriodStart && visiblePeriodEnd && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {fmtDate(visiblePeriodStart)} - {fmtDate(visiblePeriodEnd)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Select value={range} onValueChange={(value) => setRange(value as DashboardRange)}>
              <SelectTrigger className="h-8 w-[90px] px-2 text-xs">
                <SelectValue placeholder="Période" />
              </SelectTrigger>
              <SelectContent>
                {RANGES.map((currentRange) => (
                  <SelectItem key={currentRange} value={currentRange}>
                    {currentRange}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {perfMode === "twr" ? (
              <span
                className={cn(
                  "rounded-md border border-border/60 px-2 py-1 text-xs font-semibold tabular-nums",
                  rangeTWR >= 0 ? "text-[hsl(var(--gain))]" : "text-[hsl(var(--loss))]"
                )}
              >
                {formatPercent(rangeTWR * 100)}
              </span>
            ) : (
              <span className="rounded-md border border-border/60 px-2 py-1 text-xs font-semibold tabular-nums text-foreground">
                {formatCurrency(lastValue)}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          {perfMode === "twr" ? (
            <>
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accentColor }} />
                <span>{portfolioName}</span>
              </div>
              {activeBenchmarkTickers.map((ticker) => (
                <div key={ticker} className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: benchmarkColorMap[ticker] }} />
                  <span>{ticker}</span>
                </div>
              ))}
            </>
          ) : (
            <>
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: valueColor }} />
                <span>Valeur du portefeuille</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: depositsColor }} />
                <span>Dépôts cumulés</span>
              </div>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="h-[420px] rounded-lg bg-gradient-to-b from-muted/20 to-transparent p-2">
          {perfMode === "twr" ? (
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
                <RechartsTooltip content={<ChartTooltip />} />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.35} strokeDasharray="4 4" />

                <Line
                  type="monotone"
                  dataKey="twrPct"
                  name="Portefeuille"
                  stroke={accentColor}
                  strokeWidth={2.25}
                  dot={showDailyDots ? { r: 1.7, fill: accentColor, strokeWidth: 0 } : false}
                  activeDot={{ r: 4, strokeWidth: 0, fill: accentColor }}
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
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={valueData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="valueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={valueColor} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={valueColor} stopOpacity={0.02} />
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
                  tickFormatter={fmtEurCompact}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  width={64}
                />
                <RechartsTooltip content={<ValueTooltip />} />

                <Area
                  type="monotone"
                  dataKey="portfolioValue"
                  name="Valeur"
                  stroke={valueColor}
                  strokeWidth={2.25}
                  fill="url(#valueGradient)"
                  dot={showDailyDots ? { r: 1.4, fill: valueColor, strokeWidth: 0 } : false}
                  activeDot={{ r: 4, strokeWidth: 0, fill: valueColor }}
                />

                <Line
                  type="stepAfter"
                  dataKey="cumulativeDeposits"
                  name="Dépôts cumulés"
                  stroke={depositsColor}
                  strokeWidth={1.75}
                  strokeDasharray="6 3"
                  dot={false}
                  activeDot={{ r: 3, strokeWidth: 0, fill: depositsColor }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
