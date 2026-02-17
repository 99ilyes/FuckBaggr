/**
 * Client-side Yahoo Finance price fetcher.
 * Uses the Vite dev proxy (/api/yf/) to bypass CORS restrictions.
 * The proxy forwards requests to query1.finance.yahoo.com server-side.
 */

interface YahooQuoteResult {
    price: number | null;
    previousClose: number | null;
    name: string;
    currency: string;
}

/**
 * Fetch a single ticker's price via Yahoo Finance v8 chart API through the Vite proxy.
 */
async function fetchSingleQuote(ticker: string): Promise<YahooQuoteResult> {
    const url = `/api/yf/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
    const resp = await fetch(url);

    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Yahoo Finance HTTP ${resp.status}: ${text.substring(0, 200)}`);
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
 * Fetch prices for multiple tickers with rate-limit-friendly batching.
 * Returns a map of ticker → quote result.
 */
export async function fetchPricesClientSide(
    tickers: string[]
): Promise<Record<string, YahooQuoteResult>> {
    const results: Record<string, YahooQuoteResult> = {};
    const BATCH_SIZE = 5;

    for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
        const batch = tickers.slice(i, i + BATCH_SIZE);
        const promises = batch.map(async (t) => {
            try {
                results[t] = await fetchSingleQuote(t);
            } catch (err) {
                console.warn(`Price fetch failed for ${t}:`, err);
                results[t] = { price: null, previousClose: null, name: t, currency: "USD" };
            }
        });
        await Promise.all(promises);
        // Small delay between batches to avoid rate limits
        if (i + BATCH_SIZE < tickers.length) {
            await new Promise((r) => setTimeout(r, 300));
        }
    }

    return results;
}
