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

## À compléter

- seuils opérationnels issus de F-11 ;
- matrice des modes dégradés ;
- limites de capacité mesurées.
