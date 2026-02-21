import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreatePortfolio } from "@/hooks/usePortfolios";
import { toast } from "@/hooks/use-toast";

const TYPES = ["PEA", "CTO", "Crypto", "Assurance Vie", "Autre"];
const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD"];
const BROKERS = [
  { value: "saxo", label: "Saxo Bank", color: "#3b82f6" },
  { value: "ibkr", label: "Interactive Brokers", color: "#ef4444" }
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreatePortfolioDialog({ open, onOpenChange }: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState("CTO");
  const [currency, setCurrency] = useState("EUR");
  const [broker, setBroker] = useState("saxo");
  const createPortfolio = useCreatePortfolio();

  const handleSubmit = () => {
    if (!name.trim()) return;

    const selectedBrokerInfo = BROKERS.find(b => b.value === broker);
    const color = selectedBrokerInfo?.color || "#3b82f6";

    createPortfolio.mutate(
      { name: name.trim(), type, color, currency, description: broker },
      {
        onSuccess: () => {
          toast({ title: "Portefeuille créé" });
          setName("");
          onOpenChange(false);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nouveau portefeuille</DialogTitle>
          <DialogDescription>Créez un portefeuille pour organiser vos investissements.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Nom</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mon PEA" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
          </div>
          <div>
            <Label>Courtier</Label>
            <Select value={broker} onValueChange={setBroker}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {BROKERS.map((b) => (
                  <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={handleSubmit} disabled={!name.trim()}>Créer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
