import { useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { useQueryClient } from "@tanstack/react-query";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateBatchTransactions, Portfolio } from "@/hooks/usePortfolios";
import { toast } from "@/hooks/use-toast";
import { parseCSV } from "@/lib/csvParser";
import { parseIBKR, TestTransaction } from "@/lib/ibkrParser";
import { ParsedTransaction, parseSaxoXLSX } from "@/lib/xlsxParser";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    portfolios: Portfolio[];
    onImportSuccess?: (portfolioId: string) => void;
}

type BrokerType = "saxo" | "ibkr";

const TYPE_LABELS: Record<string, { label: string; className: string }> = {
    buy: { label: "Achat", className: "text-emerald-600 dark:text-emerald-400 font-medium" },
    sell: { label: "Vente", className: "text-rose-600 dark:text-rose-400 font-medium" },
    deposit: { label: "Dépôt", className: "text-sky-600 dark:text-sky-400 font-medium" },
    withdrawal: { label: "Retrait", className: "text-amber-600 dark:text-amber-400 font-medium" },
    dividend: { label: "Dividende", className: "text-indigo-600 dark:text-indigo-400 font-medium" },
    interest: { label: "Intérêts", className: "text-purple-600 dark:text-purple-400 font-medium" },
    coupon: { label: "Coupon", className: "text-indigo-600 dark:text-indigo-400 font-medium" },
    transfer_in: { label: "Transfert ↓", className: "text-teal-600 dark:text-teal-400 font-medium" },
    transfer_out: { label: "Transfert ↑", className: "text-pink-600 dark:text-pink-400 font-medium" },
    conversion: { label: "Conversion", className: "text-orange-600 dark:text-orange-400 font-medium" },
};

/**
 * Group FOREX TestTransactions into conversion ParsedTransactions.
 * FOREX transactions come in pairs: one negative (source currency) and one positive (target currency),
 * optionally followed by a small negative commission in one of the currencies.
 */
function groupForexToConversions(forexTxs: TestTransaction[], portfolioId: string): ParsedTransaction[] {
    const results: ParsedTransaction[] = [];
    const pushAsInterest = (tx: TestTransaction) => {
        results.push({
            portfolio_id: portfolioId,
            date: tx.date,
            type: "interest",
            ticker: null,
            quantity: tx.amount,
            unit_price: 1,
            fees: 0,
            currency: tx.currency,
            _totalEUR: tx.amount,
        });
    };

    const pushPairAsConversion = (a: TestTransaction, b: TestTransaction): boolean => {
        let source: TestTransaction | null = null;
        let target: TestTransaction | null = null;

        if (a.amount < 0 && b.amount > 0) {
            source = a;
            target = b;
        } else if (b.amount < 0 && a.amount > 0) {
            source = b;
            target = a;
        } else {
            return false;
        }

        const sourceAmount = Math.abs(source.amount);
        const targetAmount = Math.abs(target.amount);
        if (targetAmount <= 0) return false;
        const rate = sourceAmount / targetAmount;

        results.push({
            portfolio_id: portfolioId,
            date: a.date,
            type: "conversion",
            ticker: source.currency,
            quantity: targetAmount,
            unit_price: rate,
            fees: 0,
            currency: target.currency,
            _totalEUR: 0,
        });
        return true;
    };

    // Deterministic path for Saxo: parser can tag each FOREX pair with an id.
    const groupedById = new Map<string, TestTransaction[]>();
    const ungrouped: TestTransaction[] = [];
    for (const tx of forexTxs) {
        const groupId = (tx as any).fxGroupId as string | undefined;
        if (!groupId) {
            ungrouped.push(tx);
            continue;
        }
        const group = groupedById.get(groupId) || [];
        group.push(tx);
        groupedById.set(groupId, group);
    }

    for (const group of groupedById.values()) {
        if (group.length !== 2 || !pushPairAsConversion(group[0], group[1])) {
            group.forEach(pushAsInterest);
        }
    }

    // Backward-compatible fallback (IBKR and old imports without group id)
    let i = 0;
    while (i < ungrouped.length) {
        const tx1 = ungrouped[i];
        const tx2 = i + 1 < ungrouped.length ? ungrouped[i + 1] : null;
        if (!tx2 || tx1.date !== tx2.date) {
            pushAsInterest(tx1);
            i++;
            continue;
        }
        if (pushPairAsConversion(tx1, tx2)) {
            i += 2;
            continue;
        }
        pushAsInterest(tx1);
        i++;
    }

    return results;
}

