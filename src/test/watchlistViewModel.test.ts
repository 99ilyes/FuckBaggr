import { describe, expect, it } from "vitest";
import {
  buildWatchlistViewModel,
  filterMarkersByRange,
  WatchlistComputedRow,
  TransactionLike,
} from "@/lib/watchlistViewModel";

const baseRows: WatchlistComputedRow[] = [
  {
    ticker: "AAPL",
    name: "Apple Inc",
    price: 200,
    currency: "USD",
    changePercent: 1.2,
    impliedReturn: 12.5,
    fairPrice: 210,
    isCustom: false,
    hasValuation: true,
    valuationModel: "pe",
    ratioLabel: "PER",
    currentRatio: 28,
    metricLabel: "EPS ann.",
    autoMetric: 7.2,
    manualMetric: null,
    effectiveMetric: 7.2,
    inferredMarketCap: 3_000_000_000_000,
  },
];

const portfolios = [
  { id: "p1", name: "Compte CTO", color: "#22c55e" },
  { id: "p2", name: "Compte PEA", color: "#3b82f6" },
];

function buildModel(transactions: TransactionLike[]) {
  return buildWatchlistViewModel({
    rows: baseRows,
    transactions,
    portfolios,
    assetsCache: [{ ticker: "AAPL", name: "Apple Inc", currency: "USD", sector: "Technology", last_price: 200 }],
    sort: "implied_desc",
  });
}

describe("watchlistViewModel", () => {
  it("calcule le PRU global correctement apres buy/sell/transfer", () => {
    const txs: TransactionLike[] = [
      {
        id: "1",
        ticker: "AAPL",
        type: "buy",
        quantity: 10,
        unit_price: 100,
        fees: 0,
        date: "2024-01-01",
        portfolio_id: "p1",
        currency: "USD",
      },
      {
        id: "2",
        ticker: "AAPL",
        type: "sell",
        quantity: 4,
        unit_price: 120,
        fees: 0,
        date: "2024-02-01",
        portfolio_id: "p1",
        currency: "USD",
      },
      {
        id: "3",
        ticker: "AAPL",
        type: "transfer_in",
        quantity: 2,
        unit_price: 110,
        fees: 0,
        date: "2024-03-01",
        portfolio_id: "p2",
        currency: "USD",
      },
    ];

    const model = buildModel(txs);
    const detail = model.detailsByTicker.AAPL;

    expect(detail.quantity).toBeCloseTo(8);
    expect(detail.pru).toBeCloseTo(102.5, 6);
  });

  it("reset le PRU quand la position revient a zero", () => {
    const txs: TransactionLike[] = [
      {
        id: "1",
        ticker: "AAPL",
        type: "buy",
        quantity: 1,
        unit_price: 100,
        fees: 0,
        date: "2024-01-01",
        portfolio_id: "p1",
        currency: "USD",
      },
      {
        id: "2",
        ticker: "AAPL",
        type: "sell",
        quantity: 1,
        unit_price: 140,
        fees: 0,
        date: "2024-01-10",
        portfolio_id: "p1",
        currency: "USD",
      },
    ];

    const model = buildModel(txs);
    const detail = model.detailsByTicker.AAPL;

    expect(detail.quantity).toBe(0);
    expect(detail.pru).toBeNull();
    expect(detail.portfolioPresence).toHaveLength(0);
  });

  it("retourne les presences portefeuilles ouvertes", () => {
    const txs: TransactionLike[] = [
      {
        id: "1",
        ticker: "AAPL",
        type: "buy",
        quantity: 2,
        unit_price: 100,
        fees: 0,
        date: "2024-01-01",
        portfolio_id: "p1",
        currency: "USD",
      },
      {
        id: "2",
        ticker: "AAPL",
        type: "buy",
        quantity: 3,
        unit_price: 90,
        fees: 0,
        date: "2024-01-02",
        portfolio_id: "p2",
        currency: "USD",
      },
    ];

    const model = buildModel(txs);
    const detail = model.detailsByTicker.AAPL;

    expect(detail.portfolioPresence).toHaveLength(2);
    expect(detail.portfolioPresence.map((row) => row.portfolioName).sort()).toEqual(["Compte CTO", "Compte PEA"]);
  });

  it("filtre les marqueurs achat/vente par plage", () => {
    const txs: TransactionLike[] = [
      {
        id: "1",
        ticker: "AAPL",
        type: "buy",
        quantity: 1,
        unit_price: 100,
        fees: 0,
        date: "2024-01-01",
        portfolio_id: "p1",
        currency: "USD",
      },
      {
        id: "2",
        ticker: "AAPL",
        type: "sell",
        quantity: 1,
        unit_price: 120,
        fees: 0,
        date: "2024-02-01",
        portfolio_id: "p1",
        currency: "USD",
      },
      {
        id: "3",
        ticker: "AAPL",
        type: "buy",
        quantity: 2,
        unit_price: 110,
        fees: 0,
        date: "2024-03-01",
        portfolio_id: "p2",
        currency: "USD",
      },
    ];

    const model = buildModel(txs);
    const markers = model.detailsByTicker.AAPL.operationMarkers;

    const from = Math.floor(new Date("2024-01-15").getTime() / 1000);
    const to = Math.floor(new Date("2024-02-20").getTime() / 1000);

    const filtered = filterMarkersByRange(markers, from, to);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("2");
  });
});
