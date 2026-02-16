import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Earning, EarningInsert } from "@/hooks/useEarnings";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: EarningInsert) => void;
  tickers: string[];
  editData?: Earning | null;
}

const currentYear = new Date().getFullYear();
const quarters = Array.from({ length: 12 }, (_, i) => {
  const y = currentYear - Math.floor(i / 4);
  const q = 4 - (i % 4);
  return `Q${q} ${y}`;
});

export function AddEarningsDialog({ open, onOpenChange, onSubmit, tickers, editData }: Props) {
  const [ticker, setTicker] = useState("");
  const [quarter, setQuarter] = useState(quarters[0]);
  const [revenueGrowth, setRevenueGrowth] = useState("");
  const [operatingMargin, setOperatingMargin] = useState("");
  const [roe, setRoe] = useState("");
  const [debtEbitda, setDebtEbitda] = useState("");
  const [moat, setMoat] = useState(false);
  const [status, setStatus] = useState("hold");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (editData) {
      setTicker(editData.ticker);
      setQuarter(editData.quarter);
      setRevenueGrowth(editData.revenue_growth?.toString() ?? "");
      setOperatingMargin(editData.operating_margin?.toString() ?? "");
      setRoe(editData.roe?.toString() ?? "");
      setDebtEbitda(editData.debt_ebitda?.toString() ?? "");
      setMoat(editData.moat);
      setStatus(editData.status);
      setNotes(editData.notes ?? "");
    } else {
      setTicker("");
      setQuarter(quarters[0]);
      setRevenueGrowth("");
      setOperatingMargin("");
      setRoe("");
      setDebtEbitda("");
      setMoat(false);
      setStatus("hold");
      setNotes("");
    }
  }, [editData, open]);

  const handleSubmit = () => {
    if (!ticker) return;
    onSubmit({
      ticker,
      quarter,
      revenue_growth: revenueGrowth ? parseFloat(revenueGrowth) : null,
      operating_margin: operatingMargin ? parseFloat(operatingMargin) : null,
      roe: roe ? parseFloat(roe) : null,
      debt_ebitda: debtEbitda ? parseFloat(debtEbitda) : null,
      moat,
      status,
      notes: notes || null,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editData ? "Modifier" : "Ajouter"} un résultat</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>Ticker</Label>
            <Select value={ticker} onValueChange={setTicker}>
              <SelectTrigger><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
              <SelectContent>
                {tickers.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Trimestre</Label>
            <Select value={quarter} onValueChange={setQuarter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {quarters.map((q) => (
                  <SelectItem key={q} value={q}>{q}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label className="text-xs">Croissance CA (%)</Label>
              <Input type="number" step="0.1" value={revenueGrowth} onChange={(e) => setRevenueGrowth(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Marge OP (%)</Label>
              <Input type="number" step="0.1" value={operatingMargin} onChange={(e) => setOperatingMargin(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">ROE (%)</Label>
              <Input type="number" step="0.1" value={roe} onChange={(e) => setRoe(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Dette/EBITDA</Label>
              <Input type="number" step="0.01" value={debtEbitda} onChange={(e) => setDebtEbitda(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Label>Moat</Label>
            <Switch checked={moat} onCheckedChange={setMoat} />
          </div>
          <div className="grid gap-2">
            <Label>Statut</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hold">Hold</SelectItem>
                <SelectItem value="alleger">Alléger</SelectItem>
                <SelectItem value="sell">Sell</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optionnel..." />
          </div>
          <Button onClick={handleSubmit} disabled={!ticker}>
            {editData ? "Mettre à jour" : "Ajouter"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
