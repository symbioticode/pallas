# JOURNAL — PALLAS-M17 — Autorités indépendantes : cross-check complet intention/payload, autorités indépendantes, rounding officiel

Date : 2026-09-11
Agent : big-pickle (opencode) — mission exécutée en autonomie
Statut : TERMINÉE

## Synthèse attentive

L'audit v0.3 (F-06, F-07, §4.2/4.3/5.3) montrait que le dry-run et la porte de schéma restaient
contournables par du code interne via un simple paramètre de constructeur, et que le contrôle
d'intention de `placeOrder` était partiel : `params.tokenId` n'était comparé que s'il n'était pas
nul, `params.marketId` JAMAIS comparé, et les montants étaient recalculés avec `Math.round`
arbitraire au lieu de l'algorithme officiel de rounding par tick. Enfin, les `signatureType`
1/2/3 (PROXY/SAFE/DEPOSIT_WALLET) étaient acceptés silencieusement sans implémentation ni test.

M17 ferme ces brèches :

1. **`isDryRun` verrouillé par un mode test explicite.** Fournir `config.isDryRun` au constructeur
   `PolymarketClient` hors `PALLAS_TEST_MODE=1` lève désormais une erreur au constructeur. La
   variable est activée globalement par `vitest.config.ts` (jeu de tests) et n'est pas documentée
   en usage production : un chemin de production standard ne peut plus instancier un client en
   mode live que par le parcours opérateur `applySafetyGates`/`disableDryRun('LIVE')`.
2. **`enableDryRun` retiré des exports publics de `@pallas/core`.** Il reste disponible en interne
   (tests core) mais n'est plus atteignable depuis un chemin de décision automatisé. `disableDryRun`
   reste public car utilisé par l'entrée opérateur (`config.ts`), documenté comme tel.
3. **Intention canonique.** `OrderParams.tokenId` devient **obligatoire** ; `marketId` est **défini
   précisément** comme l'actif CLOB échangé ; l'invariant est une égalité triple
   `marketId === tokenId === signed.order.tokenId`. Toute divergence → `OrderMismatchError` avant
   le moindre appel réseau. Le champ ne peut plus passer à travers en étant absent (testé au
   runtime, pas seulement en TS).
4. **Algorithme officiel de rounding par tick.** Port fidèle de `ROUNDING_CONFIG` et des helpers
   de `py-clob-client-v2` (main, vérifié le 2026-09-11 dans `builder.py` + `helpers.py`) dans
   `packages/execution/src/tickRounding.ts`. Le client TS officiel (clob-client-v2) délègue le
   rounding à l'appelant : le client Python est la référence canonique. `calculateOrderAmounts`
   prend désormais un `tickSize` (défaut `0.01`, hors-table → erreur fail-closed), et le
   cross-check de `placeOrder` recalcule avec le même algorithme.
5. **Rejet de `signatureType ≠ EOA` à la construction** dans `buildSignedOrderPayload` (erreur
   explicite, jamais de passthrough silencieux). Vérifié que les tests existants n'utilisaient
   aucune valeur non-EOA (aucune régression silencieuse).

## 1. Ce qui était en cause

1. **`isDryRun` injectable** (réserve récurrente aux audits v0.1/v0.2/v0.3) : du code interne
   (hors tests) pouvait instancier un `PolymarketClient` en mode live via `isDryRun: () => false`
   sans passer par le flag global ni la confirmation `"LIVE"` — `schemaGate` seul ne suffisait pas
   comme autorité.
2. **Cross-check intention/payload partiel** (audit v0.3 F-07) : `marketId` jamais comparé ;
   `tokenId` comparé seulement s'il n'était pas nul (un ordre SANS tokenId passait) ; montants
   recalculés au `Math.round` à 6 décimales, pas l'algorithme officiel — plusieurs couples
   (prix, taille) pouvaient produire les mêmes entiers, et un montant « naïf » (ex. 1.00 USD pour
   0.333×3) ne correspondait pas au montant signé par un client officiel.
