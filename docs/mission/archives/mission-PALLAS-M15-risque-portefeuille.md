# MISSION — PALLAS-M15 — Risque de portefeuille : exposition réelle, limites hors stratégie, HalfOpen restrictif

## 0. Métadonnées
Mission ID : PALLAS-M15
Date de création : 2026-09-10
Auteur / Agent : Claude (planification) — exécution par agent de code au choix
Projet : Pallas
Statut : CLOTURÉE — exécutée par big-pickle (opencode), journal `mission-PALLAS-M15-journal.md`
(2026-09-11)
Dépend de : PALLAS-M13 (état durable), PALLAS-M14 (positions/ordres connus de l'exchange)
Source de vérité : `AUDIT-PALLAS-v0.3.md` (F-04, section 5) + `AUDIT-PALLAS-v0.2.1.md`
(P0-02, P0-03, P0-05, P1-03, P1-04) + `crates/risk-engine/src/pipeline.rs` +
`crates/risk-engine/src/circuit_breaker.rs`

## 1. Contexte

**Défaut architectural central, documenté par les deux audits indépendamment :** le risk engine ne
connaît ni positions actuelles, ni ordres ouverts, ni collatéral engagé, ni exposition par
marché/événement. `POSITION_LIMIT` ne vérifie que "la valeur de CET ordre ≤ max_order" — pas
"l'exposition totale après exécution ≤ limite de portefeuille". L'audit v0.3 illustre concrètement :
20 ordres de $500 passent chacun individuellement une limite de $1000 ; des positions
fortement corrélées entre marchés (ex. un même événement politique) sont chacune admissibles.

**Deuxième défaut architectural, tout aussi grave (P0-03, v0.2.1) :** `bankroll_usd`,
`max_order_usd`, `max_drawdown_usd` sont aujourd'hui des **champs du `TradeRequest`**, donc fournis
par l'appelant (la stratégie) à chaque appel. Un bug côté stratégie peut donc élargir sa propre
enveloppe de risque — mauvaise frontière de confiance pour un système live. Le risk layer doit
recevoir une intention ("acheter X shares du token Y à P") et juger cette intention contre des
limites qu'IL possède, pas que la stratégie lui fournit.

**Troisième défaut, vérifié directement dans le code (`circuit_breaker.rs::is_open()`) :** la
machine à états `Closed → Open → HalfOpen → Closed` existe bien (ajoutée en PALLAS-M01), mais
`is_open()` ne retourne `true` que pour l'état `Open` :
```rust
pub fn is_open(&self) -> bool { self.state == BreakerState::Open }
```
Et `pipeline.rs` n'utilise que ce booléen (`let cb_open = state.circuit_breaker.is_open();`). En
`HalfOpen`, le pipeline traite donc le trading comme totalement normal — aucune restriction de
taille, aucune sonde limitée. Le sens même d'un half-open breaker (reprise limitée/sonde) n'est pas
respecté par le pipeline qui le consomme.

**Quatrième défaut (F-08, VaR/CVaR) :** avec moins de deux observations, VaR et CVaR renvoient 0, et
le pipeline interprète ce 0 comme "risque nul → gate PASS". Un moteur fraîchement démarré avec zéro
historique obtient donc la meilleure note possible plutôt qu'un état prudent par défaut.

## 2. Objectif général

Faire du risk engine un véritable gestionnaire de risque de portefeuille : positions et ordres
ouverts réels (fournis par la réconciliation de M14), limites possédées par la configuration
opérateur (pas par la stratégie), circuit breaker HalfOpen réellement restrictif, et distinction
explicite entre "risque mesuré à zéro" et "pas assez de données pour mesurer".

## 3. Objectifs détaillés

- **Séparer intention et limites dans le contrat `TradeRequest`** : retirer `bankroll_usd`,
  `max_order_usd`, `max_drawdown_usd` du payload fourni par l'appelant. Les faire porter par une
  configuration côté risk engine (fichier de config opérateur chargé au démarrage, ou paramètre du
  `RiskState`), jamais reconstructible par la stratégie. Documenter la migration de contrat (impact
  sur `packages/risk`, `packages/strategy`).
- **Exposition réelle** : `RiskState` doit intégrer les positions et ordres ouverts connus (fournis
  par la réconciliation de PALLAS-M14 côté TypeScript, transmis à la CLI Rust dans le contrat déjà
  étendu par PALLAS-M01/M13). `POSITION_LIMIT` doit comparer l'exposition **après exécution**
  (position actuelle + ordres ouverts + nouvel ordre) à la limite, pas seulement la valeur de
  l'ordre isolé.
- **Limite de concentration par marché/événement** : ajouter un gate qui borne l'exposition
  cumulée sur un même `market_id` (et, si l'information est disponible, un même événement sous-jacent
  regroupant plusieurs marchés/outcomes).
- **Circuit breaker HalfOpen restrictif** : le pipeline doit distinguer trois cas, pas deux —
  `Closed` (normal), `HalfOpen` (autoriser uniquement une sonde de taille strictement limitée,
  configurée séparément), `Open` (reject total). Exposer l'état complet (pas juste `is_open()`) au
  pipeline et implémenter la restriction de taille en HalfOpen.
- **VaR/CVaR avec état de confiance explicite** : introduire une distinction `ESTIMATED` /
  `INSUFFICIENT_DATA` dans la sortie du moteur de risque. Quand l'historique est insuffisant
  (< seuil configuré, pas juste < 2), le gate `VAR_CVAR_LIMIT` doit soit rejeter, soit appliquer une
  enveloppe de démarrage réduite explicitement configurée — jamais interpréter l'absence de données
  comme un risque nul.
- **Garde de fraîcheur des données de marché (stale-price)** : rejeter un trade si le dernier
  orderbook utilisé pour construire la décision dépasse un âge configuré (dépend de la
  réconciliation/market data de M14 pour dater correctement les lectures).

## 4. Protocole de validation

**Setup** : `cargo test` + `npm test` verts à chaque étape.

**Métriques à capter :**
1. Scénario de 20 ordres de $500 chacun, limite de portefeuille $1000 — doit désormais être rejeté
   après le premier ou deuxième ordre selon l'exposition cumulée, pas laissé passer indéfiniment.
2. Test qui prouve que la stratégie ne peut plus faire varier `bankroll_usd`/`max_order_usd` d'un
   appel à l'autre — la configuration risk engine est la seule source de vérité.
3. Test de transition en HalfOpen qui vérifie qu'un trade de taille normale est rejeté mais qu'une
   sonde de taille réduite est acceptée.
4. Test avec 0 et 1 observation historique — le gate VaR/CVaR doit refléter `INSUFFICIENT_DATA`,
   pas un passage silencieux.

## 5. Procédure / Étapes

### Partie A — Préparation
- Vérifier la clôture de PALLAS-M13 et l'avancement de PALLAS-M14 (les positions/ordres ouverts
  réels sont nécessaires pour l'exposition réelle — sans eux, ce point de la mission reste partiel
  et doit être documenté comme tel).
