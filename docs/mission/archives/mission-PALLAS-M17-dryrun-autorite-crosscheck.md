# MISSION — PALLAS-M17 — Dry-run et kill switch comme autorités indépendantes, plus cross-check complet

## 0. Métadonnées
Mission ID : PALLAS-M17
Date de création : 2026-09-10
Auteur / Agent : Claude (planification) — exécution par agent de code au choix
Projet : Pallas
Statut : CLOTURÉE — livrée (journal mission-PALLAS-M17-journal.md, commit poussé)
Source de vérité : `AUDIT-PALLAS-v0.3.md` (F-06, F-07, section 4.2/4.3/5.3) +
`packages/execution/src/polymarketClient.ts` + `packages/core/src/dry-run.ts` +
`packages/execution/src/polymarketSigner.ts`

## 1. Contexte

**Ce qui a été fait (PALLAS-M02, M10) et reste correct comme fondation :** dry-run vrai par défaut,
confirmation exacte `"LIVE"` exigée, `schemaGate.ts` verrouillé pour la porte de schéma de
signature.

**Ce que révèle l'audit v0.3, non couvert :**

1. **`disableDryRun`/`enableDryRun` restent des exports publics**, et `PolymarketClient` accepte
   toujours `isDryRun?: () => boolean` en configuration (`polymarketClient.ts:18`) — la réserve déjà
   notée à deux audits précédents (v0.1, v0.2) persiste. Combiné à `schemaGate` et à la config de
   test, du code interne peut réunir les conditions live sans séparation de rôles ni approbation à
   quatre yeux.

2. **`placeOrder` ne compare `params.tokenId` que s'il n'est pas nul, et ne compare jamais
   `params.marketId`** (`polymarketClient.ts:119`) — une intention avec un mauvais `marketId`, ou
   sans `tokenId`, passe le contrôle actuel. Le prix et la taille ne sont vérifiés qu'indirectement
   via leur produit recalculé en unités 6 décimales, avec `Math.round` — pas l'algorithme officiel
   de rounding par tick, ni une comparaison de l'identité complète des deux champs (plusieurs
   couples prix/taille peuvent produire les mêmes entiers arrondis).

3. **Seul le mode EOA (`signatureType=0`) est testé et déclaré conforme** ; les valeurs 1-3
   (`PROXY`, `SAFE`, `DEPOSIT_WALLET`) sont publiquement exposées et acceptées par le code sans
   implémentation ni test réels (`polymarketSigner.ts:109`). L'audit recommande explicitement : "tout
   autre mode est non conforme/non vérifié et devrait être rejeté à la construction plutôt que
   simplement documenté."

## 2. Objectif général

Faire du dry-run et de la porte de schéma de véritables autorités que le code interne ne peut plus
contourner par un simple paramètre de configuration, et fermer le contrôle d'intention pour qu'il
couvre réellement tous les champs déterminants de l'ordre.

## 3. Objectifs détaillés

- **Restreindre l'injection `isDryRun`** : ne plus l'accepter comme paramètre de constructeur
  librement disponible en usage normal. Option recommandée : séparer explicitement un mode "test"
  (activable uniquement via une variable d'environnement dédiée non documentée en usage production,
  ex. `PALLAS_TEST_MODE=1`, vérifiée au chargement du module) du usage normal qui lit uniquement le
  flag global `@pallas/core`. Documenter la décision retenue et pourquoi.
- **Rendre `disableDryRun`/`enableDryRun` moins librement accessibles** : au minimum, documenter
  clairement dans le code que ces exports ne doivent jamais être appelés par un chemin de décision
  automatisé (agent/stratégie) — seulement par un point d'entrée opérateur explicite. Envisager de
  les retirer des exports publics du package `@pallas/core` si rien dans le code de production
  actuel n'en a besoin en dehors des tests.
- **Cross-check complet intention/payload dans `placeOrder`** : comparer obligatoirement
  `marketId`, `tokenId` (rendu obligatoire, plus optionnel), `side`, et les montants recalculés avec
  une tolérance documentée et cohérente avec l'algorithme officiel de rounding par tick (rechercher
  la règle exacte utilisée par les clients officiels plutôt que `Math.round` arbitraire — cohérent
  avec la méthode déjà appliquée en PALLAS-M08 pour vérifier contre les clients officiels).
