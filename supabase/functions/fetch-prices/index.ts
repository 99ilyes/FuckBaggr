
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import yahooFinance from "https://esm.sh/yahoo-finance2@2.13.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fetch a single quote via yahoo-finance2, retry once on rate-limit
async function fetchQuoteWithRetry(ticker: string): Promise<any | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const q = await yahooFinance.quote(ticker);
      return q;
    } catch (err: any) {
      const msg = String(err);
      const isRateLimit = msg.includes("Too Many Requests") || msg.includes("429");
      if (isRateLimit && attempt === 1) {
        console.warn(`Rate limit for ${ticker}, retrying after 2s...`);
        await delay(2000);
        continue;
      }
      console.error(`Quote error for ${ticker} (attempt ${attempt}):`, err);
      return null;
    }
  }
  return null;
}

// Fetch fundamentals via Yahoo Finance v7 quote API (direct HTTP)
async function fetchFundamentals(ticker: string): Promise<any | null> {
  const fields = "trailingPE,forwardPE,trailingEps,forwardEps,regularMarketPrice,longName,currency,sector,industry";
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}&fields=${fields}`;
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
  };

  try {
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      // Retry once on rate-limit
      if (resp.status === 429 || resp.status === 403) {
        await delay(2000);
        const resp2 = await fetch(url, { headers });
        if (!resp2.ok) return null;
        const json = await resp2.json();
        return json?.quoteResponse?.result?.[0] ?? null;
      }
      return null;
    }
    const json = await resp.json();
    return json?.quoteResponse?.result?.[0] ?? null;
  } catch (e) {
    console.error(`Fundamentals fetch error for ${ticker}:`, e);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: corsHeaders });
    }

    let { tickers, mode } = body;

    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return new Response(JSON.stringify({ error: "tickers array required" }), { status: 400, headers: corsHeaders });
    }

    const uniqueTickers = [...new Set(tickers)] as string[];

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
      yahooFinance.suppressNotices(["yahooSurvey"]);
    } catch {}

    // --- MODE: FUNDAMENTALS ---
    if (mode === "fundamentals") {
      const results: Record<string, any> = {};

      for (const t of uniqueTickers) {
        const data = await fetchFundamentals(t);

        if (data) {
          results[t] = {
            trailingPE: data.trailingPE ?? null,
            forwardPE: data.forwardPE ?? null,
            trailingEps: data.trailingEps ?? null,
            forwardEps: data.forwardEps ?? null,
            currentPrice: data.regularMarketPrice ?? null,
            currency: data.currency ?? "USD",
            name: data.longName ?? data.shortName ?? t,
            sector: data.sector ?? null,
            industry: data.industry ?? null,
          };
        } else {
          results[t] = {
            trailingPE: null,
            forwardPE: null,
            trailingEps: null,
            forwardEps: null,
            currentPrice: null,
            currency: "USD",
            name: t,
            sector: null,
            industry: null,
          };
        }

        // Sequential: 500ms pause between tickers
        if (uniqueTickers.indexOf(t) < uniqueTickers.length - 1) {
          await delay(500);
        }
      }

      return new Response(JSON.stringify({ results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- MODE DEFAULT: PRICES ---

    // 1. Load Cache
    const { data: cachedAssets } = await supabase
      .from("assets_cache")
      .select("ticker, last_price, previous_close, name, currency, updated_at")
      .in("ticker", uniqueTickers);

    const cacheMap: Record<string, any> = {};
    for (const row of cachedAssets ?? []) {
      cacheMap[row.ticker] = row;
    }

    const results: Record<string, any> = {};
    let liveCount = 0;
    let cacheCount = 0;

    // 2. Fetch Live Data — fully sequential with 500ms delay
    for (const t of uniqueTickers) {
      const q = await fetchQuoteWithRetry(t);

      if (q?.regularMarketPrice != null) {
        const price = q.regularMarketPrice;
        const prevClose = q.regularMarketPreviousClose ?? q.chartPreviousClose ?? price;
        const change = q.regularMarketChange ?? (price - prevClose);
        const changePercent = q.regularMarketChangePercent ?? (prevClose !== 0 ? (change / prevClose) * 100 : 0);

        results[t] = {
          price,
          previousClose: prevClose,
          name: q.longName ?? q.shortName ?? q.symbol ?? t,
          currency: q.currency ?? "USD",
          change,
          changePercent,
          fromCache: false,
        };
        liveCount++;
      } else if (cacheMap[t]?.last_price != null) {
        console.info(`Cache fallback for ${t}: ${cacheMap[t].last_price} (last updated: ${cacheMap[t].updated_at})`);
        results[t] = {
          price: cacheMap[t].last_price,
          previousClose: cacheMap[t].previous_close ?? null,
          name: cacheMap[t].name ?? t,
          currency: cacheMap[t].currency ?? "USD",
          change: 0,
          changePercent: 0,
          fromCache: true,
        };
        cacheCount++;
      } else {
        results[t] = { price: null, previousClose: null, change: null, changePercent: null, name: t, currency: "USD", fromCache: false };
      }

      // Sequential: 500ms pause between tickers
      if (uniqueTickers.indexOf(t) < uniqueTickers.length - 1) {
        await delay(500);
      }
    }

    console.info(`[fetch-prices] Done: ${liveCount} live, ${cacheCount} from cache, out of ${uniqueTickers.length} tickers`);

    // 3. Update Cache with live data
    const toUpsert = Object.entries(results)
      .filter(([, info]: [string, any]) => info?.price != null && !info.fromCache)
      .map(([ticker, info]: [string, any]) => ({
        ticker,
        last_price: info.price,
        previous_close: info.previousClose,
        name: info.name,
        currency: info.currency,
        updated_at: new Date().toISOString(),
      }));

    if (toUpsert.length > 0) {
      await supabase.from("assets_cache").upsert(toUpsert, { onConflict: "ticker" });
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
