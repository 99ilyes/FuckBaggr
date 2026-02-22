import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Trash2, Pencil } from "lucide-react";
import { Transaction, useDeleteTransaction, Portfolio } from "@/hooks/usePortfolios";
import { formatCurrency } from "@/lib/calculations";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useState } from "react";
import { EditTransactionDialog } from "./EditTransactionDialog";

const TYPE_LABELS: Record<string, string> = {
  buy: "Achat",
  sell: "Vente",
  deposit: "Dépôt",
  withdrawal: "Retrait",
  conversion: "Conversion",
};

interface Props {
  transactions: Transaction[];
  portfolios: Portfolio[];
}

export function TransactionsTable({ transactions, portfolios }: Props) {
  const deleteTransaction = useDeleteTransaction();
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const portfolioMap = new Map(portfolios.map((p) => [p.id, p]));

  if (transactions.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        Aucune transaction enregistrée.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[800px]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Ticker</TableHead>
              <TableHead>Portefeuille</TableHead>
              <TableHead className="text-right">Qté</TableHead>
              <TableHead className="text-right">Prix</TableHead>
              <TableHead className="text-right">Frais</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.map((tx) => {
              const total = (tx.quantity || 0) * (tx.unit_price || 0) + tx.fees;
              const portfolio = portfolioMap.get(tx.portfolio_id);
              return (
                <TableRow key={tx.id}>
                  <TableCell className="text-sm">
                    {format(new Date(tx.date), "dd MMM yyyy", { locale: fr })}
                  </TableCell>
                  <TableCell>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${tx.type === "buy" ? "bg-primary/20 text-primary" :
                      tx.type === "sell" ? "bg-loss/20 text-loss" :
                        tx.type === "deposit" ? "bg-gain/20 text-gain" :
                          tx.type === "conversion" ? "bg-accent text-accent-foreground" :
                            "bg-muted text-muted-foreground"
                      }`}>
                      {TYPE_LABELS[tx.type] || tx.type}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {tx.type === "conversion"
                      ? `${tx.ticker || "?"} → ${(tx as any).currency || "?"}`
                      : tx.ticker || "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="flex items-center gap-1.5">
                      {portfolio && (
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: portfolio.color }} />
                      )}
                      {portfolio?.name || "—"}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {tx.type === "conversion"
                      ? formatCurrency(tx.quantity || 0, tx.currency || "EUR")
                      : tx.quantity?.toFixed(2) || "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {tx.unit_price ? formatCurrency(tx.unit_price, tx.currency || "EUR") : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatCurrency(tx.fees, tx.type === "conversion" ? (tx.ticker || "EUR") : (tx.currency || "EUR"))}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {tx.type === "conversion"
                      ? formatCurrency(total, tx.ticker || "EUR")
                      : formatCurrency(total, tx.currency || "EUR")}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-primary"
                      onClick={() => setEditingTransaction(tx)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-loss"
                      onClick={() => deleteTransaction.mutate(tx.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          {editingTransaction && (
            <EditTransactionDialog
              open={!!editingTransaction}
              onOpenChange={(open) => !open && setEditingTransaction(null)}
              transaction={editingTransaction}
            />
          )}
        </Table>
      </div>
    </div>
  );
}
