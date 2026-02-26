import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { TickerLogo } from "@/components/TickerLogo";
import { formatCurrency, formatPercent } from "@/lib/calculations";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowUp, ArrowDown } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import { supabase } from "@/integrations/supabase/client";

interface TickerInfo {
  ticker: string;
  name: string;
  currentPrice: number;
  changePercent: number;
  currency: string;
  previousClose?: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tickerInfo: TickerInfo | null;
}

interface PeriodConfig {
  label: string;
  range: string;
  interval: string;
  windowSeconds?: number;
  includePrePost?: boolean;
}

const DAY_SECONDS = 24 * 60 * 60;

const PERIODS: readonly PeriodConfig[] = [
  { label: "1D", range: "5d", interval: "15m", windowSeconds: DAY_SECONDS, includePrePost: true },
  { label: "1S", range: "5d", interval: "15m" },
  { label: "1M", range: "1mo", interval: "1d" },
  { label: "3M", range: "3mo", interval: "1d" },
  { label: "6M", range: "6mo", interval: "1d" },
  { label: "1A", range: "1y", interval: "1wk" },
  { label: "5A", range: "5y", interval: "1wk" },
];

interface ChartPoint {
  time: number;
  price: number;
  label: string;
  session: SessionType | null;
}

interface ChartResult {
  points: ChartPoint[];
  previousClose: number | null;
  sessionWindow: { start: number; end: number } | null;
}

type SessionType = "pre" | "regular" | "post";

type TradingPeriod = { start: number; end: number };
type SessionPeriods = {
  pre: TradingPeriod[];
  regular: TradingPeriod[];
  post: TradingPeriod[];
};

function flattenTradingPeriods(input: unknown): TradingPeriod[] {
  const periods: TradingPeriod[] = [];

  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }

    if (node && typeof node === "object") {
      const maybeStart = (node as { start?: unknown }).start;
      const maybeEnd = (node as { end?: unknown }).end;
      const start = typeof maybeStart === "number" ? maybeStart : null;
      const end = typeof maybeEnd === "number" ? maybeEnd : null;

      if (start !== null && end !== null && Number.isFinite(start) && Number.isFinite(end) && end > start) {
        periods.push({ start, end });
      }
    }
  };

  walk(input);
  return periods;
}

function extractSessionPeriods(metaTradingPeriods: unknown): SessionPeriods {
  const raw = (metaTradingPeriods ?? {}) as {
    pre?: unknown;
    regular?: unknown;
    post?: unknown;
  };

  return {
    pre: flattenTradingPeriods(raw.pre),
    regular: flattenTradingPeriods(raw.regular),
    post: flattenTradingPeriods(raw.post),
  };
}

function isInTradingPeriods(timestamp: number, periods: TradingPeriod[]): boolean {
  for (const p of periods) {
    if (timestamp >= p.start && timestamp < p.end) return true;
  }
  return false;
}

function resolveSession(timestamp: number, periods: SessionPeriods): SessionType | null {
  if (isInTradingPeriods(timestamp, periods.regular)) return "regular";
  if (isInTradingPeriods(timestamp, periods.pre)) return "pre";
  if (isInTradingPeriods(timestamp, periods.post)) return "post";
  return null;
}

function sessionLabel(session: SessionType | null): string | null {
  if (session === "regular") return "Séance régulière";
  if (session === "pre") return "Pré-marché";
  if (session === "post") return "Post-marché";
  return null;
}

function makeLabel(timestamp: number, interval: string): string {
  const d = new Date(timestamp * 1000);
  return interval.includes("m")
    ? d.toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" });
}

