# Trading — Pallas — comportement attendu

**Date :** 9 septembre 2026 — état aligné sur le code réel (PALLAS-M01..M06).
Sujet en lien : `packages/execution/src/polymarketClient.ts`, mission `PALLAS-M04`
(validation runtime + retry + idempotence).

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

## Règles de conduite

- Jamais de double-émission sans réconciliation (voir plus haut).
- Toute écriture est signée EIP-712 V2 ; le schéma de signature doit être validé contre
  l'API live avant toute émission (`schemaGate` — fail-closed).
- Les secrets ne sortent jamais du vault chiffré en clair vers un fichier ; ils restent des
  strings JS en mémoire (risque remonté dans `docs/SECURITY.md`).

## Lien

- Protections et réserves sécurité : `docs/SECURITY.md`.
- État du plan et missions : `PLAN.md` + `docs/mission/mission-PALLAS-M04-*.md`.