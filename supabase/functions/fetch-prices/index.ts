import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { tickers, mode } = body;

    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return new Response(JSON.stringify({ error: "tickers array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- MODE: HISTORY ---
    if (mode === "history") {
      const range = body.range || "5y";
      const interval = body.interval || "1wk";
      const results: Record<string, any> = {};

      for (const ticker of tickers) {
        try {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;
          const response = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0" },
          });

          if (!response.ok) {
            console.error(`Failed to fetch history for ${ticker}: ${response.status}`);
            results[ticker] = { error: `HTTP ${response.status}` };
            continue;
          }

          const data = await response.json();
          const result = data.chart?.result?.[0];

          if (!result) {
            results[ticker] = { error: "No data" };
            continue;
          }

          const meta = result.meta;
          const timestamp = result.timestamp || [];
          const quote = result.indicators?.quote?.[0] || {};
          const close = quote.close || [];

          const history = timestamp
            .map((t: number, i: number) => ({ time: t, price: close[i] }))
            .filter((item: any) => item.price !== null && item.price !== undefined);

          results[ticker] = {
            symbol: meta.symbol,
            currency: meta.currency,
            history,
          };
        } catch (err) {
          console.error(`Error fetching history for ${ticker}:`, err);
          results[ticker] = { error: String(err) };
        }
      }

      return new Response(JSON.stringify({ results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- MODE: DEFAULT (current prices + upsert cache) ---
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const results: Record<string, any> = {};

    for (const ticker of tickers) {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
        const response = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0" },
        });

        if (!response.ok) {
          console.error(`Failed to fetch ${ticker}: ${response.status}`);
          results[ticker] = { error: `HTTP ${response.status}` };
          continue;
        }

        const data = await response.json();
        const meta = data.chart?.result?.[0]?.meta;
        if (!meta) {
          results[ticker] = { error: "No data" };
          continue;
        }

        const price = meta.regularMarketPrice || 0;
        const previousClose = meta.chartPreviousClose || meta.previousClose || null;
        const name = meta.shortName || meta.longName || ticker;
        const currency = meta.currency || "USD";

        // Upsert into assets_cache
        const { error: upsertError } = await supabase
          .from("assets_cache")
          .upsert(
            {
              ticker,
              last_price: price,
              previous_close: previousClose,
              name,
              currency,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "ticker" }
          );

        if (upsertError) {
          console.error(`Upsert error for ${ticker}:`, upsertError);
        }

        results[ticker] = { price, previousClose, name, currency };
      } catch (err) {
        console.error(`Error fetching ${ticker}:`, err);
        results[ticker] = { error: String(err) };
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
