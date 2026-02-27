export type ValuationModel = "pe" | "fcf_per_share" | "ps";

export interface FairValueParams {
  growth: number;
  terminalPE: number;
  years: number;
}

export type WatchlistSort = "implied_desc" | "change_desc" | "alpha";

export type ChartPreset = "1M" | "3M" | "YTD" | "1A" | "2Y" | "5A" | "MAX" | "CUSTOM";
export type RatioPeriod = "1A" | "2Y" | "5A" | "MAX";

export const DEFAULT_GROWTH = 10;
export const DEFAULT_TERMINAL_PE = 20;
export const DEFAULT_YEARS = 5;
export const DEFAULT_TARGET_RETURN = 10;
export const DEFAULT_VALUATION_MODEL: ValuationModel = "pe";

export function parseValuationModel(value: unknown): ValuationModel | null {
  if (value === "pfcf") return "fcf_per_share";
  if (value === "pe" || value === "fcf_per_share" || value === "ps") return value;
  return null;
}

export function metricLabel(model: ValuationModel): string {
  if (model === "fcf_per_share") return "FCF ann. (Md)";
  if (model === "ps") return "Ventes ann. (Md)";
  return "EPS ann.";
}

export function currentRatioLabel(model: ValuationModel): string {
  if (model === "fcf_per_share") return "P/FCF";
  if (model === "ps") return "P/S";
  return "PER";
}
