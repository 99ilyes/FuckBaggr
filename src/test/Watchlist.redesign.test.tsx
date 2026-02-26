import { useEffect, useMemo, useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WatchlistTickerMenu } from "@/components/watchlist/WatchlistTickerMenu";
import { WatchlistInfoCard } from "@/components/watchlist/WatchlistInfoCard";
import { WatchlistSort } from "@/lib/watchlistTypes";
import { WatchlistComputedRow, WatchlistTickerDetail } from "@/lib/watchlistViewModel";

const rowsSeed: WatchlistComputedRow[] = [
  {
    ticker: "AAA",
    name: "Alpha Corp",
    price: 100,
    currency: "USD",
    changePercent: 1,
    impliedReturn: 8,
    fairPrice: 110,
    isCustom: false,
    hasValuation: true,
    valuationModel: "pe",
    ratioLabel: "PER",
    currentRatio: 20,
    metricLabel: "EPS ann.",
    autoMetric: 5,
    manualMetric: null,
    effectiveMetric: 5,
    inferredMarketCap: null,
  },
  {
    ticker: "BBB",
    name: "Beta Corp",
    price: 150,
    currency: "USD",
    changePercent: 2,
    impliedReturn: 15,
    fairPrice: 170,
    isCustom: false,
    hasValuation: true,
    valuationModel: "pe",
    ratioLabel: "PER",
    currentRatio: 25,
    metricLabel: "EPS ann.",
    autoMetric: 6,
    manualMetric: null,
    effectiveMetric: 6,
    inferredMarketCap: null,
  },
  {
    ticker: "CCC",
    name: "Gamma Corp",
    price: 80,
    currency: "USD",
    changePercent: -1,
    impliedReturn: 3,
    fairPrice: 82,
    isCustom: false,
    hasValuation: true,
    valuationModel: "pe",
    ratioLabel: "PER",
    currentRatio: 12,
    metricLabel: "EPS ann.",
    autoMetric: 4,
    manualMetric: null,
    effectiveMetric: 4,
    inferredMarketCap: null,
  },
];

const detailsSeed: Record<string, WatchlistTickerDetail> = {
  AAA: {
    ticker: "AAA",
    pru: null,
    quantity: 0,
    assetName: "Alpha Corp",
    assetCurrency: "USD",
    sector: "Tech",
    ratioLabel: "PER",
    currentRatio: 20,
    metricLabel: "EPS ann.",
    effectiveMetric: 5,
    inferredMarketCap: null,
    portfolioPresence: [],
    operationMarkers: [],
    latestOperations: [],
  },
  BBB: {
    ticker: "BBB",
    pru: 120,
    quantity: 3,
    assetName: "Beta Corp",
    assetCurrency: "USD",
    sector: "Industry",
    ratioLabel: "PER",
    currentRatio: 25,
    metricLabel: "EPS ann.",
    effectiveMetric: 6,
    inferredMarketCap: 20_000_000,
    portfolioPresence: [
      {
        portfolioId: "p1",
        portfolioName: "CTO",
        portfolioColor: "#22c55e",
        quantity: 3,
        pru: 120,
        currentValue: 450,
        currency: "USD",
      },
    ],
    operationMarkers: [
      {
        id: "op-1",
        date: "2024-03-01",
        timestamp: Math.floor(new Date("2024-03-01").getTime() / 1000),
        type: "buy",
        quantity: 3,
        price: 120,
        currency: "USD",
        portfolioId: "p1",
        portfolioName: "CTO",
        portfolioColor: "#22c55e",
      },
    ],
    latestOperations: [
      {
        id: "op-1",
        date: "2024-03-01",
        timestamp: Math.floor(new Date("2024-03-01").getTime() / 1000),
        type: "buy",
        quantity: 3,
        price: 120,
        currency: "USD",
        portfolioId: "p1",
        portfolioName: "CTO",
        portfolioColor: "#22c55e",
      },
    ],
  },
  CCC: {
    ticker: "CCC",
    pru: 60,
    quantity: 2,
    assetName: "Gamma Corp",
    assetCurrency: "USD",
    sector: "Energy",
    ratioLabel: "PER",
    currentRatio: 12,
    metricLabel: "EPS ann.",
    effectiveMetric: 4,
    inferredMarketCap: 10_000_000,
    portfolioPresence: [],
    operationMarkers: [],
    latestOperations: [],
  },
};

function sortRows(rows: WatchlistComputedRow[], sort: WatchlistSort): WatchlistComputedRow[] {
  return [...rows].sort((a, b) => {
    if (sort === "alpha") return a.ticker.localeCompare(b.ticker);
    if (sort === "change_desc") {
      const av = a.changePercent ?? -Infinity;
      const bv = b.changePercent ?? -Infinity;
      if (av !== bv) return bv - av;
      return a.ticker.localeCompare(b.ticker);
    }

    const av = a.impliedReturn ?? -Infinity;
    const bv = b.impliedReturn ?? -Infinity;
    if (av !== bv) return bv - av;
    return a.ticker.localeCompare(b.ticker);
  });
}

function Harness() {
  const [rows, setRows] = useState(rowsSeed);
  const [sort, setSort] = useState<WatchlistSort>("implied_desc");
  const sortedRows = useMemo(() => sortRows(rows, sort), [rows, sort]);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(sortedRows[0]?.ticker ?? null);

  useEffect(() => {
    if (sortedRows.length === 0) {
      setSelectedTicker(null);
      return;
    }

    if (!selectedTicker || !sortedRows.some((row) => row.ticker === selectedTicker)) {
      setSelectedTicker(sortedRows[0].ticker);
    }
  }, [sortedRows, selectedTicker]);

  const selectedDetail = selectedTicker ? detailsSeed[selectedTicker] : null;

  return (
    <div>
      <WatchlistTickerMenu
        rows={sortedRows}
        selectedTicker={selectedTicker}
        onSelectTicker={setSelectedTicker}
        onRemoveTicker={(ticker) => setRows((prev) => prev.filter((row) => row.ticker !== ticker))}
        sort={sort}
        onSortChange={setSort}
        searchSlot={<div />}
      />
      <p data-testid="selected-ticker">{selectedTicker || "none"}</p>
      {selectedDetail ? <WatchlistInfoCard detail={selectedDetail} /> : null}
    </div>
  );
}

describe("Watchlist redesign UI", () => {
  it("met a jour le volet detail quand on selectionne un ticker", () => {
    render(<Harness />);

    fireEvent.click(screen.getByText("AAA"));

    expect(screen.getByTestId("selected-ticker")).toHaveTextContent("AAA");
  });

  it("bascule sur un ticker valide apres suppression du ticker selectionne", () => {
    render(<Harness />);

    fireEvent.click(screen.getByText("AAA"));
    fireEvent.click(screen.getByLabelText("Supprimer AAA"));

    expect(screen.getByTestId("selected-ticker")).toHaveTextContent("BBB");
  });

  it("affiche un etat vide si le ticker n'a pas de position", () => {
    render(<WatchlistInfoCard detail={detailsSeed.AAA} />);

    expect(screen.getByText("Aucun portefeuille en position ouverte.")).toBeInTheDocument();
    expect(screen.getByText("Aucune opération trouvée pour ce titre.")).toBeInTheDocument();
  });

  it("utilise le tri par defaut rendement implicite", () => {
    render(<Harness />);

    const items = screen.getAllByTestId("watchlist-menu-item");
    expect(within(items[0]).getByText("BBB")).toBeInTheDocument();
  });
});
