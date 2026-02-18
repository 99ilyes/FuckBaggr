/**
 * Unified price fetcher.
 * Always uses the Supabase edge function (fetch-prices).
 * The dev proxy is kept as an optional fast path when explicitly available,
 * but we no longer spend 3s probing it on every page load.
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

/**
 * Fetch a single ticker via the Vite dev proxy (only works in local dev).
 */
async function fetchViaProxy(ticker: string): Promise<YahooQuoteResult> {
    const url = `/api/yf/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(4000) });

    if (!resp.ok) throw new Error(`Proxy HTTP ${resp.status}`);

    const contentType = resp.headers.get("content-type") || "";
    if (contentType.includes("text/html")) throw new Error("Proxy not available (got HTML)");

    const data = await resp.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error(`No chart data for ${ticker}`);

    return {
        price: meta.regularMarketPrice ?? null,
        previousClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
        name: meta.longName ?? meta.shortName ?? meta.symbol ?? ticker,
        currency: meta.currency ?? "USD",
        change: meta.regularMarketChange,
        changePercent: meta.regularMarketChangePercent,
    };
}

/**
 * Fetch prices for multiple tickers via the Supabase edge function.
 * Works in both dev and production. The edge function returns cached prices
 * as a fallback when Yahoo Finance rate-limits, so the result is never empty.
 */
async function fetchViaEdgeFunction(
    tickers: string[]
): Promise<Record<string, YahooQuoteResult>> {
    const { data, error } = await supabase.functions.invoke("fetch-prices", {
        body: { tickers },
    });

    if (error) throw new Error(`Edge function error: ${error.message}`);
    if (!data?.results) throw new Error("Edge function returned no results");

    const results: Record<string, YahooQuoteResult> = {};
    for (const [ticker, info] of Object.entries(data.results as Record<string, any>)) {
        results[ticker] = {
            price: info?.price ?? null,
            previousClose: info?.previousClose ?? null,
            name: info?.name ?? ticker,
            currency: info?.currency ?? "USD",
            change: info?.change,
            changePercent: info?.changePercent,
            fromCache: info?.fromCache ?? false,
        };
    }
    return results;
}

// In dev, we do a single quick probe to see if the Vite proxy is available.
// We cache the result so we only probe once per session.
let _proxyAvailable: boolean | null = null;

async function isDevProxyAvailable(): Promise<boolean> {
    if (_proxyAvailable !== null) return _proxyAvailable;

    // Only bother in dev (Vite serves on localhost)
    if (!import.meta.env.DEV) {
        _proxyAvailable = false;
        return false;
    }

    try {
        const resp = await fetch("/api/yf/v8/finance/chart/AAPL?interval=1d&range=1d", {
            signal: AbortSignal.timeout(2000),
        });
        const contentType = resp.headers.get("content-type") || "";
        _proxyAvailable = resp.ok && !contentType.includes("text/html");
    } catch {
        _proxyAvailable = false;
    }

    console.log(`[YahooFinance] Dev proxy available: ${_proxyAvailable}`);
    return _proxyAvailable;
}

/**
 * Unified price fetcher.
 * - In dev: tries the Vite proxy first (fast, no cold-start).
 * - In production: goes straight to the edge function.
 * The edge function falls back to DB cache if Yahoo rate-limits, so
 * the caller always gets prices rather than empty results.
 */
export async function fetchPricesClientSide(
    tickers: string[]
): Promise<Record<string, YahooQuoteResult>> {
    if (tickers.length === 0) return {};

    const useProxy = await isDevProxyAvailable();

    if (useProxy) {
        const results: Record<string, YahooQuoteResult> = {};
        const BATCH_SIZE = 5;

        for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
            const batch = tickers.slice(i, i + BATCH_SIZE);
            await Promise.all(
                batch.map(async (t) => {
                    try {
                        results[t] = await fetchViaProxy(t);
                    } catch (err) {
                        console.warn(`Proxy fetch failed for ${t}:`, err);
                        results[t] = { price: null, previousClose: null, change: null, changePercent: null, name: t, currency: "USD" };
                    }
                })
            );
            if (i + BATCH_SIZE < tickers.length) {
                await new Promise((r) => setTimeout(r, 300));
            }
        }

        // If nothing came back, fall through to edge function
        const successCount = Object.values(results).filter((r) => r.price !== null).length;
        if (successCount === 0 && tickers.length > 0) {
            console.warn("[YahooFinance] Proxy returned no prices, falling back to edge function");
            _proxyAvailable = false;
            return fetchViaEdgeFunction(tickers);
        }

        return results;
    }

    // Production (or dev proxy unavailable): use edge function directly
    return fetchViaEdgeFunction(tickers);
}
