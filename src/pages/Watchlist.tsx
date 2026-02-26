import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useTransactions } from "@/hooks/usePortfolios";
import { useQuery } from "@tanstack/react-query";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { TickerLogo } from "@/components/TickerLogo";
import { Eye, Search, X, Plus, Briefcase } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fetchPricesClientSide } from "@/lib/yahooFinance";

// ─── Types ───────────────────────────────────────────────────────────

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

interface FairValueParams {
  growth: number; // estimated metric CAGR in % (e.g. 15 = 15%/an)
  terminalPE: number; // target exit multiple
  years: number; // projection horizon in years
}

interface YFinanceData {
  trailingPE: number | null;
  trailingEps: number | null;
  trailingFcfPerShare: number | null;
  trailingRevenuePerShare: number | null;
  trailingTotalRevenue: number | null;
  trailingRevenueShares: number | null;
}

type ImpliedReturnSort = "none" | "desc" | "asc";
type ValuationModel = "pe" | "fcf_per_share" | "ps";

// ─── Constants ───────────────────────────────────────────────────────

const STORAGE_KEY = "watchlist-custom-tickers";
const HIDDEN_KEY = "watchlist-hidden-tickers";
const FV_PARAMS_KEY = "watchlist-fv-params";
const TARGET_RETURN_KEY = "watchlist-target-return";
const MANUAL_EPS_KEY = "watchlist-manual-eps";
const MANUAL_FCF_PER_SHARE_KEY = "watchlist-manual-fcf-per-share";
const MANUAL_REVENUE_PER_SHARE_KEY = "watchlist-manual-revenue-per-share";
const VALUATION_MODEL_KEY = "watchlist-valuation-model";
const WATCHLIST_META_TICKER = "__WATCHLIST_SETTINGS__";
const DEFAULT_GROWTH = 10;
const DEFAULT_TERMINAL_PE = 20;
const DEFAULT_YEARS = 5;
const DEFAULT_TARGET_RETURN = 10;
const DEFAULT_VALUATION_MODEL: ValuationModel = "pe";
const BILLION = 1_000_000_000;
const COLOR_NEUTRAL = "text-foreground/85";
const COLOR_SUBTLE = "text-foreground/70";
const COLOR_POSITIVE = "text-emerald-400";
const COLOR_NEGATIVE = "text-rose-400";
const COLOR_WARNING = "text-amber-300";

interface WatchlistTickerMeta {
  custom?: boolean;
  hidden?: boolean;
  manualEps?: boolean;
  valuationModel?: ValuationModel;
  manualFcfPerShare?: number;
  manualRevenuePerShare?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────

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
    // Ignore local storage write errors (private mode, quota, etc.)
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
    // Ignore local storage write errors (private mode, quota, etc.)
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
    // Ignore local storage write errors (private mode, quota, etc.)
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
    // Ignore local storage write errors (private mode, quota, etc.)
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
    // Ignore local storage write errors (private mode, quota, etc.)
  }
}

