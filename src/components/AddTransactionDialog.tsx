import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateTransaction, Portfolio } from "@/hooks/usePortfolios";
import { toast } from "@/hooks/use-toast";

const TX_TYPES = [
  { value: "buy", label: "Achat" },
  { value: "sell", label: "Vente" },
  { value: "deposit", label: "Dépôt" },
  { value: "withdrawal", label: "Retrait" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  portfolios: Portfolio[];
  defaultPortfolioId?: string;
}

export function AddTransactionDialog({ open, onOpenChange, portfolios, defaultPortfolioId }: Props) {
  const [type, setType] = useState("buy");
  const [portfolioId, setPortfolioId] = useState(defaultPortfolioId || "");
  const [ticker, setTicker] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [fees, setFees] = useState("0");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const createTransaction = useCreateTransaction();

  const isCashTransaction = type === "deposit" || type === "withdrawal";

  const handleSubmit = () => {
    if (!portfolioId) return;
    createTransaction.mutate(
      {
        portfolio_id: portfolioId,
        type,
        ticker: isCashTransaction ? null : ticker.toUpperCase() || null,
        quantity: quantity ? parseFloat(quantity) : null,
        unit_price: unitPrice ? parseFloat(unitPrice) : null,
        fees: parseFloat(fees) || 0,
        date: new Date(date).toISOString(),
      },
      {
        onSuccess: () => {
          toast({ title: "Transaction ajoutée" });
          resetForm();
          onOpenChange(false);
        },
      }
    );
  };

  const resetForm = () => {
    setType("buy");
    setTicker("");
    setQuantity("");
    setUnitPrice("");
    setFees("0");
    setDate(new Date().toISOString().split("T")[0]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nouvelle transaction</DialogTitle>
          <DialogDescription>Ajoutez une opération à votre portefeuille.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Portefeuille</Label>
            <Select value={portfolioId} onValueChange={setPortfolioId}>
              <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
              <SelectContent>
                {portfolios.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TX_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!isCashTransaction && (
            <div>
              <Label>Ticker</Label>
              <Input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="AAPL" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{isCashTransaction ? "Montant" : "Quantité"}</Label>
              <Input type="number" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            {!isCashTransaction && (
              <div>
                <Label>Prix unitaire (€)</Label>
                <Input type="number" step="any" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Frais (€)</Label>
              <Input type="number" step="any" value={fees} onChange={(e) => setFees(e.target.value)} />
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={handleSubmit} disabled={!portfolioId}>Ajouter</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
