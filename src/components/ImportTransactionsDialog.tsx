import { useState } from "react";
import * as XLSX from "xlsx";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateBatchTransactions, Portfolio, Transaction } from "@/hooks/usePortfolios";
import { toast } from "@/hooks/use-toast";
import { parseCSV } from "@/lib/csvParser";
import { parseSaxoXLSX, ParsedTransaction } from "@/lib/xlsxParser";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    portfolios: Portfolio[];
}

const TYPE_LABELS: Record<string, { label: string; className: string }> = {
    buy: { label: "Achat", className: "text-emerald-600 dark:text-emerald-400 font-medium" },
    sell: { label: "Vente", className: "text-rose-600 dark:text-rose-400 font-medium" },
    deposit: { label: "Dépôt", className: "text-sky-600 dark:text-sky-400 font-medium" },
    withdrawal: { label: "Retrait", className: "text-amber-600 dark:text-amber-400 font-medium" },
    dividend: { label: "Dividende", className: "text-indigo-600 dark:text-indigo-400 font-medium" },
    interest: { label: "Intérêts", className: "text-purple-600 dark:text-purple-400 font-medium" },
    coupon: { label: "Coupon", className: "text-indigo-600 dark:text-indigo-400 font-medium" },
};

export function ImportTransactionsDialog({ open, onOpenChange, portfolios }: Props) {
    const [portfolioId, setPortfolioId] = useState<string>("");
    const [previewData, setPreviewData] = useState<ParsedTransaction[]>([]);
    const [file, setFile] = useState<File | null>(null);
    const [skippedCount, setSkippedCount] = useState(0);
    const [negativeWarnings, setNegativeWarnings] = useState<Array<{ date: string; balance: number }>>([]);
    const [fileType, setFileType] = useState<"csv" | "xlsx" | null>(null);
    const createBatchTransactions = useCreateBatchTransactions();

    const resetState = () => {
        setPreviewData([]);
        setFile(null);
        setSkippedCount(0);
        setNegativeWarnings([]);
        setFileType(null);
        setPortfolioId("");
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (!selectedFile) return;
        setFile(selectedFile);
        setPreviewData([]);
        setSkippedCount(0);
        setNegativeWarnings([]);

        const ext = selectedFile.name.split(".").pop()?.toLowerCase();

        try {
            if (ext === "xlsx" || ext === "xls") {
                setFileType("xlsx");
                const buffer = await selectedFile.arrayBuffer();
                // cellDates:true → dates become JS Date objects instead of serial numbers
                const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                // raw:true keeps numbers as numbers and dates as Date objects
                const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });

                // Debug: log first row to check column names and types
                if (rows.length > 0) {
                    console.log("[XLSX] Headers found:", Object.keys(rows[0]));
                    console.log("[XLSX] First row sample:", rows[0]);
                }

                // Parse with a placeholder portfolio id (will be set on import)
                const { transactions, skippedCount: skipped, negativeBalanceWarnings } = parseSaxoXLSX(rows, "temp");
                setPreviewData(transactions);
                setSkippedCount(skipped);
                setNegativeWarnings(negativeBalanceWarnings);
            } else if (ext === "csv") {
                setFileType("csv");
                const text = await selectedFile.text();
                const parsed = parseCSV(text, "temp");
                // Cast to ParsedTransaction for uniform display
                setPreviewData(parsed as ParsedTransaction[]);
                setSkippedCount(0);
                setNegativeWarnings([]);
            } else {
                toast({ title: "Format non supporté", description: "Veuillez sélectionner un fichier .xlsx ou .csv", variant: "destructive" });
            }
        } catch (err: any) {
            toast({ title: "Erreur de lecture", description: err.message, variant: "destructive" });
            setPreviewData([]);
        }
    };

    const handleImport = () => {
        if (!portfolioId || previewData.length === 0) return;

        // Strip preview-only fields before inserting
        const transactionsToImport = previewData.map(({ _isin, _instrument, _totalEUR, ...t }) => ({
            ...t,
            portfolio_id: portfolioId,
        }));

        createBatchTransactions.mutate(transactionsToImport as any, {
            onSuccess: () => {
                toast({ title: "Import réussi", description: `${transactionsToImport.length} transactions ajoutées.` });
                onOpenChange(false);
                resetState();
            },
            onError: (error) => {
                toast({ title: "Erreur d'import", description: error.message, variant: "destructive" });
            }
        });
    };

    const formatAmount = (val: number | undefined) => {
        if (val === undefined) return "—";
        return val.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) resetState(); onOpenChange(v); }}>
            <DialogContent className="sm:max-w-4xl">
                <DialogHeader>
                    <DialogTitle>Importer des transactions</DialogTitle>
                    <DialogDescription>
                        Sélectionnez un relevé Saxo Bank (.xlsx) ou un fichier CSV et un portefeuille de destination.
                    </DialogDescription>
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
                            <Label>Fichier CSV ou XLSX</Label>
                            <Button
                                variant="outline"
                                className="w-full relative overflow-hidden"
                                onClick={() => document.getElementById('file-upload')?.click()}
                            >
                                <Upload className="mr-2 h-4 w-4" />
                                <span className="truncate">{file ? file.name : "Choisir un fichier..."}</span>
                                <input
                                    id="file-upload"
                                    type="file"
                                    accept=".csv,.xlsx,.xls"
                                    className="hidden"
                                    onChange={handleFileChange}
                                />
                            </Button>
                        </div>
                    </div>

                    {/* Stats bar */}
                    {file && previewData.length > 0 && (
                        <div className="flex items-center gap-4 text-sm">
                            <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="h-4 w-4" />
                                {previewData.length} transactions importables
                            </span>
                            {skippedCount > 0 && (
                                <span className="text-muted-foreground">
                                    {skippedCount} lignes ignorées (dividendes, intérêts, frais…)
                                </span>
                            )}
                        </div>
                    )}

                    {/* Negative balance warning */}
                    {negativeWarnings.length > 0 && (
                        <Alert variant="destructive">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertDescription>
                                <strong>Solde cash négatif détecté</strong> — {negativeWarnings.length} point(s) avec solde négatif (ex : {negativeWarnings[0].date} → {formatAmount(negativeWarnings[0].balance)} €).
                                Des transactions de dépôt sont peut-être manquantes dans ce relevé.
                            </AlertDescription>
                        </Alert>
                    )}

                    {/* Preview table */}
                    {previewData.length > 0 && (
                        <div className="border rounded-md">
                            <div className="p-2 bg-muted/50 border-b text-sm font-medium">
                                Aperçu ({previewData.length} transactions)
                                {previewData.length > 50 && " — 50 premières affichées"}
                            </div>
                            <ScrollArea className="h-[300px]">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="text-xs">Date</TableHead>
                                            <TableHead className="text-xs">Type</TableHead>
                                            <TableHead className="text-xs">Ticker</TableHead>
                                            {fileType === "xlsx" && <TableHead className="text-xs">ISIN</TableHead>}
                                            <TableHead className="text-xs text-right">Qté</TableHead>
                                            <TableHead className="text-xs text-right">Prix unit.</TableHead>
                                            <TableHead className="text-xs">Devise</TableHead>
                                            <TableHead className="text-xs text-right">Frais</TableHead>
                                            <TableHead className="text-xs text-right">Total EUR</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {previewData.slice(0, 50).map((tx, i) => {
                                            const typeInfo = TYPE_LABELS[tx.type];
                                            return (
                                                <TableRow key={i}>
                                                    <TableCell className="text-xs tabular-nums">{tx.date}</TableCell>
                                                    <TableCell className={`text-xs ${typeInfo?.className ?? ""}`}>
                                                        {typeInfo?.label ?? tx.type}
                                                    </TableCell>
                                                    <TableCell className="text-xs font-mono">{tx.ticker || "—"}</TableCell>
                                                    {fileType === "xlsx" && (
                                                        <TableCell className="text-xs font-mono text-muted-foreground">
                                                            {(tx as ParsedTransaction)._isin || "—"}
                                                        </TableCell>
                                                    )}
                                                    <TableCell className="text-xs text-right tabular-nums">{tx.quantity}</TableCell>
                                                    <TableCell className="text-xs text-right tabular-nums">{formatAmount(tx.unit_price ?? undefined)}</TableCell>
                                                    <TableCell className="text-xs">{tx.currency || "EUR"}</TableCell>
                                                    <TableCell className="text-xs text-right tabular-nums text-muted-foreground">
                                                        {tx.fees ? formatAmount(tx.fees) : "—"}
                                                    </TableCell>
                                                    <TableCell className={`text-xs text-right tabular-nums font-medium ${(tx as ParsedTransaction)._totalEUR !== undefined
                                                        ? ((tx as ParsedTransaction)._totalEUR! < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")
                                                        : ""
                                                        }`}>
                                                        {(tx as ParsedTransaction)._totalEUR !== undefined
                                                            ? formatAmount((tx as ParsedTransaction)._totalEUR)
                                                            : "—"}
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                        {previewData.length > 50 && (
                                            <TableRow>
                                                <TableCell colSpan={fileType === "xlsx" ? 9 : 8} className="text-center text-muted-foreground text-xs py-3">
                                                    … et {previewData.length - 50} autres transactions
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
                    <Button variant="ghost" onClick={() => { resetState(); onOpenChange(false); }}>Annuler</Button>
                    <Button
                        onClick={handleImport}
                        disabled={!portfolioId || previewData.length === 0 || createBatchTransactions.isPending || negativeWarnings.length > 0}
                    >
                        {createBatchTransactions.isPending ? "Import en cours…" : `Importer ${previewData.length > 0 ? `(${previewData.length})` : ""}`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
