# JOURNAL — PALLAS-M02 — Signature Polymarket EIP-712 : correction et validation officielle

Statut : **CLÔTURÉE** le 2026-09-09
Agent d'exécution : opencode / big-pickle
Référentiel : `AUDIT-PALLAS-v0.1.md` §2 + mission `mission-PALLAS-M02-polymarket-signature.md` (6 points).

## 1. Sources consultées (2026-09-09) — documentées comme exigé

| Source | URL | Ce qui change vs le code d'origine |
|---|---|---|
| Place orders — schéma V2 | docs.polymarket.com/trading/place-orders | L'API actuelle est **EIP-712 V2** : domaine version **"2"**, `verifyingContract` = exchange STD `0xE111180000d2663C0091e4f400237545B87B996B` / NEG `0xe2222d279d744050d28e00520010520000310F59` ; **11 champs signés** (salt, maker, signer, tokenId, makerAmount, takerAmount, side, signatureType, timestamp, metadata, builder) — **PLUS de taker/nonce/feeRateBps/expiration** dans le signed data (expiration uniquement au wire, "0" = GTC) ; montants 6 dp avec BUY maker=USD / SELL maker=shares ; wire POST `/order` body `{deferExec, order, orderType, owner=apiKey, postOnly?}`. |
| Getting started API — auth | docs.polymarket.com/getting-started/api | L1 creds = **EIP-712 `ClobAuth`** (domaine `ClobAuthDomain` v1 chainId 137, type `ClobAuth(address address,string timestamp,uint256 nonce,string message)`, message « This message attests that I control the given wallet »), headers `POLY_ADDRESS/SIGNATURE/TIMESTAMP/NONCE`, endpoints `/auth/api-key`, `/auth/derive-api-key`. L2 = **HMAC-SHA256** sur `timestamp+METHOD+path[+body]`, urlsafe base64 avec padding. **Remplace** l'ancien `signApiCreds` EIP-191 (concat `apiKey+nonce+timestamp`) qui n'était câblé nulle part. |
| Standard EIP-712 | eips.ethereum.org/EIPS/eip-712 | Vecteur officiel « Ether Mail » (0xbe609aee…) utilisé en test. Aucun hash intermédiaire d'exemple dans le standard → digests de référence produits par **viem 2.56.3** (/tmp/opencode/eip712-ref/ref.mjs, scratch dev, PAS ajouté aux deps du repo). |

**Découverte exécution** : le vrai schéma est non seulement faussé par les 6 constats, mais le code
d'origine signait une **V1 obsolète** (domaine version "1", champs taker/nonce/feeRateBps/expiration) —
ce que la re-validation active contre la doc actuelle (point 7 de la mission) a confirmé.
Le wallet réel évoqué est **secp256k1/Ethereum** (pas Solana) — incohérence déjà relevée au PLAN §2.2.

## 2. Point par point (avant → après)

### 2.1 (constat 1) `domainSeparator` : typeHash de `EIP712Domain` rétabli
- **Avant** : `domainSeparator` hâchait name/version/chainId/contract sans entête typeHash → hash ≠ standard (probe audit `ca8be5cc…`).
- **Après** : `domainSeparator(domain)` = `keccak(typeHash || nameHash || versionHash || chainId [|| verifyingContract])`, avec typeHash réel
  (`EIP712Domain(string name,string version,uint256 chainId)` ou + `,address verifyingContract`), gère les domaines sans verifyingContract (cas ClobAuth).
- **Preuves / tests** : test « domainSeparator inclut le typeHash EIP712Domain » : croisé avec un hasher EIP-712 de référence indépendant écrit dans le test (Ether Mail), long 64 hex.
- **Digest Ether Mail produit par notre impl** (via hasher de référence du test) : `0xbe609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2` (vecteur officiel du standard).

### 2.2 (constat 2) `signatureType` (et tout champ atomique) sur 32 octets
- **Avant** : `toBytesU8` → 1 octet pour side/signatureType.
- **Après** : `encodeOrderData` = `typeHash || 11 mots ABI de 32 octets`, tous les champs y compris uint8.
- **Test** : « encodeOrderData : chaque champ atomique occupe un mot ABI de 32 octets » → `enc.length = 32 + 11×32`, side/signatureType en mot complet de 32 octets, salt exact à l'offset 0.

