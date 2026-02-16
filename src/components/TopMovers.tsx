import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AssetPosition } from "@/lib/calculations";
import { AssetCache } from "@/hooks/usePortfolios";
import { formatPercent, formatCurrency } from "@/lib/calculations";
import { ArrowUp, ArrowDown, TrendingUp } from "lucide-react";
import { TickerLogo } from "@/components/TickerLogo";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Props {
    positions: AssetPosition[];
    assetsCache: AssetCache[];
}

interface AssetVariation {
    ticker: string;
    name: string;
    changePercent: number;
    currentPrice: number;
    valueVariation: number;
    currency: string;
}

export function TopMovers({ positions, assetsCache }: Props) {
    const variations: AssetVariation[] = positions
        .filter(p => p.quantity > 0)
        .map(p => {
            const asset = assetsCache.find(a => a.ticker === p.ticker);
            if (!asset || !asset.last_price || !asset.previous_close) return null;

            const change = ((asset.last_price - asset.previous_close) / asset.previous_close) * 100;
            const valueVariation = asset.last_price - asset.previous_close;

            return {
                ticker: p.ticker,
                name: asset.name || p.ticker,
                changePercent: change,
                currentPrice: asset.last_price,
                valueVariation,
                currency: p.currency
            };
        })
        .filter((v): v is AssetVariation => v !== null)
        .sort((a, b) => b.changePercent - a.changePercent);

    const MoverRow = ({ item }: { item: AssetVariation }) => (
        <div className="flex items-center justify-between py-3 border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors px-2 rounded-sm">
            <div className="flex items-center gap-3">
                <TickerLogo ticker={item.ticker} />
                <div className="flex flex-col min-w-0 pr-2">
                    <span className="font-medium text-sm truncate max-w-[120px]">{item.name}</span>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{item.ticker}</span>
                        <span>•</span>
                        <span>{formatCurrency(item.currentPrice, item.currency)}</span>
                    </div>
                </div>
            </div>

            <div className="flex flex-col items-end gap-0.5">
                <div className={`flex items-center gap-1 text-sm font-medium tabular-nums ${item.changePercent >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                    {item.changePercent >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                    {formatPercent(item.changePercent)}
                </div>
                <div className={`text-xs tabular-nums ${item.changePercent >= 0 ? "text-emerald-500/80" : "text-rose-500/80"}`}>
                    {item.valueVariation > 0 ? "+" : ""}{formatCurrency(item.valueVariation, item.currency)}
                </div>
            </div>
        </div>
    );

    return (
        <Card className="border-border/50">
            <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Variations du jour
                </CardTitle>
            </CardHeader>
            <CardContent className="py-0 px-2 pb-2">
                {variations.length > 0 ? (
                    <ScrollArea className="h-[400px]">
                        {variations.map(v => <MoverRow key={v.ticker} item={v} />)}
                    </ScrollArea>
                ) : (
                    <div className="text-xs text-muted-foreground p-4 text-center">Aucune variation disponible</div>
                )}
            </CardContent>
        </Card>
    );
}
