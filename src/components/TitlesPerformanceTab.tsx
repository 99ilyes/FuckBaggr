import { useCallback, useEffect, useMemo, useState } from "react";
import { AssetHistory, Portfolio, Transaction } from "@/hooks/usePortfolios";
import { computeTWR, filterByRange, rebaseBenchmark, rebaseTWR, TWRDataPoint } from "@/lib/twr";
import { formatPercent } from "@/lib/calculations";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TickerSearch } from "@/components/TickerSearch";
import { TickerLogo } from "@/components/TickerLogo";
import { Search, X } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

interface Props {
  transactions: Transaction[];
  allTransactions: Transaction[];
  portfolios: Portfolio[];
  historicalPrices: Record<string, AssetHistory>;
  portfolioId: string | null;
  portfolioName: string;
  loading?: boolean;
  benchmarkHistories?: Record<string, { time: number; price: number }[]>;
  benchmarkTickers?: string[];
  benchSearch?: string;
  onBenchSearchChange?: (value: string) => void;
  onBenchmarkTickersChange?: (tickers: string[]) => void;
  maxBenchmarks?: number;
}

interface OpenTickerInfo {
  ticker: string;
  quantity: number;
  activeWindowStart: string;
}

interface TickerOperation {
  id: string;
  date: string;
  type: string;
  quantity: number;
}

interface TooltipEntry {
  color?: string;
  dataKey?: string;
  name?: string;
  value?: number | null;
}

interface TooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
}

interface TitleRow {
  ticker: string;
  quantity: number;
  from: string;
  to: string;
  titleReturn: number | null;
  portfolioReturn: number | null;
  benchmarkPortfolioReturn: number | null;
  benchmarkReturn: number | null;
}

const BENCH_COLORS = [
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-1))",
];

const TITLE_COLOR = "hsl(var(--chart-2))";
const PORTFOLIO_COLOR = "hsl(var(--chart-1))";
const PORTFOLIO_BENCH_COLOR = "hsl(var(--chart-5))";
const OP_TYPE_LABELS: Record<string, string> = {
  buy: "Achat",
  sell: "Vente",
  transfer_in: "Transfert entrant",
  transfer_out: "Transfert sortant",
};

function normalizePerformanceTicker(ticker: string): string {
  return ticker === "GOLD-EUR.PA" ? "GOLD.PA" : ticker;
}

function toIsoDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10);
  return parsed.toISOString().split("T")[0];
}

function fmtDate(date: string): string {
  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) return date || "-";
  return parsedDate.toLocaleDateString("fr-FR", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function fmtSignedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function fmtOptionalPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return formatPercent(value * 100);
}

function valueColorClass(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "text-muted-foreground";
  return value >= 0 ? "text-[hsl(var(--gain))]" : "text-[hsl(var(--loss))]";
}

function formatOperationLabel(operation: TickerOperation): string {
  const typeLabel = OP_TYPE_LABELS[operation.type] || operation.type;
  const qty = operation.quantity % 1 === 0 ? operation.quantity.toString() : operation.quantity.toFixed(3);
  return `${typeLabel} · ${fmtDate(operation.date)} · ${qty}`;
}

