# MISSION — PALLAS-M08 — Wire Polymarket V2 : champ `taker` manquant, comparaison clients officiels

## 0. Métadonnées
Mission ID : PALLAS-M08
Date de création : 2026-09-09
Auteur / Agent : Claude (planification) — exécution par agent de code au choix
Projet : Pallas
Statut : CLÔTURÉE — 2026-09-10 — prémisse RÉFUTÉE (voir §10 Verdict, journal `mission-PALLAS-M08-journal.md`)
Source de vérité : `AUDIT-PALLAS-v0.2.md` (section 2.4, "Ordres et authentification : primitives
corrigées, wire V2 incomplet, live fermé") + `packages/execution/src/polymarketSigner.ts`

## 1. Contexte

**Ce qui a été fait (PALLAS-M02, clôturée) :** les 6 constats critiques du premier audit sont
corrigés et vérifiés : `domainSeparator` conforme, `signatureType` sur 32 octets, montants BUY/SELL
dans le bon sens, vecteurs de référence externes (Ether Mail officiel + viem), auth L1/L2 câblée,
`signedOrdersValidated` remplacé par une porte fail-closed verrouillée (`schemaGate.ts`).

**Ce que révèle l'audit v0.2, non couvert par M02 :** le wire V2 **officiel** actuel (clients
TypeScript, Python et Rust de Polymarket, vérifiés par l'auditeur aux sources citées en fin de
rapport) sérialise un champ `taker` dans l'objet `order` du corps HTTP — **même si `taker` n'est pas
un des onze champs signés EIP-712**. Pallas n'a aucun champ `taker` dans `SignedOrderPayload` et ne
l'émet jamais (`polymarketSigner.ts:434-452, 516-531`). Les tests locaux ne détectent pas cet écart
car ils valident les fixtures internes du projet, pas un payload complet comparé à un client
officiel.

**Pourquoi ce n'est pas (encore) une urgence financière, mais reste critique à corriger :**
`signatureSchemaValidated` reste verrouillée à `false` dans `schemaGate.ts` (aucune fonction
publique ne peut la lever) — donc ce payload incomplet ne peut pas être émis par `placeOrder` en
l'état. Le risque est différé, pas actif. Mais c'est précisément le point qui bloquerait toute
tentative légitime de lever la porte de validation live : tant que le wire diverge des clients
officiels, aucune validation testnet n'a de sens.

**Autres lacunes notées par l'audit v0.2, à couvrir dans la même mission (même famille de risque) :**
- Seul le mode EOA (`signatureType`) est produit par défaut ; pas de prise en charge visible du
  format enveloppé `POLY_1271` des deposit wallets V2 (`polymarketSigner.ts:482-510`) — les wallets
  email/proxy ne sont pas validés.
- Aucun ordre ni dérivation de clé n'a jamais été testé contre une API live/staging avec de vrais
  credentials (cohérent avec la porte fermée, mais à garder en tête comme prochaine étape après
  cette mission).

## 2. Objectif général

Aligner le wire d'ordre V2 de Pallas sur les clients officiels Polymarket actuels (champ `taker`
inclus, variantes de signature nécessaires), avec preuve par comparaison directe — pas seulement
par cohérence interne — avant d'envisager toute levée de la porte de validation live.

## 3. Objectifs détaillés

- Rechercher et lire le code source des clients officiels **actuels** cités par l'audit v0.2
  (TypeScript `clob-client-v2/src/types/ordersV2.ts`, Python `py-clob-client-v2`, Rust
  `rs-clob-client-v2`) pour confirmer exactement : la présence et la forme du champ `taker`, sa
  valeur attendue (probablement `0x0000...0000` par défaut, une adresse de contrepartie spécifique
  en take-or-fill privé — à vérifier, pas supposer), et sa place dans le corps HTTP (hors des 11
  champs signés, ou ailleurs).
- Ajouter le champ `taker` à `SignedOrderPayload.order` (et au type `OrderToSign` uniquement si la
  doc/le code officiel confirme qu'il fait partie du typed data signé — sinon le garder hors du
  digest, cohérent avec le fait qu'il n'apparaît pas dans `POLYMARKET_ORDER_TYPES.Order`).
- Écrire un test qui compare le JSON complet produit par `buildSignedOrderPayload` (hors signature,
  qui dépend de la clé) à un JSON de référence construit à partir d'un des clients officiels, champ
  par champ, pour un même jeu d'entrées.
- Vérifier explicitement si `signatureType` EOA suffit pour le scope MVP actuel (wallet
  Ethereum/Polygon direct, pas de proxy) — si oui, documenter ce choix de scope explicitement dans
  le code et `docs/TRADING.md` plutôt que de laisser un doute implicite sur la prise en charge
  `POLY_1271`.
- Ne PAS lever `signatureSchemaValidated` dans cette mission — cette mission ferme l'écart de wire,
  la validation live testnet reste une étape ultérieure distincte et explicitement confirmée par
  l'utilisateur.

## 4. Protocole de validation

**Setup** : `npm test` vert (packages/execution) à chaque étape.

**Métriques à capter :**
1. Diff champ par champ entre le payload Pallas et le payload d'un client officiel pour un ordre
   BUY et un ordre SELL identiques — zéro divergence non expliquée.
2. Confirmation documentée (source + date) de la sémantique exacte du champ `taker`.
3. Décision de scope documentée sur EOA-only vs support proxy/POLY_1271.

## 5. Procédure / Étapes