### 2.3 (constat 3) Montants maker/taker BUY/SELL dans le bon sens
- **Avant (inversé)** : BUY faisait `maker=shares, taker=USD`.
- **Après** : `calculateOrderAmounts` — BUY : `maker = USD(price×size)`, `taker = shares` ; SELL : inverse. 6 dp via `CLOB_DECIMALS=1_000_000n`.
- **Test explicite du sens du flux** : « calculateOrderAmounts : BUY maker=USD & taker=shares, SELL inverse » — 0.52×10 → maker=5_200_000, taker=10_000_000 (BUY), et l'inverse (SELL), avec `buy.makerAmount ≡ sell.takerAmount`.

### 2.4 (constat 4) Vecteurs de référence externes (et non plus cohérence interne seule)
Vecteurs viem 2.56.3 (hardcodés, commentés avec leur source) — ordre V2 avec salt=424242424242424, maker=signer=`0x322135fc…F9cB`, tokenId=71321045692408328360022118623747958115297759768786203608435393348337133299310, timestamp=1786000000000, zeros metadata/builder :
- `POLY_ORDER_DIGEST_STD_BUY_EOA` = `0x580449bc7be42d060ccd1ea3996a49d6480ae9c11cbebfe91fccc637d3d729a8` (maker=5200000, taker=10000000, side=0)
- `POLY_ORDER_DIGEST_STD_SELL_EOA` = `0xb3180cc12d726560171c505346e7a35010ad539fe0e3c53702c4633f5b247754` (maker=10000000, taker=5200000, side=1)
- `POLY_ORDER_DIGEST_NEG_RISK_BUY` = `0xc348b2fa561697f18099390ba981b33a9678e7dd261b58f00ee6c56b2c4e5697` (exchange negRisk)
- `CLOB_AUTH_DIGEST_NONCE0` = `0x1fceabcdf6fe641c6ebd0e703449ebfcf2d1f0478c929594e702cd970b87d049` (ts='1786000000', nonce=0)
- `EIP712_ETHER_MAIL_DIGEST` = `0xbe609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2` (vecteur officiel du standard).
Un **hasher EIP-712 de référence indépendant** est implémenté dans `polymarketSigner.test.ts` (encodeType canonique, dépendances, mots 32B, `0x1901`) : il reproduit à la fois le vecteur Ether Mail ET le digest d'ordre Polymarket, croisé avec `orderDigest`. **Preuve de la valeur du cross-check** : la première version de `clobAuthTypeHash` utilisait `ClobAuth(address,string,uint256,string)` (typeHash réel `0xf2215f2f…`) — le cross-check viem a révélé que la forme canonique attendue est **avec noms de champs** `ClobAuth(address address,string timestamp,uint256 nonce,string message)` (typeHash `0x52578c5c…`) ; corrigé, digest L1 == viem.
- Tests digit-roundtrip conservés : gros tokenId (2^250+12345) sans troncature, adresse invalide → throw, salt JSON-safe dans [1, 2^53).

### 2.5 (constat 5) `signedOrdersValidated` (booléen appelant) → preuve interne fail-closed
- **Avant** : `signedOrdersValidated: boolean` passé au constructeur — contournable par tout code interne.
- **Après** : module `schemaGate.ts` avec constante **verrouillée** `signatureSchemaValidated = false`, `assertSignatureSchemaValidated()` qui throw `SignatureSchemaNotValidatedError` sur `placeOrder`. Aucun paramètre de constructeur ne peut la lever. Hook `__setSignatureSchemaValidatedForTests` **réservé aux tests**, jamais exporté par l'index public. Procédure de passage en `true` documentée (PHASE-2.2-procedure.md + commentaires schemaGate.ts : vecteurs + validation live testnet, commit référençant ce journal).
- **Tests** : fail-closed sans preuve (même avec credentials) + en live valide.

### 2.6 (constat 6) Authentification CLOB réelle (L2 HMAC + L1 ClobAuth)
- **Avant** : aucun header d'auth ; `signApiCreds` (EIP-191) jamais câblé à un appel réseau.
- **Après** :
  - `clobAuth.ts` : `buildPolyHmacSignature` (HMAC-SHA256 du secret base64-decoded, message `timestamp+METHOD+path[+body]`, urlsafe base64 **avec padding**), `buildL2Headers` (`POLY_ADDRESS/API_KEY/PASSPHRASE/TIMESTAMP/SIGNATURE`), `buildL1Headers` (`POLY_ADDRESS/SIGNATURE/TIMESTAMP/NONCE`).
  - `placeOrder`/`cancelOrder` : headers L2 ; `deriveApiKey` : signature L1 EIP-712 ClobAuth → `GET /auth/derive-api-key`.
