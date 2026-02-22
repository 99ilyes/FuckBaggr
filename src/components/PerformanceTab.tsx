import { useMemo, useState } from "react";
import { Transaction, AssetHistory } from "@/hooks/usePortfolios";
import { computeTWR, filterByRange, rebaseTWR, TimeRange } from "@/lib/twr";
import { formatCurrency, formatPercent } from "@/lib/calculations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";

interface Props {
  transactions: Transaction[];
  historicalPrices: Record<string, AssetHistory>;
  portfolioId: string | null;
  portfolioName: string;
  portfolioColor?: string | null;
  loading?: boolean;
}

const RANGES: TimeRange[] = ["6M", "1Y", "2Y", "5Y", "MAX"];

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

export function PerformanceTab({
  transactions,
  historicalPrices,
  portfolioId,
  portfolioName,
  portfolioColor,
  loading = false,
}: Props) {
  const [range, setRange] = useState<TimeRange>("1Y");

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
        color: portfolioColor || "#10B981",
      }),
    [transactions, historicalPrices, assetCurrencies, portfolioId, portfolioName, portfolioColor]
  );

  const visiblePoints = useMemo(() => filterByRange(twr.dataPoints, range), [twr.dataPoints, range]);
  const rebased = useMemo(() => rebaseTWR(visiblePoints), [visiblePoints]);

  const valueData = useMemo(
    () => visiblePoints.map((p) => ({ date: p.date, value: p.valueEUR })),
    [visiblePoints]
  );
  const twrData = useMemo(
    () => rebased.map((p) => ({ date: p.date, twrPct: p.twr * 100 })),
    [rebased]
  );

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
        <CardContent className="text-sm text-muted-foreground">Chargement des historiques Yahoo Finance...</CardContent>
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
          Données historiques insuffisantes pour tracer la performance.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Performance ({portfolioName})</CardTitle>
            <div className="flex flex-wrap gap-2">
              {RANGES.map((r) => (
                <Button key={r} size="sm" variant={range === r ? "default" : "outline"} onClick={() => setRange(r)}>
                  {r}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>TWR total: {formatPercent(twr.totalTWR * 100)}</span>
            <span>TWR annualisé: {formatPercent(twr.annualisedTWR * 100)}</span>
          </div>
        </CardHeader>
      </Card>

      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Évolution de la valeur</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={valueData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis
                  dataKey="date"
                  minTickGap={24}
                  tickFormatter={(v) => new Date(v).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" })}
                />
                <YAxis tickFormatter={(v) => fmtCompactCurrency(v)} />
                <Tooltip
                  formatter={(v: number) => [formatCurrency(v, "EUR"), "Valeur"]}
                  labelFormatter={(v) => fmtDate(v)}
                />
                <Line type="monotone" dataKey="value" stroke="#10B981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Performance TWR</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={twrData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis
                  dataKey="date"
                  minTickGap={24}
                  tickFormatter={(v) => new Date(v).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" })}
                />
                <YAxis tickFormatter={(v) => `${v.toFixed(0)}%`} />
                <Tooltip
                  formatter={(v: number) => [`${v >= 0 ? "+" : ""}${v.toFixed(2)}%`, "TWR"]}
                  labelFormatter={(v) => fmtDate(v)}
                />
                <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="twrPct" stroke="#3B82F6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
