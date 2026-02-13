import { useState } from "react";

// Ticker → company website domain for logo fetching
const TICKER_DOMAINS: Record<string, string> = {
    // US Tech
    NVDA: "nvidia.com", GOOG: "google.com", GOOGL: "google.com",
    AAPL: "apple.com", MSFT: "microsoft.com", AMZN: "amazon.com",
    META: "meta.com", TSLA: "tesla.com", NFLX: "netflix.com",
    AMD: "amd.com", INTC: "intel.com", CRM: "salesforce.com",
    ADBE: "adobe.com", ORCL: "oracle.com", CSCO: "cisco.com",
    AVGO: "broadcom.com", QCOM: "qualcomm.com", IBM: "ibm.com",
    PYPL: "paypal.com", SHOP: "shopify.com", UBER: "uber.com",
    ABNB: "airbnb.com", COIN: "coinbase.com", SQ: "squareup.com",
    PLTR: "palantir.com", SNOW: "snowflake.com", SPOT: "spotify.com",
    // US Finance
    NU: "nubank.com.br", JPM: "jpmorganchase.com", V: "visa.com",
    MA: "mastercard.com", GS: "goldmansachs.com", BAC: "bankofamerica.com",
    MS: "morganstanley.com", "BRK-B": "berkshirehathaway.com",
    // Semiconductors
    TSM: "tsmc.com",
    // ETFs & Commodities
    "GOLD-EUR.PA": "amundietf.com", GLD: "spdrgoldshares.com",
    "B28A.PA": "blackrock.com",
    SPY: "ssga.com", QQQ: "invesco.com", VTI: "vanguard.com", VOO: "vanguard.com",
    // Japanese
    "6857.T": "advantest.com", "7203.T": "toyota.com",
    "6758.T": "sony.com", "9984.T": "softbank.com",
    // French
    "AI.PA": "airliquide.com",
    "MC.PA": "lvmh.com", "OR.PA": "loreal.com",
    "SAN.PA": "sanofi.com", "BNP.PA": "group.bnpparibas",
    "SU.PA": "se.com", "CAP.PA": "capgemini.com",
    "RMS.PA": "hermes.com", "TTE.PA": "totalenergies.com",
    "GTT.PA": "gtt.fr",
    // European
    "RACE.MI": "ferrari.com", "ADYEN.AS": "adyen.com",
    "ASML.AS": "asml.com",
    // Latam
    MELI: "mercadolibre.com",
    // Other US
    NBIS: "nebius.com",
    GEV: "gevernova.com",
    LITE: "lumentum.com",
};

// Direct image overrides for when favicons are blurry or incorrect
const TICKER_IMAGE_OVERRIDES: Record<string, string> = {
    TSM: "https://companieslogo.com/img/orig/TSM-0905d21e.png",
};

export function getLogoDomain(ticker: string): string | null {
    if (TICKER_DOMAINS[ticker]) return TICKER_DOMAINS[ticker];
    const base = ticker.split(".")[0];
    if (TICKER_DOMAINS[base]) return TICKER_DOMAINS[base];
    return null;
}

export function getLogoUrl(ticker: string): string | null {
    if (TICKER_IMAGE_OVERRIDES[ticker]) return TICKER_IMAGE_OVERRIDES[ticker];
    const base = ticker.split(".")[0];
    if (TICKER_IMAGE_OVERRIDES[base]) return TICKER_IMAGE_OVERRIDES[base];

    const domain = getLogoDomain(ticker);
    if (!domain) return null;

    return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
}

export function TickerLogo({ ticker }: { ticker: string }) {
    const [failed, setFailed] = useState(false);
    const logoUrl = getLogoUrl(ticker);

    if (!logoUrl || failed) {
        // Fallback: colored initial letter
        const letter = ticker.charAt(0).toUpperCase();
        const hue = ticker.split("").reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
        return (
            <div
                className="w-7 h-7 rounded-md flex items-center justify-center text-[11px] font-bold text-white shrink-0"
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
            className="w-7 h-7 rounded-md object-contain shrink-0 p-0.5 bg-white/90"
            onError={() => setFailed(true)}
            loading="lazy"
        />
    );
}
