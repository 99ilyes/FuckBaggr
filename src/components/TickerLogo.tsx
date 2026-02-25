import { useEffect, useMemo, useState } from "react";

const TICKER_ALIASES: Record<string, string> = {
  // Legacy symbol used in older imports
  "GOLD-EUR.PA": "GOLD.PA",
  // Some providers use dash instead of dot for Berkshire
  "BRK.B": "BRK-B",
};

const TICKER_IMAGE_OVERRIDES: Record<string, string> = {
  // Provider logo variant has a red background; use official GTT asset instead.
  "GTT.PA": "https://www.gtt.fr/sites/default/files/GTT-LOGO-BASELINE-RVB_1.png",
  GTT: "https://www.gtt.fr/sites/default/files/GTT-LOGO-BASELINE-RVB_1.png",
};

const NON_TICKER_LABELS = new Set([
  "AUTRE",
  "AUTRES",
  "OTHER",
  "UNKNOWN",
  "CASH",
  "LIQUIDITES",
  "LIQUIDITÉS",
]);

const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.\-=]{0,14}$/;

// Ticker -> company website domain (fallback only)
const TICKER_DOMAINS: Record<string, string> = {
  // US Tech
  NVDA: "nvidia.com",
  GOOG: "google.com",
  GOOGL: "google.com",
  AAPL: "apple.com",
  MSFT: "microsoft.com",
  AMZN: "amazon.com",
  META: "meta.com",
  TSLA: "tesla.com",
  NFLX: "netflix.com",
  AMD: "amd.com",
  INTC: "intel.com",
  CRM: "salesforce.com",
  ADBE: "adobe.com",
  ORCL: "oracle.com",
  CSCO: "cisco.com",
  AVGO: "broadcom.com",
  QCOM: "qualcomm.com",
  IBM: "ibm.com",
  PYPL: "paypal.com",
  SHOP: "shopify.com",
  UBER: "uber.com",
  ABNB: "airbnb.com",
  COIN: "coinbase.com",
  SQ: "squareup.com",
  PLTR: "palantir.com",
  SNOW: "snowflake.com",
  SPOT: "spotify.com",

  // US Finance
  NU: "nubank.com.br",
  JPM: "jpmorganchase.com",
  V: "visa.com",
  MA: "mastercard.com",
  GS: "goldmansachs.com",
  BAC: "bankofamerica.com",
  MS: "morganstanley.com",
  "BRK-B": "berkshirehathaway.com",

  // ETFs & Commodities
  "GOLD-EUR.PA": "amundietf.com",
  "GOLD.PA": "amundietf.com",
  GLD: "spdrgoldshares.com",
  "B28A.PA": "blackrock.com",
  SPY: "ssga.com",
  QQQ: "invesco.com",
  VTI: "vanguard.com",
  VOO: "vanguard.com",

  // Japanese
  "6857.T": "advantest.com",
  "7203.T": "toyota.com",
  "6758.T": "sony.com",
  "9984.T": "softbank.com",

  // French / EU
  "AI.PA": "airliquide.com",
  "MC.PA": "lvmh.com",
  "OR.PA": "loreal.com",
  "SAN.PA": "sanofi.com",
  "BNP.PA": "bnpparibas.com",
  "SU.PA": "se.com",
  "CAP.PA": "capgemini.com",
  "RMS.PA": "hermes.com",
  "TTE.PA": "totalenergies.com",
  "GTT.PA": "gtt.fr",
  "RACE.MI": "ferrari.com",
  "ADYEN.AS": "adyen.com",
  "ASML.AS": "asml.com",

  // Other
  MELI: "mercadolibre.com",
  NBIS: "nebius.com",
  GEV: "gevernova.com",
  LITE: "lumentum.com",
};

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

function resolveTickerAlias(ticker: string): string {
  const normalized = normalizeTicker(ticker);
  return TICKER_ALIASES[normalized] ?? normalized;
}

function getBaseTicker(ticker: string): string {
  return ticker.split(".")[0];
}

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

export function getLogoDomain(ticker: string): string | null {
  const normalized = resolveTickerAlias(ticker);
  if (TICKER_DOMAINS[normalized]) return TICKER_DOMAINS[normalized];

  const base = getBaseTicker(normalized);
  if (TICKER_DOMAINS[base]) return TICKER_DOMAINS[base];

  return null;
}

export function getLogoCandidates(ticker: string): string[] {
  const normalized = resolveTickerAlias(ticker);
  if (!normalized || NON_TICKER_LABELS.has(normalized) || !TICKER_PATTERN.test(normalized)) {
    return [];
  }

  const base = getBaseTicker(normalized);
  const domain = getLogoDomain(normalized);

  const candidates = [
    TICKER_IMAGE_OVERRIDES[normalized] ?? "",
    TICKER_IMAGE_OVERRIDES[base] ?? "",
    // Primary source: usually provides high-quality company logos by ticker.
    `https://assets.parqet.com/logos/symbol/${encodeURIComponent(normalized)}?format=svg`,
  ];

  if (base && base !== normalized) {
    candidates.push(`https://assets.parqet.com/logos/symbol/${encodeURIComponent(base)}?format=svg`);
  }

  // Last resort: domain favicon (lower quality but broad coverage)
  if (domain) {
    candidates.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`);
  }

  return uniqueNonEmpty(candidates);
}

export function getLogoUrl(ticker: string): string | null {
  return getLogoCandidates(ticker)[0] ?? null;
}

export function TickerLogo({ ticker, className }: { ticker: string; className?: string }) {
  const candidates = useMemo(() => getLogoCandidates(ticker), [ticker]);
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [ticker]);

  const logoUrl = candidates[candidateIndex] ?? null;

  if (!logoUrl) {
    // Fallback: colored initial letter when no logo source exists
    const letter = ticker.charAt(0).toUpperCase();
    const hue = ticker.split("").reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
    return (
      <div
        className={`w-7 h-7 rounded-md flex items-center justify-center text-[11px] font-bold text-white shrink-0 ${className}`}
        style={{ backgroundColor: `hsl(${hue}, 50%, 40%)` }}
      >
        {letter}
      </div>
    );
  }

  return (
    <img
      src={logoUrl}
      alt={ticker}
      className={`w-7 h-7 rounded-md object-contain shrink-0 p-0.5 bg-white/90 ${className}`}
      onError={() => setCandidateIndex((prev) => prev + 1)}
      loading="lazy"
    />
  );
}
