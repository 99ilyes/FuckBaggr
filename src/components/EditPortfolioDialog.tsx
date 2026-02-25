import { useEffect, useState } from "react";
import { useUpdatePortfolio, Portfolio } from "@/hooks/usePortfolios";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

const BROKERS = [
    { value: "saxo", label: "Saxo Bank", color: "#3b82f6" },
    { value: "ibkr", label: "Interactive Brokers", color: "#ef4444" }
];

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    portfolio: Portfolio | null;
}

export function EditPortfolioDialog({ open, onOpenChange, portfolio }: Props) {
    const [name, setName] = useState("");
    const [broker, setBroker] = useState("saxo");
    const updatePortfolio = useUpdatePortfolio();

    useEffect(() => {
        if (portfolio) {
            setName(portfolio.name);
            setBroker(
                portfolio.description === "ibkr" || portfolio.description === "saxo"
                    ? portfolio.description
                    : "saxo"
            );
        }
    }, [portfolio]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !portfolio) return;

        updatePortfolio.mutate(
            { id: portfolio.id, name: name.trim(), description: broker, color: portfolio.color },
            {
                onSuccess: () => {
                    toast({ title: "Portefeuille mis à jour" });
                    onOpenChange(false);
                },
                onError: (error) => {
                    toast({
                        title: "Erreur",
                        description: error.message,
                        variant: "destructive",
                    });
                },
            }
        );
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Modifier le portefeuille</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="name" className="text-right">
                            Nom
                        </Label>
                        <Input
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="col-span-3"
                            autoFocus
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Courtier</Label>
                        <div className="col-span-3">
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
                        <Button type="submit" disabled={!name.trim() || updatePortfolio.isPending}>
                            {updatePortfolio.isPending ? "Modification..." : "Enregistrer"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
