import { Portfolio } from "@/hooks/usePortfolios";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface PortfolioSelectorProps {
  portfolios: Portfolio[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreateClick: () => void;
}

export function PortfolioSelector({
  portfolios,
  selectedId,
  onSelect,
  onCreateClick,
}: PortfolioSelectorProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={() => onSelect(null)}
        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
          selectedId === null
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-secondary-foreground hover:bg-accent"
        }`}
      >
        Vue globale
      </button>
      {portfolios.map((p) => (
        <button
          key={p.id}
          onClick={() => onSelect(p.id)}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
            selectedId === p.id
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground hover:bg-accent"
          }`}
        >
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: p.color }}
          />
          {p.name}
          <span className="text-xs opacity-60">{(p as any).currency || "EUR"}</span>
        </button>
      ))}
      <Button size="sm" variant="ghost" onClick={onCreateClick} className="text-muted-foreground">
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}
