import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { usePortfolios, useTransactions, useAssetsCache, useHistoricalPrices } from "@/hooks/usePortfolios";
import { calculatePositions, calculateCashBalances, calculatePortfolioStats } from "@/lib/calculations";
import { fetchPricesClientSide } from "@/lib/yahooFinance";
import { PerformanceTab } from "@/components/PerformanceTab";
import { PortfolioSelector } from "@/components/PortfolioSelector";
import { SidebarTrigger } from "@/components/ui/sidebar";

export default function Performance() {
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(null);

  const { data: portfolios = [] } = usePortfolios();
  const { data: allTransactions = [] } = useTransactions();
  const { data: selectedPortfolioTransactions = [] } = useTransactions(selectedPortfolioId || undefined);
  const { data: assetsCache = [] } = useAssetsCache();

  const filteredTransactions = useMemo(
    () => (selectedPortfolioId ? selectedPortfolioTransactions : allTransactions),
    [selectedPortfolioId, selectedPortfolioTransactions, allTransactions]
  );

  const selectedPortfolio = portfolios.find((p) => p.id === selectedPortfolioId);

  const normalizePerformanceTicker = useCallback((ticker: string) => {
    return ticker === "GOLD-EUR.PA" ? "GOLD.PA" : ticker;
  }, []);

  const performanceTickers = useMemo(() => {
    const tickers = new Set<string>();
    const currencies = new Set<string>();
    for (const tx of filteredTransactions) {
      if (tx.ticker && !tx.ticker.includes("=X") && (tx.type === "buy" || tx.type === "sell" || tx.type === "transfer_in" || tx.type === "transfer_out")) {
        tickers.add(normalizePerformanceTicker(tx.ticker));
      }
      const c = (tx.currency || "").toUpperCase();
      if (c && c !== "EUR") currencies.add(c);
    }
    for (const c of currencies) tickers.add(`${c}EUR=X`);
    return Array.from(tickers).sort();
  }, [filteredTransactions, normalizePerformanceTicker]);

  const { data: historicalPrices = {}, isLoading: historicalLoading, isFetching: historicalFetching } =
    useHistoricalPrices(performanceTickers, "max", "1wk");

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border/50 px-4 py-3 md:px-6">
        <div className="max-w-7xl mx-auto flex items-center gap-4">
          <SidebarTrigger className="-ml-1" />
          <span className="text-lg font-semibold tracking-tight">Performance</span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 md:px-6 space-y-6">
        <PortfolioSelector
          portfolios={portfolios}
          selectedId={selectedPortfolioId}
          onSelect={setSelectedPortfolioId}
          onCreateClick={() => {}}
        />

        <PerformanceTab
          transactions={filteredTransactions}
          historicalPrices={historicalPrices}
          portfolioId={selectedPortfolioId}
          portfolioName={selectedPortfolio?.name || "Vue globale"}
          portfolioColor={(selectedPortfolio as any)?.color}
          loading={historicalLoading || historicalFetching}
        />
      </main>
    </div>
  );
}
