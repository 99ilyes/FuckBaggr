
## Corriger le rate limiting Yahoo Finance dans `fetch-prices`

### Probleme identifie

Les logs de l'edge function montrent clairement l'erreur :
```
SyntaxError: Unexpected token 'T', "Too Many Requests\r\n" is not valid JSON
```

La fonction actuelle utilise `Promise.all` pour appeler Yahoo Finance sur **tous les tickers en parallele simultanement** (18 tickers d'apres les logs). Yahoo Finance detecte cela comme du scraping agressif et bloque les requetes avec un HTTP 429 (Too Many Requests).

### Solution : Traitement sequentiel avec delai

Remplacer `Promise.all(uniqueTickers.map(...))` par un **traitement sequentiel avec une pause de 300-400ms entre chaque ticker**. C'est le seul moyen fiable de contourner le rate limiting de Yahoo Finance dans un environnement serverless.

La meme correction s'applique au mode "fundamentals" qui utilise aussi une boucle for sequentielle mais sans delai.

### Changements prevus

#### `supabase/functions/fetch-prices/index.ts`

1. **Mode par defaut (prix)** :
   - Remplacer `await Promise.all(promises)` par une boucle `for...of` sequentielle
   - Ajouter `await delay(350)` entre chaque ticker
   - Continuer meme en cas d'erreur sur un ticker (ne pas interrompre la boucle)

2. **Mode "fundamentals"** :
   - La boucle `for...of` est deja sequentielle, mais sans delai
   - Ajouter `await delay(350)` entre chaque appel pour eviter le rate limiting
   - Cela ralentit un peu, mais garantit que les donnees arrivent

3. **Fonction utilitaire `delay`** :
   ```typescript
   const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
   ```

### Impact sur les performances

Avec 18 tickers et 350ms de delai, le temps total de la requete sera ~6.3 secondes. C'est acceptable car :
- L'interface affiche les donnees du cache en attendant
- Le refresh se fait en arriere-plan
- C'est bien meilleur que l'etat actuel ou 0 tickers sont mis a jour

### Fichier modifie

| Fichier | Action |
|---------|--------|
| `supabase/functions/fetch-prices/index.ts` | Modifier le traitement parallele en sequentiel avec delai |

Aucun changement cote frontend necessaire.
