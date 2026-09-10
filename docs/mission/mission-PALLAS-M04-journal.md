# JOURNAL — PALLAS-M04 — Frontières TS/HTTP : validation runtime stricte, retry, idempotence

Statut : **CLÔTURÉE** le 2026-09-09
Agent d'exécution : opencode / big-pickle
Référentiel : `AUDIT-PALLAS-v0.1.md` + mission `mission-PALLAS-M04-frontieres-runtime.md`
Frontières : `packages/risk/src/client.ts` (CLI Rust) + `packages/execution/src/polymarketClient.ts` (API CLOB).

## 1. Tests de régression écrits AVANT la correction (mission §4.5.B)

Les tests des réponses malformées ont été ajoutés en premier ; la phase « rouge » s'est manifestée à
l'ajout des tests par des **erreurs de compilation** prouvant la dépendance au nouveau contrat API :
```
packages/execution/src/polymarketClient.test.ts(3,28): error TS2305: Module './polymarketClient.js' has no exported member 'AmbiguousOrderError'.
packages/execution/src/polymarketClient.test.ts(3,49): error TS2305: Module './polymarketClient.js' has no exported member 'ClobValidationError'.
```
Comportementale du même problème documenté par l'audit : sans schéma, l'ancien `mapMarket` produisait
`Number('not-a-number')` → `NaN` silencieux, et un `clob_token_ids` absent donnait `yesTokenId: null`
sans erreur. Aujourd'hui : rejets explicites (voir §3).

## 2. Vérifications préalables — idempotence CLOB (pas de supposition)

**Recherche doc (2026-09-09)** : docs.polymarket.com/trading/place-orders (référence officielle) et
SDK polymarket-hft / polymarket_client_sdk_v2 (docs.rs). Le corps du POST `/order` ne contient que
`{deferExec, order, orderType, owner, postOnly?}` — **AUCUNE clé d'idempotence** (pas de
`clientOrderId`/`tag`/header). Conséquence : retenter un POST après timeout peut **placer deux ordres** ;
le retry auto est donc interdit, la limite est documentée dans le code (pas de contournement silencieux).

## 3. Point par point (avant → après)

### 3.1 Frontière risk engine — `invoke()` valide le contrat (mission objectif 1)
- **Avant** : `JSON.parse(stdout) as T` après détection `{error}` — cast aveugle ; un JSON structurellement
  différent passait sans vérification.
- **Après** : schémas Zod dans `packages/risk/src/types.ts` (annotés `z.ZodType<T>` pour que le contrat
  TS ne puisse pas diverger du schéma), reflétant le serde réel de `crates/risk-engine/src/main.rs`
  (`DecisionOutput { decision, state }`, `VarOutput { var }`, `RecordOutput { state }`, `ErrorOutput
  { error }`, et tous les sous-objets : TradeDecision/GateResult, StateOutput/CircuitBreakerSnapshot
  (`Closed|HalfOpen|Open`)/VolatilityState, VaRResult — en snake_case, `.strict()`).
