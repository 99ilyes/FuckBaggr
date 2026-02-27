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

const ALPHA_VANTAGE_BASE_URL = "https://www.alphavantage.co/query";
const ALPHA_VANTAGE_API_KEY = Deno.env.get("ALPHA_VANTAGE_API_KEY") ?? "5MSKMS1BEIE5A1GP";
const ALPHA_VANTAGE_TIMEOUT_MS = 9000;

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toNumericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === "none" || trimmed.toLowerCase() === "null") return null;

  const normalized = trimmed.replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function pickFirstNumeric(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = toNumericValue(row[key]);
    if (value != null) return value;
  }
  return null;
}

type TimeseriesRow = {
  asOfDate: string;
  periodType: string;
  raw: number;
};

type FundamentalsSnapshot = {
  asOfDate: string;
  trailingPeRatio: number | null;
  trailingEps: number | null;
  trailingFreeCashFlow: number | null;
  trailingTotalRevenue: number | null;
  trailingShares: number | null;
};

type FundamentalsSource = "alpha_vantage" | "yahoo" | "none";

type QuarterlyFundamentalsType =
  | "quarterlyDilutedEPS"
  | "quarterlyBasicEPS"
  | "quarterlyFreeCashFlow"
  | "quarterlyTotalRevenue"
  | "quarterlyDilutedAverageShares"
  | "quarterlyBasicAverageShares";

const QUARTERLY_FUNDAMENTAL_TYPES: QuarterlyFundamentalsType[] = [
  "quarterlyDilutedEPS",
  "quarterlyBasicEPS",
  "quarterlyFreeCashFlow",
  "quarterlyTotalRevenue",
  "quarterlyDilutedAverageShares",
  "quarterlyBasicAverageShares",
];

function emptySnapshot(asOfDate: string): FundamentalsSnapshot {
  return {
    asOfDate,
    trailingPeRatio: null,
    trailingEps: null,
    trailingFreeCashFlow: null,
    trailingTotalRevenue: null,
    trailingShares: null,
  };
}

function parseTimeseriesRows(arr: unknown): TimeseriesRow[] {
  if (!Array.isArray(arr) || arr.length === 0) return [];

  return arr
    .map((item) => ({
      asOfDate: typeof item?.asOfDate === "string" ? item.asOfDate : "",
      periodType: typeof item?.periodType === "string" ? item.periodType : "",
      raw: typeof item?.reportedValue?.raw === "number" ? item.reportedValue.raw : NaN,
    }))
    .filter((row) => row.asOfDate.length > 0 && Number.isFinite(row.raw));
}

function preferTTMRows(rows: TimeseriesRow[]): TimeseriesRow[] {
  const ttmRows = rows.filter((row) => row.periodType.toUpperCase().includes("TTM"));
  return ttmRows.length > 0 ? ttmRows : rows;
}

function getLatestTimeseriesRaw(arr: unknown, requireTTM = false): number | null {
  const baseRows = parseTimeseriesRows(arr);
  if (baseRows.length === 0) return null;

  const rows = requireTTM ? preferTTMRows(baseRows) : baseRows;
  if (rows.length === 0) return null;

  rows.sort((a, b) => b.asOfDate.localeCompare(a.asOfDate));
  return rows[0]?.raw ?? null;
}

function applyRowsToSnapshots(
  snapshotMap: Map<string, FundamentalsSnapshot>,
  rows: TimeseriesRow[],
  key: keyof Omit<FundamentalsSnapshot, "asOfDate">,
  fallbackOnly = false,
) {
  for (const row of rows) {
    const existing = snapshotMap.get(row.asOfDate) ?? emptySnapshot(row.asOfDate);
    if (!fallbackOnly || existing[key] == null) {
      existing[key] = row.raw;
    }
    snapshotMap.set(row.asOfDate, existing);
  }
}

function isQuarterlyPeriodType(periodType: string): boolean {
  const value = periodType.toUpperCase();
  return value.includes("3M") || value.includes("QUARTER");
}

function pickQuarterlyRows(arr: unknown): TimeseriesRow[] {
  const allRows = parseTimeseriesRows(arr);
  if (allRows.length === 0) return [];

  const quarterly = allRows.filter((row) => isQuarterlyPeriodType(row.periodType));
  return quarterly.length > 0 ? quarterly : allRows;
}

