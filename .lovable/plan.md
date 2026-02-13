

## Amelioration de la lisibilite du graphique de repartition

### Probleme actuel
Le graphique en camembert (pie chart) utilise des labels SVG positionnes autour du graphique. Quand il y a beaucoup d'actifs, les labels se chevauchent et deviennent illisibles. Les logos et textes sont petits et difficiles a lire sur fond sombre.

### Solution proposee
Remplacer les labels SVG par une **legende HTML triee** a droite du donut chart, beaucoup plus lisible et professionnelle (style Linear/Stripe).

### Changements prevus

**Fichier : `src/components/AllocationChart.tsx`**

1. **Donut chart sans labels externes** : Supprimer `label` et `labelLine` du composant `Pie`. Utiliser `innerRadius` pour creer un donut (plus moderne qu'un camembert plein).

2. **Legende HTML triee** : Afficher a droite du graphique une liste verticale triee par poids decroissant, chaque ligne contenant :
   - Un point colore (pastille)
   - Le logo du ticker (via `TickerLogo`)
   - Le nom du ticker
   - Le pourcentage (aligne a droite)

3. **Layout flex** : Utiliser un layout `flex` horizontal avec le donut a gauche (~40%) et la legende a droite (~60%), au lieu du graphique seul centre.

4. **Reduire la hauteur** du conteneur de 400px a 320px pour un rendu plus compact.

5. **Tooltip** : Conserver le tooltip existant au survol des segments.

### Rendu attendu

```text
+----------------------------------------------+
| Par actif                                    |
|                                              |
|    ___                                       |
|   /   \     [logo] NVDA ............ 25.3%   |
|  | donut|   [logo] AAPL ............ 18.1%   |
|   \___/     [logo] MSFT ............ 12.4%   |
|             [logo] AMZN .............  8.7%   |
|                    Autres ...........  5.2%   |
+----------------------------------------------+
```

### Details techniques
- Importer `TickerLogo` pour afficher les logos dans la legende
- Utiliser `ScrollArea` si plus de ~10 items pour eviter le debordement
- Conserver les `BRAND_COLORS` et `FALLBACK_COLORS` existants
- Garder le `CustomTooltip` actuel
