# JOURNAL — PALLAS-M11 — CI réelle documentée, documentation committée, PLAN.md zéro contradiction

> Clôturée le 2026-09-10. Tous les critères de succès COCHÉS. La CI tourne réellement et est
> VERTE sur GitHub Actions (pas de simulation locale) ; la documentation est committée et poussée
> depuis M07 ; `PLAN.md` est exempt de contradiction (6 nettoyées, relecture croisée effectuée) ;
> clippy **résolu** (ajouté au `shell.nix` + run propre `-D warnings`).

## 1. Synthèse

M11 clôt la dette-ci de l'audit v0.2 (§1.4, §3.3, §4.1). L'investigation confirme d'abord trois
constats déjà acquis avant la mission : CI réelle VERTE (commits M06→M10), documentation
committée, README qualifié. Restaient donc : le nettoyage de `PLAN.md` (contradictions internes
inventoriées : case CI `[ ]`, compteurs Rust 37/50/54 mélangés, sandbox « 9/9 » + TS « 84/84 »
obsolètes, vitest « rouge », Phase 5 décrivant une CI « pas de nix ») et la décision clippy
(toujours absente du `shell.nix`). Le tout est réglé ci-dessous. 6 contradictions sont éliminées,
4 instantanés datés sont conservés en tant qu'historique explicite. Les compteurs de tests sont
re-pris à la source (thermomètre vitest JSON, cargo test) et non recopiés.

## 2. Vérifications préalables (protocole § Partie B)

Rélecture de `AUDIT-PALLAS-v0.2.md` §1.4 / §3.3 / §4.1 : 96/99 TS (3 échecs sandbox),
50/50 Rust, 95,92 % lignes, « CI jamais tournée », « docs non commitées au HEAD audité »,
contradictions PLAN.md §2.3, « isolation réseau prouvée sans qualification » (README).

État réel au 2026-09-10, source par source :
- **CI réelle** : `.github/workflows/ci.yml` commité + poussé ; runs observés sur GitHub Actions —
  VERTs (liste au §5). Le run initial CI-Nix `3429c8f` a volontairement échoué (preuve de
  non-régression demandée en M06) puis corrigé par `a07c9a8` ✅.
- **Docs commitées** : `git ls-files` → ci.yml, README.md, docs/ARCHITECTURE.md,
  docs/SECURITY.md, docs/TRADING.md, shell.nix, missions/journal M01..M10 tous trackés. Git status
  propre (hors `docs/files.zip` untracked — jamais commité, par consigne).
- **README** : l'isolation réseau bwrap y est déjà qualifiée (fait en M07) : « prouvée sur l'hôte
  de dev — skip explicite ailleurs … renvoi mission-PALLAS-M07-journal.md ». **Aucune correction
  nécessaire**, constat porté au journal.
- **shell.nix** : pas de `clippy` → décision à prendre.

## 3. Inventaire exhaustif des contradictions `PLAN.md` (grep avant nettoyage)

| # | Ligne | Contradiction | Traitement |
|---|-------|---------------|------------|
| 1 | Phase 0, case CI | `- [ ] … `.github/workflows/` ne contient qu'un .gitkeep` alors que la case `[x]` et la CI fonctionnent (M06) | réécrite en `[x]` CI réelle (2 jobs Nix, verts) |
| 2 | Phase 0, bullet Risk | 37 tests/92,17 % puis 50 puis 54 cités côte à côte dans le même bullet | unifié : état courant 54 (39+12+3), couv. 95,92 %, « 37/50 = historique » pointe vers § État audité |
| 3 | §1.3 | « sandbox 9/9, TS 84/84 » vs réel 9/9 + 113/113 | 113/113 avec date, 84/84 marqué obsolète |
| 4 | §2.1 | « Tests : 20 verts (`polymarketClient.test.ts`) » vs réel 26 | 26, état 2026-09-10 |
| 5 | §2.3 | vitest « suite actuellement rouge (2 echecs) » vs verte depuis M07 | réecrit « effective, verte 113/113 depuis M07 » |
| 6 | Phase 5 case CI | « pas de nix en CI / toolchain stable directe » vs ci.yml réel 100 % Nix | réécrit sur le contenu réel (2 jobs, actions, audit Nix, commit échec/ fix, seuil high) |