function trimToWindow(points: ChartPoint[], windowSeconds?: number): ChartPoint[] {
  if (!windowSeconds || points.length === 0) return points;

  const latestTime = points[points.length - 1].time;
  const cutoff = latestTime - windowSeconds;
  const trimmed = points.filter((p) => p.time >= cutoff);
  return trimmed.length > 1 ? trimmed : points;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function trimToLatestRegularSession(points: ChartPoint[]): { points: ChartPoint[]; sessionWindow: { start: number; end: number } | null } {
  if (points.length === 0) return { points, sessionWindow: null };

  const regularPoints = points.filter((p) => p.session === "regular");
  if (regularPoints.length === 0) return { points, sessionWindow: null };

  // A large intraday gap indicates a new market day.
  const SESSION_BREAK_SECONDS = 3 * 60 * 60;
  const sessions: ChartPoint[][] = [[regularPoints[0]]];

  for (let i = 1; i < regularPoints.length; i++) {
    if (regularPoints[i].time - regularPoints[i - 1].time > SESSION_BREAK_SECONDS) {
      sessions.push([regularPoints[i]]);
    } else {
      sessions[sessions.length - 1].push(regularPoints[i]);
    }
  }

  const latestSession = sessions[sessions.length - 1];
  const latestStart = latestSession[0].time;
  const latestLast = latestSession[latestSession.length - 1].time;

  const previousDurations = sessions
    .slice(0, -1)
    .map((session) => session[session.length - 1].time - session[0].time)
    .filter((duration) => duration > 0);
  const typicalDuration = median(previousDurations);
  const inferredEnd = typicalDuration != null
    ? Math.max(latestLast, latestStart + typicalDuration)
    : latestLast;

  return {
    points: latestSession.length > 0 ? latestSession : points,
    sessionWindow: { start: latestStart, end: inferredEnd },
  };
}

async function fetchChartData(
  ticker: string,
  range: string,
  interval: string,
  windowSeconds?: number,
  includePrePost = false
): Promise<ChartResult> {
  const empty: ChartResult = { points: [], previousClose: null, sessionWindow: null };

  // In dev, try local proxy first for speed
  if (import.meta.env.DEV) {
    try {
      const prePostParam = includePrePost ? "&includePrePost=true" : "";
      const url = `/api/yf/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&events=history${prePostParam}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { Accept: "application/json" } });
      if (resp.ok) {
        const data = await resp.json();
        const result = data?.chart?.result?.[0];
        if (result?.timestamp && result?.indicators?.quote?.[0]?.close) {
          const ts: number[] = result.timestamp;
          const cl: (number | null)[] = result.indicators.quote[0].close;
          const sessionPeriods = includePrePost ? extractSessionPeriods(result?.meta?.tradingPeriods) : null;
          const points = ts.map((t, i) => cl[i] != null
            ? {
              time: t,
              price: cl[i] as number,
              label: makeLabel(t, interval),
              session: sessionPeriods ? resolveSession(t, sessionPeriods) : null,
            }
            : null)
            .filter((p): p is ChartPoint => p !== null);
          const prevClose = result?.meta?.chartPreviousClose ?? result?.meta?.previousClose ?? null;
          if (includePrePost) {
            const trimmed = trimToLatestRegularSession(points);
            return { points: trimmed.points, previousClose: prevClose, sessionWindow: trimmed.sessionWindow };
          }
          return { points: trimToWindow(points, windowSeconds), previousClose: prevClose, sessionWindow: null };
        }
      }
    } catch { /* fall through */ }
  }

  // Production: use Edge Function (no CORS issues)
  try {
    const { data, error } = await supabase.functions.invoke("fetch-history", {
      body: { tickers: [ticker], range, interval, includePrePost },
    });
    if (error || !data?.results?.[ticker]?.history) return empty;
    const result = data.results[ticker];
    const points = (result.history as { time: number; price: number; session?: SessionType }[])
      .map(h => ({ time: h.time, price: h.price, label: makeLabel(h.time, interval), session: h.session ?? null }));
    const prevClose = result.previousClose ?? null;
    if (includePrePost) {
      const trimmed = trimToLatestRegularSession(points);
      return { points: trimmed.points, previousClose: prevClose, sessionWindow: trimmed.sessionWindow };
    }
    return { points: trimToWindow(points, windowSeconds), previousClose: prevClose, sessionWindow: null };
  } catch {
    return empty;
  }
}

function ChartContent({ tickerInfo }: { tickerInfo: TickerInfo }) {
  const [period, setPeriod] = useState<PeriodConfig>(PERIODS[0]);
  const [chartResult, setChartResult] = useState<ChartResult>({ points: [], previousClose: null });
  const [loading, setLoading] = useState(true);
  const isMobile = useIsMobile();

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchChartData(
      tickerInfo.ticker,
      period.range,
      period.interval,
      period.windowSeconds,
      period.includePrePost
    );
    setChartResult(result);
    setLoading(false);
  }, [tickerInfo.ticker, period.range, period.interval, period.windowSeconds, period.includePrePost]);

  useEffect(() => { load(); }, [load]);

  const data = chartResult.points;
  const is1D = period.label === "1D";

  // For 1D: use previousClose as reference. Otherwise use first point.
  const referencePrice = is1D
    ? (tickerInfo.previousClose ?? chartResult.previousClose ?? data[0]?.price ?? null)
    : (data[0]?.price ?? null);
  const lastPrice = data.length > 0 ? data[data.length - 1].price : null;
  const regularPoints = is1D ? data.filter((pt) => pt.session === "regular") : data;
  const regularLastPrice = regularPoints.length > 0 ? regularPoints[regularPoints.length - 1].price : null;
  const changePrice = is1D ? regularLastPrice : lastPrice;
  const periodChangePercent =
    referencePrice && changePrice != null && referencePrice !== 0
      ? ((changePrice - referencePrice) / referencePrice) * 100
      : null;
  const displayedChangePercent = periodChangePercent ?? tickerInfo.changePercent;
  const isUp = displayedChangePercent >= 0;
  const color = isUp ? "hsl(142, 71%, 45%)" : "hsl(0, 84%, 60%)";
  const gradientId = `chart-grad-${tickerInfo.ticker}`;
  const hasSessionData = is1D && data.some((pt) => pt.session === "pre" || pt.session === "post");
  const chartData = data.map((pt) => ({
    ...pt,
    regularPrice: hasSessionData ? (pt.session === "regular" ? pt.price : null) : pt.price,
    prePrice: hasSessionData && pt.session === "pre" ? pt.price : null,
    postPrice: hasSessionData && pt.session === "post" ? pt.price : null,
  }));

  const formatYAxis = (v: number) => {
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return v.toFixed(v < 10 ? 2 : 0);
  };

  // Compute Y domain to include previousClose reference line
  const yDomain: [string | number, string | number] = (() => {
    if (!is1D || !referencePrice || data.length === 0) return ["auto", "auto"];
    const prices = data.map(d => d.price);
    const minP = Math.min(...prices, referencePrice);
    const maxP = Math.max(...prices, referencePrice);
    const margin = (maxP - minP) * 0.05 || referencePrice * 0.002;
    return [minP - margin, maxP + margin];
  })();
  const sessionWindow = is1D ? chartResult.sessionWindow : null;
  const format1DTick = (sec: number) =>
    new Date(sec * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex w-full items-start gap-3 px-1 pr-2 sm:pr-8">
        <TickerLogo ticker={tickerInfo.ticker} className="w-10 h-10 rounded-full shrink-0" />
        <div className="flex-1 min-w-0 overflow-hidden pr-1">
          <div className="font-semibold text-sm leading-tight line-clamp-2 break-words">{tickerInfo.name}</div>
          <div className="text-xs text-muted-foreground truncate">{tickerInfo.ticker}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-bold text-sm">{formatCurrency(tickerInfo.currentPrice, tickerInfo.currency)}</div>
          <div className={`flex items-center justify-end gap-0.5 text-xs font-semibold ${displayedChangePercent >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
            {displayedChangePercent >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            {formatPercent(displayedChangePercent)}
          </div>
        </div>
      </div>

      {/* Period selector */}
      <div className="flex gap-1 px-1">
        {PERIODS.map(p => (
          <button
            key={p.label}
            onClick={() => setPeriod(p)}
            className={`flex-1 text-xs font-semibold py-1.5 rounded-md transition-colors ${
              period.label === p.label
                ? "bg-primary text-primary-foreground"
                : "bg-muted/50 text-muted-foreground hover:bg-muted"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {hasSessionData && (
        <div className="flex items-center justify-end gap-3 px-1 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-yellow-400" />
            Pré-marché
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
            Séance régulière
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-blue-400" />
            Post-marché
          </span>
        </div>
      )}

      {/* Chart */}
      {loading ? (
        <Skeleton className="w-full rounded-lg" style={{ height: isMobile ? 220 : 280 }} />
      ) : data.length === 0 ? (
        <div className="flex items-center justify-center text-muted-foreground text-xs" style={{ height: isMobile ? 220 : 280 }}>
          Aucune donnée disponible
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={isMobile ? 220 : 280}>
          <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            {is1D && sessionWindow ? (
              <XAxis
                type="number"
                dataKey="time"
                domain={[sessionWindow.start, sessionWindow.end]}
                allowDataOverflow
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={format1DTick}
                minTickGap={40}
                tickCount={6}
              />
            ) : (
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={40}
              />
            )}
            <YAxis
              domain={yDomain}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={formatYAxis}
              width={48}
            />
            {is1D && referencePrice != null && (
              <ReferenceLine
                y={referencePrice}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="4 4"
                strokeOpacity={0.5}
              />
            )}
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const pt = payload[0].payload as ChartPoint;
                const changeFromRef = referencePrice && referencePrice !== 0
                  ? ((pt.price - referencePrice) / referencePrice) * 100
                  : null;
                const currentSessionLabel = hasSessionData ? sessionLabel(pt.session) : null;
                return (
                  <div className="rounded-lg border bg-popover px-3 py-2 shadow-md">
                    <div className="text-[10px] text-muted-foreground">{pt.label}</div>
                    {currentSessionLabel && (
                      <div className="text-[10px] text-muted-foreground">{currentSessionLabel}</div>
                    )}
                    <div className="font-bold text-sm">{formatCurrency(pt.price, tickerInfo.currency)}</div>
                    {changeFromRef != null && (
                      <div className={`text-[10px] font-semibold ${changeFromRef >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                        {changeFromRef >= 0 ? "+" : ""}{changeFromRef.toFixed(2)}%
                      </div>
                    )}
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="regularPrice"
              stroke={color}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={{ r: 4, fill: color }}
            />
            {hasSessionData && (
              <>
                <Area
                  type="monotone"
                  dataKey="prePrice"
                  stroke="hsl(45, 96%, 53%)"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  fill="none"
                  dot={false}
                  activeDot={{ r: 3, fill: "hsl(45, 96%, 53%)" }}
                />
                <Area
                  type="monotone"
                  dataKey="postPrice"
                  stroke="hsl(221, 83%, 53%)"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  fill="none"
                  dot={false}
                  activeDot={{ r: 3, fill: "hsl(221, 83%, 53%)" }}
                />
              </>
            )}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export function TickerChartPopup({ open, onOpenChange, tickerInfo }: Props) {
  const isMobile = useIsMobile();

  if (!tickerInfo) return null;

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="px-4 pb-6">
          <DrawerHeader className="px-0 pt-2 pb-0">
            <DrawerTitle className="sr-only">{tickerInfo.name}</DrawerTitle>
          </DrawerHeader>
          <ChartContent tickerInfo={tickerInfo} />
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-5">
        <DialogHeader className="sr-only">
          <DialogTitle>{tickerInfo.name}</DialogTitle>
        </DialogHeader>
        <ChartContent tickerInfo={tickerInfo} />
      </DialogContent>
    </Dialog>
  );
}
