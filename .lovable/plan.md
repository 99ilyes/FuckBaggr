

## Afficher toutes les variations dans une seule liste

### Objectif
Remplacer les deux cartes separees "Plus fortes hausses (Top 5)" et "Plus fortes baisses (Top 5)" par une **unique carte** listant **toutes** les variations des titres detenus, triees de la plus forte hausse a la plus forte baisse.

### Changements dans `src/components/TopMovers.tsx`

1. **Supprimer le split gainers/losers** : Plus de `.filter()` ni de `.slice(0, 5)`. La liste `variations` (deja triee par `changePercent` decroissant) est utilisee directement.

2. **Une seule Card** : Remplacer la grille 2 colonnes par une seule carte avec le titre "Variations du jour".

3. **ScrollArea si necessaire** : Ajouter un `ScrollArea` avec une hauteur max (~400px) pour gerer les portefeuilles avec beaucoup de positions sans exploser la page.

4. **MoverRow inchange** : Le composant de ligne reste identique (logo, nom, ticker, prix, variation %, variation devise).

5. **Message vide** : Si aucune variation disponible, afficher "Aucune variation disponible".

### Rendu attendu

```text
+--------------------------------+
| Variations du jour             |
|                                |
| NVDA   +3.2%   +4.12 USD      |
| AAPL   +1.8%   +2.50 USD      |
| MSFT   +0.3%   +0.95 USD      |
| AMZN   -0.5%   -1.20 USD      |
| META   -1.2%   -3.40 USD      |
| TSLA   -2.8%   -6.15 USD      |
+--------------------------------+
```

### Impact sur `Index.tsx`
Aucun changement necessaire -- les props `positions` et `assetsCache` restent les memes.

