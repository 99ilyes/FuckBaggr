

## Import IBKR -- Mapping coherent vers la base de donnees et reconstruction des KPIs

### Probleme actuel

Le mapping IBKR vers la base de donnees presente plusieurs incoherences :

1. **FOREX mappe en deposit/withdrawal** : Les 411 transactions FOREX (conversions EUR/USD) sont actuellement transformees en `deposit`/`withdrawal`, ce qui **gonfle artificiellement le montant "Investi"** dans les KPIs (72k EUR de depots fictifs au lieu de ~72k reels)
2. **Dividendes negatifs (retenues d'impots)** mappe en `withdrawal` -- devrait rester `dividend` avec montant negatif
3. **Interets et frais** melanges avec les depots/retraits reels
4. **`calculateCashBalances`** ne gere pas le type `interest`

### Solution

Transformer les FOREX en `conversion` (type deja supporte par la DB et par `calculateCashBalances`) et corriger le mapping des dividendes/interets.

---

### Fichiers modifies

| Fichier | Changement |
|---|---|
| `src/lib/ibkrParser.ts` | Distinguer `INTEREST` des depots/retraits dans la section "interet" |
| `src/components/ImportTransactionsDialog.tsx` | Recrire `mapTestTransactionToParsed` pour grouper les FOREX en `conversion` |
| `src/lib/calculations.ts` | Ajouter le type `interest` dans `calculateCashBalances` |

---

### Details techniques

#### 1. Parser IBKR (`ibkrParser.ts`)

- Ajouter le type `INTEREST` dans `TestTransaction.type`
- Section "interet" : mapper en `INTEREST` au lieu de `DEPOSIT`/`WITHDRAWAL`
- Section "frais" : garder en `WITHDRAWAL` (ce sont bien des sorties de cash)

#### 2. Mapping FOREX vers conversion (`ImportTransactionsDialog.tsx`)

Post-traitement des paires FOREX consecutives :
- Grouper les transactions FOREX par date (paires positif/negatif)
- Pour chaque paire : creer UNE transaction `conversion` avec :
  - `ticker` = devise source (celle avec montant negatif, ex: "USD")
  - `currency` = devise cible (celle avec montant positif, ex: "EUR")
  - `quantity` = montant recu (positif)
  - `unit_price` = taux de change (montant source / montant cible)
  - `fees` = commissions associees
- Les transactions FOREX de commission (3eme ligne) sont absorbees dans les frais

Exemple concret du fichier :
```text
FOREX: -49,182 EUR  +  51,580.61 USD  +  -1.91 USD commission
  --> conversion: ticker="EUR", currency="USD", quantity=51580.61, unit_price=0.9535 (49182/51580.61), fees=1.91
```

#### 3. Calcul cash (`calculations.ts`)

Ajouter dans `calculateCashBalances` :
```text
interest : balances[currency] += quantity * unit_price
```

#### 4. Impact sur les KPIs du dashboard

Avec ces changements :
- **"Investi"** ne comptera que les vrais DEPOSIT/WITHDRAWAL (pas les conversions)
- **Cash par devise** sera correctement calcule via les conversions
- **Performance** sera correcte car basee sur vrais flux entrants/sortants
- Les positions (BUY/SELL) restent inchangees
- Les dividendes (positifs et negatifs/taxes) alimentent correctement le cash

