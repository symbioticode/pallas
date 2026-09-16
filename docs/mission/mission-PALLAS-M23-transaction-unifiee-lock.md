# MISSION — PALLAS-M23 — Transaction unifiée état+ledger, verrou à bail avec propriétaire

## 0. Métadonnées
Mission ID : PALLAS-M23
Date de création : 2026-09-11
Auteur / Agent : Claude (planification) — exécution par Codex
Projet : Pallas
Statut : ACTIF — 🟠 Haute
Dépend de : PALLAS-M21 (base verte), peut avancer en parallèle de PALLAS-M22
Source de vérité : `AUDIT-PALLAS-v0.4.md` (F-01, F-12, section 4.1) +
`packages/core/src/file-lock.ts` + `packages/strategy/src/crash-windows.test.ts`

## 1. Contexte

**Ce qui fonctionne (confirmé par v0.4) :** les 4 fenêtres de crash de PALLAS-M13 passent
dynamiquement, la validation fail-stop distingue bien premier démarrage/corruption, l'écriture est
atomique (temp unique + fsync + rename), la concurrence directe à deux processus conserve 10/10
écritures.

**Deux limites structurelles non résolues, confirmées par lecture de code :**

1. **Pas de transaction ACID commune.** L'état et le ledger sont **deux fichiers distincts, écrits
   séparément** (`run-reference-loop.ts:423` puis `:437` — `store.write` d'abord, `ledger.append`
   ensuite, sans mécanisme qui garantisse que les deux réussissent ou échouent ensemble). Un crash
   entre les deux laisse un état ACKED sans trace ledger correspondante. La fenêtre D est d'ailleurs
   **testée par construction manuelle** d'un `ACKED` (`crash-windows.test.ts:163,175`), pas par un
   vrai crash au milieu d'un appel réseau réel — ce n'est pas une preuve du chemin live, juste une
   preuve que l'état sait représenter cette situation si elle survient.

2. **Verrou repris sur le seul âge du répertoire, sans propriétaire.** `file-lock.ts:42,62` :
   passé `staleMs`, n'importe quel processus peut reprendre un lock, y compris si son détenteur est
   encore vivant mais simplement lent (validation ou E/S longue). Aucun PID, aucun lease, aucun
   heartbeat. Deux writers simultanés restent possibles dans ce scénario, et les limites de
   concurrence deviennent incohérentes.

## 2. Objectif général

Rapprocher la persistance état+ledger d'une garantie transactionnelle réelle (au minimum un pattern
outbox fiable), et remplacer le verrou par âge seul par un mécanisme qui identifie et vérifie
réellement son détenteur.

## 3. Objectifs détaillés

- **Pattern outbox ou écriture combinée** : soit fusionner l'écriture d'état et l'entrée ledger
  correspondante dans une seule opération atomique (un seul fichier/transaction couvrant les deux,
  ou une queue d'écriture — "outbox" — que l'état porte et que le ledger consomme de façon
  idempotente au redémarrage), soit, si les deux fichiers restent séparés pour des raisons déjà
  actées (formats différents, lecteurs différents), documenter précisément la fenêtre de risque
  résiduelle et ajouter une réconciliation au démarrage qui détecte et répare l'incohérence
  (ex. un état ACKED sans ledger correspondant doit être détecté et une entrée de rattrapage émise).
- **Test de crash réel pour la fenêtre D** : remplacer ou compléter la construction manuelle d'un
  `ACKED` par un scénario qui simule un vrai crash au milieu de l'appel réseau (ex. mock qui répond
  puis kill le process avant que le retour ne soit traité), pour prouver le comportement sur le
  chemin réellement emprunté en production, pas seulement sur un état construit à la main.
- **Verrou à bail avec propriétaire** : le lock doit porter un identifiant de détenteur (PID +
  timestamp de démarrage, ou UUID de session) et idéalement un heartbeat périodique tant que
  l'opération protégée est en cours. La reprise après `staleMs` doit vérifier que le détenteur
  précédent est effectivement mort (processus introuvable) avant de reprendre, pas seulement que le
  répertoire est vieux.
- Ajouter un test qui simule explicitement le scénario que l'audit soulève : détenteur du lock
  encore vivant mais lent (E/S longue), un second processus ne doit PAS pouvoir reprendre le verrou
  avant l'expiration réelle, même après `staleMs`.

## 4. Protocole de validation

**Setup** : `npm test` vert à chaque étape, base issue de PALLAS-M21.

**Métriques à capter :**
1. Test qui simule un crash réel entre l'écriture d'état ACKED et l'écriture ledger correspondante
   (pas une construction manuelle) — le comportement au redémarrage doit être défini et testé.
2. Test où le détenteur du lock est vivant mais lent : un second processus ne doit pas reprendre le
   verrou avant l'expiration réelle du détenteur.
3. Confirmation que les 4 fenêtres de crash de PALLAS-M13 restent vertes après ce durcissement.

## 5. Procédure / Étapes

### Partie A — Préparation
- Relire `file-lock.ts` et `crash-windows.test.ts` en entier.
- Décider entre pattern outbox et fusion des fichiers — documenter le choix et pourquoi.

### Partie B — Vérifications préalables
- Reproduire le scénario "détenteur lent mais vivant" pour confirmer que le lock est effectivement
  repris à tort avant correction.

### Partie C — Exécution
- Implémenter le mécanisme choisi pour la transaction état+ledger.
- Ajouter propriétaire + vérification de vivacité au lock.
- Réécrire le test de la fenêtre D pour un scénario de crash réel.

## 6. Ce que l'agent doit faire
1. Ne pas se contenter d'augmenter `staleMs` comme "solution" — ça ne règle pas le problème de fond
   (absence de vérification de vivacité), ça ne fait que déplacer le symptôme.
2. Documenter explicitement le choix d'architecture (outbox vs fusion vs réconciliation de
   rattrapage) avec sa justification, cohérent avec l'esprit déjà posé en PALLAS-M13 §6.
3. Vérifier que le nouveau test de la fenêtre D exerce réellement le chemin de code de production
   (pas un raccourci qui construit l'état directement).

## 7. Critères de succès
- [ ] Un mécanisme de cohérence état+ledger (outbox, fusion, ou réconciliation de rattrapage
      documentée) existe et est testé sur un scénario de crash réel, pas construit manuellement.
- [ ] Le verrou porte un identifiant de détenteur et vérifie sa vivacité avant reprise après
      `staleMs`, testé avec un détenteur lent mais vivant.
- [ ] Les 4 fenêtres de crash de PALLAS-M13 restent vertes.
- [ ] Aucune régression sur `npm test`/`cargo test`.

## 8. Interdictions
- Ne pas se limiter à augmenter les timeouts existants sans traiter la cause (absence de
  vérification de vivacité du détenteur).
- Ne pas remplacer le test manuel de la fenêtre D sans garder au moins un test qui couvre le
  comportement de l'état construit directement (ne pas perdre la couverture existante, l'étendre).

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M23-journal.md`.
Livrables : diffs `file-lock.ts`, mécanisme de cohérence état+ledger, `crash-windows.test.ts` étendu.
