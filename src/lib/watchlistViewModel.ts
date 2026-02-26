import { ValuationModel, WatchlistSort } from "@/lib/watchlistTypes";

const POSITION_EPSILON = 1e-9;

type TxType = "buy" | "sell" | "transfer_in" | "transfer_out";

export interface WatchlistComputedRow {
  ticker: string;
  name: string;
  price: number | null;
  currency: string;
  changePercent: number | null;
  impliedReturn: number | null;
  fairPrice: number | null;
  isCustom: boolean;
  hasValuation: boolean;
  valuationModel: ValuationModel;
  ratioLabel: string;
  currentRatio: number | null;
  metricLabel: string;
  autoMetric: number | null;
  manualMetric: number | null;
  effectiveMetric: number | null;
  inferredMarketCap: number | null;
}

export interface TransactionLike {
  id?: string;
  ticker: string | null;
  type: string;
  quantity: number | null;
  unit_price: number | null;
  fees: number;
  date: string;
  portfolio_id: string;
  currency: string | null;
}

export interface PortfolioLike {
  id: string;
  name: string;
  color: string;
}

export interface AssetCacheLike {
  ticker: string;
  name: string | null;
  currency: string | null;
  sector: string | null;
  last_price: number | null;
}

export interface TickerOperationMarker {
  id: string;
  date: string;
  timestamp: number;
  type: TxType;
  quantity: number;
  price: number | null;
  currency: string;
  portfolioId: string;
  portfolioName: string;
  portfolioColor: string | null;
}

export interface TickerPortfolioPresence {
  portfolioId: string;
  portfolioName: string;
  portfolioColor: string | null;
  quantity: number;
  pru: number;
  currentValue: number | null;
  currency: string;
}

export interface WatchlistTickerDetail {
  ticker: string;
  pru: number | null;
  quantity: number;
  assetName: string;
  assetCurrency: string;
  sector: string | null;
  ratioLabel: string;
  currentRatio: number | null;
  metricLabel: string;
  effectiveMetric: number | null;
  inferredMarketCap: number | null;
  portfolioPresence: TickerPortfolioPresence[];
  operationMarkers: TickerOperationMarker[];
  latestOperations: TickerOperationMarker[];
}

export interface WatchlistViewModel {
  menuRows: WatchlistComputedRow[];
  detailsByTicker: Record<string, WatchlistTickerDetail>;
}

interface BuildWatchlistViewModelArgs {
  rows: WatchlistComputedRow[];
  transactions: TransactionLike[];
  portfolios: PortfolioLike[];
  assetsCache: AssetCacheLike[];
  sort: WatchlistSort;
}

interface PositionState {
  quantity: number;
  totalCost: number;
  currency: string;
}

function canonicalTicker(value: string | null | undefined): string {
  return (value || "").trim().toUpperCase();
}

function parseDateTimestamp(date: string): number {
  const ms = new Date(date).getTime();
  if (Number.isNaN(ms)) return 0;
  return Math.floor(ms / 1000);
}

function toIsoDate(value: string): string {
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return value.slice(0, 10);
  return new Date(ms).toISOString().slice(0, 10);
}

function isPositionOpen(quantity: number): boolean {
  return quantity > POSITION_EPSILON;
}

function isTrackedTradeType(type: string): type is TxType {
  return type === "buy" || type === "sell" || type === "transfer_in" || type === "transfer_out";
}

function applyTradeToPosition(state: PositionState, tx: TransactionLike) {
  const quantity = Math.abs(tx.quantity ?? 0);
  const unitPrice = tx.unit_price ?? 0;
  const fees = tx.fees ?? 0;

  if (!Number.isFinite(quantity) || quantity <= 0) return;

  if (tx.type === "buy" || tx.type === "transfer_in") {
    state.totalCost += quantity * unitPrice + fees;
    state.quantity += quantity;
    return;
  }

  if ((tx.type === "sell" || tx.type === "transfer_out") && state.quantity > POSITION_EPSILON) {
    const pru = state.totalCost / state.quantity;
    state.quantity -= quantity;
    state.totalCost -= quantity * pru;

    if (state.quantity <= POSITION_EPSILON) {
      state.quantity = 0;
      state.totalCost = 0;
    }
  }
}

function compareByDateThenType(a: TransactionLike, b: TransactionLike): number {
  const ad = new Date(a.date).getTime();
  const bd = new Date(b.date).getTime();
  if (ad !== bd) return ad - bd;

  const order: Record<string, number> = {
    buy: 0,
    transfer_in: 1,
    sell: 2,
    transfer_out: 3,
  };

  return (order[a.type] ?? 99) - (order[b.type] ?? 99);
}

function compareMenuRows(a: WatchlistComputedRow, b: WatchlistComputedRow, sort: WatchlistSort): number {
  if (sort === "alpha") {
    return a.ticker.localeCompare(b.ticker);
  }

  if (sort === "change_desc") {
    const av = a.changePercent;
    const bv = b.changePercent;
    if (av == null && bv == null) return a.ticker.localeCompare(b.ticker);
    if (av == null) return 1;
    if (bv == null) return -1;
    if (bv !== av) return bv - av;
    return a.ticker.localeCompare(b.ticker);
  }

  const av = a.impliedReturn;
  const bv = b.impliedReturn;
  if (av == null && bv == null) return a.ticker.localeCompare(b.ticker);
  if (av == null) return 1;
  if (bv == null) return -1;
  if (bv !== av) return bv - av;
  return a.ticker.localeCompare(b.ticker);
}

