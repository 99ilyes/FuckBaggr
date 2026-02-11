import { useState, useMemo } from "react";
import { usePortfolios, useTransactions, useAssetsCache } from "@/hooks/usePortfolios";
import { calculatePositions, calculateCashBalance, calculateCashBalances, calculatePortfolioStats } from "@/lib/calculations";
import { KPICards } from "@/components/KPICards";
import { PortfolioSelector } from "@/components/PortfolioSelector";
import { CreatePortfolioDialog } from "@/components/CreatePortfolioDialog";
import { AddTransactionDialog } from "@/components/AddTransactionDialog";
import { ImportTransactionsDialog } from "@/components/ImportTransactionsDialog";
import { PositionsTable } from "@/components/PositionsTable";
import { TransactionsTable } from "@/components/TransactionsTable";
import { AllocationChart } from "@/components/AllocationChart";
import { PerformanceChart } from "@/components/PerformanceChart";
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

  const { data: portfolios = [] } = usePortfolios();
  const { data: allTransactions = [] } = useTransactions();
  const { data: assetsCache = [], refetch: refetchCache } = useAssetsCache();

  const filteredTransactions = useMemo(
    () =>
      selectedPortfolioId
        ? allTransactions.filter((t) => t.portfolio_id === selectedPortfolioId)
        : allTransactions,
    [allTransactions, selectedPortfolioId]
  );

  // Use EUR as base currency for now, ideally selected from portfolio setting
  const selectedPortfolio = portfolios.find(p => p.id === selectedPortfolioId);
  const baseCurrency = (selectedPortfolio as any)?.currency || "EUR";

  const positions = useMemo(
    () => calculatePositions(filteredTransactions, assetsCache, baseCurrency),
    [filteredTransactions, assetsCache, baseCurrency]
  );

  const cashBalances = useMemo(
    () => calculateCashBalances(filteredTransactions),
    [filteredTransactions]
  );

  const { totalValue, totalInvested } = useMemo(
    () => calculatePortfolioStats(positions, cashBalances, assetsCache, filteredTransactions, baseCurrency),
    [positions, cashBalances, assetsCache, filteredTransactions, baseCurrency]
  );

  const cashBalance = useMemo(
    () => calculateCashBalance(filteredTransactions), // Keep for internal legacy if needed, but not used for display
    [filteredTransactions]
  );

  const totalGainLoss = totalValue - totalInvested;
  const totalGainLossPercent = totalInvested > 0 ? (totalGainLoss / totalInvested) * 100 : 0;

  const handleRefreshPrices = async () => {
    setRefreshing(true);
    try {
      const tickers = [...new Set(allTransactions.filter((t) => t.ticker).map((t) => t.ticker!))];
      // Add FX pairs for used currencies
      const currencies = new Set(positions.map(p => p.currency));
      Object.keys(cashBalances).forEach(c => currencies.add(c));
      currencies.delete(baseCurrency);
      currencies.forEach(c => tickers.push(`${c}${baseCurrency}=X`));

      if (tickers.length === 0) {
        toast({ title: "Aucun ticker à rafraîchir" });
        setRefreshing(false);
        return;
      }
      const { error } = await supabase.functions.invoke("fetch-prices", {
        body: { tickers },
      });
      if (error) throw error;
      await refetchCache();
      toast({ title: "Prix mis à jour" });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
    setRefreshing(false);
  };


  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50 px-4 py-3 md:px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight">Portfolio Tracker</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleRefreshPrices} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline ml-1">Actualiser Prix</span>
            </Button>
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
          onCreateClick={() => setCreatePortfolioOpen(true)}
        />

        <KPICards
          totalValue={totalValue}
          totalInvested={totalInvested}
          totalGainLoss={totalGainLoss}
          totalGainLossPercent={totalGainLossPercent}
          assetCount={positions.length}
          cashBalances={cashBalances}
          cashBalance={cashBalance}
        />

        <div className="grid gap-4 md:grid-cols-2">
          <PerformanceChart transactions={filteredTransactions} assetsCache={assetsCache} />
          <div className="grid gap-4">
            <AllocationChart positions={positions} title="Par actif" groupBy="asset" />
          </div>
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
        defaultPortfolioId={selectedPortfolioId || undefined}
      />
      <ImportTransactionsDialog
        open={importTransactionsOpen}
        onOpenChange={setImportTransactionsOpen}
        portfolios={portfolios}
      />
    </div>
  );
}
