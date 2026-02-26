/**
 * Price fetcher — calls Yahoo Finance directly from the browser.
 *
 * Yahoo Finance's query2 endpoint does NOT enforce CORS, so browser requests
 * work fine without a proxy. This avoids the shared-IP rate-limit that kills
 * every Supabase edge function after a few requests.
 *
 * Flow:
 *  1. Call Yahoo v8 chart API directly from the browser (per-user IP → no shared rate-limit)
 *  2. Fall back to the DB cache (via edge function) for any tickers that failed
 *  3. After a successful live fetch, persist the new prices to the DB cache
 */

import { supabase } from "@/integrations/supabase/client";

export interface YahooQuoteResult {
  price: number | null;
  previousClose: number | null;
  name: string;
  currency: string;
  change?: number | null;
  changePercent?: number | null;
  marketState?: string | null;
  preMarketPrice?: number | null;
  postMarketPrice?: number | null;
  fromCache?: boolean;
}

export interface YahooHistoryResult {
  timestamps: number[]; // Epoch seconds at midnight roughly
  closes: number[];     // Daily close prices
  currency?: string;
  symbol?: string;
}

const YAHOO_TIMEOUT_MS = 7000;

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function getLastCloseInPeriod(
  timestamps: number[],
  closes: Array<number | null>,
  period: { start?: number; end?: number } | undefined
): number | null {
  if (!period) return null;
  const start = toFiniteNumber(period.start);
  const end = toFiniteNumber(period.end);
  if (start == null || end == null) return null;

  const maxIdx = Math.min(timestamps.length, closes.length) - 1;
  for (let i = maxIdx; i >= 0; i--) {
    const ts = timestamps[i];
    const close = closes[i];
    if (ts >= start && ts < end && typeof close === "number" && Number.isFinite(close)) {
      return close;
    }
  }
  return null;
}

function isWithinPeriod(nowSec: number, period: { start?: number; end?: number } | undefined): boolean {
  if (!period) return false;
  const start = toFiniteNumber(period.start);
  const end = toFiniteNumber(period.end);
  if (start == null || end == null) return false;
  return nowSec >= start && nowSec < end;
}

function extractSessionInfo(result: any): {
  marketState: string | null;
  preMarketPrice: number | null;
  postMarketPrice: number | null;
  regularLivePrice: number | null;
} {
  const meta = result?.meta ?? {};
  const timestamps = Array.isArray(result?.timestamp) ? (result.timestamp as number[]) : [];
  const closesRaw = result?.indicators?.quote?.[0]?.close;
  const closes = Array.isArray(closesRaw) ? (closesRaw as Array<number | null>) : [];
  const periods = (meta.currentTradingPeriod ?? {}) as {
    pre?: { start?: number; end?: number };
    regular?: { start?: number; end?: number };
    post?: { start?: number; end?: number };
  };

  const preMarketPrice =
    toFiniteNumber(meta.preMarketPrice) ?? getLastCloseInPeriod(timestamps, closes, periods.pre);
  const postMarketPrice =
    toFiniteNumber(meta.postMarketPrice) ?? getLastCloseInPeriod(timestamps, closes, periods.post);
  const regularLivePrice = getLastCloseInPeriod(timestamps, closes, periods.regular);

  let marketState: string | null =
    typeof meta.marketState === "string" && meta.marketState.trim().length > 0
      ? meta.marketState.toUpperCase()
      : null;

  if (!marketState) {
    const nowSec = Math.floor(Date.now() / 1000);
    if (isWithinPeriod(nowSec, periods.regular)) marketState = "REGULAR";
    else if (isWithinPeriod(nowSec, periods.pre)) marketState = "PRE";
    else if (isWithinPeriod(nowSec, periods.post)) marketState = "POST";
    else if (periods.regular || periods.pre || periods.post) marketState = "CLOSED";
  }

  return {
    marketState,
    preMarketPrice: preMarketPrice ?? null,
    postMarketPrice: postMarketPrice ?? null,
    regularLivePrice: regularLivePrice ?? null,
  };
}

