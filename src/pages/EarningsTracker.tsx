import { useState, useMemo, useEffect } from "react";
import { useEarnings, useAddEarning, useUpdateEarning, useDeleteEarning, Earning, EarningInsert } from "@/hooks/useEarnings";
import { useTransactions, usePortfolios } from "@/hooks/usePortfolios";
import { EarningsTable } from "@/components/EarningsTable";
import { AddEarningsDialog } from "@/components/AddEarningsDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";

const CURRENT_QUARTER_KEY = "earnings-current-quarter";
const STATUS_ORDER = ["hold", "renforcer", "alleger", "sell"] as const;
const STATUS_LABELS: Record<string, string> = {
  hold: "Hold",
  renforcer: "À renforcer",
  alleger: "Alléger",
  sell: "Sell",
};

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
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [tickerFilter, setTickerFilter] = useState("");

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

  const statusOptions = useMemo(() => {
    const statuses = new Set(latestEarnings.map((e) => e.status).filter(Boolean));
    const orderedKnown = STATUS_ORDER.filter((s) => statuses.has(s));
    const custom = Array.from(statuses).filter((s) => !STATUS_ORDER.includes(s as typeof STATUS_ORDER[number])).sort();
    return [...orderedKnown, ...custom];
  }, [latestEarnings]);

  const filtered = useMemo(() => {
    const q = tickerFilter.trim().toLowerCase();
    return latestEarnings.filter((e) => {
      const statusOk = statusFilter === "all" || e.status === statusFilter;
      const tickerOk = q === "" || e.ticker.toLowerCase().includes(q);
      return statusOk && tickerOk;
    });
  }, [latestEarnings, statusFilter, tickerFilter]);

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
    <div className="w-full px-3 py-4 sm:px-4 sm:py-5 md:px-6">
      <div className="mx-auto max-w-[1700px] space-y-4 sm:space-y-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
          <div className="flex items-start gap-2">
            <SidebarTrigger className="-ml-1 mt-0.5 md:hidden" />
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Earnings Tracker</h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                Suivi des derniers résultats par titre avec comparaison historique.
              </p>
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-2 sm:flex-wrap">
            <div className="flex w-full sm:w-auto items-center justify-between sm:justify-start gap-1.5 bg-background/80 border border-border/60 px-2.5 py-1.5 rounded-md">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Trimestre :</span>
              <Select value={currentQuarter} onValueChange={setCurrentQuarter}>
                <SelectTrigger className="w-[102px] h-7 text-xs border-0 shadow-none focus:ring-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {quarterOptions.map((q) => (
                    <SelectItem key={q} value={q}>{q}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-full sm:w-auto items-center justify-between sm:justify-start gap-1.5 bg-background/80 border border-border/60 px-2.5 py-1.5 rounded-md">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Statut :</span>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[130px] h-7 text-xs border-0 shadow-none focus:ring-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous</SelectItem>
                  {statusOptions.map((status) => (
                    <SelectItem key={status} value={status}>
                      {STATUS_LABELS[status] || status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:w-[170px]">
              <Input
                value={tickerFilter}
                onChange={(e) => setTickerFilter(e.target.value)}
                placeholder="Filtrer par titre..."
                className="h-8 text-xs"
              />
            </div>
            <Button size="sm" className="w-full sm:w-auto" onClick={() => { setEditData(null); setDialogOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" />
              Ajouter un résultat
            </Button>
          </div>
        </div>

        <div className="w-full rounded-xl border border-border/60 bg-card/70 shadow-sm">
          <EarningsTable
            earnings={filtered}
            allEarnings={earnings}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onUpdateNote={handleUpdateNote}
            currentQuarter={currentQuarter}
            tickerPortfolioMap={tickerPortfolioMap}
          />
        </div>
      </div>

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
