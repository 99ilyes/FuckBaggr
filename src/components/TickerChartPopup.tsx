import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { TickerLogo } from "@/components/TickerLogo";
import { formatCurrency, formatPercent } from "@/lib/calculations";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowUp, ArrowDown } from "lucide-react";
import { ComposedChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Line } from "recharts";
import { supabase } from "@/integrations/supabase/client";

interface TickerInfo {
  ticker: string;
  name: string;
  currentPrice: number;
  changePercent: number;
  currency: string;
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
  // 1D uses 5d/15m for broad compatibility, then gets trimmed to the last 24h of points.
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
  session: "pre" | "regular" | "post" | null;
  regularPrice: number | null;
  prePrice: number | null;
  postPrice: number | null;
}

type SessionType = ChartPoint["session"];

interface TradingPeriod {
  start: number;
  end: number;
}

interface SessionPeriods {
  pre: TradingPeriod[];
  regular: TradingPeriod[];
  post: TradingPeriod[];
}

function normalizeSession(session: unknown): SessionType {
  return session === "pre" || session === "regular" || session === "post" ? session : null;
}

function flattenTradingPeriods(input: unknown): TradingPeriod[] {
  const periods: TradingPeriod[] = [];

  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (!node || typeof node !== "object") return;

    const startRaw = (node as { start?: unknown }).start;
    const endRaw = (node as { end?: unknown }).end;
    const start = typeof startRaw === "number" ? startRaw : null;
    const end = typeof endRaw === "number" ? endRaw : null;
    if (start !== null && end !== null && Number.isFinite(start) && Number.isFinite(end) && end > start) {
      periods.push({ start, end });
    }
  };

  walk(input);
  return periods;
}

function extractSessionPeriods(rawTradingPeriods: unknown): SessionPeriods {
  const tradingPeriods = (rawTradingPeriods ?? {}) as {
    pre?: unknown;
    regular?: unknown;
    post?: unknown;
  };

  return {
    pre: flattenTradingPeriods(tradingPeriods.pre),
    regular: flattenTradingPeriods(tradingPeriods.regular),
    post: flattenTradingPeriods(tradingPeriods.post),
  };
}

function isInPeriods(timestamp: number, periods: TradingPeriod[]): boolean {
  for (const period of periods) {
    if (timestamp >= period.start && timestamp < period.end) return true;
  }
  return false;
}

function resolveSession(timestamp: number, periods: SessionPeriods): SessionType {
  if (isInPeriods(timestamp, periods.regular)) return "regular";
  if (isInPeriods(timestamp, periods.pre)) return "pre";
  if (isInPeriods(timestamp, periods.post)) return "post";
  return null;
}

function buildChartPoint(time: number, price: number, interval: string, session: SessionType, splitSessions: boolean): ChartPoint {
  const sessionToUse = splitSessions ? session : null;
  return {
    time,
    price,
    label: makeLabel(time, interval),
    session: sessionToUse,
    regularPrice: sessionToUse === null || sessionToUse === "regular" ? price : null,
    prePrice: sessionToUse === "pre" ? price : null,
    postPrice: sessionToUse === "post" ? price : null,
  };
}

function buildPointsFromYahooResult(result: any, interval: string, includePrePost: boolean): ChartPoint[] {
  const timestamps = Array.isArray(result?.timestamp) ? (result.timestamp as number[]) : [];
  const closes = Array.isArray(result?.indicators?.quote?.[0]?.close)
    ? (result.indicators.quote[0].close as Array<number | null>)
    : [];
  if (timestamps.length === 0 || closes.length === 0) return [];

  const sessionPeriods = includePrePost ? extractSessionPeriods(result?.meta?.tradingPeriods) : null;
  const maxLen = Math.min(timestamps.length, closes.length);
  const points: ChartPoint[] = [];

  for (let i = 0; i < maxLen; i++) {
    const time = timestamps[i];
    const price = closes[i];
    if (typeof price !== "number" || !Number.isFinite(price)) continue;

    const session = sessionPeriods ? resolveSession(time, sessionPeriods) : null;
    points.push(buildChartPoint(time, price, interval, session, includePrePost));
  }

  return points;
}

