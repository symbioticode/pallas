# MISSION — PALLAS-M14 — Réconciliation des ordres et cycle de vie local

## 0. Métadonnées
Mission ID : PALLAS-M14
Date de création : 2026-09-10
Auteur / Agent : Claude (planification) — exécution par agent de code au choix
Projet : Pallas
Statut : CLOTUREE — terminée et testée (200/200 verts)
Dépend de : PALLAS-M13 (transaction durable) — clôturée avant de commencer
Source de vérité : `AUDIT-PALLAS-v0.3.md` (F-03, section 4.4) + `AUDIT-PALLAS-v0.2.1.md`
(P0-01, P0-07) + `packages/execution/src/polymarketClient.ts`

## 1. Contexte

**Ce qui existe déjà et fonctionne (à ne pas casser) :** `placeOrder` émet le POST exactement une
fois ; timeout réseau et 5xx deviennent `AmbiguousOrderError` sans retry automatique
(`polymarketClient.ts:284-297`). C'est la bonne discipline de base, confirmée par deux audits
consécutifs.

**Ce qui manque, identifié par les deux audits :**
- Aucun consommateur du canal WebSocket utilisateur authentifié de Polymarket (placements, fills,
  changements d'ordre en temps réel).
- Aucun `getOpenOrders`/`getOrder` pour interroger l'état réel d'un ordre après un
  `AmbiguousOrderError`.
- Aucune procédure automatique de réconciliation au démarrage (reconstruire l'état local à partir de
  ce que l'exchange connaît réellement) ni après une erreur ambiguë.
- Aucun `cancel-all` — Polymarket expose `DELETE /cancel-all`, exploitable même en mode cancel-only,
  primitive de secours absente du "kill path" actuel.
- Le kill switch bloque `validate_trade` mais pas `placeOrder` directement — un appelant pourrait
  en théorie construire et soumettre un ordre sans repasser par le risk engine (§5.3 de v0.3).

**Conséquence concrète documentée :** aujourd'hui, un incident réseau banal (timeout sur un POST)
transforme un cas normal en intervention humaine obligatoire, sans même un outil pour vérifier l'état
réel. C'est un blocker explicite pour tout audit visant "paper trading supervisé".

## 2. Objectif général

Donner à Pallas les moyens de savoir, à tout moment et après tout incident, ce que l'exchange pense
réellement de ses ordres — et un mécanisme de mise en sécurité immédiate (cancel-all) qui ne dépend
pas d'un chemin applicatif fragile.

## 3. Objectifs détaillés

- Implémenter `getOpenOrders`/`getOrder` (lecture authentifiée L2) dans `PolymarketClient`.
- Implémenter une procédure de réconciliation : au démarrage, et systématiquement après un
  `AmbiguousOrderError`, interroger l'exchange sur l'état réel de l'ordre concerné (et, au
  démarrage, sur l'ensemble des ordres ouverts) avant d'autoriser toute nouvelle émission sur le
  même "scope" (même marché/même stratégie).
- Bloquer explicitement toute nouvelle émission d'ordre sur un scope dont la réconciliation n'est
  pas terminée — utiliser la machine d'états introduite par PALLAS-M13 pour matérialiser cet état
  `RECONCILING`.
- Implémenter `cancelAllOrders()` (wrapper de `DELETE /cancel-all`) et le connecter au kill switch :
  activer le kill switch doit, en plus de bloquer `validate_trade`, déclencher un `cancel-all` réel
  (pas seulement bloquer les futures décisions).
- Déplacer une partie de l'enforcement du kill switch au plus près du point d'émission
  (`placeOrder`) plutôt qu'uniquement dans le risk engine — vérifier l'état du kill switch
  directement dans `PolymarketClient` avant tout POST, en plus de la vérification côté risk engine
  (défense en profondeur, pas un remplacement de l'une par l'autre).
- (Optionnel selon budget, sinon documenter comme limite explicite) : consommer le WebSocket
  utilisateur pour une mise à jour en temps quasi réel de l'état des ordres, en complément du
  polling REST de réconciliation.

## 4. Protocole de validation

**Setup** : `npm test` vert (packages/execution) à chaque étape. Idéalement, un test contre un
testnet Polymarket réel pour au moins un cycle complet ordre→ambiguïté simulée→réconciliation.

**Métriques à capter :**
1. Scénario simulé : `placeOrder` timeout → `AmbiguousOrderError` → réconciliation automatique
   interroge l'exchange → l'état local converge vers l'état réel constaté (rempli, ouvert, ou
   inexistant) sans double émission.
2. Test qui vérifie qu'aucune nouvelle émission n'est possible sur un scope en `RECONCILING`.
3. Test qui déclenche le kill switch et vérifie qu'un `cancel-all` réel est appelé, pas seulement un
   blocage des décisions futures.

## 5. Procédure / Étapes

### Partie A — Préparation
- Vérifier la clôture de PALLAS-M13 (dépendance bloquante).
- Lire la documentation Polymarket sur le canal WebSocket utilisateur et l'endpoint `cancel-all`
  (rechercher la version actuelle de la doc, comme fait en PALLAS-M02/M08).

### Partie B — Vérifications préalables
- Écrire les tests de régression (scénarios d'ambiguïté) avant d'implémenter la réconciliation.

### Partie C — Exécution
- Implémenter dans l'ordre : `getOpenOrders`/`getOrder` → réconciliation au démarrage → blocage sur
  scope en cours de réconciliation → `cancel-all` connecté au kill switch → (optionnel) WebSocket.

## 6. Ce que l'agent doit faire
1. Ne jamais permettre une nouvelle émission sur un scope dont l'état réel n'est pas confirmé.
2. Tester le `cancel-all` contre un mock serveur qui vérifie la requête, avant tout testnet réel.
3. Documenter explicitement si le WebSocket temps réel est reporté (limite acceptable pour cette
   itération) plutôt que de le laisser un signal ambigu.

## 7. Critères de succès
- [x] `getOpenOrders`/`getOrder` implémentés et testés (mock serveur au minimum).
- [x] Une réconciliation automatique s'exécute au démarrage et après tout `AmbiguousOrderError`,
      testée par simulation.
- [x] Aucune nouvelle émission n'est possible sur un scope en cours de réconciliation, testé.
- [x] `cancelAllOrders()` existe, testé, et est réellement appelé quand le kill switch s'active.
- [x] Le kill switch est vérifié directement au point d'émission (`PolymarketClient`), pas
      seulement dans le risk engine.

Rapport détaillé : `mission-PALLAS-M14-journal.md`.

## 8. Interdictions
- Ne pas permettre de nouvel ordre après un `AmbiguousOrderError` sans réconciliation préalable
  confirmée.
- Ne pas retirer la vérification du kill switch côté risk engine sous prétexte de l'avoir ajoutée
  côté client — les deux couches sont complémentaires, pas substituables.
- Ne pas tester `cancel-all` avec des clés/fonds réels sans confirmation explicite hors mission.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M14-journal.md`.
Livrables : `polymarketClient.ts` étendu, module de réconciliation, tests, `docs/TRADING.md` mis à
jour avec la procédure réelle (plus la version narrative actuelle sans outil).
