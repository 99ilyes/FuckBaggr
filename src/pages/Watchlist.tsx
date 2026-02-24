import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useTransactions } from "@/hooks/usePortfolios";
import { useQuery } from "@tanstack/react-query";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { TickerLogo } from "@/components/TickerLogo";
import { Eye, Search, X, Plus, Briefcase } from "lucide-react";
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

// ─── Types ───────────────────────────────────────────────────────────

interface TickerQuote {
  price: number | null;
  previousClose: number | null;
  name: string;
  currency: string;
  trailingPE: number | null;
  trailingEps: number | null;
  changePercent: number | null;
}

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

interface FairValueParams {
  growth: number; // estimated EPS CAGR in % (e.g. 15 = 15%/an)
  terminalPE: number; // target exit PE multiple
  years: number; // projection horizon in years
}

interface YFinanceData {
  trailingPE: number | null;
  trailingEps: number | null;
}

// ─── Constants ───────────────────────────────────────────────────────

const YAHOO_TIMEOUT = 6000;
const STORAGE_KEY = "watchlist-custom-tickers";
const HIDDEN_KEY = "watchlist-hidden-tickers";
const FV_PARAMS_KEY = "watchlist-fv-params";
const DEFAULT_GROWTH = 10;
const DEFAULT_TERMINAL_PE = 20;
const DEFAULT_YEARS = 5;

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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tickers));
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
  localStorage.setItem(HIDDEN_KEY, JSON.stringify(tickers));
}

function loadFVParams(): Record<string, FairValueParams> {
  try {
    const raw = localStorage.getItem(FV_PARAMS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveFVParams(params: Record<string, FairValueParams>) {
  localStorage.setItem(FV_PARAMS_KEY, JSON.stringify(params));
}

/** Fair Value = EPS × (1 + CAGR)^horizon × PER_terminal */
function calcFairValue(
  eps: number | null,
  params: FairValueParams
): number | null {
  if (eps == null || eps <= 0 || params.terminalPE <= 0) return null;
  const g = params.growth / 100;
  const n = params.years;
  const futureEps = eps * Math.pow(1 + g, n);
  return futureEps * params.terminalPE;
}

/** Implied annualized return = (fairValue / price)^(1/years) - 1 */
function calcImpliedReturn(
  price: number | null,
  fairValue: number | null,
  years: number
): number | null {
  if (price == null || fairValue == null || price <= 0 || fairValue <= 0 || years <= 0) return null;
  return (Math.pow(fairValue / price, 1 / years) - 1) * 100;
}

// ─── API functions ───────────────────────────────────────────────────

/** Fetch quote for a single ticker via Yahoo v8 */
async function fetchQuoteWithPE(ticker: string): Promise<TickerQuote | null> {
  try {
    const baseUrl = import.meta.env.DEV
      ? "/api/yf"
      : "https://query2.finance.yahoo.com";
    const url = `${baseUrl}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d&includePrePost=false`;

    const resp = await fetch(url, {
      signal: AbortSignal.timeout(YAHOO_TIMEOUT),
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) return null;

    const data = await resp.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;

    const price = meta.regularMarketPrice ?? null;
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
    const change = price != null && prevClose != null && prevClose !== 0
      ? ((price - prevClose) / prevClose) * 100
      : null;

    return {
      price,
      previousClose: prevClose,
      name: meta.longName ?? meta.shortName ?? meta.symbol ?? ticker,
      currency: meta.currency ?? "USD",
      trailingPE: null,
      trailingEps: null,
      changePercent: change,
    };
  } catch {
    return null;
  }
}

/** Fetch PE + EPS ratios — via local yfinance in dev, Supabase Edge Function in prod */
async function fetchFundamentals(tickers: string[]): Promise<Record<string, YFinanceData>> {
  // DEV: use local Python yfinance server
  if (import.meta.env.DEV) {
    try {
      const url = `/api/yfinance/pe?tickers=${tickers.map(encodeURIComponent).join(",")}`;
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: { Accept: "application/json" },
      });
      if (!resp.ok) return {};
      return await resp.json();
    } catch {
      console.warn("[Watchlist] yfinance fetch failed — is the Python server running? (npm run yfinance)");
      return {};
    }
  }

  // PROD: use Supabase Edge Function (fetch-prices with mode=fundamentals)
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data, error } = await supabase.functions.invoke("fetch-prices", {
      body: { tickers, mode: "fundamentals" },
    });
    if (error) {
      console.warn("[Watchlist] Edge Function fundamentals error:", error);
      return {};
    }
    return data ?? {};
  } catch (err) {
    console.warn("[Watchlist] Edge Function fundamentals failed:", err);
    return {};
  }
}

