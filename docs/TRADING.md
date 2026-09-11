# Trading — Pallas — comportement attendu

**Date :** 11 septembre 2026 — état aligné sur le code réel (PALLAS-M01..M15).
Sujet en lien : `packages/execution/src/polymarketClient.ts`, missions `PALLAS-M04`
(validation runtime + retry + idempotence), `PALLAS-M08` (wire et scope signature),
`PALLAS-M13` (transaction durable), `PALLAS-M14` (réconciliation des ordres),
`PALLAS-M15` (risque de portefeuille — limites opérateur, exposition réelle).

## Scope MVP

- **Polymarket uniquement**, un seul channel (WebChat) prévu — pas encore implémenté.
- **Dry-run par défaut** : aucune écriture n'est possible tant que le dry-run global est actif.
  Lectures (markets, orderbook, **ordres ouverts du maker**) autorisées. Désactivation = confirmation
  explicite "LIVE".
- **Résilience réseau :** GETs et `cancelOrder` retentent les erreurs transitoires
  (TypeError, timeout/abort, HTTP 5xx) avec backoff exponentiel (200 ms × 2^n, 2 tentatives).

## Timeout / réponse indéterminée sur `placeOrder` (le cas à connaître)

L'API CLOB Polymarket **n'offre aucune clé d'idempotence** (corps POST `/order` =
`{deferExec, order, orderType, owner, postOnly?}`). Conséquences, implémentées et testées :

- `placeOrder` **ne retente jamais** : un timeout réseau ou une réponse HTTP 5xx signifie
  que la requête **a pu être reçue et exécutée** par l'exchange, sans qu'on en connaisse le
  résultat. L'appel lève `AmbiguousOrderError` (fail-safe) : « l'ordre PEUT avoir été placé,
  ne pas réémettre sans réconciliation ».
- **Ne PAS réémettre l'ordre dans ce cas.** Réémettre peut placer **deux** positions.

## Réconciliation des ordres (PALLAS-M14 — implémentée et automatique)

Le client expose maintenant les trois primitives qui manquaient, toutes authentifiées L2 :

- `getOpenOrders(maker, { filterState })` → `GET /data/orders` (lecture, autorisée en dry-run) ;
- `getOrder(orderId)` → `GET /data/order/{orderId}` (lecture) ;
- `cancelAllOrders()` → `DELETE /cancel-all` (ÉCRITURE : bloquée en dry-run, primitive de
  mise en sécurité du kill switch).

Avec `PALLAS-M13` (état durable versionné + checksummé + machine d'états
DECIDED→SUBMITTING→AMBIGUOUS/ACKED→TERMINAL) et le module `reconciliation.ts`
(`@pallas/strategy`), le comportement est **déterministe** :

1. **À la détection d'un `AmbiguousOrderError`** : l'état passe durablement en `AMBIGUOUS`
   puis la réconciliation est déclenchée immédiatement.
2. **Au démarrage** (`reconcileAtStartup`) : tous les ordres locaux non réglés sont réconciliés,
   et les ordres **ouverts de l'exchange absents de l'état local** sont recensés comme `ACKED`
   « externes » (exposition réelle visible pour la suite).
3. **Convergence** : chaque ordre non réglé est interrogé chez l'exchange (par `order_id` si
   connu, sinon par scan des ordres ouverts à prix/taille/côté) puis converge vers la vérité
   constatée : `ACKED` (ouvert), `TERMINAL` rempli/annulé/rejeté, ou `TERMINAL cancelled
   not_found_on_exchange`. Jamais de double émission, jamais de conclusion inventée.
4. **Gate de scope** : AUCUNE nouvelle émission n'est possible sur un marché tant qu'il porte une
   empreinte vivante non réglée (`SUBMITTING`/`SUBMITTED`/`AMBIGUOUS`/`RECONCILING`/`ACKED`
   sans terminal). Le cycle est refusé `rejected_by:['SCOPE_RECONCILING']`, `execution:
   not_attempted`.

### Kill switch — deux couches, une sortie panic

- **Côté risk engine** (port `KILL_SWITCH`, `pipeline.rs`) : toute nouvelle décision est rejetée.
- **Côté point d'émission** (`KillSwitchEngagedError` dans `placeOrder`) : aucune émission ne part,
  même si un appelant contournait le risk engine (défense en profondeur).
- À l'engagement (persisté dans l'état durable), l'orchestrateur déclenche **un `cancelAllOrders()`
  réel** (idempotent via `meta.kill_switch_cancelall_called` — jamais deux fois pour un même
  engagement), pas seulement un blocage des décisions futures.

### `cancelOrder` — DELETE idempotent

`DELETE /order/{orderId}` est idempotent : annuler un ordre déjà annulé/inconnu est un
no-op. Les erreurs transitoires (réseau, timeout, 5xx) sont donc retentées ; les erreurs
4xx (404…) sont définitives et remontées telles quelles.

## Risque de portefeuille (PALLAS-M15 — limites opérateur + exposition réelle)

Le risk engine est maintenant un véritable gestionnaire de risque de portefeuille :

