# JOURNAL — PALLAS-M01 — Risk engine : validation stricte + état réel transmis

Statut : **CLÔTURÉE** le 2026-09-09
Agent d'exécution : opencode / big-pickle
Référentiel : `AUDIT-PALLAS-v0.1.md` §2, avec reproduction locale de chaque constat avant correction.

## 1. Métriques avant / après

| Métrique | Avant | Après |
|---|---|---|
| Tests Rust (unit + intégration + proptest) | 37 verts (baseline audit) | **50 verts** : 35 unit + 12 intégration + 3 proptest |
| Files TS / tests TS | 9 / 66 | 9 / **70** |
| Probe adversariale (`market_id=""`, `side="garbage"`, `est_value_usd=-100`, `win_probability=2`) | `allowed: true`, `suggested_size_usd: 10` | `allowed: false`, `rejected_by=["INPUT_VALIDATION"]`, `suggested_size_usd: 0.0`, 1 seul gate (court-circuit) |
| Pertes consécutives sur appels CLI séparés | impossible (état reconstruit à chaque appel) | 5 × `record pnl=-10` avec état transmis → `circuit_breaker.state == "Open"` puis `validate` → `rejected_by` contient `CIRCUIT_BREAKER` |
| `partial_cmp(...).unwrap()` dans `src/` | `var.rs:27,44` (+ `stress.rs:90` en test) | **0** — `total_cmp` partout ; test `nan_does_not_panic` |
| `cargo clippy` | — | **non disponible** dans le shell Nix (`error: no such command: clippy`) — dette reportée PALLAS-M06 |

Preuves (sorties, après correction) :
```
cargo test → test result: ok. 35/12/3 passed
probe smoke → {"decision":{"allowed":false,"gates":[{"gate":"INPUT_VALIDATION","action":"Reject",
  "reason":"Invalid trade input fields: market_id, side, est_value_usd, win_probability"}],
  "rejected_by":["INPUT_VALIDATION"],"suggested_size_usd":0.0},...}
npm test  → Test Files  9 passed (9) / Tests 70 passed (70)
```

## 2. Point par point (avant → après)

### 2.1 Validation stricte des bornes métier
- **Avant** : aucun gate de validation des bornes ; la probe adverse passait `allowed: true`.
- **Après** : `RiskState::input_validation_errors(req)` dans `pipeline.rs` vérifie
  `market_id` non vide, `side ∈ {"buy","sell"}`, `price ∈ (0,1]`, `quantity > 0`,
  `est_value_usd > 0`, `win_probability ∈ [0,1]`, `bankroll_usd > 0`,
  `confidence ∈ [0,1]`, `max_order_usd > 0`, `max_drawdown_usd > 0`.
  Court-circuit : si violations → 1 seul gate `INPUT_VALIDATION` en `Reject`, AUCUN des 10 autres
  gates exécuté. Tous les champs invalides listés dans `reason`.
- **Tests** : `audit_2026_09_09_rejects_invalid_trade`, `input_validation_rejects_each_bound`
  (Rust pipeline), `cli_audit_2026_09_09_rejects_invalid_trade` (CLI), 2 versions TS
  (`validateTrade rejects the 2026-09-09 audit adversarial probe`, `validateTrade rejects
  oversized order`).

### 2.2 Kill switch réel
- **Avant** : `KILL_SWITCH` toujours `Allow` — gate décoratif (`pipeline.rs` post-audit).
- **Après** : `RiskState.kill_switch_engaged: bool`. En tête de `validate_trade` : si `true`,
  seul gate `KILL_SWITCH` en `Reject`, court-circuit. Prioritaire sur tout (même un trade invalide).
- **Tests** : `kill_switch_engaged_blocks_every_trade` (Rust pipeline),
  `cli_kill_switch_blocks_every_trade` (CLI, vérifie `len(gates)==1`),
  `validateTrade respects the kill switch` (TS).

### 2.3 État persistant transporté entre appels CLI
- **Avant** : `main.rs::Input` ne transportait que `hist_pnls` ; CircuitBreaker et VolatilityDetector
  reconstruits à défaut à chaque appel → aucune mémoire entre trades.
- **Après** :
  - `main.rs` : `StateInput` (hist_pnls, kill_switch_engaged, circuit_breaker, volatility),
    `StateOutput` (état complet sérialisé), commande **`record`** (`pnl` → mise à jour breaker +
    volatilité), et **`validate` retourne l'état à persister**.
  - `circuit_breaker.rs` : `CircuitBreakerSnapshot` + `snapshot()` / `restore()` (serde).
  - `volatility.rs` : `VolatilityState` + `snapshot()` / `restore()` (serde).
  - TS : `packages/risk/src/types.ts` (`StateInput` étendu, `CircuitBreakerState`,
    `VolatilityState`, `StateOutput`, `ValidateResponse` + state, `RecordResponse`),
    `client.ts` (`recordPnl`, `validateTradeWithState`). Contrat jamais cassé isolément.
