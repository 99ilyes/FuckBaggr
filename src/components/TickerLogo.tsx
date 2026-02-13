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
    // Official TSMC logo (Red serif text)
    TSM: "data:image/svg+xml;charset=utf-8,%3Csvg version='1.1' xmlns='http://www.w3.org/2000/svg' viewBox='0 0 500 150'%3E%3Cpath fill='%23E20010' d='M97.3,64.4c-9.6-4.6-16.1-8.2-16.1-16.1c0-7.3,6.3-12.7,16.5-12.7c6.1,0,12.7,2,17.4,5.4l5.4-13.4 c-6.6-4.4-15.1-6.8-23.4-6.8c-19.5,0-32.9,11.2-32.9,28.3c0,18.1,13.9,24.9,28.1,31.7c10.7,5.1,14.6,9.3,14.6,16.6 c0,8.1-6.8,13.9-19,13.9c-8.1,0-16.3-3.2-22.7-7.6L59,117.8c7.8,6.1,19,9.3,28.8,9.3c21.7,0,36.4-11.7,36.4-30.5 C124.2,77.3,111.4,71.2,97.3,64.4z M45.8,55.4v-9.3H26.3v-19h-17v19H0v9.3h9.3v49.8c0,12.2,4.6,17.3,15.6,17.3 c5.1,0,10.2-1.2,13.2-2.7l-2.4-9c-2,1-5.1,1.7-8.1,1.7c-3.9,0-5.4-1.7-5.4-6.6V55.4H45.8z M214.5,46.1V27.1h-16.6v19H177V27.1h-16.6 v19h-20.9V27.1h-16.6v83.4h16.6V62h20.9v48.5h16.6V62h20.9v48.5h16.6V46.1H214.5z M274.9,103.4l2.9-9.5c-4.9-2.2-9.5-3.4-14.4-3.4 c-12.2,0-20.5,9.5-20.5,21.5c0,12.2,8.5,20.7,21.5,20.7c5.4,0,9.8-1,14.1-3.2l2.7,9.5c-5.1,2.7-11.7,4.2-18.8,4.2 c-20.7,0-36.4-14.4-36.4-32.2c0-18.1,14.9-32.7,37.3-32.7C267.8,78.3,272.2,79.5,274.9,103.4z'/%3E%3C/svg%3E",
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
