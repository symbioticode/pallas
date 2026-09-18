# MISSION — PALLAS-M09 — Risk engine : cohérence métier et sizing Kelly réellement contraignant

## 0. Métadonnées
Mission ID : PALLAS-M09
Date de création : 2026-09-09
Auteur / Agent : Claude (planification) — exécution par agent de code au choix
Projet : Pallas
Statut : ACTIF — 🔴 Critique (contournement direct des limites de position)
Source de vérité : `AUDIT-PALLAS-v0.2.md` (section 4.1, "Rust — Risques restants") +
`crates/risk-engine/src/pipeline.rs`

## 1. Contexte

**Ce qui a été fait (PALLAS-M01, clôturée) :** validation stricte des bornes de chaque champ pris
individuellement, kill switch réel, état persistant transporté, circuit breaker half-open réel, NaN
traité. Vérifié et confirmé par l'audit v0.2.

**Ce que révèle l'audit v0.2, non couvert par M01 — deux failles de cohérence *inter-champs*, pas de
bornes individuelles :**

1. **`est_value_usd` n'est jamais vérifié cohérent avec `price × quantity`**
   (`pipeline.rs:82-93`). M01 a validé que chacun de ces trois champs est individuellement dans des
   bornes raisonnables (`price ∈ (0,1]`, `quantity > 0`, `est_value_usd > 0`), mais rien n'empêche
   un appelant de soumettre `price=0.9`, `quantity=1000` (valeur réelle ≈ 900) tout en déclarant
   `est_value_usd=10` pour passer sous le plafond `POSITION_LIMIT`, qui ne regarde QUE
   `est_value_usd` (`pipeline.rs:162-175`). Le pipeline accepterait ce trade en pensant qu'il coûte
   $10 alors qu'il en coûte $900.

2. **Le gate `KELLY_LIMIT` ne fait respecter que `est_value_usd <= bankroll_usd`**
   (`pipeline.rs:193-200`), pas `est_value_usd <= recommended_size` (la taille que le moteur
   calcule lui-même via Kelly fractionnaire). Autrement dit, le moteur peut *suggérer* $50 mais
   *autoriser* $9000 tant que la bankroll totale n'est pas dépassée — le sizing Kelly n'est qu'une
   indication, pas une contrainte réellement appliquée.

