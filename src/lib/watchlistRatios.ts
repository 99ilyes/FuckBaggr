export interface RatioPricePoint {
  time: number;
  price: number;
}

export interface FundamentalsHistorySnapshot {
  asOfDate: string;
  trailingPeRatio: number | null;
  trailingEps: number | null;
  trailingFreeCashFlow: number | null;
  trailingTotalRevenue: number | null;
  trailingShares: number | null;
}

export interface RatioSeriesPoint {
  time: number;
  value: number;
  sourceAsOfDate?: string | null;
  sourceMetricValue?: number | null;
  sourceMetricKind?: "eps" | "fcf" | "revenue" | "none";
}

export interface RatioSeriesBundle {
  peSeries: RatioSeriesPoint[];
  pfcfSeries: RatioSeriesPoint[];
  psSeries: RatioSeriesPoint[];
  peQuarterlyPoints: RatioSeriesPoint[];
  pfcfQuarterlyPoints: RatioSeriesPoint[];
  psQuarterlyPoints: RatioSeriesPoint[];
}

export interface RatioStats {
  high: number | null;
  median: number | null;
  low: number | null;
}

interface SnapshotWithTime extends FundamentalsHistorySnapshot {
  timestamp: number;
}

function toFinitePositive(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeToSecondTimestamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value > 1_000_000_000_000) {
    return Math.floor(value / 1000);
  }
  return Math.floor(value);
}

function toDateTimestamp(value: string): number {
  const ms = new Date(`${value}T00:00:00Z`).getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.floor(ms / 1000);
}

function safeDividePositive(numerator: number | null, denominator: number | null): number | null {
  const n = toFinitePositive(numerator ?? null);
  const d = toFinitePositive(denominator ?? null);
  if (n == null || d == null) return null;

  const result = n / d;
  if (!Number.isFinite(result) || result <= 0) return null;
  return result;
}

function pushSeriesPoint(
  series: RatioSeriesPoint[],
  time: number,
  value: number | null,
  sourceAsOfDate?: string | null,
  sourceMetricValue?: number | null,
  sourceMetricKind: RatioSeriesPoint["sourceMetricKind"] = "none"
) {
  if (value == null || !Number.isFinite(value) || value <= 0) return;
  series.push({
    time,
    value,
    sourceAsOfDate: sourceAsOfDate ?? null,
    sourceMetricValue: sourceMetricValue ?? null,
    sourceMetricKind,
  });
}

function sortSnapshots(snapshots: FundamentalsHistorySnapshot[]): SnapshotWithTime[] {
  return snapshots
    .map((snapshot) => ({
      ...snapshot,
      timestamp: toDateTimestamp(snapshot.asOfDate),
    }))
    .filter((snapshot) => snapshot.timestamp > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function sortPrices(priceHistory: RatioPricePoint[]): RatioPricePoint[] {
  return [...priceHistory]
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.price))
    .map((point) => ({
      time: normalizeToSecondTimestamp(point.time),
      price: point.price,
    }))
    .sort((a, b) => a.time - b.time);
}

function findPriceForSnapshotTime(snapshotTime: number, sortedPrices: RatioPricePoint[]): number | null {
  if (sortedPrices.length === 0) return null;

  let left = 0;
  let right = sortedPrices.length;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (sortedPrices[mid].time < snapshotTime) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  if (left < sortedPrices.length) {
    return toFinitePositive(sortedPrices[left].price);
  }

  return toFinitePositive(sortedPrices[sortedPrices.length - 1].price);
}

