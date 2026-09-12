# JOURNAL — PALLAS-M08 — Wire Polymarket V2 : `taker`, comparaison aux clients officiels V2

> Clôturée le 2026-09-10. Vérifie l'audit `AUDIT-PALLAS-v0.2.md` (2.4). **Prémisse RÉFUTÉE** :
> aucun client officiel V2 n'émet `taker` pour un ordre standard. Le wire Pallas est conforme ;
> la mission se referme en preuve de conformité + décision de scope + ré-enregistrement de l'écart
> annexe réel (type JSON de `salt`).

## 1. Synthèse

La mission exigeait de comparer le wire Pallas aux clients officiels **actuels** cités par
l'audit. La lecture du **code source réel** des trois clients V2 (`clob-client-v2`,
`py-clob-client-v2`, `rs-clob-client-v2`) infirme la prémisse : le champ `taker` que l'audit a
vu dans `polymarket-js` / `py-clob-client` / `rs-clob-client` appartient au **schéma V1**
(avec `nonce` et `feeRateBps`), pas au formulaire V2. Pallas signe/émet le formulaire V2 —
aucune correction de champ nécessaire.

Résultats : +5 tests (comparaison struct signée, corps wire BUY/SELL, champs optionnels, type
`salt`), `polymarketSigner.ts` enrichi (sources officielles + SHA + réfutation + scope EOA),
`docs/TRADING.md` section scope, mission notée RÉFUTÉE, `PLAN.md` M08 ✅. `signatureSchemaValidated`
reste `false` (rien à émettre ni à ouvrir).

## 2. Preuve par client officiel (source exacte, vérifiée le 2026-09-10)

### 2.1 TypeScript — `Polymarket/clob-client-v2`
- Commit épinglé : **`49083a618be70d6a86e15a94fac44037c3f7f616`** (main actuel re-vérifié :
  identique).
- `src/types/ordersV2.ts` — `orderToJsonV2` pose `taker: order.taker` dans le littéral… mais
  `src/order-utils/model/orderDataV2.ts` — `interface OrderV2` n'a **pas** de champ `taker`.
  Résultat : `order.taker === undefined` → clé **jetée par `JSON.stringify`**. Le corps HTTP réel
  ne contient pas `taker`.
- `src/order-utils/model/ctfExchangeV2TypedData.ts` — `CTF_EXCHANGE_V2_ORDER_STRUCT` = 11 champs,
  **exactement** ceux de `POLYMARKET_ORDER_TYPES.Order` (testé).

### 2.2 Python — `Polymarket/py-clob-client-v2` (main)
- `py_clob_client_v2/order_utils/model/order_data_v2.py` — `order_to_json_v2` : le dict `order`
  a **13 clés, sans aucun `taker`** (le plus explicite des trois).

### 2.3 Rust — `Polymarket/rs-clob-client-v2` (main)
- `src/clob/order_builder.rs` : branch `version == 1` → `OrderV1` avec `taker` (+ `nonce`,
  `feeRateBps`) → **V1 only** ; branches `2 | 3` → `OrderV2` = les 11 champs signés, **sans
  `taker`** (« taker » ne subsiste que dans les corps **RFQ** — `AcceptRfqQuoteRequest`,
  `ApproveRfqOrderRequest` dans `src/clob/types/request.rs` — un flux séparé — et dans des
  réponses/fees).

### 2.4 Conclusion de la réfutation

La prémisse de l'audit v0.2 reposait sur des repos **V1**. Les trois clients **V2** officiels
émettent le même corps `order` que Pallas (13 clés : `salt`, `maker`, `signer`, `tokenId`,
`makerAmount`, `takerAmount`, `side`, `signatureType`, `timestamp`, `expiration`, `metadata`,
`builder`, `signature`) — quant au champ `taker`, la condition « conforme au comportement des
clients officiels » est sa **non-émission**.

## 3. Écart annexe réel identifié : le type JSON de `salt`

Les trois officiels divergent entre eux :
- TS `parseInt(order.salt, 10)` → **nombre** ; Python `int(order.salt)` → **nombre** ;
- Rust `OrderV2.salt: U256` (sérialisé via Alloy) → **string** (décimal) ;
- Pallas → **string** (ligne `buildSignedOrderPayload`, `typed.salt.toString()`).

