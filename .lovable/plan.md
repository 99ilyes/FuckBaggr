

# Application de Gestion Multi-Portefeuilles d'Investissements

## Design & Thème
- **Dark mode uniquement**, style minimaliste inspiré de Linear/Stripe
- Typographie épurée, couleurs sombres avec accents subtils (vert pour gains, rouge pour pertes)
- Composants Shadcn/UI (Card, Table, Dialog, Tabs, Select)
- Design responsive

## Architecture Backend (Supabase / Lovable Cloud)
- **Table `portfolios`** : nom, description, type (PEA, CTO, Crypto), couleur
- **Table `transactions`** : type (achat/vente), ticker, quantité, prix unitaire, frais, date, lié au portefeuille, fonction depot retrait et conversion de cash
- **Table `assets_cache`** : ticker, dernier prix, secteur, nom complet, date de mise à jour
- **Edge Function** pour récupérer les prix via Yahoo Finance API et mettre à jour le cache

## Page principale — Dashboard Global
- **KPI Cards** en haut : valeur totale tous portefeuilles, performance globale (%), gain/perte total en €, nombre d'actifs
- **Sélecteur de portefeuille** : switcher entre la vue globale et un portefeuille spécifique
- **Graphique en aires (Area Chart)** : évolution de la valeur du portefeuille dans le temps (TWR - Time Weighted Return)
- **Graphique Donut** : répartition par actif et par secteur

## Gestion des Portefeuilles
- Créer, renommer et supprimer des portefeuilles via un dialogue modal
- Chaque portefeuille affiche ses propres KPIs et graphiques quand sélectionné
- Liste des portefeuilles accessible via un sélecteur/tabs

## Gestion des Transactions
- **Formulaire modal** pour ajouter une transaction : type (achat/vente), ticker, quantité, prix, frais, date
- **Table des transactions** avec tri et filtres par portefeuille
- Possibilité de supprimer une transaction

## Calculs Automatiques
- **PRU (Prix de Revient Unitaire)** calculé automatiquement pour chaque actif en fonction des transactions
- **Plus/moins-values** latentes et réalisées par actif
- **Performance TWR** simulée à partir de l'historique des transactions

## Données Financières (MVP)
- Edge Function Supabase appelant l'API Yahoo Finance pour récupérer les prix en temps réel
- Cache des prix dans la table `assets_cache` pour éviter les appels excessifs
- Rafraîchissement des prix à la demande ou au chargement

