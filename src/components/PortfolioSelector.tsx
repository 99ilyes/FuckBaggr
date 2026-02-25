import { ReactNode, useState } from "react";
import {
  Portfolio,
  useDeletePortfolio,
  useDeleteTransactionsByPortfolio,
  useUpdatePortfolio,
} from "@/hooks/usePortfolios";
import { EditPortfolioDialog } from "@/components/EditPortfolioDialog";
import { Button } from "@/components/ui/button";
import { SaxoLogo, IBKRLogo, getBrokerForPortfolio } from "@/components/BrokerLogos";
import { Plus, Trash2, Pencil, Eraser, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PRESET_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
];

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{6})$/;
const SHORT_HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3})$/;

function normalizeHexColor(value?: string | null): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (HEX_COLOR_REGEX.test(trimmed)) return trimmed.toLowerCase();

  const shortHex = trimmed.match(SHORT_HEX_COLOR_REGEX);
  if (!shortHex) return null;

  const [r, g, b] = shortHex[1].split("");
  return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
}

function getSafeHexColor(value?: string | null): string {
  return normalizeHexColor(value) || "#3b82f6";
}

interface PortfolioSelectorProps {
  portfolios: Portfolio[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreateClick: () => void;
  showCreateButton?: boolean;
  className?: string;
  rightContent?: ReactNode;
}

export function PortfolioSelector({
  portfolios,
  selectedId,
  onSelect,
  onCreateClick,
  showCreateButton = true,
  className,
  rightContent,
}: PortfolioSelectorProps) {
  const deletePortfolio = useDeletePortfolio();
  const deleteTransactions = useDeleteTransactionsByPortfolio();
  const updatePortfolio = useUpdatePortfolio();
  const [portfolioToDelete, setPortfolioToDelete] = useState<string | null>(null);
  const [portfolioToEmpty, setPortfolioToEmpty] = useState<string | null>(null);
  const [portfolioToEdit, setPortfolioToEdit] = useState<Portfolio | null>(null);
  const [portfolioToColor, setPortfolioToColor] = useState<Portfolio | null>(null);
  const [colorDraft, setColorDraft] = useState("#3b82f6");

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

  const handleColorSubmit = () => {
    if (!portfolioToColor) return;

    const nextColor = normalizeHexColor(colorDraft);
    if (!nextColor) {
      toast({
        title: "Couleur invalide",
        description: "Utilise un code hexadécimal du type #3b82f6.",
        variant: "destructive",
      });
      return;
    }

    updatePortfolio.mutate(
      { id: portfolioToColor.id, color: nextColor },
      {
        onSuccess: () => {
          toast({ title: "Couleur de courbe mise à jour" });
          setPortfolioToColor(null);
        },
        onError: (error) => {
          toast({
            title: "Erreur",
            description: error.message,
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <>
      <div className={cn("flex items-center gap-1 border-b border-white/5 w-full overflow-x-auto no-scrollbar mb-6", className)}>
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
              <ContextMenuItem
                onClick={() => {
                  setPortfolioToColor(p);
                  setColorDraft(getSafeHexColor(p.color));
                }}
              >
                <Palette className="mr-2 h-4 w-4" />
                Couleur de courbe
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
        {showCreateButton && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onCreateClick}
            className="ml-auto text-muted-foreground hover:text-white hover:bg-transparent"
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
        {rightContent}
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

      <Dialog open={!!portfolioToColor} onOpenChange={(open) => !open && setPortfolioToColor(null)}>
        <DialogContent className="sm:max-w-[420px] border-border bg-card">
          <DialogHeader>
            <DialogTitle>Couleur de courbe</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label className="text-sm text-muted-foreground">Portefeuille</Label>
              <p className="mt-1 text-sm font-semibold text-foreground">{portfolioToColor?.name}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="portfolio-curve-color">Couleur</Label>
              <div className="flex items-center gap-3">
                <input
                  id="portfolio-curve-color"
                  type="color"
                  value={getSafeHexColor(colorDraft)}
                  onChange={(e) => setColorDraft(e.target.value)}
                  className="h-10 w-14 cursor-pointer rounded border border-border bg-transparent p-1"
                />
                <Input
                  value={colorDraft}
                  onChange={(e) => setColorDraft(e.target.value)}
                  placeholder="#3b82f6"
                  className="font-mono uppercase"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Couleurs rapides</Label>
              <div className="grid grid-cols-8 gap-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setColorDraft(color)}
                    className={cn(
                      "h-7 rounded border transition-all",
                      getSafeHexColor(colorDraft) === color
                        ? "border-white/90 ring-2 ring-white/50"
                        : "border-white/20 hover:border-white/60"
                    )}
                    style={{ backgroundColor: color }}
                    aria-label={`Choisir la couleur ${color}`}
                    title={color}
                  />
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setPortfolioToColor(null)}>
              Annuler
            </Button>
            <Button onClick={handleColorSubmit} disabled={updatePortfolio.isPending}>
              {updatePortfolio.isPending ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EditPortfolioDialog
        open={!!portfolioToEdit}
        onOpenChange={(open) => !open && setPortfolioToEdit(null)}
        portfolio={portfolioToEdit}
      />
    </>
  );
}
