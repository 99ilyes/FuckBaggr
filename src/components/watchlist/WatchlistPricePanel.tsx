import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { ChartPreset } from "@/lib/watchlistTypes";
import { TickerOperationMarker, filterMarkersByRange } from "@/lib/watchlistViewModel";

interface Props {
  ticker: string;
  currency: string;
  pru: number | null;
  fairPrice: number | null;
  operations: TickerOperationMarker[];
}

interface ChartPoint {
  time: number;
  price: number;
}

interface MarkerShapeProps {
  cx?: number;
  cy?: number;
}

const PRESETS: ChartPreset[] = ["1M", "3M", "YTD", "1A", "2Y", "5A", "MAX", "CUSTOM"];

function toMs(value: number): number {
  return value * 1000;
}

function formatCurrency(value: number | null, currency = "EUR"): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function parseDateInput(value: string): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) return null;
  return Math.floor(parsed / 1000);
}

function formatDateTick(ms: number): string {
  const date = new Date(ms);
  return date.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
}

function formatDateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatYAxisTick(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Math.abs(value) >= 100) return value.toFixed(1);
  return value.toFixed(2);
}

function getYtdStartTimestamp(): number {
  const now = new Date();
  return Math.floor(new Date(now.getFullYear(), 0, 1).getTime() / 1000);
}

function getPresetRequest(preset: ChartPreset): { range: string; interval: string } {
  if (preset === "1M") return { range: "1mo", interval: "1d" };
  if (preset === "3M") return { range: "3mo", interval: "1d" };
  if (preset === "YTD") return { range: "1y", interval: "1d" };
  if (preset === "1A") return { range: "1y", interval: "1d" };
  if (preset === "2Y") return { range: "2y", interval: "1d" };
  if (preset === "5A") return { range: "5y", interval: "1wk" };
  if (preset === "MAX") return { range: "max", interval: "1wk" };
  return { range: "max", interval: "1d" };
}

function nearestPrice(points: ChartPoint[], timestampSec: number): number | null {
  if (points.length === 0) return null;

  const targetMs = toMs(timestampSec);
  let closest = points[0];
  let minDistance = Math.abs(points[0].time - targetMs);

  for (let i = 1; i < points.length; i++) {
    const distance = Math.abs(points[i].time - targetMs);
    if (distance < minDistance) {
      minDistance = distance;
      closest = points[i];
    }
  }

  return closest.price;
}

function BuyMarker({ cx, cy }: MarkerShapeProps) {
  if (cx == null || cy == null) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4.8}
      fill="hsl(var(--gain))"
      stroke="hsl(var(--background))"
      strokeWidth={1.5}
    />
  );
}

function SellMarker({ cx, cy }: MarkerShapeProps) {
  if (cx == null || cy == null) return null;
  return (
    <rect
      x={cx - 4.4}
      y={cy - 4.4}
      width={8.8}
      height={8.8}
      rx={1}
      ry={1}
      transform={`rotate(45 ${cx} ${cy})`}
      fill="hsl(var(--loss))"
      stroke="hsl(var(--background))"
      strokeWidth={1.5}
    />
  );
}

async function fetchTickerHistory(ticker: string, range: string, interval: string): Promise<ChartPoint[]> {
  const { data, error } = await supabase.functions.invoke("fetch-history", {
    body: { tickers: [ticker], range, interval },
  });

  if (error) throw error;

  const history = data?.results?.[ticker]?.history as Array<{ time: number; price: number }> | undefined;
  if (!Array.isArray(history)) return [];

  return history
    .filter((point) => typeof point?.time === "number" && typeof point?.price === "number")
    .map((point) => ({
      time: toMs(point.time),
      price: point.price,
    }));
}

