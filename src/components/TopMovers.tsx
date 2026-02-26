import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AssetPosition } from "@/lib/calculations";
import { AssetCache } from "@/hooks/usePortfolios";
import { formatPercent, formatCurrency, isMarketCurrentlyOpen } from "@/lib/calculations";
import { ArrowUp, ArrowDown, TrendingUp } from "lucide-react";
import { TickerLogo } from "@/components/TickerLogo";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TickerChartPopup } from "@/components/TickerChartPopup";

interface Props {
    positions: AssetPosition[];
    assetsCache: AssetCache[];
    liveChangeMap?: Record<string, number>;
    liveMarketQuoteMap?: Record<string, {
        marketState: string | null;
        preMarketPrice: number | null;
        postMarketPrice: number | null;
    }>;
}

interface AssetVariation {
    ticker: string;
    name: string;
    changePercent: number;
    currentPrice: number;
    closePrice: number;
    previousClose: number;
    valueVariation: number;
    currency: string;
    marketIndicatorLabel: string;
    marketIndicatorClass: string;
    marketIndicatorPulseClass: string | null;
    isMarketOpen: boolean;
    sessionPhase: "pre" | "post" | null;
    sessionChangePercent: number;
    sessionChangeValue: number;
    sessionPrice: number | null;
}

function normalizeMarketState(marketState: string | null | undefined): string {
    return (marketState ?? "").toUpperCase();
}

function resolveMarketIndicator(ticker: string, marketState: string | null | undefined) {
    const state = normalizeMarketState(marketState);

    if (state === "REGULAR" || state === "OPEN") {
        return {
            phase: "open" as const,
            label: "Marché ouvert",
            className: "bg-emerald-500",
            pulseClass: "bg-emerald-400",
        };
    }

    if (["PRE", "PREPRE", "PREMARKET"].includes(state)) {
        return {
            phase: "pre" as const,
            label: "Pré-marché",
            className: "bg-yellow-400",
            pulseClass: null,
        };
    }

    if (["POST", "POSTPOST", "POSTMARKET", "AFTER_HOURS", "AFTERHOURS"].includes(state)) {
        return {
            phase: "post" as const,
            label: "Post-marché",
            className: "bg-blue-500",
            pulseClass: null,
        };
    }

    if (state === "CLOSED") {
        return {
            phase: "closed" as const,
            label: "Marché fermé",
            className: "bg-zinc-500",
            pulseClass: null,
        };
    }

    const isOpen = isMarketCurrentlyOpen(ticker);
    return {
        phase: isOpen ? "open" as const : "closed" as const,
        label: isOpen ? "Marché ouvert" : "Marché fermé",
        className: isOpen ? "bg-emerald-500" : "bg-zinc-500",
        pulseClass: isOpen ? "bg-emerald-400" : null,
    };
}

function resolveCurrentPrice(
    regularPrice: number,
    marketState: string | null | undefined,
    preMarketPrice: number | null,
    postMarketPrice: number | null
): number {
    const state = normalizeMarketState(marketState);
    if (["PRE", "PREPRE", "PREMARKET"].includes(state) && preMarketPrice != null) return preMarketPrice;
    if (["POST", "POSTPOST", "POSTMARKET", "AFTER_HOURS", "AFTERHOURS"].includes(state) && postMarketPrice != null) return postMarketPrice;
    if (state === "CLOSED" && postMarketPrice != null) return postMarketPrice;
    return regularPrice;
}

