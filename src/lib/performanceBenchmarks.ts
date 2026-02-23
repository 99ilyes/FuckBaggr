const BENCH_STORAGE_KEY = "perf_benchmark_tickers";
const LEGACY_BENCH_STORAGE_KEY = "perf_benchmark_ticker";

export const DEFAULT_MAX_BENCHMARKS = 5;

export function loadPerformanceBenchmarkTickers(maxBenchmarks = DEFAULT_MAX_BENCHMARKS): string[] {
  try {
    const raw = localStorage.getItem(BENCH_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((ticker): ticker is string => typeof ticker === "string" && ticker.trim().length > 0)
          .map((ticker) => ticker.toUpperCase())
          .slice(0, maxBenchmarks);
      }
    }

    const legacyTicker = localStorage.getItem(LEGACY_BENCH_STORAGE_KEY);
    return legacyTicker ? [legacyTicker.toUpperCase()] : [];
  } catch {
    return [];
  }
}

export function persistPerformanceBenchmarkTickers(benchmarkTickers: string[]): void {
  try {
    if (benchmarkTickers.length > 0) {
      localStorage.setItem(BENCH_STORAGE_KEY, JSON.stringify(benchmarkTickers));
    } else {
      localStorage.removeItem(BENCH_STORAGE_KEY);
    }
    localStorage.removeItem(LEGACY_BENCH_STORAGE_KEY);
  } catch {
    // Ignore localStorage write errors (private mode, quota, etc.).
  }
}
