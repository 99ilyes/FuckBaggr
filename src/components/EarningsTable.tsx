import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TickerLogo } from "@/components/TickerLogo";
import { Earning, calculateValidatedCriteria } from "@/hooks/useEarnings";
import { Check, X, Pencil, Trash2 } from "lucide-react";

interface Props {
  earnings: Earning[];
  onEdit: (e: Earning) => void;
  onDelete: (id: string) => void;
}

function CriteriaCell({ value, threshold, inverse }: { value: number | null; threshold: number; inverse?: boolean }) {
  if (value == null) return <TableCell className="text-center text-muted-foreground">—</TableCell>;
  const pass = inverse ? value < threshold : value > threshold;
  return (
    <TableCell className="text-center">
      <span className={`inline-flex items-center gap-1 font-medium ${pass ? "text-emerald-500" : "text-rose-500"}`}>
        {pass ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
        {value.toFixed(1)}{inverse ? "x" : "%"}
      </span>
    </TableCell>
  );
}

function MoatCell({ value }: { value: boolean }) {
  return (
    <TableCell className="text-center">
      <span className={`inline-flex items-center gap-1 font-medium ${value ? "text-emerald-500" : "text-rose-500"}`}>
        {value ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
        {value ? "Oui" : "Non"}
      </span>
    </TableCell>
  );
}

function ScoreBadge({ score }: { score: number }) {
  let variant: "default" | "destructive" | "secondary" = "default";
  let className = "";
  if (score <= 1) { variant = "destructive"; }
  else if (score <= 3) { className = "bg-amber-600 hover:bg-amber-700 text-white"; }
  else { className = "bg-emerald-600 hover:bg-emerald-700 text-white"; }
  return <Badge variant={variant} className={className}>{score}/5</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "hold": return <Badge variant="secondary" className="bg-blue-600/20 text-blue-400 border-blue-600/30">Hold</Badge>;
    case "alleger": return <Badge variant="secondary" className="bg-amber-600/20 text-amber-400 border-amber-600/30">Alléger</Badge>;
    case "sell": return <Badge variant="destructive">Sell</Badge>;
    default: return <Badge variant="secondary">{status}</Badge>;
  }
}

export function EarningsTable({ earnings, onEdit, onDelete }: Props) {
  if (earnings.length === 0) {
    return <p className="text-muted-foreground text-sm text-center py-8">Aucun résultat enregistré.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ticker</TableHead>
            <TableHead>Trimestre</TableHead>
            <TableHead className="text-center">CA (&gt;10%)</TableHead>
            <TableHead className="text-center">Marge OP (&gt;20%)</TableHead>
            <TableHead className="text-center">ROE (&gt;30%)</TableHead>
            <TableHead className="text-center">Dette/EBITDA (&lt;1.5)</TableHead>
            <TableHead className="text-center">Moat</TableHead>
            <TableHead className="text-center">Score</TableHead>
            <TableHead className="text-center">Statut</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {earnings.map((e) => {
            const score = calculateValidatedCriteria(e);
            return (
              <TableRow key={e.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <TickerLogo ticker={e.ticker} />
                    <span className="font-medium">{e.ticker}</span>
                  </div>
                </TableCell>
                <TableCell>{e.quarter}</TableCell>
                <CriteriaCell value={e.revenue_growth} threshold={10} />
                <CriteriaCell value={e.operating_margin} threshold={20} />
                <CriteriaCell value={e.roe} threshold={30} />
                <CriteriaCell value={e.debt_ebitda} threshold={1.5} inverse />
                <MoatCell value={e.moat} />
                <TableCell className="text-center"><ScoreBadge score={score} /></TableCell>
                <TableCell className="text-center"><StatusBadge status={e.status} /></TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(e)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDelete(e.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
