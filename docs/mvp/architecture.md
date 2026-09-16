# Architecture MVP — brouillon

## Vue d'ensemble

Pallas est un monorepo Node.js/TypeScript complété par un moteur de risque Rust. Le chemin de
référence relie la stratégie, les contrôles de risque, l'adaptateur d'exécution, l'état durable et
le ledger d'audit. L'observatoire fournit une vue opérateur distincte.

## Composants

| Composant | Responsabilité principale |
|---|---|
| `packages/core` | primitives partagées, configuration et écritures atomiques |
| `packages/strategy` | cycle de référence, signal, réconciliation et kill switch |
| `packages/risk` | contrôles de risque côté TypeScript |
| `crates/risk-engine` | décision de risque déterministe côté Rust |
| `packages/execution` | dry-run et client Polymarket |
| `packages/ledger` | chaîne d'événements et checkpoints signés |
| `packages/observatory` | exposition des éléments de supervision |

## Flux de référence

1. Charger et réconcilier l'état durable avec le ledger.
2. Réconcilier les ordres non réglés avec les lectures exchange.
3. Évaluer le signal et les contrôles de risque.
4. Exécuter en dry-run ou via l'adaptateur explicitement configuré.
5. Persister état, événements et preuves opérateur.

## Frontières de confiance

Les réponses exchange, les clés de signature, le fichier KILL, les artefacts compilés et l'état
local sont des entrées de confiance distinctes. Le bundle CT-2026-020 épingle les huit artefacts
runtime déclarés dans son manifeste.

## À compléter

- diagramme de déploiement et responsabilités opérateur ;
- contrats d'interface versionnés ;
- stratégie de reprise et objectifs de disponibilité.
