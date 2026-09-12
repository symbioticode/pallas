# MISSION — PALLAS-M06 — CI/CD + documentation sobre

## 0. Métadonnées
Mission ID : PALLAS-M06
Date de création : 2026-09-09
Auteur / Agent : Claude (planification) — exécution par agent de code au choix
Projet : Pallas
Statut : **CLÔTURÉE le 2026-09-09** (exécution : opencode/big-pickle — journal : `mission-PALLAS-M06-journal.md`)
Source de vérité : `AUDIT-PALLAS-v0.1.md` (sections "Cases [ ]", "Dépendances") + `PLAN.md` Phase 5

## 1. Contexte

**Constat de l'audit :** `.github/workflows/` ne contient qu'un `.gitkeep` — aucune pipeline CI
n'existe. Aucun `README.md`, `ARCHITECTURE.md`, `SECURITY.md`, `TRADING.md` n'est suivi dans le
dépôt (le répertoire `docs/` existait localement au moment de l'audit mais n'était pas versionné).
`npm audit` révèle 2 vulnérabilités modérées (path traversal dans Vitest/`@vitest/mocker`,
`GHSA-82fw-gwwq-j7x9`, corrigée en Vitest 5.0.0 — changement majeur à évaluer). `cargo audit` est
propre (0 vulnérabilité sur 48 dépendances).

**Dépendance critique de séquencement :** une CI mise en place maintenant figerait les 2 tests
sandbox rouges (PALLAS-M03) et les lacunes du risk engine (PALLAS-M01) comme un état "normal" si
elle est configurée en mode permissif. Cette mission doit donc suivre, pas précéder, les
corrections critiques — ou explicitement marquer en `allow-failure` les points encore ouverts, avec
une date de retrait de ce statut.

## 2. Objectif général

Mettre en place une CI reproductible qui échoue réellement sur régression (pas de faux vert), et une
documentation sobre alignée avec ce que le code fait réellement — pas ce que `PLAN.md` espérait.

## 3. Objectifs détaillés

- Pipeline GitHub Actions : `npm ci`, `npm run typecheck`, `npm test`, `npm run build`,
  `npm audit --audit-level=high` (le seuil `high` laisse passer les 2 modérées actuelles — décider
  explicitement si c'est acceptable ou si le seuil doit être `moderate`, et documenter le choix).
- Pipeline Rust dans le même workflow (ou un job séparé) : `cargo test` dans l'environnement Nix
  (`nix-shell --run 'cd crates/risk-engine && cargo test'`), et si possible `cargo audit`.
- Décider et documenter le sort de la vulnérabilité Vitest modérée : upgrade vers Vitest 5 (avec
  évaluation de l'impact du changement majeur sur les fichiers de test existants) ou acceptation
  documentée du risque avec justification (outillage de test, pas runtime de production).
- `README.md` sobre : ce que le projet fait réellement aujourd'hui (état MVP, Polymarket uniquement,
  dry-run par défaut), pas de badges marketing, un lien explicite vers `AUDIT-PALLAS-v0.1.md` pour
  la transparence sur l'état de maturité.
- `docs/ARCHITECTURE.md` : reprendre le schéma de `PLAN.md`, avec mention explicite des modules
  vides (gateway, agent, ledger, skills) comme non commencés, pas comme "en cours".
- `docs/SECURITY.md` : politique de reporting + état réel des protections (dry-run, sandbox, gating
  live) avec les réserves de PALLAS-M01/M02/M03/M05 explicitement mentionnées tant qu'elles ne sont
  pas closes.
- `docs/TRADING.md` : comportement attendu en cas de timeout sur un ordre (dépend de PALLAS-M04),
  scope MVP (Polymarket uniquement), et rappel du statut dry-run par défaut.

## 4. Protocole de validation

**Setup** : la CI doit tourner sur un checkout propre (clone frais), pas sur l'environnement de dev
existant qui peut avoir un état différent.

**Métriques à capter :**
1. La CI échoue-t-elle réellement si on réintroduit volontairement un bug simple (ex. un test cassé
   exprès) ? Test de non-régression du pipeline lui-même.
2. Statut `npm audit` avant/après la décision sur Vitest.
3. Chaque document `docs/*.md` relu par quelqu'un qui n'a pas écrit le code, pour vérifier qu'il
   correspond à l'état réel et non à l'état espéré.

## 5. Procédure / Étapes

### Partie A — Préparation
- Vérifier l'état de clôture de PALLAS-M01 à M05 avant de configurer les seuils de la CI (pour ne
  pas figer un état encore bugué comme référence).

### Partie B — Vérifications préalables
- Faire tourner la pipeline localement (ou via `act`/équivalent) avant de la pousser, pour éviter
  les itérations de debug CI-only.

### Partie C — Exécution
- Écrire le workflow, tester le cas d'échec volontaire, puis rédiger la documentation.

## 6. Ce que l'agent doit faire
1. Vérifier l'état des autres missions avant de figer des seuils CI permissifs.
2. Ne pas rédiger de documentation qui décrit un état futur/espéré comme s'il était déjà réel —
   toujours dater et qualifier ("MVP Phase 0-2 seulement", "gateway non commencé").
3. Documenter explicitement toute réserve de sécurité non encore corrigée, avec renvoi vers la
   mission correspondante.

## 7. Critères de succès
- [x] La CI GitHub Actions tourne sur un checkout propre et échoue sur un bug volontaire introduit
      pour le test (preuve que ce n'est pas un pipeline cosmétique).
- [x] `npm audit`/`cargo audit` sont exécutés en CI avec un seuil explicitement justifié dans le
      journal (pas un choix par défaut non discuté).
- [x] `README.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/TRADING.md` sont suivis dans
      git, sobres, et renvoient explicitement vers `AUDIT-PALLAS-v0.1.md`.
- [x] Aucun document ne décrit gateway/agent/ledger/skills comme "en cours" alors qu'ils sont vides.
- [x] Les réserves de sécurité non closes au moment de la rédaction sont listées explicitement dans
      `docs/SECURITY.md` avec renvoi vers la mission correspondante.

## 8. Interdictions
- Ne pas configurer la CI en mode permissif silencieux (`continue-on-error: true` non justifié) sur
  les tests Rust ou TS existants.
- Ne pas publier de documentation qui contredit l'état vérifié par les missions PALLAS-M01 à M05.
- Ne pas réintroduire de badges marketing ("118+ strategies"-style) — un des points explicites de
  `FICHE-LECONS.md` à ne pas reproduire.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M06-journal.md`.
Livrables : `.github/workflows/ci.yml`, `README.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`,
`docs/TRADING.md`, section "Phase 5" de `PLAN.md` mise à jour.
