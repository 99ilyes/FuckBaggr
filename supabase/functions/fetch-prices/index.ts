
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// ── Yahoo Finance direct HTTP fetch (no library, no rate-limit shared IP issue) ──
const YF_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Accept": "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Origin": "https://finance.yahoo.com",
  "Referer": "https://finance.yahoo.com/",
};

async function fetchYahoo(ticker: string): Promise<any | null> {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d&includePrePost=false`;
  try {
    const resp = await fetch(url, {
      headers: YF_HEADERS,
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    return json?.chart?.result?.[0]?.meta ?? null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  // CORS preflight — must return 200 immediately
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
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

    const { tickers, mode, prices } = body ?? {};

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── MODE: persist ──────────────────────────────────────────────────────────
    if (mode === "persist") {
      if (!prices || typeof prices !== "object") {
        return new Response(JSON.stringify({ ok: false }), {
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

    // ── MODE: cache-only ───────────────────────────────────────────────────────
    if (mode === "cache-only") {
      const tickerList = Array.isArray(tickers) && tickers.length > 0 ? tickers : [];
      const results: Record<string, any> = {};

      if (tickerList.length > 0) {
        const { data: rows } = await supabase
          .from("assets_cache")
          .select("ticker, last_price, previous_close, name, currency, updated_at")
          .in("ticker", tickerList);

        for (const row of rows ?? []) {
          results[row.ticker] = {
            price: row.last_price,
            previousClose: row.previous_close,
            name: row.name ?? row.ticker,
            currency: row.currency ?? "USD",
            fromCache: true,
          };
        }
      }

      return new Response(JSON.stringify({ results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── MODE: fundamentals (stub) ──────────────────────────────────────────────
    if (mode === "fundamentals") {
      return new Response(JSON.stringify({ results: {} }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── DEFAULT / LEGACY MODE: prices ──────────────────────────────────────────
    // Called by older frontend versions. Fetch from Yahoo Finance directly
    // (server-side HTTP, no library), fall back to DB cache.
    if (!Array.isArray(tickers) || tickers.length === 0) {
      return new Response(JSON.stringify({ results: {} }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const uniqueTickers = [...new Set(tickers)] as string[];

    // Load cache first
    const { data: cachedRows } = await supabase
      .from("assets_cache")
      .select("ticker, last_price, previous_close, name, currency, updated_at")
      .in("ticker", uniqueTickers);

    const cacheMap: Record<string, any> = {};
    for (const row of cachedRows ?? []) cacheMap[row.ticker] = row;

    // Fetch all tickers from Yahoo in parallel with 4s timeout each
    const liveResults = await Promise.all(
      uniqueTickers.map(async (t) => {
        const meta = await fetchYahoo(t);
        return { ticker: t, meta };
      })
    );

    const results: Record<string, any> = {};
    let liveCount = 0;
    let cacheCount = 0;

    for (const { ticker: t, meta } of liveResults) {
      if (meta?.regularMarketPrice != null) {
        const price = meta.regularMarketPrice as number;
        const prevClose = (meta.chartPreviousClose ?? meta.previousClose ?? price) as number;
        const change = (meta.regularMarketChange ?? (price - prevClose)) as number;
        const changePct = (meta.regularMarketChangePercent ??
          (prevClose !== 0 ? (change / prevClose) * 100 : 0)) as number;

        results[t] = {
          price,
          previousClose: prevClose,
          name: meta.longName ?? meta.shortName ?? meta.symbol ?? t,
          currency: meta.currency ?? "USD",
          change,
          changePercent: changePct,
          fromCache: false,
        };
        liveCount++;
      } else if (cacheMap[t]?.last_price != null) {
        results[t] = {
          price: cacheMap[t].last_price,
          previousClose: cacheMap[t].previous_close ?? null,
          name: cacheMap[t].name ?? t,
          currency: cacheMap[t].currency ?? "USD",
          change: 0,
          changePercent: 0,
          fromCache: true,
        };
        cacheCount++;
      }
    }

    console.info(`[fetch-prices] ${liveCount} live, ${cacheCount} from cache / ${uniqueTickers.length} tickers`);

    // Persist live results to cache (don't await — fire and forget)
    const toUpsert = Object.entries(results)
      .filter(([, info]: [string, any]) => !info.fromCache && info.price != null)
      .map(([ticker, info]: [string, any]) => ({
        ticker,
        last_price: info.price,
        previous_close: info.previousClose,
        name: info.name,
        currency: info.currency,
        updated_at: new Date().toISOString(),
      }));

    if (toUpsert.length > 0) {
      supabase.from("assets_cache").upsert(toUpsert, { onConflict: "ticker" }).then(() => {});
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[fetch-prices] Unhandled error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
