# JOURNAL — PALLAS-M09 — Risk engine : cohérence métier et sizing Kelly réellement contraignant

> Clôturée le 2026-09-10. Suite directe de l'audit **v0.2 §4.1** (« Rust — Risques restants ») :
> deux failles d'**incohérence inter-champs** (pas de bornes individuelles), laissées par M01.

## 1. Synthèse

| Faille v0.2 | État avant | Corrections M09 |
|---|---|---|
| `est_value_usd` jamais croisé avec `price × quantity` → pouvait tricher sous `POSITION_LIMIT` | probe `0.9×1000=900` déclaré `10` → **accepté** (`rejected_by=[]`) | gate **`VALUE_CONSISTENCY`** (tolérances documentées) |
| `KELLY_LIMIT` comparait à `bankroll_usd`, pas à `recommended_size` → le moteur pouvait suggérer $50 et autoriser $9000 | probe `est=4000` (> kelly suggéré ~1357, < bankroll 10000) → **accepté** | `KELLY_LIMIT` compare à **la taille suggérée FINALE** (`recommended_size × size_multiplier`, plafonné `max_order_usd`) |

Preuves basse/après : `cargo test` **50 → 54** (2 adversariaux + 2 cas limites), `npm test` 108/108
(cette fois le binaire réel est exercé avec le nouveau comportement).

## 2. Baseline — reproduction des probes AVANT correction (protocole §4.1)

Les 2 tests adversariaux `audit_v0_2_rejects_*` ont été écrits **d'abord**, exécutés × prétfixés :
```
$ nix-shell --run "cd crates/risk-engine && cargo test audit_v0_2"
running 2 tests
test pipeline::tests::audit_v0_2_rejects_incoherent_est_value_usd ... FAILED
  panicked at src/pipeline.rs:415: est_value_usd incoherent doit etre rejete (rejected_by=[])
test pipeline::tests::audit_v0_2_rejects_est_above_kelly_recommended ... FAILED
  panicked at src/pipeline.rs:438: taille > kelly suggere doit etre rejetee (rejected_by=[])
test result: FAILED. 0 passed; 2 failed
```
`rejected_by=[]` = les deux trades passaient **toutes** les portes de l'ancien pipeline. Bugs
confirmés par reproduction locale (preuve sauvegardée : `/tmp/opencode/m09-baseline-pre-fix.txt`).

## 3. Corrections (`crates/risk-engine/src/pipeline.rs`)

### 3.1 Gate `VALUE_CONSISTENCY` (nouveau, étape 5)

Inséré **avant `POSITION_LIMIT`** (sinon une valeur tronquée aurait déjà été jugée sous le plafond).

```rust
let expected_value = req.price * req.quantity;
let value_tol = VALUE_CONSISTENCY_TOL_ABS_USD.max(expected_value.abs() * VALUE_CONSISTENCY_TOL_REL);
let value_consistent = (req.est_value_usd - expected_value).abs() <= value_tol;
```

**Tolérance et justification (documentées en commentaire) :**
- `VALUE_CONSISTENCY_TOL_ABS_USD = 0.01` — 1 centime : `est_value_usd` est **arrondi au centime**
  par l'appelant ; erreur absolue plafonnée à $0.01.
- `VALUE_CONSISTENCY_TOL_REL = 0.01` — 1% : epsilon flottant des produits recalculés de part et
  d'autre, proportionnel aux montants.
- `tol = max(0.01, 1% de price×quantity)` : l'absolu sert aux **micro-trades** (0.012 → arrondi 0.01 :
  0.2% relatif l'aurait rejeté à tort — testé par `value_consistency_accepts_cent_rounding_micro_trade`),
  le relatif aux grosses valeurs. La probe (écart 890 vs tol 9) est rejetée d'un facteur ~100.

**Pourquoi 1% et pas moins/moins :** la borne est un *cadeau d'arrondi*, pas du confort. Le centime
est le quantum naturel des montants échangés ; 1% est ~20× l'écart max légitime d'une grosse valeur
(arrondi centime sur 1000 × epsilon 1e-9), et 100× sous la tromperie minimale utile (déclarer 50%
moins que la valeur réelle pour doper le levier). 5% aurait laissé passer 4× la valeur.

### 3.2 `KELLY_LIMIT` contraignant sur la taille suggérée FINALE (étape 9)

```rust
let kelly_bound = (kelly.recommended_size * vol.size_multiplier).min(req.max_order_usd);
let kelly_ok = req.est_value_usd <= kelly_bound + KELLY_LIMIT_TOL_USD;
```
- `recommended_size` = half-Kelly × bankroll (`kelly_fraction(..., 0.5)`) ;
- `× vol.size_multiplier` : contrainte **régime-dépendante** (High → ×0.5, Extreme → ×0.25) — l'audit
  exigeait le multiplicateur, pas le Kelly brut ;
