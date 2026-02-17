

## Corriger la Watchlist : afficher le PER et verifier le fair price

### Problemes identifies

1. **Edge Function `fetch-prices` cassee** : Le fichier est tronque apres le mode "fundamentals". Il manque tout le code du mode par defaut (recuperation des prix). C'est la cause de l'erreur de build.

2. **Le PER n'est pas affiche** : L'appel `useFundamentals` dans la Watchlist invoque `fetch-prices` avec `mode: "fundamentals"`, mais la reponse contient `price`/`previousClose` au lieu de `trailingPE`/`trailingEps`. Cela signifie que le mode fundamentals n'est pas atteint correctement, probablement parce que la fonction deployee est l'ancienne version complete (sans le mode fundamentals) ou que la version actuelle ne compile pas.

3. **Formule de fair price** : La formule dans `calculateFairPrice` est correcte mathematiquement :
   - `futureEps = EPS * (1 + croissance)^annees`
   - `futureValue = futureEps * PE_terminal`
   - `fairPrice = futureValue / (1 + rendement_min)^annees`
   - `upside = (fairPrice / prix_actuel - 1) * 100`

   C'est un modele DCF simplifie standard. Pas de correction necessaire.

### Changements prevus

#### 1. Restaurer `supabase/functions/fetch-prices/index.ts`

Reecrire le fichier complet avec :

- **Mode "fundamentals"** (existant) : Utilise `yahooFinance.quote()` pour recuperer EPS, PE, prix, devise, nom, secteur. Retourne ces donnees dans le champ `results`.

- **Mode par defaut (prix)** : Restaurer le code manquant qui :
  - Recupere les prix actuels via `yahooFinance.quote()` en batches de 5
  - Met a jour le cache dans la table `assets_cache` (upsert avec prix, nom, devise, previous_close)
  - Retourne les prix dans le format `{ price, previousClose, name, currency }`

Le code du mode par defaut sera reconstruit a partir du pattern observe dans les reponses reseau (le format de sortie `{ results: { TICKER: { price, previousClose, name, currency } } }`) et du pattern de batch processing mentionne dans les notes du projet.

#### 2. Aucun changement dans la Watchlist

La page `Watchlist.tsx` et le hook `useWatchlist.ts` sont deja correctement codes pour afficher le PER (`trailingPE`) et calculer le fair price. Une fois la fonction edge corrigee et deployee, les donnees fondamentales seront correctement recuperees et affichees.

### Details techniques

Le fichier `fetch-prices/index.ts` restaure contiendra :

```text
1. CORS headers
2. Body parsing robuste
3. Mode "fundamentals" -> yahooFinance.quote() -> retourne EPS, PE, prix, etc.
4. Mode par defaut -> yahooFinance.quote() en batches de 5 -> upsert assets_cache -> retourne prix
5. Gestion d'erreurs avec CORS headers sur toutes les reponses
```

La connexion Supabase dans la fonction utilisera les variables d'environnement `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` (disponibles automatiquement dans les edge functions).

