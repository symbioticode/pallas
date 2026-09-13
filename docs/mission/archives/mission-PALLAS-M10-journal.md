# JOURNAL — PALLAS-M10 — Frontières résiduelles (audit v0.2 : set 4)

> Clôturée le 2026-09-10. Vérifie l'audit `AUDIT-PALLAS-v0.2.md`.
> Contexte : ce qui n'était en v0.1 qu'une « réserve commentée » devient soit un correctif
> obligatoire (cross-check, PALLAS_RISK_BIN, deriveApiKey), soit une décision explicite (isDryRun).

## 1. Synthèse

4 points traités, tests 108/108 (5 nouveaux dans `polymarketClient.test.ts`, 3 dans
`client.test.ts`, 1 test « wire » ajusté pour être cohérent). Aucune interaction réseau dans les
tests. La question `isDryRun` sort de l'état « réserve sans arbitrage » : décision actée et
documentée, restriction d'API différée à la Phase 3.

## 2. Résumé des décisions

| Point | État avant (v0.2) | Décision M10 |
|-------|--------------------|---------------|
| `placeOrder` params ↔ signé | aucun contrôle (le payload signé pouvait diverger de l'intention) | **`OrderMismatchError`** avant tout appel réseau |
| `PALLAS_RISK_BIN` | simple `existsSync` (un dossier ou un symlink non exécutable passait) | **`isRegularExecutable`** identique à la sandbox |
| `deriveApiKey` | `res.json()` parsé même sur 401/500 → erreur Zod confuse | **erreur HTTP explicite** avant le parsing |
| `isDryRun` injectable | réserve répétée, sans arbitrage | **réserve actée** : injection conservée, limitée aux tests, interdiction à la Phase 3 (documentée) |

## 3. Détail par point

### 3.1 `deriveApiKey` — HTTP explicite avant parsing (`polymarketClient.ts`)

Avant : `parseClob(DeriveApiKeyResponseSchema, 'deriveApiKey', await res.json().catch(() => null))`
— un 401/500 body `{"error":"unauthorized"}` devenait un message d'erreur de schema confus
(M04 zod), ou `null` si le body n'est pas du JSON.

Après :
```ts
if (!res.ok) {
  const body = await res.text().catch(() => '');
  throw new Error(`Polymarket deriveApiKey HTTP ${res.status}: ${body.slice(0, 200)}`);
}
```
Le statut HTTP et le premier bout du body sont remontés tels quels (cohérent avec `handleResponse`).

Tests : `M10: deriveApiKey HTTP 401 => erreur HTTP explicite` et `... 500 => ...`, fetcher stubé qui
renvoie `new Response(..., { status })`. Vérifie le message (`/401/`, `/500/`), pas le réseau.

### 3.2 `PALLAS_RISK_BIN` — même durcissement que la sandbox (`packages/risk/src/client.ts`)

Avant : `locateBinary` utilisait `existsSync` — un **dossier** ou un **symlink vers un fichier non
exécutable** était accepté, puis `spawn` échouait plus tard avec un message moins bon.

Après : helper `isRegularExecutable(path)` — `realpathSync` (cible réelle, symlink résolus) +
`statSync(...).isFile()` + `accessSync(X_OK)`. C'est la **copie volontaire, commentée** de
`sandbox.ts::isRegularExecutable` (l.99) :

> Duplication assume le choix inverse d'une dépendance croisée `risk → execution` : `@pallas/risk`
> est un package minimal qui ne charge ni zod ni noble. 5 lignes, gardées synchrones (commentaire
> réciproque dans `sandbox.ts` ni nécessaire : la référence est dans client.ts).

Appliqué à la fois au chemin `PALLAS_RISK_BIN` et aux chemins candidats (build debug/release).
Un chemin invalide → `MissingBinaryError` (fail-closed, identique au comportement d'avant pour
l'inexistant).

Tests : `M10: PALLAS_RISK_BIN vers un dossier => MissingBinaryError`, `M10: ... symlink vers un
fichier non executable => MissingBinaryError`, `M10: validateTrade fonctionne toujours via
PALLAS_RISK_BIN executable regulier`. Note : le premier test du fichier (« binary path resolves to
a real file », M04) passe toujours → le vrai binaire construit est bien un fichier régulier
exécutable.

### 3.3 `placeOrder` — cross-check params ↔ signé (`OrderMismatchError`)

Nouvelle erreur typée + `assertOrderMatchesParams(signed, params)` appelée à la sortie du
dry-run / de `assertSignatureSchemaValidated()`, **avant** `requireAuth` et avant tout `fetch`.

Vérifications :
- `side` strictement égal ;
- `tokenId` : si `params.tokenId` est fourni, il doit être égal à celui du payload signé
  (peut être `null` dans `OrderParams` — le signer décide, le cross-check n'invente pas) ;
- montants : `calculateOrderAmounts(params.side, price, size)` recalculé et comparé au
  `makerAmount`/`takerAmount` du payload, avec tolérance **1 unité (1e-6)** : les deux calculs
  refont la même arithmétique flottante, 1 unité absorbe un éventuel arrondi de recopie — pas plus.

Message d'erreur détaillé : `side(match=…) tokenId(match=…) makerAmount(Δ=…) takerAmount(Δ=…)`.

Attention : décimales exprimées **en unités** dans le message (1e-6 USD / share), pas en USD.

Tests :
- `M10: placeOrder rejette si le prix signe diverge de params` (params price 0.9 vs signé 0.5 →
  `OrderMismatchError`, `fetcher` non appelé) ;
- `M10: placeOrder rejette si la side signee diverge` ;
- `M10: placeOrder accepte quand params == signe (tokenId explicite coherent)`.

Ajustement d'un test existant : « placeOrder emet POST /order conforme au wire V2 » passait
`tokenId: 'tok-yes'` en params alors que le payload signé (`signedBuy`, tokenId `12345n`) porte
`12345`. C'était précisément la divergence que le cross-check doit attraper — le test paramètre
désormais `tokenId: '12345'` (cohérent). Les autres tests du fichier ne fournissent pas de
`tokenId` en params (`null` → pas de comparaison) et passent inchangés.

### 3.4 `isDryRun` injectable — décision actée (réserve documentée, restriction déléguée à la Phase 3)

L'audit (v0.1 ET v0.2) pointe `isDryRun?: () => boolean` au constructeur. Deux options :
1. **restreindre l'API maintenant** (ex. forcer le flag global) — mais rien ne consomme encore
   `PolymarketClient` en production (agent/gateway absents) ; une restriction d'API sans runtime
   pour l'exercer ne serait pas testable ;
2. **réserve explicite écrite** avec renvoi précis à la Phase 3 qui devra l'interdire.

**Décision : option 2.** Mise en œuvre :
- docstring `PolymarketClientConfig.isDryRun` réécrit : « RESERVEE AUX TESTS. Aucun appelant de
  production ne doit fournir ce delegate ; la politique d'assemblage de la Phase 3
  (gateway/agent, cf. PLAN.md) devra INTERDIRE cette injection hors tests » ;
- `docs/SECURITY.md` § Limites documentées : même réserve, avec le même renvoi.

Aucune modification d'API (`isDryRun` continue de lire le flag global de `@pallas/core` par
défaut) — le coeur de la décision est que la question n'est plus *laissée ouverte* : elle est
arbitrée dans le sens « garder pour les tests, interdire à l'assemblage », et c'est écrit quelque
part que la Phase 3 fermera la porte.

## 4. Métriques captées (protocole §4)

1. Test divergence prix `params` ↔ signé : `OrderMismatchError` levé avant `fetch` (assertion
   `fetcher` non appelé). ✓
2. Décision `isDryRun` écrite (docstring + SECURITY.md + ce journal §3.4). ✓
3. `PALLAS_RISK_BIN` vers dossier **et** symlink non exécutable → `MissingBinaryError`. ✓
4. 401 et 500 sur `/auth/derive-api-key` → erreur HTTP `/401/` et `/500/`. ✓

## 5. Preuves

- `npm test` : **108 passed** (9 files). Avant M10 : 100. Delta : +5 (execution) +3 (risk), et un
  test execution modifié pour être cohérent (pas un nouveau test).
- Les deux fichiers de test ciblés passent seuls : `polymarketClient.test.ts` 26 tests,
  `client.test.ts` 17 tests.
- `tsc --build` : OK (post-fix `Math.abs` sur `bigint` → `absBig`, erreur TS attrapée en M10).

## 6. Limites / réserves restantes (transférées hors M10)

- Test de validation du schema de signature **live testnet** toujours à faire (porte
  `schemaGate` v1 — hors M10, procédure documentée PHASE-2.2) ;
- `gateway/agent/ledger/E2E` absents (audit v0.2) — hors périmètre, à traiter à la Phase 3, où la
  clôture `isDryRun` (3.4) s'exécutera ;
- `marketId` n'est pas vérifié par le cross-check (le signed ne contient pas de reférence
  marché fiable comparable) — la cohérence porte sur l'économique de l'ordre (price/size → montants),
  la side et le token, pas sur le libellé marché.

## 7. Liste des fichiers touchés

- `packages/execution/src/polymarketClient.ts` — `OrderMismatchError`,
  `assertOrderMatchesParams`, docstring `isDryRun`, `res.ok` (deriveApiKey).
- `packages/execution/src/polymarketClient.test.ts` — 5 tests M10 + ajustement tokenId.
- `packages/risk/src/client.ts` — `isRegularExecutable` (copie volontaire commentée), `locateBinary`.
- `packages/risk/src/client.test.ts` — 3 tests M10.
- `docs/SECURITY.md` — Limites documentées (3 nouvelles entrées + décision isDryRun).
- `docs/mission/mission-PALLAS-M10-frontieres-residuelles.md` — critères cochés.