function buildQuarterlyPoints(
  sortedPrices: RatioPricePoint[],
  sortedSnapshots: SnapshotWithTime[]
): Pick<RatioSeriesBundle, "peQuarterlyPoints" | "pfcfQuarterlyPoints" | "psQuarterlyPoints"> {
  const peQuarterlyPoints: RatioSeriesPoint[] = [];
  const pfcfQuarterlyPoints: RatioSeriesPoint[] = [];
  const psQuarterlyPoints: RatioSeriesPoint[] = [];

  for (const snapshot of sortedSnapshots) {
    const price = findPriceForSnapshotTime(snapshot.timestamp, sortedPrices);
    if (price == null) continue;

    const eps = toFinitePositive(snapshot.trailingEps);
    const peFromMetric = safeDividePositive(price, eps);
    const pe = peFromMetric ?? toFinitePositive(snapshot.trailingPeRatio);

    const shares = toFinitePositive(snapshot.trailingShares);
    const marketCap = shares != null ? price * shares : null;

    const trailingFcf = toFinitePositive(snapshot.trailingFreeCashFlow);
    const trailingRevenue = toFinitePositive(snapshot.trailingTotalRevenue);
    const pfcf = safeDividePositive(marketCap, trailingFcf);
    const ps = safeDividePositive(marketCap, trailingRevenue);

    pushSeriesPoint(
      peQuarterlyPoints,
      snapshot.timestamp,
      pe,
      snapshot.asOfDate,
      peFromMetric != null ? eps : null,
      peFromMetric != null ? "eps" : "none"
    );
    pushSeriesPoint(
      pfcfQuarterlyPoints,
      snapshot.timestamp,
      pfcf,
      snapshot.asOfDate,
      trailingFcf,
      "fcf"
    );
    pushSeriesPoint(
      psQuarterlyPoints,
      snapshot.timestamp,
      ps,
      snapshot.asOfDate,
      trailingRevenue,
      "revenue"
    );
  }

  return { peQuarterlyPoints, pfcfQuarterlyPoints, psQuarterlyPoints };
}

export function buildRatioSeries(
  priceHistory: RatioPricePoint[],
  snapshots: FundamentalsHistorySnapshot[]
): RatioSeriesBundle {
  const peSeries: RatioSeriesPoint[] = [];
  const pfcfSeries: RatioSeriesPoint[] = [];
  const psSeries: RatioSeriesPoint[] = [];
  const peQuarterlyPoints: RatioSeriesPoint[] = [];
  const pfcfQuarterlyPoints: RatioSeriesPoint[] = [];
  const psQuarterlyPoints: RatioSeriesPoint[] = [];

  const sortedPrices = sortPrices(priceHistory);
  const sortedSnapshots = sortSnapshots(snapshots);
  if (sortedPrices.length === 0 || sortedSnapshots.length === 0) {
    return {
      peSeries,
      pfcfSeries,
      psSeries,
      peQuarterlyPoints,
      pfcfQuarterlyPoints,
      psQuarterlyPoints,
    };
  }

  // Some providers return only the latest fundamentals window.
  // Use the oldest available snapshot as fallback for earlier prices
  // so long-range presets (5Y/MAX) remain fully visible.
  let snapshotIndex = 0;

  for (const pricePoint of sortedPrices) {
    while (
      snapshotIndex + 1 < sortedSnapshots.length &&
      sortedSnapshots[snapshotIndex + 1].timestamp <= pricePoint.time
    ) {
      snapshotIndex += 1;
    }

    const snapshot = sortedSnapshots[snapshotIndex];
    const price = toFinitePositive(pricePoint.price);
    if (price == null) continue;

    const eps = toFinitePositive(snapshot.trailingEps);
    const peFromMetric = safeDividePositive(price, eps);
    const pe = peFromMetric ?? toFinitePositive(snapshot.trailingPeRatio);

    const shares = toFinitePositive(snapshot.trailingShares);
    const marketCap = shares != null ? price * shares : null;

    const trailingFcf = toFinitePositive(snapshot.trailingFreeCashFlow);
    const trailingRevenue = toFinitePositive(snapshot.trailingTotalRevenue);
    const pfcf = safeDividePositive(marketCap, trailingFcf);
    const ps = safeDividePositive(marketCap, trailingRevenue);

    pushSeriesPoint(
      peSeries,
      pricePoint.time,
      pe,
      snapshot.asOfDate,
      peFromMetric != null ? eps : null,
      peFromMetric != null ? "eps" : "none"
    );
    pushSeriesPoint(
      pfcfSeries,
      pricePoint.time,
      pfcf,
      snapshot.asOfDate,
      trailingFcf,
      "fcf"
    );
    pushSeriesPoint(
      psSeries,
      pricePoint.time,
      ps,
      snapshot.asOfDate,
      trailingRevenue,
      "revenue"
    );
  }

  const quarterlyPoints = buildQuarterlyPoints(sortedPrices, sortedSnapshots);

  return {
    peSeries,
    pfcfSeries,
    psSeries,
    ...quarterlyPoints,
  };
}

export function computeStats(series: RatioSeriesPoint[]): RatioStats {
  const values = series
    .map((point) => point.value)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (values.length === 0) {
    return { high: null, median: null, low: null };
  }

  const low = values[0];
  const high = values[values.length - 1];
  const middle = Math.floor(values.length / 2);
  const median =
    values.length % 2 === 0
      ? (values[middle - 1] + values[middle]) / 2
      : values[middle];

  return { high, median, low };
}
