const BRAND_COLORS: Record<string, string> = {
  // Tech
  NVDA: "#76B900",
  GOOG: "#4285F4",
  GOOGL: "#4285F4",
  AAPL: "#A2AAAD",
  MSFT: "#00A4EF",
  AMZN: "#FF9900",
  META: "#0082FB",
  TSLA: "#CC0000",
  TSM: "#D71920",
  AMD: "#ED1C24",
  INTC: "#0071C5",
  NFLX: "#E50914",
  CRM: "#00A1E0",
  ADBE: "#FF0000",
  ORCL: "#F80000",
  CSCO: "#1BA0D7",
  AVGO: "#CC092F",
  QCOM: "#3253DC",
  IBM: "#0530AD",
  PYPL: "#003087",
  SHOP: "#95BF47",
  UBER: "#000000",
  ABNB: "#FF5A5F",
  COIN: "#1652F0",
  SQ: "#000000",
  PLTR: "#000000",
  SNOW: "#29B5E8",
  // Finance
  NU: "#820AD1",
  "BRK-B": "#6B0F24",
  JPM: "#0E3A74",
  V: "#1A1F71",
  MA: "#EB001B",
  GS: "#6EAEDE",
  BAC: "#012169",
  MS: "#003986",
  // ETFs / Gold
  "GOLD-EUR.PA": "#FFD700",
  GLD: "#FFD700",
  GC: "#FFD700",
  SPY: "#005A9C",
  QQQ: "#7B3FE4",
  VTI: "#96151D",
  VOO: "#96151D",
  // Japanese
  "6857.T": "#91003C",
  "7203.T": "#EB0A1E",
  "6758.T": "#5865F2",
  "9984.T": "#FFCC00",
  // French
  "B28A.PA": "#0060A9",
  "AI.PA": "#0051A5",
  "MC.PA": "#5C4033",
  "OR.PA": "#000000",
  "SAN.PA": "#EF3340",
  "BNP.PA": "#009A44",
  "SU.PA": "#00529B",
  "CAP.PA": "#0070AD",
  "RMS.PA": "#F37021",
  "TTE.PA": "#ED0000",
  "GTT.PA": "#009BDB",
  "ADYEN.AS": "#0ABF53",
  // Latam
  MELI: "#FFE600",
  // Others
  NBIS: "#E0FF4F",
  GEV: "#005F9E",
  // Portfolios (fallback)
  CTO: "#4285F4",
  PEA: "#FF9900",
  "Crédit": "#34A853",
  // User requests
  ASML: "#272A78",
  "ASML.AS": "#272A78",
  RACE: "#D40000",
  "RACE.MI": "#D40000",
};

const FALLBACK_COLORS = [
  "#6366F1",
  "#14B8A6",
  "#F59E0B",
  "#EC4899",
  "#8B5CF6",
  "#06B6D4",
  "#F97316",
  "#10B981",
  "#E11D48",
  "#3B82F6",
];

export function getAllocationColor(name: string, index: number): string {
  if (BRAND_COLORS[name]) return BRAND_COLORS[name];
  const base = name.split(".")[0];
  if (BRAND_COLORS[base]) return BRAND_COLORS[base];
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function hexToRgb(hex: string): [number, number, number] | null {
  const normalized = hex.replace("#", "").trim();
  if (normalized.length !== 3 && normalized.length !== 6) return null;
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((c) => `${c}${c}`)
          .join("")
      : normalized;
  const value = Number.parseInt(expanded, 16);
  if (Number.isNaN(value)) return null;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function isVeryDarkAllocationColor(color: string): boolean {
  const rgb = hexToRgb(color);
  if (!rgb) return false;
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return luminance < 0.16;
}
