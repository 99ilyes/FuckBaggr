import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tables, TablesInsert } from "@/integrations/supabase/types";

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

export function useHistoricalPrices(tickers: string[], range = "5y", interval = "1wk") {
  return useQuery({
    queryKey: ["historical_prices", tickers.sort().join(","), range, interval],
    queryFn: async (): Promise<Record<string, AssetHistory>> => {
      if (tickers.length === 0) return {};

      const results: Record<string, AssetHistory> = {};

      // Fetch each ticker from Yahoo Finance directly via CORS proxy
      await Promise.all(
        tickers.map(async (ticker) => {
          try {
            const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;
            const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(yahooUrl)}`;

            const response = await fetch(proxyUrl);
            if (!response.ok) {
              console.warn(`Failed to fetch history for ${ticker}: ${response.status}`);
              return;
            }

            const data = await response.json();
            const chartResult = data.chart?.result?.[0];
            if (!chartResult) return;

            const meta = chartResult.meta;
            const timestamps: number[] = chartResult.timestamp || [];
            const closes: (number | null)[] = chartResult.indicators?.quote?.[0]?.close || [];

            const history: HistoricalPrice[] = [];
            for (let i = 0; i < timestamps.length; i++) {
              if (closes[i] != null) {
                history.push({ time: timestamps[i], price: closes[i]! });
              }
            }

            results[ticker] = {
              symbol: meta.symbol,
              currency: meta.currency || "USD",
              history,
            };
          } catch (err) {
            console.warn(`Error fetching history for ${ticker}:`, err);
          }
        })
      );

      return results;
    },
    enabled: tickers.length > 0,
    staleTime: 1000 * 60 * 60 * 24, // 24 hours
    retry: 2,
  });
}

