import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import yahooFinance from "https://esm.sh/yahoo-finance2@2.13.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Main handler ────────────────────────────────────────────────────────────
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
    // Handle potential double-encoding or nested body structure
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

      // Suppress console spam from library
      try { yahooFinance.suppressNotices(['yahooSurvey']); } catch { }

      for (const t of uniqueTickers) {
        try {
          const q = await yahooFinance.quote(t);
          results[t] = {
            currentPrice: q.regularMarketPrice,
            currency: q.currency,
            name: q.longName || q.shortName || q.symbol || t,
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

    const results: Record<string, any> = {};

    // Use the library's batching or just map promises
    // The library handles cookies/crumbs automatically
    try { yahooFinance.suppressNotices(['yahooSurvey']); } catch { }

    const promises = uniqueTickers.map(async (t) => {
      try {
        const q = await yahooFinance.quote(t);
        results[t] = {
          price: q.regularMarketPrice ?? null,
          previousClose: q.regularMarketPreviousClose ?? null,
          name: q.longName ?? q.shortName ?? q.symbol ?? t,
          currency: q.currency ?? "USD",
        };
      } catch (err) {
        console.error(`Quote error for ${t}:`, err);
        // Return structure even on error so client doesn't break
        results[t] = { price: null, previousClose: null, name: t, currency: "USD", error: String(err) };
      }
    });

    await Promise.all(promises);

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

    const successCount = Object.values(results).filter((r: any) => r.price != null).length;
    console.log(`[fetch-prices] Done: ${successCount}/${uniqueTickers.length} tickers fetched`);

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
