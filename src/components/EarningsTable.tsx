import { useState, useMemo } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { TickerLogo } from "@/components/TickerLogo";
import { Earning, calculateValidatedCriteria } from "@/hooks/useEarnings";
import { Check, X, Pencil, Trash2, ArrowUpDown, ArrowUp, ArrowDown, MessageSquare, ChevronRight, ChevronDown, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface Props {
  earnings: Earning[];
  allEarnings: Earning[];
  onEdit: (e: Earning) => void;
  onDelete: (id: string) => void;
  onUpdateNote: (id: string, notes: string | null) => void;
  currentQuarter: string;
  tickerPortfolioMap: Map<string, Set<string>>;
}

type SortKey = "ticker" | "quarter" | "revenue_growth" | "operating_margin" | "roe" | "debt_ebitda" | "score" | "status";
type SortDir = "asc" | "desc";

function quarterToSortValue(q: string): number {
  const match = q.match(/Q(\d)\s+(\d{4})/);
  if (!match) return 0;
  return parseInt(match[2]) * 10 + parseInt(match[1]);
}

function SortableHead({ label, sortKey, currentKey, dir, onSort, className }: {
  label: string; sortKey: SortKey; currentKey: SortKey | null; dir: SortDir; onSort: (k: SortKey) => void; className?: string;
}) {
  const active = currentKey === sortKey;
  return (
    <TableHead className={`cursor-pointer select-none hover:text-foreground transition-colors ${className || ""}`} onClick={() => onSort(sortKey)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-30" />}
      </span>
    </TableHead>
  );
}

interface TrendProps {
  current: number | null;
  previous: number | null;
  inverse?: boolean;
}

function TrendIndicator({ current, previous, inverse }: TrendProps) {
  if (current == null || previous == null) return null;
  const diff = current - previous;
  if (Math.abs(diff) < 0.01) return <Minus className="h-3 w-3 text-muted-foreground" />;
  const isPositive = inverse ? diff < 0 : diff > 0;
  if (isPositive) return <TrendingUp className="h-3 w-3 text-emerald-500" />;
  return <TrendingDown className="h-3 w-3 text-rose-500" />;
}

function CriteriaCell({ value, threshold, inverse, previousValue }: { value: number | null; threshold: number; inverse?: boolean; previousValue?: number | null }) {
  if (value == null) return <TableCell className="text-center text-muted-foreground">—</TableCell>;
  const pass = inverse ? value < threshold : value > threshold;
  return (
    <TableCell className="text-center">
      <span className={`inline-flex items-center gap-1 font-medium ${pass ? "text-emerald-500" : "text-rose-500"}`}>
        {pass ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
        {value.toFixed(1)}{inverse ? "x" : "%"}
        {previousValue !== undefined && <TrendIndicator current={value} previous={previousValue} inverse={inverse} />}
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

function ScoreBadge({ score, previousScore }: { score: number; previousScore?: number }) {
  let variant: "default" | "destructive" | "secondary" = "default";
  let className = "";
  if (score <= 1) { variant = "destructive"; }
  else if (score <= 3) { className = "bg-amber-600 hover:bg-amber-700 text-white"; }
  else { className = "bg-emerald-600 hover:bg-emerald-700 text-white"; }
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant={variant} className={className}>{score}/5</Badge>
      {previousScore !== undefined && (
        <TrendIndicator current={score} previous={previousScore} />
      )}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "hold": return <Badge variant="secondary" className="bg-blue-600/20 text-blue-400 border-blue-600/30">Hold</Badge>;
    case "alleger": return <Badge variant="secondary" className="bg-amber-600/20 text-amber-400 border-amber-600/30">Alléger</Badge>;
    case "sell": return <Badge variant="destructive">Sell</Badge>;
    default: return <Badge variant="secondary">{status}</Badge>;
  }
}

function PortfolioBadges({ portfolios }: { portfolios: Set<string> | undefined }) {
  if (!portfolios || portfolios.size === 0) {
    return <TableCell className="text-center text-muted-foreground text-xs">—</TableCell>;
  }
  return (
    <TableCell>
      <div className="flex flex-wrap gap-1">
        {Array.from(portfolios).map((name) => (
          <Badge key={name} variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
            {name}
          </Badge>
        ))}
      </div>
    </TableCell>
  );
}

function NotePopover({ earning, onUpdateNote }: { earning: Earning; onUpdateNote: (id: string, notes: string | null) => void }) {
  const [value, setValue] = useState(earning.notes ?? "");
  const [open, setOpen] = useState(false);

  const handleSave = () => {
    onUpdateNote(earning.id, value.trim() || null);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setValue(earning.notes ?? ""); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className={`h-7 w-7 ${earning.notes ? "text-foreground" : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
          <MessageSquare className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="left" className="w-64 p-3">
        <div className="grid gap-2">
          <Textarea
            className="text-xs min-h-[60px] resize-none"
            placeholder="Ajouter une note..."
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button size="sm" className="h-7 text-xs" onClick={handleSave}>Enregistrer</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const statusOrder: Record<string, number> = { hold: 0, alleger: 1, sell: 2 };

function EarningRow({
  earning,
  previousEarning,
  isExpanded,
  isHistorical,
  hasHistory,
  onToggle,
  onEdit,
  onDelete,
  onUpdateNote,
  currentQuarter,
  tickerPortfolioMap,
}: {
  earning: Earning;
  previousEarning: Earning | null;
  isExpanded?: boolean;
  isHistorical?: boolean;
  hasHistory?: boolean;
  onToggle?: () => void;
  onEdit: (e: Earning) => void;
  onDelete: (id: string) => void;
  onUpdateNote: (id: string, notes: string | null) => void;
  currentQuarter: string;
  tickerPortfolioMap: Map<string, Set<string>>;
}) {
  const score = calculateValidatedCriteria(earning);
  const previousScore = previousEarning ? calculateValidatedCriteria(previousEarning) : undefined;
  const currentQValue = quarterToSortValue(currentQuarter);
  const earningQValue = quarterToSortValue(earning.quarter);
  const isOutdated = earningQValue < currentQValue;

  return (
    <TableRow
      className={`${isOutdated && !isHistorical ? "bg-amber-500/8 border-l-2 border-l-amber-500" : ""} ${isHistorical ? "bg-muted/30" : ""}`}
    >
      <TableCell>
        <div className="flex items-center gap-1.5">
          {!isHistorical && hasHistory && (
            <Button variant="ghost" size="icon" className="h-6 w-6 p-0" onClick={onToggle}>
              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </Button>
          )}
          {isHistorical && <span className="w-6" />}
          {!isHistorical && (
            <>
              <TickerLogo ticker={earning.ticker} />
              <span className="font-medium">{earning.ticker}</span>
            </>
          )}
          {isHistorical && (
            <span className="text-muted-foreground text-xs ml-1">↳</span>
          )}
        </div>
      </TableCell>
      {!isHistorical ? (
        <PortfolioBadges portfolios={tickerPortfolioMap.get(earning.ticker)} />
      ) : (
        <TableCell />
      )}
      <TableCell>
        {isOutdated ? (
          <span className="inline-block px-2 py-0.5 rounded text-amber-400 bg-amber-500/15 font-medium text-xs">{earning.quarter}</span>
        ) : (
          <span className="inline-block px-2 py-0.5 rounded text-emerald-400 bg-emerald-500/15 font-medium text-xs">{earning.quarter}</span>
        )}
      </TableCell>
      <CriteriaCell value={earning.revenue_growth} threshold={10} previousValue={!isHistorical ? previousEarning?.revenue_growth : undefined} />
      <CriteriaCell value={earning.operating_margin} threshold={20} previousValue={!isHistorical ? previousEarning?.operating_margin : undefined} />
      <CriteriaCell value={earning.roe} threshold={30} previousValue={!isHistorical ? previousEarning?.roe : undefined} />
      <CriteriaCell value={earning.debt_ebitda} threshold={1.5} inverse previousValue={!isHistorical ? previousEarning?.debt_ebitda : undefined} />
      <MoatCell value={earning.moat} />
      <TableCell className="text-center">
        <ScoreBadge score={score} previousScore={!isHistorical ? previousScore : undefined} />
      </TableCell>
      <TableCell className="text-center"><StatusBadge status={earning.status} /></TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          <NotePopover earning={earning} onUpdateNote={onUpdateNote} />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(earning)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDelete(earning.id)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function EarningsTable({ earnings, allEarnings, onEdit, onDelete, onUpdateNote, currentQuarter, tickerPortfolioMap }: Props) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expandedTickers, setExpandedTickers] = useState<Set<string>>(new Set());

  // Build a map: ticker → sorted list of all earnings (newest first)
  const tickerHistory = useMemo(() => {
    const map = new Map<string, Earning[]>();
    allEarnings.forEach((e) => {
      if (!map.has(e.ticker)) map.set(e.ticker, []);
      map.get(e.ticker)!.push(e);
    });
    // Sort each list by quarter descending
    map.forEach((list) => {
      list.sort((a, b) => quarterToSortValue(b.quarter) - quarterToSortValue(a.quarter));
    });
    return map;
  }, [allEarnings]);

  if (earnings.length === 0) {
    return <p className="text-muted-foreground text-sm text-center py-8">Aucun résultat enregistré.</p>;
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const toggleExpand = (ticker: string) => {
    setExpandedTickers((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  };

  const sorted = [...earnings].sort((a, b) => {
    if (!sortKey) return 0;
    const mul = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "ticker": return mul * a.ticker.localeCompare(b.ticker);
      case "quarter": return mul * (quarterToSortValue(a.quarter) - quarterToSortValue(b.quarter));
      case "revenue_growth": return mul * ((a.revenue_growth ?? -999) - (b.revenue_growth ?? -999));
      case "operating_margin": return mul * ((a.operating_margin ?? -999) - (b.operating_margin ?? -999));
      case "roe": return mul * ((a.roe ?? -999) - (b.roe ?? -999));
      case "debt_ebitda": return mul * ((a.debt_ebitda ?? 999) - (b.debt_ebitda ?? 999));
      case "score": return mul * (calculateValidatedCriteria(a) - calculateValidatedCriteria(b));
      case "status": return mul * ((statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99));
      default: return 0;
    }
  });

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead label="Ticker" sortKey="ticker" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
            <TableHead>Portefeuille(s)</TableHead>
            <SortableHead label="Trimestre" sortKey="quarter" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
            <SortableHead label="CA (>10%)" sortKey="revenue_growth" currentKey={sortKey} dir={sortDir} onSort={handleSort} className="text-center" />
            <SortableHead label="Marge OP (>20%)" sortKey="operating_margin" currentKey={sortKey} dir={sortDir} onSort={handleSort} className="text-center" />
            <SortableHead label="ROE (>30%)" sortKey="roe" currentKey={sortKey} dir={sortDir} onSort={handleSort} className="text-center" />
            <SortableHead label="Dette/EBITDA (<1.5)" sortKey="debt_ebitda" currentKey={sortKey} dir={sortDir} onSort={handleSort} className="text-center" />
            <TableHead className="text-center">Moat</TableHead>
            <SortableHead label="Score" sortKey="score" currentKey={sortKey} dir={sortDir} onSort={handleSort} className="text-center" />
            <SortableHead label="Statut" sortKey="status" currentKey={sortKey} dir={sortDir} onSort={handleSort} className="text-center" />
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((e) => {
            const history = tickerHistory.get(e.ticker) || [];
            const previousEarning = history.length > 1 ? history[1] : null;
            const isExpanded = expandedTickers.has(e.ticker);
            const hasHistory = history.length > 1;

            return (
              <>
                <EarningRow
                  key={e.id}
                  earning={e}
                  previousEarning={previousEarning}
                  isExpanded={isExpanded}
                  hasHistory={hasHistory}
                  onToggle={() => toggleExpand(e.ticker)}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onUpdateNote={onUpdateNote}
                  currentQuarter={currentQuarter}
                  tickerPortfolioMap={tickerPortfolioMap}
                />
                {isExpanded && history.slice(1).map((histE, idx) => {
                  const prevOfHist = history[idx + 2] || null;
                  return (
                    <EarningRow
                      key={histE.id}
                      earning={histE}
                      previousEarning={prevOfHist}
                      isHistorical
                      onEdit={onEdit}
                      onDelete={onDelete}
                      onUpdateNote={onUpdateNote}
                      currentQuarter={currentQuarter}
                      tickerPortfolioMap={tickerPortfolioMap}
                    />
                  );
                })}
              </>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
