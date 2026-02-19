import { useState } from "react";
import { Portfolio, useDeletePortfolio } from "@/hooks/usePortfolios";
import { EditPortfolioDialog } from "@/components/EditPortfolioDialog";
import { Button } from "@/components/ui/button";
import { SaxoLogo, IBKRLogo, getBrokerForPortfolio } from "@/components/BrokerLogos";
import { Plus, Trash2, Pencil } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
  const deletePortfolio = useDeletePortfolio();
  const [portfolioToDelete, setPortfolioToDelete] = useState<string | null>(null);
  const [portfolioToEdit, setPortfolioToEdit] = useState<Portfolio | null>(null);

  const handleDelete = () => {
    if (portfolioToDelete) {
      deletePortfolio.mutate(portfolioToDelete);
      if (selectedId === portfolioToDelete) {
        onSelect(null);
      }
      setPortfolioToDelete(null);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => onSelect(null)}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${selectedId === null
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-secondary-foreground hover:bg-accent"
            }`}
        >
          Vue globale
        </button>
        {portfolios.map((p) => (
          <ContextMenu key={p.id}>
            <ContextMenuTrigger>
              <button
                onClick={() => onSelect(p.id)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${selectedId === p.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-accent"
                  }`}
              >
                {getBrokerForPortfolio(p.name) === "saxo" && <SaxoLogo className="w-4 h-4 rounded-sm" />}
                {getBrokerForPortfolio(p.name) === "ibkr" && <IBKRLogo className="w-4 h-4 rounded-sm" />}
                {p.name}
                <span className="text-xs opacity-60">{(p as any).currency || "EUR"}</span>
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={() => setPortfolioToEdit(p)}>
                <Pencil className="mr-2 h-4 w-4" />
                Renommer
              </ContextMenuItem>
              <ContextMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setPortfolioToDelete(p.id)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Supprimer
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
        <Button size="sm" variant="ghost" onClick={onCreateClick} className="text-muted-foreground">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <AlertDialog open={!!portfolioToDelete} onOpenChange={(open) => !open && setPortfolioToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Êtes-vous sûr ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. Cela supprimera définitivement le portefeuille et toutes les transactions associées.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      <EditPortfolioDialog
        open={!!portfolioToEdit}
        onOpenChange={(open) => !open && setPortfolioToEdit(null)}
        portfolio={portfolioToEdit}
      />
    </>
  );
}
