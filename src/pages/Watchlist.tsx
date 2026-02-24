import { useMemo } from "react";
import { useTransactions } from "@/hooks/usePortfolios";
import { useQuery } from "@tanstack/react-query";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { TickerLogo } from "@/components/TickerLogo";
import { Eye } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

interface TickerQuote {
  price: number | null;
  previousClose: number | null;
  name: string;
  currency: string;
  trailingPE: number | null;
  changePercent: number | null;
}

const YAHOO_TIMEOUT = 6000;

/** Fetch quote + PE for a single ticker directly from Yahoo v8 */
async function fetchQuoteWithPE(ticker: string): Promise<TickerQuote | null> {
  try {
    const baseUrl = import.meta.env.DEV
      ? "/api/yf"
      : "https://query2.finance.yahoo.com";
    const url = `${baseUrl}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d&includePrePost=false`;

    const resp = await fetch(url, {
      signal: AbortSignal.timeout(YAHOO_TIMEOUT),
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) return null;

    const data = await resp.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;

    const price = meta.regularMarketPrice ?? null;
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
    const change = price != null && prevClose != null && prevClose !== 0
      ? ((price - prevClose) / prevClose) * 100
      : null;

    return {
      price,
      previousClose: prevClose,
      name: meta.longName ?? meta.shortName ?? meta.symbol ?? ticker,
      currency: meta.currency ?? "USD",
      trailingPE: null, // v8 chart doesn't include PE — we'll fetch from v10
      changePercent: change,
    };
  } catch {
    return null;
  }
}

/** Fetch PE ratio via Yahoo v10 quoteSummary (defaultKeyStatistics) */
async function fetchPE(ticker: string): Promise<number | null> {
  try {
    const baseUrl = import.meta.env.DEV
      ? "/api/yf"
      : "https://query2.finance.yahoo.com";
    const url = `${baseUrl}/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=summaryDetail`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(YAHOO_TIMEOUT),
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const pe = json?.quoteSummary?.result?.[0]?.summaryDetail?.trailingPE?.raw;
    return typeof pe === "number" ? pe : null;
  } catch {
    return null;
  }
}

async function fetchAllQuotes(tickers: string[]): Promise<Record<string, TickerQuote>> {
  const results: Record<string, TickerQuote> = {};
  await Promise.all(
    tickers.map(async (ticker) => {
      const [quote, pe] = await Promise.all([fetchQuoteWithPE(ticker), fetchPE(ticker)]);
      if (quote) {
        results[ticker] = { ...quote, trailingPE: pe };
      }
    })
  );
  return results;
}

function formatCurrency(value: number | null, currency = "EUR"): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export default function Watchlist() {
  const { data: allTransactions = [], isLoading: txLoading } = useTransactions();

  // Compute unique tickers with positive holdings
  const holdingTickers = useMemo(() => {
    const qty = new Map<string, number>();
    for (const tx of allTransactions) {
      if (!tx.ticker || !tx.quantity) continue;
      if (tx.type === "buy" || tx.type === "transfer_in") {
        qty.set(tx.ticker, (qty.get(tx.ticker) || 0) + tx.quantity);
      } else if (tx.type === "sell" || tx.type === "transfer_out") {
        qty.set(tx.ticker, (qty.get(tx.ticker) || 0) - tx.quantity);
      }
    }
    return [...qty.entries()]
      .filter(([, q]) => q > 0.0001)
      .map(([t]) => t)
      .sort();
  }, [allTransactions]);

  const { data: quotes = {}, isLoading: quotesLoading } = useQuery({
    queryKey: ["watchlist-quotes", holdingTickers.join(",")],
    queryFn: () => fetchAllQuotes(holdingTickers),
    enabled: holdingTickers.length > 0,
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });

  const loading = txLoading || quotesLoading;

  return (
    <div className="flex flex-col min-h-screen w-full">
      {/* Header */}
      <header className="flex items-center gap-3 border-b px-4 py-3 md:px-6">
        <SidebarTrigger />
        <Eye className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold tracking-tight">Watchlist</h1>
        <span className="text-sm text-muted-foreground ml-auto">
          {holdingTickers.length} titre{holdingTickers.length > 1 ? "s" : ""}
        </span>
      </header>

      {/* Table */}
      <main className="flex-1 overflow-auto p-4 md:p-6">
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[240px]">Titre</TableHead>
                <TableHead className="text-right">Cours</TableHead>
                <TableHead className="text-right">Variation</TableHead>
                <TableHead className="text-right">PER</TableHead>
                <TableHead className="text-right">Devise</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && holdingTickers.length === 0 ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-14 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-10 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : holdingTickers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-12">
                    Aucun titre en portefeuille
                  </TableCell>
                </TableRow>
              ) : (
                holdingTickers.map((ticker) => {
                  const q = quotes[ticker];
                  const changeColor =
                    q?.changePercent != null
                      ? q.changePercent > 0
                        ? "text-emerald-500"
                        : q.changePercent < 0
                        ? "text-red-500"
                        : "text-muted-foreground"
                      : "text-muted-foreground";

                  return (
                    <TableRow key={ticker}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <TickerLogo ticker={ticker} className="h-6 w-6" />
                          <div className="flex flex-col">
                            <span className="font-medium text-sm">{ticker}</span>
                            {q?.name && (
                              <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                                {q.name}
                              </span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {quotesLoading && !q ? (
                          <Skeleton className="h-4 w-16 ml-auto" />
                        ) : (
                          formatCurrency(q?.price ?? null, q?.currency ?? "EUR")
                        )}
                      </TableCell>
                      <TableCell className={`text-right font-mono tabular-nums ${changeColor}`}>
                        {quotesLoading && !q ? (
                          <Skeleton className="h-4 w-12 ml-auto" />
                        ) : q?.changePercent != null ? (
                          `${q.changePercent > 0 ? "+" : ""}${q.changePercent.toFixed(2)}%`
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {quotesLoading && !q ? (
                          <Skeleton className="h-4 w-12 ml-auto" />
                        ) : q?.trailingPE != null ? (
                          q.trailingPE.toFixed(1)
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {q?.currency ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </main>
    </div>
  );
}
