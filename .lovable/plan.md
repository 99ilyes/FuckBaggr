
## Réparer complètement la récupération des prix via Yahoo Finance

### Problèmes identifiés

**Problème 1 — Erreur de build bloquante (`fetch-history`)**

`yahooFinance.chart(ticker, { range, interval })` — le paramètre `range` n'existe pas dans l'API TypeScript de `yahoo-finance2@2.13.3`. Il faut remplacer `range` par `period1` (une date calculée à partir de la durée demandée : "5y" → date il y a 5 ans).

**Problème 2 — Mode "fundamentals" cassé (`fetch-prices`)**

Le mode fundamentals retourne `{}` en dur. La Watchlist ne peut donc pas afficher le PER ni l'EPS. Il faut appeler l'API Yahoo Finance Chart ou Quote pour récupérer ces données.

**Problème 3 — Rate limiting persistant (prix)**

`Promise.all` sur 5 tickers simultanément déclenche le blocage Yahoo. La solution est un traitement entièrement séquentiel avec 500ms de pause, sans aucun parallélisme.

---

### Solution

#### 1. `supabase/functions/fetch-history/index.ts`

Remplacer le paramètre `range` par la conversion en `period1` :

```typescript
function rangeToDate(range: string): Date {
  const now = new Date();
  const map: Record<string, number> = { "1y": 1, "2y": 2, "5y": 5, "10y": 10 };
  const years = map[range] ?? 5;
  return new Date(now.getFullYear() - years, now.getMonth(), now.getDate());
}

// Puis :
const result = await yahooFinance.chart(ticker, { 
  period1: rangeToDate(range), 
  interval 
});
```

Cela corrige l'erreur TypeScript et fait compiler le projet.

#### 2. `supabase/functions/fetch-prices/index.ts`

Deux corrections majeures :

**a) Mode "fundamentals" — implémentation réelle**

Utiliser l'API Yahoo Finance v7 (quote summary) via fetch direct pour récupérer les fondamentaux :

```
GET https://query1.finance.yahoo.com/v7/finance/quote?symbols=AAPL&fields=trailingPE,forwardPE,trailingEps,regularMarketPrice,longName,currency,sector
```

Retourner un objet `{ trailingPE, trailingEps, forwardPE, price, name, currency, sector }` par ticker.

**b) Mode prix — traitement entièrement séquentiel**

Remplacer le `Promise.all` par une boucle `for...of` pure avec `await delay(500)` entre chaque ticker :

```typescript
for (const t of uniqueTickers) {
  const data = await fetchTicker(t);
  // traiter la réponse...
  await delay(500);
}
```

Supprimer toute logique de batch (`BATCH_SIZE`, `Promise.all`).

#### 3. `src/lib/yahooFinance.ts`

Aucun changement nécessaire — la logique de fallback cache est déjà en place et fonctionnelle.

#### 4. `src/pages/Index.tsx`

Aucun changement nécessaire.

---

### Fichiers modifiés

| Fichier | Action |
|---------|--------|
| `supabase/functions/fetch-history/index.ts` | Remplacer `range` par `period1` calculé — corrige le build |
| `supabase/functions/fetch-prices/index.ts` | Implémenter le mode fundamentals + séquentiel pur pour les prix |

### Comportement attendu

- **Build** : plus d'erreur TypeScript, le projet compile
- **Bouton Actualiser** : les prix se chargent séquentiellement (500ms entre chaque), le cache DB est mis à jour, l'UI affiche les prix live ou du cache selon disponibilité
- **Watchlist** : le PER et l'EPS sont récupérés via le mode fundamentals
- **Historique** : les graphiques de performance fonctionnent de nouveau
