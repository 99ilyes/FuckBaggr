import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { usePortfolios, useTransactions, useAssetsCache, useHistoricalPrices } from "@/hooks/usePortfolios";
import { calculatePositions, calculateCashBalance, calculateCashBalances, calculatePortfolioStats, formatCurrency, formatPercent, calculateDailyPerformance } from "@/lib/calculations";
import { KPICards, PortfolioPerformance } from "@/components/KPICards";
import { PortfolioSelector } from "@/components/PortfolioSelector";
import { CreatePortfolioDialog } from "@/components/CreatePortfolioDialog";
import { AddTransactionDialog } from "@/components/AddTransactionDialog";
import { ImportTransactionsDialog } from "@/components/ImportTransactionsDialog";
import { PositionsTable } from "@/components/PositionsTable";
import { TransactionsTable } from "@/components/TransactionsTable";
import { AllocationChart } from "@/components/AllocationChart";
import { TopMovers } from "@/components/TopMovers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, RefreshCw, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export default function Index() {
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(null);
  const [createPortfolioOpen, setCreatePortfolioOpen] = useState(false);
  const [addTransactionOpen, setAddTransactionOpen] = useState(false);
  const [importTransactionsOpen, setImportTransactionsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [previousCloseMap, setPreviousCloseMap] = useState<Record<string, number>>({});
  const [livePriceMap, setLivePriceMap] = useState<Record<string, number>>({});

  const { data: portfolios = [] } = usePortfolios();
  const { data: allTransactions = [] } = useTransactions();
  const { data: assetsCache = [], refetch: refetchCache } = useAssetsCache();

  // Create an effective cache that overrides DB values with live proxy values
  const effectiveAssetsCache = useMemo(() => {
    return assetsCache.map((a) => ({
      ...a,
      last_price: livePriceMap[a.ticker] || a.last_price
    }));
  }, [assetsCache, livePriceMap]);

  const lastUpdate = useMemo(() => {
    if (!assetsCache || assetsCache.length === 0) return null;
    const dates = assetsCache.map((a) => new Date(a.updated_at).getTime());
    const maxDate = Math.max(...dates);
    return maxDate > 0 ? new Date(maxDate) : null;
  }, [assetsCache]);

  const filteredTransactions = useMemo(
    () =>
    selectedPortfolioId ?
    allTransactions.filter((t) => t.portfolio_id === selectedPortfolioId) :
    allTransactions,
    [allTransactions, selectedPortfolioId]
  );

  // Use EUR as base currency for now
  const selectedPortfolio = portfolios.find((p) => p.id === selectedPortfolioId);
  const baseCurrency = (selectedPortfolio as any)?.currency || "EUR";

  const positions = useMemo(
    () => calculatePositions(filteredTransactions, effectiveAssetsCache, baseCurrency),
    [filteredTransactions, effectiveAssetsCache, baseCurrency]
  );

  // Get unique tickers from positions for historical price fetching
  const positionTickers = useMemo(
    () => positions.map((p) => p.ticker).filter((t) => !t.includes("=X")),
    [positions]
  );
  const { data: historicalPrices = {} } = useHistoricalPrices(positionTickers);

  const cashBalances = useMemo(
    () => calculateCashBalances(filteredTransactions),
    [filteredTransactions]
  );

  const { totalValue, totalInvested } = useMemo(
    () => calculatePortfolioStats(positions, cashBalances, effectiveAssetsCache, filteredTransactions, baseCurrency),
    [positions, cashBalances, effectiveAssetsCache, filteredTransactions, baseCurrency]
  );

  const cashBalance = useMemo(
    () => calculateCashBalance(filteredTransactions),
    [filteredTransactions]
  );

  const portfolioAllocation = useMemo(() => {
    return portfolios.map((p) => {
      const txs = allTransactions.filter((t) => t.portfolio_id === p.id);
      const pCurrency = (p as any)?.currency || "EUR";
      const pos = calculatePositions(txs, effectiveAssetsCache, pCurrency);
      const cash = calculateCashBalances(txs);
      const stats = calculatePortfolioStats(pos, cash, effectiveAssetsCache, txs, pCurrency);
      return { name: p.name, value: Math.max(0, stats.totalValue) };
    }).filter((d) => d.value > 0);
  }, [portfolios, allTransactions, effectiveAssetsCache]);

  const totalGainLoss = totalValue - totalInvested;
  const totalGainLossPercent = totalInvested > 0 ? totalGainLoss / totalInvested * 100 : 0;

  // Fetch market data (prev close + current price) via edge function
  const fetchMarketData = useCallback(async (tickers: string[]) => {
    if (tickers.length === 0) return;
    try {
      const { data, error } = await supabase.functions.invoke("fetch-prices", {
        body: { tickers }
      });
      if (error) {
        console.warn("fetch-prices error:", error);
        return;
      }
      const results = data?.results || {};
      const prevMap: Record<string, number> = {};
      const liveMap: Record<string, number> = {};
      for (const [ticker, info] of Object.entries(results as Record<string, any>)) {
        if (info?.previousClose) prevMap[ticker] = info.previousClose;
        if (info?.price) liveMap[ticker] = info.price;
      }
      setPreviousCloseMap((prev) => ({ ...prev, ...prevMap }));
      setLivePriceMap((prev) => ({ ...prev, ...liveMap }));
    } catch (e) {
      console.warn("Failed to fetch market data", e);
    }
  }, []);

  // Track tickers to avoid infinite re-fetch loop
  const fetchedTickersRef = useRef<string>("");

  // Fetch on load (only when ticker list actually changes)
  useEffect(() => {
    const tickerSet = new Set(positions.map((p) => p.ticker));
    Object.keys(cashBalances).forEach((c) => {
      if (c !== baseCurrency && Math.abs(cashBalances[c]) > 0.01) {
        tickerSet.add(`${c}${baseCurrency}=X`);
        tickerSet.add(`${baseCurrency}${c}=X`);
      }
    });

    const tickerKey = Array.from(tickerSet).sort().join(",");
    if (tickerKey && tickerKey !== fetchedTickersRef.current) {
      fetchedTickersRef.current = tickerKey;
      fetchMarketData(Array.from(tickerSet));
    }
  }, [positions, cashBalances, baseCurrency, fetchMarketData]);

  const handleRefreshPrices = async () => {
    setRefreshing(true);
    try {
      const tickers = [...new Set(allTransactions.filter((t) => t.ticker).map((t) => t.ticker!))] as string[];
      // Add FX pairs for used currencies
      const currencies = new Set(positions.map((p) => p.currency));
      Object.keys(cashBalances).forEach((c) => currencies.add(c));
      currencies.delete(baseCurrency);
      currencies.forEach((c) => {
        tickers.push(`${c}${baseCurrency}=X`);
        tickers.push(`${baseCurrency}${c}=X`);
      });

      if (tickers.length === 0) {
        toast({ title: "Aucun ticker à rafraîchir" });
        setRefreshing(false);
        return;
      }

      const { error } = await supabase.functions.invoke("fetch-prices", {
        body: { tickers }
      });
      if (error) console.warn("Supabase fetch-prices error (ignoring if proxy works):", error);

      await refetchCache();
      await fetchMarketData(tickers);
      toast({ title: "Prix mis à jour" });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
    setRefreshing(false);
  };

  const portfolioPerformances = useMemo(() => {
    if (selectedPortfolioId) return [];

    return portfolios.map((p) => {
      const txs = allTransactions.filter((t) => t.portfolio_id === p.id);
      const pCurrency = (p as any)?.currency || "EUR";
      const pos = calculatePositions(txs, effectiveAssetsCache, pCurrency);
      const cash = calculateCashBalances(txs);

      const { change, changePct } = calculateDailyPerformance(
        pos,
        cash,
        effectiveAssetsCache,
        calculatePortfolioStats(pos, cash, effectiveAssetsCache, txs, pCurrency).totalValue,
        baseCurrency, // Use global base currency for display
        previousCloseMap
      );

      return {
        id: p.id,
        name: p.name,
        color: p.color,
        dailyChange: change,
        dailyChangePct: changePct,
        currency: pCurrency
      } as PortfolioPerformance;
    });
  }, [selectedPortfolioId, portfolios, allTransactions, effectiveAssetsCache, baseCurrency, previousCloseMap]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border/50 px-4 py-3 md:px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <img src="/logo.png" alt="FuckBaggr" className="h-8 w-auto" />
              <span className="text-lg font-semibold tracking-tight">FuckBaggr</span>
            </div>
            <div className="hidden sm:flex items-center gap-3 ml-2 pl-4 border-l border-border/50">
              <span className="text-sm font-medium tabular-nums">{formatCurrency(totalValue, baseCurrency)}</span>
              


            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              {lastUpdate &&
              <span className="text-[10px] text-muted-foreground tabular-nums hidden sm:inline-block">
                  {lastUpdate.toLocaleString()}
                </span>
              }
              <Button variant="outline" size="sm" onClick={handleRefreshPrices} disabled={refreshing}>
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline ml-1">Actualiser</span>
              </Button>
            </div>
            <Button size="sm" onClick={() => setAddTransactionOpen(true)}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline ml-1">Transaction</span>
            </Button>
            <Button size="sm" variant="outline" onClick={() => setImportTransactionsOpen(true)}>
              <Upload className="h-4 w-4" />
              <span className="hidden sm:inline ml-1">Importer</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 md:px-6 space-y-6">
        <PortfolioSelector
          portfolios={portfolios}
          selectedId={selectedPortfolioId}
          onSelect={setSelectedPortfolioId}
          onCreateClick={() => setCreatePortfolioOpen(true)} />


        <KPICards
          totalValue={totalValue}
          totalInvested={totalInvested}
          totalGainLoss={totalGainLoss}
          totalGainLossPercent={totalGainLossPercent}
          assetCount={positions.length}
          cashBalances={cashBalances}
          cashBalance={cashBalance}
          positions={positions}
          assetsCache={effectiveAssetsCache}
          baseCurrency={baseCurrency}
          previousCloseMap={previousCloseMap}
          transactions={filteredTransactions}
          portfolioPerformances={portfolioPerformances} />


        <div className="grid gap-4 md:grid-cols-2">
          <AllocationChart positions={positions} title="Par actif" groupBy="asset" />
          <TopMovers
            positions={positions}
            assetsCache={effectiveAssetsCache} />

        </div>

        <Tabs defaultValue="positions" className="space-y-4">
          <TabsList>
            <TabsTrigger value="positions">Positions</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
          </TabsList>
          <TabsContent value="positions">
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Positions ouvertes</CardTitle>
              </CardHeader>
              <CardContent>
                <PositionsTable positions={positions} baseCurrency={baseCurrency} />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="transactions">
            <Card className="border-border/50">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Historique des transactions</CardTitle>
                <Button size="sm" variant="outline" onClick={() => setAddTransactionOpen(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Ajouter
                </Button>
              </CardHeader>
              <CardContent>
                <TransactionsTable transactions={filteredTransactions} portfolios={portfolios} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <CreatePortfolioDialog open={createPortfolioOpen} onOpenChange={setCreatePortfolioOpen} />
      <AddTransactionDialog
        open={addTransactionOpen}
        onOpenChange={setAddTransactionOpen}
        portfolios={portfolios}
        defaultPortfolioId={selectedPortfolioId || undefined} />

      <ImportTransactionsDialog
        open={importTransactionsOpen}
        onOpenChange={setImportTransactionsOpen}
        portfolios={portfolios} />

    </div>);

}