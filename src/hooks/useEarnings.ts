import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export interface Earning {
  id: string;
  ticker: string;
  quarter: string;
  revenue_growth: number | null;
  operating_margin: number | null;
  roe: number | null;
  debt_ebitda: number | null;
  moat: boolean;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type EarningInsert = Omit<Earning, "id" | "created_at" | "updated_at">;

export function useEarnings() {
  return useQuery({
    queryKey: ["earnings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("earnings")
        .select("*")
        .order("quarter", { ascending: false });
      if (error) throw error;
      return data as Earning[];
    },
  });
}

export function useAddEarning() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (earning: EarningInsert) => {
      const { error } = await supabase.from("earnings").insert(earning);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["earnings"] });
      toast({ title: "Résultat ajouté" });
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });
}

export function useUpdateEarning() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: Partial<Earning> & { id: string }) => {
      const { error } = await supabase.from("earnings").update(data).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["earnings"] });
      toast({ title: "Résultat mis à jour" });
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });
}

export function useDeleteEarning() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("earnings").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["earnings"] });
      toast({ title: "Résultat supprimé" });
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });
}

export function calculateValidatedCriteria(e: Earning): number {
  let count = 0;
  if (e.revenue_growth != null && e.revenue_growth > 10) count++;
  if (e.operating_margin != null && e.operating_margin > 20) count++;
  if (e.roe != null && e.roe > 30) count++;
  if (e.debt_ebitda != null && e.debt_ebitda < 1.5) count++;
  if (e.moat) count++;
  return count;
}
