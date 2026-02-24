import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AssetPosition } from "@/lib/calculations";
import { AssetCache } from "@/hooks/usePortfolios";
import { formatPercent, formatCurrency, isMarketCurrentlyOpen } from "@/lib/calculations";
import { ArrowUp, ArrowDown, TrendingUp } from "lucide-react";
import { TickerLogo } from "@/components/TickerLogo";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StockMiniChart } from "@/components/StockMiniChart";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";

interface Props {
    positions: AssetPosition[];
    assetsCache: AssetCache[];
    liveChangeMap?: Record<string, number>;
}

interface AssetVariation {
    ticker: string;
    name: string;
    changePercent: number;
    currentPrice: number;
    valueVariation: number;
    currency: string;
    isMarketOpen: boolean;
}

export function TopMovers({ positions, assetsCache, liveChangeMap = {} }: Props) {
    const variations: AssetVariation[] = positions
        .filter(p => p.quantity > 0)
        .map(p => {
            const asset = assetsCache.find(a => a.ticker === p.ticker);
            if (!asset || !asset.last_price || !asset.previous_close) return null;

            // Priority: Live Change from Yahoo if available (most accurate)
            // Fallback: Calculate from price/prevClose (which might be updated via effectiveAssetsCache)
            let change = 0;
            if (liveChangeMap[p.ticker] != null) {
                change = liveChangeMap[p.ticker];
            } else {
                change = ((asset.last_price - asset.previous_close) / asset.previous_close) * 100;
            }

            const valueVariation = asset.last_price - asset.previous_close;

            return {
                ticker: p.ticker,
                name: asset.name || p.ticker,
                changePercent: change,
                currentPrice: asset.last_price,
                valueVariation,
                currency: p.currency,
                isMarketOpen: isMarketCurrentlyOpen(p.ticker)
            };
        })
        .filter((v): v is AssetVariation => v !== null)
        .sort((a, b) => b.changePercent - a.changePercent);

    const MoverRow = ({ item }: { item: AssetVariation }) => (
        <Popover>
            <PopoverTrigger asChild>
                <div className="flex items-center justify-between py-3 hover:bg-zinc-900/50 transition-colors px-2 rounded-md group cursor-pointer">
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <TickerLogo ticker={item.ticker} className="w-8 h-8 rounded-full" />
                            <span className={`absolute -bottom-0.5 -right-0.5 block h-2.5 w-2.5 rounded-full ring-2 ring-background ${item.isMarketOpen ? "bg-emerald-500" : "bg-zinc-600"}`} title={item.isMarketOpen ? "Marché Ouvert" : "Marché Fermé"}>
                                {item.isMarketOpen && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping"></span>}
                            </span>
                        </div>
                        <div className="flex flex-col min-w-0 pr-2">
                            <span className="font-semibold text-sm truncate max-w-[140px] tracking-tight">{item.name}</span>
                            <div className="flex items-baseline gap-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
                                <span>{item.ticker}</span>
                                <span className="text-zinc-600">•</span>
                                <span className="text-xs font-semibold text-zinc-300">{formatCurrency(item.currentPrice, item.currency)}</span>
                            </div>
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
            </PopoverTrigger>
            <PopoverContent
                side="left"
                align="start"
                className="w-auto p-3 sm:p-4"
                sideOffset={8}
                collisionPadding={12}
            >
                <StockMiniChart
                    ticker={item.ticker}
                    name={item.name}
                    currency={item.currency}
                    currentPrice={item.currentPrice}
                />
            </PopoverContent>
        </Popover>
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
        </Card>
    );
}