function mapTestTransactionToParsed(tx: TestTransaction, portfolioId: string): ParsedTransaction {
    let mappedType: string;
    switch (tx.type) {
        case "BUY": mappedType = "buy"; break;
        case "SELL": mappedType = "sell"; break;
        case "DEPOSIT": mappedType = "deposit"; break;
        case "WITHDRAWAL": mappedType = "withdrawal"; break;
        case "DIVIDEND": mappedType = "dividend"; break;
        case "INTEREST": mappedType = "interest"; break;
        case "TRANSFER_IN": mappedType = "transfer_in"; break;
        case "TRANSFER_OUT": mappedType = "transfer_out"; break;
        default: mappedType = tx.type.toLowerCase(); break;
    }

    // Extract hidden fee from difference between amount and theoretical trade value
    let calculatedFees = 0;
    if (tx.type === "BUY" && tx.quantity != null && tx.price != null) {
        calculatedFees = Math.max(0, Math.abs(tx.amount) - (tx.quantity * tx.price));
    } else if (tx.type === "SELL" && tx.quantity != null && tx.price != null) {
        calculatedFees = Math.max(0, (tx.quantity * tx.price) - tx.amount);
    }

    return {
        portfolio_id: portfolioId,
        date: tx.date,
        type: mappedType as any,
        ticker: tx.symbol || null,
        quantity: (mappedType === "interest" || mappedType === "dividend") ? tx.amount : (tx.quantity || Math.abs(tx.amount)),
        unit_price: tx.price || 1,
        fees: calculatedFees,
        currency: tx.currency,
        _totalEUR: tx.amount
    };
}

