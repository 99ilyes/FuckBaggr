import { useState, useMemo, useCallback, useEffect } from "react";
import { usePortfolios, useTransactions, useAssetsCache, useHistoricalPrices } from "@/hooks/usePortfolios";
import { PerformanceTab } from "@/components/PerformanceTab";
import { PortfolioSelector } from "@/components/PortfolioSelector";
import { TickerSearch } from "@/components/TickerSearch";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

const BENCH_STORAGE_KEY = "perf_benchmark_ticker";

export default function Performance() {
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(null);
  const [benchmarkTicker, setBenchmarkTicker] = useState<string | null>(() => {
    try { return localStorage.getItem(BENCH_STORAGE_KEY); } catch { return null; }
  });
  const [benchSearch, setBenchSearch] = useState("");

  // Persist benchmark to localStorage
  useEffect(() => {
    try {
      if (benchmarkTicker) localStorage.setItem(BENCH_STORAGE_KEY, benchmarkTicker);
      else localStorage.removeItem(BENCH_STORAGE_KEY);
    } catch {}
  }, [benchmarkTicker]);

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
    // Include benchmark ticker in historical fetch
    if (benchmarkTicker) tickers.add(benchmarkTicker);
    return Array.from(tickers).sort();
  }, [filteredTransactions, normalizePerformanceTicker, benchmarkTicker]);

  const { data: historicalPrices = {}, isLoading: historicalLoading, isFetching: historicalFetching } =
    useHistoricalPrices(performanceTickers, "max", "1wk");

  const benchmarkHistory = useMemo(() => {
    if (!benchmarkTicker || !historicalPrices[benchmarkTicker]) return undefined;
    return historicalPrices[benchmarkTicker].history;
  }, [benchmarkTicker, historicalPrices]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border/50 px-4 py-3 md:px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="-ml-1" />
            <span className="text-lg font-semibold tracking-tight">Performance</span>
          </div>

          {/* Benchmark selector */}
          <div className="flex items-center gap-2">
            {benchmarkTicker ? (
              <div className="flex items-center gap-1.5 rounded-md border border-border/50 bg-secondary/50 px-2.5 py-1 text-xs">
                <span className="h-2 w-2 rounded-full bg-[hsl(var(--chart-3))]" />
                <span className="font-medium">{benchmarkTicker}</span>
                <button
                  onClick={() => { setBenchmarkTicker(null); setBenchSearch(""); }}
                  className="ml-1 rounded-sm hover:bg-accent p-0.5"
                >
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              </div>
            ) : (
              <div className="w-48">
                <TickerSearch
                  value={benchSearch}
                  onChange={setBenchSearch}
                  onSelect={(r) => {
                    setBenchmarkTicker(r.symbol);
                    setBenchSearch("");
                  }}
                />
              </div>
            )}
          </div>
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
          benchmarkHistory={benchmarkHistory}
          benchmarkTicker={benchmarkTicker}
        />
      </main>
    </div>
  );
}
