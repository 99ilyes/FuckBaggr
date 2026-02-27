import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useAssetsCache, usePortfolios, useTransactions } from "@/hooks/usePortfolios";
import { useQuery } from "@tanstack/react-query";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { TickerLogo } from "@/components/TickerLogo";
import { Eye, Search, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fetchPricesClientSide } from "@/lib/yahooFinance";
import {
  currentRatioLabel,
  DEFAULT_GROWTH,
  DEFAULT_TARGET_RETURN,
  DEFAULT_TERMINAL_PE,
  DEFAULT_VALUATION_MODEL,
  DEFAULT_YEARS,
  FairValueParams,
  metricLabel,
  parseValuationModel,
  ValuationModel,
  WatchlistSort,
} from "@/lib/watchlistTypes";
import { buildWatchlistViewModel, WatchlistComputedRow } from "@/lib/watchlistViewModel";
import { WatchlistTickerMenu } from "@/components/watchlist/WatchlistTickerMenu";
import { WatchlistTickerHeader } from "@/components/watchlist/WatchlistTickerHeader";
import { WatchlistPricePanel } from "@/components/watchlist/WatchlistPricePanel";
import { WatchlistValuationCard } from "@/components/watchlist/WatchlistValuationCard";
import { WatchlistInfoCard } from "@/components/watchlist/WatchlistInfoCard";
import { WatchlistValuationRatiosCard } from "@/components/watchlist/WatchlistValuationRatiosCard";

interface TickerQuote {
  price: number | null;
  previousClose: number | null;
  name: string;
  currency: string;
  trailingPE: number | null;
  trailingEps: number | null;
  trailingFcfPerShare: number | null;
  trailingRevenuePerShare: number | null;
  trailingTotalRevenue: number | null;
  trailingRevenueShares: number | null;
  changePercent: number | null;
}

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

interface YFinanceData {
  trailingPE: number | null;
  trailingEps: number | null;
  trailingFcfPerShare: number | null;
  trailingRevenuePerShare: number | null;
  trailingTotalRevenue: number | null;
  trailingRevenueShares: number | null;
}

const STORAGE_KEY = "watchlist-custom-tickers";
const HIDDEN_KEY = "watchlist-hidden-tickers";
const FV_PARAMS_KEY = "watchlist-fv-params";
const TARGET_RETURN_KEY = "watchlist-target-return";
const MANUAL_EPS_KEY = "watchlist-manual-eps";
const MANUAL_FCF_PER_SHARE_KEY = "watchlist-manual-fcf-per-share";
const MANUAL_REVENUE_PER_SHARE_KEY = "watchlist-manual-revenue-per-share";
const VALUATION_MODEL_KEY = "watchlist-valuation-model";
const WATCHLIST_META_TICKER = "__WATCHLIST_SETTINGS__";
const SELECTED_TICKER_KEY = "watchlist-selected-ticker";
const BILLION = 1_000_000_000;

interface WatchlistTickerMeta {
  custom?: boolean;
  hidden?: boolean;
  manualEps?: boolean;
  valuationModel?: ValuationModel;
  manualFcfPerShare?: number;
  manualRevenuePerShare?: number;
}

function loadCustomTickers(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCustomTickers(tickers: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tickers));
  } catch {
    // ignore localStorage errors
  }
}

function loadHiddenTickers(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHiddenTickers(tickers: string[]) {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(tickers));
  } catch {
    // ignore localStorage errors
  }
}

function loadFVParams(): Record<string, FairValueParams> {
  try {
    const raw = localStorage.getItem(FV_PARAMS_KEY);
    return raw ? parseFvParams(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function saveFVParams(params: Record<string, FairValueParams>) {
  try {
    localStorage.setItem(FV_PARAMS_KEY, JSON.stringify(params));
  } catch {
    // ignore localStorage errors
  }
}

function loadTargetReturn(): number {
  try {
    const raw = localStorage.getItem(TARGET_RETURN_KEY);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : DEFAULT_TARGET_RETURN;
  } catch {
    return DEFAULT_TARGET_RETURN;
  }
}

function saveTargetReturn(value: number) {
  try {
    localStorage.setItem(TARGET_RETURN_KEY, String(value));
  } catch {
    // ignore localStorage errors
  }
}

function loadSelectedTicker(): string | null {
  try {
    return localStorage.getItem(SELECTED_TICKER_KEY);
  } catch {
    return null;
  }
}

function saveSelectedTicker(ticker: string | null) {
  try {
    if (!ticker) {
      localStorage.removeItem(SELECTED_TICKER_KEY);
      return;
    }
    localStorage.setItem(SELECTED_TICKER_KEY, ticker);
  } catch {
    // ignore localStorage errors
  }
}

function loadManualValues(storageKey: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};

    const out: Record<string, number> = {};
    for (const [ticker, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        out[ticker] = value;
      }
    }

    return out;
  } catch {
    return {};
  }
}

function saveManualValues(storageKey: string, values: Record<string, number>) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(values));
  } catch {
    // ignore localStorage errors
  }
}

