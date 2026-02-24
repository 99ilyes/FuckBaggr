import { useState, useEffect, useCallback, useMemo } from "react";
import {
    Area,
    AreaChart,
    ResponsiveContainer,
    Tooltip as RechartsTooltip,
    XAxis,
    YAxis,
} from "recharts";

// ─── Types ───────────────────────────────────────────────────────────

interface ChartPoint {
    time: number; // epoch seconds
    price: number;
}

type RangeKey = "1j" | "1w" | "1m" | "3m" | "6m" | "1a";

interface RangeConfig {
    label: string;
    range: string;   // Yahoo v8 range param
    interval: string; // Yahoo v8 interval param
}

const RANGES: Record<RangeKey, RangeConfig> = {
    "1j": { label: "1J", range: "1d", interval: "5m" },
    "1w": { label: "1W", range: "5d", interval: "15m" },
    "1m": { label: "1M", range: "1mo", interval: "1h" },
    "3m": { label: "3M", range: "3mo", interval: "1d" },
    "6m": { label: "6M", range: "6mo", interval: "1d" },
    "1a": { label: "1A", range: "1y", interval: "1d" },
};

const RANGE_KEYS: RangeKey[] = ["1j", "1w", "1m", "3m", "6m", "1a"];

// ─── Data fetching ───────────────────────────────────────────────────

async function fetchChartData(
    ticker: string,
    rangeKey: RangeKey
): Promise<{ points: ChartPoint[]; previousClose: number | null }> {
    const cfg = RANGES[rangeKey];
    const baseUrl = import.meta.env.DEV
        ? "/api/yf"
        : "https://query2.finance.yahoo.com";
    const url = `${baseUrl}/v8/finance/chart/${encodeURIComponent(
        ticker
    )}?interval=${cfg.interval}&range=${cfg.range}&includePrePost=false`;

    const resp = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { Accept: "application/json" },
    });
    if (!resp.ok) return { points: [], previousClose: null };

    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    if (!result) return { points: [], previousClose: null };

    const timestamps: number[] = result.timestamp ?? [];
    const closes: (number | null)[] =
        result.indicators?.quote?.[0]?.close ?? [];
    const previousClose =
        result.meta?.chartPreviousClose ?? result.meta?.previousClose ?? null;

    const points: ChartPoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
        const p = closes[i];
        if (p != null && isFinite(p)) {
            points.push({ time: timestamps[i], price: p });
        }
    }
    return { points, previousClose };
}

// ─── Date formatting ─────────────────────────────────────────────────

function formatXLabel(epoch: number, rangeKey: RangeKey): string {
    const d = new Date(epoch * 1000);
    if (rangeKey === "1j") {
        return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    }
    if (rangeKey === "1w") {
        return d.toLocaleDateString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" });
    }
    if (rangeKey === "1m" || rangeKey === "3m") {
        return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    }
    return d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
}

