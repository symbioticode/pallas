# JOURNAL — PALLAS-M15 — Risque de portefeuille : exposition réelle, limites hors stratégie, HalfOpen restrictif

Date : 2026-09-11
Agent : big-pickle (opencode) — mission exécutée en autonomie
Statut : TERMINÉE

## Synthèse attentive

Deux audits avaient trouvé, indépendamment, le même défaut architectural : le risk engine
mesurait **chaque ordre isolément** — `POSITION_LIMIT` comparait seulement « la valeur de CET
ordre ≤ max_order », jamais « l'exposition totale après exécution ≤ limite de portefeuille ».
Et trois défauts annexes : `bankroll_usd`/`max_order_usd`/`max_drawdown_usd` étaient des champs
du `TradeRequest` (donc édictés par l'appelant — P0-03) ; `HalfOpen` traitait les trades comme
normaux (`circuit_breaker.rs::is_open()` ne distingue que `Open` des autres) ; une VaR à zéro
observation renvoyait 0 interprété comme « risque nul → PASSE » (F-08).

M15 ferme les quatre brèches, en commençant par la plus structurante (le contrat) :

1. **Limites hors stratégie.** Les trois champs limites + 6 nouveaux quittent le `TradeRequest`,
   portés par une configuration opérateur `RiskConfig` passée au pipeline. `TradeRequest` porte
   `#[serde(deny_unknown_fields)]` : un appelant qui renverrait encore `bankroll_usd` et Cie est
   REFUSÉ dès la désérialisation — fail-closed explicite, jamais un silence dangereux.
2. **Exposition réelle cumulée.** `RiskState.exposure` (positions + ordres ouverts, calculés par
   le cycle depuis `doc.orders` de la réconciliation M14) ; `POSITION_LIMIT` vérifie l'exposition
   APRÈS exécution ; nouvelle porte `CONCENTRATION_LIMIT` par `market_id`.
3. **Circuit breaker 3 états.** `Closed` normal / `HalfOpen` sonde strictement bornée
   (`half_open_probe_size_usd`), taille suggérée plafonnée / `Open` rejet total.
4. **VaR/CVaR — `ESTIMATED` vs `INSUFFICIENT_DATA`.** `VaRResult.status` distingue statistiquement
   le manque de données ; le gate `VAR_CVAR_LIMIT` applique une **enveloppe de démarrage**
   configurée quand `sample_size < var_min_observations` — jamais « risque zéro » silencieux.
   Plus une garde **stale-price** (`MARKET_DATA_FRESHNESS`, `market_data_age_ms` dans le trade,
   Comparées à `max_market_data_age_ms`).

La stratégie (`@pallas/strategy`) et le contrat (`@pallas/risk`) ont été migrés dans le **même
changement** (règle M01). L'Observatory manifeste l'exposition réelle (`LIVE EXPOSURE USD`).

## 1. Ce qui était en cause

1. **Exposition par ordre isolé, pas par portefeuille** (audit v0.3 F-04 §5) : 20 ordres de $500
   passaient individuellement face à une limite de $1000 ; l'exposition cumulée après exécution
   n'était jamais comparée.
2. **Frontière de confiance inversée** (v0.2.1 P0-03) : la stratégie fournissait elle-même
   `bankroll_usd`/`max_order_usd`/`max_drawdown_usd` — un bug côté stratégie pouvait élargir sa
   propre enveloppe.
3. **HalfOpen inopérant dans le pipeline** (v0.2.1 P0-02) : la machine à états du breaker
   existait, mais seul `is_open()` (booléen `Open`) était consommé → en `HalfOpen`, taille
   normale autorisée.
4. **« Risque zéro » sur historique vide** (v0.3 F-08) : `< 2 observations` → VaR/CVaR = 0 →
   gate PASSE. Un moteur neuf obtenait la meilleure note possible.

## 2. Ce qui est livré

**`crates/risk-engine` :**

- `pipeline.rs` :
  - `TradeRequest` devient une pure intention (9 champs, dont `market_data_age_ms`),
    `#[serde(deny_unknown_fields)]` ;
  - `RiskConfig` (9 champs opérateur, `Default` conservateur : bankroll 10 000, max_portfolio
    exposure 1 000, max_concentration 1 000, probe 50, var_min_observations 20, enveloppe 1 000,
    âge max 600 000 ms…) — `RiskConfig::default()` : l'absence de config ne déroule jamais une
    enveloppe infinie ;
  - `ExposureItem { market_id, size_usd, event_id? }` + `RiskState.exposure` ;
  - `validate_trade(req, state, config)` : validation `input + config` fusionnée (une config
    invalide est REFUSÉE à l'entrée), puis 14 portes dont les nouvelles :
    `POSITION_LIMIT` cumulée (ordre isolé ET exposition APRÈS exécution),
    `CONCENTRATION_LIMIT` (cumul par `market_id` APRÈS exécution),
    `CIRCUIT_BREAKER` 3-états (HalfOpen → sonde seule, taille suggérée plafonnée),
    `VAR_CVAR_LIMIT` (INSUFFICIENT_DATA → enveloppe de démarrage),
    `MARKET_DATA_FRESHNESS` (âge ≤ plafond configuré) ;
  - `GateAction` dérive `Copy` (consommé en deux étapes) ;
- `var.rs` : `VarStatus { Estimated, InsufficientData }` (sérialisé SCREAMING_SNAKE_CASE pour
  cohérence avec les raisons des gates) + `VaRResult.status` ; `calculate_at` → `InsufficientData`
  pour `n < 2` ;
- `main.rs` : contrat CLI enrichi du champ `config` (optionnel, `RiskConfig` à validation) et de
  `exposure` dans l'état (legacy `#[serde(default)]`) ; doc d'entrée mise à jour.

**`packages/risk` (contrat TS, même commit que strategy) :**

- `types.ts` : `TradeRequest` sans limites + `market_data_age_ms: number` ; `RiskConfig`,
  `ExposureItem` ; `StateInput.exposure?` ; `StateOutput.exposure` ; `VaRResult.status:
  'ESTIMATED' | 'INSUFFICIENT_DATA'` ; schémas Zod correspondants (strict) ;
- `client.ts` : `validateTrade`/`validateTradeWithState` acceptent une troisième entrée
  `config?: RiskConfig` (injectée au contrat si présente).

**`packages/strategy` (même commit que risk) :**

- `durable-state.ts` : `freshState()` avec `exposure: []` ; **`exposureFromOrders(orders)`** —
  exposition réelle (positions `TERMINAL-filled` + ordres vivants, hors terminaux annulés/rejetés),
  agrégée par marché ;
- `run-reference-loop.ts` : option `bankrollUsd/maxOrderUsd/maxDrawdownUsd` → **`riskConfig`** ;
  `buildReferenceTradeRequest(signal, marketDataAgeMs)` sans limites ; l'âge des données est
  mesuré **au moment de la décision** (englobe fetch+signal+réconciliation) ; l'exposition est
  calculée depuis `doc.orders` et injectée dans l'état au droit de `validateTradeWithState` ;
  `main()` construit la config depuis `PALLAS_REF_*` (conservatrice par défaut) et la logge au
  `run_start`.

**`packages/observatory` (manifestation) :**

- `snapshot.ts` : `DurabilityReport.liveExposureUsd` (cumul des ordres vivants) ;
- `types.ts` + `render.ts` : `LIVE EXPOSURE USD` dans le panneau RISK.

## 3. Tests ajoutés

**`crates/risk-engine` — tests lib (`pipeline.rs`, `var.rs`) et CLI (`tests/cli_tests.rs`) :**
- `limits_come_from_config_not_trade_ipso_facto` : la MÊME intention est rejetée ou acceptée selon
  la config — les limites ne peuvent plus varier depuis le payload (P0-03, métrique §4.2) ;
- `cumulative_portfolio_exposure_stops_20x500_order_stream` : 20 × $500 face à une limite $1000 →
  2 passes, 3e refusé (métrique §4.1) ;
- `concentration_limit_blocks_second_order_on_same_market` ;
- `half_open_allows_probe_but_rejects_normal_trade` : en `HalfOpen`, un ordre de $500 refusé, une
  sonde à $30 acceptée, `suggested_size` plafonné à la sonde (métrique §4.3) ;
- `var_gate_reflects_insufficient_data_at_zero_and_one_observation` : 0 et 1 observation →
  allow DANS l'enveloppe avec raison `INSUFFICIENT_DATA` explicite, refus au-delà (métrique §4.4) ;
- `stale_market_data_rejected` (900 000 ms > 600 000 → `MARKET_DATA_FRESHNESS`) ;
- `invalid_config_is_rejected` (`max_order_usd: 0` → `INPUT_VALIDATION`) ;
- `var.rs` : statut `INSUFFICIENT_DATA` sur 0/1 observation, `ESTIMATED` en nombre suffisant ;
- CLI (`cli_tests.rs`) : `cli_rejects_legacy_limit_fields_in_trade` (champ limite legacy →
  exit non-zéro + `unknown field`), `cli_config_owns_limits`, `cli_exposure_is_transported_and_limits_cumulative`.

**`packages/risk` — `client.test.ts` :**
- migration des fixtures (trade sans limites, state avec `exposure`) ;
- `M15: les limites viennent de la CONFIG, pas du trade` ; `M15: donnees stale rejetees` ;
  `M15: exposition reelle portee par l etat borne les ordres suivants` ;
  `M15: concentration par marche bornee` ; `M15: VaR distingue manque de donnees de risque nul`.

**`packages/strategy` — fixtures migrées** (options → `riskConfig`, state avec `exposure`)
dans `run-reference-loop.test.ts`, `crash-windows.test.ts`, `reconciliation.test.ts`.

**`packages/observatory` — `observatory.test.ts` (+1) :** `LIVE EXPOSURE USD` = somme des ordres
vivants (250 + 150, terminal annulé exclu), rendu du panneau.

**Chiffres :** Rust 65 verts (47 lib + 15 CLI + 3 doc), clippy `-D warnings` propre, TS 206 verts
(17 fichiers), `npm run build` propre.

## 4. Écarts / limites assumées (transparences)

1. **Concentration par événement sous-jacent non activée par défaut** : `ExposureItem.event_id`
   est porté par la structure, mais le trade n'en transporte pas encore et le cycle n'agrège que
   par `market_id` (le `event_id` est prêt si la réconciliation le fournit). Limite documentée
   dans le code et dans le journal — la concentration par marché couvre le défaut F-04 §5.
2. **`market_data_age_ms` est attesté par l'appelant** (mesuré au droit de la décision, englobant
   fetch+signal+réconciliation) — pas une horodatation serveur vérifiée cryptographiquement.
   Honnête par construction, fiable pour un garde-fou ; la mission demandait « au moins un âge
   maximal configurable », satisfait.
3. **`RiskConfig::default()` reste accessible** quand aucun `config` n'est passé au contrat.
   L'orchestrateur (`run-reference-loop.ts`) passe TOUJOURS une config opérateur explicite.
4. **VaR au seuil CVaR = `max_drawdown_usd * 0.5`** : politique inchangée de M01..M12, désormais
   alimentée par la bankroll/drawdown de la CONFIG (précédemment du payload). Le drawdown
   maximal de stress-drunk reste un fraction du config, pas du trade.
5. **Fenêtre de test STP du HalfOpen** exercée au niveau pipeline (state construit avec breaker
   `Open` → un record de reprise → `HalfOpen`) ; la migration réelle `Open→HalfOpen` du circuit_
   breaker lui-même (reprise) n'a pas changé.

## 5. Vérifications

- `cargo test` : 65 verts ; `cargo clippy --all-targets --all-features -- -D warnings` : propre ;
  `cargo build --release` : OK.
- `npm run build` propre ; `npm test` : 206/206.
- Binaire release reconstruit AVANT le run TS (une première passe a montré que var.rs
  `rename_all` n'était pas compilé dans le release — corrigé puis retesté).
- Fumée réelle dans `/tmp/pallas-m15-smoke` (risk engine réel + dry-run) : `run_start` porte
  désormais `riskConfig` complet, cycle 1 « no_signal » (réseau bloqué), `run_end` ledger
  `valid:true`, state version 2.

## 6. Apprentissage / réutilisable

- **Frontière d'intention + `deny_unknown_fields`** : enlever les limites d'un payload appelant
  ne suffit pas à prouver qu'elles « ont quitté » le contrat — le rejETER à la désérialisation
  rend la frontière structurellement opposable (test CLI dédié).
- **Exposition APRÈS exécution** : la porte cumule `state.exposure` (positions + ordres ouverts)
  ET le nouvel ordre ; le faire en un point unique rend le test de ruissellement (20×500) trivial.
- **État de confiance catégorique** : `status` dans la SORTIE du moteur (pas seulement dans une
  raison de gate) — le contrat devient autodocumenté pour l'Observatory et les tests.
- Mesurer l'âge des données **au moment de la décision** (après signal+réconciliation) plutôt
  qu'à la construction du signal : la garde fraîcheur couvre aussi les délais d'infrastructure.

## 7. Critères de succès (mission §7)

- [x] `bankroll_usd`/`max_order_usd`/`max_drawdown_usd` ne sont plus fournis par l'appelant du
      trade — possédés par `RiskConfig` (opérateur), testé (Rust + CLI + TS).
- [x] `POSITION_LIMIT` compare l'exposition cumulée (positions + ordres ouverts + nouvel ordre,
      réconciliation M14) — testée (cumul 20×500, exposition transportée, CLI).
- [x] Une limite de concentration par marché existe et est testée.
- [x] Le circuit breaker `HalfOpen` autorise une sonde de taille strictement réduite, rejette une
      taille normale — testé par scénario dédié.
- [x] `VAR_CVAR_LIMIT` distingue `INSUFFICIENT_DATA` d'un risque mesuré à zéro, avec une politique
      explicite (enveloppe de démarrage configurée) — testée à 0 et 1 observation.
- [x] Une garde de fraîcheur de marché existe (âge maximal configurable des données utilisées pour
      la décision) — testée.