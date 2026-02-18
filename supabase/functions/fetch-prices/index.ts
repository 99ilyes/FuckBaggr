
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { tickers, mode, prices } = body;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── MODE: cache-only ────────────────────────────────────────────────────────
    // Read cached prices from DB and return them immediately. No Yahoo call.
    if (mode === "cache-only") {
      if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
        return new Response(JSON.stringify({ results: {} }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: rows } = await supabase
        .from("assets_cache")
        .select("ticker, last_price, previous_close, name, currency, updated_at")
        .in("ticker", tickers);

      const results: Record<string, any> = {};
      for (const row of rows ?? []) {
        results[row.ticker] = {
          price: row.last_price,
          previousClose: row.previous_close,
          name: row.name ?? row.ticker,
          currency: row.currency ?? "USD",
          fromCache: true,
        };
      }

      return new Response(JSON.stringify({ results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── MODE: persist ───────────────────────────────────────────────────────────
    // The browser has already fetched live prices; persist them to the DB cache.
    if (mode === "persist") {
      if (!prices || typeof prices !== "object") {
        return new Response(JSON.stringify({ ok: false, error: "prices object required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const toUpsert = Object.entries(prices)
        .filter(([, info]: [string, any]) => info?.price != null)
        .map(([ticker, info]: [string, any]) => ({
          ticker,
          last_price: info.price,
          previous_close: info.previousClose ?? null,
          name: info.name ?? ticker,
          currency: info.currency ?? "USD",
          updated_at: new Date().toISOString(),
        }));

      if (toUpsert.length > 0) {
        await supabase.from("assets_cache").upsert(toUpsert, { onConflict: "ticker" });
        console.info(`[fetch-prices] Persisted ${toUpsert.length} prices to cache`);
      }

      return new Response(JSON.stringify({ ok: true, persisted: toUpsert.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── MODE: fundamentals ──────────────────────────────────────────────────────
    // Return empty — fundamentals are fetched client-side or via a separate function.
    if (mode === "fundamentals") {
      return new Response(JSON.stringify({ results: {} }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── LEGACY MODE: prices (kept for backward compat) ─────────────────────────
    // Just return cache data; actual Yahoo fetching is now done in the browser.
    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return new Response(JSON.stringify({ results: {} }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const uniqueTickers = [...new Set(tickers)] as string[];

    const { data: cachedAssets } = await supabase
      .from("assets_cache")
      .select("ticker, last_price, previous_close, name, currency, updated_at")
      .in("ticker", uniqueTickers);

    const results: Record<string, any> = {};
    for (const row of cachedAssets ?? []) {
      results[row.ticker] = {
        price: row.last_price,
        previousClose: row.previous_close,
        name: row.name ?? row.ticker,
        currency: row.currency ?? "USD",
        fromCache: true,
      };
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