function formatTooltipDate(epoch: number, rangeKey: RangeKey): string {
    const d = new Date(epoch * 1000);
    if (rangeKey === "1j" || rangeKey === "1w") {
        return d.toLocaleDateString("fr-FR", {
            weekday: "short",
            day: "numeric",
            month: "short",
        }) + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString("fr-FR", {
        weekday: "short",
        day: "numeric",
        month: "long",
        year: "numeric",
    });
}

// ─── Component ───────────────────────────────────────────────────────

interface StockMiniChartProps {
    ticker: string;
    name?: string;
    currency?: string;
    currentPrice?: number | null;
}

export function StockMiniChart({
    ticker,
    name,
    currency = "USD",
    currentPrice,
}: StockMiniChartProps) {
    const [rangeKey, setRangeKey] = useState<RangeKey>("1j");
    const [points, setPoints] = useState<ChartPoint[]>([]);
    const [previousClose, setPreviousClose] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);

    const loadData = useCallback(
        async (range: RangeKey) => {
            setLoading(true);
            try {
                const { points: pts, previousClose: pc } = await fetchChartData(ticker, range);
                setPoints(pts);
                setPreviousClose(pc);
            } catch {
                setPoints([]);
                setPreviousClose(null);
            }
            setLoading(false);
        },
        [ticker]
    );

    useEffect(() => {
        loadData(rangeKey);
    }, [rangeKey, loadData]);

    // Compute performance
    const perf = useMemo(() => {
        if (points.length < 2) return null;
        const first = previousClose ?? points[0].price;
        const last = points[points.length - 1].price;
        if (first === 0) return null;
        return ((last - first) / first) * 100;
    }, [points, previousClose]);

    const isPositive = perf != null && perf >= 0;
    const chartColor = isPositive ? "#10b981" : "#ef4444";

    // Y domain with padding
    const [yMin, yMax] = useMemo(() => {
        if (points.length === 0) return [0, 100];
        let lo = Infinity, hi = -Infinity;
        for (const p of points) {
            if (p.price < lo) lo = p.price;
            if (p.price > hi) hi = p.price;
        }
        const pad = (hi - lo) * 0.08 || hi * 0.01;
        return [lo - pad, hi + pad];
    }, [points]);

    const formatPrice = (v: number) =>
        new Intl.NumberFormat("fr-FR", {
            style: "currency",
            currency,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(v);

    return (
        <div className="w-[280px] sm:w-[380px]">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex flex-col">
                    <span className="font-semibold text-sm">{ticker}</span>
                    {name && (
                        <span className="text-xs text-muted-foreground truncate max-w-[120px] sm:max-w-[200px]">
                            {name}
                        </span>
                    )}
                </div>
                <div className="flex flex-col items-end">
                    <span className="font-semibold text-sm tabular-nums">
                        {currentPrice != null ? formatPrice(currentPrice) : "—"}
                    </span>
                    {perf != null && (
                        <span
                            className={`text-xs font-medium tabular-nums ${isPositive ? "text-emerald-500" : "text-red-500"
                                }`}
                        >
                            {isPositive ? "+" : ""}
                            {perf.toFixed(2)}%
                        </span>
                    )}
                </div>
            </div>

            {/* Chart area */}
            <div className="h-[150px] sm:h-[180px] w-full relative">
                {loading ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : points.length === 0 ? (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                        Données indisponibles
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                            data={points}
                            margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
                        >
                            <defs>
                                <linearGradient id={`gradient-${ticker}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={chartColor} stopOpacity={0.25} />
                                    <stop offset="100%" stopColor={chartColor} stopOpacity={0.02} />
                                </linearGradient>
                            </defs>
                            <XAxis
                                dataKey="time"
                                tickFormatter={(v) => formatXLabel(v, rangeKey)}
                                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                tickLine={false}
                                axisLine={false}
                                minTickGap={40}
                            />
                            <YAxis
                                domain={[yMin, yMax]}
                                tickFormatter={(v) => v.toFixed(0)}
                                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                tickLine={false}
                                axisLine={false}
                                width={45}
                            />
                            <RechartsTooltip
                                content={({ active, payload }) => {
                                    if (!active || !payload?.length) return null;
                                    const pt = payload[0].payload as ChartPoint;
                                    return (
                                        <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-lg">
                                            <div className="font-medium tabular-nums">
                                                {formatPrice(pt.price)}
                                            </div>
                                            <div className="text-muted-foreground">
                                                {formatTooltipDate(pt.time, rangeKey)}
                                            </div>
                                        </div>
                                    );
                                }}
                            />
                            <Area
                                type="monotone"
                                dataKey="price"
                                stroke={chartColor}
                                strokeWidth={1.5}
                                fill={`url(#gradient-${ticker})`}
                                dot={false}
                                activeDot={{
                                    r: 3,
                                    fill: chartColor,
                                    stroke: "hsl(var(--background))",
                                    strokeWidth: 2,
                                }}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                )}
            </div>

            {/* Range selector */}
            <div className="flex items-center gap-0.5 mt-2 p-0.5 rounded-md bg-muted/50">
                {RANGE_KEYS.map((key) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => setRangeKey(key)}
                        className={`flex-1 text-xs font-medium py-1 rounded transition-colors cursor-pointer ${rangeKey === key
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                            }`}
                    >
                        {RANGES[key].label}
                    </button>
                ))}
            </div>
        </div>
    );
}