- Relire `pipeline.rs`, `circuit_breaker.rs`, `var.rs` en entier avec la question précise : "qu'est-ce
  qui est mesuré par ordre isolé vs par portefeuille cumulé".

### Partie B — Vérifications préalables
- Reproduire les 4 probes de la section 4 pour confirmer chaque bug avant correction.

### Partie C — Exécution
- Migrer le contrat `TradeRequest`/config (limites hors stratégie) en premier — c'est un changement
  de contrat qui impacte tout le reste.
- Ajouter l'exposition réelle et la concentration par marché.
- Corriger le pipeline pour le HalfOpen restrictif.
- Ajouter la distinction `ESTIMATED`/`INSUFFICIENT_DATA` au VaR/CVaR.
- Ajouter la garde de fraîcheur des données.

## 6. Ce que l'agent doit faire
1. Traiter la migration du contrat (limites hors stratégie) comme le changement le plus structurant
   — coordonner la mise à jour de `packages/risk` et `packages/strategy` dans le même changement.
2. Documenter explicitement si l'exposition réelle reste partielle faute d'achèvement de
   PALLAS-M14 au moment de cette mission — ne pas prétendre une exposition "réelle" tant que les
   données de réconciliation ne sont pas disponibles.
3. Vérifier que la restriction HalfOpen a un test qui distingue clairement les deux comportements
   (normal vs sonde limitée), pas juste l'absence de crash.

## 7. Critères de succès
- [ ] `bankroll_usd`/`max_order_usd`/`max_drawdown_usd` ne sont plus fournis par l'appelant du
      trade — possédés par la configuration risk engine, testé.
- [ ] `POSITION_LIMIT` compare l'exposition cumulée (position + ordres ouverts + nouvel ordre) à la
      limite, pas seulement la valeur de l'ordre isolé (au minimum avec les données disponibles
      post-M14 ; sinon la limitation est documentée explicitement).
- [ ] Une limite de concentration par marché/événement existe et est testée.
- [ ] Le circuit breaker `HalfOpen` autorise une sonde de taille strictement réduite, rejette une
      taille normale — testé par un scénario dédié.
- [ ] `VAR_CVAR_LIMIT` distingue `INSUFFICIENT_DATA` d'un risque mesuré à zéro, avec une politique
      explicite (rejet ou enveloppe réduite documentée) pour le premier cas.
- [ ] Une garde de fraîcheur de marché existe (au moins un âge maximal configurable des données
      utilisées pour la décision).

## 8. Interdictions
- Ne pas laisser `bankroll_usd`/`max_order_usd`/`max_drawdown_usd` accessibles en écriture depuis un
  chemin appelant, même indirect.
- Ne pas déclarer l'exposition "réelle" tant que les données de position/ordres ouverts ne
  proviennent pas effectivement de l'exchange (via M14) — pas de simulation présentée comme réelle.
- Ne pas casser la rétrocompatibilité de `packages/risk`/`packages/strategy` sans mettre à jour les
  deux dans le même changement (règle déjà posée en PALLAS-M01).

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M15-journal.md`.
Livrables : diffs `pipeline.rs`, `circuit_breaker.rs`, `var.rs`, contrat `packages/risk`/`packages/strategy`
mis à jour, tests, `PLAN.md` mis à jour (Phase 0/2 avec renvoi explicite à cette mission).
