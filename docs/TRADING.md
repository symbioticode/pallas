# Trading — Pallas — comportement attendu

**Date :** 10 septembre 2026 — état aligné sur le code réel (PALLAS-M01..M10).
Sujet en lien : `packages/execution/src/polymarketClient.ts`, missions `PALLAS-M04`
(validation runtime + retry + idempotence), `PALLAS-M08` (wire et scope signature).

## Scope MVP

- **Polymarket uniquement**, un seul channel (WebChat) prévu — pas encore implémenté.
- **Dry-run par défaut** : aucune écriture n'est possible tant que le dry-run global est actif.
  Lectures (markets, orderbook) autorisées. Désactivation = confirmation explicite "LIVE".
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

### Procédure de réconciliation (à suivre si `AmbiguousOrderError`)

1. Interroger le statut des ordres ouverts / l'historique (endpoint `GET /orders`, non exposé
   par le client actuellement — suivi PALLAS-M06).
2. Vérifier les positions/balances pour confirmer si l'ordre a été prís ou refusé.
3. Seulement alors, soit annuler l'ordre trouvé, soit émettre un nouvel ordre (avec le salt
   requis).

### `cancelOrder` — DELETE idempotent

`DELETE /order/{orderId}` est idempotent : annuler un ordre déjà annulé/inconnu est un
no-op. Les erreurs transitoires (réseau, timeout, 5xx) sont donc retentées ; les erreurs
4xx (404…) sont définitives et remontées telles quelles.

## Scope signature et wire V2 (PALLAS-M08, 2026-09-10)

- **Wire V2 conforme aux clients officiels** (`clob-client-v2`, `py-clob-client-v2`,
  `rs-clob-client-v2` — sources et commits cités dans le journal M08) : le corps `order` du POST
  `/order` a exactement les 13 clés officielles et **n'a pas de champ `taker`**. L'assertion de
  l'audit v0.2 reposait sur les clients **V1** (`polymarket-js`, `py-clob-client`,
  `rs-clob-client`) où `taker`/`nonce`/`feeRateBps` existent. Vérifié par comparaison directe
  (tests M08 dans `polymarketSigner.test.ts`).
- **Scope signature : EOA uniquement.** `signatureType` default = 0 (EOA) ; c'est le seul mode
  validé et testé de bout en bout. Le champ est transmis tel quel si un appelant force
  PROXY/SAFE/DEPOSIT_WALLET, mais **POLY_1271 (deposit wallet, signatureType 3) n'est pas
  supporté** : l'enveloppe 1271 des wallets email/proxy n'est pas implémentée et une telle
  signature serait refusée par l'exchange. Ne pas émettre d'ordre non-EOA avec ce module.
- La validation du schéma contre une API live (testnet) reste une étape distincte, verrouillée
  par `schemaGate` (`signatureSchemaValidated=false`).

## Règles de conduite

- Jamais de double-émission sans réconciliation (voir plus haut).
- Toute écriture est signée EIP-712 V2 ; le schéma de signature doit être validé contre
  l'API live avant toute émission (`schemaGate` — fail-closed).
- Les secrets ne sortent jamais du vault chiffré en clair vers un fichier ; ils restent des
  strings JS en mémoire (risque remonté dans `docs/SECURITY.md`).

## Lien

- Protections et réserves sécurité : `docs/SECURITY.md`.
- État du plan et missions : `PLAN.md` + `docs/mission/mission-PALLAS-M04-*.md`.