export function WatchlistPricePanel({ ticker, currency, pru, fairPrice, operations }: Props) {
  const [preset, setPreset] = useState<ChartPreset>("1A");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const { range, interval } = getPresetRequest(preset);

  const { data: history = [], isLoading } = useQuery({
    queryKey: ["watchlist-chart", ticker, range, interval],
    queryFn: () => fetchTickerHistory(ticker, range, interval),
    enabled: Boolean(ticker),
    staleTime: 1000 * 60 * 15,
    retry: 1,
  });

  const filteredHistory = useMemo(() => {
    if (preset === "YTD") {
      const fromTs = getYtdStartTimestamp();
      return history.filter((point) => Math.floor(point.time / 1000) >= fromTs);
    }

    if (preset !== "CUSTOM") return history;

    const fromTs = parseDateInput(fromDate);
    const toTs = parseDateInput(toDate);

    return history.filter((point) => {
      const sec = Math.floor(point.time / 1000);
      if (fromTs != null && sec < fromTs) return false;
      if (toTs != null && sec > toTs) return false;
      return true;
    });
  }, [history, preset, fromDate, toDate]);

  const chartStart = filteredHistory.length > 0 ? Math.floor(filteredHistory[0].time / 1000) : undefined;
  const chartEnd =
    filteredHistory.length > 0
      ? Math.floor(filteredHistory[filteredHistory.length - 1].time / 1000)
      : undefined;

  const visibleOperations = useMemo(
    () => filterMarkersByRange(operations, chartStart, chartEnd),
    [operations, chartStart, chartEnd]
  );

  const markerData = useMemo(() => {
    return visibleOperations
      .map((operation) => ({
        id: operation.id,
        time: toMs(operation.timestamp),
        price: operation.price ?? nearestPrice(filteredHistory, operation.timestamp),
        opType: operation.type,
      }))
      .filter((marker) => typeof marker.price === "number" && Number.isFinite(marker.price));
  }, [visibleOperations, filteredHistory]);

  const buyMarkers = markerData.filter((marker) => marker.opType === "buy" || marker.opType === "transfer_in");
  const sellMarkers = markerData.filter((marker) => marker.opType === "sell" || marker.opType === "transfer_out");

  const lastPrice = filteredHistory.length > 0 ? filteredHistory[filteredHistory.length - 1].price : null;

  const yDomain = useMemo<[number, number] | ["auto", "auto"]>(() => {
    if (filteredHistory.length === 0) return ["auto", "auto"];

    const values: number[] = filteredHistory.map((point) => point.price);
    for (const marker of markerData) {
      values.push(marker.price);
    }
    if (pru != null && Number.isFinite(pru)) values.push(pru);
    if (fairPrice != null && Number.isFinite(fairPrice)) values.push(fairPrice);

    const min = Math.min(...values);
    const max = Math.max(...values);

    if (!Number.isFinite(min) || !Number.isFinite(max)) return ["auto", "auto"];

    if (max === min) {
      const pad = Math.max(Math.abs(max) * 0.03, 1);
      return [min - pad, max + pad];
    }

    const pad = (max - min) * 0.15;
    return [min - pad, max + pad];
  }, [filteredHistory, markerData, pru, fairPrice]);

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Cours</h3>
          <p className="text-xs text-muted-foreground">{formatCurrency(lastPrice, currency)}</p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {PRESETS.map((entry) => (
            <Button
              key={entry}
              type="button"
              size="sm"
              variant={preset === entry ? "default" : "ghost"}
              className="h-8 px-2.5 text-xs"
              onClick={() => setPreset(entry)}
            >
              {entry}
            </Button>
          ))}
        </div>
      </div>

      {preset === "CUSTOM" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Du</span>
            <Input type="date" className="h-9" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Au</span>
            <Input type="date" className="h-9" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </label>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs">
        <span className="text-muted-foreground">Repères:</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[hsl(var(--gain))]" />
          Achat
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rotate-45 rounded-[2px] bg-[hsl(var(--loss))]" />
          Vente
        </span>
        {pru != null && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-px w-4 border-t border-dashed border-[hsl(var(--chart-3))]" />
            PRU
          </span>
        )}
        {fairPrice != null && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-px w-4 border-t border-dashed border-[hsl(var(--chart-1))]" />
            Prix juste
          </span>
        )}
      </div>

      <div className="relative rounded-lg border border-border/60 bg-muted/20 p-2">
        {isLoading ? (
          <Skeleton className="h-[340px] w-full" />
        ) : filteredHistory.length === 0 ? (
          <div className="flex h-[340px] items-center justify-center text-sm text-muted-foreground">
            Aucune donnée disponible pour la période.
          </div>
        ) : (
          <>
            <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col gap-1">
              {pru != null && (
                <div className="rounded-md border border-[hsl(var(--chart-3))] bg-background/90 px-2 py-1 text-[11px] font-semibold text-[hsl(var(--chart-3))]">
                  PRU {formatCurrency(pru, currency)}
                </div>
              )}
              {fairPrice != null && (
                <div className="rounded-md border border-[hsl(var(--chart-1))] bg-background/90 px-2 py-1 text-[11px] font-semibold text-[hsl(var(--chart-1))]">
                  Prix juste {formatCurrency(fairPrice, currency)}
                </div>
              )}
            </div>

            <ResponsiveContainer width="100%" height={340}>
              <AreaChart data={filteredHistory} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <defs>
                  <linearGradient id="watchlist-area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--chart-2))" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="hsl(var(--chart-2))" stopOpacity={0.02} />
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
                  domain={yDomain}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  width={58}
                  tickFormatter={(value) => formatYAxisTick(Number(value))}
                />

                {pru != null && (
                  <ReferenceLine
                    y={pru}
                    stroke="hsl(var(--chart-3))"
                    strokeDasharray="5 4"
                    strokeWidth={1.4}
                  />
                )}
                {fairPrice != null && (
                  <ReferenceLine
                    y={fairPrice}
                    stroke="hsl(var(--chart-1))"
                    strokeDasharray="4 3"
                    strokeWidth={1.2}
                  />
                )}

                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload || payload.length === 0) return null;

                    const lineEntry = payload[0];
                    const price = typeof lineEntry.value === "number" ? lineEntry.value : null;

                    return (
                      <div className="rounded-lg border border-border/60 bg-card px-3 py-2 shadow-lg">
                        <p className="text-xs text-muted-foreground">{formatDateLabel(Number(label))}</p>
                        <p className="text-sm font-semibold text-foreground">{formatCurrency(price, currency)}</p>
                      </div>
                    );
                  }}
                />

                <Area
                  type="monotone"
                  dataKey="price"
                  stroke="hsl(var(--chart-2))"
                  strokeWidth={2}
                  fill="url(#watchlist-area)"
                  dot={false}
                  activeDot={{ r: 4 }}
                />

                {buyMarkers.map((marker) => (
                  <ReferenceDot
                    key={`buy-${marker.id}`}
                    x={marker.time}
                    y={marker.price}
                    isFront
                    ifOverflow="extendDomain"
                    shape={<BuyMarker />}
                  />
                ))}
                {sellMarkers.map((marker) => (
                  <ReferenceDot
                    key={`sell-${marker.id}`}
                    x={marker.time}
                    y={marker.price}
                    isFront
                    ifOverflow="extendDomain"
                    shape={<SellMarker />}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </>
        )}
      </div>
    </div>
  );
}
