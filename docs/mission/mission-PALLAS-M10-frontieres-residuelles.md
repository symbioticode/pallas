# MISSION — PALLAS-M10 — Frontières de confiance résiduelles (4 points isolés, audit v0.2)

## 0. Métadonnées
Mission ID : PALLAS-M10
Date de création : 2026-09-09
Auteur / Agent : Claude (planification) — exécution par agent de code au choix
Projet : Pallas
Statut : ACTIF — 🟠 Haute (4 correctifs indépendants, regroupables car petits et ciblés)
Source de vérité : `AUDIT-PALLAS-v0.2.md` (sections 2.1, 2.4, 4.2) + `packages/execution/src/polymarketClient.ts`
+ `packages/risk/src/client.ts`

## 1. Contexte

L'audit v0.2 relève quatre points isolés, chacun trop petit pour une mission dédiée mais réels et
non couverts par M01-M06. Regroupés ici parce qu'ils partagent le même profil de risque : une
frontière de confiance qui peut être franchie silencieusement ou sans vérification suffisante.

**1. `placeOrder` ne vérifie jamais que le payload signé correspond à l'intention déclarée**
(`polymarketClient.ts:212-230`). La méthode reçoit à la fois `params: OrderParams` (l'intention :
marketId, price, size, side, tokenId) et `signed: SignedOrderPayload` (le payload déjà signé), mais
n'utilise `params` que pour rien après réception — aucune comparaison entre ce que l'appelant croit
envoyer et ce qui est réellement signé et transmis à l'API. Un bug ailleurs dans la chaîne
(construction du payload signé avec un prix différent des `params`, par exemple) passerait
silencieusement.

**2. L'injection `isDryRun` reste publique dans le constructeur** (`polymarketClient.ts:18-31`),
réserve déjà notée à l'audit v0.1 et toujours présente à v0.2 : « tout appelant interne peut donc
construire `new PolymarketClient({isDryRun: () => false})` ». Sans gateway/agent encore
implémentés, rien n'empêche aujourd'hui ce contournement d'être utilisé par erreur en dehors des
tests.

**3. `PALLAS_RISK_BIN` (override du chemin de la binaire Rust) n'exige qu'`existsSync`**
(`packages/risk/src/client.ts:69-79`), contrairement à `resolveBinary` dans `sandbox.ts` qui, depuis
PALLAS-M03, vérifie un fichier régulier exécutable après résolution de lien symbolique. La façade
risk peut donc lancer n'importe quel binaire pointé par cette variable d'environnement, sans la même
rigueur que le sandbox d'exécution.

**4. `deriveApiKey` parse le JSON de la réponse même si le statut HTTP est 4xx/5xx**
(`polymarketClient.ts:313-330`), sans vérifier `res.ok` au préalable — contrairement à
`handleResponse()` utilisée ailleurs dans le même fichier. Une erreur HTTP explicite (401, 500...)
devient donc une erreur de schéma JSON confuse plutôt qu'un message HTTP clair.

## 2. Objectif général

Fermer ces quatre écarts, chacun petit individuellement mais représentatif du même relâchement :
une vérification qui existe ailleurs dans le code (pattern déjà établi) mais n'est pas appliquée
uniformément à ce point précis.

## 3. Objectifs détaillés

- **placeOrder** : ajouter une vérification qui compare `params` (marketId/tokenId si fourni,
  price, size, side) aux champs correspondants de `signed.order` avant l'appel réseau — rejet
  explicite (nouvelle erreur, ex. `OrderMismatchError`) si divergence, avec tolérance flottante
  documentée si nécessaire pour les montants convertis en unités 6 décimales.
- **isDryRun** : soit restreindre l'injection (ex. accepter uniquement en mode test via une variable
  d'environnement dédiée type `PALLAS_TEST_MODE`, pas un paramètre de constructeur librement
  disponible en production), soit — si la restructuration est jugée disproportionnée à ce stade sans
  gateway/agent — documenter explicitement dans le code et `docs/SECURITY.md` que ce paramètre est
  réservé aux tests et lister l'endroit exact où une politique d'assemblage future (Phase 3) devra
  l'interdire. Ne pas laisser la réserve sans décision explicite.
