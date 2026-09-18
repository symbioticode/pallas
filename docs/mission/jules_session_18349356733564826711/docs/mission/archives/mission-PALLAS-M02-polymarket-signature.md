# MISSION — PALLAS-M02 — Signature Polymarket EIP-712 : correction et validation officielle

## 0. Métadonnées
Mission ID : PALLAS-M02
Date de création : 2026-09-09
Auteur / Agent : Claude (planification) — exécution par agent de code au choix
Projet : Pallas
Statut : CLÔTURÉE le 2026-09-09 — **priorité critique, bloquante avant tout test même partiellement live**
(6 constats corrigés + validation officielle, voir `mission-PALLAS-M02-journal.md`)
Source de vérité : `AUDIT-PALLAS-v0.1.md` (section 2, "Ordres signés : implémentation actuellement
incorrecte") + `packages/execution/src/polymarketSigner.ts` + `packages/execution/src/polymarketClient.ts`

## 1. Contexte

**Système :** `polymarketSigner.ts` construit et signe les ordres CLOB Polymarket en EIP-712
(structure `Order`) et signe les credentials API en EIP-191. `polymarketClient.ts::placeOrder`
consomme ce payload et l'envoie à l'API CLOB, gaté par `signedOrdersValidated`.

**Sécurité / dépendances :** ce module manipule des clés privées et produit des signatures
cryptographiques qui engagent des fonds réels dès que `signedOrdersValidated: true` et dry-run
désactivé. Une erreur ici ne se traduit PAS forcément par un rejet propre de l'API — elle peut
produire une signature valide-en-apparence mais liant l'utilisateur à des montants faux.

**Constats de l'audit (6 points, à traiter dans l'ordre de gravité) :**
1. Le `domainSeparator` omet le `typeHash` de `EIP712Domain` et hache directement les 4 valeurs
   (`polymarketSigner.ts:127-134`). Hash obtenu vs standard : différents (probe indépendante de
   l'audit : `ca8be5cc…fcc5895` vs `1a573e36…4d151be`).
2. `signatureType` (uint8) est encodé sur 1 octet via `toBytesU8`, alors que EIP-712 exige un mot
   ABI de 32 octets par champ atomique (`polymarketSigner.ts:112-114, 136-152`).
3. Montants maker/taker inversés entre BUY et SELL (`polymarketSigner.ts:280-284`) : pour un BUY,
   le maker doit fournir le montant monétaire et recevoir les tokens ; c'est actuellement l'inverse
   qui se produit dans le calcul.
4. Les tests (`polymarketSigner.test.ts`) ne vérifient que le déterminisme et la récupération
   interne — jamais contre des vecteurs de référence EIP-712 officiels ou un client CLOB reconnu.
5. `signedOrdersValidated` est un simple booléen fourni par l'appelant du constructeur
   (`polymarketClient.ts:97-105`) — n'importe quel code interne peut le passer à `true` sans preuve
   que le schéma a réellement été validé.
6. Aucune authentification CLOB (headers `POLY-*` ou équivalent) sur `placeOrder`/`cancelOrder`
   (`polymarketClient.ts:172-177, 187-195`) ; `signApiCreds` existe mais n'est reliée à aucun appel
   réseau réel.

**Hypothèses à vérifier explicitement (pas supposer) :** la forme exacte du message signé pour les
API creds (concat `apiKey+nonce+timestamp`) et le format wire exact attendu par l'API CLOB actuelle
doivent être confirmés contre la documentation Polymarket **à jour** (elle peut avoir changé depuis
l'écriture initiale du code) — voir Partie B ci-dessous.

## 2. Objectif général

Rendre la chaîne de signature Polymarket conforme au standard EIP-712 réel et au format wire CLOB
réel, avec preuve par vecteurs de référence — pas seulement par cohérence interne.

## 3. Objectifs détaillés

- Corriger `domainSeparator` pour inclure le `typeHash` de `EIP712Domain`
  (`EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)`).
- Corriger l'encodage de `signatureType` sur 32 octets comme tout autre champ atomique.
- Corriger le calcul maker/taker pour BUY et SELL séparément, avec un test qui vérifie
  explicitement le sens du flux de valeur pour chaque côté.
- Ajouter des tests contre au moins un vecteur de référence EIP-712 officiel (domaine + structure
  générique, pas propre à Polymarket si aucun vecteur Polymarket officiel n'est trouvable) pour
  valider que l'implémentation bas niveau (`orderDigest`, `domainSeparator`) produit les bons hashs.
- Rechercher la documentation Polymarket CLOB à jour (API docs officielles) pour confirmer : format
  exact du message `signApiCreds`, headers d'authentification attendus, et re-valider le schéma
  EIP-712 domain/struct contre la doc actuelle (elle a pu changer).
- Retirer `signedOrdersValidated` comme simple booléen d'appelant : le remplacer par une preuve
  interne (ex. une constante de build activée uniquement après une procédure de validation
  documentée et vérifiable, pas un paramètre de constructeur libre).
- Câbler `signApiCreds` à un appel réseau réel (au moins un endpoint authentifié, ex. lecture du
  solde ou des ordres ouverts) pour prouver que l'authentification fonctionne bout en bout.

## 4. Protocole de validation

**Setup** : garder `npm test` vert (packages/execution) à chaque étape.

**Métriques à capter :**
1. Hash de `domainSeparator()` avant/après, comparé au calcul manuel standard EIP-712.
2. Montants maker/taker calculés pour un même ordre BUY et le même ordre en SELL — vérifier le sens
   attendu (maker fournit quoi, reçoit quoi).
3. Résultat d'un appel réseau réel authentifié (sur testnet/sandbox Polymarket si disponible, sinon
   au minimum contre un serveur mock qui vérifie la signature des headers).
4. Statut de la doc Polymarket consultée (date de consultation, URL, ce qui a changé vs le code
   actuel).

## 5. Procédure / Étapes

### Partie A — Préparation
- Lire en entier `polymarketSigner.ts` et la section correspondante de `AUDIT-PALLAS-v0.1.md`.
- Chercher et lire la documentation API CLOB Polymarket actuelle (web search / web fetch) —
  ne pas se fier uniquement aux commentaires du code existant, qui peuvent être obsolètes.

### Partie B — Vérifications préalables
- Reproduire la probe de hash de l'audit (comparer `domainSeparator()` calculé par le code au calcul
  manuel du standard) pour confirmer le bug avant correction.
- Confirmer indépendamment le sens BUY/SELL attendu par la doc Polymarket (pas par déduction du
  code existant, qui est justement suspecté faux).

### Partie C — Exécution
- Corriger dans l'ordre : domainSeparator → signatureType → montants BUY/SELL → tests vecteurs de
  référence → authentification CLOB réelle → suppression du booléen de contournement.
- Documenter dans le journal la source exacte (URL + date) de chaque élément de doc utilisé pour
  valider une correction.

## 6. Ce que l'agent doit faire
1. Ne rien corriger sans avoir d'abord confirmé le comportement attendu via une source externe
   (doc officielle ou vecteur de référence), pas par supposition.
2. Traiter les 6 points de la section 1 dans l'ordre listé.
3. Documenter chaque correction avec preuve avant/après dans le journal.
4. Ne pas cocher la case "Signature CLOB des ordres" dans `PLAN.md` tant que le point 6 (auth CLOB
   réelle testée) n'est pas vérifié bout en bout.

## 7. Critères de succès
- [x] `domainSeparator()` produit un hash identique au calcul manuel du standard EIP-712
      (test explicite avec le hash attendu en dur, commenté avec sa source de calcul).
- [x] `signatureType` occupe 32 octets dans l'encodage, vérifié par un test qui inspecte la
      structure encodée.
- [x] Un test dédié vérifie que pour BUY, maker fournit le montant monétaire et reçoit les tokens,
      et l'inverse pour SELL — avec assertions explicites sur `makerAmount`/`takerAmount`.
- [x] Au moins un test contre un vecteur de référence externe (pas seulement interne au projet).
      → vecteur officiel EIP-712 « Ether Mail » + digests Polymarket viem 2.56.3.
- [x] Un appel réseau réel authentifié réussit (ou, à défaut de testnet disponible, un test contre
      un serveur mock qui valide la signature des headers d'auth).
      → mock : L2 HMAC recalculée en node:crypto + L1 signature recover (= wallet).
- [x] `signedOrdersValidated` n'est plus un simple paramètre de constructeur librement positionnable
      par tout appelant interne — documenter le nouveau mécanisme dans le code et le journal.
      → `schemaGate.ts` (constante verrouillée + fail-closed), journal M02.
- [x] La doc Polymarket CLOB actuelle a été consultée et toute divergence avec le code d'origine est
      documentée dans le journal, même si elle ne change rien.
      → docs place-orders V2 + getting-started/api consultées 2026-09-09 (voir journal §1).

## 8. Interdictions
- Ne pas cocher la case "Signature CLOB des ordres" dans `PLAN.md` sans les 7 critères ci-dessus vérifiés.
- Ne pas supposer que le code existant reflète la doc actuelle — vérifier activement, la doc a pu changer.
- Ne pas laisser `signedOrdersValidated` comme simple booléen de contournement librement positionnable.
- Ne jamais tester avec des clés/fonds réels sans confirmation explicite hors de cette mission.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M02-journal.md`, avec pour chaque point : source consultée,
preuve avant/après, test ajouté.
Livrables : diffs `polymarketSigner.ts`/`polymarketClient.ts`/tests, section "Phase 2.2" de
`PLAN.md` mise à jour.
