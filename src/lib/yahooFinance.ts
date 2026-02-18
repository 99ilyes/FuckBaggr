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
  fromCache?: boolean;
}

const YAHOO_TIMEOUT_MS = 5000;

/** Fetch a single ticker directly from Yahoo Finance v8 (browser → unique IP). */
async function fetchTickerBrowser(ticker: string): Promise<YahooQuoteResult | null> {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d&includePrePost=false`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(YAHOO_TIMEOUT_MS),
      headers: {
        "Accept": "application/json",
      },
    });

    if (!resp.ok) return null;

    const data = await resp.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta || meta.regularMarketPrice == null) return null;

    const price = meta.regularMarketPrice as number;
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
      fromCache: false,
    };
  } catch {
    return null;
  }
}

/**
 * Read cached prices from DB via edge function (instant, no Yahoo call).
 * Used as fallback when browser fetch fails.
 */
async function fetchFromDbCache(
  tickers: string[]
): Promise<Record<string, YahooQuoteResult>> {
  try {
    const { data, error } = await supabase.functions.invoke("fetch-prices", {
      body: { tickers, mode: "cache-only" },
    });
    if (error || !data?.results) return {};
    const results: Record<string, YahooQuoteResult> = {};
    for (const [t, info] of Object.entries(data.results as Record<string, any>)) {
      if (info?.price != null) {
        results[t] = {
          price: info.price,
          previousClose: info.previousClose ?? null,
          name: info.name ?? t,
          currency: info.currency ?? "USD",
          change: 0,
          changePercent: 0,
          fromCache: true,
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
    const cached = await fetchFromDbCache(failed);
    for (const [t, r] of Object.entries(cached)) {
      results[t] = r;
    }
  }

  return results;
}
