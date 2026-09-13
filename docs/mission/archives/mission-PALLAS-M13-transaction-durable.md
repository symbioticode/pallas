# MISSION — PALLAS-M13 — Transaction durable décision→ordre→ack et persistance atomique de l'état

## 0. Métadonnées
Mission ID : PALLAS-M13
Date de création : 2026-09-10
Auteur / Agent : Claude (planification) — exécution par agent de code au choix
Projet : Pallas
Statut : CLOTUREE — 🔴 préalable bloquant levé (référence : `mission-PALLAS-M13-journal.md`)
Source de vérité : `AUDIT-PALLAS-v0.3.md` (F-01, F-02, section 4.5 "Atomicité et fenêtres de
crash") + `packages/strategy/src/run-reference-loop.ts` + `packages/ledger/`

## 1. Contexte

**Constat de l'audit v0.3, le plus sévère du rapport :** il n'existe aucune transaction durable
commune reliant décision de risque → ordre → accusé exchange → position → ledger. L'audit détaille
quatre fenêtres de crash, chacune laissant le système dans un état différent au redémarrage :
décision perdue avant persistance ; état avancé sans preuve d'ordre ; ordre potentiellement réel
sans trace locale ; ledger tracé sans statut transactionnel clair (`AUDIT-PALLAS-v0.3.md` §4.5,
tableau des 4 fenêtres).

**Aggravant identifié séparément (F-02) :** `loadState` (`run-reference-loop.ts:96`) attrape
indistinctement fichier absent, JSON tronqué et corruption, et retourne silencieusement un état
neuf (`{hist_pnls: []}`). `saveState` fait un `writeFileSync` direct sans temp+rename, sans lock,
sans `fsync` (`run-reference-loop.ts:108`). Deux processus peuvent donc lire le même état, chacun
accepter un ordre, puis écraser l'état de l'autre — et un fichier corrompu (kill switch engagé,
pertes cumulées) redevient silencieusement un état permissif au redémarrage.

**Pourquoi cette mission passe avant toutes les autres (M14-M20) :** la réconciliation des ordres
(M14), le suivi d'exposition (M15) et l'intégrité du ledger (M16) supposent tous qu'on peut faire
confiance à "l'état tel que persisté". Tant que cet état peut être silencieusement réinitialisé ou
corrompu par une écriture concurrente, tout ce qui est construit dessus hérite de la même fragilité.

## 2. Objectif général

Remplacer la persistance actuelle (fichier JSON écrit en une passe, erreurs de lecture avalées) par
un mécanisme transactionnel durable : chaque décision/ordre a un identifiant de corrélation unique,
un cycle de vie d'états explicite, une écriture atomique et verrouillée, et toute corruption détectée
doit arrêter le système plutôt que de repartir silencieusement à zéro.

## 3. Objectifs détaillés

- **Identifiant de corrélation unique** généré avant toute décision, propagé à travers risk engine,
  signature, appel réseau et ledger — permet de retrouver et distinguer chaque tentative même après
  un crash.
- **Machine d'états explicite** par ordre : `DECIDED → SUBMITTING → SUBMITTED/AMBIGUOUS → ACKED →
  TERMINAL (filled/cancelled/rejected)`. L'état est écrit **avant** l'appel réseau (transition vers
  `SUBMITTING`) et mis à jour après (succès, échec net, ou `AMBIGUOUS` sur timeout/5xx — cohérent
  avec `AmbiguousOrderError` déjà existant).
- **Écriture atomique et durable** de l'état : fichier temporaire à nom unique (pas `.tmp` fixe) +
  `fsync` du fichier + `fsync` du répertoire + `rename` atomique. Verrou interprocessus (ex.
  `proper-lockfile` ou flock natif) pour empêcher deux processus d'écrire concurremment.
  Alternative acceptable si mieux adaptée : base transactionnelle embarquée (SQLite avec
  transactions ACID) plutôt qu'un fichier JSON — à évaluer et documenter le choix.
- **Fail-stop sur corruption** : `loadState` doit distinguer explicitement "fichier absent au tout
  premier démarrage" (cas légitime, état neuf) de "fichier présent mais illisible/invalide" (doit
  lever une erreur fatale et refuser de démarrer, jamais repartir silencieusement à zéro). Ajout
  d'un schéma strict de validation à l'entrée (Zod, cohérent avec PALLAS-M04) et d'une
  version/checksum dans le fichier d'état.
- **Aucune émission d'ordre tant qu'une transition d'état n'est pas confirmée durablement écrite** —
  documenter et tester explicitement l'ordre des opérations (état écrit avant réseau, pas après).

## 4. Protocole de validation

**Setup** : `npm test` vert (packages/strategy, packages/ledger) à chaque étape.

**Métriques à capter :**
1. Simuler chacune des 4 fenêtres de crash du tableau `AUDIT-PALLAS-v0.3.md` §4.5 (kill du process à
   chaque étape) et vérifier qu'au redémarrage, le système reconnaît l'état exact où il s'est arrêté
   (pas un état neuf, pas un état avancé sans preuve).
2. Test de concurrence : deux processus lancés simultanément sur le même fichier d'état — un seul
   doit réussir à écrire, l'autre doit attendre ou échouer proprement (pas d'écrasement silencieux).
3. Test de corruption volontaire (tronquer le fichier d'état) → le système doit refuser de démarrer
   avec un message explicite, jamais repartir à zéro silencieusement.

## 5. Procédure / Étapes

### Partie A — Préparation
- Lire `run-reference-loop.ts` en entier, en particulier `loadState`/`saveState` et la séquence
  d'appel autour de `placeOrder`.
- Relire `AUDIT-PALLAS-v0.3.md` §4.5 en entier.

### Partie B — Vérifications préalables
- Reproduire chacune des 4 fenêtres de crash pour confirmer le comportement actuel (baseline) avant
  correction.

### Partie C — Exécution
- Décider et documenter le choix de stockage (fichier + lock + fsync, ou SQLite transactionnel).
- Implémenter la machine d'états et l'identifiant de corrélation.
- Réécrire `loadState`/`saveState` avec fail-stop sur corruption.
- Écrire les tests de crash simulé pour les 4 fenêtres.

## 6. Ce que l'agent doit faire
1. Traiter cette mission comme fondation, pas comme un correctif parmi d'autres — toute décision
   d'architecture ici (fichier vs SQLite) doit être justifiée en pensant à ce que M14/M15/M16
   devront construire par-dessus.
2. Ne jamais introduire une nouvelle voie où un état neuf silencieux redevient possible.
3. Documenter explicitement le choix de mécanisme de verrouillage (flock, lockfile, DB) et ses
   limites connues (ex. verrouillage local seulement, pas distribué — acceptable pour ce stade).

## 7. Critères de succès
- [x] Les 4 fenêtres de crash du tableau de l'audit sont simulées et le système récupère l'état
      exact attendu à chaque fois (testé, pas seulement raisonné).
- [x] Un test de concurrence à deux processus confirme qu'un seul obtient le verrou et écrit,
      jamais d'écrasement silencieux.
- [x] Un fichier d'état corrompu ou tronqué provoque un arrêt fatal explicite au démarrage, jamais
      un état neuf silencieux — testé.
- [x] Chaque décision/ordre porte un identifiant de corrélation unique traçable de bout en bout
      (risk engine → signature → réseau → ledger).
- [x] `npm test` reste vert, aucune régression sur les tests existants (M01, M04, M12).
      **Valeur : 170/170 tests verts.**

## 8. Interdictions
- Ne pas garder `writeFileSync` direct sans lock/fsync/rename atomique sous quelque prétexte que ce
  soit — c'est le cœur du problème identifié.
- Ne pas avaler silencieusement une erreur de lecture d'état pour "faire simple" — toute ambiguïté
  doit être fatale et explicite, jamais un état neuf par défaut au-delà du tout premier démarrage.
- Ne pas commencer M14/M15/M16 avant que les critères de succès de cette mission soient vérifiés.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M13-journal.md`, avec preuve d'exécution des 4 scénarios de
crash simulé et du test de concurrence.
Livrables : nouveau module de persistance transactionnelle, `run-reference-loop.ts` mis à jour,
tests de crash, section `PLAN.md`/`docs/ARCHITECTURE.md` documentant le mécanisme choisi.
