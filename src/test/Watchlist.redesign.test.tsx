import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WatchlistTickerMenu } from "@/components/watchlist/WatchlistTickerMenu";
import { WatchlistInfoCard } from "@/components/watchlist/WatchlistInfoCard";
import { WatchlistValuationCard } from "@/components/watchlist/WatchlistValuationCard";
import { WatchlistValuationRatiosCard } from "@/components/watchlist/WatchlistValuationRatiosCard";
import { WatchlistSort } from "@/lib/watchlistTypes";
import { WatchlistComputedRow, WatchlistTickerDetail } from "@/lib/watchlistViewModel";

const invokeMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => invokeMock(...args),
    },
  },
}));

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

function createRatioResponses(ticker: string) {
  return {
    history: {
      data: {
        results: {
          [ticker]: {
            history: [
              { time: Math.floor(new Date("2024-01-01").getTime() / 1000), price: 100 },
              { time: Math.floor(new Date("2024-02-01").getTime() / 1000), price: 105 },
              { time: Math.floor(new Date("2024-03-01").getTime() / 1000), price: 110 },
            ],
          },
        },
      },
      error: null,
    },
    fundamentals: {
      data: {
        results: {
          [ticker]: {
            snapshots: [
              {
                asOfDate: "2023-12-31",
                trailingPeRatio: 20,
                trailingEps: 5,
                trailingFreeCashFlow: 2_000_000,
                trailingTotalRevenue: 8_000_000,
                trailingShares: 100_000,
              },
              {
                asOfDate: "2024-02-15",
                trailingPeRatio: 22,
                trailingEps: 5.1,
                trailingFreeCashFlow: 2_200_000,
                trailingTotalRevenue: 8_400_000,
                trailingShares: 100_000,
              },
            ],
          },
        },
      },
      error: null,
    },
  };
}

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

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

function Harness({ deferRankedData = false }: { deferRankedData?: boolean }) {
  const [rows, setRows] = useState(() =>
    deferRankedData ? rowsSeed.map((row) => ({ ...row, impliedReturn: null })) : rowsSeed
  );
  const [isLoading, setIsLoading] = useState(deferRankedData);
  const [sort, setSort] = useState<WatchlistSort>("implied_desc");
  const sortedRows = useMemo(() => sortRows(rows, sort), [rows, sort]);
  const [selectedTicker, setSelectedTicker] = useState<string | null>("AAA");
  const hasAppliedDefaultSelectionRef = useRef(false);

  useEffect(() => {
    if (!deferRankedData) return;
    setRows(rowsSeed);
    setIsLoading(false);
  }, [deferRankedData]);

  useEffect(() => {
    if (sortedRows.length === 0) {
      hasAppliedDefaultSelectionRef.current = false;
      setSelectedTicker(null);
      return;
    }

    if (!hasAppliedDefaultSelectionRef.current) {
      if (isLoading) return;
      hasAppliedDefaultSelectionRef.current = true;
      setSelectedTicker(sortedRows[0].ticker);
      return;
    }

    if (!selectedTicker || !sortedRows.some((row) => row.ticker === selectedTicker)) {
      setSelectedTicker(sortedRows[0].ticker);
    }
  }, [sortedRows, selectedTicker, isLoading]);

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

function LayoutHarness() {
  const row = rowsSeed[1];
  const detail = detailsSeed.BBB;

  return (
    <div className="grid gap-4 min-w-0 xl:grid-cols-2 xl:items-start">
      <div className="space-y-4 min-w-0">
        <WatchlistValuationCard
          ticker={row.ticker}
          currency={row.currency}
          valuationModel={row.valuationModel}
          autoMetric={row.autoMetric}
          manualMetric={row.manualMetric}
          params={{ growth: 10, terminalPE: 20, years: 5 }}
          targetReturn={10}
          fairPrice={row.fairPrice}
          impliedReturn={row.impliedReturn}
          onCreateValuation={() => {}}
          onValuationModelChange={() => {}}
          onManualMetricChange={() => {}}
          onUpdateParam={() => {}}
          onTargetReturnChange={() => {}}
        />
        <WatchlistInfoCard detail={detail} />
      </div>
      <div className="min-w-0">
        <WatchlistValuationRatiosCard ticker="BBB" />
      </div>
    </div>
  );
}

describe("Watchlist redesign UI", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

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
    expect(screen.getByTestId("selected-ticker")).toHaveTextContent("BBB");
  });

  it("selectionne le premier titre par rendement une fois les donnees chargees", async () => {
    render(<Harness deferRankedData />);

    await waitFor(() => {
      expect(screen.getByTestId("selected-ticker")).toHaveTextContent("BBB");
    });
  });

  it("affiche Valorisation puis Informations dans la colonne gauche", async () => {
    const mockData = createRatioResponses("BBB");
    invokeMock.mockImplementation((fn: string) => {
      if (fn === "fetch-history") return Promise.resolve(mockData.history);
      if (fn === "fetch-prices") return Promise.resolve(mockData.fundamentals);
      return Promise.resolve({ data: {}, error: null });
    });

    renderWithQuery(<LayoutHarness />);

    const valuationTitle = screen.getByText("Valorisation");
    const infoTitle = screen.getByText("Informations");

    expect(valuationTitle.compareDocumentPosition(infoTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(screen.getByTestId("valuation-ratios-card")).toBeInTheDocument();
  });

  it("affiche les 3 graphes ratios et relance le chargement au changement de periode", async () => {
    const mockData = createRatioResponses("BBB");
    invokeMock.mockImplementation((fn: string) => {
      if (fn === "fetch-history") return Promise.resolve(mockData.history);
      if (fn === "fetch-prices") return Promise.resolve(mockData.fundamentals);
      return Promise.resolve({ data: {}, error: null });
    });

    renderWithQuery(<WatchlistValuationRatiosCard ticker="BBB" />);

    expect(await screen.findByTestId("ratio-chart-pe")).toBeInTheDocument();
    expect(screen.getByTestId("ratio-chart-pfcf")).toBeInTheDocument();
    expect(screen.getByTestId("ratio-chart-ps")).toBeInTheDocument();

    const highBadges = screen.getAllByText(/High:/);
    expect(highBadges.length).toBe(3);

    const initialCalls = invokeMock.mock.calls.length;
    fireEvent.click(screen.getByTestId("ratio-period-1A"));
    await waitFor(() => expect(invokeMock.mock.calls.length).toBeGreaterThan(initialCalls));
  });
});
