import { useState, useMemo, useCallback, useEffect } from "react";
import { usePortfolios, useTransactions, useHistoricalPrices } from "@/hooks/usePortfolios";
import { PerformanceTab } from "@/components/PerformanceTab";
import { TitlesPerformanceTab } from "@/components/TitlesPerformanceTab";
import { PortfolioSelector } from "@/components/PortfolioSelector";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { DEFAULT_MAX_BENCHMARKS, loadPerformanceBenchmarkTickers, persistPerformanceBenchmarkTickers } from "@/lib/performanceBenchmarks";
import { cn } from "@/lib/utils";

const MAX_BENCHMARKS = DEFAULT_MAX_BENCHMARKS;

export default function Performance() {
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(null);
  const [benchmarkTickers, setBenchmarkTickers] = useState<string[]>(() => loadPerformanceBenchmarkTickers(MAX_BENCHMARKS));
  const [benchSearch, setBenchSearch] = useState("");
  const [viewMode, setViewMode] = useState<"portfolios" | "titles">("portfolios");

  // Persist benchmarks to localStorage
  useEffect(() => {
    persistPerformanceBenchmarkTickers(benchmarkTickers);
  }, [benchmarkTickers]);

  const { data: portfolios = [] } = usePortfolios();
  const { data: allTransactions = [] } = useTransactions();
  const { data: selectedPortfolioTransactions = [] } = useTransactions(selectedPortfolioId || undefined);

  const filteredTransactions = useMemo(
    () => (selectedPortfolioId ? selectedPortfolioTransactions : allTransactions),
    [selectedPortfolioId, selectedPortfolioTransactions, allTransactions]
  );

  const selectedPortfolio = portfolios.find((p) => p.id === selectedPortfolioId);

  const normalizePerformanceTicker = useCallback((ticker: string) => {
    return ticker === "GOLD-EUR.PA" ? "GOLD.PA" : ticker;
  }, []);

  const tickerSourceTransactions = useMemo(
    () => (viewMode === "titles" ? allTransactions : filteredTransactions),
    [viewMode, allTransactions, filteredTransactions]
  );

  const performanceTickers = useMemo(() => {
    const tickers = new Set<string>();
    const currencies = new Set<string>();
    for (const tx of tickerSourceTransactions) {
      if (tx.ticker && !tx.ticker.includes("=X") && (tx.type === "buy" || tx.type === "sell" || tx.type === "transfer_in" || tx.type === "transfer_out")) {
        tickers.add(normalizePerformanceTicker(tx.ticker));
      }
      const c = (tx.currency || "").toUpperCase();
      if (c && c !== "EUR") currencies.add(c);
    }
    for (const c of currencies) tickers.add(`${c}EUR=X`);
    // Include benchmark tickers in historical fetch
    for (const benchmarkTicker of benchmarkTickers) tickers.add(benchmarkTicker);
    return Array.from(tickers).sort();
  }, [tickerSourceTransactions, normalizePerformanceTicker, benchmarkTickers]);

  const { data: historicalPrices = {}, isLoading: historicalLoading, isFetching: historicalFetching } =
    useHistoricalPrices(performanceTickers, "max", "1d");

  const benchmarkHistories = useMemo(() => {
    const byTicker: Record<string, { time: number; price: number }[]> = {};
    for (const ticker of benchmarkTickers) {
      const history = historicalPrices[ticker]?.history;
      if (history && history.length > 0) byTicker[ticker] = history;
    }
    return byTicker;
  }, [benchmarkTickers, historicalPrices]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border/50 px-4 py-3 md:px-6">
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <SidebarTrigger className="-ml-1" />
          <h1 className="text-lg font-semibold tracking-tight">Performance</h1>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 pt-2 md:px-6">
        <PortfolioSelector
          portfolios={portfolios}
          selectedId={selectedPortfolioId}
          onSelect={setSelectedPortfolioId}
          onCreateClick={() => undefined}
          showCreateButton={false}
          className="mb-0 border-border/40"
          rightContent={
            <div className="ml-auto flex items-center gap-1 pl-2">
              <button
                onClick={() => setViewMode("portfolios")}
                className={cn(
                  "px-3 py-2 text-sm font-semibold border-b-2 transition-all duration-200 whitespace-nowrap",
                  viewMode === "portfolios"
                    ? "border-emerald-500 text-white"
                    : "border-transparent text-muted-foreground hover:text-white"
                )}
              >
                Portefeuilles
              </button>
              <button
                onClick={() => setViewMode("titles")}
                className={cn(
                  "px-3 py-2 text-sm font-semibold border-b-2 transition-all duration-200 whitespace-nowrap",
                  viewMode === "titles"
                    ? "border-emerald-500 text-white"
                    : "border-transparent text-muted-foreground hover:text-white"
                )}
              >
                Titres
              </button>
            </div>
          }
        />
      </div>

      <main className="max-w-7xl mx-auto px-4 py-4 md:px-6">
        {viewMode === "portfolios" ? (
            <PerformanceTab
              transactions={filteredTransactions}
              historicalPrices={historicalPrices}
              portfolioId={selectedPortfolioId}
              portfolioName={selectedPortfolio?.name || "Vue globale"}
              portfolioColor={selectedPortfolio?.color}
              loading={historicalLoading || historicalFetching}
              benchmarkHistories={benchmarkHistories}
              benchmarkTickers={benchmarkTickers}
              benchSearch={benchSearch}
              onBenchSearchChange={setBenchSearch}
              onBenchmarkTickersChange={setBenchmarkTickers}
              maxBenchmarks={MAX_BENCHMARKS}
            />
        ) : (
            <TitlesPerformanceTab
              transactions={filteredTransactions}
              allTransactions={allTransactions}
              portfolios={portfolios}
              historicalPrices={historicalPrices}
              portfolioId={selectedPortfolioId}
              portfolioName={selectedPortfolio?.name || "Vue globale"}
              loading={historicalLoading || historicalFetching}
              benchmarkHistories={benchmarkHistories}
              benchmarkTickers={benchmarkTickers}
              benchSearch={benchSearch}
              onBenchSearchChange={setBenchSearch}
              onBenchmarkTickersChange={setBenchmarkTickers}
              maxBenchmarks={MAX_BENCHMARKS}
            />
        )}
      </main>
    </div>
  );
}
