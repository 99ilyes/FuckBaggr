import { useState, useMemo, useEffect } from "react";
import { useEarnings, useAddEarning, useUpdateEarning, useDeleteEarning, Earning, EarningInsert } from "@/hooks/useEarnings";
import { useTransactions, usePortfolios } from "@/hooks/usePortfolios";
import { EarningsTable } from "@/components/EarningsTable";
import { AddEarningsDialog } from "@/components/AddEarningsDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";

const CURRENT_QUARTER_KEY = "earnings-current-quarter";

function generateQuarterOptions(): string[] {
  const year = new Date().getFullYear();
  const options: string[] = [];
  for (let i = 0; i < 12; i++) {
    const y = year - Math.floor(i / 4);
    const q = 4 - (i % 4);
    options.push(`Q${q} ${y}`);
  }
  return options;
}

/** Parse "Q3 2025" → numeric sortable value (2025 * 10 + 3 = 20253) */
function quarterToSortValue(q: string): number {
  const match = q.match(/Q(\d)\s+(\d{4})/);
  if (!match) return 0;
  return parseInt(match[2]) * 10 + parseInt(match[1]);
}

export default function EarningsTracker() {
  const { data: earnings = [] } = useEarnings();
  const { data: allTransactions = [] } = useTransactions();
  const { data: portfolios = [] } = usePortfolios();
  const addEarning = useAddEarning();
  const updateEarning = useUpdateEarning();
  const deleteEarning = useDeleteEarning();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editData, setEditData] = useState<Earning | null>(null);
  const [filterTicker, setFilterTicker] = useState<string>("all");

  const quarterOptions = useMemo(() => generateQuarterOptions(), []);

  const [currentQuarter, setCurrentQuarter] = useState<string>(() => {
    const saved = localStorage.getItem(CURRENT_QUARTER_KEY);
    return saved || quarterOptions[0];
  });

  useEffect(() => {
    localStorage.setItem(CURRENT_QUARTER_KEY, currentQuarter);
  }, [currentQuarter]);

  // Build portfolio name map: id → name
  const portfolioNameMap = useMemo(() => {
    const map = new Map<string, string>();
    portfolios.forEach((p) => map.set(p.id, p.name));
    return map;
  }, [portfolios]);

  // Build ticker → portfolio names map (only tickers with net positive position per portfolio)
  const tickerPortfolioMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    // Group transactions by portfolio, then compute net qty per ticker
    const portfolioTickers = new Map<string, Map<string, number>>();
    allTransactions.forEach((t) => {
      if (!t.ticker || !t.portfolio_id) return;
      if (!portfolioTickers.has(t.portfolio_id)) portfolioTickers.set(t.portfolio_id, new Map());
      const tickerMap = portfolioTickers.get(t.portfolio_id)!;
      const qty = tickerMap.get(t.ticker) || 0;
      const txQty = t.quantity || 0;
      if (t.type === "buy") tickerMap.set(t.ticker, qty + txQty);
      else if (t.type === "sell") tickerMap.set(t.ticker, qty - txQty);
    });
    // For each portfolio, find tickers with positive qty
    portfolioTickers.forEach((tickerMap, portfolioId) => {
      const pName = portfolioNameMap.get(portfolioId) || portfolioId;
      tickerMap.forEach((qty, ticker) => {
        if (qty > 0.0001) {
          if (!map.has(ticker)) map.set(ticker, new Set());
          map.get(ticker)!.add(pName);
        }
      });
    });
    return map;
  }, [allTransactions, portfolioNameMap]);

  // Tickers currently held in any portfolio
  const portfolioTickers = useMemo(() => {
    return Array.from(tickerPortfolioMap.keys()).sort();
  }, [tickerPortfolioMap]);

  // Only show latest earning per ticker
  const latestEarnings = useMemo(() => {
    const best = new Map<string, Earning>();
    earnings.forEach((e) => {
      const existing = best.get(e.ticker);
      if (!existing || quarterToSortValue(e.quarter) > quarterToSortValue(existing.quarter)) {
        best.set(e.ticker, e);
      }
    });
    return Array.from(best.values()).sort((a, b) => a.ticker.localeCompare(b.ticker));
  }, [earnings]);

  const filtered = useMemo(() => {
    if (filterTicker === "all") return latestEarnings;
    return latestEarnings.filter((e) => e.ticker === filterTicker);
  }, [latestEarnings, filterTicker]);

  const handleSubmit = (data: EarningInsert) => {
    if (editData) {
      updateEarning.mutate({ id: editData.id, ...data });
    } else {
      addEarning.mutate(data);
    }
    setEditData(null);
  };

  const handleEdit = (e: Earning) => {
    setEditData(e);
    setDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    deleteEarning.mutate(id);
  };

  const handleUpdateNote = (id: string, notes: string | null) => {
    updateEarning.mutate({ id, notes });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 md:px-6 space-y-6">
      <Card className="border-border/50">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-lg font-semibold">Earnings Tracker</CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Trimestre actuel :</span>
              <Select value={currentQuarter} onValueChange={setCurrentQuarter}>
                <SelectTrigger className="w-[120px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {quarterOptions.map((q) => (
                    <SelectItem key={q} value={q}>{q}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Select value={filterTicker} onValueChange={setFilterTicker}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue placeholder="Filtrer..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                {portfolioTickers.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => { setEditData(null); setDialogOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" />
              Ajouter
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <EarningsTable
            earnings={filtered}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onUpdateNote={handleUpdateNote}
            currentQuarter={currentQuarter}
            tickerPortfolioMap={tickerPortfolioMap}
          />
        </CardContent>
      </Card>

      <AddEarningsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        tickers={portfolioTickers}
        editData={editData}
      />
    </div>
  );
}