- **Rejeter à la construction tout `signatureType` autre que EOA** tant qu'il n'est pas implémenté
  et testé aussi rigoureusement que EOA — lever une erreur explicite dans
  `buildSignedOrderPayload`/`signOrder` plutôt que de laisser passer silencieusement une valeur non
  supportée.

## 4. Protocole de validation

**Setup** : `npm test` vert (packages/core, packages/execution) à chaque étape.

**Métriques à capter :**
1. Test qui prouve qu'un code de production standard (hors chemin de test explicitement marqué) ne
   peut plus instancier un `PolymarketClient` en mode live sans passer par le flag global.
2. Test qui envoie un `params.marketId` divergent du payload signé → rejet avant réseau.
3. Test qui envoie `params.tokenId` absent → rejet (le champ devient obligatoire).
4. Test qui tente de construire un ordre avec `signatureType=1/2/3` → rejet explicite à la
   construction.

## 5. Procédure / Étapes

### Partie A — Préparation
- Lire `AUDIT-PALLAS-v0.3.md` §4.2, §4.3, §5.3 en entier.
- Rechercher l'algorithme officiel de rounding par tick utilisé par les clients Polymarket cités en
  PALLAS-M08 (mêmes sources : clob-client-v2 TS/Python/Rust).

### Partie B — Vérifications préalables
- Écrire les tests de régression (divergence marketId, tokenId absent, signatureType non-EOA) avant
  de corriger, pour confirmer chaque faille actuelle.

### Partie C — Exécution
- Corriger dans l'ordre : rejet des `signatureType` non-EOA (le plus simple et le plus isolé) →
  cross-check `marketId`/`tokenId` obligatoire → rounding officiel → restriction `isDryRun`.

## 6. Ce que l'agent doit faire
1. Vérifier contre le code source réel des clients officiels pour le rounding, pas une supposition.
2. Documenter explicitement la décision retenue pour `isDryRun` (restriction complète, ou variable
   d'environnement dédiée) — ne pas laisser la question sans arbitrage écrit, comme déjà exigé par
   PALLAS-M10 et toujours non traité à ce niveau de rigueur par l'audit v0.3.
3. S'assurer que le rejet des `signatureType` non supportés ne casse pas silencieusement un test
   existant qui utiliserait une valeur non-EOA par erreur — vérifier et corriger ces tests le cas
   échéant.

## 7. Critères de succès
- [x] `isDryRun` n'est plus injectable par un chemin de production standard ; la décision retenue
      est documentée dans le code et `docs/SECURITY.md`.
- [x] `placeOrder` rejette toute divergence sur `marketId` et `tokenId` (désormais obligatoire) entre
      `params` et `signed.order`, testé.
- [x] Le calcul des montants utilise l'algorithme de rounding officiel (ou une justification
      documentée si un écart reste toléré), testé contre plusieurs couples prix/taille limites.
- [x] Toute tentative de construire un ordre avec `signatureType` autre que EOA est rejetée à la
      construction, testé.
- [x] Aucune régression sur les tests existants (`npm test` vert).

## 8. Interdictions
- Ne pas laisser `signatureType` 1/2/3 acceptés silencieusement "au cas où" — soit ils sont
  implémentés et testés, soit ils sont rejetés explicitement.
- Ne pas assouplir la tolérance de cross-check `marketId`/`tokenId`/montants pour "faire passer les
  tests" sans justification documentée par rapport au comportement officiel.
- Ne pas laisser la question `isDryRun` sans décision écrite — c'est la troisième fois que cette
  réserve apparaît dans un audit (v0.1, v0.2, v0.3), elle doit être définitivement close ou
  explicitement actée comme risque accepté avec justification.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M17-journal.md`.
Livrables : diffs `polymarketClient.ts`, `polymarketSigner.ts`, `packages/core/src/dry-run.ts`
(si restructuré), tests, `docs/SECURITY.md` mis à jour.