async function fetchAllQuotes(tickers: string[]): Promise<Record<string, TickerQuote>> {
  const results: Record<string, TickerQuote> = {};
  if (tickers.length === 0) return results;

  const [quotes, fundMap] = await Promise.all([
    Promise.all(tickers.map((t) => fetchQuoteWithPE(t).then((q) => [t, q] as const))),
    fetchFundamentals(tickers),
  ]);

  for (const [ticker, quote] of quotes) {
    if (quote) {
      const fund = fundMap[ticker];
      results[ticker] = {
        ...quote,
        trailingPE: fund?.trailingPE ?? null,
        trailingEps: fund?.trailingEps ?? null,
      };
    }
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
      onChange(n);
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
        className="w-16 h-6 text-xs text-right bg-background border border-border/50 rounded px-1.5 tabular-nums outline-none focus:ring-1 focus:ring-primary"
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
      className="text-xs tabular-nums text-muted-foreground hover:text-foreground hover:bg-accent/60 px-2 py-1 rounded transition-colors cursor-pointer"
    >
      {value}{suffix}
    </button>
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
      saveHiddenTickers(next);
      return;
    }
    if (!customTickers.includes(ticker) && !holdingTickers.includes(ticker)) {
      const next = [...customTickers, ticker];
      setCustomTickers(next);
      saveCustomTickers(next);
    }
  };

  const removeTicker = (ticker: string) => {
    if (customTickers.includes(ticker)) {
      const next = customTickers.filter((t) => t !== ticker);
      setCustomTickers(next);
      saveCustomTickers(next);
    } else {
      const next = [...hiddenTickers, ticker];
      setHiddenTickers(next);
      saveHiddenTickers(next);
    }
  };

  const getFVParams = (ticker: string): FairValueParams =>
    fvParams[ticker] ?? { growth: DEFAULT_GROWTH, terminalPE: DEFAULT_TERMINAL_PE, years: DEFAULT_YEARS };

  const updateFVParam = (ticker: string, key: keyof FairValueParams, value: number) => {
    const current = getFVParams(ticker);
    const next = { ...fvParams, [ticker]: { ...current, [key]: value } };
    setFvParams(next);
    saveFVParams(next);
  };

  const allTickersSet = useMemo(() => new Set(allTickers), [allTickers]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col min-h-screen w-full">
        {/* Header */}
        <header className="flex items-center gap-3 border-b px-4 py-3 md:px-6">
          <SidebarTrigger />
          <Eye className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold tracking-tight">Watchlist</h1>
          <span className="text-sm text-muted-foreground ml-auto">
            {allTickers.length} titre{allTickers.length > 1 ? "s" : ""}
          </span>
        </header>

        {/* Search bar */}
        <div className="px-4 py-3 md:px-6 border-b">
          <TickerSearchBar onAdd={addTicker} existingTickers={allTickersSet} />
        </div>

        {/* Table */}
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Titre</TableHead>
                  <TableHead className="text-right">Cours</TableHead>
                  <TableHead className="text-right">Var.</TableHead>
                  <TableHead className="text-right">PER</TableHead>
                  <TableHead className="text-right border-r border-border/30">EPS</TableHead>
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
                      <TooltipContent>Croissance BPA estimée (%/an)</TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="text-center">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help border-b border-dashed border-muted-foreground">PER cible</span>
                      </TooltipTrigger>
                      <TooltipContent>PER terminal de sortie</TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="text-right border-l border-border/30">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help border-b border-dashed border-muted-foreground">Prix juste</span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs">
                        EPS × (1 + CAGR)^horizon × PER cible
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="text-right">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help border-b border-dashed border-muted-foreground">Rdt. impl.</span>
                      </TooltipTrigger>
                      <TooltipContent>Rendement annualisé implicite si achat au cours actuel</TooltipContent>
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
                    <TableCell colSpan={11} className="text-center text-muted-foreground py-12">
                      Aucun titre — utilisez la barre de recherche pour en ajouter
                    </TableCell>
                  </TableRow>
                ) : (
                  allTickers.map((ticker) => {
                    const q = quotes[ticker];
                    const isCustom = !holdingSet.has(ticker);
                    const params = getFVParams(ticker);
                    const fairValue = calcFairValue(q?.trailingEps ?? null, params);
                    const impliedReturn = calcImpliedReturn(q?.price ?? null, fairValue, params.years);

                    const changeColor =
                      q?.changePercent != null
                        ? q.changePercent > 0
                          ? "text-emerald-500"
                          : q.changePercent < 0
                            ? "text-red-500"
                            : "text-muted-foreground"
                        : "text-muted-foreground";

                    const returnColor =
                      impliedReturn != null
                        ? impliedReturn > 15
                          ? "text-emerald-500"
                          : impliedReturn > 8
                            ? "text-amber-500"
                            : "text-red-500"
                        : "text-muted-foreground";

                    return (
                      <TableRow key={ticker} className="group">
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
                              </div>
                              {q?.name && (
                                <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                                  {q.name}
                                </span>
                              )}
                            </div>
                          </div>
                        </TableCell>

                        {/* Cours */}
                        <TableCell className="text-right tabular-nums">
                          {quotesLoading && !q ? (
                            <Skeleton className="h-4 w-16 ml-auto" />
                          ) : (
                            formatCurrency(q?.price ?? null, q?.currency ?? "EUR")
                          )}
                        </TableCell>

                        {/* Variation */}
                        <TableCell className={`text-right tabular-nums ${changeColor}`}>
                          {quotesLoading && !q ? (
                            <Skeleton className="h-4 w-12 ml-auto" />
                          ) : q?.changePercent != null ? (
                            `${q.changePercent > 0 ? "+" : ""}${q.changePercent.toFixed(2)}%`
                          ) : (
                            "—"
                          )}
                        </TableCell>

                        {/* PER */}
                        <TableCell className="text-right tabular-nums">
                          {quotesLoading && !q ? (
                            <Skeleton className="h-4 w-12 ml-auto" />
                          ) : q?.trailingPE != null ? (
                            q.trailingPE.toFixed(1)
                          ) : (
                            "—"
                          )}
                        </TableCell>

                        {/* EPS */}
                        <TableCell className="text-right tabular-nums border-r border-border/30">
                          {quotesLoading && !q ? (
                            <Skeleton className="h-4 w-12 ml-auto" />
                          ) : q?.trailingEps != null ? (
                            q.trailingEps.toFixed(2)
                          ) : (
                            "—"
                          )}
                        </TableCell>

                        {/* Horizon */}
                        <TableCell className="text-center">
                          <InlineNum
                            value={params.years}
                            onChange={(v) => updateFVParam(ticker, "years", v)}
                            suffix="a"
                            min={1}
                            max={30}
                          />
                        </TableCell>

                        {/* CAGR */}
                        <TableCell className="text-center">
                          <InlineNum
                            value={params.growth}
                            onChange={(v) => updateFVParam(ticker, "growth", v)}
                            min={-50}
                            max={200}
                          />
                        </TableCell>

                        {/* PER cible */}
                        <TableCell className="text-center">
                          <InlineNum
                            value={params.terminalPE}
                            onChange={(v) => updateFVParam(ticker, "terminalPE", v)}
                            suffix="x"
                            min={1}
                            max={200}
                          />
                        </TableCell>

                        {/* Prix juste */}
                        <TableCell className="text-right tabular-nums font-semibold border-l border-border/30">
                          {quotesLoading && !q ? (
                            <Skeleton className="h-4 w-16 ml-auto" />
                          ) : fairValue != null ? (
                            formatCurrency(fairValue, q?.currency ?? "EUR")
                          ) : (
                            "—"
                          )}
                        </TableCell>

                        {/* Rendement implicite annualisé */}
                        <TableCell className={`text-right tabular-nums font-semibold ${returnColor}`}>
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
