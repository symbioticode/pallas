# JOURNAL — PALLAS-M14 — Réconciliation des ordres et cycle de vie local

Date : 2026-09-11
Agent : big-pickle (opencode) — mission exécutée en autonomie
Statut : TERMINÉE

## Synthèse attentive

Deux audits (v0.3 §5.3 + F-03 4.4, v0.2.1) pointaient la même brèche : après un
`AmbiguousOrderError` (timeout/5xx sur un POST `/order`, sans clé d'idempotence), Pallas
n'avait **aucun moyen** de savoir ce que l'exchange pense réellement de ses ordres — pas de
`getOpenOrders`/`getOrder`, pas de procédure de réconciliation, pas de `cancel-all`, et un
kill switch confiné au risk engine alors qu'un appelant pouvait en théorie émettre sans
repasser par lui.

M14 ferme l'écart en quatre blocs, tous implémentés et testés :

1. **Lectures ordres authentifiées L2** (`getOpenOrders`/`getOrder`) dans `PolymarketClient`.
2. **Réconciliation déterministe** (`reconciliation.ts`) : au démarrage, et automatiquement
   dès qu'un `AmbiguousOrderError` est constaté ; convergence vers la vérité constatée
   (ouvert/rempli/annulé/inexistant) sans jamais inventer de conclusion ni doubler une émission.
3. **Gate de scope** : aucune émission sur un marché portant une empreinte vivante non réglée.
4. **Kill switch en défense en profondeur** : vérifié au point d'émission (`KillSwitchEngagedError`
   dans `placeOrder`) EN PLUS du port `KILL_SWITCH` du risk engine (resté intact) ; à
   l'engagement, `cancelAllOrders()` réel déclenché une seule fois (idempotent), pas seulement
   un blocage des décisions futures.

L'Observatory manifeste chaque correction : panneau DURABILITY · STATE enrichi (LIVE ORDERS,
RECONCILING, badge KILL SWITCH), warnings `RECONCILIATION IN PROGRESS` / `KILL SWITCH ENGAGED`,
résumés d'activité pour `reconcile_scope`/`order_reconciled_on_ambiguity`/`kill_switch_sync`.

## 1. Ce qui était en cause

1. **Aucun consommateur de l'état réel des ordres** : un incident réseau banal (timeout sur un
   POST) transformait un cas normal en intervention humaine obligatoire, sans même un outil
   pour vérifier l'état réel.
2. **Aucune procédure automatique de réconciliation** ni au démarrage ni après ambiguïté —
   la seule issue était de réémettre (risque de double placement) ou d'annuler manuellement.
3. **Kill switch confiné au risk engine** : `validate_trade` était rejeté, mais `placeOrder`
   lui-même ne consultait pas le flag — un appelant hors risk engine pouvait émettre.
4. **Pas de primitive de mise en sécurité immédiate** : `DELETE /cancel-all` n'était pas exposé.

## 2. Ce qui est livré

**`@pallas/execution` :**
- `packages/execution/src/killSwitch.ts` (nouveau) : `getGlobalKillSwitch`/`setGlobalKillSwitch`
  + `KillSwitchEngagedError`. Flag global positionné par l'orchestrateur depuis l'état durable,
  exactement comme `isDryRun` (globals jumeaux, autorités indépendantes — M17 les restreindra).
- `polymarketClient.ts` :
  - `placeOrder` vérifie le kill switch **après** le blocage dry-run et **avant** tout POST
    (défense en profondeur, le port risk `KILL_SWITCH` reste en place) ;
  - `getOpenOrders(maker, { filterState })` → `GET /data/orders` (lecture L2, safe en dry-run) ;
  - `getOrder(orderId)` → `GET /data/order/{id}` (lecture L2) ;
  - `cancelAllOrders()` → `DELETE /cancel-all` (ÉCRITURE : bloquée en dry-run ;
    `success:false` → erreur explicite) ;
  - `ReadOrder` mappé depuis la carte CLOB (`asset_id`/`price`/`size`/`side`/`orderID`/`status`
    options → jamais de valeur inventée) ;
  - option d'injection `isKillSwitchEngaged` (testabilité, sans toucher au global).