- `invoke(input, schema)` : parse JSON → `ErrorResponseSchema` strict (message d'erreur CLI préservé)
  → `schema.safeParse` → échec ⇒ `RiskEngineError` avec les 5 premières violations
  (`<chemin>: <message>`), jamais un objet partiel.
- **Tests** : type faux (`suggested_size_usd: "big"`), champ manquant (`volatility` absent), réponse
  d'erreur CLI, `sample_size` absent sur VaR ⇒ rejet `RiskEngineError`. Les 14 tests client verts y
  compris les 10 existants contre la vraie binaire — preuve que les schémas collent au contrat réel.

### 3.2 Frontière CLOB — schémas Zod avant mapping (mission objectif 2)
- **Nouveau** `packages/execution/src/clobSchema.ts` : `MarketsResponseSchema` (`data[]` avec
  `clob_token_ids` **obligatoire**, `best_bid`/`best_ask` décimaux valides ou null), `OrderbookSchema`
  (buckets `[price, size]` en tuple strict), `PlaceOrderResponseSchema`, `DeriveApiKeyResponseSchema`,
  et `parseClob()` qui lève `ClobValidationError` détaillé.
- `listMarkets` / `getOrderbook` : on parse la réponse **avant** mapping — `Number()` ne s'applique
  qu'à des valeurs déjà validées (aucun chemin vers `NaN`).
- `placeOrder` : réponse validée (orderID requis sinon `ClobValidationError`).
- `deriveApiKey` : apiKey/secret/passphrase validées.
- **Tests** : `best_bid: "not-a-number"`, `clob_token_ids` absent, bucket à 3 éléments ⇒
  `ClobValidationError`.

### 3.3 Retry / idempotence écritures (mission objectif 3)
- **`placeOrder` (POST)** — pas de retry : timeout ou 5xx ⇒ **`AmbiguousOrderError`** explicite
  « requête envoyée, résultat inconnu — l'ordre PEUT avoir été placé, ne pas réémettre sans
  réconciliation ». Un 4xx ou un `success:false` reste un rejet définitif (message d'erreur).
- **`cancelOrder` (DELETE)** — retry backoff (2 tentatives, 200×2^n) sur `TypeError`, timeout/abort et
  5xx : DELETE est idempotent par orderId, re-canceler un ordre déjà annulé est un no-op. Les 4xx
  (ex. 404) restent définitifs, pas de retry.
- **GETs** — retry étendu de `TypeError` seul à `TypeError` + timeout/abort + 5xx.
- **Reconcilier en cas de doute** : la vérification par statut d'ordre (`GET /orders`) n'est pas
  implémentée (endpoint non exposé par le client) ; la lacune est documentée dans le message
  d'`AmbiguousOrderError` et en commentaire `polymarketClient.ts`. L'écriture formelle « impedance »
  ira dans `docs/TRADING.md` (PALLAS-M06).

## 4. Résultats de validation

- `npm test` (pretest `tsc --build`) : **95/95** — 9 fichiers (84 avant M04, +11 : 4 risk + 7 CLOB).
- `npm run typecheck` : vert.
- `cargo test` : inchangé 50/50 (Rust non modifié ; le schéma reproduit le serde réel et les tests
  client contre la binaire le prouvent).
- Métriques mission : (1) 2+ cas de malformation risk rejetés ✔ ; (2) 3 cas de malformation CLOB
  rejetés ✔ ; (3) timeout placeOrder → `AmbiguousOrderError` + fetcher appelé **1 seule fois** ✔,
  retry cancelOrder (3 appels) et non-retry 404 ✔.

## 5. Critères de succès vs mission

- [x] `invoke` rejette explicitement (`RiskEngineError`) toute réponse hors contrat — testé 4 cas
      (type faux, champ manquant ×2, erreur CLI).
- [x] `polymarketClient` rejette toute réponse CLOB malformée avant mapping — testé 3 cas (nombre
      invalide, champ manquant, bucket invalide).
- [x] `placeOrder`/`cancelOrder` : stratégie de retry/idempotence documentée et testée ; limite (pas
      de clé d'idempotence côté API) documentée explicitement, pas contournée.
- [x] Aucune régression — 95/95 verts.

## 6. Livrables

- `packages/risk/src/types.ts` — schémas Zod `z.ZodType<T>` (contrat serde), `ErrorResponseSchema`.
- `packages/risk/src/client.ts` — `invoke(input, schema)`, message de violation détaillé.
- `packages/execution/src/clobSchema.ts` — schémas CLOB + `ClobValidationError` + `parseClob`.
- `packages/execution/src/polymarketClient.ts` — mapping validé (markets/book/derive), `placeOrder`
  ambigu fail-safe, retry `cancelOrder`, GET 5xx/timeout.
- `packages/risk/package.json` + `packages/execution/package.json` — dépendance `zod` déclarée.
- Tests : `client.test.ts` (+4), `polymarketClient.test.ts` (+7).
- `PLAN.md` — Phase 0 (facade risk validée) + §2.1 (robustesse réseau durcie) + tableau M04 ✅.

### Reporter dans M06
- `docs/TRADING.md` : procédure de réconciliation d'un `AmbiguousOrderError` (statut d'ordre avant
  réémission) ; completion du `docs/SECURITY.md` ; CI.