import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tables, TablesInsert } from "@/integrations/supabase/types";
import { fetchHistoricalPricesClientSide } from "@/lib/yahooFinance";

export type Portfolio = Tables<"portfolios">;
export type Transaction = Tables<"transactions">;
export type AssetCache = Tables<"assets_cache">;

export function usePortfolios() {
  return useQuery({
    queryKey: ["portfolios"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("portfolios")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Portfolio[];
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useCreatePortfolio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (portfolio: TablesInsert<"portfolios">) => {
      const { data, error } = await supabase.from("portfolios").insert(portfolio).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portfolios"] }),
  });
}

export function useUpdatePortfolio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<TablesInsert<"portfolios">>) => {
      const { data, error } = await supabase.from("portfolios").update(updates).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portfolios"] }),
  });
}

export function useDeletePortfolio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("portfolios").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolios"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

export function useTransactions(portfolioId?: string) {
  return useQuery({
    queryKey: ["transactions", portfolioId],
    queryFn: async () => {
      // Supabase rows can be capped by API limits (commonly 1000 rows).
      // Fetch all pages so portfolio totals are consistent everywhere.
      const pageSize = 1000;
      let from = 0;
      const allRows: Transaction[] = [];

      while (true) {
        let query = supabase
          .from("transactions")
          .select("*")
          .order("date", { ascending: false })
          .range(from, from + pageSize - 1);

        if (portfolioId) query = query.eq("portfolio_id", portfolioId);

        const { data, error } = await query;
        if (error) throw error;

        const page = (data || []) as Transaction[];
        allRows.push(...page);

        if (page.length < pageSize) break;
        from += pageSize;
      }

      return allRows;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useCreateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tx: TablesInsert<"transactions">) => {
      const { data, error } = await supabase.from("transactions").insert(tx).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["portfolios"] });
    },
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("transactions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["portfolios"] });
    },
  });
}

export function useDeleteTransactionsByPortfolio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (portfolioId: string) => {
      const { error } = await supabase.from("transactions").delete().eq("portfolio_id", portfolioId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["portfolios"] });
    },
  });
}

export function useUpdateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<TablesInsert<"transactions">>) => {
      const { data, error } = await supabase.from("transactions").update(updates).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["portfolios"] });
    },
  });
}

export function useAssetsCache() {
  return useQuery({
    queryKey: ["assets_cache"],
    queryFn: async () => {
      const { data, error } = await supabase.from("assets_cache").select("*");
      if (error) throw error;
      return data as AssetCache[];
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
export function useCreateBatchTransactions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (transactions: TablesInsert<"transactions">[]) => {
      const { data, error } = await supabase.from("transactions").insert(transactions).select();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["portfolios"] });
    },
  });
}

export interface HistoricalPrice {
  time: number;
  price: number;
}

export interface AssetHistory {
  symbol: string;
  currency: string;
  history: HistoricalPrice[];
}

const HISTORY_QUERY_VERSION = "v2-daily-history";
const HISTORY_QUERY_VERSION_SAFE_PROD = "v3-safe-prod";

export function useHistoricalPrices(tickers: string[], range = "5y", interval = "1wk") {
  const isProd = import.meta.env.PROD;
  const sortedTickers = useMemo(() => [...tickers].sort(), [tickers]);
  // Some Yahoo combinations can be downsampled by the upstream API.
  // For edge fallback, prefer a stable daily range in production.
  const safeRangeForEdge = interval === "1d" && range === "max" ? "5y" : range;

  return useQuery({
    queryKey: [
      "historical_prices",
      HISTORY_QUERY_VERSION,
      HISTORY_QUERY_VERSION_SAFE_PROD,
      sortedTickers.join(","),
      range,
      safeRangeForEdge,
      interval,
      isProd ? "prod" : "dev",
    ],
    queryFn: async (): Promise<Record<string, AssetHistory>> => {
      if (sortedTickers.length === 0) return {};

      const results: Record<string, AssetHistory> = {};

      // In production, use a single deterministic source (edge function) to
      // avoid browser-specific Yahoo behavior (CORS / rate-limit / region).
      if (!isProd) {
        // 1) Browser direct Yahoo history first (per-user IP)
        try {
          const browserHistories = await fetchHistoricalPricesClientSide(sortedTickers);
          for (const [ticker, info] of Object.entries(browserHistories)) {
            const history = info.timestamps.map((time, idx) => ({
              time,
              price: info.closes[idx],
            }));
            if (history.length === 0) continue;
            results[ticker] = {
              symbol: info.symbol || ticker,
              currency: info.currency || "USD",
              history,
            };
          }
        } catch (error) {
          console.warn("Browser history fetch failed, falling back to edge function:", error);
        }
      }

      // 2) Edge fallback for any missing tickers — batched to avoid timeouts
      const missingTickers = isProd
        ? sortedTickers
        : sortedTickers.filter((ticker) => !results[ticker]);
      if (missingTickers.length > 0) {
        const EDGE_BATCH = 10; // keep each edge call small enough to finish within timeout
        const batches: string[][] = [];
        for (let i = 0; i < missingTickers.length; i += EDGE_BATCH) {
          batches.push(missingTickers.slice(i, i + EDGE_BATCH));
        }
        // Run up to 3 batches in parallel to speed things up
        const PARALLEL = 3;
        for (let b = 0; b < batches.length; b += PARALLEL) {
          const chunk = batches.slice(b, b + PARALLEL);
          const responses = await Promise.allSettled(
            chunk.map((batch) =>
              supabase.functions.invoke("fetch-history", {
                body: { tickers: batch, range: safeRangeForEdge, interval },
              })
            )
          );
          for (const res of responses) {
            if (res.status !== "fulfilled" || res.value.error) continue;
            const raw = (res.value.data?.results || {}) as Record<
              string,
              { error?: string; history?: HistoricalPrice[]; symbol?: string; currency?: string }
            >;
            for (const [ticker, info] of Object.entries(raw)) {
              if (info.error || !Array.isArray(info.history) || results[ticker]) continue;
              results[ticker] = {
                symbol: info.symbol || ticker,
                currency: info.currency || "USD",
                history: info.history,
              };
            }
          }
        }
      }

      return results;
    },
    enabled: sortedTickers.length > 0,
    staleTime: 1000 * 60 * 60 * 24, // 24 hours
    retry: 1,
  });
}
