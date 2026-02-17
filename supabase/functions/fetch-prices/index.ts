import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import yahooFinance from "https://esm.sh/yahoo-finance2@2.3.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function quoteSingle(ticker: string) {
  return await yahooFinance.quote(ticker);
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
      try { const p = JSON.parse(body); tickers = p.tickers; mode = p.mode; } catch {}
    }
    if (!tickers && body.body) {
      let i = body.body;
      if (typeof i === "string") { try { i = JSON.parse(i); } catch {} }
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
          const q = await quoteSingle(t);
          results[t] = {
            trailingEps: q.epsTrailingTwelveMonths ?? null,
            forwardEps: q.epsForward ?? null,
            trailingPE: q.trailingPE ?? null,
            forwardPE: q.forwardPE ?? null,
            currentPrice: q.regularMarketPrice ?? null,
            currency: q.currency ?? "USD",
            name: q.shortName ?? q.longName ?? q.symbol,
            sector: (q as any).sector ?? null,
            industry: (q as any).industry ?? null,
          };
        } catch (err) {
          console.error(`Fundamentals error for ${t}:`, err);
          results[t] = { error: String(err) };
        }
      }
      return new Response(
        JSON.stringify({ results, debugMode: mode, source: "yahoo-finance2" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- MODE DEFAULT: PRICES ---
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const results: Record<string, any> = {};
    const BATCH_SIZE = 5;

    for (let i = 0; i < uniqueTickers.length; i += BATCH_SIZE) {
      const batch = uniqueTickers.slice(i, i + BATCH_SIZE);
      const promises = batch.map(async (t) => {
        try {
          const q = await quoteSingle(t);
          const price = q.regularMarketPrice ?? null;
          const previousClose = q.regularMarketPreviousClose ?? null;
          const name = q.shortName ?? q.longName ?? q.symbol;
          const currency = q.currency ?? "USD";

          results[t] = { price, previousClose, name, currency };

          try {
            await supabase.from("assets_cache").upsert(
              {
                ticker: q.symbol,
                last_price: price,
                previous_close: previousClose,
                name,
                currency,
                sector: "",
                updated_at: new Date().toISOString(),
              },
              { onConflict: "ticker" }
            );
          } catch (cacheErr) {
            console.error(`Cache upsert error for ${t}:`, cacheErr);
          }
        } catch (err) {
          console.error(`Quote error for ${t}:`, err);
          results[t] = { price: null, previousClose: null, name: t, currency: "USD", error: String(err) };
        }
      });
      await Promise.all(promises);
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
