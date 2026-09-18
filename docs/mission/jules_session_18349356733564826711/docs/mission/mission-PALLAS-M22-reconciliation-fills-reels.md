# MISSION — PALLAS-M22 — Réconciliation par fills réels et exposition alimentée par l'exchange

## 0. Métadonnées
Mission ID : PALLAS-M22
Date de création : 2026-09-11
Auteur / Agent : Claude (planification) — exécution par Codex
Projet : Pallas
Statut : ACTIF — 🔴 **Critique, priorité absolue de la vague M21-M28**
Dépend de : PALLAS-M21 (suite verte avant de commencer)
Source de vérité : `AUDIT-PALLAS-v0.4.md` (F-03, F-04, section 4.2) +
`packages/strategy/src/reconciliation.ts`

## 1. Contexte

**Le finding le plus grave de tout l'historique d'audit, plus sévère que tout ce qui a précédé :**
sans `order_id` connu, `reconcileOrder` interroge uniquement les ordres **ouverts**
(`reconciliation.ts:201`). Si l'ordre n'apparaît dans aucun ordre ouvert — parce qu'il a été
**totalement rempli**, ce qui le retire précisément de cette liste — la logique actuelle conclut
"aucun match" et transitionne l'ordre vers `TERMINAL/cancelled` (`reconciliation.ts:250`).

**Conséquence concrète et chiffrable :** un ordre réellement exécuté (position ouverte, capital
engagé) est déclaré annulé. Le gate de scope (PALLAS-M14) libère alors ce marché pour une nouvelle
émission — Pallas peut **doubler une position déjà prise**, en pensant repartir d'un scope propre.
C'est l'inverse exact de ce que la réconciliation devait garantir.

