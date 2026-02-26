import { TickerOperationMarker, WatchlistTickerDetail } from "@/lib/watchlistViewModel";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";

interface Props {
  detail: WatchlistTickerDetail;
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

function formatQty(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value % 1 === 0 ? value.toFixed(0) : value.toFixed(3);
}

function formatMarketCap(value: number | null, currency: string): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000_000_000) {
    return `${(value / 1_000_000_000_000).toFixed(2)} T ${currency}`;
  }
  if (Math.abs(value) >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)} Md ${currency}`;
  }
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)} M ${currency}`;
  }
  return formatCurrency(value, currency);
}

function formatDate(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function OperationChip({ operation }: { operation: TickerOperationMarker }) {
  const isBuy = operation.type === "buy" || operation.type === "transfer_in";

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1">
          {isBuy ? (
            <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <ArrowUpRight className="h-3.5 w-3.5 text-rose-400" />
          )}
          <span className={isBuy ? "text-emerald-400" : "text-rose-400"}>
            {isBuy ? "Achat" : "Vente"}
          </span>
        </div>
        <span className="tabular-nums text-muted-foreground">{formatDate(operation.date)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-foreground/85">
        <span>Qté: {formatQty(operation.quantity)}</span>
        <span className="tabular-nums">{formatCurrency(operation.price, operation.currency)}</span>
      </div>
      <p className="mt-1 truncate text-[11px] text-muted-foreground">{operation.portfolioName}</p>
    </div>
  );
}

export function WatchlistInfoCard({ detail }: Props) {
  const hasPortfolioPresence = detail.portfolioPresence.length > 0;

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 space-y-4">
      <div>
        <h3 className="text-base font-semibold">Informations</h3>
        <p className="text-xs text-muted-foreground">Titre et données clés</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Devise</p>
          <p className="mt-1 text-sm font-medium">{detail.assetCurrency || "—"}</p>
        </div>
        <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Secteur</p>
          <p className="mt-1 text-sm font-medium">{detail.sector || "—"}</p>
        </div>
        <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{detail.ratioLabel}</p>
          <p className="mt-1 tabular-nums text-sm font-medium">
            {detail.currentRatio != null ? detail.currentRatio.toFixed(2) : "—"}
          </p>
        </div>
        <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{detail.metricLabel}</p>
          <p className="mt-1 tabular-nums text-sm font-medium">
            {detail.effectiveMetric != null ? detail.effectiveMetric.toFixed(2) : "—"}
          </p>
        </div>
        <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 sm:col-span-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Capitalisation (inférée)</p>
          <p className="mt-1 tabular-nums text-sm font-medium">
            {formatMarketCap(detail.inferredMarketCap, detail.assetCurrency || "EUR")}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Portefeuilles</h4>
        {!hasPortfolioPresence ? (
          <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
            Aucun portefeuille en position ouverte.
          </div>
        ) : (
          <div className="max-w-full overflow-x-auto rounded-md border border-border/60">
            <table className="w-full min-w-[340px] sm:min-w-[420px]">
              <thead className="bg-muted/20 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Portefeuille</th>
                  <th className="px-3 py-2 text-right font-medium">Qté</th>
                  <th className="px-3 py-2 text-right font-medium">PRU</th>
                  <th className="px-3 py-2 text-right font-medium">Valeur</th>
                </tr>
              </thead>
              <tbody>
                {detail.portfolioPresence.map((presence) => (
                  <tr key={presence.portfolioId} className="border-t border-border/40 text-sm">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {presence.portfolioColor && (
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: presence.portfolioColor }}
                          />
                        )}
                        <span>{presence.portfolioName}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatQty(presence.quantity)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(presence.pru, presence.currency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(presence.currentValue, presence.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Derniers points achat/vente</h4>
        {detail.latestOperations.length === 0 ? (
          <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
            Aucune opération trouvée pour ce titre.
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {detail.latestOperations.map((operation) => (
              <OperationChip key={operation.id} operation={operation} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