export function filterMarkersByRange(
  markers: TickerOperationMarker[],
  fromTimestamp?: number,
  toTimestamp?: number
): TickerOperationMarker[] {
  return markers.filter((marker) => {
    if (fromTimestamp != null && marker.timestamp < fromTimestamp) return false;
    if (toTimestamp != null && marker.timestamp > toTimestamp) return false;
    return true;
  });
}

export function buildWatchlistViewModel({
  rows,
  transactions,
  portfolios,
  assetsCache,
  sort,
}: BuildWatchlistViewModelArgs): WatchlistViewModel {
  const menuRows = [...rows].sort((a, b) => compareMenuRows(a, b, sort));
  const detailsByTicker: Record<string, WatchlistTickerDetail> = {};

  const portfolioMap = new Map(portfolios.map((portfolio) => [portfolio.id, portfolio]));
  const cacheByTicker = new Map(assetsCache.map((asset) => [canonicalTicker(asset.ticker), asset]));

  const sortedTransactions = [...transactions].sort(compareByDateThenType);

  for (const row of rows) {
    const rowTicker = canonicalTicker(row.ticker);
    const tickerTransactions = sortedTransactions.filter((tx) => {
      if (!tx.ticker || !isTrackedTradeType(tx.type)) return false;
      return canonicalTicker(tx.ticker) === rowTicker;
    });

    const globalPosition: PositionState = {
      quantity: 0,
      totalCost: 0,
      currency: row.currency,
    };

    const positionsByPortfolio = new Map<string, PositionState>();
    const markers: TickerOperationMarker[] = [];

    tickerTransactions.forEach((tx, index) => {
      const portfolio = portfolioMap.get(tx.portfolio_id);
      const operationQuantity = Math.abs(tx.quantity ?? 0);
      if (operationQuantity <= 0) return;

      const marker: TickerOperationMarker = {
        id: tx.id || `${row.ticker}-${tx.date}-${tx.type}-${index}`,
        date: toIsoDate(tx.date),
        timestamp: parseDateTimestamp(tx.date),
        type: tx.type as TxType,
        quantity: operationQuantity,
        price: tx.unit_price ?? null,
        currency: (tx.currency || row.currency || "EUR").toUpperCase(),
        portfolioId: tx.portfolio_id,
        portfolioName: portfolio?.name || tx.portfolio_id,
        portfolioColor: portfolio?.color || null,
      };
      markers.push(marker);

      applyTradeToPosition(globalPosition, tx);

      const currentPortfolioState =
        positionsByPortfolio.get(tx.portfolio_id) || {
          quantity: 0,
          totalCost: 0,
          currency: (tx.currency || row.currency || "EUR").toUpperCase(),
        };

      applyTradeToPosition(currentPortfolioState, tx);
      positionsByPortfolio.set(tx.portfolio_id, currentPortfolioState);
    });

    const cacheAsset = cacheByTicker.get(rowTicker);
    const priceForValue = row.price ?? cacheAsset?.last_price ?? null;

    const portfolioPresence: TickerPortfolioPresence[] = Array.from(positionsByPortfolio.entries())
      .filter(([, position]) => isPositionOpen(position.quantity))
      .map(([portfolioId, position]) => {
        const portfolio = portfolioMap.get(portfolioId);
        const pru = position.totalCost / position.quantity;

        return {
          portfolioId,
          portfolioName: portfolio?.name || portfolioId,
          portfolioColor: portfolio?.color || null,
          quantity: position.quantity,
          pru,
          currentValue: priceForValue != null ? position.quantity * priceForValue : null,
          currency: position.currency || row.currency,
        };
      })
      .sort((a, b) => {
        const av = a.currentValue ?? -Infinity;
        const bv = b.currentValue ?? -Infinity;
        if (av !== bv) return bv - av;
        return a.portfolioName.localeCompare(b.portfolioName);
      });

    const operationMarkers = [...markers].sort((a, b) => a.timestamp - b.timestamp);
    const latestOperations = [...markers].sort((a, b) => b.timestamp - a.timestamp).slice(0, 8);

    const detail: WatchlistTickerDetail = {
      ticker: row.ticker,
      pru: isPositionOpen(globalPosition.quantity) ? globalPosition.totalCost / globalPosition.quantity : null,
      quantity: globalPosition.quantity,
      assetName: row.name || cacheAsset?.name || row.ticker,
      assetCurrency: (cacheAsset?.currency || row.currency || "EUR").toUpperCase(),
      sector: cacheAsset?.sector || null,
      ratioLabel: row.ratioLabel,
      currentRatio: row.currentRatio,
      metricLabel: row.metricLabel,
      effectiveMetric: row.effectiveMetric,
      inferredMarketCap: row.inferredMarketCap,
      portfolioPresence,
      operationMarkers,
      latestOperations,
    };

    detailsByTicker[row.ticker] = detail;
  }

  return { menuRows, detailsByTicker };
}
