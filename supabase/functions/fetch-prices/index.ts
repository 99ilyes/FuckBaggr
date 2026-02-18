
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchTicker(ticker: string): Promise<any> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
    const headers = {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json",
      "Accept-Language": "en-US,en;q=0.9",
    };

    // First attempt
    let resp = await fetch(url, { headers });

    if (!resp.ok) {
      console.warn(`Fetch failed for ${ticker}: ${resp.status} ${resp.statusText}`);
      // Retry once for 429 (Rate Limit) or 403 (Forbidden - sometimes spurious)
      if (resp.status === 429 || resp.status === 403) {
        await delay(2000);
        resp = await fetch(url, { headers });
      }
    }

    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    console.error(`Error fetching ${ticker}:`, e);
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
    // Handle wrapped body if present (common in troubleshooting)
    if (typeof body === "string") {
      try { const p = JSON.parse(body); tickers = p.tickers; mode = p.mode; } catch { }
    }
    if (!tickers && body.body) {
      let i = body.body;
      if (typeof i === "string") { try { i = JSON.parse(i); } catch { } }
      if (i.tickers) { tickers = i.tickers; mode = i.mode; }
    }

    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return new Response(JSON.stringify({ error: "tickers array required" }), { status: 400, headers: corsHeaders });
    }

    const uniqueTickers = [...new Set(tickers)] as string[];

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // --- MODE: FUNDAMENTALS ---
    if (mode === "fundamentals") {
      // Implementation for fundamentals would go here if needed, 
      // relying on similar pattern or just returning empty for now to match simplified logic
      return new Response(JSON.stringify({ results: {} }), { headers: corsHeaders });
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

    // 2. Fetch Live Data
    const BATCH_SIZE = 5;
    for (let i = 0; i < uniqueTickers.length; i += BATCH_SIZE) {
      const batch = uniqueTickers.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (t) => {
        const data = await fetchTicker(t);
        const meta = data?.chart?.result?.[0]?.meta;

        if (meta) {
          const price = meta.regularMarketPrice;
          const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? price;

          let change = meta.regularMarketChange;
          let changePercent = meta.regularMarketChangePercent;

          // Force calculation if missing OR if we want to ensure consistency with prevClose
          if (change == null || changePercent == null) {
            if (price != null && prevClose != null) {
              change = price - prevClose;
              if (prevClose !== 0) {
                changePercent = (change / prevClose) * 100;
              }
            }
          }

          results[t] = {
            price: price,
            previousClose: prevClose,
            name: meta.longName ?? meta.shortName ?? meta.symbol ?? t,
            currency: meta.currency ?? "USD",
            change: change ?? 0,
            changePercent: changePercent ?? 0,
            fromCache: false
          };
        } else if (cacheMap[t]) {
          // Fallback to cache
          results[t] = {
            price: cacheMap[t].last_price,
            previousClose: cacheMap[t].previous_close ?? null,
            name: cacheMap[t].name ?? t,
            currency: cacheMap[t].currency ?? "USD",
            change: 0,
            changePercent: 0,
            fromCache: true
          };
        } else {
          results[t] = { price: null, previousClose: null, change: null, changePercent: null, name: t, currency: "USD", fromCache: false };
        }
      }));
      if (i + BATCH_SIZE < uniqueTickers.length) await delay(300);
    }

    // 3. Update Cache
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
