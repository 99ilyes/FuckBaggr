

## Earnings Tracker -- Nouvelle page avec menu lateral

### Vue d'ensemble

Transformer l'application mono-page en application multi-pages avec un menu lateral (sidebar), et ajouter une page "Earnings Tracker" permettant de suivre les resultats trimestriels des entreprises detenues en portefeuille.

---

### 1. Creer la table `earnings` dans la base de donnees

Nouvelle table avec les colonnes suivantes :

| Colonne | Type | Notes |
|---------|------|-------|
| `id` | uuid (PK) | gen_random_uuid() |
| `ticker` | text | NOT NULL |
| `quarter` | text | Ex: "Q1 2025" |
| `revenue_growth` | numeric | Croissance du CA en % |
| `operating_margin` | numeric | Marge OP en % |
| `roe` | numeric | ROE en % |
| `debt_ebitda` | numeric | Ratio Dette/EBITDA |
| `moat` | boolean | default false |
| `status` | text | 'hold', 'alleger', 'sell' -- default 'hold' |
| `notes` | text | Optionnel |
| `created_at` | timestamptz | default now() |
| `updated_at` | timestamptz | default now() |

La colonne "Criteres valides /5" sera **calculee dynamiquement** cote frontend (pas stockee en base) en comptant les criteres respectes :
- Croissance CA > 10%
- Marge OP > 20%
- ROE > 30%
- Dette/EBITDA < 1.5
- Moat = true

RLS : politique ouverte (coherent avec les tables existantes).

---

### 2. Ajouter un layout avec sidebar

Transformer `App.tsx` pour integrer un `SidebarProvider` et un composant `AppSidebar` avec deux entrees :
- **Dashboard** (route `/`) -- la page actuelle
- **Earnings Tracker** (route `/earnings`)

Le sidebar utilisera les composants Shadcn existants (`Sidebar`, `SidebarMenu`, etc.) et le composant `NavLink` deja present dans le projet.

---

### 3. Creer la page Earnings Tracker

Nouvelle page `src/pages/EarningsTracker.tsx` contenant :
- Un **tableau** affichant toutes les entrees earnings avec les colonnes :
  - Ticker (avec logo via `TickerLogo`)
  - Trimestre
  - Croissance CA (%) -- vert si > 10%, rouge sinon
  - Marge OP (%) -- vert si > 20%, rouge sinon
  - ROE (%) -- vert si > 30%, rouge sinon
  - Dette/EBITDA -- vert si < 1.5, rouge sinon
  - Moat -- vert si oui, rouge sinon
  - Criteres valides /5 -- badge colore selon le score
  - Statut -- badge hold/alleger/sell
- Un bouton **"Ajouter"** ouvrant un dialog pour saisir une nouvelle entree
- Possibilite de **modifier** et **supprimer** des entrees existantes
- Filtrage possible par ticker

---

### 4. Fichiers a creer / modifier

| Fichier | Action |
|---------|--------|
| Migration SQL | Creer la table `earnings` |
| `src/components/AppSidebar.tsx` | Nouveau -- composant sidebar |
| `src/components/AppLayout.tsx` | Nouveau -- layout avec sidebar + contenu |
| `src/pages/EarningsTracker.tsx` | Nouveau -- page Earnings Tracker |
| `src/components/AddEarningsDialog.tsx` | Nouveau -- dialog d'ajout/edition |
| `src/components/EarningsTable.tsx` | Nouveau -- tableau avec mise en forme conditionnelle |
| `src/hooks/useEarnings.ts` | Nouveau -- hooks CRUD pour la table earnings |
| `src/App.tsx` | Modifier -- ajouter le layout sidebar et la route `/earnings` |
| `src/pages/Index.tsx` | Modification mineure -- retrait du header standalone (integre dans le layout) |

---

### Details techniques

**Mise en forme conditionnelle** : chaque cellule de critere utilisera une couleur de fond/texte conditionnelle :
- Critere valide : texte vert (`text-emerald-500`) + icone check
- Critere non valide : texte rouge (`text-rose-500`) + icone X

**Badge Criteres /5** : couleur graduee selon le score (0-1 rouge, 2-3 orange, 4-5 vert).

**Badge Statut** :
- Hold : badge neutre/bleu
- Alleger : badge orange/warning
- Sell : badge rouge/destructive

**Tickers disponibles** : le selecteur de ticker dans le dialog d'ajout listera les tickers uniques provenant des transactions existantes pour faciliter la saisie.

