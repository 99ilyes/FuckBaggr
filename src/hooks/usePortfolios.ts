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
      let query = supabase.from("transactions").select("*").order("date", { ascending: false });
      if (portfolioId) query = query.eq("portfolio_id", portfolioId);
      const { data, error } = await query;
      if (error) throw error;
      return data as Transaction[];
    },
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

export function useHistoricalPrices(tickers: string[], range = "5y", interval = "1wk") {
  return useQuery({
    queryKey: ["historical_prices", HISTORY_QUERY_VERSION, tickers.sort().join(","), range, interval],
    queryFn: async (): Promise<Record<string, AssetHistory>> => {
      if (tickers.length === 0) return {};

      const results: Record<string, AssetHistory> = {};

      // 1) Browser direct Yahoo history first (per-user IP, avoids shared edge limits/downsampling)
      try {
        const browserHistories = await fetchHistoricalPricesClientSide(tickers);
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

      // 2) Edge fallback for any missing tickers
      const missingTickers = tickers.filter((ticker) => !results[ticker]);
      if (missingTickers.length > 0) {
        const { data, error } = await supabase.functions.invoke("fetch-history", {
          body: { tickers: missingTickers, range, interval },
        });

        if (error) {
          console.error("Edge function error:", error);
          return results;
        }

        const raw = (data?.results || {}) as Record<
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

      return results;
    },
    enabled: tickers.length > 0,
    staleTime: 1000 * 60 * 60 * 24, // 24 hours
    retry: 1,
  });
}