Conservés (assertations volontaires, datées, sans contradiction) :
- § Phase 0 « Etat verifie (audit 2026-09-09) » 66 tests/64+2 → relabelé « HISTORIQUE ».
- § Phase 0 « Etat reel apres PALLAS-M01 » 50/50 + 70/70 → instantané daté.
- Contre-vérification `[x]`/`[ ]` : 39 cochées à l'issue (le reste = phases 3/4 non commencées).

## 4. README md — constat (rien à faire)

Vérifié que la qualification bwrap demandée par la mission figure déjà :
`README.md` → « Isolation réseau **prouvée sur l'hôte de dev** — skip explicite ailleurs … cf.
docs/mission/mission-PALLAS-M07-journal.md ». Critère refermé, aucune modification.

## 5. Critère CI réelle — preuves des runs observés (pas de simulation)

Runs GitHub Actions VERTs, observés au fil des missions (workflow dit « 2×2 » — jobs `typescript`
et `rust`) :

| Commit | Mission | Mainteneurs liés à M11 |
|--------|---------|------------------------|
| `3429c8f` | CI-Nix initial | ❌ échec volontaire (test de non-régression, M06) |
| `a07c9a8` | fix CI | ✅ success |
| `e401b24` | M07 | ✅ success |
| `60b392f` | M10 | ✅ success |
| `c35f749` | M09 | ✅ success |
| `ad526ba` | M08 | ✅ success |
| `f41f27d` | M11 | ✅ success — run `34546692362` (jobs `typescript` + `rust`) |

Lien : onglet Actions du dépôt `github.com/symbioticode/pallas` (état `success` constaté sur les deux
jobs via `gh run view` — la seule alerte visible dans le log, « Unable to authenticate to
FlakeHub », émane du post-step `magic-nix-cache-action` et est **non bloquante** : elle ne concerne
que l'upload du cache dans le store public Determinate Systems, pas l'exécution des jobs, qui
tournent et sortent verts). La stratégie sandbox demandée par la mission : **aucune exclusion nécessaire** —
l'échec hôte-dépendant de l'audit v0.1/§1 a été corrigé en M03/M07 (sonde `realBwrap` +
`server.listen` + skip explicite) ; les tests sandbox passent tels quels sur le runner standard.

## 6. Décision clippy : RÉSOLU (pas de dette)

- `clippy` ajouté aux `buildInputs` du `shell.nix` (+ commentaire de dette amortie + ligne
  « Commandes »). Shell testé : clippy 1.97.1 disponible.
- Premier run `cargo clippy --all-targets --all-features -- -D warnings` : **12 erreurs**, toutes
  triviales, corrigées :
  - `src/var.rs` (5) : `idx.max(0)` sur `usize` sans effet ; 3 `return` superflus (if/else
    tail-expressions) ; précision excessive `1.383577518672690e2` → `1.38357751867269e2`.
  - `src/kelly.rs` (1) : `assert_eq!(r.positive_ev, false)` → `assert!(!r.positive_ev)`.
  - `src/volatility.rs` (2) : `assert_eq!(s.should_halt, false/true, …)` → `assert!`.
  - `src/pipeline.rs` (1) : type long `Vec<(&str, Box<dyn Fn(…)>)>` → alias local
    `TradeBoundMutator` (portée de test).
  - `tests/cli_tests.rs` (3) : `assert!(v >= 0.0 && v <= 15.0)` → `(0.0..=15.0).contains(&v)` ;
    `assert_eq!(d.allowed, true)` → `assert!(d.allowed)` ; `len() >= 1` →
    `is_some_and(|w| !w.is_empty())`.
- Run final : **clippy propre** (0 erreur, 0 warning) sous `-D warnings` ; `cargo test` inchangé :
  **54/54** (39 unit + 12 intégration + 3 proptest).

## 7. Compteurs de tests re-pris à la source (2026-09-10)

TS via vitest JSON (`reporter=json`) — 9 fichiers, **113 passed / 113** :

| Fichier | Nombre |
|---------|--------|
| `packages/core/src/config.test.ts` | 7 |
| `packages/core/src/credentials.test.ts` | 7 |
| `packages/core/src/dry-run.test.ts` | 5 |
| `packages/core/src/sanitizer.test.ts` | 9 |
| `packages/risk/src/client.test.ts` | 17 |
| `packages/execution/src/polymarketClient.test.ts` | 26 |
| `packages/execution/src/polymarketSecrets.test.ts` | 8 |
| `packages/execution/src/polymarketSigner.test.ts` | 25 |
| `packages/execution/src/sandbox.test.ts` | 9 |
| **Total** | **113** |

