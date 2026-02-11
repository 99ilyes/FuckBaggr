import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

        for (const ticker of tickers) {
            try {
                const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;
                const response = await fetch(url, {
                    headers: { "User-Agent": "Mozilla/5.0" },
                });

                if (!response.ok) {
                    console.error(`Failed to fetch ${ticker}: ${response.status}`);
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

                // Filter out null values if any, mapping to simple { time, price } array
                const history = timestamp.map((t: number, i: number) => ({
                    time: t,
                    price: close[i]
                })).filter((item: any) => item.price !== null && item.price !== undefined);

                results[ticker] = {
                    symbol: meta.symbol,
                    currency: meta.currency,
                    history
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
