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

    // --- MODE: FUNDAMENTALS ---
    if (mode === "fundamentals") {
      const results: Record<string, any> = {};

      for (const ticker of tickers) {
        try {
          const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=defaultKeyStatistics,financialData,price,earningsTrend`;
          const response = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0" },
          });

          if (!response.ok) {
            console.error(`Failed to fetch fundamentals for ${ticker}: ${response.status}`);
            results[ticker] = { error: `HTTP ${response.status}` };
            continue;
          }

          const data = await response.json();
          const summary = data.quoteSummary?.result?.[0];

          if (!summary) {
            results[ticker] = { error: "No data" };
            continue;
          }

          const keyStats = summary.defaultKeyStatistics || {};
          const financialData = summary.financialData || {};
          const priceData = summary.price || {};

          results[ticker] = {
            trailingEps: keyStats.trailingEps?.raw ?? financialData.trailingEps?.raw ?? null,
            forwardEps: keyStats.forwardEps?.raw ?? financialData.forwardEps?.raw ?? null,
            trailingPE: keyStats.trailingPE?.raw ?? priceData.trailingPE?.raw ?? null,
            forwardPE: keyStats.forwardPE?.raw ?? priceData.forwardPE?.raw ?? null,
            currentPrice: priceData.regularMarketPrice?.raw ?? financialData.currentPrice?.raw ?? null,
            currency: priceData.currency ?? "USD",
            name: priceData.shortName ?? priceData.longName ?? ticker,
            sector: priceData.sector ?? null,
            industry: priceData.industry ?? null,
          };
        } catch (err) {
          console.error(`Error fetching fundamentals for ${ticker}:`, err);
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

    const fetchTicker = async (ticker: string) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
        const response = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0" },
        });

        if (!response.ok) {
          console.error(`Failed to fetch ${ticker}: ${response.status}`);
          return { ticker, result: { error: `HTTP ${response.status}` } };
        }

        const data = await response.json();
        const meta = data.chart?.result?.[0]?.meta;
        if (!meta) return { ticker, result: { error: "No data" } };

        const price = meta.regularMarketPrice || 0;
        const previousClose = meta.chartPreviousClose || meta.previousClose || null;
        const name = meta.shortName || meta.longName || ticker;
        const currency = meta.currency || "USD";

        // Upsert into assets_cache
        await supabase
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
            { onConflict: "ticker" },
          );

        return { ticker, result: { price, previousClose, name, currency } };
      } catch (err) {
        console.error(`Error fetching ${ticker}:`, err);
        return { ticker, result: { error: String(err) } };
      }
    };

    // Fetch all tickers in parallel (batches of 5)
    const batchSize = 5;
    for (let i = 0; i < tickers.length; i += batchSize) {
      const batch = tickers.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(fetchTicker));
      batchResults.forEach(({ ticker, result }) => {
        results[ticker] = result;
      });
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
