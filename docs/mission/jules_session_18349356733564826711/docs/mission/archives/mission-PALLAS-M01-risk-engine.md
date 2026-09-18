# MISSION — PALLAS-M01 — Risk engine : validation stricte + état réel transmis

## 0. Métadonnées
Mission ID : PALLAS-M01
Date de création : 2026-09-09
Auteur / Agent : Claude (planification) — exécution par agent de code au choix
Projet : Pallas
Statut : CLÔTURÉE le 2026-09-09 — voir `mission-PALLAS-M01-journal.md` (preuves avant/après)
Source de vérité : `AUDIT-PALLAS-v0.1.md` (section 2, "Risk engine : fonctionnalité présente mais case non cochée") + `crates/risk-engine/`

## 1. Contexte

**Système :** le risk engine Rust (`crates/risk-engine/`) est appelé par `@pallas/risk` via un
contrat JSON stdin/stdout (un process par appel). Il expose 10 "gates" de validation dans
`pipeline.rs::validate_trade`.

**Sécurité :** ce module est LE point de passage obligé avant tout ordre réel. Un bug ici
(acceptation d'un trade invalide, kill switch inopérant) a un impact financier direct dès que le
dry-run est levé.

**Constat de l'audit (à corriger, PAS à re-débattre) :**
1. `KILL_SWITCH` retourne toujours `Allow` — ce n'est pas un kill switch, c'est un gate décoratif
   (`pipeline.rs:75-80`).
2. Le contrat CLI (`main.rs::Input`) ne transporte que `hist_pnls`. Le `CircuitBreaker` et le
   `VolatilityDetector` sont donc reconstruits à l'état par défaut à **chaque appel** de la CLI
   (`main.rs:60-65`) — aucune mémoire d'état entre deux appels, donc aucune protection réelle contre
   des pertes consécutives ou un régime de volatilité qui se développe sur plusieurs trades.
3. `CircuitBreaker` n'a aucun chemin de code vers `HalfOpen` : une fois `Open`, il incrémente un
   compteur et ne revient jamais à `Closed` (`circuit_breaker.rs:63-68`). Le test
   `half_open_recovers_to_closed` ne teste en réalité aucune récupération (`circuit_breaker.rs:150-163`).
4. Aucune validation des bornes métier : un trade avec `market_id=""`, `side="garbage"`,
   `est_value_usd=-100`, `win_probability=2` est actuellement **accepté** (`allowed: true`,
   `suggested_size_usd: 10`).
5. `partial_cmp(...).unwrap()` peut paniquer sur `NaN` dans `var.rs:27,44` — la frontière CLI JSON
   bloque `NaN` standard, mais l'API bibliothèque publique (utilisable par d'autres crates plus
   tard) n'est pas protégée.

**Dépendances :** aucune modification ici ne doit casser le contrat JSON consommé par
`packages/risk/src/client.ts` sans mettre à jour ce dernier dans la même mission (voir aussi
PALLAS-M04 pour la validation runtime côté TS de la réponse).

**Hypothèses :** l'état du risk engine (circuit breaker, volatilité) devra à terme être persisté
côté process appelant (TypeScript) et transmis à chaque appel CLI — ce n'est pas un service
long-running pour l'instant, donc la persistance est la responsabilité de l'appelant, pas de la CLI.

## 2. Objectif général

Faire du risk engine une protection réellement opérante : rejeter les entrées invalides, transmettre
et faire évoluer un état persistant (circuit breaker, volatilité) à travers les appels, et
implémenter un kill switch qui bloque effectivement les trades quand il est activé.

## 3. Objectifs détaillés

- Kill switch réel : un flag explicite (`state.kill_switch_engaged: bool` ou équivalent) qui,
  lorsqu'à `true`, fait rejeter `KILL_SWITCH` avec `GateAction::Reject`, quel que soit le reste du
  pipeline.
- Contrat CLI étendu : `StateInput` transporte l'état complet nécessaire à `CircuitBreaker` et
  `VolatilityDetector` (pertes consécutives courantes, cumulative_pnl, peak_pnl, fenêtre de
  volatilité) en plus de `hist_pnls`, et la CLI retourne l'état mis à jour en sortie pour que
  l'appelant le persiste et le renvoie au prochain appel.
- Validation stricte des `TradeRequest` : `market_id` non vide, `side` ∈ {"buy","sell"},
  `price` ∈ (0,1], `quantity` > 0, `est_value_usd` > 0, `win_probability` ∈ [0,1],
  `bankroll_usd` > 0. Toute violation → un nouveau gate `INPUT_VALIDATION` qui rejette avant même
  d'exécuter les 10 autres gates.
