import { useState, useEffect } from "react";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUpdateTransaction, Transaction } from "@/hooks/usePortfolios";
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

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD"];

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    transaction: Transaction | null;
}

export function EditTransactionDialog({ open, onOpenChange, transaction }: Props) {
    const updateTransaction = useUpdateTransaction();

    const [type, setType] = useState("buy");
    const [ticker, setTicker] = useState("");
    const [quantity, setQuantity] = useState("");
    const [unitPrice, setUnitPrice] = useState("");
    const [fees, setFees] = useState("0");
    const [sourceAmount, setSourceAmount] = useState("");
    const [exchangeRate, setExchangeRate] = useState("");
    const [date, setDate] = useState("");
    const [currency, setCurrency] = useState("EUR");
    const [targetCurrency, setTargetCurrency] = useState("USD");

    useEffect(() => {
        if (transaction) {
            setType(transaction.type);
            setTicker(transaction.ticker || "");
            setQuantity(transaction.quantity?.toString() || "");
            setUnitPrice(transaction.unit_price?.toString() || "");
            setFees(transaction.fees.toString());
            setDate(transaction.date.split("T")[0]);

            const txCurrency = (transaction as any).currency || "EUR";
            if (transaction.type === "conversion") {
                setCurrency(transaction.ticker || "EUR");
                setTargetCurrency(txCurrency);
                // Calculate display values
                // Stored Quantity = Target Amount
                // Stored UnitPrice = Source / Target = 1/Rate
                // So Source = Quantity * UnitPrice
                // Rate = 1 / UnitPrice
                if (transaction.quantity && transaction.unit_price) {
                    setSourceAmount((transaction.quantity * transaction.unit_price).toString());
                    setExchangeRate((1 / transaction.unit_price).toString());
                }
            } else {
                setCurrency(txCurrency);
            }
        }
    }, [transaction]);

    const isCashTransaction = type === "deposit" || type === "withdrawal";
    const isConversion = type === "conversion";
    const isTradeTransaction = type === "buy" || type === "sell";

    const handleSubmit = () => {
        if (!transaction) return;

        let finalUnitPrice = unitPrice ? parseFloat(unitPrice) : null;
        let finalQuantity = quantity ? parseFloat(quantity) : null;

        if (isConversion) {
            const src = parseFloat(sourceAmount);
            const rate = parseFloat(exchangeRate);

            if (src && rate) {
                finalQuantity = src * rate;
                finalUnitPrice = src / finalQuantity; // = 1/rate
            }
        }

        const txData: any = {
            id: transaction.id,
            type,
            ticker: isConversion ? currency : isTradeTransaction ? ticker.toUpperCase() || null : null,
            quantity: finalQuantity,
            unit_price: finalUnitPrice,
            fees: parseFloat(fees) || 0,
            date: new Date(date).toISOString(),
            currency: isConversion ? targetCurrency : currency,
        };

        updateTransaction.mutate(txData, {
            onSuccess: () => {
                toast({ title: "Transaction modifiée" });
                onOpenChange(false);
            },
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Modifier la transaction</DialogTitle>
                    <DialogDescription>Modifiez les détails de l'opération.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
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

                    {!isConversion && (
                        <div>
                            <Label>Devise de règlement</Label>
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
                    <Button onClick={handleSubmit}>Enregistrer</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
