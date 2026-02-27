import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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

type RatioMetricKind = "eps" | "fcf" | "revenue";
type RatioKey = "pe" | "pfcf" | "ps";

interface RatioConfig {
  key: RatioKey;
  title: string;
  metricLabel: string;
  metricKind: RatioMetricKind;
  testId: string;
}

interface RatioChartDataset {
  peSeries: RatioSeriesPoint[];
  pfcfSeries: RatioSeriesPoint[];
  psSeries: RatioSeriesPoint[];
  peQuarterlyPoints: RatioSeriesPoint[];
  pfcfQuarterlyPoints: RatioSeriesPoint[];
  psQuarterlyPoints: RatioSeriesPoint[];
}

interface RatioChartBlockProps {
  title: string;
  metricLabel: string;
  metricKind: RatioMetricKind;
  series: RatioSeriesPoint[];
  quarterlyPoints: RatioSeriesPoint[];
  isLoading: boolean;
  hasError: boolean;
  testId: string;
  chartHeight?: number;
  onOpenPopup?: () => void;
}

interface DateBounds {
  fromDate: string;
  toDate: string;
}

const PERIODS: RatioPeriod[] = ["1A", "2Y", "5A", "MAX"];

const RATIO_CONFIGS: RatioConfig[] = [
  {
    key: "pe",
    title: "Price / Earnings (P/E)",
    metricLabel: "EPS TTM",
    metricKind: "eps",
    testId: "ratio-chart-pe",
  },
  {
    key: "pfcf",
    title: "Price / Free Cash Flow (P/FCF)",
    metricLabel: "FCF TTM",
    metricKind: "fcf",
    testId: "ratio-chart-pfcf",
  },
  {
    key: "ps",
    title: "Price / Sales (P/S)",
    metricLabel: "CA TTM",
    metricKind: "revenue",
    testId: "ratio-chart-ps",
  },
];

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

