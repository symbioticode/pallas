# Exploitation MVP — brouillon

## Préconditions

- utiliser le commit résolu par le tag de gel M31 ;
- vérifier une arborescence propre et les huit pins du bundle ;
- configurer le mode dry-run et les clés de ledger supervisé ;
- relire le runbook de compromission de clé et tester le chemin KILL ;
- obtenir l'autorisation indépendante propre à la campagne.

## Démarrage contrôlé

1. Exécuter les suites TypeScript, Rust et Clippy.
2. Exécuter `scripts/ct/m30-m27-72h/verify-test.sh`.
3. Exécuter le dry-run du CT et archiver sa sortie.
4. Vérifier qu'aucune campagne concurrente n'est active.
5. Ne lancer qu'après l'approbation prévue par le workflow CT.

## Surveillance et arrêt

À compléter : métriques, seuils d'alerte, fréquence de revue, procédure d'arrêt, conservation des
preuves et responsabilités d'astreinte.

## Reprise

À compléter : contrôle d'intégrité du ledger, réconciliation de démarrage, traitement des ordres
ambigus et conditions de reprise après incident.
