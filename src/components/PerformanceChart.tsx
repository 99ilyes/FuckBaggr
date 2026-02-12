import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Transaction, AssetCache, useHistoricalPrices } from "@/hooks/usePortfolios";
import { formatCurrency } from "@/lib/calculations";
import { format, startOfDay, subMonths } from "date-fns";
import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

const DURATION_OPTIONS = [
  { label: "1M", months: 1 },
  { label: "3M", months: 3 },
  { label: "6M", months: 6 },
  { label: "1A", months: 12 },
  { label: "3A", months: 36 },
  { label: "5A", months: 60 },
  { label: "MAX", months: 0 },
] as const;

const BENCHMARK_TICKER = "ESE.PA";

interface Props {
  transactions: Transaction[];
  assetsCache: AssetCache[];
}

interface FullPoint {
  dateMs: number;
  date: string;
  value: number;
  invested: number;
  twrPct: number;
  benchmarkPct: number | null;
}

export function PerformanceChart({ transactions, assetsCache }: Props) {
  const [selectedDuration, setSelectedDuration] = useState("MAX");

  const tickers = useMemo(() => {
    const s = new Set<string>();
    const fxCurrencies = new Set<string>();

    transactions.forEach((t) => {
      if ((t.type === "buy" || t.type === "sell") && t.ticker) {
        s.add(t.ticker);
        const cached = assetsCache.find((a) => a.ticker === t.ticker);
        if (cached?.currency && cached.currency !== "EUR") fxCurrencies.add(cached.currency);
      }
      const c = (t as any).currency || "EUR";
      if (c !== "EUR") fxCurrencies.add(c);
    });

    fxCurrencies.forEach((c) => s.add(`${c}EUR=X`));
    s.add(BENCHMARK_TICKER);
    return Array.from(s);
  }, [transactions, assetsCache]);

  const { data: historicalData, error, isLoading } = useHistoricalPrices(tickers);

  // Build full data series
  const fullData = useMemo((): FullPoint[] => {
    if (transactions.length === 0 || !historicalData) return [];

    const sorted = [...transactions]
      .filter((t) => ["buy", "sell", "deposit", "withdrawal", "conversion"].includes(t.type))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (sorted.length === 0) return [];

    const getPriceAtDate = (ticker: string, ms: number): number => {
      const hist = historicalData[ticker]?.history;
      if (!hist || hist.length === 0) return 0;
      const ts = ms / 1000;
      let p = hist[0].price;
      for (const h of hist) { if (h.time > ts) break; p = h.price; }
      return p;
    };

    const getFx = (cur: string, ms: number) => {
      if (cur === "EUR") return 1;
      const r = getPriceAtDate(`${cur}EUR=X`, ms);
      return r > 0 ? r : 1;
    };

    const positions = new Map<string, number>();
    const cash = new Map<string, number>();
    let totalInvested = 0;

    // Track last known transaction price per ticker to detect Yahoo/ticker mismatches
    const lastTxPrice = new Map<string, number>();

    const startMs = startOfDay(new Date(sorted[0].date)).getTime();
    const endMs = startOfDay(new Date()).getTime();
    const DAY = 86_400_000;
    const totalDays = (endMs - startMs) / DAY;
    const step = totalDays > 730 ? 7 * DAY : DAY;

    // Safe price getter: uses Yahoo data but falls back to transaction price if mismatch > 10x
    const getSafePrice = (ticker: string, dateMs: number): number => {
      const yahooPrice = getPriceAtDate(ticker, dateMs);
      const txPrice = lastTxPrice.get(ticker);
      if (yahooPrice > 0 && txPrice && txPrice > 0) {
        const ratio = yahooPrice / txPrice;
        // If Yahoo price is >10x or <0.1x the last transaction price, likely a ticker mismatch
        if (ratio > 10 || ratio < 0.1) {
          return txPrice; // Use transaction price as fallback
        }
      }
      return yahooPrice > 0 ? yahooPrice : (txPrice || 0);
    };

    const points: FullPoint[] = [];
    let txIdx = 0;
    const benchBase = getPriceAtDate(BENCHMARK_TICKER, startMs);

    for (let day = startMs; day <= endMs; day += step) {
      while (txIdx < sorted.length) {
        const tx = sorted[txIdx];
        const txDay = startOfDay(new Date(tx.date)).getTime();
        if (txDay > day) break;
        const cur = (tx as any).currency || "EUR";

        if (tx.type === "deposit") {
          const a = (tx.quantity || 0) * (tx.unit_price || 1);
          totalInvested += a * getFx(cur, txDay);
          cash.set(cur, (cash.get(cur) || 0) + a);
        } else if (tx.type === "withdrawal") {
          const a = (tx.quantity || 0) * (tx.unit_price || 1);
          totalInvested -= a * getFx(cur, txDay);
          cash.set(cur, (cash.get(cur) || 0) - a);
        } else if (tx.type === "buy" && tx.ticker && tx.quantity && tx.unit_price) {
          cash.set(cur, (cash.get(cur) || 0) - (tx.quantity * tx.unit_price + (tx.fees || 0)));
          positions.set(tx.ticker, (positions.get(tx.ticker) || 0) + tx.quantity);
          lastTxPrice.set(tx.ticker, tx.unit_price);
        } else if (tx.type === "sell" && tx.ticker && tx.quantity && tx.unit_price) {
          cash.set(cur, (cash.get(cur) || 0) + (tx.quantity * tx.unit_price - (tx.fees || 0)));
          positions.set(tx.ticker, (positions.get(tx.ticker) || 0) - tx.quantity);
          lastTxPrice.set(tx.ticker, tx.unit_price);
        } else if (tx.type === "conversion" && tx.quantity && tx.unit_price) {
          const src = tx.ticker || "EUR";
          cash.set(src, (cash.get(src) || 0) - (tx.quantity * tx.unit_price + (tx.fees || 0)));
          cash.set(cur, (cash.get(cur) || 0) + tx.quantity);
        }
        txIdx++;
      }

      let val = 0;
      for (const [tk, qty] of positions) {
        if (qty <= 0) continue;
        const cached = assetsCache.find((a) => a.ticker === tk);
        val += qty * getSafePrice(tk, day) * getFx(cached?.currency || "USD", day);
      }
      for (const [c, a] of cash) val += a * getFx(c, day);

      const twrPct = totalInvested > 0 ? ((val - totalInvested) / totalInvested) * 100 : 0;
      let benchmarkPct: number | null = null;
      if (benchBase > 0) {
        const bp = getPriceAtDate(BENCHMARK_TICKER, day);
        if (bp > 0) benchmarkPct = ((bp - benchBase) / benchBase) * 100;
      }

      points.push({
        dateMs: day,
        date: format(day, "dd/MM/yy"),
        value: Math.round(val * 100) / 100,
        invested: Math.round(totalInvested * 100) / 100,
        twrPct: Math.round(twrPct * 100) / 100,
        benchmarkPct: benchmarkPct !== null ? Math.round(benchmarkPct * 100) / 100 : null,
      });
    }
    return points;
  }, [transactions, historicalData, assetsCache]);

  // Filter + rebase for selected duration
  const chartData = useMemo(() => {
    if (fullData.length === 0 || selectedDuration === "MAX") {
      return fullData.map((p) => ({
        ...p,
        portfolioPct: p.twrPct,
        benchPct: p.benchmarkPct,
      }));
    }

    const opt = DURATION_OPTIONS.find((d) => d.label === selectedDuration);
    if (!opt || opt.months === 0) return fullData.map((p) => ({ ...p, portfolioPct: p.twrPct, benchPct: p.benchmarkPct }));

    const cutoff = subMonths(new Date(), opt.months).getTime();
    const filtered = fullData.filter((p) => p.dateMs >= cutoff);
    if (filtered.length === 0) return fullData.map((p) => ({ ...p, portfolioPct: p.twrPct, benchPct: p.benchmarkPct }));

    // Rebase both to 0% at start of visible window
    const baseVal = filtered[0].value;
    const baseInvested = filtered[0].invested;
    const baseBench = filtered[0].benchmarkPct;

    return filtered.map((p) => ({
      ...p,
      // For rebased view: show gain relative to start of period
      portfolioPct: baseVal > 0 ? Math.round(((p.value - baseVal) / baseVal) * 100 * 100) / 100 : 0,
      benchPct: p.benchmarkPct !== null && baseBench !== null
        ? Math.round((p.benchmarkPct - baseBench) * 100) / 100
        : null,
    }));
  }, [fullData, selectedDuration]);

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.[0]) return null;
    const p = payload[0].payload;

    return (
      <div style={{
        backgroundColor: "hsl(228, 12%, 11%)",
        border: "1px solid hsl(228, 10%, 18%)",
        borderRadius: 8, padding: "10px 14px", fontSize: 12, lineHeight: 1.7,
      }}>
        <p style={{ color: "hsl(215, 15%, 55%)", marginBottom: 2 }}>{p.date}</p>
        <p style={{ color: "hsl(217, 91%, 60%)", fontWeight: 600 }}>
          Valeur: {formatCurrency(p.value)}
        </p>
        <p style={{ color: "hsl(215, 15%, 65%)" }}>
          Investi: {formatCurrency(p.invested)}
        </p>
        <p style={{
          color: p.portfolioPct >= 0 ? "hsl(142, 71%, 45%)" : "hsl(0, 84%, 60%)",
          fontWeight: 600, marginTop: 4,
        }}>
          TWR: {p.portfolioPct >= 0 ? "+" : ""}{p.portfolioPct?.toFixed(2)}%
        </p>
        {p.benchPct !== null && p.benchPct !== undefined && (
          <p style={{ color: "hsl(25, 95%, 53%)" }}>
            ESE.PA: {p.benchPct >= 0 ? "+" : ""}{p.benchPct?.toFixed(2)}%
          </p>
        )}
      </div>
    );
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Performance du portefeuille
        </CardTitle>
        <div className="flex gap-1">
          {DURATION_OPTIONS.map((d) => (
            <Button
              key={d.label}
              variant={selectedDuration === d.label ? "default" : "ghost"}
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setSelectedDuration(d.label)}
            >
              {d.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-sm gap-2">
            <p className="text-destructive font-medium">Erreur de chargement</p>
            <p className="text-xs text-center px-4">{(error as Error).message}</p>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement de l'historique…
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
            Ajoutez des transactions pour voir l'évolution
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData}>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "hsl(215, 15%, 55%)" }}
                axisLine={false}
                tickLine={false}
                minTickGap={40}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "hsl(215, 15%, 55%)" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}%`}
                domain={["auto", "auto"]}
              />
              <ReferenceLine y={0} stroke="hsl(215, 15%, 30%)" strokeDasharray="3 3" />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="portfolioPct"
                stroke="hsl(217, 91%, 60%)"
                strokeWidth={2}
                dot={false}
                name="Portfolio"
              />
              <Line
                type="monotone"
                dataKey="benchPct"
                stroke="hsl(25, 95%, 53%)"
                strokeWidth={1.5}
                dot={false}
                name="ESE.PA"
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        )}
        {chartData.length > 0 && (
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-0.5 rounded" style={{ backgroundColor: "hsl(217, 91%, 60%)" }} />
              <span>Portfolio TWR</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-0.5 rounded" style={{ backgroundColor: "hsl(25, 95%, 53%)" }} />
              <span>ESE.PA (S&P 500)</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
