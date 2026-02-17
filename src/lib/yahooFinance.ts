/**
 * Unified price fetcher.
 * - In dev mode: uses Vite proxy (/api/yf/) to bypass CORS.
 * - In production: uses the Supabase edge function (fetch-prices).
 */

import { supabase } from "@/integrations/supabase/client";

export interface YahooQuoteResult {
    price: number | null;
    previousClose: number | null;
    name: string;
    currency: string;
}

/**
 * Fetch a single ticker via the Vite dev proxy (only works in dev).
 */
async function fetchViaProxy(ticker: string): Promise<YahooQuoteResult> {
    const url = `/api/yf/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
    const resp = await fetch(url);

    if (!resp.ok) {
        throw new Error(`Proxy HTTP ${resp.status}`);
    }

    // Check if we got HTML back (proxy not available → served index.html)
    const contentType = resp.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
        throw new Error("Proxy not available (got HTML response)");
    }

    const data = await resp.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error(`No chart data for ${ticker}`);

    return {
        price: meta.regularMarketPrice ?? null,
        previousClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
        name: meta.longName ?? meta.shortName ?? meta.symbol ?? ticker,
        currency: meta.currency ?? "USD",
    };
}

/**
 * Fetch prices for multiple tickers via the Supabase edge function.
 * Works in both dev and production.
 */
async function fetchViaEdgeFunction(
    tickers: string[]
): Promise<Record<string, YahooQuoteResult>> {
    const { data, error } = await supabase.functions.invoke("fetch-prices", {
        body: { tickers },
    });

    if (error) {
        throw new Error(`Edge function error: ${error.message}`);
    }

    if (!data?.results) {
        throw new Error("Edge function returned no results");
    }

    const results: Record<string, YahooQuoteResult> = {};
    for (const [ticker, info] of Object.entries(data.results as Record<string, any>)) {
        results[ticker] = {
            price: info?.price ?? null,
            previousClose: info?.previousClose ?? null,
            name: info?.name ?? ticker,
            currency: info?.currency ?? "USD",
        };
    }
    return results;
}

// Cache whether the proxy is available to avoid retrying every time
let proxyAvailable: boolean | null = null;

/**
 * Detect if the Vite dev proxy is available by trying a single request.
 */
async function isProxyAvailable(): Promise<boolean> {
    if (proxyAvailable !== null) return proxyAvailable;

    try {
        const resp = await fetch("/api/yf/v8/finance/chart/AAPL?interval=1d&range=1d", {
            signal: AbortSignal.timeout(3000),
        });
        const contentType = resp.headers.get("content-type") || "";
        if (!resp.ok || contentType.includes("text/html")) {
            proxyAvailable = false;
        } else {
            proxyAvailable = true;
        }
    } catch {
        proxyAvailable = false;
    }

    console.log(`[YahooFinance] Proxy available: ${proxyAvailable}`);
    return proxyAvailable;
}

/**
 * Unified price fetcher. Automatically chooses the best method:
 * - Dev proxy if available (faster, no edge function limits)
 * - Supabase edge function otherwise (works in production)
 */
export async function fetchPricesClientSide(
    tickers: string[]
): Promise<Record<string, YahooQuoteResult>> {
    if (tickers.length === 0) return {};

    const useProxy = await isProxyAvailable();

    if (useProxy) {
        // Dev mode: use proxy with batching
        const results: Record<string, YahooQuoteResult> = {};
        const BATCH_SIZE = 5;

        for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
            const batch = tickers.slice(i, i + BATCH_SIZE);
            const promises = batch.map(async (t) => {
                try {
                    results[t] = await fetchViaProxy(t);
                } catch (err) {
                    console.warn(`Proxy fetch failed for ${t}:`, err);
                    results[t] = { price: null, previousClose: null, name: t, currency: "USD" };
                }
            });
            await Promise.all(promises);
            if (i + BATCH_SIZE < tickers.length) {
                await new Promise((r) => setTimeout(r, 300));
            }
        }

        // If most tickers got null prices, the proxy might be broken; try edge function
        const successCount = Object.values(results).filter((r) => r.price !== null).length;
        if (successCount === 0 && tickers.length > 0) {
            console.warn("[YahooFinance] Proxy returned no prices, falling back to edge function");
            proxyAvailable = false; // Don't retry proxy
            return fetchViaEdgeFunction(tickers);
        }

        return results;
    }

    // Production: use edge function
    console.log(`[YahooFinance] Using edge function for ${tickers.length} tickers`);
    return fetchViaEdgeFunction(tickers);
}