**Sévérité :** ces deux failles permettent, en théorie, à un appelant (agent IA compromis, bug côté
TS, ou simple erreur d'implémentation ailleurs dans la chaîne) de faire passer des trades largement
plus gros que ce que les gates censés les limiter autorisent réellement. C'est exactement le genre
de trou que l'audit v0.1 avait trouvé sur `market_id`/`side` avant M01 — même catégorie de bug,
inter-champs plutôt que intra-champ.

## 2. Objectif général

Faire en sorte que les gates `POSITION_LIMIT` et `KELLY_LIMIT` protègent réellement contre ce
qu'ils prétendent limiter, en validant la cohérence entre les champs liés plutôt que chaque champ
isolément.

## 3. Objectifs détaillés

- Ajouter une vérification de cohérence `est_value_usd ≈ price × quantity` dans
  `input_validation_errors` (ou un gate dédié `VALUE_CONSISTENCY`), avec une tolérance explicite et
  justifiée (ex. 1% pour absorber l'arrondi flottant — documenter le choix, ne pas le laisser
  arbitraire).
- Modifier le gate `KELLY_LIMIT` pour qu'il rejette (`Reject`) si `est_value_usd` dépasse
  `recommended_size` (calculé par `kelly_fraction`), pas seulement `bankroll_usd`. Réfléchir à la
  marge : faut-il un seuil strict ou une tolérance (ex. arrondi) ? Documenter la décision.
  Attention : `recommended_size` dépend aussi de `vol.size_multiplier` (régime de volatilité) — le
  gate doit utiliser la taille suggérée finale, pas seulement le Kelly brut.
- Vérifier qu'aucun test existant du pipeline ne dépendait implicitement de l'ancien comportement
  permissif (auquel cas corriger le test s'il testait le mauvais comportement, sans l'affaiblir
  côté sécurité).
- Écrire des tests adversariaux dédiés reproduisant exactement les deux probes décrites en section 1
  (incohérence valeur/prix×quantité, et taille demandée > taille suggérée Kelly), nommés
  explicitement `audit_v0_2_rejects_*` pour la traçabilité.

## 4. Protocole de validation

**Setup** : `cargo test` vert dans le dev shell Nix à chaque étape.

**Métriques à capter :**
1. Reproduire la probe `price=0.9, quantity=1000, est_value_usd=10` AVANT correction pour confirmer
   qu'elle est actuellement acceptée (baseline), puis vérifier qu'elle est rejetée après.
2. Reproduire un scénario où `est_value_usd` dépasse `recommended_size` mais reste sous
   `bankroll_usd` — confirmer le rejet après correction.
3. Nombre de tests Rust verts avant/après (baseline post-M01 : 50).

## 5. Procédure / Étapes

### Partie A — Préparation
- Relire `pipeline.rs::validate_trade` en entier, en particulier les gates `POSITION_LIMIT` et
  `KELLY_LIMIT`.
- Relire `AUDIT-PALLAS-v0.2.md` section 4.1 en entier.

### Partie B — Vérifications préalables
- Reproduire les deux probes de la section 1 pour confirmer les bugs avant correction (baseline).

### Partie C — Exécution
- Ajouter la validation de cohérence valeur/prix×quantité.
- Corriger le gate Kelly pour qu'il compare à `recommended_size`, pas `bankroll_usd`.
- Ajouter les tests adversariaux nommés explicitement.

## 6. Ce que l'agent doit faire
1. Confirmer chaque bug par reproduction locale avant de corriger (comme pour M01).
2. Documenter explicitement toute tolérance/marge introduite (pourquoi 1% et pas 0.1% ou 5%).
3. Vérifier que la correction du gate Kelly ne casse pas la logique existante de
   `suggested_size_usd` en sortie (qui doit rester cohérente avec ce qui est désormais autorisé).

## 7. Critères de succès
- [x] Un trade avec `est_value_usd` incohérent avec `price × quantity` (hors tolérance documentée)
      est rejeté par un gate explicite, testé. *(M09 : gate `VALUE_CONSISTENCY`, test
      `audit_v0_2_rejects_incoherent_est_value_usd`)*
- [x] Un trade dont `est_value_usd` dépasse la taille Kelly suggérée (`recommended_size`, incluant
      le multiplicateur de régime de volatilité) est rejeté par `KELLY_LIMIT`, testé.
      *(M09 : plafond `recommended_size × size_multiplier` min `max_order_usd`, test
      `audit_v0_2_rejects_est_above_kelly_recommended`)*
- [x] La tolérance de cohérence valeur/prix×quantité est documentée et justifiée en commentaire.
      *(constantes `VALUE_CONSISTENCY_TOL_*` + doc dans pipeline.rs, justification arrondi centime
      vs epsilon flottant)*
- [x] `cargo test` reste vert, avec au moins 2 nouveaux tests adversariaux nommés explicitement.
      *(54 tests Rust (baseline 50) ; 2 tests `audit_v0_2_rejects_*` + 2 cas limites acceptation)*
- [x] Aucun test existant affaibli pour faire passer le nouveau comportement.
      *(3 fixtures incohérentes corrigées pour être cohérentes — `full_pipeline_integrates`,
      `valid_req`, `valid_trade_json`, `client.test.ts` — c'était exactement l'incohérence à rejeter)*

## 8. Interdictions
- Ne pas se contenter d'un warning/log sans rejet effectif — ces deux failles doivent produire un
  `GateAction::Reject`, pas juste une trace.
- Ne pas introduire de tolérance non documentée ou arbitrairement large "pour que les tests
  passent" — toute marge doit être justifiée par un raisonnement (arrondi flottant, pas confort).
- Ne pas modifier le contrat JSON de sortie sans mettre à jour `packages/risk` dans le même
  changement, comme exigé par la contrainte transverse déjà posée en PALLAS-M01.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M09-journal.md`, avec preuve avant/après pour chacune des deux
probes de la section 1.
Livrables : diffs `pipeline.rs` + tests, mise à jour `PLAN.md` Phase 0 (note additive sur PALLAS-M09,
sans rouvrir la case déjà validée par M01 — préciser que M09 couvre un écart distinct découvert par
l'audit v0.2).