### Partie A — Préparation
- Lire les 3 sources officielles citées par l'audit v0.2 (liens en fin de rapport) avant de coder.
- Relire `polymarketSigner.ts` en entier avec cette question précise en tête : "qu'est-ce qui
  diverge du client officiel, pas seulement qu'est-ce qui est interne-cohérent".

### Partie B — Vérifications préalables
- Construire manuellement (script scratch, comme fait en M02 avec viem) un payload de référence via
  un client officiel pour un ordre fixe, et le comparer champ par champ au payload actuel de Pallas
  AVANT de corriger, pour confirmer précisément l'écart (juste `taker`, ou d'autres champs aussi ?).

### Partie C — Exécution
- Ajouter `taker`, réécrire les tests de wire complet, documenter le scope EOA-only si retenu.

## 6. Ce que l'agent doit faire
1. Vérifier contre le code source réel des clients officiels, pas contre la documentation prose
   (qui peut être en retard sur le code, comme le montre déjà l'historique EIP-712 V1→V2 de M02).
2. Ne pas élargir le scope à la prise en charge complète des wallets proxy si ce n'est pas
   nécessaire pour le MVP — documenter la limitation plutôt que la complexifier sans besoin réel.
3. Ne jamais lever `signatureSchemaValidated` dans le cadre de cette mission.

## 7. Critères de succès
- [ ] Le champ `taker` est présent dans `SignedOrderPayload.order` avec une valeur conforme au
      comportement des clients officiels, testé par comparaison directe.
- [ ] Un test compare le JSON complet (hors signature) à un payload de référence construit à partir
      d'un client officiel, pour au moins un ordre BUY et un ordre SELL.
- [ ] Le scope de prise en charge des types de signature (EOA seul, ou EOA + proxy) est documenté
      explicitement dans le code et `docs/TRADING.md`, pas laissé implicite.
- [ ] `signatureSchemaValidated` reste `false` à la fin de cette mission.
- [ ] Aucune régression sur les tests existants (`npm test` vert).

## 8. Interdictions
- Ne pas lever `signatureSchemaValidated` dans le cadre de cette mission, même après correction.
- Ne pas se fier uniquement à la documentation prose Polymarket sans vérifier le code source réel
  des clients officiels cités par l'audit.
- Ne pas ajouter de support pour des types de signature non nécessaires au MVP sans les tester
  aussi rigoureusement que EOA (mieux vaut documenter une limite que la coder à moitié).

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M08-journal.md`, avec la source exacte (URL + commit/version)
de chaque référence officielle utilisée pour la comparaison.
Livrables : diff `polymarketSigner.ts` (+ éventuellement `polymarketClient.ts` si le body HTTP
change), tests de comparaison, `docs/TRADING.md` mis à jour sur le scope de signature.

## 10. Verdict d'exécution — 2026-09-10 : prémisse RÉFUTÉE, wire déjà conforme

La section 1 supposait un champ `taker` dans le wire V2 officiel. **Lecture du code source réel
des 3 clients officiels V2 (pas de la prose) → verdict inverse : aucun client V2 n'émet `taker`
pour un ordre standard.** L'audit citait les repos **V1** (`polymarket-js`, `py-clob-client`,
`rs-clob-client`) où `taker`/`nonce`/`feeRateBps` existent bel et bien.

### Preuve (3 clients officiels, URL + commit)
- **TypeScript** `Polymarket/clob-client-v2` @ `49083a61` (main actuel identique) :
  `src/types/ordersV2.ts` `orderToJsonV2` contient `taker: order.taker`, mais
  `src/order-utils/model/orderDataV2.ts` `OrderV2` n'a **pas** de champ `taker` → `undefined` →
  clé jetée par `JSON.stringify` (jamais sur le fil).
- **Python** `Polymarket/py-clob-client-v2` @ main : `order_utils/model/order_data_v2.py`
  `order_to_json_v2` = 13 clés `order`, **aucun `taker`** (la preuve la plus nette).
- **Rust** `Polymarket/rs-clob-client-v2` @ main : `src/clob/order_builder.rs` — `OrderV1`
  (V1 only) a `taker` ; `OrderV2` (versions 2|3) = les **11 champs signés**, sans `taker`
  (le `taker` restant n'apparaît que dans les corps **RFQ**, flux séparé).

### Découvertes / décisions
1. **Divergence mineure annexe identifiée : type JSON de `salt`.** TS et Python officiels
   l'émettent en **nombre** ; Rust officiel en **string**. Pallas émet **string** (sûr pour les
   salts < 2^53, conforme au client Rust) → documenté et testé, aucune correction.
2. **Scope signature : EOA-only acté** (comme anticipé par la mission §1) — `signatureType`
   passthrough, **POLY_1271 non supporté** (enveloppe 1271 non implémentée), documenté dans le
   code (`polymarketSigner.ts` header) et `docs/TRADING.md`.
3. **`signatureSchemaValidated` reste `false`** — aucune correction n'a modifié la forme du wire
   (rien à ajouter) ; la porte n'est pas touchée.

### Critères de succès (§7) — état
- [x] *« `taker` présent … »* → **RÉFUTÉ** : l'absence de `taker` EST la conformité. Testé par
      comparaison directe (clés + valeurs) pour un ordre BUY et SELL.
- [x] Test de comparaison JSON complet (hors signature) vs référence construite depuis un client
      officiel (Python `order_to_json_v2`, transcrite du code source) — BUY **et** SELL.
- [x] Scope signature documenté explicitement dans le code et `docs/TRADING.md`.
- [x] `signatureSchemaValidated` reste `false` en fin de mission.
- [x] Aucune régression (`npm test` vert, détails dans le journal).