3. **`signatureType` non-EOA** acceptés sans implémentation ni test (audit v0.3 §4.3) : le code
   « transmettait tel quel » PROXY/SAFE/DEPOSIT_WALLET alors qu'une telle signature aurait été
   refusée par l'exchange.

## 2. Ce qui est livré

**`packages/execution` :**

- `tickRounding.ts` (nouveau) : `ROUNDING_CONFIG` (table officielle par tick_size), helpers
  `round_down`/`round_normal`/`round_up`/`decimal_places`/`to_token_decimals` (sémantique Decimal
  de `helpers.py`, y compris les petites notations exponentielles), `roundingConfigForTickSize`
  (fail-closed hors table), `calculateTickedOrderAmounts` (BUY : maker = shares×price arrondi,
  taker = shares ; SELL : inverse ; séquence bornée up→down du montant monétaire).
- `polymarketSigner.ts` :
  - `calculateOrderAmounts(side, price, size, tickSize = '0.01')` délègue au module ci-dessus
    (docstring insérée, aucun commentaire superflu) ;
  - `SignedOrderParams.tickSize?` nouveau ;
  - `buildSignedOrderPayload` rejette `signatureType !== SIGNATURE_TYPE.EOA` à la construction ;
  - commentaire de scope signature mis à jour (le passthrough 1/2/3 est supprimé).
