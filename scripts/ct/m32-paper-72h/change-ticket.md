# CT-2026-020-PALLAS-R1 — campagne paper trading supervisée 72 h

| Champ | Valeur |
|---|---|
| CT interne | `CT-2026-020` (Pallas) |
| Identifiant global KBM+/runner | `CT-2026-020-PALLAS-R1` |
| Statut initial | PROPOSED — approbation GPG obligatoire |
| Risque | Medium |
| Cible | `nixos`, utilisateur `andrei` |
| Baseline | tag `pallas-mvp-freeze-1`, commit `e69d7542f79ff3e6a24df60773147a6a2f400986` |
| Capital réel | Hors périmètre, interdit |

## Justification et historique

L'audit Pallas v0.6 autorise une campagne paper trading supervisée après matérialisation du bundle.
Une tentative ad hoc M32 a tourné environ 8 h 27 puis a disparu lors de la fin de son environnement
d'exécution, sans résumé final. Ce ticket remplace cette exécution non gouvernée par le workflow
CT signé et une unité utilisateur détachée.

L'identifiant global porte le suffixe `-PALLAS`, car `CT-2026-020` a déjà été attribué et archivé
pour SUBSTRAT-BENCH. Cette qualification évite toute collision de provenance.

La première publication `CT-2026-020-PALLAS` a été invalidée avant exécution : un agent a
déclenché la signature GPG sans geste humain. La présente révision exige que l'approbateur réalise
lui-même l'action d'approbation depuis l'interface `/resources/`.

## Périmètre

- matérialiser et vérifier les huit artefacts runtime du manifeste Pallas ;
- lancer 4 320 minutes, intervalle 30 s, dry-run strict ;
- ledger supervisé, checkpoint signé toutes les 6 h ;
- incident SIGKILL contrôlé vers 40 % et reprise par le superviseur ;
- conserver intégralement logs, ledger, état et métriques.

## Préconditions

- HEAD exactement égal au tag figé et arbre suivi propre ;
- aucun processus Pallas concurrent ;
- clés de ledger présentes avec permissions 0600/0644 ;
- huit SHA-256 conformes avant et après installation ;
- test VERIFY positif/négatif vert.

## Rollback

SIGTERM puis SIGKILL borné aux PID Pallas, re-signature finale par le wrapper lorsque possible,
conservation des preuves. Aucun ordre réel n'est émis.

## Critères d'acceptation

- AC-020-01 : wrapper vivant et seed signé ;
- AC-020-02 : ledger vérifiable avec la clé publique ;
- AC-020-03 : manifeste de campagne en dry-run strict ;
- AC-020-04 : chaîne de checkpoints amorcée.

F-11 ne sera fermé qu'après 72 h effectivement atteintes ; le succès initial du CT atteste le
lancement gouverné, pas l'achèvement de la campagne longue.
