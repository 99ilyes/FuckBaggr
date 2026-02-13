import { useState } from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AssetPosition, formatCurrency, formatPercent } from "@/lib/calculations";
import { ArrowUpDown } from "lucide-react";

import { TickerLogo } from "@/components/TickerLogo";

interface Props {
  positions: AssetPosition[];
  baseCurrency?: string;
}

type SortKey = "ticker" | "quantity" | "currentPrice" | "currentValueBase" | "gainLossPercent" | "pru" | "currentValue";

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
      return sortConfig.direction === "asc" ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
    }
    if (typeof aValue === "number" && typeof bValue === "number") {
      return sortConfig.direction === "asc" ? aValue - bValue : bValue - aValue;
    }
    return 0;
  });

  const handleSort = (key: SortKey) => {
    setSortConfig((c) => ({
      key,
      direction: c.key === key && c.direction === "asc" ? "desc" : "asc",
    }));
  };

  const SortHeader = ({ label, keyName, className = "" }: { label: string; keyName: SortKey; className?: string }) => (
    <TableHead className={className}>
      <button
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => handleSort(keyName)}
      >
        {label}
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      </button>
    </TableHead>
  );

  const total = sortedPositions.reduce((s, p) => s + (p.currentValueBase ?? p.currentValue), 0);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[800px]">
        <Table>
          <TableHeader>
            <TableRow className="border-border/30 hover:bg-transparent">
              <SortHeader label="Actif" keyName="ticker" />
              <SortHeader label="Qté" keyName="quantity" className="text-right" />
              <SortHeader label="PRU" keyName="pru" className="text-right" />
              <SortHeader label="Prix" keyName="currentPrice" className="text-right" />
              <SortHeader label="Val. Devise" keyName="currentValue" className="text-right" />
              <SortHeader label="Valeur" keyName="currentValueBase" className="text-right" />
              <SortHeader label="P&L" keyName="gainLossPercent" className="text-right" />
              <TableHead className="text-right text-xs text-muted-foreground">Poids</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedPositions.map((pos) => {
              const weight = total > 0 ? ((pos.currentValueBase ?? pos.currentValue) / total * 100).toFixed(1) : "0";
              return (
                <TableRow key={pos.ticker} className="border-border/20 hover:bg-muted/30">
                  <TableCell className="py-2.5">
                    <div className="flex items-center gap-2.5">
                      <TickerLogo ticker={pos.ticker} />
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium text-sm">{pos.ticker}</span>
                        {pos.name && pos.name !== pos.ticker && (
                          <span className="text-[11px] text-muted-foreground truncate max-w-[180px]">{pos.name}</span>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm py-2.5">
                    {pos.quantity % 1 === 0 ? pos.quantity : pos.quantity.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm py-2.5 text-muted-foreground">
                    {formatCurrency(pos.pru, pos.currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm py-2.5">
                    {formatCurrency(pos.currentPrice, pos.currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm py-2.5 text-muted-foreground">
                    {formatCurrency(pos.currentValue, pos.currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm font-medium py-2.5">
                    {formatCurrency(pos.currentValueBase, baseCurrency)}
                  </TableCell>
                  <TableCell className="text-right py-2.5">
                    <div className={`text-sm font-medium tabular-nums ${pos.gainLossPercent >= 0 ? "text-gain" : "text-loss"}`}>
                      {formatPercent(pos.gainLossPercent)}
                    </div>
                    <div className={`text-[11px] tabular-nums ${pos.gainLossBase >= 0 ? "text-gain/60" : "text-loss/60"}`}>
                      {formatCurrency(pos.gainLossBase, baseCurrency)}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm text-muted-foreground py-2.5">
                    {weight}%
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