function parsePeriodMonths(periodType: string): number | null {
  const match = periodType
    .trim()
    .toUpperCase()
    .match(/^(\d+)M$/);
  if (!match) return null;
  const months = Number(match[1]);
  return Number.isFinite(months) && months > 0 ? months : null;
}

function deriveQuarterlyStandaloneRows(rows: TimeseriesRow[]): TimeseriesRow[] {
  const sorted = [...rows].sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
  const quarterIndexMap = new Map<number, TimeseriesRow>();

  const toQuarterIndex = (asOfDate: string): number | null => {
    const date = new Date(`${asOfDate}T00:00:00Z`);
    if (!Number.isFinite(date.getTime())) return null;

    const quarter = Math.floor(date.getUTCMonth() / 3);
    return date.getUTCFullYear() * 4 + quarter;
  };

  for (const row of sorted) {
    const index = toQuarterIndex(row.asOfDate);
    if (index != null) {
      quarterIndexMap.set(index, row);
    }
  }

  const out: TimeseriesRow[] = [];

  for (const row of sorted) {
    const months = parsePeriodMonths(row.periodType);
    if (months == null || months <= 3) {
      out.push({ ...row });
      continue;
    }

    const currentIndex = toQuarterIndex(row.asOfDate);
    if (currentIndex == null) {
      out.push({ ...row });
      continue;
    }

    const previousRow = quarterIndexMap.get(currentIndex - 1);

    if (previousRow && Number.isFinite(previousRow.raw)) {
      const quarterRaw = row.raw - previousRow.raw;
      out.push({
        ...row,
        raw: Number.isFinite(quarterRaw) ? quarterRaw : row.raw,
      });
      continue;
    }

    const quarterCount = months / 3;
    if (Number.isFinite(quarterCount) && quarterCount > 1) {
      out.push({
        ...row,
        raw: row.raw / quarterCount,
      });
      continue;
    }

    out.push({ ...row });
  }

  return out;
}

function annualizeRows(rows: TimeseriesRow[]): TimeseriesRow[] {
  const quarterlyStandaloneRows = deriveQuarterlyStandaloneRows(rows);
  return quarterlyStandaloneRows.map((row) => ({
    ...row,
    raw: row.raw * 4,
  }));
}