Rust via `cargo test` : **54** = 39 unitaires (`circuit_breaker` 7 + `kelly` 5 + `pipeline` 12 +
`stress` 3 + `var` 7 + `volatility` 5) + 12 intégration (`cli_tests`) + 3 proptest (`properties`).
Couverture : 95,92 % lignes (audit v0.2 §1.3, inchangée — aucun test ajouté côté Rust).

## 8. Preuves locales ré-exécutées

- `npm test` : **113 passed (113, 9 files)**. `npx tsc --build` : OK.
- `nix-shell --run "cd crates/risk-engine && cargo clippy --all-targets --all-features -- -D
  warnings"` : **0 erreur**. `cargo test` : 54/54.
- Relecture croisée `PLAN.md` (grep) : plus aucune occurrence de `84/84`, `20 verts`, `47→66`,
  `actuellement rouge`, `pas de nix en CI`, `ne contient qu'un`, `à faire` (M11) — voir §3
  (les seules occurrences restantes sont l'historique daté 2026-09-09 délibérément conservé et la
  note « 84/84 … obsolète »).

## 9. Liste des fichiers touchés

- `PLAN.md` — 6 contradictions nettoyées + relabel « État vérifié » → HISTORIQUE + `PLAN.md`/tableau
  v0.2 : M11 ✅.
- `shell.nix` — `clippy` ajouté (buildInputs + commentaire + ligne Commandes).
- `crates/risk-engine/src/var.rs`, `src/kelly.rs`, `src/volatility.rs`, `src/pipeline.rs`,
  `tests/cli_tests.rs` — 7 lints clippy corrigés.
- `docs/mission/mission-PALLAS-M11-ci-reelle-et-plan-propre.md` — statut CLÔTURÉE, §7 critères cochés.
- `docs/mission/mission-PALLAS-M11-journal.md` — ce journal (nouveau).

## 10. Relecture croisée — aucune paire de lignes contradictoire restante

Vérification par paires de sujets (PLAN.md, après nettoyage) :
1. **Statut CI** : une seule affirmation — Phase 0 case « [x] CI réelle … 2 jobs Nix … runs VERTs
   … 2026-09-10 » ; Phase 5 case CI décrit le même contenu réel ; l'historique n'évoque que
   « `.gitkeep` » sans contredire (il date de la création, tous deux datés). ✓
2. **Compteur TS** : une seule valeur courante — §1.3 « 113/113 (9 fichiers, état 2026-09-10) »,
   cohérent avec §2.1 « 26 verts » (sous-ensemble) et §2.3 « verte 113/113 ». Chaque ancien compteur
   est étiqueté « HISTORIQUE » ou « obsolète ». ✓
3. **Compteur Rust** : une seule valeur courante — 54 (39+12+3) ; 37/92,17 % et 50/70 ne subsistent
   que dans des blocs datés. ✓
4. **Sandbox** : 9/9, statut de stratégie CI explicite (aucune exclusion, toutes les tâches par
   défaut). ✓
5. **Clippy** : coché par la mission, résolu dans shell.nix, visible en Phase 0 bullet Risk. ✓

## 11. Limites / dettes restantes (toutes datées, jamais silencieuses)

- `npm audit --audit-level=high` : 2 advisorys **modérées** `@vitest/mocker` dev-only — non
  bloquantes au seuil choisi, piste Vitest 5 en M06 réservée.
- Typecheck `tsc --build --dry` : mode « dry » moins robuste qu'un vrai `--noEmit` sur arbre à jour
  (note §2.3 conservée telle quelle — mineure).
- Validation du schéma de signature contre une API live testnet : toujours ouverte (porte
  `schemaGate`, hors M11).
- `docs/files.zip` : untracked, jamais commité (artefact local — par consigne, NE PAS TOUCHER).

## 12. Point de contrôle observateur

Trois étapes-tâches complétées avant le commit final (mission M11 + journal + clippy) — observation
enregistrée au log `~/Projects/_OBSERVER_SHARED/skill-observations/log.md`. À append avant le
commit+push : le résumé de la décision clippy (résolution au lieu de dette) comme contribution pour
les missions « dette d'outillage ».