- **PALLAS_RISK_BIN** : réutiliser ou factoriser la même vérification que `sandbox.ts::resolveBinary`
  (fichier régulier, exécutable, après résolution de symlink) pour la résolution de binaire dans
  `packages/risk/src/client.ts`.
- **deriveApiKey** : vérifier `res.ok` avant de parser le JSON, et lever une erreur HTTP explicite
  (cohérente avec `handleResponse()`) en cas d'échec, plutôt que de laisser la validation de schéma
  Zod (PALLAS-M04) produire un message confus.

## 4. Protocole de validation

**Setup** : `npm test` vert (packages/risk, packages/execution) à chaque étape.

**Métriques à capter :**
1. Test qui construit un `signed` dont le prix diverge de `params.price` — `placeOrder` doit rejeter
   avant l'appel réseau.
2. Décision documentée sur `isDryRun` (restriction ou document de réserve explicite avec renvoi).
3. Test qui pointe `PALLAS_RISK_BIN` vers un dossier ou un lien symbolique douteux — doit être
   rejeté comme pour le sandbox.
4. Test qui simule une réponse 401/500 sur `/auth/derive-api-key` — doit lever une erreur HTTP
   explicite, pas une erreur de parsing JSON confuse.

## 5. Procédure / Étapes

### Partie A — Préparation
- Lire les 4 sections concernées de `AUDIT-PALLAS-v0.2.md` (2.1, 2.4, 4.2) en entier.
- Relire `sandbox.ts::resolveBinary` (PALLAS-M03) pour réutiliser le même motif de durcissement sur
  `client.ts`.

### Partie B — Vérifications préalables
- Écrire les 4 tests de régression décrits en section 4 AVANT de corriger, pour confirmer chaque
  bug.

### Partie C — Exécution
- Corriger les 4 points, dans l'ordre : `deriveApiKey` (le plus simple) → `PALLAS_RISK_BIN` →
  `placeOrder` cross-check → décision `isDryRun`.

## 6. Ce que l'agent doit faire
1. Traiter les 4 points comme des correctifs indépendants (peuvent être commités séparément), mais
   dans la même mission pour cohérence de suivi.
2. Pour `isDryRun`, ne pas laisser la question sans réponse explicite — au minimum documenter la
   réserve avec un renvoi précis vers la future Phase 3 (gateway/agent) qui devra la clore.
3. Réutiliser le code de vérification de `sandbox.ts` plutôt que de le dupliquer différemment dans
   `client.ts` — factoriser si raisonnable.

## 7. Critères de succès
- [x] `placeOrder` rejette explicitement (nouvelle erreur typée) si `signed.order` diverge de
      `params` sur marketId/price/size/side, testé. *(M10 : `OrderMismatchError`, cross-check
      montants à 1 unité 1e-6 près + side + tokenId, avant tout appel réseau → journal 3.3)*
- [x] La question `isDryRun` injectable a une décision documentée et actée (restriction de l'API, ou
      réserve explicite écrite avec renvoi Phase 3) — pas laissée en l'état sans arbitrage.
      *(M10 : réserve actée — injection restée test-only, renvoi Phase 3 planifié + SECURITY.md → journal 3.4)*
- [x] `PALLAS_RISK_BIN` applique la même vérification de fichier régulier exécutable que
      `sandbox.ts::resolveBinary`, testé avec un cas de détournement (dossier, symlink).
      *(M10 : `isRegularExecutable` dupliqué volontairement + documenté, tests dossier/symlink → journal 3.2)*
- [x] `deriveApiKey` vérifie `res.ok` avant de parser le JSON, testé avec une réponse 401 et une 500.
      *(M10 → journal 3.1)*
- [x] Aucune régression sur les tests existants. *(108/108)*

## 8. Interdictions
- Ne pas laisser la question `isDryRun` sans décision explicite écrite quelque part (code ou doc) —
  c'est déjà une réserve répétée à deux audits consécutifs (v0.1 et v0.2).
- Ne pas dupliquer la logique de vérification de binaire entre `sandbox.ts` et `client.ts` sans au
  moins factoriser la partie commune ou documenter pourquoi une duplication est acceptée.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M10-journal.md`, avec les 4 points traités séparément dans le
corps du journal.
Livrables : diffs `polymarketClient.ts`, `packages/risk/src/client.ts`, tests associés.