- `CircuitBreaker` : implémenter un vrai chemin `Open → HalfOpen → Closed` piloté par
  `recovery_observations`, avec un test qui vérifie la transition complète (pas juste l'absence de
  crash).
- Remplacer tous les `partial_cmp(...).unwrap()` par un tri qui traite `NaN` explicitement (rejet en
  amont si `NaN` présent dans les `pnls`, ou `total_cmp` documenté).

## 4. Protocole de validation

**Setup** : `nix-shell --run "cd crates/risk-engine && cargo test"` doit rester vert à chaque étape.

**Métriques à capter avant/après :**
1. Nombre de tests Rust verts (baseline : 37).
2. Résultat de la probe adversariale de l'audit (`market_id=""`, `side="garbage"`,
   `est_value_usd=-100`, `win_probability=2`) — doit désormais retourner `allowed: false`.
3. Un scénario "pertes consécutives sur plusieurs appels CLI séparés" doit désormais déclencher le
   circuit breaker (actuellement impossible car l'état ne survit pas entre appels).
4. `cargo clippy` (si disponible dans le shell Nix — sinon noter l'absence comme dette, voir
   PALLAS-M06) ne doit signaler aucun `unwrap()` non justifié sur les nouveaux chemins.

## 5. Procédure / Étapes

### Partie A — Préparation
- Lire `pipeline.rs`, `circuit_breaker.rs`, `volatility.rs`, `main.rs` en entier.
- Lire la section 2 de `AUDIT-PALLAS-v0.1.md` en entier avant de coder quoi que ce soit.

### Partie B — Vérifications préalables
- Reproduire la probe adversariale de l'audit pour confirmer le bug avant correction (baseline).
- Confirmer avec `cargo test` que les 37 tests actuels passent avant toute modification.

### Partie C — Exécution
- Implémenter les 5 points de la section 3 dans l'ordre : validation stricte d'abord (le plus
  simple, le plus impactant), puis kill switch, puis état persistant CLI, puis circuit breaker
  half-open, puis NaN.
- Mettre à jour `packages/risk/src/types.ts` et `packages/risk/src/client.ts` pour le nouveau
  contrat `StateInput`/sortie d'état (coordination avec PALLAS-M04 si celle-ci est en parallèle).
- Ajouter un test Rust par point de la section 3 (minimum 5 nouveaux tests), plus la probe
  adversariale de l'audit comme test de non-régression nommé explicitement
  `audit_2026_09_09_rejects_invalid_trade`.

## 6. Ce que l'agent doit faire
1. Confirmer chaque bug de la section 1 par une reproduction locale avant de le corriger.
2. Corriger dans l'ordre de la section 3, en gardant `cargo test` vert à chaque commit.
3. Mettre à jour ce fichier de mission avec le statut réel après chaque étape (pas d'auto-cochage
   sans exécution).
4. Rédiger `mission-PALLAS-M01-journal.md` documentant, pour chaque point, l'état avant/après avec
   preuve (sortie de commande, pas de résumé sans preuve).

## 7. Critères de succès
- [x] La probe adversariale de l'audit retourne `allowed: false` avec au moins un gate
      `INPUT_VALIDATION` dans `rejected_by`.
- [x] Un scénario de pertes consécutives réparties sur plusieurs appels CLI séparés déclenche le
      circuit breaker (test d'intégration qui simule 2+ appels successifs avec état transmis).
- [x] `KILL_SWITCH` peut effectivement passer à `Reject` via un flag d'état, testé explicitement.
- [x] Un test de transition `Open → HalfOpen → Closed` passe réellement (pas un test qui ne teste
      rien, comme l'actuel `half_open_recovers_to_closed`).
- [x] Aucun `partial_cmp(...).unwrap()` restant sur un chemin atteignable sans validation NaN en amont.
- [x] `cargo test` toujours vert, avec au moins 42 tests (50 obtenus).
- [x] `packages/risk` mis à jour et `npm test` toujours vert pour les tests qui consomment ce contrat.

## 8. Interdictions
- Ne pas supprimer ou affaiblir un test existant pour faire passer un nouveau comportement.
- Ne pas cocher une case de `PLAN.md` sans avoir exécuté et documenté le critère correspondant.
- Ne pas introduire de nouvel `unwrap()`/`expect()` non justifié en commentaire.
- Ne pas changer le format de sortie JSON de la CLI sans mettre à jour `packages/risk` dans le même
  changement (rupture de contrat interdite en isolation).

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M01-journal.md`
Livrables : diffs Rust + TS commités, section "Phase 0" de `PLAN.md` mise à jour avec le statut réel
et une ligne "voir PALLAS-M01, clôturée le [date]".
