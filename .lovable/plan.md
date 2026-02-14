

## Adaptation mobile du graphique de repartition

### Probleme
Sur mobile (390px de large), le camembert avec les traits de legende deborde completement :
- Les labels a gauche sortent de l'ecran
- Les traits se croisent et se superposent
- Le rayon du camembert (105px) et l'offset des labels (160px) sont fixes et ne s'adaptent pas a la largeur

### Solution
Sur mobile, basculer automatiquement vers un **donut compact + legende HTML en dessous** (pas de traits SVG). Sur desktop, conserver le camembert plein avec traits.

### Changements dans `src/components/AllocationChart.tsx`

1. **Detecter le mobile** avec le hook `useIsMobile()` deja present dans le projet (`src/hooks/use-mobile.tsx`, breakpoint 768px).

2. **Mode mobile** (< 768px) :
   - Donut chart compact (`innerRadius={40}`, `outerRadius={80}`) sans labels SVG (`label={false}`)
   - Legende HTML en grille 2 colonnes sous le graphique : pastille couleur + ticker + pourcentage
   - Hauteur du conteneur reduite a 380px (200px donut + ~180px legende)
   - Pas de `ScrollArea`, juste un `flex-wrap` pour la legende

3. **Mode desktop** (>= 768px) :
   - Aucun changement : camembert plein avec traits et algorithme anti-chevauchement actuel

4. **Regroupement "Autres"** sur mobile : les positions < 2% ou au-dela du top 10 sont fusionnees pour limiter les entrees de la legende

### Rendu mobile attendu

```text
+---------------------------+
| Par actif                 |
|                           |
|        ___                |
|       /   \               |
|      | donut|             |
|       \___/               |
|                           |
| * NVDA  25%  * AAPL  18% |
| * MSFT  12%  * AMZN   9% |
| * META   7%  * TSLA   5% |
| * Autres 4%              |
+---------------------------+
```

### Details techniques
- Import `useIsMobile` depuis `@/hooks/use-mobile`
- Rendu conditionnel : `isMobile ? <MobileLayout /> : <DesktopLayout />` dans le return du composant
- La legende mobile utilise `getColor()` pour la pastille et affiche `item.pct%`
- Le tooltip Recharts reste actif dans les deux modes

