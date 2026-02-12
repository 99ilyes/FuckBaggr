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
import { TickerSearch } from "@/components/TickerSearch";
import { supabase } from "@/integrations/supabase/client";

const TX_TYPES = [
  { value: "buy", label: "Achat" },
  { value: "sell", label: "Vente" },
  { value: "deposit", label: "Dépôt" },
  { value: "withdrawal", label: "Retrait" },
  { value: "conversion", label: "Conversion" },
];

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD", "DKK"];

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

  const [sourceAmount, setSourceAmount] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");

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

    let finalUnitPrice = unitPrice ? parseFloat(unitPrice) : null;
    let finalQuantity = quantity ? parseFloat(quantity) : null;

    if (isConversion) {
      const src = parseFloat(sourceAmount);
      const rate = parseFloat(exchangeRate);
      if (src && rate) {
        // Source = 1000 EUR. Rate = 1.10 (EUR->USD).
        // Target (Quantity) = 1000 * 1.10 = 1100 USD.
        finalQuantity = src * rate;

        // DB Schema: Source = Quantity * UnitPrice + Fees
        // We want Source to be strictly equal to what user input (plus fees? usually fees are separate or included? 
        // In this app, logic is: balances[source] -= (quantity * unit_price + fees)
        // So quantity * unit_price must equal Source Amount.
        // 1100 * UnitPrice = 1000 => UnitPrice = 1000 / 1100 = 1/Rate.
        finalUnitPrice = src / finalQuantity;
      }
    }

    const txData: any = {
      portfolio_id: portfolioId,
      type,
      ticker: isConversion ? currency : isTradeTransaction ? ticker.toUpperCase() || null : null,
      quantity: finalQuantity,
      unit_price: finalUnitPrice,
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
    setSourceAmount("");
    setExchangeRate("");
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
              <TickerSearch
                value={ticker}
                onChange={setTicker}
                onSelect={(result) => {
                  setTicker(result.symbol);
                  supabase.functions.invoke("fetch-prices", {
                    body: { tickers: [result.symbol] },
                  }).then(({ data }) => {
                    const info = data?.results?.[result.symbol];
                    if (info?.currency) {
                      setCurrency(info.currency);
                    }
                  });
                }}
              />
            </div>
          )}

          {isConversion && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>De (Source)</Label>
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
                <Label>Vers (Cible)</Label>
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
            {!isConversion && (
              <div>
                <Label>{isCashTransaction ? "Montant" : "Quantité"}</Label>
                <Input type="number" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </div>
            )}

            {isTradeTransaction && (
              <div>
                <Label>Prix unitaire</Label>
                <Input type="number" step="any" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
              </div>
            )}

            {isConversion && (
              <>
                <div>
                  <Label>Montant Changé (Source)</Label>
                  <Input type="number" step="any" value={sourceAmount} onChange={(e) => setSourceAmount(e.target.value)} />
                </div>
                <div>
                  <Label>Taux de change</Label>
                  <Input type="number" step="any" placeholder={`1 ${currency} = ? ${targetCurrency}`} value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} />
                </div>
              </>
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

          {isConversion && sourceAmount && exchangeRate && (
            <div className="text-sm text-muted-foreground bg-muted p-2 rounded-md">
              Résultat estimé : <strong>{(parseFloat(sourceAmount) * parseFloat(exchangeRate)).toFixed(2)} {targetCurrency}</strong>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={handleSubmit} disabled={!portfolioId}>Ajouter</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