function mapHistoryInterval(period: RatioPeriod): "1d" | "1wk" {
  if (period === "1A" || period === "2Y") return "1d";
  return "1wk";
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

function formatSourceDateLabel(value: string | null | undefined): string {
  if (!value) return "—";
  const ms = new Date(`${value}T00:00:00Z`).getTime();
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatSourceMetric(metricKind: RatioMetricKind, value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";

  if (metricKind === "eps") {
    return value.toLocaleString("fr-FR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  }

  return value.toLocaleString("fr-FR", {
    maximumFractionDigits: 0,
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

function parseInputDateToTimestamp(value: string, endOfDay = false): number | null {
  if (!value) return null;
  const ms = new Date(`${value}T00:00:00Z`).getTime();
  if (!Number.isFinite(ms)) return null;
  const base = Math.floor(ms / 1000);
  return endOfDay ? base + 86_399 : base;
}

function toInputDateFromTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function filterSeriesByDateRange(
  series: RatioSeriesPoint[],
  fromTimestamp: number | null,
  toTimestamp: number | null
): RatioSeriesPoint[] {
  return series.filter((point) => {
    if (fromTimestamp != null && point.time < fromTimestamp) return false;
    if (toTimestamp != null && point.time > toTimestamp) return false;
    return true;
  });
}

function getSeriesBounds(series: RatioSeriesPoint[]): DateBounds | null {
  if (series.length === 0) return null;
  return {
    fromDate: toInputDateFromTimestamp(series[0].time),
    toDate: toInputDateFromTimestamp(series[series.length - 1].time),
  };
}

function getSeriesByKey(data: RatioChartDataset | undefined, key: RatioKey): RatioSeriesPoint[] {
  if (!data) return [];
  if (key === "pe") return data.peSeries;
  if (key === "pfcf") return data.pfcfSeries;
  return data.psSeries;
}

function getQuarterlySeriesByKey(data: RatioChartDataset | undefined, key: RatioKey): RatioSeriesPoint[] {
  if (!data) return [];
  if (key === "pe") return data.peQuarterlyPoints;
  if (key === "pfcf") return data.pfcfQuarterlyPoints;
  return data.psQuarterlyPoints;
}

async function fetchRatioDataset(ticker: string, period: RatioPeriod): Promise<RatioChartDataset> {
  const range = mapRange(period);
  const periodYears = mapPeriodYears(period);
  const interval = mapHistoryInterval(period);

  const [historyResponse, fundamentalsResponse] = await Promise.all([
    supabase.functions.invoke("fetch-history", {
      body: { tickers: [ticker], range, interval },
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

function RatioChartBlock({
  title,
  metricLabel,
  metricKind,
  series,
  quarterlyPoints,
  isLoading,
  hasError,
  testId,
  chartHeight = 180,
  onOpenPopup,
}: RatioChartBlockProps) {
  const chartData = useMemo(
    () =>
      series.map((point) => ({
        time: point.time * 1000,
        value: point.value,
        sourceMetricValue: point.sourceMetricValue ?? null,
        sourceAsOfDate: point.sourceAsOfDate ?? null,
        sourceMetricKind: point.sourceMetricKind ?? "none",
      })),
    [series]
  );
  const quarterlyData = useMemo(
    () => quarterlyPoints.map((point) => ({ time: point.time * 1000, value: point.value })),
    [quarterlyPoints]
  );

  const stats = useMemo(() => computeStats(series), [series]);

  const yDomain = useMemo<[number, number] | ["auto", "auto"]>(() => {
    if (series.length === 0 && quarterlyPoints.length === 0) return ["auto", "auto"];

    const values = [...series, ...quarterlyPoints]
      .map((point) => point.value)
      .filter((value) => Number.isFinite(value));
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
  }, [series, quarterlyPoints]);

  return (
    <section className="relative rounded-lg border border-border/60 bg-muted/20 p-3" data-testid={testId}>
      {onOpenPopup && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="absolute right-2 top-2 h-7 w-7"
          onClick={onOpenPopup}
          aria-label={`Ouvrir ${title} en grand`}
          data-testid={`${testId}-open-popup`}
        >
          <ArrowUpRight className="h-4 w-4" />
        </Button>
      )}

      <h4 className="pr-8 text-sm font-semibold">{title}</h4>

      <div className="mt-2">
        {isLoading ? (
          <Skeleton className="w-full" style={{ height: chartHeight }} />
        ) : hasError ? (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height: chartHeight }}>
            Impossible de charger ce ratio.
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height: chartHeight }}>
            Données insuffisantes.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={chartHeight}>
            <ComposedChart data={chartData} margin={{ top: 6, right: 8, left: 0, bottom: 4 }}>
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
                  const valueEntry = payload.find((entry) => typeof entry?.value === "number");
                  const value = typeof valueEntry?.value === "number" ? valueEntry.value : null;
                  const labelTime = Number(label);
                  const fallbackTime = payload.find((entry) => typeof entry?.payload?.time === "number")?.payload?.time;
                  const time = Number.isFinite(labelTime) ? labelTime : Number(fallbackTime);
                  if (!Number.isFinite(time)) return null;

                  const sourceMetricValue =
                    typeof valueEntry?.payload?.sourceMetricValue === "number"
                      ? valueEntry.payload.sourceMetricValue
                      : null;
                  const sourceAsOfDate =
                    typeof valueEntry?.payload?.sourceAsOfDate === "string"
                      ? valueEntry.payload.sourceAsOfDate
                      : null;
                  const sourceMetricKind =
                    valueEntry?.payload?.sourceMetricKind === metricKind
                      ? valueEntry.payload.sourceMetricKind
                      : "none";

                  return (
                    <div className="rounded-lg border border-border/60 bg-card px-3 py-2 shadow-lg">
                      <p className="text-xs text-muted-foreground">{formatDateLabel(time)}</p>
                      <p className="text-sm font-semibold">{formatRatio(value)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {metricLabel} utilisé:{" "}
                        {sourceMetricKind === "none" ? "indisponible" : formatSourceMetric(metricKind, sourceMetricValue)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Publication utilisée: {formatSourceDateLabel(sourceAsOfDate)}
                      </p>
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
              {quarterlyData.map((point) => (
                <ReferenceDot
                  key={`${testId}-${point.time}`}
                  x={point.time}
                  y={point.value}
                  r={3}
                  fill="hsl(var(--chart-4))"
                  stroke="hsl(var(--card))"
                  strokeWidth={1}
                  ifOverflow="hidden"
                  isFront
                />
              ))}
            </ComposedChart>
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

  const [popupRatioKey, setPopupRatioKey] = useState<RatioKey | null>(null);
  const [popupPeriod, setPopupPeriod] = useState<RatioPeriod>("2Y");
  const [popupFromDate, setPopupFromDate] = useState("");
  const [popupToDate, setPopupToDate] = useState("");

  const popupOpen = popupRatioKey != null;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["watchlist-valuation-ratios", ticker, period],
    queryFn: () => fetchRatioDataset(ticker, period),
    enabled: Boolean(ticker),
    staleTime: 1000 * 60 * 15,
    retry: 1,
  });

  const {
    data: popupData,
    isLoading: isPopupLoading,
    isError: isPopupError,
  } = useQuery({
    queryKey: ["watchlist-valuation-ratios-popup", ticker, popupPeriod],
    queryFn: () => fetchRatioDataset(ticker, popupPeriod),
    enabled: Boolean(ticker) && popupOpen,
    staleTime: 1000 * 60 * 15,
    retry: 1,
  });

  const selectedPopupConfig = useMemo(
    () => RATIO_CONFIGS.find((config) => config.key === popupRatioKey) ?? null,
    [popupRatioKey]
  );

  const popupRawSeries = useMemo(
    () => (selectedPopupConfig ? getSeriesByKey(popupData, selectedPopupConfig.key) : []),
    [popupData, selectedPopupConfig]
  );
  const popupRawQuarterlySeries = useMemo(
    () => (selectedPopupConfig ? getQuarterlySeriesByKey(popupData, selectedPopupConfig.key) : []),
    [popupData, selectedPopupConfig]
  );
  const popupDefaultBounds = useMemo(() => getSeriesBounds(popupRawSeries), [popupRawSeries]);

  useEffect(() => {
    if (!popupOpen) return;
    if (!popupDefaultBounds) {
      setPopupFromDate("");
      setPopupToDate("");
      return;
    }

    setPopupFromDate((previous) =>
      previous === popupDefaultBounds.fromDate ? previous : popupDefaultBounds.fromDate
    );
    setPopupToDate((previous) =>
      previous === popupDefaultBounds.toDate ? previous : popupDefaultBounds.toDate
    );
  }, [popupOpen, popupRatioKey, popupPeriod, popupDefaultBounds]);

  const popupFromTimestamp = useMemo(
    () => parseInputDateToTimestamp(popupFromDate),
    [popupFromDate]
  );
  const popupToTimestamp = useMemo(
    () => parseInputDateToTimestamp(popupToDate, true),
    [popupToDate]
  );
  const hasInvalidPopupRange =
    popupFromTimestamp != null &&
    popupToTimestamp != null &&
    popupFromTimestamp > popupToTimestamp;

  const popupFilteredSeries = useMemo(
    () => filterSeriesByDateRange(popupRawSeries, popupFromTimestamp, popupToTimestamp),
    [popupRawSeries, popupFromTimestamp, popupToTimestamp]
  );
  const popupFilteredQuarterlySeries = useMemo(
    () => filterSeriesByDateRange(popupRawQuarterlySeries, popupFromTimestamp, popupToTimestamp),
    [popupRawQuarterlySeries, popupFromTimestamp, popupToTimestamp]
  );

  function openChartPopup(key: RatioKey) {
    setPopupRatioKey(key);
    setPopupPeriod(period);
    setPopupFromDate("");
    setPopupToDate("");
  }

  function resetPopupDates() {
    if (!popupDefaultBounds) {
      setPopupFromDate("");
      setPopupToDate("");
      return;
    }

    setPopupFromDate(popupDefaultBounds.fromDate);
    setPopupToDate(popupDefaultBounds.toDate);
  }

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
        {RATIO_CONFIGS.map((config) => (
          <RatioChartBlock
            key={config.key}
            title={config.title}
            metricLabel={config.metricLabel}
            metricKind={config.metricKind}
            series={getSeriesByKey(data, config.key)}
            quarterlyPoints={getQuarterlySeriesByKey(data, config.key)}
            isLoading={isLoading}
            hasError={isError}
            testId={config.testId}
            onOpenPopup={() => openChartPopup(config.key)}
          />
        ))}
      </div>

      <Dialog
        open={popupOpen}
        onOpenChange={(open) => {
          if (!open) setPopupRatioKey(null);
        }}
      >
        <DialogContent
          className="w-[95vw] max-w-[1200px] max-h-[90vh] overflow-y-auto p-4 sm:p-5"
          data-testid="ratio-popup"
        >
          <DialogHeader>
            <DialogTitle>{selectedPopupConfig?.title ?? "Ratio"} · {ticker}</DialogTitle>
            <DialogDescription>
              Vue agrandie avec sélection de période, plage de dates et détail des données fondamentales au survol.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-1.5">
              {PERIODS.map((entry) => (
                <Button
                  key={`popup-${entry}`}
                  type="button"
                  size="sm"
                  variant={popupPeriod === entry ? "default" : "ghost"}
                  className="h-8 px-2.5 text-xs"
                  onClick={() => {
                    setPopupPeriod(entry);
                    setPopupFromDate("");
                    setPopupToDate("");
                  }}
                  data-testid={`ratio-popup-period-${entry}`}
                >
                  {entry}
                </Button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Du</span>
                <Input
                  type="date"
                  className="h-9"
                  value={popupFromDate}
                  onChange={(event) => setPopupFromDate(event.target.value)}
                  data-testid="ratio-popup-from-date"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Au</span>
                <Input
                  type="date"
                  className="h-9"
                  value={popupToDate}
                  onChange={(event) => setPopupToDate(event.target.value)}
                  data-testid="ratio-popup-to-date"
                />
              </label>

              <Button
                type="button"
                variant="outline"
                className="h-9"
                onClick={resetPopupDates}
                data-testid="ratio-popup-reset-dates"
              >
                Réinitialiser
              </Button>
            </div>

            {hasInvalidPopupRange ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                La date de début doit être antérieure ou égale à la date de fin.
              </div>
            ) : selectedPopupConfig ? (
              <RatioChartBlock
                title={selectedPopupConfig.title}
                metricLabel={selectedPopupConfig.metricLabel}
                metricKind={selectedPopupConfig.metricKind}
                series={popupFilteredSeries}
                quarterlyPoints={popupFilteredQuarterlySeries}
                isLoading={isPopupLoading}
                hasError={isPopupError}
                testId="ratio-popup-chart-active"
                chartHeight={360}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