function loadManualEps(): Record<string, number> {
  return loadManualValues(MANUAL_EPS_KEY);
}

function saveManualEps(values: Record<string, number>) {
  saveManualValues(MANUAL_EPS_KEY, values);
}

function loadManualFcfPerShare(): Record<string, number> {
  return loadManualValues(MANUAL_FCF_PER_SHARE_KEY);
}

function saveManualFcfPerShare(values: Record<string, number>) {
  saveManualValues(MANUAL_FCF_PER_SHARE_KEY, values);
}

function loadManualRevenuePerShare(): Record<string, number> {
  return loadManualValues(MANUAL_REVENUE_PER_SHARE_KEY);
}

function saveManualRevenuePerShare(values: Record<string, number>) {
  saveManualValues(MANUAL_REVENUE_PER_SHARE_KEY, values);
}

function loadValuationModels(): Record<string, ValuationModel> {
  try {
    const raw = localStorage.getItem(VALUATION_MODEL_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};

    const out: Record<string, ValuationModel> = {};
    for (const [ticker, value] of Object.entries(parsed as Record<string, unknown>)) {
      const parsedValue = parseValuationModel(value);
      if (parsedValue) out[ticker] = parsedValue;
    }

    return out;
  } catch {
    return {};
  }
}

function saveValuationModels(values: Record<string, ValuationModel>) {
  try {
    localStorage.setItem(VALUATION_MODEL_KEY, JSON.stringify(values));
  } catch {
    // ignore localStorage errors
  }
}

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundTo(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function toPercentFromDb(value: unknown, fallback: number): number {
  const n = toFiniteNumber(value);
  if (n == null) return fallback;
  return roundTo(Math.abs(n) <= 1 ? n * 100 : n);
}

function toDecimalPercent(value: number): number {
  return roundTo(value / 100);
}

function parseFvParams(value: unknown): Record<string, FairValueParams> {
  if (!value || typeof value !== "object") return {};

  const out: Record<string, FairValueParams> = {};
  for (const [ticker, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const v = raw as Record<string, unknown>;
    const growth = toFiniteNumber(v.growth);
    const terminalPE = toFiniteNumber(v.terminalPE);
    const years = toFiniteNumber(v.years);

    if (growth == null || terminalPE == null || years == null) continue;
    if (terminalPE <= 0 || years <= 0) continue;

    out[ticker] = { growth, terminalPE, years };
  }

  return out;
}

function parseTickerMeta(notes: string | null): WatchlistTickerMeta {
  if (!notes) return {};

  try {
    const parsed = JSON.parse(notes);
    if (!parsed || typeof parsed !== "object") return {};

    const obj = parsed as Record<string, unknown>;
    const manualFcfPerShare = toFiniteNumber(obj.manualFcfPerShare);
    const manualRevenuePerShare = toFiniteNumber(obj.manualRevenuePerShare);

    return {
      custom: typeof obj.custom === "boolean" ? obj.custom : undefined,
      hidden: typeof obj.hidden === "boolean" ? obj.hidden : undefined,
      manualEps: typeof obj.manualEps === "boolean" ? obj.manualEps : undefined,
      valuationModel: parseValuationModel(obj.valuationModel) ?? undefined,
      manualFcfPerShare: manualFcfPerShare ?? undefined,
      manualRevenuePerShare: manualRevenuePerShare ?? undefined,
    };
  } catch {
    return {};
  }
}

function serializeTickerMeta(meta: WatchlistTickerMeta): string {
  return JSON.stringify(meta);
}

function calcFutureMetric(metric: number | null, growth: number, years: number): number | null {
  if (metric == null || years <= 0) return null;
  const g = growth / 100;
  if (g <= -1) return null;
  return metric * Math.pow(1 + g, years);
}

function calcCurrentMultiple(price: number | null, metric: number | null): number | null {
  if (price == null || metric == null || price <= 0 || metric === 0) return null;
  return price / metric;
}

function resolveAnnualizedMetric(value: number | null): number | null {
  if (value != null && Number.isFinite(value)) return value;
  return null;
}

function calcFuturePrice(metric: number | null, params: FairValueParams): number | null {
  const futureMetric = calcFutureMetric(metric, params.growth, params.years);
  if (futureMetric == null || params.terminalPE <= 0) return null;
  return futureMetric * params.terminalPE;
}

function calcFairPrice(futurePrice: number | null, targetReturn: number, years: number): number | null {
  if (futurePrice == null || futurePrice <= 0 || years <= 0) return null;
  const r = targetReturn / 100;
  if (r <= -1) return null;
  return futurePrice / Math.pow(1 + r, years);
}

function calcImpliedReturn(price: number | null, futurePrice: number | null, years: number): number | null {
  if (price == null || futurePrice == null || price <= 0 || futurePrice <= 0 || years <= 0) return null;
  return (Math.pow(futurePrice / price, 1 / years) - 1) * 100;
}

function normalizeFundamentalsPayload(payload: unknown): Record<string, YFinanceData> {
  const source =
    payload &&
      typeof payload === "object" &&
      "results" in (payload as Record<string, unknown>) &&
      (payload as Record<string, unknown>).results &&
      typeof (payload as Record<string, unknown>).results === "object"
      ? ((payload as Record<string, unknown>).results as Record<string, unknown>)
      : (payload as Record<string, unknown> | null);

  if (!source || typeof source !== "object") return {};

  const out: Record<string, YFinanceData> = {};

  for (const [ticker, raw] of Object.entries(source)) {
    const v = (raw ?? {}) as Record<string, unknown>;

    out[ticker] = {
      trailingPE: typeof v.trailingPE === "number" ? v.trailingPE : null,
      trailingEps: typeof v.trailingEps === "number" ? v.trailingEps : null,
      trailingFcfPerShare: typeof v.trailingFcfPerShare === "number" ? v.trailingFcfPerShare : null,
      trailingRevenuePerShare: typeof v.trailingRevenuePerShare === "number" ? v.trailingRevenuePerShare : null,
      trailingTotalRevenue: typeof v.trailingTotalRevenue === "number" ? v.trailingTotalRevenue : null,
      trailingRevenueShares: typeof v.trailingRevenueShares === "number" ? v.trailingRevenueShares : null,
    };
  }

  return out;
}

async function fetchFundamentals(tickers: string[]): Promise<Record<string, YFinanceData>> {
  if (tickers.length === 0) return {};

  try {
    const { data, error } = await supabase.functions.invoke("fetch-prices", {
      body: { tickers, mode: "fundamentals" },
    });

    if (error) {
      console.warn("[Watchlist] Edge Function fundamentals error:", error);
      return {};
    }

    return normalizeFundamentalsPayload(data);
  } catch (err) {
    console.warn("[Watchlist] Edge Function fundamentals failed:", err);
    return {};
  }
}

async function fetchAllQuotes(tickers: string[]): Promise<Record<string, TickerQuote>> {
  const results: Record<string, TickerQuote> = {};
  if (tickers.length === 0) return results;

  const [priceMap, fundMap] = await Promise.all([
    fetchPricesClientSide(tickers),
    fetchFundamentals(tickers),
  ]);

  for (const ticker of tickers) {
    const quote = priceMap[ticker];
    if (!quote) continue;

    const fund = fundMap[ticker];
    const annualizedEps = resolveAnnualizedMetric(fund?.trailingEps ?? null);
    const annualizedFcfPerShare = resolveAnnualizedMetric(fund?.trailingFcfPerShare ?? null);
    const annualizedRevenuePerShare = resolveAnnualizedMetric(fund?.trailingRevenuePerShare ?? null);

    const computedPE = calcCurrentMultiple(quote.price ?? null, annualizedEps);
    const computedChangePercent =
      quote.price != null &&
        quote.previousClose != null &&
        quote.previousClose !== 0
        ? ((quote.price - quote.previousClose) / quote.previousClose) * 100
        : null;

    results[ticker] = {
      price: quote.price ?? null,
      previousClose: quote.previousClose ?? null,
      name: quote.name ?? ticker,
      currency: quote.currency ?? "USD",
      trailingPE: computedPE ?? fund?.trailingPE ?? null,
      trailingEps: annualizedEps,
      trailingFcfPerShare: annualizedFcfPerShare,
      trailingRevenuePerShare: annualizedRevenuePerShare,
      trailingTotalRevenue: fund?.trailingTotalRevenue ?? null,
      trailingRevenueShares: fund?.trailingRevenueShares ?? null,
      changePercent: quote.changePercent ?? computedChangePercent,
    };
  }

  return results;
}

async function searchTickers(query: string): Promise<SearchResult[]> {
  try {
    const { data, error } = await supabase.functions.invoke("search-tickers", {
      body: { query },
    });

    if (error || !data?.results) return [];
    return data.results;
  } catch {
    return [];
  }
}

function TickerSearchBar({
  onAdd,
  existingTickers,
}: {
  onAdd: (ticker: string) => void;
  existingTickers: Set<string>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 1) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    setSearching(true);
    const res = await searchTickers(q);
    setResults(res.filter((r) => r.type === "EQUITY" || r.type === "ETF"));
    setIsOpen(true);
    setSearching(false);
  }, []);

  const handleInputChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  };

  const handleSelect = (symbol: string) => {
    if (!existingTickers.has(symbol)) {
      onAdd(symbol);
    }

    setQuery("");
    setResults([]);
    setIsOpen(false);
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          placeholder="Ajouter un titre (ex: AAPL, MC.PA...)"
          className="pl-9 pr-4 h-9 text-sm"
        />
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-md border bg-popover shadow-lg overflow-hidden">
          {searching ? (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center">Recherche...</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center">Aucun résultat</div>
          ) : (
            <ul className="max-h-64 overflow-y-auto py-1">
              {results.map((result) => {
                const already = existingTickers.has(result.symbol);

                return (
                  <li key={result.symbol}>
                    <button
                      type="button"
                      disabled={already}
                      onClick={() => handleSelect(result.symbol)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors ${
                        already ? "opacity-40 cursor-default" : "hover:bg-accent cursor-pointer"
                      }`}
                    >
                      <TickerLogo ticker={result.symbol} className="h-6 w-6 shrink-0" />
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="font-medium truncate">{result.symbol}</span>
                        <span className="text-xs text-muted-foreground truncate">{result.name}</span>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">{result.exchange}</span>
                      {!already && <Plus className="h-4 w-4 text-muted-foreground shrink-0" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function Watchlist() {
  const { data: allTransactions = [], isLoading: txLoading } = useTransactions();
  const { data: portfolios = [] } = usePortfolios();
  const { data: assetsCache = [] } = useAssetsCache();

  const [customTickers, setCustomTickers] = useState<string[]>(loadCustomTickers);
  const [hiddenTickers, setHiddenTickers] = useState<string[]>(loadHiddenTickers);
  const [fvParams, setFvParams] = useState<Record<string, FairValueParams>>(loadFVParams);
  const [targetReturn, setTargetReturn] = useState<number>(loadTargetReturn);
  const [manualEps, setManualEps] = useState<Record<string, number>>(loadManualEps);
  const [manualFcfPerShare, setManualFcfPerShare] = useState<Record<string, number>>(loadManualFcfPerShare);
  const [manualRevenuePerShare, setManualRevenuePerShare] = useState<Record<string, number>>(loadManualRevenuePerShare);
  const [valuationModelByTicker, setValuationModelByTicker] = useState<Record<string, ValuationModel>>(loadValuationModels);
  const [watchlistSort, setWatchlistSort] = useState<WatchlistSort>("implied_desc");
  const [selectedTicker, setSelectedTicker] = useState<string | null>(loadSelectedTicker);
  const hasAppliedDefaultSelectionRef = useRef(false);
  const [cloudLoaded, setCloudLoaded] = useState(false);
  const cloudTickersRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let isCancelled = false;

    const loadFromCloud = async () => {
      try {
        const { data, error } = await supabase
          .from("watchlist_valuations")
          .select("*")
          .order("ticker");

        if (error) throw error;
        if (isCancelled || !data) return;

        const cloudTickers = new Set<string>();
        const nextCustom = new Set<string>();
        const nextHidden = new Set<string>();
        const nextFv: Record<string, FairValueParams> = {};
        const nextManual: Record<string, number> = {};
        const nextManualFcf: Record<string, number> = {};
        const nextManualRevenue: Record<string, number> = {};
        const nextModels: Record<string, ValuationModel> = {};
        let nextTarget: number | null = null;

        for (const row of data) {
          if (!row.ticker) continue;

          if (row.ticker === WATCHLIST_META_TICKER) {
            nextTarget = toPercentFromDb(row.min_return, DEFAULT_TARGET_RETURN);
            continue;
          }

          cloudTickers.add(row.ticker);

          const meta = parseTickerMeta(row.notes);
          const isHidden = meta.hidden === true;
          const isCustom = meta.custom == null ? true : meta.custom;

          if (isCustom) nextCustom.add(row.ticker);
          if (isHidden) nextHidden.add(row.ticker);

          const model = meta.valuationModel ?? DEFAULT_VALUATION_MODEL;
          if (model !== DEFAULT_VALUATION_MODEL) {
            nextModels[row.ticker] = model;
          }

          if (row.eps_growth != null || row.terminal_pe != null || row.years != null) {
            const growth = toPercentFromDb(row.eps_growth, DEFAULT_GROWTH);
            const terminalPE = toFiniteNumber(row.terminal_pe) ?? DEFAULT_TERMINAL_PE;
            const years = toFiniteNumber(row.years) ?? DEFAULT_YEARS;

            if (terminalPE > 0 && years > 0) {
              nextFv[row.ticker] = { growth, terminalPE, years };
            }
          }

          const manual = toFiniteNumber(row.eps);
          const hasLegacyManualValue = meta.manualEps == null && manual != null && manual !== 0;
          if ((meta.manualEps === true || hasLegacyManualValue) && manual != null) {
            nextManual[row.ticker] = manual;
          }

          if (meta.manualFcfPerShare != null) {
            nextManualFcf[row.ticker] = meta.manualFcfPerShare;
          }

          if (meta.manualRevenuePerShare != null) {
            nextManualRevenue[row.ticker] = meta.manualRevenuePerShare;
          }

          if (nextTarget == null && row.min_return != null) {
            nextTarget = toPercentFromDb(row.min_return, DEFAULT_TARGET_RETURN);
          }
        }

        if (data.length > 0) {
          setCustomTickers(Array.from(nextCustom));
          setHiddenTickers(Array.from(nextHidden));
          setFvParams(nextFv);
          setManualEps(nextManual);
          setManualFcfPerShare(nextManualFcf);
          setManualRevenuePerShare(nextManualRevenue);
          setValuationModelByTicker(nextModels);
          if (nextTarget != null) setTargetReturn(nextTarget);
        }

        cloudTickersRef.current = cloudTickers;
      } catch (error) {
        console.error("[Watchlist] Cloud load failed:", error);
      } finally {
        if (!isCancelled) setCloudLoaded(true);
      }
    };

    loadFromCloud();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!cloudLoaded) return;

    saveCustomTickers(customTickers);
    saveHiddenTickers(hiddenTickers);
    saveFVParams(fvParams);
    saveTargetReturn(targetReturn);
    saveManualEps(manualEps);
    saveManualFcfPerShare(manualFcfPerShare);
    saveManualRevenuePerShare(manualRevenuePerShare);
    saveValuationModels(valuationModelByTicker);

    const timer = setTimeout(async () => {
      try {
        const customTickerSet = new Set(customTickers);
        const hiddenTickerSet = new Set(hiddenTickers);

        const trackedTickers = Array.from(
          new Set([
            ...customTickers,
            ...hiddenTickers,
            ...Object.keys(fvParams),
            ...Object.keys(manualEps),
            ...Object.keys(manualFcfPerShare),
            ...Object.keys(manualRevenuePerShare),
            ...Object.keys(valuationModelByTicker),
          ])
        );

        const nowIso = new Date().toISOString();

        const rowsToUpsert: TablesInsert<"watchlist_valuations">[] = trackedTickers.map((ticker) => {
          const params = fvParams[ticker];
          const manual = manualEps[ticker];
          const manualFcf = manualFcfPerShare[ticker];
          const manualRevenue = manualRevenuePerShare[ticker];
          const valuationModel = valuationModelByTicker[ticker] ?? DEFAULT_VALUATION_MODEL;

          return {
            ticker,
            eps_growth: params ? toDecimalPercent(params.growth) : null,
            terminal_pe: params ? params.terminalPE : null,
            years: params ? params.years : null,
            eps: Number.isFinite(manual) ? manual : null,
            min_return: toDecimalPercent(targetReturn),
            notes: serializeTickerMeta({
              custom: customTickerSet.has(ticker),
              hidden: hiddenTickerSet.has(ticker),
              manualEps: Number.isFinite(manual),
              valuationModel,
              manualFcfPerShare: Number.isFinite(manualFcf) ? manualFcf : undefined,
              manualRevenuePerShare: Number.isFinite(manualRevenue) ? manualRevenue : undefined,
            }),
            updated_at: nowIso,
          };
        });

        rowsToUpsert.push({
          ticker: WATCHLIST_META_TICKER,
          eps_growth: null,
          terminal_pe: null,
          years: null,
          eps: null,
          min_return: toDecimalPercent(targetReturn),
          notes: "{}",
          updated_at: nowIso,
        });

        const { error: upsertError } = await supabase
          .from("watchlist_valuations")
          .upsert(rowsToUpsert, { onConflict: "ticker" });

        if (upsertError) throw upsertError;

        const previousCloudTickers = cloudTickersRef.current;
        const nextCloudTickers = new Set(trackedTickers);
        const toDelete = Array.from(previousCloudTickers).filter((ticker) => !nextCloudTickers.has(ticker));

        if (toDelete.length > 0) {
          const { error: deleteError } = await supabase
            .from("watchlist_valuations")
            .delete()
            .in("ticker", toDelete);

          if (deleteError) throw deleteError;
        }

        cloudTickersRef.current = nextCloudTickers;
      } catch (error) {
        console.error("[Watchlist] Cloud save failed:", error);
      }
    }, 700);

    return () => clearTimeout(timer);
  }, [
    cloudLoaded,
    customTickers,
    hiddenTickers,
    fvParams,
    targetReturn,
    manualEps,
    manualFcfPerShare,
    manualRevenuePerShare,
    valuationModelByTicker,
  ]);

  const holdingTickers = useMemo(() => {
    const qty = new Map<string, number>();

    for (const tx of allTransactions) {
      if (!tx.ticker || !tx.quantity) continue;

      if (tx.type === "buy" || tx.type === "transfer_in") {
        qty.set(tx.ticker, (qty.get(tx.ticker) || 0) + tx.quantity);
      } else if (tx.type === "sell" || tx.type === "transfer_out") {
        qty.set(tx.ticker, (qty.get(tx.ticker) || 0) - tx.quantity);
      }
    }

    return [...qty.entries()]
      .filter(([, quantity]) => quantity > 0.0001)
      .map(([ticker]) => ticker)
      .sort();
  }, [allTransactions]);

  const hiddenSet = useMemo(() => new Set(hiddenTickers), [hiddenTickers]);

  const allTickers = useMemo(() => {
    const set = new Set(holdingTickers);
    for (const ticker of customTickers) set.add(ticker);
    for (const ticker of hiddenTickers) set.delete(ticker);
    return [...set].sort();
  }, [holdingTickers, customTickers, hiddenTickers]);

  const holdingSet = useMemo(() => new Set(holdingTickers), [holdingTickers]);

  useEffect(() => {
    setCustomTickers((prev) => {
      const filtered = prev.filter((ticker) => !holdingSet.has(ticker));
      if (filtered.length === prev.length) return prev;
      return filtered;
    });
  }, [holdingSet]);

  const { data: quotes = {}, isLoading: quotesLoading } = useQuery({
    queryKey: ["watchlist-quotes", allTickers.join(",")],
    queryFn: () => fetchAllQuotes(allTickers),
    enabled: allTickers.length > 0,
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });
  const isWatchlistLoading = txLoading || quotesLoading;

  const addTicker = (ticker: string) => {
    if (hiddenSet.has(ticker)) {
      setHiddenTickers((prev) => prev.filter((entry) => entry !== ticker));
      return;
    }

    if (!customTickers.includes(ticker) && !holdingTickers.includes(ticker)) {
      setCustomTickers((prev) => [...prev, ticker]);
    }
  };

  const removeTicker = (ticker: string) => {
    if (holdingSet.has(ticker)) {
      setCustomTickers((prev) => prev.filter((entry) => entry !== ticker));
      setHiddenTickers((prev) => (prev.includes(ticker) ? prev : [...prev, ticker]));
      return;
    }

    setCustomTickers((prev) => prev.filter((entry) => entry !== ticker));
    setHiddenTickers((prev) => prev.filter((entry) => entry !== ticker));

    setFvParams((prev) => {
      if (!prev[ticker]) return prev;
      const next = { ...prev };
      delete next[ticker];
      return next;
    });

    setManualEps((prev) => {
      if (!(ticker in prev)) return prev;
      const next = { ...prev };
      delete next[ticker];
      return next;
    });

    setManualFcfPerShare((prev) => {
      if (!(ticker in prev)) return prev;
      const next = { ...prev };
      delete next[ticker];
      return next;
    });

    setManualRevenuePerShare((prev) => {
      if (!(ticker in prev)) return prev;
      const next = { ...prev };
      delete next[ticker];
      return next;
    });

    setValuationModelByTicker((prev) => {
      if (!(ticker in prev)) return prev;
      const next = { ...prev };
      delete next[ticker];
      return next;
    });
  };

  const updateFVParam = (ticker: string, key: keyof FairValueParams, value: number) => {
    setFvParams((prev) => {
      const current = prev[ticker];
      if (!current) return prev;
      return { ...prev, [ticker]: { ...current, [key]: value } };
    });
  };

  const createValuation = (ticker: string) => {
    setFvParams((prev) => {
      if (prev[ticker]) return prev;
      return {
        ...prev,
        [ticker]: {
          growth: DEFAULT_GROWTH,
          terminalPE: DEFAULT_TERMINAL_PE,
          years: DEFAULT_YEARS,
        },
      };
    });
  };

  const updateValuationModel = (ticker: string, model: ValuationModel) => {
    setValuationModelByTicker((prev) => {
      if (model === DEFAULT_VALUATION_MODEL) {
        if (!(ticker in prev)) return prev;
        const next = { ...prev };
        delete next[ticker];
        return next;
      }

      if (prev[ticker] === model) return prev;
      return { ...prev, [ticker]: model };
    });
  };

  const updateManualMetricMap = (
    setter: (updater: (prev: Record<string, number>) => Record<string, number>) => void,
    ticker: string,
    value: number | null
  ) => {
    setter((prev) => {
      const next = { ...prev };
      if (value == null || !Number.isFinite(value)) {
        delete next[ticker];
      } else {
        next[ticker] = value;
      }
      return next;
    });
  };

  const updateManualMetric = (ticker: string, model: ValuationModel, value: number | null) => {
    if (model === "fcf_per_share") {
      updateManualMetricMap(setManualFcfPerShare, ticker, value);
      return;
    }

    if (model === "ps") {
      updateManualMetricMap(setManualRevenuePerShare, ticker, value);
      return;
    }

    updateManualMetricMap(setManualEps, ticker, value);
  };

  const rowInputs = useMemo<WatchlistComputedRow[]>(() => {
    return allTickers.map((ticker) => {
      const quote = quotes[ticker];
      const isCustom = !holdingSet.has(ticker);
      const params = fvParams[ticker] ?? null;
      const valuationModel = valuationModelByTicker[ticker] ?? DEFAULT_VALUATION_MODEL;
      const shares = quote?.trailingRevenueShares != null && quote.trailingRevenueShares > 0 ? quote.trailingRevenueShares : null;

      const autoFcfTotalBillions =
        quote?.trailingFcfPerShare != null && shares != null
          ? (quote.trailingFcfPerShare * shares) / BILLION
          : null;

      const autoRevenueTotalBillions =
        quote?.trailingTotalRevenue != null
          ? quote.trailingTotalRevenue / BILLION
          : null;

      const autoMetric =
        valuationModel === "fcf_per_share"
          ? resolveAnnualizedMetric(autoFcfTotalBillions)
          : valuationModel === "ps"
            ? resolveAnnualizedMetric(autoRevenueTotalBillions)
            : resolveAnnualizedMetric(quote?.trailingEps ?? null);

      const manualMetric =
        valuationModel === "fcf_per_share"
          ? (manualFcfPerShare[ticker] ?? null)
          : valuationModel === "ps"
            ? (manualRevenuePerShare[ticker] ?? null)
            : (manualEps[ticker] ?? null);

      const effectiveMetric = manualMetric ?? autoMetric;

      const effectiveMetricForValuation =
        valuationModel === "fcf_per_share" || valuationModel === "ps"
          ? effectiveMetric != null && shares != null
            ? (effectiveMetric * BILLION) / shares
            : null
          : effectiveMetric;

      const inferredMarketCap = quote?.price != null && shares != null ? quote.price * shares : null;

      const psTotalRevenue =
        valuationModel === "ps" && effectiveMetric != null
          ? effectiveMetric * BILLION
          : (quote?.trailingTotalRevenue ?? null);

      const psFromTotals =
        inferredMarketCap != null && psTotalRevenue != null && psTotalRevenue > 0
          ? inferredMarketCap / psTotalRevenue
          : null;

      const fcfTotal =
        valuationModel === "fcf_per_share" && effectiveMetric != null
          ? effectiveMetric * BILLION
          : null;

      const pfcfFromTotals =
        inferredMarketCap != null && fcfTotal != null && fcfTotal !== 0
          ? inferredMarketCap / fcfTotal
          : null;

      const currentRatio =
        valuationModel === "fcf_per_share"
          ? pfcfFromTotals
          : valuationModel === "ps"
            ? psFromTotals
            : calcCurrentMultiple(quote?.price ?? null, effectiveMetric) ??
            (valuationModel === "pe" ? (quote?.trailingPE ?? null) : null);

      const futurePrice = params ? calcFuturePrice(effectiveMetricForValuation, params) : null;
      const fairPrice = params ? calcFairPrice(futurePrice, targetReturn, params.years) : null;
      const impliedReturn = params ? calcImpliedReturn(quote?.price ?? null, futurePrice, params.years) : null;

      return {
        ticker,
        name: quote?.name || ticker,
        price: quote?.price ?? null,
        currency: quote?.currency || "EUR",
        changePercent: quote?.changePercent ?? null,
        impliedReturn,
        fairPrice,
        isCustom,
        hasValuation: params != null,
        valuationModel,
        ratioLabel: currentRatioLabel(valuationModel),
        currentRatio,
        metricLabel: metricLabel(valuationModel),
        autoMetric,
        manualMetric,
        effectiveMetric,
        inferredMarketCap,
      };
    });
  }, [
    allTickers,
    quotes,
    holdingSet,
    fvParams,
    manualEps,
    manualFcfPerShare,
    manualRevenuePerShare,
    valuationModelByTicker,
    targetReturn,
  ]);

  const viewModel = useMemo(
    () =>
      buildWatchlistViewModel({
        rows: rowInputs,
        transactions: allTransactions,
        portfolios,
        assetsCache,
        sort: watchlistSort,
      }),
    [rowInputs, allTransactions, portfolios, assetsCache, watchlistSort]
  );

  useEffect(() => {
    if (viewModel.menuRows.length === 0) {
      hasAppliedDefaultSelectionRef.current = false;
      if (selectedTicker !== null) setSelectedTicker(null);
      return;
    }

    const firstTickerByCurrentSort = viewModel.menuRows[0].ticker;

    if (!hasAppliedDefaultSelectionRef.current) {
      if (isWatchlistLoading) return;
      hasAppliedDefaultSelectionRef.current = true;
      if (selectedTicker !== firstTickerByCurrentSort) {
        setSelectedTicker(firstTickerByCurrentSort);
      }
      return;
    }

    if (!selectedTicker || !viewModel.menuRows.some((row) => row.ticker === selectedTicker)) {
      setSelectedTicker(firstTickerByCurrentSort);
    }
  }, [viewModel.menuRows, selectedTicker, isWatchlistLoading]);

  useEffect(() => {
    saveSelectedTicker(selectedTicker);
  }, [selectedTicker]);

  const selectedRow = useMemo(
    () => viewModel.menuRows.find((row) => row.ticker === selectedTicker) || null,
    [viewModel.menuRows, selectedTicker]
  );

  const selectedDetail = selectedRow ? viewModel.detailsByTicker[selectedRow.ticker] : null;

  const allTickersSet = useMemo(() => new Set(allTickers), [allTickers]);

  const valuedCount = useMemo(
    () => allTickers.reduce((count, ticker) => count + (fvParams[ticker] ? 1 : 0), 0),
    [allTickers, fvParams]
  );

  const loading = isWatchlistLoading;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col min-h-screen w-full">
        <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3 md:px-6">
          <SidebarTrigger />
          <Eye className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold tracking-tight">Watchlist</h1>
          <span className="ml-auto text-xs text-muted-foreground sm:text-sm">
            {allTickers.length} titre{allTickers.length > 1 ? "s" : ""} · {valuedCount} valorisé{valuedCount > 1 ? "s" : ""}
          </span>
        </header>

        <main className="flex-1 p-4 md:p-6">
          <div className="space-y-4 lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-4 lg:space-y-0">
            <WatchlistTickerMenu
              rows={viewModel.menuRows}
              selectedTicker={selectedTicker}
              onSelectTicker={setSelectedTicker}
              onRemoveTicker={removeTicker}
              sort={watchlistSort}
              onSortChange={setWatchlistSort}
              loading={loading}
              searchSlot={<TickerSearchBar onAdd={addTicker} existingTickers={allTickersSet} />}
            />

            <div className="space-y-4 min-w-0">
              {!selectedRow || !selectedDetail ? (
                <div className="rounded-xl border border-border/60 bg-card px-4 py-16 text-center text-sm text-muted-foreground">
                  Aucun titre sélectionné.
                </div>
              ) : (
                <>
                  <WatchlistTickerHeader row={selectedRow} />
                  <WatchlistPricePanel
                    ticker={selectedRow.ticker}
                    currency={selectedRow.currency}
                    pru={selectedDetail.pru}
                    fairPrice={selectedRow.fairPrice}
                    operations={selectedDetail.operationMarkers}
                  />

                  <div className="grid gap-4 min-w-0 xl:grid-cols-2 xl:items-start">
                    <div className="space-y-4 min-w-0">
                      <WatchlistValuationCard
                        ticker={selectedRow.ticker}
                        currency={selectedRow.currency}
                        valuationModel={selectedRow.valuationModel}
                        autoMetric={selectedRow.autoMetric}
                        manualMetric={selectedRow.manualMetric}
                        params={fvParams[selectedRow.ticker] ?? null}
                        targetReturn={targetReturn}
                        fairPrice={selectedRow.fairPrice}
                        impliedReturn={selectedRow.impliedReturn}
                        onCreateValuation={() => createValuation(selectedRow.ticker)}
                        onValuationModelChange={(value) => updateValuationModel(selectedRow.ticker, value)}
                        onManualMetricChange={(value) => updateManualMetric(selectedRow.ticker, selectedRow.valuationModel, value)}
                        onUpdateParam={(key, value) => updateFVParam(selectedRow.ticker, key, value)}
                        onTargetReturnChange={setTargetReturn}
                      />

                      <WatchlistInfoCard detail={selectedDetail} />
                    </div>

                    <div className="min-w-0">
                      <WatchlistValuationRatiosCard ticker={selectedRow.ticker} />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