- **Limites hors stratégie (`RiskConfig`).** `bankroll_usd`, `max_order_usd`,
  `max_portfolio_exposure_usd`, `max_drawdown_usd`, `max_concentration_usd`,
  `half_open_probe_size_usd`, `var_min_observations`, `var_startup_envelope_usd` et
  `max_market_data_age_ms` vivent dans `RiskConfig` (opérateur, chargée via variables
  d'environnement ou configuration). Le `TradeRequest` ne contient plus AUCUNE limite —
  il est une pure intention. En cas d'envoi malveillant de champs limites par l'appelant,
  `#[serde(deny_unknown_fields)]` (Rust) rejette l'entrée dès la désérialisation.
- **Exposition réelle cumulée.** L'état du risk engine transporte `exposure` (positions +
  ordres ouverts calculés par le cycle depuis `doc.orders`, réconciliation M14). La porte
  `POSITION_LIMIT` compare le total **après exécution** (cumul existant + nouvel ordre) à la
  limite, pas seulement la valeur de l'ordre isolé.
- **Concentration par marché.** Une seconde borne `CONCENTRATION_LIMIT` limite l'exposition
  cumulée sur un même `market_id`.
- **Circuit breaker `HalfOpen`.** Trois cas sont distingués : `Closed` (normal), `HalfOpen`
  (autorise uniquement une sonde de taille limitée par
  `half_open_probe_size_usd`), `Open` (rejet total). `HalfOpen` ne traite plus les trades
  comme normaux.
- **`VaR/CVaR` — `ESTIMATED` vs `INSUFFICIENT_DATA`.** Moins de `var_min_observations`
  observations → statut `INSUFFICIENT_DATA`, politique d'enveloppe de démarrage (jamais
  « risque nul » silencieux).
- **Garde de fraîcheur (`market_data_age_ms`).** Un ordre dont la donnée de marché a plus
  de `max_market_data_age_ms` ms est rejeté `MARKET_DATA_FRESHNESS`.

## Scope signature et wire V2 (PALLAS-M08, 2026-09-10)

- **Wire V2 conforme aux clients officiels** (`clob-client-v2`, `py-clob-client-v2`,
  `rs-clob-client-v2` — sources et commits cités dans le journal M08) : le corps `order` du POST
  `/order` a exactement les 13 clés officielles et **n'a pas de champ `taker`**. L'assertion de
  l'audit v0.2 reposait sur les clients **V1** (`polymarket-js`, `py-clob-client`,
  `rs-clob-client`) où `taker`/`nonce`/`feeRateBps` existent. Vérifié par comparaison directe
  (tests M08 dans `polymarketSigner.test.ts`).
- **Scope signature : EOA uniquement.** `signatureType` default = 0 (EOA) ; c'est le seul mode
  validé et testé de bout en bout. **PALLAS-M17 : tout `signatureType` ≠ 0 (PROXY/SAFE/
  DEPOSIT_WALLET, dont POLY_1271) est rejeté à la construction** dans `buildSignedOrderPayload`
  (erreur explicite) — jamais transmis silencieusement.
- **Montants : algorithme officiel de rounding par tick** (PALLAS-M17) : port fidèle de
  `py-clob-client-v2` (le client TS officiel délègue le rounding à l'appelant) — `tick_size`
  accepté : 0.1/0.01/0.005/0.0025/0.001/0.0001, défaut 0.01. La taille est tronquée (round_down),
  le prix arrondi normal, le montant monétaire borné up puis down au plafond officiel.
- La validation du schéma contre une API live (testnet) reste une étape distincte, verrouillée
  par `schemaGate` (`signatureSchemaValidated=false`).

## Journal d'audit — signature séparée (PALLAS-M16)

Le `run-reference-loop` écrit chaque évènement dans `ledger.json` (chaîne SHA-256). La signature
est **séparée du process écrivain** : signer périodiquement, hors-session :

```
npm run sign-ledger -- gen --dir ~/.pallas/keys        # une seule fois : clé privée 0600
npm run sign-ledger -- sign --key ~/.pallas/keys/ledger.key --ledger .pallas/ledger.json
```

Le run loop ne détient que la clé publique — via `PALLAS_LEDGER_PUB_KEY` (PEM inline ou chemin
de fichier). Si elle est fournie, le mode est strict : absence ou incohérence de `.sig` au
chargement = arrêt (fail-stop), jamais de démarrage silencieux. Semantique d'ancrage **préfixe** :
une chaîne honnête peut s'étendre après le dernier checkpoint signé (signature périodique) ;
toute troncature ou réécriture d'une partie signée est détectée. Après un incident, un opérateur
check `ledger.json.sig` / l'Observatory (`SIGNED`/`UNSIGNED`/`SIGNATURE INVALID`) avant toute
confiance dans le journal.

## Règles de conduite

- Jamais de double-émission sans réconciliation (voir plus haut).
- Toute écriture est signée EIP-712 V2 ; le schéma de signature doit être validé contre
  l'API live avant toute émission (`schemaGate` — fail-closed).
- Les secrets ne sortent jamais du vault chiffré en clair vers un fichier ; ils restent des
  strings JS en mémoire (risque remonté dans `docs/SECURITY.md`).

## Lien

- Protections et réserves sécurité : `docs/SECURITY.md`.
- Détail de la réconciliation : `packages/strategy/src/reconciliation.ts` + journal
  `docs/mission/mission-PALLAS-M14-journal.md`.
- Détail du risk engine (portefeuille, gates) : `crates/risk-engine/src/pipeline.rs` +
  `packages/risk/src/types.ts` + `packages/strategy/src/reconciliation.ts` +
  journal `docs/mission/mission-PALLAS-M15-journal.md`.
- État du plan et missions : `PLAN.md` + `docs/mission/`.