- `clobSchema.ts` : `ClobOrderSchema`, `OpenOrdersResponseSchema` (liste paginée `data[]`),
  `CancelAllResponseSchema` (+ `z` importé).

**`@pallas/strategy` :**
- `durable-state.ts` : statut **`RECONCILING`** ajouté à la machine d'états ; `transitionLifecycle`
  accepte `order_id: null` (réconciliation « inexistante ») ;
- `reconciliation.ts` (nouveau) :
  - `isUnresolved`/`isLiveFootprint` : empreintes bloquantes (`SUBMITTING`/`SUBMITTED`/
    `AMBIGUOUS`/`RECONCILING`, `ACKED` sans terminal, `DECIDED` sans outcome) ;
  - `reconcileOrder` : transition durable `→ RECONCILING` (écrite AVANT tout réseau — invariant
    M13) puis preuve (par `order_id` ou scan des ordres ouverts, prix/taille/côté) puis
    convergence idempotente sous verrou → `ACKED` / `TERMINAL filled|cancelled|rejected` /
    `TERMINAL not_found_on_exchange` (id local conservé comme trace) ; réseau cassé → aucune
    conclusion forcée, reste `RECONCILING`, le gate fait barrage ;
  - `reconcileScopeForMarket` : réconcilie tous les non-réglés d'un marché + `clear` ;
  - `reconcileAtStartup` : réconcilie les non-réglés puis **recense les ordres ouverts de
    l'exchange absents de l'état local** en `ACKED` `external_found_at_startup` (exposition
    réelle visible, prépare M15) ;
  - `enforceKillSwitch` : synchronise le flag global depuis l'état durable et, sur engagement,
    émet UN SEUL `cancel-all` (idempotent via `meta.kill_switch_cancelall_called`, jamais
    marqué comme fait si le dry-run l'a bloqué).
- `run-reference-loop.ts` :
  - réconciliation du scope **avant** la décision (si maker/signer fourni), échec réseau loggé
    (`reconcile_scope_error`) et laissé au gate ;
  - **gate de scope sous verrou** : toute empreinte vivante sur `trade.market_id` → cycle refusé
    `rejected_by:['SCOPE_RECONCILING']`, `execution:'not_attempted'`, aucun lifecycle créé ;
  - réconciliation **immédiate** au droit de l'`AmbiguousOrderError` (`order_reconciled_on_ambiguity`),
    échec loggé (`reconcile_after_ambiguity_error`) et état resté `AMBIGUOUS` ;
  - `main()` : `enforceKillSwitch` au démarrage (`kill_switch_sync` au ledger) ;
  - avec signer éphémère (aucun creds L2), la réconciliation est correctement contournée.

**Observatory (`@pallas/observatory`) :**
- `snapshot.ts` : `readDurableState` expose `liveOrders`/`reconcilingOrders`/`killSwitchEngaged`
  (+ note `kill switch ENGAGED`) ; warnings `RECONCILIATION IN PROGRESS` et
  `KILL SWITCH ENGAGED`.
- `render.ts` : métriques LIVE ORDERS / RECONCILING, badge KILL SWITCH, statut RECONCILING
  coloré, résumés d'activité des événements M14.
- `types.ts` étendu.

**Docs :** `docs/TRADING.md` réécrit — procédure réelle de réconciliation + kill switch
deux couches (délivrable exigé par la mission §9).

## 3. Tests ajoutés

**`packages/execution` — `polymarketClient.test.ts` (+7) :**
- kill switch : `placeOrder` → `KillSwitchEngagedError` sans aucun POST ; désengagé → OK ;
  injection `isKillSwitchEngaged` sans toucher au global ;
- `getOpenOrders` : URL `/data/orders?maker=..&filter_state=open`, HMAC L2 recalculé à la main
  (node:crypto), mapping `ReadOrder` ; lecture autorisée en dry-run ; refus sans creds en live ;
- `getOrder` : `/data/order/{id}`, HMAC L2, mapping ;
- `cancelAllOrders` : bloqué en dry-run / sans creds ; live `DELETE /cancel-all` avec HMAC ;
  `success:false` → erreur (`cancel-all refuse`).

**`packages/strategy` — `reconciliation.test.ts` (+11) :**
- convergence `AMBIGUOUS`→`ACKED` par scan ouvert ; introuvable → `TERMINAL cancelled
  not_found_on_exchange` ; `order_id` connu + `getOrder` open/filled/404 ; réseau 500 →
  reste `RECONCILING`, aucune conclusion forcée, scope barré ; **invariant M13** (l'état est
  `RECONCILING` durable quand le scan part) ;
- gate de scope : empreinte vive ACKED-ouvert → cycle `rejected` SCOPE_RECONCILING, aucun
  ordre doublé ; AMBIGUOUS résolu TERMINAL → scope libéré, le cycle émet ;
- `AmbiguousOrderError` → réconciliation IMMÉDIATE converge `ACKED` (`order_reconciled_on_ambiguity`
  au ledger) et le scope reste barré ;
- `reconcileAtStartup` : ordre externe absent de l'état local recensé `ACKED external_found_at_startup` ;
- `enforceKillSwitch` : désengagé → sync global false sans cancel ; engagement → cancel appelé
  UNE fois (idempotent, jamais de second) ; dry-run → bloqué et non marqué fait (retentable en live).

**`packages/observatory` — `observatory.test.ts` (+1) :** compteurs live/reconciling, badge
kill switch, note d'engagement.

**Chiffres :** 200 tests verts (17 fichiers), `npm run build` propre.

## 4. Écarts / limites assumées (transparences)

1. **Pas de WebSocket utilisateur temps réel** (optionnel de la mission §3, explicitement
   reporté) : la réconciliation est REST/polling. Limite documentée dans le journal — le
   comportement reste sûr (gate + cancel-all) sans temps réel.
2. **Fenêtre « ordre réel sans trace » testée au niveau store, pas via `placeOrder` live** :
   la passerelle `signatureSchemaValidated` reste fermée (décision M13) ; le scénario
   d'intégration `AmbiguousOrderError` est donc joué avec `placeOrder` espionné (la vraie 5xx
   est testée dans `@pallas/execution`).
