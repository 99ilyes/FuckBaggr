import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tables, TablesInsert } from "@/integrations/supabase/types";
import { toast } from "@/hooks/use-toast";

export type WatchlistValuation = Tables<"watchlist_valuations">;

// ----- CRUD -----

export function useWatchlistValuations() {
    return useQuery({
        queryKey: ["watchlist_valuations"],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("watchlist_valuations")
                .select("*")
                .order("ticker");
            if (error) throw error;
            return data as WatchlistValuation[];
        },
    });
}

export function useUpsertValuation() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (val: TablesInsert<"watchlist_valuations">) => {
            const { error } = await supabase
                .from("watchlist_valuations")
                .upsert(val, { onConflict: "ticker" });
            if (error) throw error;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["watchlist_valuations"] });
            toast({ title: "Valorisation mise à jour" });
        },
        onError: (e: any) =>
            toast({ title: "Erreur", description: e.message, variant: "destructive" }),
    });
}

export function useDeleteValuation() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase
                .from("watchlist_valuations")
                .delete()
                .eq("id", id);
            if (error) throw error;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["watchlist_valuations"] });
            toast({ title: "Valorisation supprimée" });
        },
        onError: (e: any) =>
            toast({ title: "Erreur", description: e.message, variant: "destructive" }),
    });
}

// ----- Fundamentals fetching -----

export interface TickerFundamentals {
    trailingEps: number | null;
    forwardEps: number | null;
    trailingPE: number | null;
    forwardPE: number | null;
    currentPrice: number | null;
    currency: string;
    name: string;
    sector: string | null;
    industry: string | null;
}

export function useFundamentals(tickers: string[]) {
    return useQuery({
        queryKey: ["fundamentals", tickers.sort().join(",")],
        queryFn: async (): Promise<Record<string, TickerFundamentals>> => {
            if (tickers.length === 0) return {};

            const { data, error } = await supabase.functions.invoke("fetch-prices", {
                body: { tickers, mode: "fundamentals" },
            });

            if (error) {
                console.error("Fundamentals fetch error:", error);
                return {};
            }

            return (data?.results || {}) as Record<string, TickerFundamentals>;
        },
        enabled: tickers.length > 0,
        staleTime: 1000 * 60 * 60, // 1 hour
        retry: 1,
    });
}

// ----- Fair Price Calculation -----

export interface FairPriceResult {
    fairPrice: number;
    upside: number; // in percent
    futureEps: number;
    futureValue: number;
}

export function calculateFairPrice(
    currentEps: number,
    currentPrice: number,
    epsGrowth: number,
    terminalPe: number,
    minReturn: number,
    years: number
): FairPriceResult {
    const futureEps = currentEps * Math.pow(1 + epsGrowth, years);
    const futureValue = futureEps * terminalPe;
    const fairPrice = futureValue / Math.pow(1 + minReturn, years);
    const upside = currentPrice > 0 ? ((fairPrice / currentPrice - 1) * 100) : 0;

    return { fairPrice, upside, futureEps, futureValue };
}