function loadValuationModels(): Record<string, ValuationModel> {
  try {
    const raw = localStorage.getItem(VALUATION_MODEL_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};

    const out: Record<string, ValuationModel> = {};
    for (const [ticker, value] of Object.entries(parsed as Record<string, unknown>)) {
      const model = parseValuationModel(value);
      if (model) out[ticker] = model;
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
    // Ignore local storage write errors (private mode, quota, etc.)
  }
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

function parseValuationModel(value: unknown): ValuationModel | null {
  if (value === "pfcf") return "fcf_per_share";
  if (value === "pe" || value === "fcf_per_share" || value === "ps") return value;
  return null;
}

function metricLabel(model: ValuationModel): string {
  if (model === "fcf_per_share") return "FCF ann. (Md)";
  if (model === "ps") return "Ventes ann./action";
  return "EPS ann.";
}

function currentRatioLabel(model: ValuationModel): string {
  if (model === "fcf_per_share") return "P/FCF";
  if (model === "ps") return "P/S";
  return "PER";
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

/** Metrique future = metrique actuelle × (1 + CAGR)^horizon */
function calcFutureMetric(
  metric: number | null,
  growth: number,
  years: number
): number | null {
  if (metric == null || years <= 0) return null;
  const g = growth / 100;
  if (g <= -1) return null;
  return metric * Math.pow(1 + g, years);
}

/** Multiple courant = Prix actuel / metrique annualisee */
function calcCurrentMultiple(
  price: number | null,
  metric: number | null
): number | null {
  if (price == null || metric == null || price <= 0 || metric === 0) return null;
  return price / metric;
}

/** Metrique annualisee: utilise la valeur TTM fournie par l'API. */
function resolveAnnualizedMetric(value: number | null): number | null {
  if (value != null && Number.isFinite(value)) {
    return value;
  }
  return null;
}

/** Prix futur = Metrique_future × multiple_cible */
function calcFuturePrice(
  metric: number | null,
  params: FairValueParams
): number | null {
  const futureMetric = calcFutureMetric(metric, params.growth, params.years);
  if (futureMetric == null || params.terminalPE <= 0) return null;
  return futureMetric * params.terminalPE;
}

/** Prix juste = Prix futur / (1 + rendement cible)^horizon */
function calcFairPrice(
  futurePrice: number | null,
  targetReturn: number,
  years: number
): number | null {
  if (futurePrice == null || futurePrice <= 0 || years <= 0) return null;
  const r = targetReturn / 100;
  if (r <= -1) return null;
  return futurePrice / Math.pow(1 + r, years);
}

/** Rendement implicite = (Prix futur / Prix actuel)^(1/horizon) - 1 */
function calcImpliedReturn(
  price: number | null,
  futurePrice: number | null,
  years: number
): number | null {
  if (price == null || futurePrice == null || price <= 0 || futurePrice <= 0 || years <= 0) return null;
  return (Math.pow(futurePrice / price, 1 / years) - 1) * 100;
}

// ─── API functions ───────────────────────────────────────────────────

/** Normalize fundamentals payload (supports both {ticker: data} and {results: {...}} shapes). */
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

/** Fetch fundamentals uniquement via backend API. */
async function fetchFundamentals(tickers: string[]): Promise<Record<string, YFinanceData>> {
  if (tickers.length === 0) return {};

  try {
    const { supabase } = await import("@/integrations/supabase/client");
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

/** Search tickers — via local yfinance in dev, Supabase Edge Function in prod */
async function searchTickers(query: string): Promise<SearchResult[]> {
  // DEV: use local Python server
  if (import.meta.env.DEV) {
    try {
      const resp = await fetch(`/api/yfinance/search?q=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(5000),
        headers: { Accept: "application/json" },
      });
      if (!resp.ok) return [];
      return await resp.json();
    } catch {
      return [];
    }
  }

  // PROD: use Supabase Edge Function
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data, error } = await supabase.functions.invoke("search-tickers", {
      body: { query },
    });
    if (error || !data?.results) return [];
    return data.results;
  } catch {
    return [];
  }
}

function formatCurrency(value: number | null, currency = "EUR"): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

// ─── Inline Editable Number ──────────────────────────────────────────

function InlineNum({
  value,
  onChange,
  suffix = "%",
  min = 0,
  max = 200,
}: {
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  min?: number;
  max?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(String(value));
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [editing, value]);

  const commit = () => {
    const n = parseFloat(draft);
    if (!isNaN(n) && n >= min && n <= max) {
      onChange(roundTo(n));
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-16 h-7 text-sm text-right bg-background border border-border/50 rounded px-1.5 tabular-nums outline-none focus:ring-1 focus:ring-primary"
        min={min}
        max={max}
        step="0.5"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="text-sm tabular-nums text-foreground/85 hover:text-foreground hover:bg-accent/60 px-2 py-1 rounded transition-colors cursor-pointer"
    >
      {roundTo(value)}{suffix}
    </button>
  );
}

function InlineMetric({
  autoValue,
  manualValue,
  onChange,
  label,
}: {
  autoValue: number | null;
  manualValue: number | null;
  onChange: (v: number | null) => void;
  label: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      const seed = manualValue ?? autoValue;
      setDraft(seed != null ? String(seed) : "");
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [editing, autoValue, manualValue]);

  const commit = () => {
    const normalized = draft.trim().replace(",", ".");
    if (normalized === "") {
      onChange(null);
      setEditing(false);
      return;
    }

    const n = Number(normalized);
    if (Number.isFinite(n) && n >= -10000 && n <= 10000) {
      onChange(n);
    }
    setEditing(false);
  };

  const displayed = manualValue ?? autoValue;

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-20 h-7 text-sm text-right bg-background border border-border/50 rounded px-1.5 tabular-nums outline-none focus:ring-1 focus:ring-primary"
        step="0.01"
      />
    );
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`text-sm tabular-nums px-2 py-1 rounded transition-colors cursor-pointer ${manualValue != null
            ? "text-amber-300 hover:text-amber-200 hover:bg-amber-500/10"
            : "text-foreground/85 hover:text-foreground hover:bg-accent/60"
          }`}
        title={manualValue != null ? `${label} manuel (cliquer pour modifier)` : `${label} auto (cliquer pour surcharger)`}
      >
        {displayed != null ? displayed.toFixed(2) : "—"}
      </button>
      {manualValue != null && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-[10px] uppercase tracking-wide text-foreground/70 hover:text-foreground px-1.5 py-0.5 rounded hover:bg-accent/60"
          title={`Revenir au ${label} automatique`}
        >
          auto
        </button>
      )}
    </div>
  );
}

function InlineModel({
  value,
  onChange,
}: {
  value: ValuationModel;
  onChange: (v: ValuationModel) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => {
        const next = parseValuationModel(e.target.value);
        if (next) onChange(next);
      }}
      className="h-7 rounded border border-border/60 bg-background px-2 text-xs text-foreground/85 outline-none focus:ring-1 focus:ring-primary"
    >
      <option value="pe">PER</option>
      <option value="fcf_per_share">P/FCF</option>
      <option value="ps">P/S</option>
    </select>
  );
}

// ─── Search Bar Component ────────────────────────────────────────────

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
    <div ref={containerRef} className="relative w-full max-w-sm">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          placeholder="Ajouter un titre (ex: AAPL, MC.PA…)"
          className="pl-9 pr-4 h-9 text-sm"
        />
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-md border bg-popover shadow-lg overflow-hidden">
          {searching ? (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
              Recherche…
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
              Aucun résultat
            </div>
          ) : (
            <ul className="max-h-64 overflow-y-auto py-1">
              {results.map((r) => {
                const already = existingTickers.has(r.symbol);
                return (
                  <li key={r.symbol}>
                    <button
                      type="button"
                      disabled={already}
                      onClick={() => handleSelect(r.symbol)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors
                        ${already ? "opacity-40 cursor-default" : "hover:bg-accent cursor-pointer"}`}
                    >
                      <TickerLogo ticker={r.symbol} className="h-6 w-6 shrink-0" />
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="font-medium truncate">{r.symbol}</span>
                        <span className="text-xs text-muted-foreground truncate">
                          {r.name}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {r.exchange}
                      </span>
                      {!already && (
                        <Plus className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
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

// ─── Main Component ──────────────────────────────────────────────────

export default function Watchlist() {
  const { data: allTransactions = [], isLoading: txLoading } = useTransactions();
  const [customTickers, setCustomTickers] = useState<string[]>(loadCustomTickers);
  const [hiddenTickers, setHiddenTickers] = useState<string[]>(loadHiddenTickers);
  const [fvParams, setFvParams] = useState<Record<string, FairValueParams>>(loadFVParams);
  const [targetReturn, setTargetReturn] = useState<number>(loadTargetReturn);
  const [manualEps, setManualEps] = useState<Record<string, number>>(loadManualEps);
  const [manualFcfPerShare, setManualFcfPerShare] = useState<Record<string, number>>(loadManualFcfPerShare);
  const [manualRevenuePerShare, setManualRevenuePerShare] = useState<Record<string, number>>(loadManualRevenuePerShare);
  const [valuationModelByTicker, setValuationModelByTicker] = useState<Record<string, ValuationModel>>(loadValuationModels);
  const [impliedSort, setImpliedSort] = useState<ImpliedReturnSort>("desc");
  const [cloudLoaded, setCloudLoaded] = useState(false);
  const cloudTickersRef = useRef<Set<string>>(new Set());

  // Load cloud state once at startup, while keeping local values for instant first paint.
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

        // Cloud data is authoritative when rows exist; otherwise keep local fallback.
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

  // Persist to local storage + cloud (debounced) whenever watchlist state changes.
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
        const trackedTickers = Array.from(new Set([
          ...customTickers,
          ...hiddenTickers,
          ...Object.keys(fvParams),
          ...Object.keys(manualEps),
          ...Object.keys(manualFcfPerShare),
          ...Object.keys(manualRevenuePerShare),
          ...Object.keys(valuationModelByTicker),
        ]));
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

  // Compute unique tickers with positive holdings (from portfolio)
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
      .filter(([, q]) => q > 0.0001)
      .map(([t]) => t)
      .sort();
  }, [allTransactions]);

  // Merge portfolio + custom tickers, deduplicated, minus hidden
  const hiddenSet = useMemo(() => new Set(hiddenTickers), [hiddenTickers]);

  const allTickers = useMemo(() => {
    const set = new Set(holdingTickers);
    for (const t of customTickers) set.add(t);
    for (const t of hiddenTickers) set.delete(t);
    return [...set].sort();
  }, [holdingTickers, customTickers, hiddenTickers]);

  const holdingSet = useMemo(() => new Set(holdingTickers), [holdingTickers]);

  // If a previously custom ticker becomes a holding, keep only holding semantics.
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

  const loading = txLoading || quotesLoading;

  const addTicker = (ticker: string) => {
    if (hiddenSet.has(ticker)) {
      const next = hiddenTickers.filter((t) => t !== ticker);
      setHiddenTickers(next);
      return;
    }
    if (!customTickers.includes(ticker) && !holdingTickers.includes(ticker)) {
      const next = [...customTickers, ticker];
      setCustomTickers(next);
    }
  };

  const removeTicker = (ticker: string) => {
    if (holdingSet.has(ticker)) {
      setCustomTickers((prev) => prev.filter((t) => t !== ticker));
      setHiddenTickers((prev) => (prev.includes(ticker) ? prev : [...prev, ticker]));
      return;
    }

    setCustomTickers((prev) => prev.filter((t) => t !== ticker));
    setHiddenTickers((prev) => prev.filter((t) => t !== ticker));
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

  const updateTargetReturn = (value: number) => {
    setTargetReturn(value);
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

  const toggleImpliedSort = () => {
    setImpliedSort((current) => {
      if (current === "none") return "desc";
      if (current === "desc") return "asc";
      return "none";
    });
  };

  const rows = useMemo(() => {
    const computedRows = allTickers.map((ticker) => {
      const q = quotes[ticker];
      const isCustom = !holdingSet.has(ticker);
      const params = fvParams[ticker] ?? null;
      const valuationModel = valuationModelByTicker[ticker] ?? DEFAULT_VALUATION_MODEL;
      const shares =
        q?.trailingRevenueShares != null && q.trailingRevenueShares > 0
          ? q.trailingRevenueShares
          : null;
      const autoFcfTotalBillions =
        q?.trailingFcfPerShare != null && shares != null
          ? (q.trailingFcfPerShare * shares) / BILLION
          : null;
      const autoMetric =
        valuationModel === "fcf_per_share"
          ? resolveAnnualizedMetric(autoFcfTotalBillions)
          : valuationModel === "ps"
            ? resolveAnnualizedMetric(q?.trailingRevenuePerShare ?? null)
            : resolveAnnualizedMetric(q?.trailingEps ?? null);
      const manualMetric =
        valuationModel === "fcf_per_share"
          ? (manualFcfPerShare[ticker] ?? null)
          : valuationModel === "ps"
            ? (manualRevenuePerShare[ticker] ?? null)
            : (manualEps[ticker] ?? null);
      const effectiveMetric = manualMetric ?? autoMetric;
      const effectiveMetricForValuation =
        valuationModel === "fcf_per_share"
          ? effectiveMetric != null && shares != null
            ? (effectiveMetric * BILLION) / shares
            : null
          : effectiveMetric;
      const inferredMarketCap =
        q?.price != null &&
          shares != null
          ? q.price * shares
          : null;
      const psFromTotals =
        inferredMarketCap != null &&
          q?.trailingTotalRevenue != null &&
          q.trailingTotalRevenue > 0
          ? inferredMarketCap / q.trailingTotalRevenue
          : null;
      const fcfTotal =
        valuationModel === "fcf_per_share" &&
          effectiveMetric != null
          ? effectiveMetric * BILLION
          : null;
      const pfcfFromTotals =
        inferredMarketCap != null &&
          fcfTotal != null &&
          fcfTotal !== 0
          ? inferredMarketCap / fcfTotal
          : null;
      const currentRatio =
        valuationModel === "fcf_per_share"
          ? pfcfFromTotals
          : valuationModel === "ps"
            ? psFromTotals
            : calcCurrentMultiple(q?.price ?? null, effectiveMetric) ??
            (valuationModel === "pe" ? (q?.trailingPE ?? null) : null);
      const futurePrice = params ? calcFuturePrice(effectiveMetricForValuation, params) : null;
      const fairPrice = params ? calcFairPrice(futurePrice, targetReturn, params.years) : null;
      const impliedReturn = params ? calcImpliedReturn(q?.price ?? null, futurePrice, params.years) : null;
      const changeColor =
        q?.changePercent != null
          ? q.changePercent > 0
            ? COLOR_POSITIVE
            : q.changePercent < 0
              ? COLOR_NEGATIVE
              : COLOR_NEUTRAL
          : COLOR_NEUTRAL;
      const returnColor =
        impliedReturn != null
          ? impliedReturn > 12
            ? COLOR_POSITIVE
            : impliedReturn > 8
              ? COLOR_WARNING
              : COLOR_NEGATIVE
          : COLOR_NEUTRAL;

      return {
        ticker,
        q,
        isCustom,
        params,
        hasValuation: params != null,
        valuationModel,
        ratioLabel: currentRatioLabel(valuationModel),
        metricLabel: metricLabel(valuationModel),
        autoMetric,
        manualMetric,
        currentRatio,
        fairPrice,
        impliedReturn,
        changeColor,
        returnColor,
      };
    });

    if (impliedSort === "none") return computedRows;

    return [...computedRows].sort((a, b) => {
      const av = a.impliedReturn;
      const bv = b.impliedReturn;

      if (av == null && bv == null) return a.ticker.localeCompare(b.ticker);
      if (av == null) return 1;
      if (bv == null) return -1;

      if (impliedSort === "desc") return bv - av;
      return av - bv;
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
    impliedSort,
  ]);

  const impliedSortLabel = impliedSort === "desc" ? "↓" : impliedSort === "asc" ? "↑" : "↕";
  const allTickersSet = useMemo(() => new Set(allTickers), [allTickers]);
  const valuedCount = useMemo(
    () => allTickers.reduce((count, ticker) => count + (fvParams[ticker] ? 1 : 0), 0),
    [allTickers, fvParams]
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col min-h-screen w-full">
        {/* Header */}
        <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3 md:px-6">
          <SidebarTrigger />
          <Eye className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold tracking-tight">Watchlist</h1>
          <span className="ml-auto text-xs text-muted-foreground sm:text-sm">
            {allTickers.length} titre{allTickers.length > 1 ? "s" : ""} · {valuedCount} valorisé{valuedCount > 1 ? "s" : ""}
          </span>
        </header>

        {/* Search bar */}
        <div className="px-4 py-3 md:px-6 border-b">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <TickerSearchBar onAdd={addTicker} existingTickers={allTickersSet} />
            <div className="w-full sm:w-auto">
              <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2">
                <span className="text-sm text-muted-foreground">Rendement cible</span>
                <InlineNum
                  value={targetReturn}
                  onChange={updateTargetReturn}
                  min={0}
                  max={80}
                />
              </div>
            </div>
          </div>
        </div>

        <main className="flex-1 p-4 md:p-6">
          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {loading && allTickers.length === 0 ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-xl border bg-card p-3 space-y-3">
                  <Skeleton className="h-5 w-28" />
                  <div className="grid grid-cols-2 gap-2">
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                  </div>
                  <Skeleton className="h-10 w-full" />
                </div>
              ))
            ) : allTickers.length === 0 ? (
              <div className="rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
                Aucun titre — utilisez la barre de recherche pour en ajouter
              </div>
            ) : (
              rows.map((row) => {
                const ticker = row.ticker;
                const q = row.q;
                const isCustom = row.isCustom;
                const params = row.params;
                const hasValuation = row.hasValuation;
                const valuationModel = row.valuationModel;
                const ratioLabelText = row.ratioLabel;
                const metricLabelText = row.metricLabel;
                const currentRatio = row.currentRatio;
                const fairPrice = row.fairPrice;
                const impliedReturn = row.impliedReturn;
                const changeColor = row.changeColor;
                const returnColor = row.returnColor;

                return (
                  <div key={ticker} className="rounded-xl border bg-card p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex items-start gap-2">
                        <TickerLogo ticker={ticker} className="h-7 w-7 shrink-0" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-sm">{ticker}</span>
                            {!isCustom && <Briefcase className="h-3 w-3 text-primary" />}
                            <span
                              className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${hasValuation
                                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                                  : "border-border/60 bg-muted/30 text-foreground/70"
                                }`}
                            >
                              {hasValuation ? "valorise" : "sans valo"}
                            </span>
                          </div>
                          {q?.name && (
                            <p className={`text-xs ${COLOR_SUBTLE} truncate max-w-[180px] mt-0.5`}>
                              {q.name}
                            </p>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeTicker(ticker)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="mt-3 flex items-center justify-between rounded-md border border-border/60 px-2.5 py-2">
                      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Modèle</span>
                      <InlineModel
                        value={valuationModel}
                        onChange={(v) => updateValuationModel(ticker, v)}
                      />
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className="rounded-md bg-muted/20 px-2.5 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Cours</p>
                        <div className="mt-1 tabular-nums text-sm text-foreground/90">
                          {quotesLoading && !q ? (
                            <Skeleton className="h-4 w-16" />
                          ) : (
                            formatCurrency(q?.price ?? null, q?.currency ?? "EUR")
                          )}
                        </div>
                      </div>
                      <div className="rounded-md bg-muted/20 px-2.5 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Var.</p>
                        <div className={`mt-1 tabular-nums text-sm ${changeColor}`}>
                          {quotesLoading && !q ? (
                            <Skeleton className="h-4 w-12" />
                          ) : q?.changePercent != null ? (
                            `${q.changePercent > 0 ? "+" : ""}${q.changePercent.toFixed(2)}%`
                          ) : (
                            "—"
                          )}
                        </div>
                      </div>
                      <div className="rounded-md bg-muted/20 px-2.5 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{ratioLabelText}</p>
                        <div className="mt-1 tabular-nums text-sm text-foreground/90">
                          {quotesLoading && !q ? (
                            <Skeleton className="h-4 w-10" />
                          ) : currentRatio != null ? (
                            currentRatio.toFixed(2)
                          ) : (
                            "—"
                          )}
                        </div>
                      </div>
                      <div className="rounded-md bg-muted/20 px-2.5 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Rdt. impl.</p>
                        <div className={`mt-1 tabular-nums text-sm font-semibold ${returnColor}`}>
                          {quotesLoading && !q ? (
                            <Skeleton className="h-4 w-12" />
                          ) : impliedReturn != null ? (
                            `${impliedReturn > 0 ? "+" : ""}${impliedReturn.toFixed(1)}%`
                          ) : (
                            "—"
                          )}
                        </div>
                      </div>
                      <div className="rounded-md bg-muted/20 px-2.5 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Prix juste</p>
                        <div className="mt-1 tabular-nums text-sm font-semibold text-foreground">
                          {quotesLoading && !q ? (
                            <Skeleton className="h-4 w-16" />
                          ) : fairPrice != null ? (
                            formatCurrency(fairPrice, q?.currency ?? "EUR")
                          ) : (
                            "—"
                          )}
                        </div>
                      </div>
                      <div className="rounded-md border border-border/60 px-2.5 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{metricLabelText}</p>
                        <div className="mt-1 flex justify-end">
                          {quotesLoading && !q ? (
                            <Skeleton className="h-4 w-12" />
                          ) : (
                            <InlineMetric
                              autoValue={row.autoMetric}
                              manualValue={row.manualMetric}
                              label={metricLabelText}
                              onChange={(v) => updateManualMetric(ticker, valuationModel, v)}
                            />
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 rounded-md border border-border/60 p-2.5">
                      {params ? (
                        <div className="grid grid-cols-3 gap-2">
                          <div className="flex flex-col items-center rounded bg-muted/20 px-2 py-1.5">
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Horizon</span>
                            <InlineNum
                              value={params.years}
                              onChange={(v) => updateFVParam(ticker, "years", v)}
                              suffix="a"
                              min={1}
                              max={30}
                            />
                          </div>
                          <div className="flex flex-col items-center rounded bg-muted/20 px-2 py-1.5">
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">CAGR</span>
                            <InlineNum
                              value={params.growth}
                              onChange={(v) => updateFVParam(ticker, "growth", v)}
                              min={-50}
                              max={200}
                            />
                          </div>
                          <div className="flex flex-col items-center rounded bg-muted/20 px-2 py-1.5">
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Multiple cible</span>
                            <InlineNum
                              value={params.terminalPE}
                              onChange={(v) => updateFVParam(ticker, "terminalPE", v)}
                              suffix="x"
                              min={1}
                              max={200}
                            />
                          </div>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 w-full text-xs"
                          onClick={() => createValuation(ticker)}
                        >
                          Valoriser ce titre
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block rounded-lg border bg-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Titre</TableHead>
                  <TableHead className="text-right">Cours</TableHead>
                  <TableHead className="text-right">Var.</TableHead>
                  <TableHead className="text-center">Modèle</TableHead>
                  <TableHead className="text-right">Ratio courant</TableHead>
                  <TableHead className="text-right border-r border-border/30">Métrique ann.</TableHead>
                  <TableHead className="text-center">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help border-b border-dashed border-muted-foreground">Horizon</span>
                      </TooltipTrigger>
                      <TooltipContent>Horizon d'investissement (années)</TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="text-center">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help border-b border-dashed border-muted-foreground">CAGR</span>
                      </TooltipTrigger>
                      <TooltipContent>Croissance de la métrique estimée (%/an)</TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="text-center">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help border-b border-dashed border-muted-foreground">Multiple cible</span>
                      </TooltipTrigger>
                      <TooltipContent>Multiple terminal de sortie</TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="text-right border-l border-border/30">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help border-b border-dashed border-muted-foreground">Prix juste</span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs">
                        Prix_futur / (1 + Rendement cible)^horizon
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="text-right">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={toggleImpliedSort}
                          className="inline-flex items-center gap-1 ml-auto hover:text-foreground text-muted-foreground"
                        >
                          <span className="cursor-help border-b border-dashed border-muted-foreground">Rdt. impl.</span>
                          <span className="text-xs">{impliedSortLabel}</span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Rendement annualisé implicite entre prix actuel et prix futur (cliquer pour trier)</TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="w-[40px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && allTickers.length === 0 ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-14 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-14 mx-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-12 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-12 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-10 mx-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-12 mx-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-12 mx-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-14 ml-auto" /></TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  ))
                ) : allTickers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center text-muted-foreground py-12">
                      Aucun titre — utilisez la barre de recherche pour en ajouter
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => {
                    const ticker = row.ticker;
                    const q = row.q;
                    const isCustom = row.isCustom;
                    const params = row.params;
                    const hasValuation = row.hasValuation;
                    const valuationModel = row.valuationModel;
                    const ratioLabelText = row.ratioLabel;
                    const metricLabelText = row.metricLabel;
                    const currentRatio = row.currentRatio;
                    const fairPrice = row.fairPrice;
                    const impliedReturn = row.impliedReturn;
                    const changeColor = row.changeColor;
                    const returnColor = row.returnColor;

                    return (
                      <TableRow key={ticker} className="group even:bg-muted/10 hover:bg-muted/20 transition-colors">
                        {/* Titre */}
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <TickerLogo ticker={ticker} className="h-6 w-6" />
                            <div className="flex flex-col">
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium text-sm">{ticker}</span>
                                {!isCustom && (
                                  <Briefcase className="h-3 w-3 text-primary" />
                                )}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span
                                      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${hasValuation
                                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                                          : "border-border/60 bg-muted/30 text-foreground/70"
                                        }`}
                                    >
                                      {hasValuation ? "valorise" : "sans valo"}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {hasValuation
                                      ? "Paramètres de valorisation définis"
                                      : "Aucune valorisation configurée"}
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                              {q?.name && (
                                <span className={`text-xs ${COLOR_SUBTLE} truncate max-w-[150px]`}>
                                  {q.name}
                                </span>
                              )}
                            </div>
                          </div>
                        </TableCell>

                        {/* Cours */}
                        <TableCell
                          className="text-right tabular-nums text-sm text-foreground/90"
                          title={ratioLabelText}
                        >
                          {quotesLoading && !q ? (
                            <Skeleton className="h-4 w-16 ml-auto" />
                          ) : (
                            formatCurrency(q?.price ?? null, q?.currency ?? "EUR")
                          )}
                        </TableCell>

                        {/* Variation */}
                        <TableCell className={`text-right tabular-nums text-sm ${changeColor}`}>
                          {quotesLoading && !q ? (
                            <Skeleton className="h-4 w-12 ml-auto" />
                          ) : q?.changePercent != null ? (
                            `${q.changePercent > 0 ? "+" : ""}${q.changePercent.toFixed(2)}%`
                          ) : (
                            "—"
                          )}
                        </TableCell>

                        {/* Modele */}
                        <TableCell className="text-center">
                          <InlineModel
                            value={valuationModel}
                            onChange={(v) => updateValuationModel(ticker, v)}
                          />
                        </TableCell>

                        {/* Ratio courant */}
                        <TableCell className="text-right tabular-nums text-sm text-foreground/90">
                          {quotesLoading && !q ? (
                            <Skeleton className="h-4 w-12 ml-auto" />
                          ) : currentRatio != null ? (
                            currentRatio.toFixed(2)
                          ) : (
                            "—"
                          )}
                        </TableCell>

                        {/* Metrique */}
                        <TableCell className="text-right tabular-nums text-sm text-foreground/90 border-r border-border/30">
                          {quotesLoading && !q ? (
                            <Skeleton className="h-4 w-12 ml-auto" />
                          ) : (
                            <InlineMetric
                              autoValue={row.autoMetric}
                              manualValue={row.manualMetric}
                              label={metricLabelText}
                              onChange={(v) => updateManualMetric(ticker, valuationModel, v)}
                            />
                          )}
                        </TableCell>

                        {/* Horizon */}
                        <TableCell className="text-center">
                          {params ? (
                            <InlineNum
                              value={params.years}
                              onChange={(v) => updateFVParam(ticker, "years", v)}
                              suffix="a"
                              min={1}
                              max={30}
                            />
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => createValuation(ticker)}
                            >
                              Valoriser
                            </Button>
                          )}
                        </TableCell>

                        {/* CAGR */}
                        <TableCell className="text-center">
                          {params ? (
                            <InlineNum
                              value={params.growth}
                              onChange={(v) => updateFVParam(ticker, "growth", v)}
                              min={-50}
                              max={200}
                            />
                          ) : (
                            <span className="text-sm text-foreground/60">—</span>
                          )}
                        </TableCell>

                        {/* Multiple cible */}
                        <TableCell className="text-center">
                          {params ? (
                            <InlineNum
                              value={params.terminalPE}
                              onChange={(v) => updateFVParam(ticker, "terminalPE", v)}
                              suffix="x"
                              min={1}
                              max={200}
                            />
                          ) : (
                            <span className="text-sm text-foreground/60">—</span>
                          )}
                        </TableCell>

                        {/* Prix juste */}
                        <TableCell className="text-right tabular-nums text-sm text-foreground font-semibold border-l border-border/30">
                          {quotesLoading && !q ? (
                            <Skeleton className="h-4 w-16 ml-auto" />
                          ) : fairPrice != null ? (
                            formatCurrency(fairPrice, q?.currency ?? "EUR")
                          ) : (
                            "—"
                          )}
                        </TableCell>

                        {/* Rendement implicite annualisé */}
                        <TableCell className={`text-right tabular-nums text-sm font-semibold ${returnColor}`}>
                          {quotesLoading && !q ? (
                            <Skeleton className="h-4 w-14 ml-auto" />
                          ) : impliedReturn != null ? (
                            `${impliedReturn > 0 ? "+" : ""}${impliedReturn.toFixed(1)}%`
                          ) : (
                            "—"
                          )}
                        </TableCell>

                        {/* Delete */}
                        <TableCell className="text-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                            onClick={() => removeTicker(ticker)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