export function TopMovers({ positions, assetsCache, liveChangeMap = {}, liveMarketQuoteMap = {} }: Props) {
    const [selectedTicker, setSelectedTicker] = useState<AssetVariation | null>(null);

    const variations: AssetVariation[] = positions
        .filter(p => p.quantity > 0)
        .map(p => {
            const asset = assetsCache.find(a => a.ticker === p.ticker);
            if (!asset || asset.last_price == null || asset.previous_close == null) return null;

            const marketQuote = liveMarketQuoteMap[p.ticker];
            const preMarketPrice = marketQuote?.preMarketPrice ?? null;
            const postMarketPrice = marketQuote?.postMarketPrice ?? null;
            const marketState = marketQuote?.marketState ?? null;
            const regularPrice = asset.last_price;
            const currentPrice = resolveCurrentPrice(regularPrice, marketState, preMarketPrice, postMarketPrice);

            // Daily change is based on regular close vs previous close only (not pre/post market)
            let change = 0;
            if (asset.previous_close !== 0) {
                change = ((regularPrice - asset.previous_close) / asset.previous_close) * 100;
            } else if (liveChangeMap[p.ticker] != null) {
                change = liveChangeMap[p.ticker];
            }

            const valueVariation = regularPrice - asset.previous_close;
            const indicator = resolveMarketIndicator(p.ticker, marketState);
            const isMarketOpen = indicator.phase === "open" || isMarketCurrentlyOpen(p.ticker);
            const sessionPrice =
                isMarketOpen
                    ? null
                    : postMarketPrice != null
                        ? postMarketPrice
                        : indicator.phase === "pre" && preMarketPrice != null
                            ? preMarketPrice
                            : null;
            const sessionPhase =
                sessionPrice == null
                    ? null
                    : postMarketPrice != null
                        ? "post"
                        : "pre";
            const sessionChangeValue = sessionPrice != null ? sessionPrice - asset.last_price : 0;
            const sessionChangePercent = asset.last_price !== 0 && sessionPrice != null
                ? (sessionChangeValue / asset.last_price) * 100
                : 0;

            return {
                ticker: p.ticker,
                name: asset.name || p.ticker,
                changePercent: change,
                currentPrice,
                closePrice: asset.last_price,
                previousClose: asset.previous_close,
                valueVariation,
                currency: p.currency,
                marketIndicatorLabel: indicator.label,
                marketIndicatorClass: indicator.className,
                marketIndicatorPulseClass: indicator.pulseClass,
                isMarketOpen,
                sessionPhase,
                sessionChangePercent,
                sessionChangeValue,
                sessionPrice,
            };
        })
        .filter((v): v is AssetVariation => v !== null)
        .sort((a, b) => b.changePercent - a.changePercent);

    const MoverRow = ({ item }: { item: AssetVariation }) => (
        <div className="flex items-center justify-between py-3 hover:bg-zinc-900/50 transition-colors px-2 rounded-md group cursor-pointer" onClick={() => setSelectedTicker(item)}>
            <div className="flex items-center gap-3">
                <div className="relative">
                    <TickerLogo ticker={item.ticker} className="w-8 h-8 rounded-full" />
                    <span className={`absolute -bottom-0.5 -right-0.5 block h-2.5 w-2.5 rounded-full ring-2 ring-background ${item.marketIndicatorClass}`} title={item.marketIndicatorLabel}>
                        {item.marketIndicatorPulseClass && <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping ${item.marketIndicatorPulseClass}`}></span>}
                    </span>
                </div>
                <div className="flex flex-col min-w-0 pr-2">
                    <span className="font-semibold text-sm truncate max-w-[140px] tracking-tight">{item.name}</span>
                    <div className="flex items-baseline gap-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
                        <span>{item.ticker}</span>
                        <span className="text-zinc-600">•</span>
                        {item.isMarketOpen ? (
                            <span className="text-xs font-semibold text-zinc-300">{formatCurrency(item.currentPrice, item.currency)}</span>
                        ) : (
                            <>
                                <span className="text-xs font-semibold text-zinc-300">{formatCurrency(item.closePrice, item.currency)}</span>
                            </>
                        )}
                    </div>
                    {!item.isMarketOpen && item.sessionPhase && item.sessionPrice != null && (
                        <div className="flex items-baseline gap-2 text-[11px] tabular-nums">
                            <span className={`font-medium ${item.sessionPhase === "pre" ? "text-yellow-300/90" : "text-blue-300/90"}`}>
                                {formatCurrency(item.sessionPrice, item.currency)}
                            </span>
                            <span className={item.sessionChangePercent >= 0 ? "text-emerald-500/80" : "text-rose-500/80"}>
                                ({item.sessionChangeValue > 0 ? "+" : ""}{formatCurrency(item.sessionChangeValue, item.currency)} · {formatPercent(item.sessionChangePercent)})
                            </span>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex flex-col items-end gap-0.5">
                <div className={`flex items-center gap-1 text-sm font-bold tabular-nums tracking-tight ${item.changePercent >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                    {item.changePercent >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                    {formatPercent(item.changePercent)}
                </div>
                <div className={`text-[10px] font-medium tabular-nums ${item.changePercent >= 0 ? "text-emerald-500/70" : "text-rose-500/70"}`}>
                    {item.valueVariation > 0 ? "+" : ""}{formatCurrency(item.valueVariation, item.currency)}
                </div>
            </div>
        </div>
    );

    return (
        <Card className="border-0 bg-transparent shadow-none">
            <CardHeader className="py-2 px-2 pb-4">
                <CardTitle className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-[0.2em] flex items-center gap-2">
                    <TrendingUp className="h-3 w-3" />
                    Variations du jour
                </CardTitle>
            </CardHeader>
            <CardContent className="py-0 px-0">
                {variations.length > 0 ? (
                    <ScrollArea className="h-[500px] pr-2">
                        <div className="space-y-1">
                            {variations.map(v => <MoverRow key={v.ticker} item={v} />)}
                        </div>
                    </ScrollArea>
                ) : (
                    <div className="text-xs text-muted-foreground p-8 text-center bg-zinc-900/20 rounded-xl border border-white/5">
                        Aucune variation disponible
                    </div>
                )}
            </CardContent>

            <TickerChartPopup
                open={!!selectedTicker}
                onOpenChange={(open) => { if (!open) setSelectedTicker(null); }}
                tickerInfo={selectedTicker ? {
                    ticker: selectedTicker.ticker,
                    name: selectedTicker.name,
                    currentPrice: selectedTicker.currentPrice,
                    changePercent: selectedTicker.changePercent,
                    currency: selectedTicker.currency,
                    previousClose: selectedTicker.previousClose,
                } : null}
            />
        </Card>
    );
}
