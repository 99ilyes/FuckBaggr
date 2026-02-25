

# Mini-graphique au clic sur un titre dans "Variations du jour"

## Objectif
Quand l'utilisateur clique sur un titre dans la liste "Variations du jour", afficher une popup/drawer contenant un graphique du cours historique du titre avec un selecteur de periode (1S, 1M, 3M, 6M, 1A, 5A). Sur mobile, utiliser un Drawer (bottom sheet) au lieu d'un Dialog pour une meilleure ergonomie tactile.

## Approche

### 1. Nouveau composant `TickerChartPopup`
- Responsive : utilise `Dialog` sur desktop, `Drawer` (vaul) sur mobile via le hook `useIsMobile()`
- Contenu identique dans les deux cas :
  - Header : logo du ticker + nom + prix actuel + variation du jour
  - Selecteur de periode : boutons `1S | 1M | 3M | 6M | 1A | 5A`
  - Graphique : `AreaChart` recharts avec gradient, affichant le cours de cloture historique
  - Tooltip personnalise sur hover avec date + prix
- Donnees : appel direct a Yahoo Finance v8 (`/v8/finance/chart/{ticker}?range=X&interval=Y`) via `fetchHistoricalPricesClientSide` ou un appel direct similaire
- Mapping des periodes vers les parametres Yahoo :
  ```text
  1S  -> range=5d,  interval=15m
  1M  -> range=1mo, interval=1d
  3M  -> range=3mo, interval=1d
  6M  -> range=6mo, interval=1d
  1A  -> range=1y,  interval=1wk
  5A  -> range=5y,  interval=1wk
  ```

### 2. Modification de `TopMovers`
- Ajouter un state `selectedTicker` (string | null)
- Rendre chaque `MoverRow` cliquable (cursor-pointer + onClick)
- Afficher `TickerChartPopup` quand `selectedTicker` est set
- Passer les infos du ticker selectionne (ticker, nom, prix, variation, devise) au popup

### 3. Fichiers concernes

| Fichier | Action |
|---|---|
| `src/components/TickerChartPopup.tsx` | Creer - composant popup/drawer avec graphique |
| `src/components/TopMovers.tsx` | Modifier - ajouter onClick + state + affichage du popup |

## Details techniques

### Fetching des donnees historiques dans le popup
- Appel direct a Yahoo v8 depuis le navigateur (meme pattern que `fetchTickerBrowser` dans `yahooFinance.ts`)
- Utilisation de `useState` + `useEffect` pour charger les donnees au changement de periode
- Skeleton/spinner pendant le chargement
- Le graphique colore en vert si le cours est en hausse sur la periode, en rouge sinon

### Design du graphique
- `AreaChart` recharts avec fond gradient (vert ou rouge selon la tendance)
- Axes minimalistes (dates en bas, prix a droite)
- Tooltip sombre avec date formatee + prix + devise
- Hauteur fixe ~250px sur mobile, ~300px sur desktop