function buildOpenTickerInfos(transactions: Transaction[]): OpenTickerInfo[] {
  const map = new Map<string, { quantity: number; activeWindowStart: string | null }>();

  const sortedTransactions = [...transactions].sort((a, b) => {
    const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
    if (diff !== 0) return diff;
    const typePriority: Record<string, number> = {
      buy: 0,
      transfer_in: 1,
      sell: 2,
      transfer_out: 3,
    };
    return (typePriority[a.type] ?? 99) - (typePriority[b.type] ?? 99);
  });

  for (const tx of sortedTransactions) {
    if (!tx.ticker) continue;
    if (tx.type !== "buy" && tx.type !== "sell" && tx.type !== "transfer_in" && tx.type !== "transfer_out") continue;

    const qty = Math.abs(tx.quantity ?? 0);
    if (qty <= 0) continue;

    const ticker = normalizePerformanceTicker(tx.ticker);
    const txDate = toIsoDate(tx.date);
    const current = map.get(ticker) ?? { quantity: 0, activeWindowStart: null };

    if (tx.type === "buy" || tx.type === "transfer_in") {
      if (current.quantity <= 1e-9) {
        current.activeWindowStart = txDate;
      }
      current.quantity += qty;
    } else {
      current.quantity = Math.max(0, current.quantity - qty);
      if (current.quantity <= 1e-9) {
        current.quantity = 0;
        current.activeWindowStart = null;
      }
    }

    map.set(ticker, current);
  }

  return Array.from(map.entries())
    .filter(([, info]) => info.quantity > 1e-9 && !!info.activeWindowStart)
    .map(([ticker, info]) => ({
      ticker,
      quantity: info.quantity,
      activeWindowStart: info.activeWindowStart || toIsoDate(new Date().toISOString()),
    }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

function buildTickerOperations(transactions: Transaction[], ticker: string): TickerOperation[] {
  if (!ticker) return [];

  const normalizedTicker = normalizePerformanceTicker(ticker);
  const rows: TickerOperation[] = [];

  const sortedTransactions = [...transactions].sort((a, b) => {
    const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
    if (diff !== 0) return diff;
    const typePriority: Record<string, number> = {
      buy: 0,
      transfer_in: 1,
      sell: 2,
      transfer_out: 3,
    };
    return (typePriority[a.type] ?? 99) - (typePriority[b.type] ?? 99);
  });

  sortedTransactions.forEach((tx, idx) => {
    if (!tx.ticker) return;
    if (tx.type !== "buy" && tx.type !== "sell" && tx.type !== "transfer_in" && tx.type !== "transfer_out") return;
    if (normalizePerformanceTicker(tx.ticker) !== normalizedTicker) return;

    const quantity = Math.abs(tx.quantity ?? 0);
    if (quantity <= 0) return;

    rows.push({
      id: tx.id || `${tx.date}-${tx.type}-${idx}`,
      date: toIsoDate(tx.date),
      type: tx.type,
      quantity,
    });
  });

  return rows;
}

function ChartTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/50 bg-card/95 px-3 py-2 shadow-xl backdrop-blur">
      <p className="mb-1 text-[11px] text-muted-foreground">{fmtDate(String(label ?? ""))}</p>
      <div className="space-y-1">
        {payload.map((entry, idx) => {
          const value = entry.value;
          if (value == null || !Number.isFinite(value)) return null;
          return (
            <div key={`${entry.dataKey || idx}`} className="flex items-center justify-between gap-3 text-xs">
              <div className="min-w-0 flex items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: entry.color || "hsl(var(--muted-foreground))" }}
                />
                <span className="truncate text-muted-foreground">{entry.name || entry.dataKey}</span>
              </div>
              <span className="tabular-nums font-medium text-foreground">{fmtSignedPercent(Number(value))}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TitlesPerformanceTab({
  transactions,
  allTransactions,
  portfolios,
  historicalPrices,
  portfolioId,
  portfolioName,
  loading = false,
  benchmarkHistories = {},
  benchmarkTickers = [],
  benchSearch = "",
  onBenchSearchChange,
  onBenchmarkTickersChange,
  maxBenchmarks = 5,
}: Props) {
  const [selectedTicker, setSelectedTicker] = useState("");
  const [dateMode, setDateMode] = useState<"transactions" | "manual">("transactions");
  const [manualFromStr, setManualFromStr] = useState("");
  const [manualToStr, setManualToStr] = useState("");
  const [operationFromId, setOperationFromId] = useState("");
  const [operationToId, setOperationToId] = useState("today");
  const [benchOpen, setBenchOpen] = useState(false);
  const [activeBenchmarkTicker, setActiveBenchmarkTicker] = useState("");
  const [benchmarkPortfolioId, setBenchmarkPortfolioId] = useState("none");

  const todayIso = useMemo(() => new Date().toISOString().split("T")[0], []);

  const parseDateInput = useCallback((str: string): Date | undefined => {
    if (!str) return undefined;
    const trimmed = str.trim();

    const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      const d = new Date(Number(slashMatch[3]), Number(slashMatch[2]) - 1, Number(slashMatch[1]));
      return Number.isNaN(d.getTime()) ? undefined : d;
    }

    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const d = new Date(trimmed);
      return Number.isNaN(d.getTime()) ? undefined : d;
    }

    return undefined;
  }, []);

  const manualFrom = parseDateInput(manualFromStr);
  const manualTo = parseDateInput(manualToStr);

  const openTickerInfos = useMemo(() => buildOpenTickerInfos(transactions), [transactions]);

  useEffect(() => {
    if (!selectedTicker || !openTickerInfos.some((info) => info.ticker === selectedTicker)) {
      setSelectedTicker(openTickerInfos[0]?.ticker || "");
    }
  }, [openTickerInfos, selectedTicker]);

  const tickerOperations = useMemo(
    () => buildTickerOperations(transactions, selectedTicker),
    [transactions, selectedTicker]
  );

  useEffect(() => {
    if (tickerOperations.length === 0) {
      setOperationFromId("");
      setOperationToId("today");
      return;
    }

    if (!operationFromId || !tickerOperations.some((operation) => operation.id === operationFromId)) {
      setOperationFromId(tickerOperations[0].id);
    }

    if (operationToId !== "today" && !tickerOperations.some((operation) => operation.id === operationToId)) {
      setOperationToId("today");
    }
  }, [tickerOperations, operationFromId, operationToId]);

  useEffect(() => {
    if (tickerOperations.length === 0 || !operationFromId || operationToId === "today") return;

    const fromIndex = tickerOperations.findIndex((operation) => operation.id === operationFromId);
    const toIndex = tickerOperations.findIndex((operation) => operation.id === operationToId);

    if (fromIndex >= 0 && toIndex >= 0 && toIndex < fromIndex) {
      setOperationToId(operationFromId);
    }
  }, [tickerOperations, operationFromId, operationToId]);

  useEffect(() => {
    if (activeBenchmarkTicker && benchmarkTickers.includes(activeBenchmarkTicker)) return;
    setActiveBenchmarkTicker(benchmarkTickers[0] || "");
  }, [activeBenchmarkTicker, benchmarkTickers]);

  const benchmarkPortfolioOptions = useMemo(() => {
    const options: Array<{ id: string; name: string }> = [];

    if (portfolioId !== null) {
      options.push({ id: "global", name: "Vue globale" });
    }

    for (const portfolio of portfolios) {
      if (portfolio.id === portfolioId) continue;
      options.push({ id: portfolio.id, name: portfolio.name });
    }

    return options;
  }, [portfolios, portfolioId]);

  useEffect(() => {
    if (benchmarkPortfolioId === "none") return;
    if (!benchmarkPortfolioOptions.some((option) => option.id === benchmarkPortfolioId)) {
      setBenchmarkPortfolioId("none");
    }
  }, [benchmarkPortfolioId, benchmarkPortfolioOptions]);

  const benchmarkPortfolioTransactions = useMemo(() => {
    if (benchmarkPortfolioId === "none") return [];
    if (benchmarkPortfolioId === "global") return allTransactions;
    return allTransactions.filter((tx) => tx.portfolio_id === benchmarkPortfolioId);
  }, [benchmarkPortfolioId, allTransactions]);

  const benchmarkPortfolioName = useMemo(() => {
    if (benchmarkPortfolioId === "none") return "";
    if (benchmarkPortfolioId === "global") return "Vue globale";
    return portfolios.find((portfolio) => portfolio.id === benchmarkPortfolioId)?.name || "Benchmark portefeuille";
  }, [benchmarkPortfolioId, portfolios]);

  const selectedOperationFrom = useMemo(
    () => tickerOperations.find((operation) => operation.id === operationFromId) || null,
    [tickerOperations, operationFromId]
  );

  const selectedOperationTo = useMemo(
    () => tickerOperations.find((operation) => operation.id === operationToId) || null,
    [tickerOperations, operationToId]
  );

  const operationFromIndex = useMemo(
    () => tickerOperations.findIndex((operation) => operation.id === operationFromId),
    [tickerOperations, operationFromId]
  );

  const allowedToOperations = useMemo(
    () => (operationFromIndex >= 0 ? tickerOperations.slice(operationFromIndex) : tickerOperations),
    [tickerOperations, operationFromIndex]
  );

  const selectedTickerInfo = useMemo(
    () => openTickerInfos.find((info) => info.ticker === selectedTicker) || null,
    [openTickerInfos, selectedTicker]
  );

  const selectedRangeFrom =
    dateMode === "transactions"
      ? selectedOperationFrom?.date || selectedTickerInfo?.activeWindowStart
      : manualFrom?.toISOString().split("T")[0];

  const selectedRangeTo =
    dateMode === "transactions"
      ? operationToId === "today"
        ? todayIso
        : selectedOperationTo?.date || todayIso
      : manualTo?.toISOString().split("T")[0];

  const benchmarkColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    benchmarkTickers.forEach((ticker, idx) => {
      map[ticker] = BENCH_COLORS[idx % BENCH_COLORS.length];
    });
    return map;
  }, [benchmarkTickers]);

  const allAssetCurrencies = useMemo(() => {
    const map: Record<string, string> = {};

    for (const tx of allTransactions) {
      if (!tx.ticker || tx.ticker.includes("=X")) continue;
      if (tx.type !== "buy" && tx.type !== "sell" && tx.type !== "transfer_in" && tx.type !== "transfer_out") continue;
      const ticker = normalizePerformanceTicker(tx.ticker);
      map[ticker] = (tx.currency || "EUR").toUpperCase();
    }

    for (const [ticker, history] of Object.entries(historicalPrices)) {
      if (!map[ticker] && !ticker.includes("=X")) {
        map[ticker] = (history.currency || "EUR").toUpperCase();
      }
    }

    return map;
  }, [allTransactions, historicalPrices]);

  const selectedPortfolioTwr = useMemo(
    () =>
      computeTWR({
        transactions,
        historyMap: historicalPrices,
        assetCurrencies: allAssetCurrencies,
        portfolioId: portfolioId || "global",
        portfolioName,
        color: PORTFOLIO_COLOR,
      }),
    [transactions, historicalPrices, allAssetCurrencies, portfolioId, portfolioName]
  );

  const benchmarkPortfolioTwr = useMemo(() => {
    if (benchmarkPortfolioTransactions.length === 0) return null;

    return computeTWR({
      transactions: benchmarkPortfolioTransactions,
      historyMap: historicalPrices,
      assetCurrencies: allAssetCurrencies,
      portfolioId: benchmarkPortfolioId,
      portfolioName: benchmarkPortfolioName,
      color: PORTFOLIO_BENCH_COLOR,
    });
  }, [
    benchmarkPortfolioTransactions,
    historicalPrices,
    allAssetCurrencies,
    benchmarkPortfolioId,
    benchmarkPortfolioName,
  ]);

  const filterPointsForRange = useCallback((dataPoints: TWRDataPoint[], from?: string, to?: string): TWRDataPoint[] => {
    if (from) {
      return filterByRange(dataPoints, "CUSTOM", from, to);
    }
    return filterByRange(dataPoints, "1Y");
  }, []);

  const selectedPortfolioPoints = useMemo(
    () => filterPointsForRange(selectedPortfolioTwr.dataPoints, selectedRangeFrom, selectedRangeTo),
    [filterPointsForRange, selectedPortfolioTwr.dataPoints, selectedRangeFrom, selectedRangeTo]
  );

  const selectedPortfolioRebased = useMemo(() => rebaseTWR(selectedPortfolioPoints), [selectedPortfolioPoints]);

  const benchmarkPortfolioPoints = useMemo(() => {
    if (!benchmarkPortfolioTwr) return [];
    return filterPointsForRange(benchmarkPortfolioTwr.dataPoints, selectedRangeFrom, selectedRangeTo);
  }, [benchmarkPortfolioTwr, filterPointsForRange, selectedRangeFrom, selectedRangeTo]);

  const benchmarkPortfolioRebased = useMemo(() => rebaseTWR(benchmarkPortfolioPoints), [benchmarkPortfolioPoints]);

  const comparisonDates = useMemo(
    () => selectedPortfolioRebased.map((point) => point.date),
    [selectedPortfolioRebased]
  );

  const selectedTickerHistory = selectedTicker ? historicalPrices[selectedTicker]?.history || [] : [];

  const selectedTickerSeries = useMemo(() => {
    if (!selectedTickerHistory.length || comparisonDates.length === 0) return [];
    return rebaseBenchmark(selectedTickerHistory, comparisonDates);
  }, [selectedTickerHistory, comparisonDates]);

  const activeBenchmarkSeries = useMemo(() => {
    if (!activeBenchmarkTicker || comparisonDates.length === 0) return [];
    const history = benchmarkHistories[activeBenchmarkTicker] || [];
    if (history.length === 0) return [];
    return rebaseBenchmark(history, comparisonDates);
  }, [activeBenchmarkTicker, benchmarkHistories, comparisonDates]);

  const chartData = useMemo(() => {
    if (comparisonDates.length === 0) return [];

    const portfolioByDate = Object.fromEntries(
      selectedPortfolioRebased.map((point) => [point.date, point.twr * 100])
    );
    const tickerByDate = Object.fromEntries(selectedTickerSeries.map((point) => [point.date, point.benchPct]));
    const benchmarkByDate = Object.fromEntries(activeBenchmarkSeries.map((point) => [point.date, point.benchPct]));
    const benchmarkPortfolioByDate = Object.fromEntries(
      benchmarkPortfolioRebased.map((point) => [point.date, point.twr * 100])
    );

    return comparisonDates
      .map((date) => ({
        date,
        portfolioPct: typeof portfolioByDate[date] === "number" ? portfolioByDate[date] : null,
        tickerPct: typeof tickerByDate[date] === "number" ? tickerByDate[date] : null,
        benchmarkPct: typeof benchmarkByDate[date] === "number" ? benchmarkByDate[date] : null,
        benchmarkPortfolioPct:
          typeof benchmarkPortfolioByDate[date] === "number" ? benchmarkPortfolioByDate[date] : null,
      }))
      .filter(
        (point) =>
          point.portfolioPct !== null ||
          point.tickerPct !== null ||
          point.benchmarkPct !== null ||
          point.benchmarkPortfolioPct !== null
      );
  }, [
    comparisonDates,
    selectedPortfolioRebased,
    selectedTickerSeries,
    activeBenchmarkSeries,
    benchmarkPortfolioRebased,
  ]);

  const selectedTitleReturn =
    selectedTickerSeries.length > 0 ? selectedTickerSeries[selectedTickerSeries.length - 1].benchPct / 100 : null;
  const selectedPortfolioReturn =
    selectedPortfolioRebased.length > 0 ? selectedPortfolioRebased[selectedPortfolioRebased.length - 1].twr : null;
  const selectedBenchmarkReturn =
    activeBenchmarkSeries.length > 0 ? activeBenchmarkSeries[activeBenchmarkSeries.length - 1].benchPct / 100 : null;
  const selectedBenchmarkPortfolioReturn =
    benchmarkPortfolioRebased.length > 0
      ? benchmarkPortfolioRebased[benchmarkPortfolioRebased.length - 1].twr
      : null;

  const titleRows = useMemo<TitleRow[]>(() => {
    return openTickerInfos
      .map((info) => {
        const from =
          dateMode === "manual"
            ? manualFrom?.toISOString().split("T")[0] || undefined
            : info.ticker === selectedTicker
              ? selectedRangeFrom || info.activeWindowStart
              : info.activeWindowStart;

        const to =
          dateMode === "manual"
            ? manualTo?.toISOString().split("T")[0] || undefined
            : info.ticker === selectedTicker
              ? selectedRangeTo || todayIso
              : todayIso;

        const portfolioPoints = filterPointsForRange(selectedPortfolioTwr.dataPoints, from, to);
        const portfolioRebased = rebaseTWR(portfolioPoints);
        const rowDates = portfolioRebased.map((point) => point.date);

        const tickerHistory = historicalPrices[info.ticker]?.history || [];
        const tickerSeries =
          tickerHistory.length > 0 && rowDates.length > 0 ? rebaseBenchmark(tickerHistory, rowDates) : [];

        const benchmarkHistory = activeBenchmarkTicker ? benchmarkHistories[activeBenchmarkTicker] || [] : [];
        const benchmarkSeries =
          benchmarkHistory.length > 0 && rowDates.length > 0 ? rebaseBenchmark(benchmarkHistory, rowDates) : [];

        const benchmarkPortfolioSeries = benchmarkPortfolioTwr
          ? rebaseTWR(filterPointsForRange(benchmarkPortfolioTwr.dataPoints, from, to))
          : [];

        return {
          ticker: info.ticker,
          quantity: info.quantity,
          from: from || rowDates[0] || info.activeWindowStart,
          to: to || rowDates[rowDates.length - 1] || todayIso,
          titleReturn: tickerSeries.length > 0 ? tickerSeries[tickerSeries.length - 1].benchPct / 100 : null,
          portfolioReturn: portfolioRebased.length > 0 ? portfolioRebased[portfolioRebased.length - 1].twr : null,
          benchmarkReturn: benchmarkSeries.length > 0 ? benchmarkSeries[benchmarkSeries.length - 1].benchPct / 100 : null,
          benchmarkPortfolioReturn:
            benchmarkPortfolioSeries.length > 0
              ? benchmarkPortfolioSeries[benchmarkPortfolioSeries.length - 1].twr
              : null,
        };
      })
      .sort((a, b) => {
        const aPerf = a.titleReturn ?? -Infinity;
        const bPerf = b.titleReturn ?? -Infinity;
        return bPerf - aPerf;
      });
  }, [
    openTickerInfos,
    dateMode,
    manualFrom,
    manualTo,
    selectedTicker,
    selectedRangeFrom,
    selectedRangeTo,
    todayIso,
    filterPointsForRange,
    selectedPortfolioTwr.dataPoints,
    historicalPrices,
    activeBenchmarkTicker,
    benchmarkHistories,
    benchmarkPortfolioTwr,
  ]);

  const isShortRangeView = chartData.length <= 90;

  const xTickFormatter = (value: string) => {
    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime())) return value;

    if (isShortRangeView) {
      return parsedDate.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
    }

    return parsedDate.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
  };

  if (transactions.length === 0) {
    return (
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Performance Titres</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Aucune transaction dans ce portefeuille.</CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Performance Titres</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Chargement des historiques…</CardContent>
      </Card>
    );
  }

  if (openTickerInfos.length === 0) {
    return (
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Performance Titres</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Aucun titre actuellement en portefeuille à comparer.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-sm font-semibold">Vue Titres</CardTitle>
              <p className="text-xs text-muted-foreground">
                Compare chaque titre ouvert à {portfolioName}, à un portefeuille benchmark et à un benchmark Yahoo.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Select value={selectedTicker} onValueChange={setSelectedTicker}>
                <SelectTrigger className="h-8 w-[180px] text-xs">
                  <SelectValue placeholder="Sélectionner un titre" />
                </SelectTrigger>
                <SelectContent>
                  {openTickerInfos.map((info) => (
                    <SelectItem key={info.ticker} value={info.ticker}>
                      {info.ticker}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center gap-1 rounded-md border border-border/50 bg-muted/20 p-1">
                <Button
                  size="sm"
                  variant={dateMode === "transactions" ? "default" : "ghost"}
                  className="h-7 px-2 text-xs"
                  onClick={() => setDateMode("transactions")}
                >
                  Achat/vente
                </Button>
                <Button
                  size="sm"
                  variant={dateMode === "manual" ? "default" : "ghost"}
                  className="h-7 px-2 text-xs"
                  onClick={() => setDateMode("manual")}
                >
                  Date libre
                </Button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {dateMode === "manual" ? (
              <>
                <input
                  type="text"
                  placeholder="Du (jj/mm/aaaa)"
                  value={manualFromStr}
                  onChange={(e) => setManualFromStr(e.target.value)}
                  className={cn(
                    "h-8 w-[140px] rounded-md border bg-transparent px-2 text-xs tabular-nums placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary",
                    manualFrom ? "border-primary text-foreground" : "border-border/50 text-muted-foreground"
                  )}
                />
                <input
                  type="text"
                  placeholder="Au (jj/mm/aaaa)"
                  value={manualToStr}
                  onChange={(e) => setManualToStr(e.target.value)}
                  className={cn(
                    "h-8 w-[140px] rounded-md border bg-transparent px-2 text-xs tabular-nums placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary",
                    manualTo ? "border-primary text-foreground" : "border-border/50 text-muted-foreground"
                  )}
                />
                {(manualFromStr || manualToStr) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1 px-2 text-xs text-muted-foreground"
                    onClick={() => {
                      setManualFromStr("");
                      setManualToStr("");
                    }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </>
            ) : tickerOperations.length > 0 ? (
              <>
                <Select value={operationFromId} onValueChange={setOperationFromId}>
                  <SelectTrigger className="h-8 w-[240px] text-xs">
                    <SelectValue placeholder="Opération de départ" />
                  </SelectTrigger>
                  <SelectContent>
                    {tickerOperations.map((operation) => (
                      <SelectItem key={operation.id} value={operation.id}>
                        {formatOperationLabel(operation)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={operationToId} onValueChange={setOperationToId}>
                  <SelectTrigger className="h-8 w-[240px] text-xs">
                    <SelectValue placeholder="Opération de fin" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today">Aujourd'hui ({fmtDate(todayIso)})</SelectItem>
                    {allowedToOperations.map((operation) => (
                      <SelectItem key={operation.id} value={operation.id}>
                        {formatOperationLabel(operation)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            ) : (
              <div className="rounded-md border border-border/50 bg-muted/20 px-2 py-1.5 text-xs text-muted-foreground">
                Aucune opération achat/vente détectée pour ce titre.
              </div>
            )}

            <div className="mx-0.5 h-4 w-px bg-border/50" />

            <Select value={benchmarkPortfolioId} onValueChange={setBenchmarkPortfolioId}>
              <SelectTrigger className="h-8 w-[220px] text-xs">
                <SelectValue placeholder="Portefeuille benchmark" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sans portefeuille benchmark</SelectItem>
                {benchmarkPortfolioOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={activeBenchmarkTicker || "none"}
              onValueChange={(value) => setActiveBenchmarkTicker(value === "none" ? "" : value)}
            >
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue placeholder="Benchmark" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sans benchmark</SelectItem>
                {benchmarkTickers.map((ticker) => (
                  <SelectItem key={ticker} value={ticker}>
                    {ticker}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Popover open={benchOpen} onOpenChange={setBenchOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs text-muted-foreground">
                  <Search className="h-3 w-3" />
                  <span>Benchmarks</span>
                  {benchmarkTickers.length > 0 && (
                    <span className="ml-0.5 rounded-full bg-primary/20 px-1.5 text-[10px] font-semibold text-primary">
                      {benchmarkTickers.length}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-3" align="end">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">Benchmarks (max {maxBenchmarks})</p>
                    {benchmarkTickers.length > 0 && (
                      <button
                        onClick={() => {
                          onBenchmarkTickersChange?.([]);
                          onBenchSearchChange?.("");
                          setActiveBenchmarkTicker("");
                        }}
                        className="rounded-md px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
                      >
                        Tout effacer
                      </button>
                    )}
                  </div>
                  <TickerSearch
                    value={benchSearch}
                    onChange={(value) => onBenchSearchChange?.(value)}
                    onSelect={(result) => {
                      const ticker = result.symbol.toUpperCase();
                      const next =
                        benchmarkTickers.includes(ticker) || benchmarkTickers.length >= maxBenchmarks
                          ? benchmarkTickers
                          : [...benchmarkTickers, ticker];
                      onBenchmarkTickersChange?.(next);
                      if (!activeBenchmarkTicker && next.includes(ticker)) {
                        setActiveBenchmarkTicker(ticker);
                      }
                      onBenchSearchChange?.("");
                    }}
                  />
                  {benchmarkTickers.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {benchmarkTickers.map((ticker, idx) => (
                        <div
                          key={ticker}
                          className="flex items-center gap-1.5 rounded-md border border-border/50 bg-secondary/50 px-2 py-0.5 text-xs"
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: BENCH_COLORS[idx % BENCH_COLORS.length] }}
                          />
                          <span className="font-medium">{ticker}</span>
                          <button
                            onClick={() => {
                              const next = benchmarkTickers.filter((item) => item !== ticker);
                              onBenchmarkTickersChange?.(next);
                              if (activeBenchmarkTicker === ticker) {
                                setActiveBenchmarkTicker(next[0] || "");
                              }
                            }}
                            className="ml-0.5 rounded-sm p-0.5 hover:bg-accent"
                          >
                            <X className="h-3 w-3 text-muted-foreground" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">Ajoute un benchmark Yahoo pour comparer les titres.</p>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-2 grid-cols-2 xl:grid-cols-5">
        <div className="rounded-lg border border-border/50 bg-card/50 px-3 py-2.5">
          <p className="text-[11px] text-muted-foreground">Perf titre ({selectedTicker})</p>
          <p className={cn("text-base font-bold tabular-nums mt-0.5", valueColorClass(selectedTitleReturn))}>
            {fmtOptionalPercent(selectedTitleReturn)}
          </p>
        </div>

        <div className="rounded-lg border border-border/50 bg-card/50 px-3 py-2.5">
          <p className="text-[11px] text-muted-foreground">Perf portefeuille</p>
          <p className={cn("text-base font-bold tabular-nums mt-0.5", valueColorClass(selectedPortfolioReturn))}>
            {fmtOptionalPercent(selectedPortfolioReturn)}
          </p>
        </div>

        <div className="rounded-lg border border-border/50 bg-card/50 px-3 py-2.5">
          <p className="text-[11px] text-muted-foreground">Perf portefeuille benchmark</p>
          <p className={cn("text-base font-bold tabular-nums mt-0.5", valueColorClass(selectedBenchmarkPortfolioReturn))}>
            {benchmarkPortfolioId === "none" ? "—" : fmtOptionalPercent(selectedBenchmarkPortfolioReturn)}
          </p>
        </div>

        <div className="rounded-lg border border-border/50 bg-card/50 px-3 py-2.5">
          <p className="text-[11px] text-muted-foreground">Perf benchmark</p>
          <p className={cn("text-base font-bold tabular-nums mt-0.5", valueColorClass(selectedBenchmarkReturn))}>
            {activeBenchmarkTicker ? fmtOptionalPercent(selectedBenchmarkReturn) : "—"}
          </p>
        </div>

        <div className="rounded-lg border border-border/50 bg-card/50 px-3 py-2.5">
          <p className="text-[11px] text-muted-foreground">Écart titre vs portefeuille</p>
          <p
            className={cn(
              "text-base font-bold tabular-nums mt-0.5",
              valueColorClass(
                selectedTitleReturn !== null && selectedPortfolioReturn !== null
                  ? selectedTitleReturn - selectedPortfolioReturn
                  : null
              )
            )}
          >
            {selectedTitleReturn !== null && selectedPortfolioReturn !== null
              ? fmtSignedPercent((selectedTitleReturn - selectedPortfolioReturn) * 100)
              : "—"}
          </p>
        </div>
      </div>

      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Comparatif performance (%)
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: TITLE_COLOR }} />
                <span>{selectedTicker || "Titre"}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PORTFOLIO_COLOR }} />
                <span>{portfolioName}</span>
              </div>
              {benchmarkPortfolioId !== "none" && (
                <div className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PORTFOLIO_BENCH_COLOR }} />
                  <span>{benchmarkPortfolioName}</span>
                </div>
              )}
              {activeBenchmarkTicker && (
                <div className="flex items-center gap-1">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: benchmarkColorMap[activeBenchmarkTicker] || BENCH_COLORS[0] }}
                  />
                  <span>{activeBenchmarkTicker}</span>
                </div>
              )}
            </div>
          </div>
          {selectedRangeFrom && (
            <p className="text-[11px] text-muted-foreground">
              {fmtDate(selectedRangeFrom)} – {fmtDate(selectedRangeTo || todayIso)}
            </p>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          {chartData.length < 2 ? (
            <div className="rounded-lg border border-border/50 p-4 text-sm text-muted-foreground">
              Données insuffisantes pour tracer la comparaison sur cette période.
            </div>
          ) : (
            <div className="h-[380px] rounded-lg bg-gradient-to-b from-muted/20 to-transparent p-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.3} vertical={false} />
                  <XAxis
                    dataKey="date"
                    minTickGap={isShortRangeView ? 14 : 32}
                    tickFormatter={xTickFormatter}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(value) => `${value >= 0 ? "+" : ""}${Number(value).toFixed(1)}%`}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    width={64}
                  />
                  <RechartsTooltip content={<ChartTooltip />} />
                  <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.35} strokeDasharray="4 4" />

                  <Line
                    type="monotone"
                    dataKey="tickerPct"
                    name={selectedTicker || "Titre"}
                    stroke={TITLE_COLOR}
                    strokeWidth={2.1}
                    dot={false}
                    connectNulls
                  />

                  <Line
                    type="monotone"
                    dataKey="portfolioPct"
                    name={portfolioName}
                    stroke={PORTFOLIO_COLOR}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />

                  {benchmarkPortfolioId !== "none" && (
                    <Line
                      type="monotone"
                      dataKey="benchmarkPortfolioPct"
                      name={benchmarkPortfolioName}
                      stroke={PORTFOLIO_BENCH_COLOR}
                      strokeWidth={1.8}
                      strokeDasharray="7 4"
                      dot={false}
                      connectNulls
                    />
                  )}

                  {activeBenchmarkTicker && (
                    <Line
                      type="monotone"
                      dataKey="benchmarkPct"
                      name={activeBenchmarkTicker}
                      stroke={benchmarkColorMap[activeBenchmarkTicker] || BENCH_COLORS[0]}
                      strokeWidth={1.8}
                      strokeDasharray="5 4"
                      dot={false}
                      connectNulls
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Titres actuellement en portefeuille</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <div className="min-w-[1040px]">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/30 hover:bg-transparent">
                    <TableHead className="text-xs text-muted-foreground">Titre</TableHead>
                    <TableHead className="text-right text-xs text-muted-foreground">Qté</TableHead>
                    <TableHead className="text-xs text-muted-foreground">Période</TableHead>
                    <TableHead className="text-right text-xs text-muted-foreground">Perf titre</TableHead>
                    <TableHead className="text-right text-xs text-muted-foreground">Portefeuille</TableHead>
                    <TableHead className="text-right text-xs text-muted-foreground">Portefeuille bench</TableHead>
                    <TableHead className="text-right text-xs text-muted-foreground">Benchmark</TableHead>
                    <TableHead className="text-right text-xs text-muted-foreground">Écart vs Portefeuille</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {titleRows.map((row) => {
                    const spreadVsPortfolio =
                      row.titleReturn !== null && row.portfolioReturn !== null
                        ? row.titleReturn - row.portfolioReturn
                        : null;

                    return (
                      <TableRow
                        key={row.ticker}
                        onClick={() => setSelectedTicker(row.ticker)}
                        className={cn(
                          "cursor-pointer border-border/20 hover:bg-muted/30",
                          selectedTicker === row.ticker && "bg-muted/20"
                        )}
                      >
                        <TableCell className="py-2.5">
                          <div className="flex items-center gap-2.5">
                            <TickerLogo ticker={row.ticker} />
                            <span className="font-medium text-sm">{row.ticker}</span>
                          </div>
                        </TableCell>

                        <TableCell className="py-2.5 text-right text-sm tabular-nums">
                          {row.quantity % 1 === 0 ? row.quantity : row.quantity.toFixed(3)}
                        </TableCell>

                        <TableCell className="py-2.5 text-xs text-muted-foreground">
                          {fmtDate(row.from)} – {fmtDate(row.to)}
                        </TableCell>

                        <TableCell className={cn("py-2.5 text-right text-sm font-medium tabular-nums", valueColorClass(row.titleReturn))}>
                          {fmtOptionalPercent(row.titleReturn)}
                        </TableCell>

                        <TableCell className={cn("py-2.5 text-right text-sm font-medium tabular-nums", valueColorClass(row.portfolioReturn))}>
                          {fmtOptionalPercent(row.portfolioReturn)}
                        </TableCell>

                        <TableCell
                          className={cn(
                            "py-2.5 text-right text-sm font-medium tabular-nums",
                            valueColorClass(row.benchmarkPortfolioReturn)
                          )}
                        >
                          {benchmarkPortfolioId === "none" ? "—" : fmtOptionalPercent(row.benchmarkPortfolioReturn)}
                        </TableCell>

                        <TableCell className={cn("py-2.5 text-right text-sm font-medium tabular-nums", valueColorClass(row.benchmarkReturn))}>
                          {activeBenchmarkTicker ? fmtOptionalPercent(row.benchmarkReturn) : "—"}
                        </TableCell>

                        <TableCell
                          className={cn(
                            "py-2.5 text-right text-sm font-medium tabular-nums",
                            valueColorClass(spreadVsPortfolio)
                          )}
                        >
                          {spreadVsPortfolio !== null ? fmtSignedPercent(spreadVsPortfolio * 100) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