- `polymarketClient.ts` :
  - constructeur : verrou `isDryRun` hors `PALLAS_TEST_MODE=1` (erreur explicite) ;
  - `assertOrderMatchesParams` : `tokenId` obligatoire + égal au signé, `marketId` défini comme
    l'actif CLOB et égal à `tokenId` (égalité triple), montants recalculés avec le rounding
    officiel (`tickSize` de l'intention), tolérance 1 unité 1e-6 documentée ;
  - `PolymarketClientConfig.isDryRun` doc mise à jour (test-only, verrouillé).
- `types.ts` : `OrderParams.tokenId` **obligatoire** ; `marketId` doc précisée ; `OrderParams.tickSize?`.
- `polymarketClient.test.ts` : fixtures mises en conformité (marketId = tokenId = '12345',
  tokenId toujours présent) ; les tests de divergence prix/side existants (M10) sont conservés
  et passent toujours avec la nouvelle sémantique.

**`packages/core` :**

- `index.ts` : `enableDryRun` retiré des exports publics (reste importable via `./dry-run.js` en
  interne tests core) ; la surface publique dry-run = `isDryRun`, `getDryRunState`,
  `disableDryRun`, types.
- `dry-run.ts` : docstrings explicites (pas d'appel par un chemin de décision automatisé).

**`vitest.config.ts` :** `env: { PALLAS_TEST_MODE: '1' }` global (mode test explicite pour les
injections test-only).

**Docs :** `docs/SECURITY.md` (3 protections nouvelles dans le tableau, bulles `isDryRun` /
`enableDryRun` / cross-check réécrites avec la décision M17, limite du « couple prix/taille non
signé » documentée) ; `docs/TRADING.md` (rejet EOA strict + algorithme officiel).

## 3. Tests ajoutés

**`packages/execution` — 20 tests verts :**

- `tickRounding.test.ts` (10) : parité de la table officielle ; helpers (round_down/normal/up,
  `decimalPlaces` dont `2e-7` → 7) ; cas limites par tick 0.1/0.01/0.005/0.0025/0.001/0.0001 ;
  **piège flottant** 0.29×0.07 = 0.0203 (et non 0.020300000000000002) ; **fabrication de centimes
  fantôme** corrigée : 0.333×3 → 0.99 USD (990000), pas 1.00 (1000000) ; tick_size hors table →
  fail-closed ; price/size non positifs → erreur.
- `polymarketSigner.test.ts` (+2) : `calculateOrderAmounts` avec `tickSize` (0.01, 0.1,
  hors-table) ; `signatureType` PROXY/SAFE/DEPOSIT_WALLET → rejet à la construction.
- `polymarketClient.test.ts` (+8, bloc `PALLAS-M17`) : `marketId` divergent → `OrderMismatchError`
  sans réseau ; `tokenId` absent au runtime (cast hors-types) → `OrderMismatchError` ; intention
  canonique complète acceptée ; tickSize cohérent accepté (wire: `makerAmount 990000`); tickSize
  divergent → `OrderMismatchError` ; `isDryRun` refusé hors `PALLAS_TEST_MODE` (env retirée puis
  restaurée) ; `isDryRun` autorisé avec `PALLAS_TEST_MODE=1`.

**Chiffres :** `npm test` 248/248 (21 fichiers), `npm run build` propre. Aucun changement
`crates/*` (pas de rebuild du binaire risk-engine nécessaire pour M17). `signatureSchemaValidated`
n'a pas été touché.

## 4. Écarts / limites assumées (transparences)

1. **Le couple (prix, taille) n'est pas signé directement** : les montants arrondis et signés le
   sont ; plusieurs couples (prix, taille) peuvent produire les mêmes entiers. La vérification
   porte donc sur l'identité `marketId`/`tokenId`/`side` et les flux monétaires recalculés avec le
   rounding officiel. L'ajout du prix/taille raw dans un champ signé (métadonnées EIP-712)
   serait un renforcement possible, hors périmètre de cette mission (les deux tests M10 de
   divergence prix/side passent toujours).
2. **`PALLAS_TEST_MODE` reste une porte volontaire** : un opérateur qui la pose explicitement
   relève lui-même le verrou. C'est un mode test assumé et documenté comme tel (variable non
   documentée en usage production), pas un secret.
3. **tolérance 1 unité 1e-6** : l'arithmétique flottante recalculée dans `placeOrder` et dans
   `calculateOrderAmounts` doit produire le même entier ; l'unité d'écart absorbe un arrondi de
   recopie. Elle n'absorbe pas une vraie divergence (les cas tests de prix 0.9 vs 0.5 restent
   détectés à 4 000 000 d'unités).

## 5. Vérifications

- `npm run build` : propre (tsc --build sur les 6 packages).
- `npm test` : 248/248 — dont `packages/execution` tickRounding 10/10, signer 38/38,
  client 48/48 ; `packages/core` 22/22 (dry-run inchangé, `enableDryRun` encore testé en interne).
- Aucun changement `crates/*` : le binaire `risk-engine` release existant sert tel quel.

## 6. Apprentissage / réutilisable

- **Vérifier contre la source officielle, pas contre une supposition** : le rounding « évident »
  (Math.round du produit) ne correspond pas au comportement officiel — le client officiel arrondit
  D'ABORD le prix, tronque la taille, puis borne le montant (up puis down). L'écart est mesurable
  (0.33×3 → 0.99 vs 1.00) et c'est exactement le type de divergence qui ferait rejeter un ordre
  signé vs recalculé par l'exchange.
- **Une décision différée trois audits ne doit pas être différée encore** : la restriction
  `isDryRun` demandée depuis v0.1 a été posée aujourd'hui par un mode test explicite — la
  question est close par écrit (code + SECURITY.md), conformément à l'interdiction de la mission.
- **Rendre un champ obligatoire au niveau runtime aussi** : `tokenId` est désormais requis au
  typage ET vérifié à l'exécution (test avec cast hors-types qui prouve le fail-save sans compiler).

## 7. Critères de succès (mission §7)

- [x] `isDryRun` n'est plus injectable par un chemin de production standard ; décision retenue
      documentée dans le code et `docs/SECURITY.md` (mode test `PALLAS_TEST_MODE=1`, `enableDryRun`
      hors package public).
- [x] `placeOrder` rejette toute divergence sur `marketId` et `tokenId` (désormais obligatoire)
      entre `params` et `signed.order`, testé (dont la présence du tokenId au runtime).
- [x] Le calcul des montants utilise l'algorithme officiel de rounding par tick
      (`py-clob-client-v2`, sources vérifiées 2026-09-11), testé contre plusieurs couples prix/taille
      limites sur tous les tick_size supportés.
- [x] Toute tentative de construire un ordre avec `signatureType` autre que EOA est rejetée à la
      construction, testé (PROXY/SAFE/DEPOSIT_WALLET).
- [x] Aucune régression sur les tests existants (`npm test` 248/248 verts).