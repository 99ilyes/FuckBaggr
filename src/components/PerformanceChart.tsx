import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Transaction, AssetCache, useHistoricalPrices } from "@/hooks/usePortfolios";
import { formatCurrency } from "@/lib/calculations";
import { format, isSameDay, startOfDay } from "date-fns";
import { useMemo } from "react";

interface Props {
  transactions: Transaction[];
  assetsCache: AssetCache[];
}

export function PerformanceChart({ transactions, assetsCache }: Props) {
  // Extract unique tickers (assets + currencies)
  const tickers = useMemo(() => {
    const s = new Set<string>();
    transactions.forEach(t => {
      if (t.ticker) s.add(t.ticker);
      if (t.currency && t.currency !== "EUR") {
        s.add(`${t.currency}EUR=X`);
      }
    });
    // Also add FX for assets currencies if different from EUR (assuming assetsCache has currency info, but we might miss it if not loaded)
    // For now, let's rely on transactions currencies.
    return Array.from(s);
  }, [transactions]);

  const { data: historicalData } = useHistoricalPrices(tickers);

  const data = useMemo(() => {
    if (transactions.length === 0 || !historicalData) return [];

    const sorted = [...transactions]
      .filter((t) => t.type === "buy" || t.type === "sell" || t.type === "deposit" || t.type === "withdrawal")
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    if (sorted.length === 0) return [];

    // Helper to get price at specific date
    const getPriceAtDate = (ticker: string, date: number) => {
      const history = historicalData[ticker]?.history;
      if (!history || history.length === 0) return 0;
      // Find closest price before or at date
      // Since history is likely sorted, we can binary search or findLast
      // For simplicity, find last item where time <= date
      // Note: Yahoo timestamps are seconds, date is ms
      const ts = date / 1000;
      let price = history[0].price; // Default to first available if date is before history
      for (const h of history) {
        if (h.time > ts) break;
        price = h.price;
      }
      return price;
    };

    const getFxRateAtDate = (currency: string, date: number) => {
      if (currency === "EUR") return 1;
      const pair = `${currency}EUR=X`;
      const rate = getPriceAtDate(pair, date);
      return rate > 0 ? rate : 1;
    };

    // We need daily points from first transaction to today
    const startDate = startOfDay(new Date(sorted[0].date)).getTime();
    const endDate = startOfDay(new Date()).getTime();
    const points: { date: string; value: number; invested: number }[] = [];

    // Iterate day by day
    const positions = new Map<string, { quantity: number }>();
    const cash = new Map<string, number>();
    let totalInvested = 0; // Net cash flow
    let txIndex = 0;

    for (let current = startDate; current <= endDate; current += 86400000) {
      // Process transactions for this day
      // Note: sorting is crucial
      while (txIndex < sorted.length) {
        const tx = sorted[txIndex];
        const txDate = startOfDay(new Date(tx.date)).getTime();
        if (txDate > current) break;

        const currency = tx.currency || "EUR";

        if (tx.type === "deposit") {
          const amount = (tx.quantity || 0) * (tx.unit_price || 1);
          // Cash flow impacts invested capital immediately
          const rate = getFxRateAtDate(currency, current);
          totalInvested += amount * rate;
          // Add to cash balance
          cash.set(currency, (cash.get(currency) || 0) + amount);
        } else if (tx.type === "withdrawal") {
          const amount = (tx.quantity || 0) * (tx.unit_price || 1);
          const rate = getFxRateAtDate(currency, current);
          totalInvested -= amount * rate;
          cash.set(currency, (cash.get(currency) || 0) - amount);
        } else if (tx.type === "buy" && tx.ticker) {
          // Cash decreases, asset increases. No change in invested capital (transfer)
          const cost = (tx.quantity || 0) * (tx.unit_price || 0) + (tx.fees || 0);
          cash.set(currency, (cash.get(currency) || 0) - cost);

          const pos = positions.get(tx.ticker) || { quantity: 0 };
          pos.quantity += (tx.quantity || 0);
          positions.set(tx.ticker, pos);
        } else if (tx.type === "sell" && tx.ticker) {
          const proceeds = (tx.quantity || 0) * (tx.unit_price || 0) - (tx.fees || 0);
          cash.set(currency, (cash.get(currency) || 0) + proceeds);

          const pos = positions.get(tx.ticker) || { quantity: 0 };
          pos.quantity -= (tx.quantity || 0);
          positions.set(tx.ticker, pos);
        }

        txIndex++;
      }

      // Calculate Portfolio Value at end of day
      let dailyValue = 0;

      // Assets
      for (const [ticker, pos] of positions) {
        if (pos.quantity > 0) {
          const price = getPriceAtDate(ticker, current);
          // We need to know asset currency. Assuming assetsCache has it or we infer?
          // For simplified logic: try to find asset in cache to get currency
          const cachedAsset = assetsCache.find(a => a.ticker === ticker);
          const assetCurrency = cachedAsset?.currency || "USD"; // Default to USD is risky but standard
          const fx = getFxRateAtDate(assetCurrency, current);
          dailyValue += pos.quantity * price * fx;
        }
      }

      // Cash
      for (const [curr, amount] of cash) {
        const fx = getFxRateAtDate(curr, current);
        dailyValue += amount * fx;
      }

      points.push({
        date: format(current, "dd/MM/yy"),
        value: dailyValue,
        invested: totalInvested
      });
    }

    return points;
  }, [transactions, historicalData, assetsCache]);

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Évolution du portefeuille (TWR Estimé)</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
            {historicalData ? "Ajoutez des transactions pour voir l'évolution" : "Chargement de l'historique..."}
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
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(215, 15%, 55%)" }} axisLine={false} tickLine={false} minTickGap={30} />
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
