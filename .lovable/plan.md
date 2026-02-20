

## Page isolee /test-import -- Parseur XLSX de transactions Saxo Bank

### Objectif
Creer une page standalone a `/test-import`, sans lien dans la navigation, sans ecriture en base, sans impact sur le state global. Elle permet d'uploader un fichier XLSX, de le parser en memoire selon des regles strictes, et d'afficher le resultat dans un DataTable.

---

### Fichiers a creer / modifier

| Fichier | Action |
|---|---|
| `src/pages/TestImport.tsx` | Creer -- page complete (upload, parsing, affichage) |
| `src/App.tsx` | Modifier -- ajouter route `/test-import` hors AppLayout |

Aucun autre fichier modifie. Aucun lien dans la sidebar. Aucune ecriture en base.

---

### Interface Transaction

```text
TestTransaction {
  date: string              // ISO 8601 (YYYY-MM-DD)
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'BUY' | 'SELL' | 'DIVIDEND'
  symbol?: string           // Ticker Yahoo Finance formate
  quantity?: number          // Valeur absolue
  price?: number            // Prix unitaire extrait de Evenement
  amount: number            // Montant comptabilise (EUR)
  currency: string          // Devise de l'instrument
  exchangeRate: number      // Taux de change
}
```

---

### Regles de parsing (ligne par ligne)

1. **Transfert d'especes** : `DEPOSIT` si montant > 0, `WITHDRAWAL` si montant < 0
2. **Operation** : `BUY` si montant < 0, `SELL` si montant > 0. Extraction qty/price via regex sur Evenement (ex: `Acheter 3 @ 88.00 USD`, `Vendre -1 @ 1,212.00 EUR`). Quantites en valeur absolue.
3. **Operation sur titres** + "Dividende en especes" dans Evenement : `DIVIDEND`
4. **Lignes ignorees** : montant = 0 ou vide, types non reconnus (interets, transferts entrants/sortants a montant 0, frais de service)
5. **Tri** : chronologique croissant par date

### Formatage des symboles

| Suffixe source | Remplacement |
|---|---|
| `:xams` | `.AS` |
| `:xpar` | `.PA` |
| `:xdus` | `.DE` |
| `:xmil` | `.MI` |
| `:xnas` | (supprime) |
| `:xnys` | (supprime) |

### Affichage

- **Tableau des transactions** : colonnes Date, Type, Symbole, Quantite, Prix unitaire, Montant net, Devise
- Badges colores par type (BUY en bleu, SELL en rouge, DEPOSIT en vert, WITHDRAWAL en orange, DIVIDEND en violet)
- Compteur de lignes parsees / ignorees en haut

### Details techniques

- Utilise `xlsx` (SheetJS) deja installe, avec `cellDates: true` et `raw: true`
- Parsing de date robuste (Date object, serial Excel, strings DD-Mon-YYYY)
- Regex pour extraction qty/price : `/(?:Acheter|Vendre)\s+([-\d,.\s]+)\s*@\s*([\d,.\s]+)\s+([A-Z]+)/i`
- Route ajoutee dans App.tsx hors du `<AppLayout />` pour rester isolee (pas de sidebar)
- Zero dependance nouvelle, zero ecriture DB