- `.min(max_order_usd)` : si le plafond position est déjà plus strict, c'est lui qui tient (et
  `suggested_size_usd` reste `= min(..., max_order_usd)` → **cohérence sortie = autorisé**) ;
- `KELLY_LIMIT_TOL_USD = 0.01` : marge d'un centime pour que l'appelant qui soumet exactement la
  valeur `suggested_size_usd` (arrondie à 2 décimales par la sortie) passe. Au-delà → rejet strict.

**Cohérence sortie = autorisé (exigence §6.3) :** la sortie `suggested_size_usd` n'est PAS changée —
c'est `round2(min(recommended_size*mult, max_order_usd))`, exactement le plafond que `KELLY_LIMIT`

## 4. Tests

**2 adversariaux nommés `audit_v0_2_rejects_*`** (reproduisent exactement les probes §1 de la
mission) + **2 cas limites** qui prouvent qu'on n'a PAS sur-serré :
- `kelly_accepts_trade_at_suggested_size` — `est_value_usd == suggested_size_usd` (1000) → **Allow** ;
- `value_consistency_accepts_cent_rounding_micro_trade` — 0.006×2=0.012 déclaré 0.01 (arrondi
  centime) → **Allow** (marge absolue).

**Fixtures corrigées — valables, pas affaiblies.** Trois « faits génériques » utilisaient
`est_value_usd=60` avec `price=0.6 quantity=10` (valeur réelle **6$**) — c'était EXACTEMENT la classe
d'incohérence que la M09 doit rejeter (60$ sous un plafond alors que l'ordre coûte 6$) :
- `pipeline.rs::valid_req()` → `6.0` ;
- `cli_tests.rs::valid_trade_json()` + le `TradeRequest` de `cli_validate_returns_decision` → `6.0` ;
- `packages/risk/src/client.test.ts::validTrade` → `6` — critique : ce fixture exerce **le binaire
  réel** dans `npm test` (CI job TS), il aurait échoué sinon ;
- `cli_tests.rs::full_pipeline_integrates` (`est=100` vs `0.4×5=2`) → `2.0`.

Aucun test adversaire affaibli : les tests qui mutent `est_value_usd` pour le faire rejeter
(`oversized_order_rejected`, `kill_switch_blocks_all_trades`, etc.) rejettent toujours par
`POSITION_LIMIT` (VALUE_CONSISTENCY s'y ajoute dans `rejected_by`, sans casser leurs assertions).

## 5. Métriques

| Métrique | Avant | Après |
|---|---|---|
| Probe 1 `0.9×1000` déclaré `10` | acceptée (`rejected_by=[]`) | rejetée `VALUE_CONSISTENCY` (écart 890 > tol 9) |
| Probe 2 `est=4000` > kelly suggéré | acceptée (`rejected_by=[]`) | rejetée `KELLY_LIMIT` (seulement — PAS `POSITION_LIMIT`) |
| Tests Rust | 50 | **54** (39 unit + 12 intégration + 3 proptest) |
| Tests TS (`npm test`, binaire réel) | 108 | **108** (aucune régression) |

## 6. Limites / réserves restantes

- `suggested_size_usd` est exposé arrondi au centime — un appelant maximaliste peut soumettre
  exactement cette valeur (passes, tolérance 1¢) ; au-delà, rejet strict (choix documenté).
- Pas de validation *marché* en Rust (pas de données de marché cotées dans le moteur) — reste à
  la couche d'exécution (vérifiée par M10 côté params/signé).
- Rien n'empêche un GAIN d'être déclaré sous son prix×quantité *réel honorable* : c'est le marché
  (maker/taker) qui fixe la valeur finale — la cohérence ferme la porte à une **troncature
  unilatérale**, pas à la manipulation du prix lui-même (hors périmètre, c'est un sujet de données
  de marché).

## 7. Fichiers touchés

- `crates/risk-engine/src/pipeline.rs` — 2 const tolérance documentées, gate `VALUE_CONSISTENCY`,
  `KELLY_LIMIT` sur plafond final, re-numérotation commentaires (3..12), 4 nouveaux tests,
  `valid_req` fiabilisé (`6.0`).
- `crates/risk-engine/tests/cli_tests.rs` — fixtures `est_value_usd` cohérentes (`6.0`, `2.0`).
- `packages/risk/src/client.test.ts` — `validTrade.est_value_usd: 6`.
- `PLAN.md` — tableau missions audit v0.2 (M07-M11) + note additive Phase 0 bullet risk engine.
- `docs/mission/mission-PALLAS-M09-risk-coherence-metier.md` — critères cochés.
- Preuves baseline/post-fix : `/tmp/opencode/m09-baseline-pre-fix.txt`, `/tmp/opencode/m09-post-fix.txt`.