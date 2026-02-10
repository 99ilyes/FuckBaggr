import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AssetPosition, formatCurrency, formatPercent } from "@/lib/calculations";

interface Props {
  positions: AssetPosition[];
}

export function PositionsTable({ positions }: Props) {
  if (positions.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        Aucune position. Ajoutez des transactions pour commencer.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Actif</TableHead>
          <TableHead className="text-right">Qté</TableHead>
          <TableHead className="text-right">PRU</TableHead>
          <TableHead className="text-right">Prix actuel</TableHead>
          <TableHead className="text-right">Valeur</TableHead>
          <TableHead className="text-right">+/- Value</TableHead>
          <TableHead className="text-right">%</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {positions.map((pos) => (
          <TableRow key={pos.ticker}>
            <TableCell>
              <div>
                <span className="font-medium">{pos.ticker}</span>
                <span className="text-xs text-muted-foreground ml-2">{pos.name !== pos.ticker ? pos.name : ""}</span>
              </div>
            </TableCell>
            <TableCell className="text-right font-mono text-sm">{pos.quantity.toFixed(2)}</TableCell>
            <TableCell className="text-right font-mono text-sm">{formatCurrency(pos.pru)}</TableCell>
            <TableCell className="text-right font-mono text-sm">{formatCurrency(pos.currentPrice)}</TableCell>
            <TableCell className="text-right font-mono text-sm">{formatCurrency(pos.currentValue)}</TableCell>
            <TableCell className={`text-right font-mono text-sm ${pos.gainLoss >= 0 ? "text-gain" : "text-loss"}`}>
              {formatCurrency(pos.gainLoss)}
            </TableCell>
            <TableCell className={`text-right font-mono text-sm ${pos.gainLossPercent >= 0 ? "text-gain" : "text-loss"}`}>
              {formatPercent(pos.gainLossPercent)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
