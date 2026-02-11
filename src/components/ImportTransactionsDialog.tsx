import { useState } from "react";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateBatchTransactions, Portfolio, Transaction } from "@/hooks/usePortfolios";
import { toast } from "@/hooks/use-toast";
import { parseCSV } from "@/lib/csvParser";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload } from "lucide-react";

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    portfolios: Portfolio[];
}

export function ImportTransactionsDialog({ open, onOpenChange, portfolios }: Props) {
    const [portfolioId, setPortfolioId] = useState<string>("");
    const [previewData, setPreviewData] = useState<any[]>([]);
    const [file, setFile] = useState<File | null>(null);
    const createBatchTransactions = useCreateBatchTransactions();

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (!selectedFile) return;
        setFile(selectedFile);

        const text = await selectedFile.text();
        try {
            // Parse without portfolio ID initially just to preview
            const parsed = parseCSV(text, "temp");
            setPreviewData(parsed);
        } catch (err: any) {
            toast({ title: "Erreur de lecture", description: err.message, variant: "destructive" });
            setPreviewData([]);
        }
    };

    const handleImport = () => {
        if (!portfolioId || previewData.length === 0) return;

        const transactionsToImport = previewData.map(t => ({
            ...t,
            portfolio_id: portfolioId
        }));

        createBatchTransactions.mutate(transactionsToImport, {
            onSuccess: () => {
                toast({ title: "Import réussi", description: `${transactionsToImport.length} transactions ajoutées.` });
                onOpenChange(false);
                setPreviewData([]);
                setFile(null);
                setPortfolioId("");
            },
            onError: (error) => {
                toast({ title: "Erreur d'import", description: error.message, variant: "destructive" });
            }
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Importer des transactions</DialogTitle>
                    <DialogDescription>Sélectionnez un fichier CSV (format PEA) et un portefeuille de destination.</DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Portefeuille</Label>
                            <Select value={portfolioId} onValueChange={setPortfolioId}>
                                <SelectTrigger><SelectValue placeholder="Choisir..." /></SelectTrigger>
                                <SelectContent>
                                    {portfolios.map((p) => (
                                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Fichier CSV</Label>
                            <div className="flex items-center gap-2">
                                <Button variant="outline" className="w-full relative" onClick={() => document.getElementById('file-upload')?.click()}>
                                    <Upload className="mr-2 h-4 w-4" />
                                    {file ? file.name : "Choisir un fichier"}
                                    <input
                                        id="file-upload"
                                        type="file"
                                        accept=".csv"
                                        className="hidden"
                                        onChange={handleFileChange}
                                    />
                                </Button>
                            </div>
                        </div>
                    </div>

                    {previewData.length > 0 && (
                        <div className="border rounded-md">
                            <div className="p-2 bg-muted/50 border-b text-sm font-medium">
                                Aperçu ({previewData.length} transactions)
                            </div>
                            <ScrollArea className="h-[300px]">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Date</TableHead>
                                            <TableHead>Type</TableHead>
                                            <TableHead>Ticker</TableHead>
                                            <TableHead className="text-right">Qté</TableHead>
                                            <TableHead className="text-right">Prix</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {previewData.slice(0, 50).map((tx, i) => (
                                            <TableRow key={i}>
                                                <TableCell className="text-xs">{tx.date}</TableCell>
                                                <TableCell className="text-xs">{tx.type}</TableCell>
                                                <TableCell className="text-xs">{tx.ticker || "-"}</TableCell>
                                                <TableCell className="text-xs text-right">{tx.quantity}</TableCell>
                                                <TableCell className="text-xs text-right">{tx.unit_price}</TableCell>
                                            </TableRow>
                                        ))}
                                        {previewData.length > 50 && (
                                            <TableRow>
                                                <TableCell colSpan={5} className="text-center text-muted-foreground">
                                                    ... et {previewData.length - 50} autres lignes
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </ScrollArea>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
                    <Button onClick={handleImport} disabled={!portfolioId || previewData.length === 0}>
                        Importer
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
