import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import yahooFinance from "https://esm.sh/yahoo-finance2@2.13.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { tickers, range = "5y", interval = "1d" } = await req.json();

    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return new Response(JSON.stringify({ error: "tickers array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: Record<string, any> = {};

    try {
      yahooFinance.suppressNotices(["yahooSurvey"]);
    } catch {}

    for (const ticker of tickers) {
      try {
        const result = await yahooFinance.chart(ticker, { range, interval });

        if (!result || !result.quotes) {
          results[ticker] = { error: "No data" };
          continue;
        }

        const history = result.quotes
          .map((q: any) => ({
            time: new Date(q.date).getTime() / 1000,
            price: q.close,
          }))
          .filter((item: any) => item.price !== null && item.price !== undefined);

        results[ticker] = {
          symbol: result.meta.symbol,
          currency: result.meta.currency,
          history: history,
        };
      } catch (err) {
        console.error(`Error fetching ${ticker}:`, err);
        results[ticker] = { error: String(err) };
      }
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
