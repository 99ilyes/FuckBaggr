import { useState } from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AssetPosition, formatCurrency, formatPercent } from "@/lib/calculations";
import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  positions: AssetPosition[];
  baseCurrency?: string;
}

type SortKey = "ticker" | "quantity" | "pru" | "currentPrice" | "currentValueBase" | "gainLossBase" | "gainLossPercent";

interface SortConfig {
  key: SortKey;
  direction: "asc" | "desc";
}

export function PositionsTable({ positions, baseCurrency = "EUR" }: Props) {
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: "currentValueBase", direction: "desc" });

  if (positions.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        Aucune position. Ajoutez des transactions pour commencer.
      </div>
    );
  }

  const sortedPositions = [...positions].sort((a, b) => {
    const aValue = a[sortConfig.key as keyof AssetPosition];
    const bValue = b[sortConfig.key as keyof AssetPosition];

    if (typeof aValue === "string" && typeof bValue === "string") {
      return sortConfig.direction === "asc"
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue);
    }

    if (typeof aValue === "number" && typeof bValue === "number") {
      return sortConfig.direction === "asc" ? aValue - bValue : bValue - aValue;
    }

    return 0;
  });

  const handleSort = (key: SortKey) => {
    setSortConfig((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  };

  const SortHeader = ({ label, keyName, className = "" }: { label: string, keyName: SortKey, className?: string }) => (
    <TableHead className={className}>
      <Button
        variant="ghost"
        size="sm"
        className="-ml-3 h-8 data-[state=open]:bg-accent"
        onClick={() => handleSort(keyName)}
      >
        {label}
        <ArrowUpDown className="ml-2 h-3 w-3" />
      </Button>
    </TableHead>
  );

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortHeader label="Actif" keyName="ticker" />
          <SortHeader label="Qté" keyName="quantity" className="text-right" />
          <SortHeader label="PRU" keyName="pru" className="text-right" />
          <SortHeader label="Prix actuel" keyName="currentPrice" className="text-right" />
          <SortHeader label="Valeur" keyName="currentValueBase" className="text-right" />
          <SortHeader label="+/- Value" keyName="gainLossBase" className="text-right" />
          <SortHeader label="%" keyName="gainLossPercent" className="text-right" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedPositions.map((pos) => {
          const showNative = pos.currency !== baseCurrency;
          return (
            <TableRow key={pos.ticker}>
              <TableCell>
                <div>
                  <span className="font-medium">{pos.ticker}</span>
                  <span className="text-xs text-muted-foreground ml-2">{pos.name !== pos.ticker ? pos.name : ""}</span>
                </div>
              </TableCell>
              <TableCell className="text-right font-mono text-sm">{pos.quantity.toFixed(2)}</TableCell>
              <TableCell className="text-right font-mono text-sm">
                {formatCurrency(pos.pru, pos.currency)}
              </TableCell>
              <TableCell className="text-right font-mono text-sm">
                {formatCurrency(pos.currentPrice, pos.currency)}
              </TableCell>
              <TableCell className="text-right font-mono text-sm">
                <div>{formatCurrency(pos.currentValueBase, baseCurrency)}</div>
                {showNative && (
                  <div className="text-xs text-muted-foreground">
                    {formatCurrency(pos.currentValue, pos.currency)}
                  </div>
                )}
              </TableCell>
              <TableCell className="text-right font-mono text-sm">
                <div className={pos.gainLossBase >= 0 ? "text-gain" : "text-loss"}>
                  {formatCurrency(pos.gainLossBase, baseCurrency)}
                </div>
                {showNative && (
                  <div className={`text-xs ${pos.gainLoss >= 0 ? "text-gain/70" : "text-loss/70"}`}>
                    {formatCurrency(pos.gainLoss, pos.currency)}
                  </div>
                )}
              </TableCell>
              <TableCell className={`text-right font-mono text-sm ${pos.gainLossPercent >= 0 ? "text-gain" : "text-loss"}`}>
                {formatPercent(pos.gainLossPercent)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
