import { TickerLogo } from "@/components/TickerLogo";
import { WatchlistComputedRow } from "@/lib/watchlistViewModel";

interface Props {
  row: WatchlistComputedRow;
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

function formatPercent(value: number | null, digits = 2): string {
  if (value == null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function valueClass(value: number | null): string {
  if (value == null) return "text-muted-foreground";
  return value >= 0 ? "text-emerald-400" : "text-rose-400";
}

function marginOfSafety(price: number | null, fairPrice: number | null): number | null {
  if (price == null || fairPrice == null || fairPrice === 0) return null;
  return ((fairPrice - price) / fairPrice) * 100;
}

export function WatchlistTickerHeader({ row }: Props) {
  const margin = marginOfSafety(row.price, row.fairPrice);

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <TickerLogo ticker={row.ticker} className="h-12 w-12 shrink-0" />
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold tracking-tight">{row.name}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{row.ticker}</p>
            <div className="mt-2 flex items-center gap-2">
              <span className="tabular-nums text-2xl font-semibold text-foreground">
                {formatCurrency(row.price, row.currency)}
              </span>
              <span className={`tabular-nums text-sm font-semibold ${valueClass(row.changePercent)}`}>
                {formatPercent(row.changePercent)}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 text-right sm:grid-cols-3">
          <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Prix juste</p>
            <p className="mt-1 tabular-nums text-sm font-semibold text-foreground">
              {formatCurrency(row.fairPrice, row.currency)}
            </p>
          </div>
          <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Rdt. implicite</p>
            <p className={`mt-1 tabular-nums text-sm font-semibold ${valueClass(row.impliedReturn)}`}>
              {formatPercent(row.impliedReturn, 1)}
            </p>
          </div>
          <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Marge sécurité</p>
            <p className={`mt-1 tabular-nums text-sm font-semibold ${valueClass(margin)}`}>
              {formatPercent(margin, 1)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
