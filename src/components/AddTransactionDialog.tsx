import { useState, useEffect } from "react";
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
  { value: "conversion", label: "Conversion" },
];

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD"];

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
  const [currency, setCurrency] = useState("EUR");
  const [targetCurrency, setTargetCurrency] = useState("USD");
  const createTransaction = useCreateTransaction();

  const isCashTransaction = type === "deposit" || type === "withdrawal";
  const isConversion = type === "conversion";
  const isTradeTransaction = type === "buy" || type === "sell";

  // Set currency from selected portfolio
  useEffect(() => {
    if (portfolioId) {
      const portfolio = portfolios.find((p) => p.id === portfolioId);
      if (portfolio) {
        setCurrency((portfolio as any).currency || "EUR");
      }
    }
  }, [portfolioId, portfolios]);

  const handleSubmit = () => {
    if (!portfolioId) return;

    const txData: any = {
      portfolio_id: portfolioId,
      type,
      ticker: isConversion ? currency : isTradeTransaction ? ticker.toUpperCase() || null : null,
      quantity: quantity ? parseFloat(quantity) : null,
      unit_price: unitPrice ? parseFloat(unitPrice) : null,
      fees: parseFloat(fees) || 0,
      date: new Date(date).toISOString(),
      currency: isConversion ? targetCurrency : currency,
    };

    createTransaction.mutate(txData, {
      onSuccess: () => {
        toast({ title: "Transaction ajoutée" });
        resetForm();
        onOpenChange(false);
      },
    });
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
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({(p as any).currency || "EUR"})
                  </SelectItem>
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

          {isTradeTransaction && (
            <div>
              <Label>Ticker</Label>
              <Input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="AAPL" />
            </div>
          )}

          {isConversion && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>De</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Vers</Label>
                <Select value={targetCurrency} onValueChange={setTargetCurrency}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.filter((c) => c !== currency).map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {isCashTransaction && (
            <div>
              <Label>Devise</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{isConversion ? "Montant reçu" : isCashTransaction ? "Montant" : "Quantité"}</Label>
              <Input type="number" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            {(isTradeTransaction || isConversion) && (
              <div>
                <Label>{isConversion ? "Taux de change" : "Prix unitaire"}</Label>
                <Input type="number" step="any" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Frais</Label>
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
