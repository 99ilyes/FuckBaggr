import { useState, useMemo, useCallback, useEffect } from "react";
import { usePortfolios, useTransactions, useHistoricalPrices } from "@/hooks/usePortfolios";
import { PerformanceTab } from "@/components/PerformanceTab";
import { PortfolioSelector } from "@/components/PortfolioSelector";
import { TickerSearch } from "@/components/TickerSearch";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { X } from "lucide-react";

const BENCH_STORAGE_KEY = "perf_benchmark_tickers";
const LEGACY_BENCH_STORAGE_KEY = "perf_benchmark_ticker";
const MAX_BENCHMARKS = 5;

export default function Performance() {
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(null);
  const [benchmarkTickers, setBenchmarkTickers] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(BENCH_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed
            .filter((ticker): ticker is string => typeof ticker === "string" && ticker.trim().length > 0)
            .map((ticker) => ticker.toUpperCase())
            .slice(0, MAX_BENCHMARKS);
        }
      }

      const legacyTicker = localStorage.getItem(LEGACY_BENCH_STORAGE_KEY);
      return legacyTicker ? [legacyTicker.toUpperCase()] : [];
    } catch {
      return [];
    }
  });
  const [benchSearch, setBenchSearch] = useState("");

  // Persist benchmarks to localStorage
  useEffect(() => {
    try {
      if (benchmarkTickers.length > 0) {
        localStorage.setItem(BENCH_STORAGE_KEY, JSON.stringify(benchmarkTickers));
      } else {
        localStorage.removeItem(BENCH_STORAGE_KEY);
      }
      localStorage.removeItem(LEGACY_BENCH_STORAGE_KEY);
    } catch (_error) {
      // Ignore localStorage write errors (private mode, quota, etc.).
    }
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
    // Include benchmark tickers in historical fetch
    for (const benchmarkTicker of benchmarkTickers) tickers.add(benchmarkTicker);
    return Array.from(tickers).sort();
  }, [filteredTransactions, normalizePerformanceTicker, benchmarkTickers]);

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
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="-ml-1" />
            <span className="text-lg font-semibold tracking-tight">Performance</span>
          </div>

          {/* Benchmark selector */}
          <div className="flex flex-col items-end gap-2">
            <div className="w-52 md:w-56">
              <TickerSearch
                value={benchSearch}
                onChange={setBenchSearch}
                onSelect={(r) => {
                  const ticker = r.symbol.toUpperCase();
                  setBenchmarkTickers((prev) => {
                    if (prev.includes(ticker) || prev.length >= MAX_BENCHMARKS) return prev;
                    return [...prev, ticker];
                  });
                  setBenchSearch("");
                }}
              />
            </div>

            {benchmarkTickers.length > 0 && (
              <div className="flex flex-wrap justify-end gap-1.5 max-w-[420px]">
                {benchmarkTickers.map((ticker, idx) => (
                  <div
                    key={ticker}
                    className="flex items-center gap-1.5 rounded-md border border-border/50 bg-secondary/50 px-2.5 py-1 text-xs"
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: `hsl(var(--chart-${(idx % 5) + 1}))` }}
                    />
                    <span className="font-medium">{ticker}</span>
                    <button
                      onClick={() => {
                        setBenchmarkTickers((prev) => prev.filter((t) => t !== ticker));
                      }}
                      className="ml-0.5 rounded-sm hover:bg-accent p-0.5"
                    >
                      <X className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => {
                    setBenchmarkTickers([]);
                    setBenchSearch("");
                  }}
                  className="rounded-md border border-border/50 px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
                >
                  Tout effacer
                </button>
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
          onCreateClick={() => undefined}
        />

        <PerformanceTab
          transactions={filteredTransactions}
          historicalPrices={historicalPrices}
          portfolioId={selectedPortfolioId}
          portfolioName={selectedPortfolio?.name || "Vue globale"}
          portfolioColor={selectedPortfolio?.color}
          loading={historicalLoading || historicalFetching}
          benchmarkHistories={benchmarkHistories}
          benchmarkTickers={benchmarkTickers}
        />
      </main>
    </div>
  );
}