3. **Réconciliation ≠ retry** : converger vers `ACKED` pour un ordre déjà ouvert ne le
   remplace pas ; `reconcileAtStartup` ne ré-émet jamais rien.
4. **`getOpenOrders` demande l'adresse `maker`** : si aucun signer fourni (mode éphémère),
   la réconciliation est contournée et le gate reste la protection (aucun ordre neuf tant
   qu'une empreinte vit).
5. **`cancelAllOrders` sans creds en live échoue (requireAuth)** : c'est voulu — la sortie
   de secours exige des identifiants L2 valides, faute de quoi le kill switch reste un
   blocage pur (défense minimale honnête).

## 5. Vérifications

- `npm run build` propre ; `npm test` : 200/200.
- Fumée réelle dans `/tmp/pallas-m14-smoke` (risk engine réel + dry-run) : `kill_switch_sync`
  loggué (`engaged:false, cancelAll:not_needed`), ledger valide, aucune émission.
- Le risque persisté réel (`.pallas/risk-state.json` v2) reste inchangé — indépendance des
  tests.

## 6. Apprentissage / réutilisable

- Le pattern **gate de scope sous verrou** élargit la machine M13 : la décision EVALUÉE par le
  risk engine n'est pas suffisante ; l'ÉTAT local des ordres est une seconde autorité. M15
  (exposition portefeuille) prolongera cette lecture de l'état.
- `enforceKillSwitch` montre l'idempotence à n+1 : la preuve de sortie (meta flag) est
  persistée DURABLEMENT, et seulement si l'écriture a réellement eu lieu.

## 7. Critères de succès (mission §7)

- [x] `getOpenOrders`/`getOrder` implémentés et testés (mock serveur + HMAC recalculé).
- [x] Réconciliation automatique au démarrage ET après tout `AmbiguousOrderError`, testée.
- [x] Aucune nouvelle émission possible sur un scope en cours de réconciliation, testée.
- [x] `cancelAllOrders()` existe, testé, réellement appelé quand le kill switch s'active.
- [x] Kill switch vérifié au point d'émission (`PolymarketClient`) ET côté risk engine
      (`KILL_SWITCH` intact) — défense en profondeur, pas de substitution.