/** Fetch a single ticker directly from Yahoo Finance v8 (browser → unique IP). */
async function fetchTickerBrowser(ticker: string): Promise<YahooQuoteResult | null> {
  try {
    // Use local proxy in development to avoid CORS issues
    const baseUrl = import.meta.env.DEV
      ? "/api/yf"
      : "https://query2.finance.yahoo.com";

    const url = `${baseUrl}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d&includePrePost=true`;

    // Add logging for debugging
    console.log(`Fetching ${ticker} from ${baseUrl}...`);

    const resp = await fetch(url, {
      signal: AbortSignal.timeout(YAHOO_TIMEOUT_MS),
      headers: {
        "Accept": "application/json",
      },
    });

    if (!resp.ok) return null;

    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta || meta.regularMarketPrice == null) return null;
    const sessionInfo = extractSessionInfo(result);

    const regularPrice = meta.regularMarketPrice as number;
    const price =
      sessionInfo.marketState === "REGULAR" || sessionInfo.marketState === "OPEN"
        ? (sessionInfo.regularLivePrice ?? regularPrice)
        : regularPrice;
    const prevClose = (meta.chartPreviousClose ?? meta.previousClose ?? price) as number;
    const change = (meta.regularMarketChange ?? (price - prevClose)) as number;
    const changePercent = (meta.regularMarketChangePercent ?? (prevClose !== 0 ? (change / prevClose) * 100 : 0)) as number;

    return {
      price,
      previousClose: prevClose,
      name: meta.longName ?? meta.shortName ?? meta.symbol ?? ticker,
      currency: meta.currency ?? "USD",
      change,
      changePercent,
      marketState: sessionInfo.marketState,
      preMarketPrice: sessionInfo.preMarketPrice,
      postMarketPrice: sessionInfo.postMarketPrice,
      fromCache: false,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch prices via the server (Edge Function).
 * Used as fallback when browser fetch fails.
 *
 * logic:
 * - The Edge Function will try to fetch live from Yahoo (server-side).
 * - If that fails, it returns the DB cache.
 */
async function fetchServerSideFallback(
  tickers: string[]
): Promise<Record<string, YahooQuoteResult>> {
  try {
    // We omit `mode: "cache-only"` so the function defaults to trying a live fetch first.
    const { data, error } = await supabase.functions.invoke("fetch-prices", {
      body: { tickers },
    });
    if (error || !data?.results) return {};
    const results: Record<string, YahooQuoteResult> = {};
    const raw = data.results as Record<
      string,
      {
        price?: number | null;
        previousClose?: number | null;
        name?: string | null;
        currency?: string | null;
        marketState?: string | null;
        preMarketPrice?: number | null;
        postMarketPrice?: number | null;
        fromCache?: boolean;
      }
    >;
    for (const [t, info] of Object.entries(raw)) {
      if (info?.price != null) {
        const price = info.price as number;
        const previousClose = (info.previousClose ?? null) as number | null;
        const change = previousClose != null ? price - previousClose : 0;
        const changePercent = previousClose != null && previousClose !== 0
          ? (change / previousClose) * 100
          : 0;
        results[t] = {
          price,
          previousClose,
          name: info.name ?? t,
          currency: info.currency ?? "USD",
          change,
          changePercent,
          marketState: info.marketState ?? null,
          preMarketPrice: info.preMarketPrice ?? null,
          postMarketPrice: info.postMarketPrice ?? null,
          fromCache: !!info.fromCache, // could be true or false depending on what the server managed to do
        };
      }
    }
    return results;
  } catch {
    return {};
  }
}

/**
 * Persist newly-fetched live prices to the DB cache (fire-and-forget).
 * We don't await this — the UI should not wait for the DB write.
 */
export function persistPricesToCache(
  prices: Record<string, YahooQuoteResult>
): void {
  const liveEntries = Object.entries(prices).filter(([, v]) => v?.price != null && !v.fromCache);
  if (liveEntries.length === 0) return;

  supabase.functions
    .invoke("fetch-prices", {
      body: {
        mode: "persist",
        prices: Object.fromEntries(liveEntries),
      },
    })
    .catch((e) => console.warn("Cache persist failed:", e));
}

/**
 * Main public API.
 *
 * Fetches prices for all given tickers:
 * - Live: direct browser → Yahoo Finance (no shared-IP rate limit)
 * - Fallback: DB cache via edge function for tickers that failed
 */
export async function fetchPricesClientSide(
  tickers: string[]
): Promise<Record<string, YahooQuoteResult>> {
  if (tickers.length === 0) return {};

  const results: Record<string, YahooQuoteResult> = {};
  const failed: string[] = [];

  // Fetch all tickers in parallel from the browser — each user has their own IP.
  // Yahoo allows several hundred requests/min per IP so this is fine.
  await Promise.all(
    tickers.map(async (ticker) => {
      const r = await fetchTickerBrowser(ticker);
      if (r) {
        results[ticker] = r;
      } else {
        failed.push(ticker);
      }
    })
  );

  // For any tickers that failed, fall back to the DB cache
  if (failed.length > 0) {
    const cached = await fetchServerSideFallback(failed);
    for (const [t, r] of Object.entries(cached)) {
      results[t] = r;
    }
  }

  return results;
}

/**
 * Fetch historical daily prices for a given ticker from Yahoo Finance v8.
 * Using `interval=1d` and `range=10y` (or `max`).
 */
export async function fetchHistoricalPricesClientSide(
  tickers: string[]
): Promise<Record<string, YahooHistoryResult>> {
  if (tickers.length === 0) return {};

  const results: Record<string, YahooHistoryResult> = {};

  await Promise.all(
    tickers.map(async (ticker) => {
      try {
        const baseUrl = import.meta.env.DEV
          ? "/api/yf"
          : "https://query2.finance.yahoo.com";

        // Fetch up to 10 years of daily data
        const url = `${baseUrl}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=10y`;

        const resp = await fetch(url, {
          signal: AbortSignal.timeout(YAHOO_TIMEOUT_MS * 2), // slightly longer timeout for history
          headers: { "Accept": "application/json" },
        });

        if (!resp.ok) return;

        const data = await resp.json();
        const result = data?.chart?.result?.[0];

        if (!result || !result.timestamp || !result.indicators?.quote?.[0]?.close) {
          return;
        }

        const timestamps: number[] = result.timestamp;
        const closes: (number | null)[] = result.indicators.quote[0].close;
        const currency: string | undefined = result.meta?.currency;
        const symbol: string | undefined = result.meta?.symbol;

        // Filter out null closes to maintain parallel arrays cleanly
        const validTimestamps: number[] = [];
        const validCloses: number[] = [];

        for (let i = 0; i < timestamps.length; i++) {
          if (closes[i] != null) {
            validTimestamps.push(timestamps[i]);
            validCloses.push(closes[i] as number);
          }
        }

        if (validTimestamps.length > 0) {
          results[ticker] = {
            timestamps: validTimestamps,
            closes: validCloses,
            currency,
            symbol,
          };
        }
      } catch (e) {
        console.warn(`Failed to fetch history for ${ticker}`, e);
      }
    })
  );

  return results;
}
