import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Direct Yahoo Finance v8 API call — more reliable than the yahoo-finance2 npm package
async function fetchQuote(ticker: string): Promise<{
  price: number | null;
  previousClose: number | null;
  name: string;
  currency: string;
}> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });

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

// Batch fetch using v7 quote endpoint (up to 50 symbols at once)
async function fetchQuotesBatch(tickers: string[]): Promise<Record<string, any>> {
  const symbols = tickers.join(",");
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`;
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });

  if (!resp.ok) {
    // Fallback to individual requests if batch fails
    return {};
  }

  const data = await resp.json();
  const quotes = data?.quoteResponse?.result || [];
  const results: Record<string, any> = {};
  for (const q of quotes) {
    results[q.symbol] = {
      price: q.regularMarketPrice ?? null,
      previousClose: q.regularMarketPreviousClose ?? null,
      name: q.shortName ?? q.longName ?? q.symbol,
      currency: q.currency ?? "USD",
    };
  }
  return results;
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
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let { tickers, mode } = body;
    if (typeof body === "string") {
      try { const p = JSON.parse(body); tickers = p.tickers; mode = p.mode; } catch { }
    }
    if (!tickers && body.body) {
      let i = body.body;
      if (typeof i === "string") { try { i = JSON.parse(i); } catch { } }
      if (i.tickers) { tickers = i.tickers; mode = i.mode; }
    }

    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return new Response(
        JSON.stringify({ error: "tickers array required", debugBody: body }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const uniqueTickers = [...new Set(tickers)] as string[];

    // --- MODE: FUNDAMENTALS ---
    if (mode === "fundamentals") {
      const results: Record<string, any> = {};
      for (const t of uniqueTickers) {
        try {
          const q = await fetchQuote(t);
          results[t] = {
            currentPrice: q.price,
            currency: q.currency,
            name: q.name,
          };
        } catch (err) {
          console.error(`Fundamentals error for ${t}:`, err);
          results[t] = { error: String(err) };
        }
      }
      return new Response(
        JSON.stringify({ results, debugMode: mode }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- MODE DEFAULT: PRICES ---
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Try batch first, fall back to individual
    let results: Record<string, any> = {};

    try {
      results = await fetchQuotesBatch(uniqueTickers);
    } catch (e) {
      console.warn("Batch fetch failed, trying individual:", e);
    }

    // Fetch any missing tickers individually
    const missing = uniqueTickers.filter((t) => !results[t] || results[t].price === null);
    const BATCH_SIZE = 3;

    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
      const batch = missing.slice(i, i + BATCH_SIZE);
      const promises = batch.map(async (t) => {
        try {
          const q = await fetchQuote(t);
          results[t] = q;
        } catch (err) {
          console.error(`Quote error for ${t}:`, err);
          results[t] = { price: null, previousClose: null, name: t, currency: "USD", error: String(err) };
        }
      });
      await Promise.all(promises);
      // Small delay between batches to avoid rate limits
      if (i + BATCH_SIZE < missing.length) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    // Upsert into assets_cache
    for (const [ticker, info] of Object.entries(results)) {
      if (info?.price != null) {
        try {
          await supabase.from("assets_cache").upsert(
            {
              ticker,
              last_price: info.price,
              previous_close: info.previousClose,
              name: info.name,
              currency: info.currency,
              sector: "",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "ticker" }
          );
        } catch (cacheErr) {
          console.error(`Cache upsert error for ${ticker}:`, cacheErr);
        }
      }
    }

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