function toDateSeconds(asOfDate: string): number | null {
  const ms = new Date(`${asOfDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

function buildTimeseriesUrl(ticker: string, types: string[], period1: number, period2: number): string {
  const encodedTicker = encodeURIComponent(ticker);
  const encodedTypes = types.join(",");
  return `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodedTicker}?symbol=${encodedTicker}&type=${encodedTypes}&period1=${period1}&period2=${period2}`;
}

function mergeQuarterlySeriesRows(
  series: unknown[],
  bucket: Record<QuarterlyFundamentalsType, TimeseriesRow[]>,
): { newRows: number; oldestSec: number | null } {
  const seenByType: Record<QuarterlyFundamentalsType, Set<string>> = {
    quarterlyDilutedEPS: new Set(bucket.quarterlyDilutedEPS.map((row) => row.asOfDate)),
    quarterlyBasicEPS: new Set(bucket.quarterlyBasicEPS.map((row) => row.asOfDate)),
    quarterlyFreeCashFlow: new Set(bucket.quarterlyFreeCashFlow.map((row) => row.asOfDate)),
    quarterlyTotalRevenue: new Set(bucket.quarterlyTotalRevenue.map((row) => row.asOfDate)),
    quarterlyDilutedAverageShares: new Set(bucket.quarterlyDilutedAverageShares.map((row) => row.asOfDate)),
    quarterlyBasicAverageShares: new Set(bucket.quarterlyBasicAverageShares.map((row) => row.asOfDate)),
  };

  let newRows = 0;
  let oldestSec: number | null = null;

  for (const item of series) {
    const rawType = (item as { meta?: { type?: string[] } })?.meta?.type?.[0];
    if (!rawType || !QUARTERLY_FUNDAMENTAL_TYPES.includes(rawType as QuarterlyFundamentalsType)) continue;

    const type = rawType as QuarterlyFundamentalsType;
    const rows = parseTimeseriesRows((item as Record<string, unknown>)[type]);

    for (const row of rows) {
      if (seenByType[type].has(row.asOfDate)) continue;

      bucket[type].push(row);
      seenByType[type].add(row.asOfDate);
      newRows += 1;

      const sec = toDateSeconds(row.asOfDate);
      if (sec != null && (oldestSec == null || sec < oldestSec)) {
        oldestSec = sec;
      }
    }
  }

  return { newRows, oldestSec };
}

function buildQuarterlySeriesFromBucket(bucket: Record<QuarterlyFundamentalsType, TimeseriesRow[]>): unknown[] {
  const out: unknown[] = [];

  for (const type of QUARTERLY_FUNDAMENTAL_TYPES) {
    const rows = [...bucket[type]].sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
    if (rows.length === 0) continue;

    const payloadRows = rows.map((row) => ({
      asOfDate: row.asOfDate,
      periodType: row.periodType,
      reportedValue: { raw: row.raw },
    }));

    out.push({
      meta: { type: [type] },
      [type]: payloadRows,
    });
  }

  return out;
}

async function fetchQuarterlyFundamentalsSeries(
  ticker: string,
  period1: number,
  period2: number,
  maxPages: number,
): Promise<unknown[]> {
  const bucket: Record<QuarterlyFundamentalsType, TimeseriesRow[]> = {
    quarterlyDilutedEPS: [],
    quarterlyBasicEPS: [],
    quarterlyFreeCashFlow: [],
    quarterlyTotalRevenue: [],
    quarterlyDilutedAverageShares: [],
    quarterlyBasicAverageShares: [],
  };

  let cursorPeriod2 = period2;

  for (let page = 0; page < maxPages; page++) {
    const tsUrl = buildTimeseriesUrl(ticker, QUARTERLY_FUNDAMENTAL_TYPES, period1, cursorPeriod2);
    const tsResp = await fetch(tsUrl, {
      headers: YF_HEADERS,
      signal: AbortSignal.timeout(7000),
    });

    if (!tsResp.ok) break;

    const tsJson = await tsResp.json();
    const series = tsJson?.timeseries?.result;
    if (!Array.isArray(series) || series.length === 0) break;

    const { newRows, oldestSec } = mergeQuarterlySeriesRows(series, bucket);
    if (oldestSec == null) break;
    if (oldestSec <= period1 + 86400) break;
    if (newRows === 0) break;

    const nextCursor = oldestSec - 86400;
    if (!Number.isFinite(nextCursor) || nextCursor <= period1 || nextCursor >= cursorPeriod2) break;
    cursorPeriod2 = nextCursor;
  }

  return buildQuarterlySeriesFromBucket(bucket);
}

type AlphaVantageFunction = "EARNINGS" | "CASH_FLOW" | "INCOME_STATEMENT";

async function fetchAlphaVantageFunction(
  ticker: string,
  fn: AlphaVantageFunction,
): Promise<Record<string, unknown> | null> {
  const url = `${ALPHA_VANTAGE_BASE_URL}?function=${fn}&symbol=${encodeURIComponent(ticker)}&apikey=${encodeURIComponent(ALPHA_VANTAGE_API_KEY)}`;

  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(ALPHA_VANTAGE_TIMEOUT_MS),
    });

    if (!resp.ok) {
      console.warn(`[fetch-prices] Alpha Vantage HTTP ${resp.status} for ${ticker} (${fn})`);
      return null;
    }

    const json = await resp.json();
    if (!json || typeof json !== "object") return null;

    const note = typeof json?.Note === "string" ? json.Note : null;
    const info = typeof json?.Information === "string" ? json.Information : null;
    const errorMessage = typeof json?.["Error Message"] === "string" ? json["Error Message"] : null;

    if (note || info || errorMessage) {
      console.warn(
        `[fetch-prices] Alpha Vantage payload warning for ${ticker} (${fn}): ${note ?? info ?? errorMessage}`,
      );
      return null;
    }

    return json as Record<string, unknown>;
  } catch (err) {
    console.warn(`[fetch-prices] Alpha Vantage request failed for ${ticker} (${fn}):`, err);
    return null;
  }
}

function parseAlphaVantageQuarterlyRows(payload: unknown, key: string): Record<string, unknown>[] {
  const rows = (payload as Record<string, unknown> | null)?.[key];
  if (!Array.isArray(rows)) return [];

  return rows.filter((entry) => entry && typeof entry === "object").map((entry) => entry as Record<string, unknown>);
}

function buildQuarterlyRowsFromMap(map: Map<string, number>): TimeseriesRow[] {
  return Array.from(map.entries())
    .map(([asOfDate, raw]) => ({
      asOfDate,
      periodType: "3M",
      raw,
    }))
    .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
}

function buildTtmRowsFromQuarterly(rows: TimeseriesRow[]): TimeseriesRow[] {
  const sorted = [...rows].sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
  const out: TimeseriesRow[] = [];
  const rollingWindow: TimeseriesRow[] = [];

  for (const row of sorted) {
    if (!Number.isFinite(row.raw)) continue;
    rollingWindow.push(row);
    if (rollingWindow.length > 4) rollingWindow.shift();
    if (rollingWindow.length < 4) continue;

    const ttmRaw = rollingWindow.reduce((sum, current) => sum + current.raw, 0);
    if (!Number.isFinite(ttmRaw)) continue;

    out.push({
      asOfDate: row.asOfDate,
      periodType: "TTM",
      raw: ttmRaw,
    });
  }

  return out;
}

function carryForwardSnapshots(snapshotMap: Map<string, FundamentalsSnapshot>): FundamentalsSnapshot[] {
  const sorted = Array.from(snapshotMap.values()).sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
  const keys: (keyof Omit<FundamentalsSnapshot, "asOfDate">)[] = [
    "trailingPeRatio",
    "trailingEps",
    "trailingFreeCashFlow",
    "trailingTotalRevenue",
    "trailingShares",
  ];

  for (let i = 1; i < sorted.length; i++) {
    for (const key of keys) {
      if (sorted[i][key] == null && sorted[i - 1][key] != null) {
        sorted[i][key] = sorted[i - 1][key];
      }
    }
  }

  return sorted;
}

function filterSnapshotsFromPeriod(snapshots: FundamentalsSnapshot[], period1: number): FundamentalsSnapshot[] {
  return snapshots.filter((snapshot) => {
    const asOfSec = toDateSeconds(snapshot.asOfDate);
    return asOfSec != null && asOfSec >= period1;
  });
}

async function fetchAlphaVantageFundamentalsSnapshots(
  ticker: string,
  period1: number,
): Promise<FundamentalsSnapshot[]> {
  if (!ALPHA_VANTAGE_API_KEY) return [];

  const [earningsPayload, cashFlowPayload, incomePayload] = await Promise.all([
    fetchAlphaVantageFunction(ticker, "EARNINGS"),
    fetchAlphaVantageFunction(ticker, "CASH_FLOW"),
    fetchAlphaVantageFunction(ticker, "INCOME_STATEMENT"),
  ]);

  if (!earningsPayload && !cashFlowPayload && !incomePayload) return [];

  const epsByDate = new Map<string, number>();
  const revenueByDate = new Map<string, number>();
  const fcfByDate = new Map<string, number>();
  const sharesByDate = new Map<string, number>();

  for (const row of parseAlphaVantageQuarterlyRows(earningsPayload, "quarterlyEarnings")) {
    const asOfDate = parseIsoDate(row.fiscalDateEnding);
    if (!asOfDate) continue;

    const eps = pickFirstNumeric(row, ["reportedEPS"]);
    if (eps != null) {
      epsByDate.set(asOfDate, eps);
    }
  }

  for (const row of parseAlphaVantageQuarterlyRows(incomePayload, "quarterlyReports")) {
    const asOfDate = parseIsoDate(row.fiscalDateEnding);
    if (!asOfDate) continue;

    const revenue = pickFirstNumeric(row, ["totalRevenue"]);
    if (revenue != null) {
      revenueByDate.set(asOfDate, revenue);
    }

    const shares = pickFirstNumeric(row, [
      "weightedAverageShsOutDil",
      "weightedAverageShsOut",
      "commonStockSharesOutstanding",
    ]);

    if (shares != null && shares > 0) {
      sharesByDate.set(asOfDate, shares);
    }
  }

  for (const row of parseAlphaVantageQuarterlyRows(cashFlowPayload, "quarterlyReports")) {
    const asOfDate = parseIsoDate(row.fiscalDateEnding);
    if (!asOfDate) continue;

    let freeCashFlow = pickFirstNumeric(row, ["freeCashFlow", "freeCashflow", "fcf"]);

    if (freeCashFlow == null) {
      const operatingCashFlow = pickFirstNumeric(row, ["operatingCashflow", "operatingCashFlow"]);
      const capex = pickFirstNumeric(row, ["capitalExpenditures", "capitalExpenditure"]);

      if (operatingCashFlow != null && capex != null) {
        freeCashFlow = operatingCashFlow - Math.abs(capex);
      }
    }

    if (freeCashFlow != null) {
      fcfByDate.set(asOfDate, freeCashFlow);
    }
  }

  const ttmEpsRows = buildTtmRowsFromQuarterly(buildQuarterlyRowsFromMap(epsByDate));
  const ttmFcfRows = buildTtmRowsFromQuarterly(buildQuarterlyRowsFromMap(fcfByDate));
  const ttmRevenueRows = buildTtmRowsFromQuarterly(buildQuarterlyRowsFromMap(revenueByDate));
  const sharesRows = buildQuarterlyRowsFromMap(sharesByDate);

  if (ttmEpsRows.length === 0 && ttmFcfRows.length === 0 && ttmRevenueRows.length === 0) {
    return [];
  }

  const snapshotMap = new Map<string, FundamentalsSnapshot>();
  applyRowsToSnapshots(snapshotMap, ttmEpsRows, "trailingEps");
  applyRowsToSnapshots(snapshotMap, ttmFcfRows, "trailingFreeCashFlow");
  applyRowsToSnapshots(snapshotMap, ttmRevenueRows, "trailingTotalRevenue");
  applyRowsToSnapshots(snapshotMap, sharesRows, "trailingShares");

  if (snapshotMap.size === 0) return [];

  const allSnapshots = carryForwardSnapshots(snapshotMap);
  return filterSnapshotsFromPeriod(allSnapshots, period1);
}

function getLatestSnapshot(snapshots: FundamentalsSnapshot[]): FundamentalsSnapshot | null {
  if (snapshots.length === 0) return null;
  return snapshots[snapshots.length - 1] ?? null;
}

function buildFundamentalsSnapshots(series: any[]): FundamentalsSnapshot[] {
  const snapshotMap = new Map<string, FundamentalsSnapshot>();

  for (const item of series) {
    const type = item?.meta?.type?.[0];

    if (type === "quarterlyDilutedEPS") {
      applyRowsToSnapshots(snapshotMap, annualizeRows(pickQuarterlyRows(item?.quarterlyDilutedEPS)), "trailingEps");
    } else if (type === "quarterlyBasicEPS") {
      applyRowsToSnapshots(snapshotMap, annualizeRows(pickQuarterlyRows(item?.quarterlyBasicEPS)), "trailingEps", true);
    } else if (type === "quarterlyFreeCashFlow") {
      applyRowsToSnapshots(
        snapshotMap,
        annualizeRows(pickQuarterlyRows(item?.quarterlyFreeCashFlow)),
        "trailingFreeCashFlow",
      );
    } else if (type === "quarterlyTotalRevenue") {
      applyRowsToSnapshots(
        snapshotMap,
        annualizeRows(pickQuarterlyRows(item?.quarterlyTotalRevenue)),
        "trailingTotalRevenue",
      );
    } else if (type === "quarterlyDilutedAverageShares") {
      applyRowsToSnapshots(snapshotMap, pickQuarterlyRows(item?.quarterlyDilutedAverageShares), "trailingShares");
    } else if (type === "quarterlyBasicAverageShares") {
      applyRowsToSnapshots(snapshotMap, pickQuarterlyRows(item?.quarterlyBasicAverageShares), "trailingShares", true);
    }
  }

  return carryForwardSnapshots(snapshotMap);
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

    // ── MODE: fundamentals-history ──────────────────────────────────────
    if (mode === "fundamentals-history") {
      if (!Array.isArray(tickers) || tickers.length === 0) {
        return new Response(JSON.stringify({ results: {} }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const uniqueTickers = [...new Set(tickers)] as string[];
      const requestedYears = Number(body?.periodYears);
      const years =
        Number.isFinite(requestedYears) && requestedYears > 0 ? Math.min(Math.floor(requestedYears), 20) : 5;

      const period2 = Math.floor(Date.now() / 1000);
      const period1 = period2 - 60 * 60 * 24 * 365 * years;
      const maxPages = Math.max(2, Math.min(16, years * 4));

      const ratioResults: Record<string, { snapshots: FundamentalsSnapshot[]; source: FundamentalsSource }> =
        Object.fromEntries(uniqueTickers.map((ticker) => [ticker, { snapshots: [], source: "none" }]));

      await Promise.all(
        uniqueTickers.map(async (ticker: string) => {
          try {
            const alphaSnapshots = await fetchAlphaVantageFundamentalsSnapshots(ticker, period1);
            if (alphaSnapshots.length > 0) {
              ratioResults[ticker] = { snapshots: alphaSnapshots, source: "alpha_vantage" };
              return;
            }

            const series = await fetchQuarterlyFundamentalsSeries(ticker, period1, period2, maxPages);
            if (!Array.isArray(series) || series.length === 0) return;

            ratioResults[ticker] = {
              snapshots: buildFundamentalsSnapshots(series),
              source: "yahoo",
            };
          } catch (err) {
            console.warn(`[fetch-prices] fundamentals-history error for ${ticker}:`, err);
          }
        }),
      );

      return new Response(JSON.stringify({ results: ratioResults }), {
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

      await Promise.all(
        uniqueTickers.map(async (ticker: string) => {
          try {
            const alphaSnapshots = await fetchAlphaVantageFundamentalsSnapshots(ticker, 0);
            const latestAlphaSnapshot = getLatestSnapshot(alphaSnapshots);

            if (latestAlphaSnapshot) {
              const trailingEps = latestAlphaSnapshot.trailingEps;
              const trailingFreeCashFlow = latestAlphaSnapshot.trailingFreeCashFlow;
              const trailingTotalRevenue = latestAlphaSnapshot.trailingTotalRevenue;
              const shares =
                latestAlphaSnapshot.trailingShares != null && latestAlphaSnapshot.trailingShares > 0
                  ? latestAlphaSnapshot.trailingShares
                  : null;

              const trailingFcfPerShare =
                shares != null && trailingFreeCashFlow != null ? trailingFreeCashFlow / shares : null;
              const trailingRevenuePerShare =
                shares != null && trailingTotalRevenue != null ? trailingTotalRevenue / shares : null;

              fundResults[ticker] = {
                trailingPE: null,
                forwardPE: null,
                trailingEps: trailingEps ?? null,
                forwardEps: null,
                trailingFcfPerShare,
                trailingRevenuePerShare,
                trailingTotalRevenue: trailingTotalRevenue ?? null,
                trailingRevenueShares: shares,
              };
              return;
            }

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
                trailingPE = getLatestTimeseriesRaw(item?.trailingPeRatio);
              } else if (type === "trailingDilutedEPS") {
                trailingEps = getLatestTimeseriesRaw(item?.trailingDilutedEPS, true);
              } else if (type === "trailingBasicEPS" && trailingEps == null) {
                trailingEps = getLatestTimeseriesRaw(item?.trailingBasicEPS, true);
              } else if (type === "trailingFreeCashFlow") {
                trailingFreeCashFlow = getLatestTimeseriesRaw(item?.trailingFreeCashFlow, true);
              } else if (type === "trailingTotalRevenue") {
                trailingTotalRevenue = getLatestTimeseriesRaw(item?.trailingTotalRevenue, true);
              } else if (type === "trailingDilutedAverageShares") {
                trailingDilutedAverageShares = getLatestTimeseriesRaw(item?.trailingDilutedAverageShares, true);
              } else if (type === "trailingBasicAverageShares") {
                trailingBasicAverageShares = getLatestTimeseriesRaw(item?.trailingBasicAverageShares, true);
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
        .then(() => {});
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
