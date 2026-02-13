

## Camembert plein avec labels externes anti-chevauchement

### Objectif
Remplacer le donut + liste deroulante actuel par un **camembert plein** (pie chart) avec des **traits de liaison** (leader lines) vers des labels textuels positionnes autour du graphique, sans chevauchement.

### Approche technique

**Fichier : `src/components/AllocationChart.tsx`**

1. **Supprimer le layout flex donut/legende** : Retirer le `ScrollArea`, la legende HTML a droite, et le layout en deux colonnes. Le camembert occupera toute la largeur.

2. **Camembert plein** : Remettre `innerRadius={0}` pour un vrai camembert. Centrer le graphique dans le conteneur avec un `outerRadius` plus petit (~80) pour laisser de la marge aux labels autour.

3. **Labels SVG custom avec anti-chevauchement** :
   - Utiliser la prop `label` de Recharts avec une fonction `renderCustomLabel` qui dessine :
     - Un trait (`polyline` SVG) du bord de la tranche vers le label
     - Le texte du ticker + pourcentage
   - Implementer un algorithme d'anti-chevauchement :
     - Separer les labels en deux groupes (gauche/droite) selon l'angle du segment
     - Trier les labels de chaque cote par position Y
     - Appliquer un ecart minimum (`minGap` ~18px) entre chaque label
     - Si deux labels sont trop proches, decaler le second vers le bas (ou le haut)

4. **Augmenter la hauteur** a ~420px pour laisser assez d'espace vertical aux labels.

5. **Simplification des donnees** : Garder le regroupement "Autres" pour les petites positions (<2% ou au-dela des 10 premieres) afin de limiter le nombre de labels a ~11 max.

6. **Supprimer les imports inutilises** : `TickerLogo` et `ScrollArea` ne seront plus necessaires.

### Algorithme anti-chevauchement (detail)

```text
Pour chaque cote (gauche, droite) :
  1. Calculer la position Y naturelle de chaque label (basee sur l'angle median du segment)
  2. Trier par Y croissant
  3. Parcourir la liste : si label[i].y - label[i-1].y < minGap, 
     decaler label[i].y = label[i-1].y + minGap
  4. Si les labels debordent en bas, remonter tout le groupe proportionnellement
```

### Rendu attendu

```text
+------------------------------------------------+
| Repartition                                    |
|                                                |
|  NVDA 25% ---\     /--- AAPL 18%              |
|               \   /                             |
|          +-----------+                          |
|          |           |--- MSFT 12%              |
|          |  camembert|                          |
|          |   plein   |--- AMZN 9%              |
|          +-----------+                          |
|               /   \                             |
|  META 7% ---/     \--- Autres 5%               |
+------------------------------------------------+
```

### Ce qui ne change pas
- Les couleurs (`BRAND_COLORS`, `FALLBACK_COLORS`, `getColor`)
- Le `CustomTooltip` au survol
- Le regroupement des petites positions en "Autres"
- Les props du composant (`data`, `positions`, `title`, `groupBy`)