function buildPointsFromEdgeHistory(
  history: Array<{ time: number; price: number; session?: SessionType }>,
  interval: string,
  includePrePost: boolean
): ChartPoint[] {
  const points: ChartPoint[] = [];
  for (const h of history) {
    if (typeof h.time !== "number" || typeof h.price !== "number" || !Number.isFinite(h.price)) continue;
    points.push(buildChartPoint(h.time, h.price, interval, includePrePost ? normalizeSession(h.session) : null, includePrePost));
  }
  return points;
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

async function fetchChartData(
  ticker: string,
  range: string,
  interval: string,
  windowSeconds?: number,
  includePrePost = false
): Promise<ChartPoint[]> {
  const fetchFromYahoo = async (): Promise<ChartPoint[]> => {
    try {
      const baseUrl = import.meta.env.DEV ? "/api/yf" : "https://query2.finance.yahoo.com";
      const url = `${baseUrl}/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&events=history&includePrePost=${includePrePost ? "true" : "false"}`;
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: { Accept: "application/json" },
      });
      if (!resp.ok) return [];
      const data = await resp.json();
      const result = data?.chart?.result?.[0];
      return buildPointsFromYahooResult(result, interval, includePrePost);
    } catch {
      return [];
    }
  };

  const fetchFromEdge = async (): Promise<ChartPoint[]> => {
    try {
      const { data, error } = await supabase.functions.invoke("fetch-history", {
        body: { tickers: [ticker], range, interval, includePrePost },
      });
      if (error || !data?.results?.[ticker]?.history) return [];
      return buildPointsFromEdgeHistory(
        data.results[ticker].history as Array<{ time: number; price: number; session?: SessionType }>,
        interval,
        includePrePost
      );
    } catch {
      return [];
    }
  };

  // Prod-first path: Edge Function first (stable in production), then direct Yahoo fallback.
  if (import.meta.env.PROD) {
    const edgePoints = await fetchFromEdge();
    const edgeHasExtendedSessions = edgePoints.some((p) => p.session === "pre" || p.session === "post");
    if (edgePoints.length > 0 && (!includePrePost || edgeHasExtendedSessions)) {
      return trimToWindow(edgePoints, windowSeconds);
    }

    const yahooPoints = await fetchFromYahoo();
    if (yahooPoints.length > 0) return trimToWindow(yahooPoints, windowSeconds);
    return edgePoints.length > 0 ? trimToWindow(edgePoints, windowSeconds) : [];
  }

  // Dev-first path: local Yahoo proxy first for quick iteration, Edge fallback.
  const yahooPoints = await fetchFromYahoo();
  if (yahooPoints.length > 0) return trimToWindow(yahooPoints, windowSeconds);

  const edgePoints = await fetchFromEdge();
  if (edgePoints.length > 0) return trimToWindow(edgePoints, windowSeconds);
  return [];
}

function ChartContent({ tickerInfo }: { tickerInfo: TickerInfo }) {
  const [period, setPeriod] = useState<PeriodConfig>(PERIODS[0]);
  const [data, setData] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const isMobile = useIsMobile();
  const useSessionSplit = period.includePrePost === true;

  const load = useCallback(async () => {
    setLoading(true);
    const pts = await fetchChartData(
      tickerInfo.ticker,
      period.range,
      period.interval,
      period.windowSeconds,
      period.includePrePost === true
    );
    setData(pts);
    setLoading(false);
  }, [tickerInfo.ticker, period.range, period.interval, period.windowSeconds, period.includePrePost]);

  useEffect(() => { load(); }, [load]);

  const firstPrice = data[0]?.price ?? null;
  const lastPrice = data.length > 0 ? data[data.length - 1].price : null;
  const periodChangePercent =
    firstPrice && lastPrice != null
      ? ((lastPrice - firstPrice) / firstPrice) * 100
      : null;
  const displayedChangePercent = periodChangePercent ?? tickerInfo.changePercent;
  const isUp = displayedChangePercent >= 0;
  const color = isUp ? "hsl(142, 71%, 45%)" : "hsl(0, 84%, 60%)";
  const preColor = "hsl(42, 96%, 56%)";
  const postColor = "hsl(210, 100%, 62%)";
  const gradientId = `chart-grad-${tickerInfo.ticker}`;

  const formatYAxis = (v: number) => {
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return v.toFixed(v < 10 ? 2 : 0);
  };

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
      {useSessionSplit && (
        <div className="flex items-center gap-3 px-1 text-[10px] text-muted-foreground flex-wrap">
          <div className="flex items-center gap-1">
            <span className="h-[2px] w-4 rounded-full" style={{ backgroundColor: color }} />
            <span>Heures ouvertes</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="h-0 w-4 border-t border-dashed" style={{ borderColor: preColor }} />
            <span>Pré-marché</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="h-0 w-4 border-t border-dashed" style={{ borderColor: postColor }} />
            <span>Post-marché</span>
          </div>
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
          <ComposedChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis
              domain={["auto", "auto"]}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={formatYAxis}
              width={48}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const pt = payload[0].payload as ChartPoint;
                const extendedSessionLabel =
                  pt.session === "pre"
                    ? "Pré-marché"
                    : pt.session === "post"
                      ? "Post-marché"
                      : null;
                return (
                  <div className="rounded-lg border bg-popover px-3 py-2 shadow-md">
                    <div className="text-[10px] text-muted-foreground">{pt.label}</div>
                    <div className="font-bold text-sm">{formatCurrency(pt.price, tickerInfo.currency)}</div>
                    {useSessionSplit && extendedSessionLabel && (
                      <div className={`text-[10px] font-medium ${pt.session === "pre" ? "text-yellow-400" : "text-blue-400"}`}>
                        {extendedSessionLabel}
                      </div>
                    )}
                  </div>
                );
              }}
            />
            {useSessionSplit ? (
              <>
                <Area
                  type="monotone"
                  dataKey="regularPrice"
                  stroke={color}
                  strokeWidth={2}
                  fill={`url(#${gradientId})`}
                  dot={false}
                  activeDot={{ r: 4, fill: color }}
                />
                <Line
                  type="monotone"
                  dataKey="prePrice"
                  stroke={preColor}
                  strokeWidth={1.8}
                  strokeDasharray="3 5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeOpacity={0.95}
                  dot={false}
                  activeDot={{ r: 3, fill: preColor, stroke: "hsl(var(--background))", strokeWidth: 1 }}
                />
                <Line
                  type="monotone"
                  dataKey="postPrice"
                  stroke={postColor}
                  strokeWidth={1.8}
                  strokeDasharray="3 5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeOpacity={0.95}
                  dot={false}
                  activeDot={{ r: 3, fill: postColor, stroke: "hsl(var(--background))", strokeWidth: 1 }}
                />
              </>
            ) : (
              <Area
                type="monotone"
                dataKey="price"
                stroke={color}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{ r: 4, fill: color }}
              />
            )}
          </ComposedChart>
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
