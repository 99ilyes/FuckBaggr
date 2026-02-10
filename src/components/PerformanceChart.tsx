import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Transaction, AssetCache } from "@/hooks/usePortfolios";
import { formatCurrency } from "@/lib/calculations";
import { format } from "date-fns";
import { useMemo } from "react";

interface Props {
  transactions: Transaction[];
  assetsCache: AssetCache[];
}

export function PerformanceChart({ transactions, assetsCache }: Props) {
  const data = useMemo(() => {
    if (transactions.length === 0) return [];

    const cacheMap = new Map(assetsCache.map((a) => [a.ticker, a.last_price || 0]));
    const sorted = [...transactions]
      .filter((t) => t.type === "buy" || t.type === "sell")
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    if (sorted.length === 0) return [];

    const points: { date: string; value: number; invested: number }[] = [];
    const positions = new Map<string, { quantity: number; totalCost: number }>();
    let totalInvested = 0;

    for (const tx of sorted) {
      if (!tx.ticker || !tx.quantity || !tx.unit_price) continue;
      const pos = positions.get(tx.ticker) || { quantity: 0, totalCost: 0 };

      if (tx.type === "buy") {
        pos.totalCost += tx.quantity * tx.unit_price + tx.fees;
        pos.quantity += tx.quantity;
        totalInvested += tx.quantity * tx.unit_price + tx.fees;
      } else {
        const pru = pos.quantity > 0 ? pos.totalCost / pos.quantity : 0;
        pos.totalCost -= tx.quantity * pru;
        pos.quantity -= tx.quantity;
        totalInvested -= tx.quantity * tx.unit_price - tx.fees;
      }

      positions.set(tx.ticker, pos);

      // Calculate current value at this point using latest prices (simplified)
      let currentValue = 0;
      for (const [ticker, p] of positions) {
        if (p.quantity > 0) {
          currentValue += p.quantity * (cacheMap.get(ticker) || 0);
        }
      }

      points.push({
        date: format(new Date(tx.date), "dd/MM/yy"),
        value: currentValue,
        invested: totalInvested,
      });
    }

    return points;
  }, [transactions, assetsCache]);

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Évolution du portefeuille</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
            Ajoutez des transactions pour voir l'évolution
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data}>
              <defs>
                <linearGradient id="valueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(215, 15%, 55%)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(215, 15%, 55%)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(value: number, name: string) => [formatCurrency(value), name === "value" ? "Valeur" : "Investi"]}
                contentStyle={{
                  backgroundColor: "hsl(228, 12%, 11%)",
                  border: "1px solid hsl(228, 10%, 18%)",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
              />
              <Area type="monotone" dataKey="invested" stroke="hsl(215, 15%, 45%)" strokeWidth={1} strokeDasharray="4 4" fill="none" />
              <Area type="monotone" dataKey="value" stroke="hsl(217, 91%, 60%)" strokeWidth={2} fill="url(#valueGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