- **Preuves (mock serveur qui valide la signature des headers)**, `polymarketClient.test.ts` :
  - L2 : HMAC **recalculé indépendamment** avec `node:crypto` (`createHmac`) sur le message exact `timestamp+POST+/order+body` → égal au header `POLY_SIGNATURE` ; `POLY_API_KEY` == `owner` du corps.
  - L1 : `deriveApiKey` → headers L1, nonce=0, puis **recovery de la signature** : `recoverSignerAddress(clobAuthDigest(ts,nonce), signature)` == wallet `0x7E5F4552…`, et credentials renvoyés.
  - fail-closed : dry-run bloque (`placeOrder`, `cancelOrder`, `deriveApiKey`), live sans auth → throw, live sans preuve de schéma → `SignatureSchemaNotValidatedError`. `cancelOrder`/`deriveApiKey` n'exigent PAS le gate (pas d'ordre signé).

## 3. Métriques avant / après

| Métrique | Avant | Après |
|---|---|---|
| Vecteurs de test | déterminisme/récupération interne | vecteurs viem + Ether Mail officiel + hasher EIP-712 de référence indépendant |
| `domainSeparator` | omet le typeHash (≠ standard) | conforme EIP-712, croisé avec hasher de référence |
| `signatureType` encodage | 1 octet | mot ABI 32 octets (test inspecte l'encodage) |
| Montants BUY/SELL | inversés | sens correct + test du flux de valeur |
| Preuve de schéma | `signedOrdersValidated: bool` constructeur | `schemaGate.ts` fail-closed, hook tests non public |
| Auth réseau | aucune | L2 HMAC (recalculé node:crypto) + L1 ClobAuth (signature recover), mock serveur |
| Tests TS workspace | 70 (9 files) | **82 (9 files)** — verts |
| Tests Rust | 50 | **50** — verts (aucune régression) |
| `npm run typecheck` / `tsc --build` | vert | vert |

## 4. Critères de succès — tous vérifiés

- [x] `domainSeparator()` == calcul manuel du standard (test hash attendu en dur + source notée).
- [x] `signatureType` occupe 32 octets — test qui inspecte la structure encodée.
- [x] Test dédié BUY/SELL avec assertions explicites `makerAmount`/`takerAmount` et sens du flux.
- [x] Tests contre un vecteur de référence externe (Ether Mail officiel + viem Polymarket).
- [x] Appel réseau authentifié contre un serveur mock qui valide la signature des headers (L2 HMAC recalculée en node:crypto, L1 signature recover).
- [x] `signedOrdersValidated` supprimé en tant que paramètre de constructeur ; mécanisme documenté dans `schemaGate.ts` + ce journal.
- [x] Doc Polymarket actuelle consultée (2026-09-09), divergences documentées (§1) — schéma V2 vs V1 obsolète, ClobAuth EIP-712 vs EIP-191, headers L2.

Aucun test avec clés/fonds réels n'a été émis (interdiction respectée).

## 5. Livrables

- `packages/execution/src/polymarketSigner.ts` — réécriture V2 (domaines, 11 champs, montants, ClobAuth L1, wire payload).
- `packages/execution/src/schemaGate.ts` — preuve de schéma fail-closed (nouveau).
- `packages/execution/src/clobAuth.ts` — headers/auth L1+L2 (nouveau).
- `packages/execution/src/polymarketClient.ts` — placeOrder/cancelOrder/deriveApiKey câblés ; `signedOrdersValidated` retiré ; `OrderParams` allégé.
- `packages/execution/src/{polymarketSigner,polymarketClient}.test.ts` — réécrits (+15/+12 tests).
- `docs/mission/mission-PALLAS-M02-journal.md` (ce fichier), mission M02 passée CLÔTURÉE, `PLAN.md` §2.2 et tableau des missions mis à jour.

## 6. Dettes / observations

- viem 2.56.3 utilisé UNIQUEMENT en scratch dev (/tmp/opencode/eip712-ref) : les tests hardcodent les digests — pas de dépendance de build sur viem. Si un futur consolidateur veut régénérer : `node /tmp/opencode/eip712-ref/ref.mjs` (nix-shell + npm i viem).
- `deriveApiKey` n'exige pas le gate de schéma d'ordre : c'est un endpoint d'identité, pas un order. À documenter dans PHASE-2.2-procedure.md lors de la validation live.
- La validation live réelle (testnet) reste à faire (point porte : `schemaGate.signatureSchemaValidated`), documentée — hors PALLAS-M02, interdit sans confirmation explicite hors mission.