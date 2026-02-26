import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FairValueParams, ValuationModel, metricLabel, parseValuationModel } from "@/lib/watchlistTypes";

interface Props {
  ticker: string;
  currency: string;
  valuationModel: ValuationModel;
  autoMetric: number | null;
  manualMetric: number | null;
  params: FairValueParams | null;
  targetReturn: number;
  fairPrice: number | null;
  impliedReturn: number | null;
  onCreateValuation: () => void;
  onValuationModelChange: (model: ValuationModel) => void;
  onManualMetricChange: (value: number | null) => void;
  onUpdateParam: (key: keyof FairValueParams, value: number) => void;
  onTargetReturnChange: (value: number) => void;
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

function parseFieldNumber(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function MetricEditor({
  label,
  autoValue,
  manualValue,
  onChange,
}: {
  label: string;
  autoValue: number | null;
  manualValue: number | null;
  onChange: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (manualValue == null) {
      setDraft("");
      return;
    }
    setDraft(String(manualValue));
  }, [manualValue]);

  const displayedAuto = useMemo(() => {
    if (autoValue == null) return "—";
    return autoValue.toFixed(2);
  }, [autoValue]);

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{label}</p>
        {manualValue != null && (
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onChange(null)}>
            Auto
          </Button>
        )}
      </div>

      {manualValue == null ? (
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-sm tabular-nums text-foreground/85">Auto: {displayedAuto}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => onChange(autoValue ?? 0)}
          >
            Manuel
          </Button>
        </div>
      ) : (
        <Input
          className="mt-2 h-9 text-sm tabular-nums"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => onChange(parseFieldNumber(draft))}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
      )}
    </div>
  );
}

export function WatchlistValuationCard({
  ticker,
  currency,
  valuationModel,
  autoMetric,
  manualMetric,
  params,
  targetReturn,
  fairPrice,
  impliedReturn,
  onCreateValuation,
  onValuationModelChange,
  onManualMetricChange,
  onUpdateParam,
  onTargetReturnChange,
}: Props) {
  const metricText = metricLabel(valuationModel);

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 space-y-4">
      <div>
        <h3 className="text-base font-semibold">Valorisation</h3>
        <p className="text-xs text-muted-foreground">Méthode et hypothèses pour {ticker}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Méthode</span>
          <select
            value={valuationModel}
            onChange={(event) => {
              const parsed = parseValuationModel(event.target.value);
              if (parsed) onValuationModelChange(parsed);
            }}
            className="h-9 w-full rounded-md border border-border/60 bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="pe">PER</option>
            <option value="fcf_per_share">P/FCF</option>
            <option value="ps">P/S</option>
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Rendement cible (%)</span>
          <Input
            className="h-9 text-sm tabular-nums"
            type="number"
            value={targetReturn}
            onChange={(event) => {
              const parsed = Number(event.target.value);
              if (Number.isFinite(parsed)) onTargetReturnChange(parsed);
            }}
            min={0}
            max={80}
            step="0.1"
          />
        </label>
      </div>

      <MetricEditor
        label={metricText}
        autoValue={autoMetric}
        manualValue={manualMetric}
        onChange={onManualMetricChange}
      />

      {params ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Horizon (ans)</span>
            <Input
              className="h-9 text-sm tabular-nums"
              type="number"
              value={params.years}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                if (Number.isFinite(parsed)) onUpdateParam("years", parsed);
              }}
              min={1}
              max={30}
              step="1"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Croissance (%)</span>
            <Input
              className="h-9 text-sm tabular-nums"
              type="number"
              value={params.growth}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                if (Number.isFinite(parsed)) onUpdateParam("growth", parsed);
              }}
              min={-50}
              max={200}
              step="0.1"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Multiple cible</span>
            <Input
              className="h-9 text-sm tabular-nums"
              type="number"
              value={params.terminalPE}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                if (Number.isFinite(parsed)) onUpdateParam("terminalPE", parsed);
              }}
              min={1}
              max={200}
              step="0.1"
            />
          </label>
        </div>
      ) : (
        <Button type="button" variant="outline" className="h-9" onClick={onCreateValuation}>
          Valoriser ce titre
        </Button>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Prix juste</p>
          <p className="mt-1 tabular-nums text-sm font-semibold text-foreground">
            {formatCurrency(fairPrice, currency)}
          </p>
        </div>
        <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Rdt. implicite</p>
          <p className="mt-1 tabular-nums text-sm font-semibold text-foreground">
            {impliedReturn != null ? `${impliedReturn >= 0 ? "+" : ""}${impliedReturn.toFixed(1)}%` : "—"}
          </p>
        </div>
      </div>
    </div>
  );
}
