import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import {
  buildRatioSeries,
  computeStats,
  FundamentalsHistorySnapshot,
  RatioPricePoint,
  RatioSeriesPoint,
} from "@/lib/watchlistRatios";
import { RatioPeriod } from "@/lib/watchlistTypes";

interface Props {
  ticker: string;
}

interface RatioChartDataset {
  peSeries: RatioSeriesPoint[];
  pfcfSeries: RatioSeriesPoint[];
  psSeries: RatioSeriesPoint[];
}

interface RatioChartBlockProps {
  title: string;
  series: RatioSeriesPoint[];
  isLoading: boolean;
  hasError: boolean;
  testId: string;
}

const PERIODS: RatioPeriod[] = ["1A", "2Y", "5A", "MAX"];

function mapRange(period: RatioPeriod): string {
  if (period === "1A") return "1y";
  if (period === "2Y") return "2y";
  if (period === "5A") return "5y";
  return "max";
}

function mapPeriodYears(period: RatioPeriod): number {
  if (period === "1A") return 1;
  if (period === "2Y") return 2;
  if (period === "5A") return 5;
  return 10;
}

function formatRatio(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateTick(ms: number): string {
  return new Date(ms).toLocaleDateString("fr-FR", {
    month: "short",
    year: "2-digit",
  });
}

function formatDateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function normalizePriceHistory(rawHistory: unknown): RatioPricePoint[] {
  if (!Array.isArray(rawHistory)) return [];

  return rawHistory
    .filter((point) => typeof point?.time === "number" && typeof point?.price === "number")
    .map((point) => ({
      time: point.time,
      price: point.price,
    }));
}

function normalizeSnapshots(rawSnapshots: unknown): FundamentalsHistorySnapshot[] {
  if (!Array.isArray(rawSnapshots)) return [];

  return rawSnapshots
    .filter((snapshot) => typeof snapshot?.asOfDate === "string")
    .map((snapshot) => ({
      asOfDate: snapshot.asOfDate,
      trailingPeRatio: typeof snapshot.trailingPeRatio === "number" ? snapshot.trailingPeRatio : null,
      trailingEps: typeof snapshot.trailingEps === "number" ? snapshot.trailingEps : null,
      trailingFreeCashFlow: typeof snapshot.trailingFreeCashFlow === "number" ? snapshot.trailingFreeCashFlow : null,
      trailingTotalRevenue: typeof snapshot.trailingTotalRevenue === "number" ? snapshot.trailingTotalRevenue : null,
      trailingShares: typeof snapshot.trailingShares === "number" ? snapshot.trailingShares : null,
    }));
}

async function fetchRatioDataset(ticker: string, period: RatioPeriod): Promise<RatioChartDataset> {
  const range = mapRange(period);
  const periodYears = mapPeriodYears(period);

  const [historyResponse, fundamentalsResponse] = await Promise.all([
    supabase.functions.invoke("fetch-history", {
      body: { tickers: [ticker], range, interval: "1d" },
    }),
    supabase.functions.invoke("fetch-prices", {
      body: { tickers: [ticker], mode: "fundamentals-history", periodYears },
    }),
  ]);

  if (historyResponse.error) throw historyResponse.error;
  if (fundamentalsResponse.error) throw fundamentalsResponse.error;

  const history = normalizePriceHistory(historyResponse.data?.results?.[ticker]?.history);
  const snapshots = normalizeSnapshots(fundamentalsResponse.data?.results?.[ticker]?.snapshots);

  return buildRatioSeries(history, snapshots);
}

function RatioChartBlock({ title, series, isLoading, hasError, testId }: RatioChartBlockProps) {
  const chartData = useMemo(
    () => series.map((point) => ({ time: point.time * 1000, value: point.value })),
    [series]
  );

  const stats = useMemo(() => computeStats(series), [series]);

  const yDomain = useMemo<[number, number] | ["auto", "auto"]>(() => {
    if (series.length === 0) return ["auto", "auto"];

    const values = series.map((point) => point.value).filter((value) => Number.isFinite(value));
    if (values.length === 0) return ["auto", "auto"];

    const min = Math.min(...values);
    const max = Math.max(...values);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return ["auto", "auto"];

    if (max === min) {
      const pad = Math.max(Math.abs(max) * 0.1, 1);
      return [min - pad, max + pad];
    }

    const pad = (max - min) * 0.12;
    return [Math.max(0, min - pad), max + pad];
  }, [series]);

  return (
    <section className="rounded-lg border border-border/60 bg-muted/20 p-3" data-testid={testId}>
      <h4 className="text-sm font-semibold">{title}</h4>

      <div className="mt-2">
        {isLoading ? (
          <Skeleton className="h-[180px] w-full" />
        ) : hasError ? (
          <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">
            Impossible de charger ce ratio.
          </div>
        ) : chartData.length < 2 ? (
          <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">
            Données insuffisantes.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={chartData} margin={{ top: 6, right: 8, left: 0, bottom: 4 }}>
              <defs>
                <linearGradient id={`${testId}-area`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                type="number"
                dataKey="time"
                domain={["dataMin", "dataMax"]}
                tickFormatter={formatDateTick}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                width={46}
                domain={yDomain}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => formatRatio(Number(value))}
              />
              {stats.median != null && (
                <ReferenceLine
                  y={stats.median}
                  stroke="hsl(var(--chart-3))"
                  strokeDasharray="5 5"
                  strokeWidth={1.3}
                  ifOverflow="extendDomain"
                />
              )}
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const value = typeof payload[0]?.value === "number" ? payload[0].value : null;

                  return (
                    <div className="rounded-lg border border-border/60 bg-card px-3 py-2 shadow-lg">
                      <p className="text-xs text-muted-foreground">{formatDateLabel(Number(label))}</p>
                      <p className="text-sm font-semibold">{formatRatio(value)}</p>
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="hsl(var(--chart-1))"
                strokeWidth={2}
                fill={`url(#${testId}-area)`}
                dot={false}
                activeDot={{ r: 3 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-2 text-xs sm:text-sm">
        <span className="rounded-full border border-rose-500/25 bg-rose-500/10 px-2.5 py-1 font-semibold text-rose-300">
          High: {formatRatio(stats.high)}
        </span>
        <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 font-semibold text-amber-300">
          Médiane: {formatRatio(stats.median)}
        </span>
        <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 font-semibold text-emerald-300">
          Low: {formatRatio(stats.low)}
        </span>
      </div>
    </section>
  );
}

export function WatchlistValuationRatiosCard({ ticker }: Props) {
  const [period, setPeriod] = useState<RatioPeriod>("2Y");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["watchlist-valuation-ratios", ticker, period],
    queryFn: () => fetchRatioDataset(ticker, period),
    enabled: Boolean(ticker),
    staleTime: 1000 * 60 * 15,
    retry: 1,
  });

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 space-y-4 min-w-0" data-testid="valuation-ratios-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Ratios de valorisation</h3>
          <p className="text-xs text-muted-foreground">Historique P/E, P/FCF et P/S</p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {PERIODS.map((entry) => (
            <Button
              key={entry}
              type="button"
              size="sm"
              variant={period === entry ? "default" : "ghost"}
              className="h-8 px-2.5 text-xs"
              onClick={() => setPeriod(entry)}
              data-testid={`ratio-period-${entry}`}
            >
              {entry}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <RatioChartBlock
          title="Price / Earnings (P/E)"
          series={data?.peSeries ?? []}
          isLoading={isLoading}
          hasError={isError}
          testId="ratio-chart-pe"
        />
        <RatioChartBlock
          title="Price / Free Cash Flow (P/FCF)"
          series={data?.pfcfSeries ?? []}
          isLoading={isLoading}
          hasError={isError}
          testId="ratio-chart-pfcf"
        />
        <RatioChartBlock
          title="Price / Sales (P/S)"
          series={data?.psSeries ?? []}
          isLoading={isLoading}
          hasError={isError}
          testId="ratio-chart-ps"
        />
      </div>
    </div>
  );
}
