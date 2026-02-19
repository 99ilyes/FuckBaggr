
## Plan: Import de relevés Saxon/Saxo Bank (format XLSX)

### Objectif
Remplacer l'import CSV générique par un parseur dédié au format d'export Saxon/Saxo Bank (fichier `.xlsx`), capable de lire les colonnes natives du relevé, d'extraire les bons tickers Yahoo Finance depuis le champ `Symbole`, de calculer les frais automatiquement et d'ignorer les lignes non pertinentes (dividendes, intérêts, frais de service).

---

### Analyse du format

#### Colonnes du fichier
| Colonne | Usage |
|---|---|
| `Date d'opération` | Date de la transaction |
| `Type` | Filtre principal (`Opération`, `Transfert d'espèces`, `Montant de liquidités`, etc.) |
| `Événement` | Détail de l'action (`Acheter N @ PRICE CUR`, `Vendre -N @ PRICE CUR`, `Dépôts`, `Retrait`) |
| `Symbole` | Ticker Yahoo + exchange (ex: `PLTR:xnas` → `PLTR`, `SP5C:xpar` → `SP5C`) |
| `Code ISIN de l'instrument` | ISIN pour identification (fallback si ticker absent) |
| `Devise de l'instrument` | Devise native de l'actif (USD, EUR, JPY…) |
| `Montant comptabilisé` | Montant net en EUR effectivement débité/crédité |
| `Taux de change` | Taux EUR/devise de l'actif |

#### Règles de classification

```text
Type = "Opération" AND Événement contient "Acheter"  → buy
Type = "Opération" AND Événement contient "Vendre"   → sell
Type = "Transfert d'espèces" AND Événement = "Dépôts" → deposit
Type = "Transfert d'espèces" AND Événement = "Retrait" → withdrawal
Tout le reste (dividendes, intérêts, frais, Opération sur titres) → IGNORER
```

#### Extraction du ticker Yahoo
Le champ `Symbole` est au format `BASE:exchange` (ex: `PLTR:xnas`). On prend uniquement la partie avant le `:` et on la met en majuscules → `PLTR`.

Cas particulier : `500:xpar` (Amundi S&P 500 Swap) dont le ticker Yahoo est `500.PA`. Le mapping suffix exchange → suffixe Yahoo est :
- `:xpar` → `.PA`
- `:xnas` → (rien, NASDAQ)
- `:xnys` → (rien, NYSE)
- `:xtks` → `.T`
- `:xetr` → `.DE`
- etc.

Pour les ETF EUR sur Euronext, on construira le ticker Yahoo en ajoutant le suffixe marché si la devise est EUR.

#### Calcul des frais
```text
Pour les achats USD : frais = |Montant comptabilisé| - (qty × price_devise × taux_de_change)
Pour les ventes USD  : frais = (qty × price_devise × taux_de_change) - Montant comptabilisé
Pour EUR            : frais = |Montant comptabilisé| - (qty × price_EUR)
```
Si le résultat est négatif ou > 50€ (anormal), on met 0.

#### Lignes à ignorer
- `Type = "Montant de liquidités"` → intérêts, frais de service
- `Type = "Opération sur titres"` → dividendes
- `Transfert d'espèces` avec `Événement` autre que `Dépôts`/`Retrait`
- Lignes avec montant = 0 ou vide

---

### Fichiers à modifier

#### 1. `src/lib/xlsxParser.ts` — Nouveau fichier
Parseur dédié au format Saxo/Saxon :
- Fonction `parseSaxoXLSX(rows: any[][], portfolioId: string)` qui accepte les lignes brutes du fichier Excel (déjà parsées côté navigateur via la lib `xlsx` ou en lisant le fichier comme ArrayBuffer)
- Retourne `Omit<Transaction, "id" | "created_at" | "notes">[]`

**Note technique** : La lib `xlsx` (SheetJS) n'est pas encore installée. Elle sera ajoutée. Alternativement, l'import sera géré via `document--parse_document` côté edge function — mais pour rester 100% client-side et cohérent avec l'architecture existante, on utilisera `SheetJS` (`xlsx` npm package).

#### 2. `src/components/ImportTransactionsDialog.tsx` — Mise à jour
- Accepter `.xlsx` en plus de `.csv`
- Détecter automatiquement le format selon l'extension
- Appeler `parseSaxoXLSX` pour les fichiers `.xlsx`
- Garder `parseCSV` pour les `.csv`
- Afficher dans la preview les colonnes pertinentes : Date, Type, Ticker, ISIN, Quantité, Prix unitaire, Devise, Frais, Total EUR
- Ajouter le `Label "Fichier CSV ou XLSX"`

#### 3. `package.json` — Ajout dépendance
Ajouter `xlsx` (SheetJS) pour lire les fichiers Excel en pur JavaScript côté navigateur, sans backend.

---

### Logique détaillée du parseur

```text
Pour chaque ligne du fichier Excel (hors en-tête) :

1. Lire le "Type" de la ligne
2. Si Type = "Transfert d'espèces" :
   - Si Événement = "Dépôts" → type = "deposit", ticker = null, qty = |Montant|, unit_price = |Montant|, currency = "EUR"
   - Si Événement = "Retrait" → type = "withdrawal", ticker = null, qty = |Montant|, unit_price = |Montant|, currency = "EUR"
   - Sinon → ignorer
3. Si Type = "Opération" :
   - Parser Événement : "Acheter 19 @ 149.00 USD" ou "Vendre -884 @ 5.67 EUR"
   - Extraire qty (valeur absolue), price, devise_event
   - type = "buy" si "Acheter", "sell" si "Vendre"
   - Extraire ticker depuis Symbole (avant ":")
   - Appliquer suffixe marché selon exchange suffix et Devise instrument
   - Calculer fees = |Montant comptabilisé| - |qty × price × taux_de_change| (si > 0 et < 50)
   - currency = Devise de l'instrument
4. Sinon → ignorer

Validation finale :
- qty > 0, price > 0 (sauf deposit/withdrawal), date valide
- Ignorer si qty ou price = NaN
```

---

### Mapping exchange suffix → suffixe Yahoo

| Symbole exchange | Suffixe Yahoo |
|---|---|
| `:xpar` | `.PA` |
| `:xetr` | `.DE` |
| `:xtks` | `.T` |
| `:xlon` | `.L` |
| `:xams` | `.AS` |
| `:xbru` | `.BR` |
| `:xmil` | `.MI` |
| `:xnas`, `:xnys`, `:arcx`, `:bats` | (aucun) |

---

### Comportement du solde cash
L'utilisateur précise qu'il est impossible d'avoir un solde cash négatif. Le parseur inclura une validation qui, en mode preview, affichera une alerte si les transactions importées créeraient un solde négatif à un moment donné. Ce sera un avertissement informatif seulement (pas un blocage) pour que l'utilisateur puisse identifier d'éventuelles lignes manquantes.

---

### Résumé des modifications

| Fichier | Action |
|---|---|
| `src/lib/xlsxParser.ts` | Créer — parseur format Saxo/Saxon |
| `src/components/ImportTransactionsDialog.tsx` | Modifier — accepter XLSX, détecter format, améliorer preview |
| `package.json` | Modifier — ajouter `xlsx` (SheetJS) |

### Aucune modification base de données requise
Le schéma de la table `transactions` est inchangé. Les données sont mappées aux colonnes existantes.
