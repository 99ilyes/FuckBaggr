import { useState } from "react";
import { Portfolio, useDeletePortfolio, useDeleteTransactionsByPortfolio } from "@/hooks/usePortfolios";
import { EditPortfolioDialog } from "@/components/EditPortfolioDialog";
import { Button } from "@/components/ui/button";
import { SaxoLogo, IBKRLogo, getBrokerForPortfolio } from "@/components/BrokerLogos";
import { Plus, Trash2, Pencil, Eraser } from "lucide-react";
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
  const deleteTransactions = useDeleteTransactionsByPortfolio();
  const [portfolioToDelete, setPortfolioToDelete] = useState<string | null>(null);
  const [portfolioToEmpty, setPortfolioToEmpty] = useState<string | null>(null);
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

  const handleEmpty = () => {
    if (portfolioToEmpty) {
      deleteTransactions.mutate(portfolioToEmpty);
      setPortfolioToEmpty(null);
    }
  };

  return (
    <>
      <div className="flex items-center gap-1 border-b border-white/5 w-full overflow-x-auto no-scrollbar mb-6">
        <button
          onClick={() => onSelect(null)}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all duration-200 whitespace-nowrap ${selectedId === null
            ? "border-emerald-500 text-white"
            : "border-transparent text-muted-foreground hover:text-white"
            }`}
        >
          Vue globale
        </button>
        {portfolios.map((p) => (
          <ContextMenu key={p.id}>
            <ContextMenuTrigger>
              <button
                onClick={() => onSelect(p.id)}
                className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all duration-200 whitespace-nowrap flex items-center gap-2 ${selectedId === p.id
                  ? "border-emerald-500 text-white"
                  : "border-transparent text-muted-foreground hover:text-white"
                  }`}
              >
                {getBrokerForPortfolio(p) === "saxo" && (
                  <SaxoLogo className={`w-4 h-4 rounded-sm ${selectedId === p.id ? "opacity-100" : "opacity-60"}`} />
                )}
                {getBrokerForPortfolio(p) === "ibkr" && (
                  <IBKRLogo className={`w-4 h-4 rounded-sm ${selectedId === p.id ? "opacity-100" : "opacity-60"}`} />
                )}
                {p.name}
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent className="border-border bg-card">
              <ContextMenuItem onClick={() => setPortfolioToEdit(p)}>
                <Pencil className="mr-2 h-4 w-4" />
                Renommer
              </ContextMenuItem>
              <ContextMenuItem onClick={() => setPortfolioToEmpty(p.id)}>
                <Eraser className="mr-2 h-4 w-4" />
                Vider
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
        <Button
          size="sm"
          variant="ghost"
          onClick={onCreateClick}
          className="ml-auto text-muted-foreground hover:text-white hover:bg-transparent"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <AlertDialog open={!!portfolioToDelete} onOpenChange={(open) => !open && setPortfolioToDelete(null)}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>Êtes-vous sûr ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. Cela supprimera définitivement le portefeuille et toutes les transactions associées.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent border-white/10 text-white hover:bg-white/5 hover:text-white">Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!portfolioToEmpty} onOpenChange={(open) => !open && setPortfolioToEmpty(null)}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>Êtes-vous sûr de vouloir vider le portefeuille ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action supprimera toutes les transactions de ce portefeuille. Vous devrez les réimporter. Le portefeuille lui-même sera conservé.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent border-white/10 text-white hover:bg-white/5 hover:text-white">Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleEmpty} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Vider
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
