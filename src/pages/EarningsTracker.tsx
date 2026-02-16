import { useState, useMemo } from "react";
import { useEarnings, useAddEarning, useUpdateEarning, useDeleteEarning, Earning, EarningInsert } from "@/hooks/useEarnings";
import { useTransactions } from "@/hooks/usePortfolios";
import { EarningsTable } from "@/components/EarningsTable";
import { AddEarningsDialog } from "@/components/AddEarningsDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";

export default function EarningsTracker() {
  const { data: earnings = [] } = useEarnings();
  const { data: transactions = [] } = useTransactions();
  const addEarning = useAddEarning();
  const updateEarning = useUpdateEarning();
  const deleteEarning = useDeleteEarning();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editData, setEditData] = useState<Earning | null>(null);
  const [filterTicker, setFilterTicker] = useState<string>("all");

  const availableTickers = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach((t) => { if (t.ticker) set.add(t.ticker); });
    earnings.forEach((e) => set.add(e.ticker));
    return Array.from(set).sort();
  }, [transactions, earnings]);

  const filtered = useMemo(() => {
    if (filterTicker === "all") return earnings;
    return earnings.filter((e) => e.ticker === filterTicker);
  }, [earnings, filterTicker]);

  const handleSubmit = (data: EarningInsert) => {
    if (editData) {
      updateEarning.mutate({ id: editData.id, ...data });
    } else {
      addEarning.mutate(data);
    }
    setEditData(null);
  };

  const handleEdit = (e: Earning) => {
    setEditData(e);
    setDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    deleteEarning.mutate(id);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 md:px-6 space-y-6">
      <Card className="border-border/50">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-lg font-semibold">Earnings Tracker</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={filterTicker} onValueChange={setFilterTicker}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue placeholder="Filtrer..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                {availableTickers.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => { setEditData(null); setDialogOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" />
              Ajouter
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <EarningsTable earnings={filtered} onEdit={handleEdit} onDelete={handleDelete} />
        </CardContent>
      </Card>

      <AddEarningsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        tickers={availableTickers}
        editData={editData}
      />
    </div>
  );
}
