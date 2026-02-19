
# Nouvelle page "Performance" avec graphiques TWR

## Objectif

Créer une page dédiée `/performance` qui affiche l'évolution de la valeur du portefeuille dans le temps via la méthode **Time-Weighted Return (TWR)**, en gérant correctement les devises et en utilisant les cours historiques réels des titres.

---

## Concept TWR appliqué

La TWR neutralise l'impact des flux de trésorerie (dépôts, retraits) pour mesurer uniquement la performance du gérant. Le calcul se fait par sous-périodes délimitées par chaque flux entrant/sortant.

Pour chaque sous-période entre deux flux :
```
R_i = (V_fin / V_début) - 1
```
Puis les périodes sont chaînées :
```
TWR = (1 + R_1) × (1 + R_2) × ... × (1 + R_n) - 1
```

---

## Architecture technique

### 1. Edge Function `fetch-history` — refactoring

L'edge function existante (`supabase/functions/fetch-history/index.ts`) utilise `yahoo-finance2` qui **plante** en production (même problème CORS/library que `fetch-prices`). Elle sera réécrite pour utiliser des appels HTTP directs à Yahoo Finance (même approche que le correctif de `fetch-prices`) :

- Endpoint Yahoo : `query2.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1wk&range=5y`
- Retourne les prix hebdomadaires historiques par ticker
- CORS configuré avec `OPTIONS` retournant `200 OK`

### 2. Hook `useHistoricalPrices` — déjà existant

Le hook dans `usePortfolios.ts` appelle déjà `fetch-history` via `fetch-prices` avec `mode: "history"`. Il faudra le faire pointer vers la nouvelle edge function `fetch-history` (refactorisée).

En réalité l'appel actuel envoie `mode: "history"` à `fetch-prices` mais ce mode n'est pas géré → il tombe dans le default qui ne retourne rien d'utile. On corrigera cela en faisant appeler `fetch-history` directement.

### 3. Calcul TWR côté frontend — nouveau fichier `src/lib/twr.ts`

La logique TWR sera isolée dans un fichier dédié :

```typescript
// Collecte tous les tickers qui ont été ou sont détenus
// Pour chaque tick de temps (hebdomadaire), reconstitue :
//   - La valeur du portefeuille en EUR (positions × cours historique × taux de change)
//   - Les flux nets du jour (dépôts - retraits)
// Calcule TWR par chaînage de sous-périodes
```

**Gestion des devises :**
- Les cours historiques EUR/USD, USD/EUR, etc. seront aussi récupérés
- Chaque position est valorisée dans sa devise native puis convertie en EUR via le cours historique de la paire FX au même timestamp
- On prend `EURUSD=X` (ou autre paire pertinente) en historique hebdomadaire

### 4. Nouvelle page `src/pages/Performance.tsx`

Composants visuels :
- **Sélecteur de portefeuille** (réutilise `PortfolioSelector`) + bouton "Total"
- **Sélecteur de plage temporelle** : 6M | 1A | 2A | 5A | Max
- **Graphique principal (AreaChart Recharts)** : évolution de la valeur du portefeuille en EUR + courbe TWR en %
- **KPIs en haut** : TWR total, annualisé, valeur actuelle vs investissements
- **Graphique par portefeuille** (quand "Total" est sélectionné) : courbes superposées

### 5. Ajout dans la sidebar et le routeur

- Nouvelle entrée dans `AppSidebar.tsx` avec l'icône `TrendingUp`
- Nouvelle `Route` dans `App.tsx` : `path="/performance"`

---

## Détail des fichiers à créer/modifier

| Fichier | Action | Description |
|---|---|---|
| `supabase/functions/fetch-history/index.ts` | Réécriture | HTTP direct Yahoo, CORS fix, intervalles hebdo |
| `src/lib/twr.ts` | Création | Logique TWR + reconstitution historique portfolio |
| `src/pages/Performance.tsx` | Création | Page complète avec graphiques |
| `src/hooks/usePortfolios.ts` | Modification | `useHistoricalPrices` pointe vers `fetch-history` |
| `src/components/AppSidebar.tsx` | Modification | Ajout lien "Performance" |
| `src/App.tsx` | Modification | Ajout route `/performance` |

---

## Algorithme TWR détaillé

```
1. Récupérer tous les tickers uniques des transactions (buy + sell)
2. Récupérer l'historique hebdomadaire Yahoo pour chaque ticker (+ paires FX nécessaires)
3. Créer une timeline hebdomadaire de t=première_transaction à t=aujourd'hui
4. Pour chaque semaine t :
   a. Calculer les positions détenues à t (replay des transactions jusqu'à t)
   b. Calculer la valeur V(t) = Σ (quantité_i × cours_historique_i(t) × taux_fx(t)) + cash(t)
   c. Identifier les flux nets F(t) de la semaine (dépôts - retraits)
5. Calculer TWR :
   - Avant chaque flux : R_i = V(t_flux) / (V(t_flux-1) + F(t_flux-1)) - 1
   - TWR = Π(1 + R_i) - 1
6. Construire la série temporelle : valeur en EUR + TWR cumulé
```

**Gestion des tickers sans historique** : si un ticker n'a pas de cours pour une semaine donnée (weekend, données manquantes), on utilise le dernier cours connu (forward-fill).

---

## Points de vigilance

- **Devises** : chaque ticker a sa devise native (EUR, USD, etc.). On récupère les historiques FX (ex : `EURUSD=X`) pour convertir en EUR semaine par semaine, pas juste avec le taux actuel.
- **Tickers fermés** : les titres vendus doivent quand même avoir leur historique récupéré jusqu'à la date de vente.
- **Performance par portefeuille** : le TWR est calculé indépendamment par portefeuille, chacun dans sa devise, puis converti en EUR pour comparaison.
- **Données manquantes** : la `fetch-history` edge function sera robuste (timeout 5s par ticker, forward-fill des données).
