import { useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Upload } from "lucide-react";

// ── Interface ──────────────────────────────────────────────────────────
export interface TestTransaction {
  date: string; // ISO 8601 (YYYY-MM-DD)
  type: "DEPOSIT" | "WITHDRAWAL" | "BUY" | "SELL" | "DIVIDEND";
  symbol?: string;
  quantity?: number;
  price?: number;
  amount: number;
  currency: string;
  exchangeRate: number;
}

// ── Symbol mapping ─────────────────────────────────────────────────────
const EXCHANGE_SUFFIX: Record<string, string> = {
  xams: ".AS",
  xpar: ".PA",
  xdus: ".DE",
  xetr: ".DE",
  xmil: ".MI",
  xnas: "",
  xnys: "",
  arcx: "",
  bats: "",
};

function formatSymbol(raw: string): string | undefined {
  if (!raw) return undefined;
  const [base, exchange] = raw.split(":");
  if (!base) return undefined;
  const suffix = EXCHANGE_SUFFIX[exchange?.toLowerCase() ?? ""];
  return base.toUpperCase() + (suffix ?? "");
}

// ── Date parsing ───────────────────────────────────────────────────────
const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04",
  May: "05", Jun: "06", Jul: "07", Aug: "08",
  Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function parseDate(v: any): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  if (typeof v === "number") {
    const epoch = new Date(Date.UTC(1900, 0, 1));
    const days = v > 59 ? v - 2 : v - 1;
    const d = new Date(epoch.getTime() + days * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  if (!s) return null;
  // DD-Mon-YYYY
  const dp = s.split("-");
  if (dp.length === 3 && MONTHS[dp[1]]) return `${dp[2]}-${MONTHS[dp[1]]}-${dp[0].padStart(2, "0")}`;
  // ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  // M/D/YYYY
  const sp = s.split("/");
  if (sp.length === 3) return `${sp[2]}-${sp[1].padStart(2, "0")}-${sp[0].padStart(2, "0")}`;
  return null;
}

// ── Regex for qty/price extraction ─────────────────────────────────────
function extractQtyPrice(event: string): { qty: number; price: number } | null {
  const m = event.match(/(?:Acheter|Vendre)\s+([-\d,.\s]+)\s*@\s*([\d,.\s]+)/i);
  if (!m) return null;
  const qty = Math.abs(parseFloat(m[1].replace(/\s/g, "").replace(",", ".")));
  const price = parseFloat(m[2].replace(/\s/g, "").replace(",", "."));
  if (isNaN(qty) || isNaN(price)) return null;
  return { qty, price };
}

// ── Numeric parser ─────────────────────────────────────────────────────
function parseNum(v: any, fallback = 0): number {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v ?? "").replace(/[^\d.,-]/g, "").replace(",", "."));
  return isNaN(n) ? fallback : n;
}

// ── Main parser ────────────────────────────────────────────────────────
function parseRows(rows: Record<string, any>[]): { transactions: TestTransaction[]; skipped: number } {
  const transactions: TestTransaction[] = [];
  let skipped = 0;

  for (const row of rows) {
    const type = String(row["Type"] ?? "").trim();
    const event = String(row["Événement"] ?? "").trim();
    const amount = parseNum(row["Montant comptabilisé"]);
    const date = parseDate(row["Date d'opération"]);
    const currency = String(row["Devise de l'instrument"] ?? "EUR").trim().toUpperCase();
    const exchangeRate = parseNum(row["Taux de change"], 1);
    const symbolRaw = String(row["Symbole"] ?? "").trim();

    if (!date || amount === 0) { skipped++; continue; }

    // DEPOSIT / WITHDRAWAL
    if (type === "Transfert d'espèces") {
      transactions.push({
        date, amount, currency, exchangeRate,
        type: amount > 0 ? "DEPOSIT" : "WITHDRAWAL",
      });
      continue;
    }

    // BUY / SELL
    if (type === "Opération") {
      const parsed = extractQtyPrice(event);
      if (!parsed) { skipped++; continue; }
      transactions.push({
        date, amount, currency, exchangeRate,
        type: amount < 0 ? "BUY" : "SELL",
        symbol: formatSymbol(symbolRaw),
        quantity: parsed.qty,
        price: parsed.price,
      });
      continue;
    }

    // DIVIDEND
    if (type === "Opération sur titres" && event.toLowerCase().includes("dividende")) {
      transactions.push({
        date, amount, currency, exchangeRate,
        type: "DIVIDEND",
        symbol: formatSymbol(symbolRaw),
      });
      continue;
    }

    skipped++;
  }

  transactions.sort((a, b) => a.date.localeCompare(b.date));
  return { transactions, skipped };
}

// ── Badge colors ───────────────────────────────────────────────────────
const TYPE_STYLE: Record<string, string> = {
  BUY: "bg-blue-600 text-white hover:bg-blue-600",
  SELL: "bg-red-600 text-white hover:bg-red-600",
  DEPOSIT: "bg-green-600 text-white hover:bg-green-600",
  WITHDRAWAL: "bg-orange-500 text-white hover:bg-orange-500",
  DIVIDEND: "bg-purple-600 text-white hover:bg-purple-600",
};

// ── Format helpers ─────────────────────────────────────────────────────
const fmtNum = (n?: number) => n != null ? n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
const fmtAmount = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Component ──────────────────────────────────────────────────────────
export default function TestImport() {
  const [data, setData] = useState<{ transactions: TestTransaction[]; skipped: number } | null>(null);
  const [fileName, setFileName] = useState<string>("");

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const wb = XLSX.read(ev.target?.result, { type: "array", cellDates: true, raw: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);
      setData(parseRows(rows));
    };
    reader.readAsArrayBuffer(file);
  }, []);

  return (
    <div className="min-h-screen bg-background p-6 max-w-7xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Test Import — Parseur Saxo Bank</h1>

      {/* Upload */}
      <Card>
        <CardContent className="pt-6">
          <label className="flex items-center gap-3 cursor-pointer">
            <Button variant="outline" asChild>
              <span><Upload className="h-4 w-4 mr-2" />Choisir un fichier XLSX</span>
            </Button>
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
            {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
          </label>
        </CardContent>
      </Card>

      {/* Stats */}
      {data && (
        <div className="flex gap-4 text-sm">
          <span className="text-foreground font-medium">{data.transactions.length} transactions parsées</span>
          <span className="text-muted-foreground">{data.skipped} lignes ignorées</span>
        </div>
      )}

      {/* Table */}
      {data && data.transactions.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Transactions</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Symbole</TableHead>
                  <TableHead className="text-right">Quantité</TableHead>
                  <TableHead className="text-right">Prix unitaire</TableHead>
                  <TableHead className="text-right">Montant net</TableHead>
                  <TableHead>Devise</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.transactions.map((tx, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{tx.date}</TableCell>
                    <TableCell>
                      <Badge className={TYPE_STYLE[tx.type]}>{tx.type}</Badge>
                    </TableCell>
                    <TableCell className="font-mono">{tx.symbol ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">{fmtNum(tx.quantity)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtNum(tx.price)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtAmount(tx.amount)}</TableCell>
                    <TableCell>{tx.currency}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
