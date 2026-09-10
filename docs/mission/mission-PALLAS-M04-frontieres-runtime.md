# MISSION — PALLAS-M04 — Frontières TS/HTTP : validation runtime stricte, retry, idempotence

## 0. Métadonnées
Mission ID : PALLAS-M04
Date de création : 2026-09-09
Auteur / Agent : Claude (planification) — exécution par agent de code au choix
Projet : Pallas
Statut : ACTIF
Source de vérité : `AUDIT-PALLAS-v0.1.md` (sections "Écart PLAN/réalité" et "Qualité du code —
TypeScript") + `packages/risk/src/client.ts` + `packages/execution/src/polymarketClient.ts`

## 1. Contexte

**Système :** deux frontières non fiables identifiées par l'audit :
1. `packages/risk/src/client.ts::invoke` caste aveuglément la sortie JSON de la CLI Rust en `T`
   sans schéma runtime (`client.ts:73-90`). Si le contrat change côté Rust (voir PALLAS-M01) ou si
   la CLI retourne un JSON structurellement différent, TypeScript ne le détectera qu'en aval, par un
   crash ou pire, un comportement silencieusement faux.
2. `polymarketClient.ts` : le mapping des réponses CLOB (`mapMarket`, `getOrderbook`) n'est validé
   que contre des fixtures mockées dans les tests — aucune validation runtime des nombres, tableaux,
   ou identifiants reçus réellement de l'API (`polymarketClient.ts:67-81`). Par ailleurs, le retry
   exponentiel ne couvre que les GET et uniquement les erreurs `TypeError` (`polymarketClient.ts:108-128`)
   — aucun retry ni notion d'idempotence sur `placeOrder`/`cancelOrder`, ce qui est risqué : un
   timeout réseau sur un POST d'ordre laisse l'appelant dans l'incertitude totale (ordre passé ou non ?).

**Dépendances :** `zod` est déjà une dépendance de `@pallas/core` — à réutiliser plutôt que
réinventer un validateur.

**Risque concret si non traité :** un changement de format côté risk-engine Rust (PALLAS-M01 va
justement étendre le contrat CLI) pourrait silencieusement corrompre les décisions de trading côté
TypeScript sans qu'aucun test ne le détecte, puisque le cast actuel ne vérifie rien.

## 2. Objectif général

Éliminer les casts aveugles aux deux frontières critiques (risk engine CLI, API CLOB Polymarket) en
les remplaçant par une validation runtime stricte, et sécuriser les écritures CLOB par un mécanisme
d'idempotence explicite.

## 3. Objectifs détaillés

- Définir des schémas Zod pour `ValidateResponse`, `VarResponse`, `ErrorResponse` dans
  `packages/risk/src/types.ts`, et faire parser `invoke()` la réponse JSON à travers ces schémas
  avant de la caster — échec de parsing → `RiskEngineError` explicite, jamais un objet partiellement
  valide silencieusement accepté.
- Définir des schémas Zod pour les réponses CLOB (`/markets`, `/book`) et valider avant mapping dans
  `polymarketClient.ts` — rejeter (throw explicite) toute réponse qui ne correspond pas à la forme
  attendue, plutôt que de laisser `Number(undefined)` produire un `NaN` silencieux.
- Étendre le retry exponentiel existant pour couvrir aussi les erreurs réseau transitoires sur
  `placeOrder`/`cancelOrder` (timeout, erreurs 5xx), avec une clé d'idempotence générée côté client
  (si l'API CLOB la supporte — à vérifier dans la doc, sinon documenter l'absence comme limite
  connue plutôt que l'ignorer silencieusement).
- Documenter explicitement, pour chaque écriture (`placeOrder`, `cancelOrder`), le comportement en
  cas de timeout réseau : l'appelant doit-il considérer l'ordre comme potentiellement passé et
  vérifier son statut avant de réessayer ? Implémenter cette vérification si possible (ex. via
  `listMarkets`/statut d'ordre), sinon documenter la lacune clairement dans le code et
  `docs/TRADING.md` (PALLAS-M06).

## 4. Protocole de validation

**Setup** : `npm test` vert (packages/risk, packages/execution) à chaque étape.

**Métriques à capter :**
1. Test qui envoie une réponse CLI Rust volontairement malformée (champ manquant, type incorrect) —
   `invoke()` doit maintenant rejeter proprement au lieu de laisser passer un cast invalide.
2. Test qui envoie une réponse CLOB malformée (ex. `best_bid: "not-a-number"`, `clob_token_ids`
   absent) — le client doit rejeter plutôt que produire un `NaN`/`undefined` silencieux.
3. Test qui simule un timeout sur `placeOrder` et vérifie le comportement de retry/idempotence
   documenté.

## 5. Procédure / Étapes

### Partie A — Préparation
- Lire `client.ts` (risk) et `polymarketClient.ts` en entier.
- Vérifier si l'API CLOB Polymarket supporte une clé d'idempotence (recherche doc — ne pas supposer).

### Partie B — Vérifications préalables
- Écrire d'abord les tests de régression avec des réponses malformées (ils doivent échouer avant
  correction, pour prouver qu'ils testent bien le bon problème).

### Partie C — Exécution
- Ajouter les schémas Zod et le parsing strict aux deux frontières.
- Étendre le retry/idempotence sur les écritures CLOB, ou documenter la limite si l'API ne le
  permet pas.

## 6. Ce que l'agent doit faire
1. Coordonner avec PALLAS-M01 si celle-ci est en cours en parallèle : le contrat CLI risk engine va
   changer (état persistant) — les schémas Zod de cette mission doivent refléter le contrat final,
   pas l'ancien.
2. Écrire les tests de régression (réponses malformées) avant d'écrire le code de validation.
3. Documenter clairement toute limite d'API découverte (ex. absence de clé d'idempotence côté
   Polymarket) plutôt que de la contourner silencieusement.

## 7. Critères de succès
- [ ] `packages/risk/src/client.ts::invoke` rejette explicitement (avec `RiskEngineError`) toute
      réponse JSON qui ne correspond pas au schéma attendu — testé avec au moins 2 cas de
      malformation différents.
- [ ] `polymarketClient.ts` rejette explicitement toute réponse CLOB malformée avant mapping —
      testé avec au moins 2 cas de malformation différents (nombre invalide, champ manquant).
- [ ] `placeOrder`/`cancelOrder` ont une stratégie de retry/idempotence documentée et testée, ou une
      limite documentée explicitement si l'API ne le permet pas.
- [ ] Aucune régression sur les tests existants (`npm test` toujours vert).

## 8. Interdictions
- Ne pas introduire de dépendance de validation autre que `zod` sans justification (déjà présente
  dans le monorepo).
- Ne pas masquer une erreur de validation par une valeur par défaut silencieuse (`?? 0`, `?? ''`) —
  toute donnée invalide doit throw, jamais être substituée silencieusement.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M04-journal.md`.
Livrables : diffs `packages/risk/src/*`, `packages/execution/src/polymarketClient.ts`, tests
associés, section correspondante de `PLAN.md` mise à jour (Phase 0 et Phase 2.1).