export function ImportTransactionsDialog({ open, onOpenChange, portfolios, onImportSuccess }: Props) {
    const queryClient = useQueryClient();
    const [portfolioId, setPortfolioId] = useState<string>("");
    const [broker, setBroker] = useState<BrokerType>("saxo");
    const [previewData, setPreviewData] = useState<ParsedTransaction[]>([]);
    const [file, setFile] = useState<File | null>(null);
    const [skippedCount, setSkippedCount] = useState(0);
    const [negativeWarnings, setNegativeWarnings] = useState<Array<{ date: string; balance: number }>>([]);
    const [fileType, setFileType] = useState<"csv" | "xlsx" | "html" | "htm" | null>(null);
    const createBatchTransactions = useCreateBatchTransactions();

    const resetState = () => {
        setPreviewData([]);
        setFile(null);
        setSkippedCount(0);
        setNegativeWarnings([]);
        setFileType(null);
        setPortfolioId("");
    };

    const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (!selectedFile) return;
        setFile(selectedFile);
        setPreviewData([]);
        setSkippedCount(0);
        setNegativeWarnings([]);

        const ext = selectedFile.name.split(".").pop()?.toLowerCase();

        // Wait for a valid portfolioId before parsing (or use 'temp' and remap on import)
        // We'll use 'temp' to allow preview before selecting portfolio
        const tempPortfolioId = portfolioId || "temp";

        try {
            if (broker === "ibkr") {
                // IBKR: parse HTML file
                if (ext !== "html" && ext !== "htm") {
                    toast({ title: "Format non supporté", description: "IBKR nécessite un fichier .html (relevé Flex)", variant: "destructive" });
                    return;
                }
                setFileType("html");
                const text = await selectedFile.text();
                const { transactions, skipped } = parseIBKR(text);

                // Separate FOREX from other transactions
                const forexTxs = transactions.filter(t => t.type === "FOREX");
                const otherTxs = transactions.filter(t => t.type !== "FOREX");

                // Map non-FOREX normally
                const mappedOthers = otherTxs.map(t => mapTestTransactionToParsed(t, tempPortfolioId));
                // Group FOREX into conversions
                const mappedForex = groupForexToConversions(forexTxs, tempPortfolioId);
                // Combine and sort by date
                const mapped = [...mappedOthers, ...mappedForex].sort((a, b) => a.date.localeCompare(b.date));

                // Check daily end-of-day balances (not per-transaction)
                const dailyTotals = new Map<string, number>();
                for (const tx of mapped) {
                    dailyTotals.set(tx.date, (dailyTotals.get(tx.date) || 0) + (tx._totalEUR ?? 0));
                }
                let cashBalance = 0;
                const warnings: Array<{ date: string; balance: number }> = [];
                for (const [date, dayAmount] of dailyTotals) {
                    cashBalance += dayAmount;
                    if (cashBalance < -0.01) {
                        warnings.push({ date, balance: Math.round(cashBalance * 100) / 100 });
                    }
                }

                setPreviewData(mapped);
                setSkippedCount(skipped);
                setNegativeWarnings(warnings);
            } else {
                // Saxo: XLSX or CSV
                if (ext === "xlsx" || ext === "xls") {
                    setFileType("xlsx");
                    const buffer = await selectedFile.arrayBuffer();
                    const workbook = XLSX.read(buffer, { type: "array", cellDates: true, raw: true });
                    const sheetName = workbook.SheetNames[0];
                    const sheet = workbook.Sheets[sheetName];
                    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
                    const parsed = parseSaxoXLSX(rows, tempPortfolioId);

                    setPreviewData(parsed.transactions);
                    setSkippedCount(parsed.skippedCount);
                    setNegativeWarnings(parsed.negativeBalanceWarnings);
                } else if (ext === "csv") {
                    setFileType("csv");
                    const text = await selectedFile.text();
                    const parsed = parseCSV(text, "temp");
                    setPreviewData(parsed as ParsedTransaction[]);
                    setSkippedCount(0);
                    setNegativeWarnings([]);
                } else {
                    toast({ title: "Format non supporté", description: "Veuillez sélectionner .xlsx, .htm ou .csv", variant: "destructive" });
                }
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            toast({ title: "Erreur de lecture", description: err.message, variant: "destructive" });
            setPreviewData([]);
        }
    }, [portfolioId, broker]);

    const txKey = (tx: {
        date: string;
        type: string;
        ticker: string | null;
        quantity: number | null;
        unit_price: number | null;
        fees: number;
        currency: string | null;
    }) => {
        const dateKey = String(tx.date || "").slice(0, 10);
        const q = Number((tx.quantity || 0).toFixed(8));
        const u = Number((tx.unit_price || 0).toFixed(8));
        const f = Number((tx.fees || 0).toFixed(8));
        return [
            dateKey,
            tx.type,
            tx.ticker || "",
            tx.currency || "",
            q,
            u,
            f,
        ].join("|");
    };

    const handleImport = async () => {
        if (!portfolioId || previewData.length === 0) return;

        // Keep only real DB columns (drop preview/debug fields like _isin/_instrument/_totalEUR/_sourceTag).
        const transactionsToImport = previewData.map((tx) => ({
            portfolio_id: portfolioId,
            date: tx.date,
            type: tx.type,
            ticker: tx.ticker,
            quantity: tx.quantity,
            unit_price: tx.unit_price,
            fees: tx.fees,
            currency: tx.currency,
        }));

        try {
            const { data: existing, error: existingError } = await supabase
                .from("transactions")
                .select("id,created_at,date,type,ticker,quantity,unit_price,fees,currency")
                .eq("portfolio_id", portfolioId)
                .order("created_at", { ascending: true });

            if (existingError) {
                throw existingError;
            }

            const existingRows = existing || [];
            const incomingByKey = new Map<string, typeof transactionsToImport>();
            for (const tx of transactionsToImport) {
                const key = txKey(tx);
                const list = incomingByKey.get(key) || [];
                list.push(tx);
                incomingByKey.set(key, list);
            }

            const incomingDates = transactionsToImport
                .map((tx) => String(tx.date || "").slice(0, 10))
                .filter(Boolean)
                .sort();
            const minIncomingDate = incomingDates[0] || "";
            const maxIncomingDate = incomingDates[incomingDates.length - 1] || "";
            const isSaxoXlsxSync = broker === "saxo" && fileType === "xlsx" && !!minIncomingDate && !!maxIncomingDate;
            const inIncomingRange = (date: string) => {
                const d = String(date || "").slice(0, 10);
                return d >= minIncomingDate && d <= maxIncomingDate;
            };

            const existingByKey = new Map<string, typeof existingRows>();
            for (const row of existingRows) {
                if (isSaxoXlsxSync && !inIncomingRange(row.date)) continue;
                const key = txKey(row);
                const list = existingByKey.get(key) || [];
                list.push(row);
                existingByKey.set(key, list);
            }

            const incomingUnique: typeof transactionsToImport = [];
            let skippedAsDuplicate = 0;
            const duplicateIdsToDelete: string[] = [];
            for (const [key, txList] of incomingByKey.entries()) {
                const existingForKey = existingByKey.get(key) || [];
                const existingCount = existingForKey.length;
                const toInsertCount = Math.max(0, txList.length - existingCount);
                skippedAsDuplicate += txList.length - toInsertCount;

                if (existingCount > txList.length) {
                    const duplicatesToDelete = [...existingForKey]
                        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                        .slice(0, existingCount - txList.length);
                    duplicateIdsToDelete.push(...duplicatesToDelete.map((d) => d.id));
                }

                for (let i = 0; i < toInsertCount; i++) {
                    incomingUnique.push(txList[i]);
                }
            }

            if (isSaxoXlsxSync) {
                for (const [key, existingForKey] of existingByKey.entries()) {
                    if (incomingByKey.has(key)) continue;
                    duplicateIdsToDelete.push(...existingForKey.map((row) => row.id));
                }
            }

            if (duplicateIdsToDelete.length > 0) {
                const { error: deleteError } = await supabase
                    .from("transactions")
                    .delete()
                    .in("id", duplicateIdsToDelete);
                if (deleteError) {
                    throw deleteError;
                }
            }

            if (incomingUnique.length > 0) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await createBatchTransactions.mutateAsync(incomingUnique as any);
            }

            await queryClient.invalidateQueries({ queryKey: ["transactions"] });
            await queryClient.invalidateQueries({ queryKey: ["portfolios"] });

            const portfolioName = portfolios.find((p) => p.id === portfolioId)?.name || "portefeuille sélectionné";
            toast({
                title: "Import réussi",
                description: `${incomingUnique.length} ajoutées dans ${portfolioName}${skippedAsDuplicate > 0 ? `, ${skippedAsDuplicate} doublons ignorés` : ""}${duplicateIdsToDelete.length > 0 ? `, ${duplicateIdsToDelete.length} doublons nettoyés` : ""}.`,
            });
            onImportSuccess?.(portfolioId);
            onOpenChange(false);
            resetState();
        } catch (error: any) {
            toast({ title: "Erreur d'import", description: error.message, variant: "destructive" });
        }
    };

    const formatAmount = (val: number | undefined) => {
        if (val === undefined) return "—";
        return val.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const acceptedFormats = broker === "ibkr" ? ".html,.htm" : ".csv,.xlsx,.xls";
    const formatHint = broker === "ibkr"
        ? "Relevé Flex IBKR (.html)"
        : "Relevé Saxo Bank (.xlsx) ou CSV";

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) resetState(); onOpenChange(v); }}>
            <DialogContent className="sm:max-w-4xl">
                <DialogHeader>
                    <DialogTitle>Importer des transactions</DialogTitle>
                    <DialogDescription>
                        Sélectionnez votre courtier, un fichier de relevé et un portefeuille de destination.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <Label>Courtier</Label>
                            <Select value={broker} onValueChange={(v) => { setBroker(v as BrokerType); setFile(null); setPreviewData([]); setSkippedCount(0); setNegativeWarnings([]); }}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="saxo">Saxo Bank</SelectItem>
                                    <SelectItem value="ibkr">Interactive Brokers</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

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
                            <Label>{formatHint}</Label>
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
                                    accept={acceptedFormats}
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
                                    {skippedCount} lignes ignorées
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
                        disabled={!portfolioId || previewData.length === 0 || createBatchTransactions.isPending}
                    >
                        {createBatchTransactions.isPending ? "Import en cours…" : `Importer ${previewData.length > 0 ? `(${previewData.length})` : ""}`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
