import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import yahooFinance from "https://esm.sh/yahoo-finance2@2.13.3";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Fetch a single ticker with one retry on rate-limit errors */
async function fetchQuoteWithRetry(ticker: string): Promise<any | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const q = await yahooFinance.quote(ticker);
      return q;
    } catch (err: any) {
      const msg = String(err);
      const isRateLimit =
        msg.includes("Too Many Requests") ||
        msg.includes("429") ||
        msg.includes("Unexpected token 'T'");

      if (isRateLimit && attempt === 0) {
        console.warn(`Rate limit for ${ticker}, retrying after 2s...`);
        await delay(2000);
        continue;
      }
      // Log non-rate-limit errors or second attempt failures
      console.error(`Quote error for ${ticker} (attempt ${attempt + 1}):`, err);
      return null;
    }
  }
  return null;
}

// ─── Main handler ───────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let { tickers, mode } = body;
    if (typeof body === "string") {
      try {
        const p = JSON.parse(body);
        tickers = p.tickers;
        mode = p.mode;
      } catch {}
    }
    if (!tickers && body.body) {
      let i = body.body;
      if (typeof i === "string") {
        try {
          i = JSON.parse(i);
        } catch {}
      }
      if (i.tickers) {
        tickers = i.tickers;
        mode = i.mode;
      }
    }

    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return new Response(JSON.stringify({ error: "tickers array required", debugBody: body }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const uniqueTickers = [...new Set(tickers)] as string[];

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // --- MODE: FUNDAMENTALS ---
    if (mode === "fundamentals") {
      const results: Record<string, any> = {};
      try {
        yahooFinance.suppressNotices(["yahooSurvey"]);
      } catch {}

      for (const t of uniqueTickers) {
        const q = await fetchQuoteWithRetry(t);
        if (q) {
          results[t] = {
            currentPrice: q.regularMarketPrice,
            currency: q.currency,
            name: q.longName || q.shortName || q.symbol || t,
            trailingPE: q.trailingPE ?? null,
            forwardPE: q.forwardPE ?? null,
            trailingEps: q.epsTrailingTwelveMonths ?? null,
            forwardEps: q.epsForward ?? null,
            sector: null,
            industry: null,
          };
        } else {
          results[t] = { error: "Failed to fetch after retry" };
        }
        await delay(400);
      }
      return new Response(JSON.stringify({ results, debugMode: mode }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- MODE DEFAULT: PRICES ---
    // Load existing cache entries for fallback
    const { data: cachedAssets } = await supabase
      .from("assets_cache")
      .select("ticker, last_price, previous_close, name, currency, updated_at")
      .in("ticker", uniqueTickers);

    const cacheMap: Record<string, any> = {};
    for (const row of cachedAssets ?? []) {
      cacheMap[row.ticker] = row;
    }

    const results: Record<string, any> = {};
    try {
      yahooFinance.suppressNotices(["yahooSurvey"]);
    } catch {}

    for (const t of uniqueTickers) {
      const q = await fetchQuoteWithRetry(t);

      if (q && q.regularMarketPrice != null) {
        results[t] = {
          price: q.regularMarketPrice,
          previousClose: q.regularMarketPreviousClose ?? null,
          name: q.longName ?? q.shortName ?? q.symbol ?? t,
          currency: q.currency ?? "USD",
          fromCache: false,
        };
        console.log(`Live price for ${t}: ${results[t].price}`);
      } else if (cacheMap[t]?.last_price != null) {
        // Fallback: return cached value so UI never shows null
        results[t] = {
          price: cacheMap[t].last_price,
          previousClose: cacheMap[t].previous_close ?? null,
          name: cacheMap[t].name ?? t,
          currency: cacheMap[t].currency ?? "USD",
          fromCache: true,
        };
        console.log(`Cache fallback for ${t}: ${results[t].price} (last updated: ${cacheMap[t].updated_at})`);
      } else {
        results[t] = { price: null, previousClose: null, name: t, currency: "USD", fromCache: false };
        console.warn(`No data available for ${t}`);
      }

      await delay(400);
    }

    // Upsert live prices into assets_cache
    const toUpsert = Object.entries(results)
      .filter(([, info]: [string, any]) => info?.price != null && !info.fromCache)
      .map(([ticker, info]: [string, any]) => ({
        ticker,
        last_price: info.price,
        previous_close: info.previousClose,
        name: info.name,
        currency: info.currency,
        sector: "",
        updated_at: new Date().toISOString(),
      }));

    if (toUpsert.length > 0) {
      try {
        await supabase.from("assets_cache").upsert(toUpsert, { onConflict: "ticker" });
      } catch (cacheErr) {
        console.error("Cache upsert error:", cacheErr);
      }
    }

    const liveCount = Object.values(results).filter((r: any) => r.price != null && !r.fromCache).length;
    const cacheCount = Object.values(results).filter((r: any) => r.fromCache).length;
    console.log(
      `[fetch-prices] Done: ${liveCount} live, ${cacheCount} from cache, out of ${uniqueTickers.length} tickers`
    );

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
