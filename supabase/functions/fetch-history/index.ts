const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const YF_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
};

function rangeToParams(range: string): { rangeStr: string; interval: string } {
  const map: Record<string, { rangeStr: string; interval: string }> = {
    "1d": { rangeStr: "1d", interval: "5m" },
    "5d": { rangeStr: "5d", interval: "15m" },
    "1mo": { rangeStr: "1mo", interval: "1d" },
    "3mo": { rangeStr: "3mo", interval: "1d" },
    "6mo": { rangeStr: "6mo", interval: "1d" },
    "1y": { rangeStr: "1y", interval: "1wk" },
    "2y": { rangeStr: "2y", interval: "1wk" },
    "5y": { rangeStr: "5y", interval: "1wk" },
    max: { rangeStr: "max", interval: "1wk" },
  };
  return map[range] ?? { rangeStr: "5y", interval: "1wk" };
}

type SessionType = "pre" | "regular" | "post";
type HistoryPoint = { time: number; price: number; session?: SessionType };
type HistorySuccess = { history: HistoryPoint[]; currency: string; symbol: string; previousClose: number | null };
type HistoryResult = HistorySuccess | { error: string };

type TradingPeriod = { start: number; end: number };
type SessionPeriods = {
  pre: TradingPeriod[];
  regular: TradingPeriod[];
  post: TradingPeriod[];
};

function flattenTradingPeriods(input: unknown): TradingPeriod[] {
  const periods: TradingPeriod[] = [];

  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }

    if (node && typeof node === "object") {
      const maybeStart = (node as { start?: unknown }).start;
      const maybeEnd = (node as { end?: unknown }).end;
      const start = typeof maybeStart === "number" ? maybeStart : null;
      const end = typeof maybeEnd === "number" ? maybeEnd : null;

      if (start !== null && end !== null && Number.isFinite(start) && Number.isFinite(end) && end > start) {
        periods.push({ start, end });
      }
    }
  };

  walk(input);
  return periods;
}

function extractSessionPeriods(metaTradingPeriods: unknown): SessionPeriods {
  const raw = (metaTradingPeriods ?? {}) as {
    pre?: unknown;
    regular?: unknown;
    post?: unknown;
  };

  return {
    pre: flattenTradingPeriods(raw.pre),
    regular: flattenTradingPeriods(raw.regular),
    post: flattenTradingPeriods(raw.post),
  };
}

function isInTradingPeriods(timestamp: number, periods: TradingPeriod[]): boolean {
  for (const p of periods) {
    if (timestamp >= p.start && timestamp < p.end) return true;
  }
  return false;
}

function resolveSession(timestamp: number, periods: SessionPeriods): SessionType | null {
  if (isInTradingPeriods(timestamp, periods.regular)) return "regular";
  if (isInTradingPeriods(timestamp, periods.pre)) return "pre";
  if (isInTradingPeriods(timestamp, periods.post)) return "post";
  return null;
}

async function fetchYahooHistory(
  ticker: string,
  range: string,
  interval: string,
  includePrePost = false
): Promise<HistorySuccess | null> {
  const { rangeStr, interval: resolvedInterval } = rangeToParams(range);
  const effectiveInterval = interval || resolvedInterval;
  const includePrePostValue = includePrePost ? "true" : "false";

  // Yahoo can downsample `range=max` even when interval=1d.
  // Use explicit epoch bounds to force real daily points.
  const url =
    effectiveInterval === "1d" && rangeStr === "max"
      ? `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}&includePrePost=${includePrePostValue}`
      : `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${effectiveInterval}&range=${rangeStr}&includePrePost=${includePrePostValue}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      headers: YF_HEADERS,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.error(`Yahoo HTTP ${res.status} for ${ticker}`);
      return null;
    }

    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const timestamps: number[] = result.timestamp ?? [];
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
    const currency: string = result.meta?.currency ?? "USD";
    const symbol: string = result.meta?.symbol ?? ticker;
    const previousClose: number | null = result.meta?.chartPreviousClose ?? result.meta?.previousClose ?? null;
    const sessionPeriods = includePrePost
      ? extractSessionPeriods(result?.meta?.tradingPeriods)
      : null;

    if (timestamps.length === 0) return null;

    const history: HistoryPoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = timestamps[i];
      const price = closes[i];
      if (price !== null && price !== undefined && !isNaN(price)) {
        const point: HistoryPoint = { time: timestamp, price };
        if (sessionPeriods) {
          const session = resolveSession(timestamp, sessionPeriods);
          if (session) point.session = session;
        }
        history.push(point);
      }
    }

    return { history, currency, symbol, previousClose };
  } catch (err) {
    clearTimeout(timeout);
    console.error(`Error fetching ${ticker}:`, err);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { tickers, range = "5y", interval = "1wk", includePrePost = false } = body;
    const includePrePostBool = includePrePost === true || includePrePost === "true";

    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return new Response(JSON.stringify({ error: "tickers array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: Record<string, HistoryResult> = {};

    // Fetch all tickers in parallel (with concurrency limit)
    const BATCH_SIZE = 5;
    for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
      const batch = tickers.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (ticker: string) => {
          const data = await fetchYahooHistory(ticker, range, interval, includePrePostBool);
          if (data) {
            results[ticker] = data;
          } else {
            results[ticker] = { error: "No data available" };
          }
        })
      );
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Handler error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
