import { ReactNode, useEffect, useMemo, useState } from "react";
import { TickerLogo } from "@/components/TickerLogo";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { WatchlistComputedRow } from "@/lib/watchlistViewModel";
import { WatchlistSort } from "@/lib/watchlistTypes";
import { ChevronDown, ChevronUp, X } from "lucide-react";

interface Props {
  rows: WatchlistComputedRow[];
  selectedTicker: string | null;
  onSelectTicker: (ticker: string) => void;
  onRemoveTicker: (ticker: string) => void;
  sort: WatchlistSort;
  onSortChange: (sort: WatchlistSort) => void;
  searchSlot: ReactNode;
  loading?: boolean;
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

function impliedClass(value: number | null): string {
  if (value == null) return "text-muted-foreground";
  if (value >= 12) return "text-emerald-400";
  if (value >= 8) return "text-amber-300";
  return "text-rose-400";
}

function sortLabel(sort: WatchlistSort): string {
  if (sort === "change_desc") return "Variation jour";
  if (sort === "alpha") return "Alphabétique";
  return "Rendement implicite";
}

function MenuList({
  rows,
  selectedTicker,
  onSelectTicker,
  onRemoveTicker,
}: {
  rows: WatchlistComputedRow[];
  selectedTicker: string | null;
  onSelectTicker: (ticker: string) => void;
  onRemoveTicker: (ticker: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-8 text-center text-sm text-muted-foreground">
        Aucun titre à afficher.
      </div>
    );
  }

  return (
    <div className="max-h-[58vh] overflow-y-auto space-y-1 pr-1 lg:max-h-none lg:overflow-visible">
      {rows.map((row) => {
        const isActive = row.ticker === selectedTicker;

        return (
          <div
            key={row.ticker}
            data-testid="watchlist-menu-item"
            className={`w-full rounded-lg border px-2.5 py-2.5 transition-colors ${
              isActive
                ? "border-primary/60 bg-primary/10"
                : "border-border/50 bg-card hover:bg-muted/20"
            }`}
          >
            <div className="flex items-start gap-2">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => onSelectTicker(row.ticker)}
              >
                <div className="flex items-start gap-2">
                  <TickerLogo ticker={row.ticker} className="h-7 w-7 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold">{row.ticker}</p>
                      <p className="tabular-nums text-sm font-semibold text-foreground/90">
                        {formatCurrency(row.price, row.currency)}
                      </p>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <p className="truncate text-xs text-muted-foreground">{row.name}</p>
                      <p className={`tabular-nums text-xs font-semibold ${impliedClass(row.impliedReturn)}`}>
                        {row.impliedReturn != null
                          ? `${row.impliedReturn >= 0 ? "+" : ""}${row.impliedReturn.toFixed(1)}%`
                          : "—"}
                      </p>
                    </div>
                  </div>
                </div>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Supprimer ${row.ticker}`}
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => onRemoveTicker(row.ticker)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function WatchlistTickerMenu({
  rows,
  selectedTicker,
  onSelectTicker,
  onRemoveTicker,
  sort,
  onSortChange,
  searchSlot,
  loading = false,
}: Props) {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = useState(false);

  const selectedRow = useMemo(
    () => rows.find((row) => row.ticker === selectedTicker) || null,
    [rows, selectedTicker]
  );

  useEffect(() => {
    if (!isMobile) return;
    setOpenMobile(false);
  }, [selectedTicker, isMobile]);

  const content = (
    <div className="rounded-xl border border-border/60 bg-card p-3 space-y-3">
      <div className="space-y-2">
        <Select value={sort} onValueChange={(value) => onSortChange(value as WatchlistSort)}>
          <SelectTrigger data-testid="watchlist-sort-select" className="h-9 w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="implied_desc">Rendement implicite</SelectItem>
            <SelectItem value="change_desc">Variation jour</SelectItem>
            <SelectItem value="alpha">Alphabétique</SelectItem>
          </SelectContent>
        </Select>
        {searchSlot}
      </div>

      {loading && rows.length === 0 ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="rounded-lg border border-border/50 bg-muted/20 px-3 py-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="mt-2 h-3 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <MenuList
          rows={rows}
          selectedTicker={selectedTicker}
          onSelectTicker={onSelectTicker}
          onRemoveTicker={onRemoveTicker}
        />
      )}
    </div>
  );

  if (!isMobile) {
    return content;
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="h-10 w-full justify-between rounded-lg border-border/60 bg-card px-3"
        onClick={() => setOpenMobile((current) => !current)}
      >
        <span className="truncate text-sm font-medium">
          {selectedRow
            ? `${selectedRow.ticker} · ${formatCurrency(selectedRow.price, selectedRow.currency)} · ${selectedRow.impliedReturn != null
              ? `${selectedRow.impliedReturn >= 0 ? "+" : ""}${selectedRow.impliedReturn.toFixed(1)}%`
              : "—"
            }`
            : "Sélectionner un titre"}
        </span>
        <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
          {sortLabel(sort)}
          {openMobile ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </Button>

      {openMobile && content}
    </div>
  );
}
