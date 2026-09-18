# Limites connues MVP — brouillon

## F-11 — observation longue

Aucune campagne réelle d'au moins 72 heures n'est créditée à cette baseline. La stabilité, les
incidents, le comportement sur marché actif et les limites de débit doivent être mesurés par une
campagne autorisée séparément.

## Attribution des fills

L'attribution repose encore sur des critères heuristiques lorsque l'identifiant exchange ne suffit
pas. Des ordres semblables exigent une allocation globale non duplicative ou une identité de fill
plus forte.

## Ledger

La re-signature périodique reste une procédure opérateur manuelle. La disponibilité et la rotation
des clés ne sont pas automatisées de bout en bout.

## Dépendances externes

La disponibilité, la latence et les limites de débit des API exchange ne sont pas contrôlées par
Pallas. Les actions d'urgence restent conditionnées par leur accessibilité.

## R-10 — single-flight limité au processus

La mutualisation de `reconcileAllUnresolved` empêche les doublons concurrents à l'intérieur d'un
processus. Deux processus Pallas distincts peuvent néanmoins effectuer simultanément les mêmes
lectures `getOpenOrders` et `getTrades`. Cette limite est acceptée pour le paper trading : elle
peut augmenter le débit de lecture, mais ne duplique ni placement d'ordre ni cancel-all. Une
campagne doit donc interdire les lanceurs concurrents et surveiller le volume de lectures.

## À compléter

- seuils opérationnels issus de F-11 ;
- matrice des modes dégradés ;
- limites de capacité mesurées.
