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
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://finance.yahoo.com",
  Referer: "https://finance.yahoo.com/",
};

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getLastCloseInPeriod(
  timestamps: number[],
  closes: Array<number | null>,
  period: { start?: number; end?: number } | undefined,
): number | null {
  if (!period) return null;
  const start = toFiniteNumber(period.start);
  const end = toFiniteNumber(period.end);
  if (start == null || end == null) return null;

  const maxIdx = Math.min(timestamps.length, closes.length) - 1;
  for (let i = maxIdx; i >= 0; i--) {
    const ts = timestamps[i];
    const close = closes[i];
    if (ts >= start && ts < end && typeof close === "number" && Number.isFinite(close)) {
      return close;
    }
  }
  return null;
}

function isWithinPeriod(nowSec: number, period: { start?: number; end?: number } | undefined): boolean {
  if (!period) return false;
  const start = toFiniteNumber(period.start);
  const end = toFiniteNumber(period.end);
  if (start == null || end == null) return false;
  return nowSec >= start && nowSec < end;
}

async function fetchYahoo(ticker: string): Promise<any | null> {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d&includePrePost=true`;
  try {
    const resp = await fetch(url, {
      headers: YF_HEADERS,
      signal: AbortSignal.timeout(7000),
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const result = json?.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta || meta.regularMarketPrice == null) return null;

    const timestamps = Array.isArray(result?.timestamp) ? (result.timestamp as number[]) : [];
    const closesRaw = result?.indicators?.quote?.[0]?.close;
    const closes = Array.isArray(closesRaw) ? (closesRaw as Array<number | null>) : [];
    const periods = (meta.currentTradingPeriod ?? {}) as {
      pre?: { start?: number; end?: number };
      regular?: { start?: number; end?: number };
      post?: { start?: number; end?: number };
    };

    const preMarketPrice = toFiniteNumber(meta.preMarketPrice) ?? getLastCloseInPeriod(timestamps, closes, periods.pre);
    const postMarketPrice =
      toFiniteNumber(meta.postMarketPrice) ?? getLastCloseInPeriod(timestamps, closes, periods.post);
    const regularLivePrice = getLastCloseInPeriod(timestamps, closes, periods.regular);

    let marketState: string | null =
      typeof meta.marketState === "string" && meta.marketState.trim().length > 0
        ? meta.marketState.toUpperCase()
        : null;

    if (!marketState) {
      const nowSec = Math.floor(Date.now() / 1000);
      if (isWithinPeriod(nowSec, periods.regular)) marketState = "REGULAR";
      else if (isWithinPeriod(nowSec, periods.pre)) marketState = "PRE";
      else if (isWithinPeriod(nowSec, periods.post)) marketState = "POST";
      else if (periods.regular || periods.pre || periods.post) marketState = "CLOSED";
    }

    const regularPrice = meta.regularMarketPrice as number;
    const price =
      marketState === "REGULAR" || marketState === "OPEN" ? (regularLivePrice ?? regularPrice) : regularPrice;
    const prevClose = (meta.chartPreviousClose ?? meta.previousClose ?? price) as number;
    const change = (meta.regularMarketChange ?? price - prevClose) as number;
    const changePercent = (meta.regularMarketChangePercent ??
      (prevClose !== 0 ? (change / prevClose) * 100 : 0)) as number;

    return {
      price,
      previousClose: prevClose,
      name: meta.longName ?? meta.shortName ?? meta.symbol ?? ticker,
      currency: meta.currency ?? "USD",
      change,
      changePercent,
      marketState,
      preMarketPrice: preMarketPrice ?? null,
      postMarketPrice: postMarketPrice ?? null,
    };
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
            marketState: null,
            preMarketPrice: null,
            postMarketPrice: null,
            fromCache: true,
          };
        }
      }

      return new Response(JSON.stringify({ results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── MODE: fundamentals ──────────────────────────────────────────────
    if (mode === "fundamentals") {
      if (!Array.isArray(tickers) || tickers.length === 0) {
        return new Response(JSON.stringify({ results: {} }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const uniqueTickers = [...new Set(tickers)] as string[];
      const fundResults: Record<string, any> = Object.fromEntries(
        uniqueTickers.map((t) => [
          t,
          {
            trailingPE: null,
            forwardPE: null,
            trailingEps: null,
            forwardEps: null,
            trailingFcfPerShare: null,
            trailingRevenuePerShare: null,
            trailingTotalRevenue: null,
            trailingRevenueShares: null,
          },
        ]),
      );

      // 1) Fundamentals timeseries endpoint (works without crumb for PE/EPS)
      const period2 = Math.floor(Date.now() / 1000);
      const period1 = period2 - 60 * 60 * 24 * 365 * 3;

      const getLatestRaw = (arr: any[] | undefined, requireTTM = false): number | null => {
        if (!Array.isArray(arr) || arr.length === 0) return null;

        const rows = arr
          .map((item) => ({
            asOfDate: typeof item?.asOfDate === "string" ? item.asOfDate : "",
            periodType: typeof item?.periodType === "string" ? item.periodType : "",
            raw: typeof item?.reportedValue?.raw === "number" ? item.reportedValue.raw : null,
          }))
          .filter((row) => typeof row.raw === "number");

        if (rows.length === 0) return null;

        rows.sort((a, b) => b.asOfDate.localeCompare(a.asOfDate));
        const ttmRow = rows.find((r) => r.periodType.toUpperCase().includes("TTM"));
        if (requireTTM) return ttmRow?.raw ?? null;
        return (ttmRow ?? rows[0]).raw;
      };

      await Promise.all(
        uniqueTickers.map(async (ticker: string) => {
          try {
            const tsUrl = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(ticker)}?symbol=${encodeURIComponent(ticker)}&type=trailingPeRatio,trailingDilutedEPS,trailingBasicEPS,trailingFreeCashFlow,trailingTotalRevenue,trailingDilutedAverageShares,trailingBasicAverageShares&period1=${period1}&period2=${period2}`;
            const tsResp = await fetch(tsUrl, {
              headers: YF_HEADERS,
              signal: AbortSignal.timeout(7000),
            });

            if (!tsResp.ok) return;

            const tsJson = await tsResp.json();
            const series = tsJson?.timeseries?.result;
            if (!Array.isArray(series)) return;

            let trailingPE: number | null = null;
            let trailingEps: number | null = null;
            let trailingFreeCashFlow: number | null = null;
            let trailingTotalRevenue: number | null = null;
            let trailingDilutedAverageShares: number | null = null;
            let trailingBasicAverageShares: number | null = null;

            for (const item of series) {
              const type = item?.meta?.type?.[0];

              if (type === "trailingPeRatio") {
                trailingPE = getLatestRaw(item?.trailingPeRatio);
              } else if (type === "trailingDilutedEPS") {
                trailingEps = getLatestRaw(item?.trailingDilutedEPS, true);
              } else if (type === "trailingBasicEPS" && trailingEps == null) {
                trailingEps = getLatestRaw(item?.trailingBasicEPS, true);
              } else if (type === "trailingFreeCashFlow") {
                trailingFreeCashFlow = getLatestRaw(item?.trailingFreeCashFlow, true);
              } else if (type === "trailingTotalRevenue") {
                trailingTotalRevenue = getLatestRaw(item?.trailingTotalRevenue, true);
              } else if (type === "trailingDilutedAverageShares") {
                trailingDilutedAverageShares = getLatestRaw(item?.trailingDilutedAverageShares, true);
              } else if (type === "trailingBasicAverageShares") {
                trailingBasicAverageShares = getLatestRaw(item?.trailingBasicAverageShares, true);
              }
            }

            const shares = trailingDilutedAverageShares ?? trailingBasicAverageShares;
            const trailingFcfPerShare =
              shares != null && shares > 0 && trailingFreeCashFlow != null ? trailingFreeCashFlow / shares : null;
            const trailingRevenuePerShare =
              shares != null && shares > 0 && trailingTotalRevenue != null ? trailingTotalRevenue / shares : null;

            fundResults[ticker] = {
              trailingPE,
              forwardPE: null,
              trailingEps,
              forwardEps: null,
              trailingFcfPerShare,
              trailingRevenuePerShare,
              trailingTotalRevenue,
              trailingRevenueShares: shares,
            };
          } catch (err) {
            console.warn(`[fetch-prices] fundamentals timeseries error for ${ticker}:`, err);
          }
        }),
      );

      console.info(
        `[fetch-prices] fundamentals computed for ${Object.keys(fundResults).length}/${uniqueTickers.length} tickers`,
      );

      return new Response(JSON.stringify({ results: fundResults }), {
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
        const quote = await fetchYahoo(t);
        return { ticker: t, quote };
      }),
    );

    const results: Record<string, any> = {};
    let liveCount = 0;
    let cacheCount = 0;

    for (const { ticker: t, quote } of liveResults) {
      if (quote?.price != null) {
        results[t] = {
          price: quote.price,
          previousClose: quote.previousClose,
          name: quote.name,
          currency: quote.currency,
          change: quote.change,
          changePercent: quote.changePercent,
          marketState: quote.marketState ?? null,
          preMarketPrice: quote.preMarketPrice ?? null,
          postMarketPrice: quote.postMarketPrice ?? null,
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
          marketState: null,
          preMarketPrice: null,
          postMarketPrice: null,
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
      supabase
        .from("assets_cache")
        .upsert(toUpsert, { onConflict: "ticker" })
        .then(() => { });
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
