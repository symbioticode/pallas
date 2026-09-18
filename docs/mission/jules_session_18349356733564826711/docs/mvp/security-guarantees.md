# Garanties de sécurité MVP — brouillon

## Kill switch

Le cycle de référence combine l'état durable et le fichier KILL. Un engagement déclenche le
cancel-all une fois pour la génération courante ; un désengagement réarme durablement une future
génération. La garantie dépend de l'exécution effective du cycle et de la disponibilité de
l'exchange.

## Réconciliation

Les ordres non terminaux sont réconciliés indépendamment de la présence d'un nouveau signal. Les
lectures communes d'ordres et de trades sont partagées par cycle afin de borner le coût réseau.
Les limites d'attribution des fills restent décrites dans `known-limitations.md`.

## Ledger signé

Le mode supervisé exige une clé publique et des checkpoints Ed25519 valides. Le mode développeur
non signé n'offre pas cette garantie et ne doit pas servir de preuve de campagne supervisée.

## Intégrité du runtime de campagne

CT-2026-020 déclare huit SHA-256. Avant toute mutation, `execute.sh` rejette un payload incomplet
ou divergent ; après installation, il contrôle de nouveau les huit copies. Le dry-run contrôle les
huit artefacts présents dans le dépôt.

## À compléter

- modèle de menaces formel ;
- rotation, révocation et garde des clés ;
- matrice garantie / preuve / procédure d'incident.