Le commentaire de `randomSalt` (« serialize en nombre JSON sur le wire ») était en retard sur
le code. Décision : **aucune correction** — Pallas rejoint le client Rust officiel, le format
string est sans perte pour les salts < 2^53 (`randomSalt` borné), et ni TS ni Python n'offrent
l'avantage sur les grands salts. Documenté dans le test `M08: salt emis en string …`.

## 4. Décision de scope : EOA uniquement (sorted comme anticipé par la mission §1)

- `signatureType` = 0 (EOA) par défaut, seul mode **validé et testé** de bout en bout.
- Le champ est transmis tel quel (passthrough) si un appelant force 1/2/3, mais **POLY_1271
  (deposit wallet, signatureType 3) n'est pas supporté** : l'enveloppe 1271 des wallets
  email/proxy n'est pas implémentée — une signature non-EOA produite ici n'aurait pas la bonne
  forme. Risque réel documenté (une telle émission serait refusée, pas un risque financier
  silencieux).
- Documenté : header `polymarketSigner.ts` (§ SCOPE SIGNATURE) + `docs/TRADING.md` (section
  nouvelle « Scope signature et wire V2 »).

## 5. Métriques captées (protocole §4)

1. Diff champ par champ payload Pallas ↔ référence officielle, BUY **et** SELL : **zéro
   divergence** (hors signature, asserée séparément). ✓
2. Sémantique exacte du « `taker` officiel » : documentée source + commit (section 2) — le champ
   n'existe pas dans le wire V2 ; c'est la non-émission qui est conforme. ✓
3. Décision de scope EOA vs proxy/POLY_1271 : **EOA-only**, documentée dans le code et
   `docs/TRADING.md`. ✓

## 6. Tests ajoutés (`packages/execution/src/polymarketSigner.test.ts`, +5)

| Test | Vérifie |
|------|---------|
| `M08: la structure signee == CTF_EXCHANGE_V2_ORDER_STRUCT officiel (11 champs)` | `POLYMARKET_ORDER_TYPES.Order` (nom+type, 11) == struct officielle épinglée |
| `M08: wire BUY — corps identique au client officiel V2, aucune cle taker` | corps `order` (hors signature) == `order_to_json_v2` Python transcrite, calculée depuis les entrées brutes ; 13 clés exactes ; `'taker' in order === false` |
| `M08: wire SELL — flux inverses, memes cles officielles, aucune cle taker` | idem pour SELL (maker/taker inversés) |
| `M08: wire valides tous les champs optionnels (GTD, metadata, builder) vs officiel` | expiration GTD + metadata/builder non-zéro == référence |
| `M08: salt emis en string — conforme au client Rust officiel (TS/Python emettent un nombre)` | `typeof p.order.salt === 'string'`, `Number()` == salt, divergence officiels documentée |

La référence wire est transcrite du code source Python (fonction `order_to_json_v2`) en dur
dans le test, avec source + commit dans le commentaire — même approche que le hasher de
référence viem de la suite (déterministe, sans réseau au run).

## 7. Preuves

- `npm test` : **113 passed** (9 files). Avant M08 : 108. Delta : **+5** (exécution, tous dans
  `polymarketSigner.test.ts`).
- `tsc --build` : OK.
- Fichier de test seul : `polymarketSigner.test.ts` 26 tests.

## 8. Limites / réserves restantes

- Validation du schéma contre une API **live testnet** toujours ouverte (porte `schemaGate`
  v1, procédure PHASE-2.2) — hors M08, l'écart de wire n'était pas le blocage supposé.
- Remarque : le test « body POST /order » de `polymarketClient.test.ts` continue de valider la
  sérialisation complète côté client (`order: signed.order`, sans transformation) — conforme.
- `POLY_1271` (deposit wallet) : non supporté, documenté (section 4) — suivre à la Phase 3 si
  un wallet email/proxy devient un cas d'usage.

## 9. Liste des fichiers touchés

- `packages/execution/src/polymarketSigner.ts` — header : sources officielles V2 + SHA,
  réfutation, scope EOA (pas de changement de wire).
- `packages/execution/src/polymarketSigner.test.ts` — +5 tests M08 (section dédiée).
- `docs/TRADING.md` — section « Scope signature et wire V2 (PALLAS-M08) » + date du header.
- `docs/mission/mission-PALLAS-M08-wire-taker.md` — statut CLÔTURÉE (RÉFUTÉE), §10 Verdict.
- `PLAN.md` — tableau v0.2 : M08 ✅.