- **Tests (passerelles multi-calls)** : `cli_record_updates_breaker_state`,
  `cli_consecutive_losses_trip_breaker_across_calls`, `cli_validate_returns_state_for_persistence`
  (Rust CLI) + `recordPnl accumulates consecutive losses across calls and trips the breaker`,
  `validateTrade returns the persistent state to store back` (TS).

### 2.4 Circuit Breaker : vrai chemin Open → HalfOpen → Closed
- **Avant** : aucun chemin vers `HalfOpen` (`circuit_breaker.rs:63-68`) ; test
  `half_open_recovers_to_closed` ne testait rien.
- **Après** : machine à états `Closed → Open (N pertes consécutives) → HalfOpen
  (recovery_observations)`, sonde : perte en HalfOpen → retour `Open` ; observation positive ou
  neutre en fin de fenêtre de récupération → `Closed`. `recovery_observations: 3` par défaut.
- **Tests** : `open_to_half_open_to_closed_full_transition` (transition complète),
  `half_open_probe_loss_reopens`, `snapshot_roundtrip_preserves_state`. (L'ancien test factice a
  été remplacé — renforcement, pas suppression de couverture.)

### 2.5 NaN : aucun panique possible
- **Avant** : `partial_cmp(...).unwrap()` dans `var.rs:27,44` → panique sur `NaN` (l'API
  bibliothèque publique reste atteignable).
- **Après** : `total_cmp` dans `var_historical` et `cvar` ; `stress.rs` (test) passé en `total_cmp` ;
  `record` CLI rejette les pnl non-finis (`!pnl.is_finite()`). Reste dans `src/` : 3 `.unwrap()` de
  `serde_json::to_string` sur `ErrorOutput` (chaînes seules, infaillible) et 3 `.unwrap()` de
  `.max_by()/.find()` sur tableaux/lookups constants en tests — justifiés.
- **Tests** : `nan_does_not_panic`, `cli_record_rejects_non_finite_pnl`.

## 3. Fiabilité / tests

- `nix-shell --run "cd crates/risk-engine && cargo test"` → vert à chaque étape.
- `npm test` (tsc --build en pretest) → 70/70, `npm run typecheck` → OK.
- La binaire release (`target/release/risk-engine`) a dû être **rebuildée** pour les tests TS :
  `candidatePaths()` de `client.ts` privilégie `release/` sur `debug/` → risque de tests TS sur une
  binaire obsolète. **Observation** : ajouter une garde (mtime >= sources / rebuild auto) — à
  traiter en M04 ou M06.

## 4. Critères de succès — tous vérifiés

- [x] Probe audit → `allowed: false` + `INPUT_VALIDATION` dans `rejected_by` (preuve §1).
- [x] Pertes consécutives sur ≥2 appels CLI séparés → breaker `Open` (test intégration Rust + TS).
- [x] `KILL_SWITCH` passe réellement à `Reject` via flag, testé (court-circuit 1 gate).
- [x] Transition réelle `Open → HalfOpen → Closed` testée (`open_to_half_open_to_closed_full_transition`).
- [x] Aucun `partial_cmp(...).unwrap()` restant sur chemin atteignable ; `NaN` testé.
- [x] `cargo test` vert, **50 tests** ≥ 42 requis.
- [x] `packages/risk` mis à jour ; `npm test` vert, `npm run typecheck` vert.
- [x] Aucun test existant affaibli/supprimé (le test factice `half_open_recovers_to_closed` a été
  **remplacé par 3 vrais tests**).
- [x] Aucun unwrap/expect non justifié introduit.

## 5. Livrables

- `crates/risk-engine/src/{pipeline,circuit_breaker,volatility,var,stress,main}.rs`
- `crates/risk-engine/tests/{cli_tests,properties}.rs`
- `packages/risk/src/{types,client}.ts`, `packages/risk/src/client.test.ts`
- `docs/mission/mission-PALLAS-M01-journal.md` (ce fichier)

## 6. Dettes / observations

- `cargo clippy` absent du shell Nix → M06 (ajout, ou documenter l'absence).
- Ordre de résolution de la binaire Rust (`release` avant `debug`) → risque de binaire stale
  (produit de la séance) → M04/M06.
- `docs/AUDIT-PALLAS-v0.1.md` §2 : "Risk engine : fonctionnalité présente mais case non cochée"
  → maintenant cochée (voir PLAN.md Phase 0 et PALLAS-M01).