**Cause racine :** Pallas n'a aucun endpoint de lecture des trades/fills. Or Polymarket documente
explicitement que la réconciliation post-soumission doit couvrir "les ordres ouverts **et** les
trades résultants", et que les trades servent à reconstruire fills et positions
(`docs.polymarket.com/trading/manage-orders`, cité par l'audit v0.4). Interroger uniquement les
ordres ouverts est structurellement insuffisant, peu importe la qualité du reste du code.

**Second défaut, conséquence directe du premier :** `exposureFromOrders` (`durable-state.ts:147`)
calcule l'exposition à partir de la machine d'états locale, qui hérite donc de la fausse annulation
ci-dessus — l'exposition réelle du portefeuille peut être sous-évaluée exactement au moment où elle
devrait être la plus stricte (une position vient d'être prise et "disparaît" du calcul).

## 2. Objectif général

Rendre la réconciliation capable de distinguer "rempli" de "annulé" avec une preuve positive
(trades/fills), jamais par déduction depuis une simple absence, et faire que l'exposition du
portefeuille reflète les positions et le collatéral réellement connus de l'exchange.

## 3. Objectifs détaillés

- Rechercher et implémenter l'endpoint de lecture des trades/fills Polymarket (équivalent de
  `getOpenOrders`/`getOrder` mais pour l'historique d'exécution) — vérifier la doc actuelle, ne pas
  supposer sa forme.
- Réécrire `evidenceToPatch`/`gatherEvidence` : un ordre sans `order_id` connu ET absent des ordres
  ouverts ne doit **jamais** être conclu `cancelled` sur cette seule base. Il doit d'abord être
  recherché dans l'historique des trades/fills. Trois issues possibles, jamais deux :
  1. trouvé rempli (au moins un fill correspondant) → `TERMINAL/filled`, position enregistrée ;
  2. confirmé absent à la fois des ordres ouverts ET de l'historique de trades sur une fenêtre
     temporelle raisonnable après soumission → `TERMINAL/cancelled` (seule condition légitime) ;
  3. impossible à déterminer (erreur réseau sur l'un des deux appels, fenêtre trop courte) → reste
     `RECONCILING`, jamais de conclusion forcée, le gate de scope continue de bloquer.
- Étendre `exposureFromOrders` (ou la logique équivalente) pour intégrer, quand disponibles, les
  positions et le collatéral réels remontés par l'exchange (balances, ordres ouverts confirmés),
  pas uniquement la machine d'états locale — documenter explicitement si cette intégration reste
  partielle par manque d'endpoint balance côté Polymarket, plutôt que de prétendre une exposition
  "réelle" qui ne le serait qu'à moitié.
- Ajouter, si l'information est disponible côté exchange, un regroupement d'exposition par
  événement sous-jacent (plusieurs marchés/outcomes corrélés), pas seulement par `market_id` isolé
  (déjà couvert partiellement par PALLAS-M15).

## 4. Protocole de validation

**Setup** : `npm test` vert (packages/strategy, packages/execution) à chaque étape, en partant
d'une base verte issue de PALLAS-M21.

**Métriques à capter :**
1. Test qui reproduit exactement le scénario de l'audit : un ordre soumis, totalement rempli
   (retiré des ordres ouverts), sans `order_id` local connu — la réconciliation doit désormais le
   trouver via les trades/fills et le marquer `filled`, jamais `cancelled`.
2. Test qui vérifie qu'en l'absence de tout signal (ni ordre ouvert, ni fill, erreur réseau sur les
   deux), l'ordre reste `RECONCILING` et le scope reste bloqué — pas de conclusion par défaut.
3. Test qui vérifie qu'un ordre réellement absent (jamais soumis avec succès) est bien classé
   `cancelled` après vérification positive des deux sources.

## 5. Procédure / Étapes

### Partie A — Préparation
- Rechercher la documentation Polymarket actuelle sur l'historique des trades/fills (endpoint,
  authentification, pagination, fenêtre de disponibilité).
- Relire `reconciliation.ts` en entier avec la question précise : "quelles conclusions sont prises
  par déduction d'une absence, plutôt que par une preuve positive".

### Partie B — Vérifications préalables
- Reproduire le scénario adversarial de l'audit (ordre rempli mais absent des ordres ouverts) en
  test AVANT de corriger, pour confirmer le bug exact.

### Partie C — Exécution
- Implémenter l'appel trades/fills.
- Réécrire la logique de convergence à trois issues.
- Étendre l'exposition avec les données réelles disponibles.

## 6. Ce que l'agent doit faire
1. Ne jamais conclure `cancelled` par déduction seule — toujours exiger une vérification positive
   sur les deux sources (ordres ouverts ET trades/fills) avant cette conclusion.
2. Documenter explicitement toute limite persistante (ex. si l'API ne permet pas de remonter tous
   les fills historiques au-delà d'une fenêtre donnée) plutôt que de la laisser implicite.
3. Vérifier que le gate de scope de PALLAS-M14 respecte bien le nouvel état `RECONCILING`
   prolongé (pas de timeout silencieux qui libérerait le scope faute de conclusion).

## 7. Critères de succès
- [ ] Un ordre rempli mais absent des ordres ouverts est désormais correctement classé `filled` via
      une preuve positive de trade/fill, testé par le scénario exact de l'audit v0.4.
- [ ] Aucune conclusion `cancelled` n'est plus prise sur la seule absence d'un signal — testé.
- [ ] En cas d'impossibilité de conclure, l'ordre reste `RECONCILING` et le scope reste bloqué,
      testé.
- [ ] L'exposition intègre les positions/collatéral réels disponibles depuis l'exchange, avec toute
      limite résiduelle documentée explicitement.
- [ ] Aucune régression sur les tests existants de PALLAS-M14/M15.

## 8. Interdictions
- Ne pas laisser un chemin de code, même résiduel, où l'absence d'un ordre dans les ordres ouverts
  suffit seule à conclure `cancelled`.
- Ne pas présenter l'exposition comme "réelle" ou "complète" si elle reste partiellement dépendante
  de la machine d'états locale par manque d'endpoint exchange — qualifier précisément.
- Ne pas introduire de timeout qui libère automatiquement le scope si la réconciliation ne conclut
  pas — mieux vaut bloquer trop longtemps que doubler une position.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M22-journal.md`, avec preuve du scénario adversarial
avant/après correction.
Livrables : diffs `reconciliation.ts`, `durable-state.ts`/`exposureFromOrders`, nouveaux appels
client Polymarket pour les trades/fills, tests.
