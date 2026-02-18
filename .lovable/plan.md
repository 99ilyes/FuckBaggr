
## Corriger le rafraîchissement des prix en production

### Diagnostic précis

Les logs analytics confirment le problème :
- La edge function `fetch-prices` répond en **~10 secondes** avec **0 tickers mis à jour**
- Yahoo Finance renvoie "Too Many Requests" dès le 2e appel car **les edge functions Supabase partagent la même IP publique** avec des milliers d'autres projets — le quota Yahoo est donc épuisé en permanence

Le délai de 350ms entre les appels ne suffit pas car le rate limiting Yahoo est basé sur l'IP, pas sur la fréquence. L'IP des edge functions est déjà blacklistée.

### Solution : Architecture cache-first

Au lieu de contourner le rate limiting (impossible sur une IP partagée), on change d'architecture :

1. **La edge function ne fait plus de fetch Yahoo à la demande** — elle lit simplement le cache en base et le retourne instantanément
2. **Un job de rafraîchissement asynchrone** appelle Yahoo avec retry et backoff exponentiel, et met à jour le cache
3. **Côté UI**, le bouton "Actualiser" déclenche le job et affiche immédiatement les données du cache

Cependant, cette architecture est complexe. La solution la plus simple et rapide est :

### Solution retenue : Utiliser directement le cache Supabase

**Le vrai problème côté frontend** : `fetchPricesClientSide` (via proxy ou edge function) retourne `{ price: null }` pour tous les tickers, ce qui fait que le `livePriceMap` ne se remplit jamais. La page affiche donc `null` partout.

**Fix** : Afficher les prix du cache `assets_cache` directement (déjà présent dans le code via `effectiveAssetsCache`), et ne déclencher le refresh Yahoo que si le cache est vieux de plus de 30 minutes. Si Yahoo échoue, rester sur le cache.

**Changements concrets :**

#### 1. `supabase/functions/fetch-prices/index.ts`

Réécrire la logique de retry avec **backoff exponentiel** et **une seule tentative par ticker** :
- Si Yahoo répond "Too Many Requests", attendre 2s et réessayer une fois
- Si le 2e essai échoue, retourner le prix du cache `assets_cache` existant (fallback)
- Cela garantit que même quand Yahoo rate-limite, la fonction retourne quand même des données valides depuis le cache

#### 2. `src/lib/yahooFinance.ts`

Supprimer la détection du proxy (inutile en prod, ajoute un délai de 3s au démarrage) :
- En production, aller directement à l'edge function sans tenter le proxy d'abord

#### 3. `src/pages/Index.tsx`

Améliorer `handleRefreshPrices` :
- Après l'appel à `fetchPricesClientSide`, si 0 prix sont retournés, **refetch le cache Supabase** et utiliser ses valeurs
- Ajouter un toast informatif en cas d'échec Yahoo (au lieu de silencieusement ne rien afficher)
- Ne pas bloquer l'UI — afficher toujours les dernières données disponibles (cache DB)

### Fichiers modifiés

| Fichier | Changement |
|---------|-----------|
| `supabase/functions/fetch-prices/index.ts` | Ajouter fallback vers `assets_cache` si Yahoo échoue |
| `src/lib/yahooFinance.ts` | Supprimer la détection proxy qui prend 3s pour rien en prod |
| `src/pages/Index.tsx` | Utiliser le cache DB comme fallback si 0 prix reçus depuis Yahoo |

### Comportement attendu après le fix

- **Bouton Actualiser** → tente Yahoo, si échec → affiche les prix du cache DB (avec date de dernière MAJ)
- **Au chargement** → affiche immédiatement les prix depuis `assets_cache` (instantané, pas d'attente Yahoo)
- **Si Yahoo fonctionne** → prix mis à jour, cache DB mis à jour, UI affichée avec les nouvelles valeurs
