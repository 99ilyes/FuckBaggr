import { useState, useMemo } from "react";
import { useTransactions, usePortfolios, useAssetsCache } from "@/hooks/usePortfolios";
import {
    useWatchlistValuations,
    useUpsertValuation,
    useFundamentals,
    calculateFairPrice,
    TickerFundamentals,
    WatchlistValuation,
} from "@/hooks/useWatchlist";
import { TickerLogo } from "@/components/TickerLogo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Settings2, TrendingUp, TrendingDown, Minus, RefreshCw, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

// ETFs / ETCs to exclude from the watchlist
const EXCLUDED_TICKERS = new Set([
    "B28A.PA", "GOLD-EUR.PA",
]);
const ETF_NAME_PATTERNS = ["ishares", "amundi", "lyxor", "vanguard", "xtrackers", " etf", " etc"];

type SortKey = "ticker" | "price" | "eps" | "pe" | "fairPrice" | "upside";
type SortDir = "asc" | "desc";

function formatNum(v: number | null, decimals = 2): string {
    if (v == null) return "—";
    return v.toFixed(decimals);
}

function formatCurrency(v: number | null, currency = "EUR"): string {
    if (v == null) return "—";
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 2 }).format(v);
}

function UpsideBadge({ upside }: { upside: number | null }) {
    if (upside == null) return <span className="text-muted-foreground">—</span>;
    const isGood = upside > 20;
    const isNeutral = upside >= 0 && upside <= 20;
    const isBad = upside < 0;

    let colorClass = "text-muted-foreground";
    let bgClass = "";
    let Icon = Minus;
    if (isGood) { colorClass = "text-emerald-400"; bgClass = "bg-emerald-500/15"; Icon = TrendingUp; }
    else if (isBad) { colorClass = "text-rose-400"; bgClass = "bg-rose-500/15"; Icon = TrendingDown; }
    else if (isNeutral) { colorClass = "text-amber-400"; bgClass = "bg-amber-500/15"; Icon = Minus; }

    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-semibold text-xs ${colorClass} ${bgClass}`}>
            <Icon className="h-3 w-3" />
            {upside > 0 ? "+" : ""}{upside.toFixed(1)}%
        </span>
    );
}

function SortableHead({ label, sortKey, currentKey, dir, onSort, className }: {
    label: string; sortKey: SortKey; currentKey: SortKey | null; dir: SortDir; onSort: (k: SortKey) => void; className?: string;
}) {
    const active = currentKey === sortKey;
    return (
        <TableHead className={`cursor-pointer select-none hover:text-foreground transition-colors ${className || ""}`} onClick={() => onSort(sortKey)}>
            <span className="inline-flex items-center gap-1">
                {label}
                {active ? (dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-30" />}
            </span>
        </TableHead>
    );
}

interface ValuationFormProps {
    ticker: string;
    current: WatchlistValuation | undefined;
    onSave: (vals: { eps: number | null; eps_growth: number; terminal_pe: number; min_return: number; years: number }) => void;
}

function ValuationForm({ ticker, current, onSave }: ValuationFormProps) {
    const [eps, setEps] = useState<string>(current?.eps != null ? String(current.eps) : "");
    const [epsGrowth, setEpsGrowth] = useState((current?.eps_growth ?? 0.10) * 100);
    const [terminalPe, setTerminalPe] = useState(current?.terminal_pe ?? 15);
    const [minReturn, setMinReturn] = useState((current?.min_return ?? 0.12) * 100);
    const [years, setYears] = useState(current?.years ?? 5);

    const handleSave = () => {
        onSave({
            eps: eps.trim() !== "" ? parseFloat(eps) : null,
            eps_growth: epsGrowth / 100,
            terminal_pe: terminalPe,
            min_return: minReturn / 100,
            years,
        });
    };

    return (
        <div className="grid gap-3 min-w-[220px]">
            <p className="text-xs font-medium text-muted-foreground">Paramètres de valorisation — {ticker}</p>
            <div className="grid gap-1.5">
                <Label className="text-xs">EPS (TTM)</Label>
                <Input type="number" step="0.01" className="h-8 text-xs" placeholder="Ex: 5.20" value={eps} onChange={(e) => setEps(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
                <Label className="text-xs">Croissance EPS (%/an)</Label>
                <Input type="number" step="0.5" className="h-8 text-xs" value={epsGrowth} onChange={(e) => setEpsGrowth(parseFloat(e.target.value) || 0)} />
            </div>
            <div className="grid gap-1.5">
                <Label className="text-xs">P/E Terminal</Label>
                <Input type="number" step="0.5" className="h-8 text-xs" value={terminalPe} onChange={(e) => setTerminalPe(parseFloat(e.target.value) || 0)} />
            </div>
            <div className="grid gap-1.5">
                <Label className="text-xs">Rendement min. (%/an)</Label>
                <Input type="number" step="0.5" className="h-8 text-xs" value={minReturn} onChange={(e) => setMinReturn(parseFloat(e.target.value) || 0)} />
            </div>
            <div className="grid gap-1.5">
                <Label className="text-xs">Horizon (années)</Label>
                <Input type="number" step="1" min="1" max="30" className="h-8 text-xs" value={years} onChange={(e) => setYears(parseInt(e.target.value) || 5)} />
            </div>
            <Button size="sm" className="h-7 text-xs" onClick={handleSave}>Enregistrer</Button>
        </div>
    );
}

function isEtfOrEtc(ticker: string, name: string): boolean {
    if (EXCLUDED_TICKERS.has(ticker)) return true;
    const lowerName = name.toLowerCase();
    return ETF_NAME_PATTERNS.some((p) => lowerName.includes(p));
}

export default function Watchlist() {
    const { data: allTransactions = [] } = useTransactions();
    const { data: portfolios = [] } = usePortfolios();
    const { data: assetsCache = [] } = useAssetsCache();
    const { data: valuations = [] } = useWatchlistValuations();
    const upsertValuation = useUpsertValuation();

    const [sortKey, setSortKey] = useState<SortKey>("upside");
    const [sortDir, setSortDir] = useState<SortDir>("desc");

    // Get unique tickers currently held
    const heldTickers = useMemo(() => {
        const qtyMap = new Map<string, number>();
        allTransactions.forEach((t) => {
            if (!t.ticker) return;
            const qty = qtyMap.get(t.ticker) || 0;
            const txQty = t.quantity || 0;
            if (t.type === "buy") qtyMap.set(t.ticker, qty + txQty);
            else if (t.type === "sell") qtyMap.set(t.ticker, qty - txQty);
        });
        return Array.from(qtyMap.entries())
            .filter(([, qty]) => qty > 0.0001)
            .map(([ticker]) => ticker)
            .filter((t) => !t.includes("=X"))
            .sort();
    }, [allTransactions]);

    // Fetch fundamentals for held tickers
    const { data: fundamentals = {}, isLoading: loadingFundamentals, refetch: refetchFundamentals } = useFundamentals(heldTickers);

    // Build valuation map
    const valMap = useMemo(() => {
        const map = new Map<string, WatchlistValuation>();
        valuations.forEach((v) => map.set(v.ticker, v));
        return map;
    }, [valuations]);

    // Build asset cache map for fallback price/name
    const cacheMap = useMemo(() => {
        const map = new Map<string, { name: string | null; last_price: number | null; currency: string | null }>();
        assetsCache.forEach((a) => map.set(a.ticker, { name: a.name, last_price: a.last_price, currency: a.currency }));
        return map;
    }, [assetsCache]);

    // Build portfolio map for ticker
    const tickerPortfolios = useMemo(() => {
        const portfolioNameMap = new Map<string, string>();
        portfolios.forEach((p) => portfolioNameMap.set(p.id, p.name));

        const map = new Map<string, Set<string>>();
        const portfolioTickers = new Map<string, Map<string, number>>();
        allTransactions.forEach((t) => {
            if (!t.ticker || !t.portfolio_id) return;
            if (!portfolioTickers.has(t.portfolio_id)) portfolioTickers.set(t.portfolio_id, new Map());
            const tickerMap = portfolioTickers.get(t.portfolio_id)!;
            const qty = tickerMap.get(t.ticker) || 0;
            const txQty = t.quantity || 0;
            if (t.type === "buy") tickerMap.set(t.ticker, qty + txQty);
            else if (t.type === "sell") tickerMap.set(t.ticker, qty - txQty);
        });
        portfolioTickers.forEach((tickerMap, portfolioId) => {
            const pName = portfolioNameMap.get(portfolioId) || portfolioId;
            tickerMap.forEach((qty, ticker) => {
                if (qty > 0.0001) {
                    if (!map.has(ticker)) map.set(ticker, new Set());
                    map.get(ticker)!.add(pName);
                }
            });
        });
        return map;
    }, [allTransactions, portfolios]);

    // Build rows — filter out ETFs/ETCs
    interface WatchlistRow {
        ticker: string;
        name: string;
        price: number | null;
        currency: string;
        eps: number | null; // user-provided
        pe: number | null; // from API (TTM)
        valuation: WatchlistValuation | undefined;
        fairPrice: number | null;
        upside: number | null;
        portfolios: Set<string> | undefined;
    }

    const rows: WatchlistRow[] = useMemo(() => {
        return heldTickers
            .map((ticker) => {
                const fund = fundamentals[ticker] as TickerFundamentals | undefined;
                const cache = cacheMap.get(ticker);
                const val = valMap.get(ticker);

                const price = fund?.currentPrice ?? cache?.last_price ?? null;
                const name = fund?.name ?? cache?.name ?? ticker;
                const currency = fund?.currency ?? cache?.currency ?? "EUR";
                const pe = fund?.trailingPE ?? null;

                // EPS is user-provided from valuations table
                const eps = val?.eps ?? null;

                let fairPrice: number | null = null;
                let upside: number | null = null;

                if (eps && eps > 0 && price && price > 0 && val) {
                    const result = calculateFairPrice(eps, price, val.eps_growth, val.terminal_pe, val.min_return, val.years);
                    fairPrice = result.fairPrice;
                    upside = result.upside;
                }

                return {
                    ticker,
                    name,
                    price,
                    currency,
                    eps,
                    pe,
                    valuation: val,
                    fairPrice,
                    upside,
                    portfolios: tickerPortfolios.get(ticker),
                };
            })
            .filter((row) => !isEtfOrEtc(row.ticker, row.name));
    }, [heldTickers, fundamentals, cacheMap, valMap, tickerPortfolios]);

    // Sort
    const handleSort = (key: SortKey) => {
        if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        else { setSortKey(key); setSortDir(key === "upside" ? "desc" : "asc"); }
    };

    const sortedRows = useMemo(() => {
        return [...rows].sort((a, b) => {
            const mul = sortDir === "asc" ? 1 : -1;
            switch (sortKey) {
                case "ticker": return mul * a.ticker.localeCompare(b.ticker);
                case "price": return mul * ((a.price ?? -999) - (b.price ?? -999));
                case "eps": return mul * ((a.eps ?? -999) - (b.eps ?? -999));
                case "pe": return mul * ((a.pe ?? 999) - (b.pe ?? 999));
                case "fairPrice": return mul * ((a.fairPrice ?? -999) - (b.fairPrice ?? -999));
                case "upside": return mul * ((a.upside ?? -999) - (b.upside ?? -999));
                default: return 0;
            }
        });
    }, [rows, sortKey, sortDir]);

    const handleSaveValuation = (ticker: string, vals: { eps: number | null; eps_growth: number; terminal_pe: number; min_return: number; years: number }) => {
        upsertValuation.mutate({ ticker, ...vals });
    };

    return (
        <div className="max-w-7xl mx-auto px-4 py-6 md:px-6 space-y-6">
            <Card className="border-border/50">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <div>
                        <CardTitle className="text-lg font-semibold">Watchlist — Fair Value</CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            {rows.length} actions en portefeuille • Cliquez sur ⚙ pour définir vos estimations
                        </p>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => refetchFundamentals()}
                        disabled={loadingFundamentals}
                    >
                        <RefreshCw className={`h-4 w-4 ${loadingFundamentals ? "animate-spin" : ""}`} />
                        <span className="hidden sm:inline ml-1">Actualiser</span>
                    </Button>
                </CardHeader>
                <CardContent>
                    {loadingFundamentals && rows.length === 0 ? (
                        <p className="text-muted-foreground text-sm text-center py-8">Chargement des données fondamentales...</p>
                    ) : rows.length === 0 ? (
                        <p className="text-muted-foreground text-sm text-center py-8">Aucun titre en portefeuille.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <SortableHead label="Ticker" sortKey="ticker" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                                        <TableHead>Portefeuille(s)</TableHead>
                                        <SortableHead label="Prix" sortKey="price" currentKey={sortKey} dir={sortDir} onSort={handleSort} className="text-right" />
                                        <SortableHead label="PER TTM" sortKey="pe" currentKey={sortKey} dir={sortDir} onSort={handleSort} className="text-right" />
                                        <TableHead className="text-center">Params</TableHead>
                                        <SortableHead label="Fair Price" sortKey="fairPrice" currentKey={sortKey} dir={sortDir} onSort={handleSort} className="text-right" />
                                        <SortableHead label="Upside" sortKey="upside" currentKey={sortKey} dir={sortDir} onSort={handleSort} className="text-center" />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sortedRows.map((row) => {
                                        const rowColorClass = row.upside != null
                                            ? row.upside > 20
                                                ? "bg-emerald-500/5"
                                                : row.upside < 0
                                                    ? "bg-rose-500/5"
                                                    : ""
                                            : "";

                                        return (
                                            <TableRow key={row.ticker} className={rowColorClass}>
                                                <TableCell>
                                                    <div className="flex items-center gap-2">
                                                        <TickerLogo ticker={row.ticker} />
                                                        <div>
                                                            <span className="font-medium text-sm">{row.ticker}</span>
                                                            <p className="text-[10px] text-muted-foreground leading-tight max-w-[180px] truncate">{row.name}</p>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-wrap gap-1">
                                                        {row.portfolios ? Array.from(row.portfolios).map((name) => (
                                                            <Badge key={name} variant="outline" className="text-[10px] px-1.5 py-0 font-normal">{name}</Badge>
                                                        )) : <span className="text-muted-foreground text-xs">—</span>}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right font-medium tabular-nums text-sm">
                                                    {formatCurrency(row.price, row.currency)}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums text-sm">
                                                    {formatNum(row.pe, 1)}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <Popover>
                                                        <PopoverTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className={`h-7 w-7 ${row.valuation ? "text-foreground" : "text-muted-foreground/40 hover:text-muted-foreground"}`}
                                                            >
                                                                <Settings2 className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </PopoverTrigger>
                                                        <PopoverContent side="left" className="w-auto p-3">
                                                            <ValuationForm
                                                                ticker={row.ticker}
                                                                current={row.valuation}
                                                                onSave={(vals) => handleSaveValuation(row.ticker, vals)}
                                                            />
                                                        </PopoverContent>
                                                    </Popover>
                                                    {row.valuation && (
                                                        <div className="text-[9px] text-muted-foreground leading-tight mt-0.5">
                                                            {row.eps != null ? `EPS ${row.eps}` : "EPS —"} • {(row.valuation.eps_growth * 100).toFixed(0)}% • PE {row.valuation.terminal_pe} • {row.valuation.years}a
                                                        </div>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right font-medium tabular-nums text-sm">
                                                    {row.fairPrice != null ? (
                                                        <span className={row.upside != null && row.upside > 0 ? "text-emerald-400" : row.upside != null && row.upside < 0 ? "text-rose-400" : ""}>
                                                            {formatCurrency(row.fairPrice, row.currency)}
                                                        </span>
                                                    ) : (
                                                        <span className="text-muted-foreground text-xs">Non défini</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <UpsideBadge upside={row.upside} />
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
