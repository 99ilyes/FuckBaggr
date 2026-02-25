import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { TickerLogo } from "@/components/TickerLogo";
import { formatCurrency, formatPercent } from "@/lib/calculations";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowUp, ArrowDown } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

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

const PERIODS = [
  { label: "1S", range: "5d", interval: "15m" },
  { label: "1M", range: "1mo", interval: "1d" },
  { label: "3M", range: "3mo", interval: "1d" },
  { label: "6M", range: "6mo", interval: "1d" },
  { label: "1A", range: "1y", interval: "1wk" },
  { label: "5A", range: "5y", interval: "1wk" },
] as const;

interface ChartPoint {
  time: number;
  price: number;
  label: string;
}

async function fetchChartData(ticker: string, range: string, interval: string): Promise<ChartPoint[]> {
  const baseUrl = import.meta.env.DEV ? "/api/yf" : "https://query2.finance.yahoo.com";
  const url = `${baseUrl}/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&events=history`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { Accept: "application/json" } });
  if (!resp.ok) return [];
  const data = await resp.json();
  const result = data?.chart?.result?.[0];
  if (!result?.timestamp || !result?.indicators?.quote?.[0]?.close) return [];
  const timestamps: number[] = result.timestamp;
  const closes: (number | null)[] = result.indicators.quote[0].close;
  const points: ChartPoint[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] != null) {
      const d = new Date(timestamps[i] * 1000);
      const label = interval.includes("m")
        ? d.toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
        : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" });
      points.push({ time: timestamps[i], price: closes[i] as number, label });
    }
  }
  return points;
}

function ChartContent({ tickerInfo }: { tickerInfo: TickerInfo }) {
  const [period, setPeriod] = useState<typeof PERIODS[number]>(PERIODS[1]);
  const [data, setData] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const isMobile = useIsMobile();

  const load = useCallback(async () => {
    setLoading(true);
    const pts = await fetchChartData(tickerInfo.ticker, period.range, period.interval);
    setData(pts);
    setLoading(false);
  }, [tickerInfo.ticker, period]);

  useEffect(() => { load(); }, [load]);

  const isUp = data.length >= 2 ? data[data.length - 1].price >= data[0].price : tickerInfo.changePercent >= 0;
  const color = isUp ? "hsl(142, 71%, 45%)" : "hsl(0, 84%, 60%)";
  const gradientId = `chart-grad-${tickerInfo.ticker}`;

  const formatYAxis = (v: number) => {
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return v.toFixed(v < 10 ? 2 : 0);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 px-1">
        <TickerLogo ticker={tickerInfo.ticker} className="w-10 h-10 rounded-full" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{tickerInfo.name}</div>
          <div className="text-xs text-muted-foreground">{tickerInfo.ticker}</div>
        </div>
        <div className="text-right">
          <div className="font-bold text-sm">{formatCurrency(tickerInfo.currentPrice, tickerInfo.currency)}</div>
          <div className={`flex items-center justify-end gap-0.5 text-xs font-semibold ${tickerInfo.changePercent >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
            {tickerInfo.changePercent >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            {formatPercent(tickerInfo.changePercent)}
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

      {/* Chart */}
      {loading ? (
        <Skeleton className="w-full rounded-lg" style={{ height: isMobile ? 220 : 280 }} />
      ) : data.length === 0 ? (
        <div className="flex items-center justify-center text-muted-foreground text-xs" style={{ height: isMobile ? 220 : 280 }}>
          Aucune donnée disponible
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={isMobile ? 220 : 280}>
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
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
                return (
                  <div className="rounded-lg border bg-popover px-3 py-2 shadow-md">
                    <div className="text-[10px] text-muted-foreground">{pt.label}</div>
                    <div className="font-bold text-sm">{formatCurrency(pt.price, tickerInfo.currency)}</div>
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="price"
              stroke={color}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={{ r: 4, fill: color }}
            />
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
