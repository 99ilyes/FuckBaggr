import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Wallet, BarChart3, Coins } from "lucide-react";
import { formatCurrency, formatPercent } from "@/lib/calculations";

interface KPICardsProps {
  totalValue: number;
  totalInvested: number;
  totalGainLoss: number;
  totalGainLossPercent: number;
  assetCount: number;
  cashBalance: number;
}

export function KPICards({
  totalValue,
  totalInvested,
  totalGainLoss,
  totalGainLossPercent,
  assetCount,
  cashBalance,
}: KPICardsProps) {
  const isPositive = totalGainLoss >= 0;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:gap-4">
      <Card className="border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Wallet className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">Valeur totale</span>
          </div>
          <p className="text-xl font-semibold tracking-tight">{formatCurrency(totalValue)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Investi: {formatCurrency(totalInvested)}
          </p>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            {isPositive ? (
              <TrendingUp className="h-4 w-4 text-gain" />
            ) : (
              <TrendingDown className="h-4 w-4 text-loss" />
            )}
            <span className="text-xs font-medium uppercase tracking-wider">Performance</span>
          </div>
          <p className={`text-xl font-semibold tracking-tight ${isPositive ? "text-gain" : "text-loss"}`}>
            {formatPercent(totalGainLossPercent)}
          </p>
          <p className={`text-xs mt-1 ${isPositive ? "text-gain/70" : "text-loss/70"}`}>
            {formatCurrency(totalGainLoss)}
          </p>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <BarChart3 className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">Actifs</span>
          </div>
          <p className="text-xl font-semibold tracking-tight">{assetCount}</p>
          <p className="text-xs text-muted-foreground mt-1">Positions ouvertes</p>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Coins className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">Cash</span>
          </div>
          <p className="text-xl font-semibold tracking-tight">{formatCurrency(cashBalance)}</p>
          <p className="text-xs text-muted-foreground mt-1">Disponible</p>
        </CardContent>
      </Card>
    </div>
  );
}
