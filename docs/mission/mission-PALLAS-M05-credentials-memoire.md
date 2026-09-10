# MISSION — PALLAS-M05 — Credentials & mémoire : honnêteté du zeroing, fermeture des fuites en clair

## 0. Métadonnées
Mission ID : PALLAS-M05
Date de création : 2026-09-09
Auteur / Agent : Claude (planification) — exécution par agent de code au choix
Projet : Pallas
Statut : ACTIF
Source de vérité : `AUDIT-PALLAS-v0.1.md` (section "Credentials : chiffrement oui, zeroing non") +
`packages/core/src/credentials.ts` + `packages/execution/src/polymarketSecrets.ts` +
`packages/execution/src/polymarketSigner.ts`

## 1. Contexte

**Constat de l'audit :** le chiffrement au repos (AES-256-GCM, scrypt, salt/IV aléatoires) est
réel et correct. L'affirmation "zeroing mémoire" de `PLAN.md` est en revanche **trompeuse** :
- Seuls la clé dérivée et un buffer déchiffré temporaire sont effacés (`credentials.ts`).
- La passphrase est une `string` JS — **non effaçable** par nature en JavaScript/TypeScript.
- Le plaintext est transformé en `string` avant le zeroing du buffer source
  (`credentials.ts:110-114`), donc la donnée sensible existe déjà ailleurs en mémoire sous forme de
  string immuable.
- `JSON.parse` crée un objet dont les valeurs sont des strings ordinaires (`credentials.ts:127-131`).
- `loadPolymarketSecrets` retourne durablement `apiKey`, `apiSecret`, `walletPrivateKey` en clair
  (`polymarketSecrets.ts:70-77`).
- Les conversions de clé privée en `Buffer` dans le signer ne sont jamais effacées
  (`polymarketSigner.ts:161-174`).

**Réalité incontournable à accepter dès le départ :** en JavaScript/TypeScript standard (sans
`sodium`/`libsodium` ou mémoire native verrouillée), on **ne peut pas** garantir un zeroing complet
de données passées par des `string` immuables — le GC peut avoir déjà copié la donnée avant tout
effacement. Cette mission ne doit donc pas chercher à "prouver" un zeroing impossible, mais à :
(a) réduire réellement la surface où c'est possible (Buffers), et (b) corriger l'affirmation
publique pour qu'elle soit honnête sur ce qui est garanti et ce qui ne l'est pas.

## 2. Objectif général

Réduire au maximum le temps de vie et la surface d'exposition des secrets en mémoire là où c'est
techniquement possible (Buffers), et remplacer l'affirmation "zeroing mémoire" trompeuse par une
description honnête et précise des garanties réelles.

## 3. Objectifs détaillés

- Dans `polymarketSigner.ts`, effacer (`.fill(0)`) tout `Buffer` dérivé d'une clé privée dès qu'il
  n'est plus nécessaire (après usage dans `secp256k1.sign`/`getPublicKey`), là où c'est possible
  sans casser l'API.
- Évaluer l'usage d'une bibliothèque de mémoire sécurisée (ex. `sodium-native` ou équivalent) pour
  les clés privées si le budget de la mission le permet — sinon documenter cette option comme piste
  future plutôt que de l'ignorer silencieusement.
- Réduire la durée de vie des secrets en clair côté `polymarketSecrets.ts` : envisager de retourner
  les secrets sous forme d'accesseurs à usage unique plutôt qu'un objet qui les garde en clair
  indéfiniment, si cela reste compatible avec le reste du code appelant (à évaluer avec prudence,
  ne pas complexifier l'API pour un gain marginal).
- Corriger `PLAN.md` et tout commentaire de code qui affirme un "zeroing mémoire" complet, pour
  refléter précisément : ce qui est effacé (buffers dérivés temporaires), ce qui ne peut
  techniquement pas l'être en JS pur (strings), et ce que cela implique en termes de risque résiduel
  (heap dump sur un process compromis).

## 4. Protocole de validation

**Setup** : `npm test` vert (packages/core, packages/execution).

**Métriques à capter :**
1. Liste des `Buffer` contenant une clé privée dans `polymarketSigner.ts`, avec confirmation qu'ils
   sont effacés après usage.
2. Texte final de la documentation (PLAN.md + commentaires de code) décrivant la garantie réelle,
   relu pour vérifier qu'il ne contient plus d'affirmation non vérifiable ("zeroing mémoire" sans
   qualification).

## 5. Procédure / Étapes

### Partie A — Préparation
- Lister tous les points de code qui manipulent une clé privée ou un secret en clair
  (`credentials.ts`, `polymarketSecrets.ts`, `polymarketSigner.ts`).

### Partie B — Vérifications préalables
- Confirmer techniquement (test ou preuve documentée) qu'un `Buffer.fill(0)` sur une clé privée
  dérivée fonctionne comme attendu dans ce contexte Node.js.

### Partie C — Exécution
- Ajouter le zeroing des Buffers manquants dans `polymarketSigner.ts`.
- Réécrire la documentation (PLAN.md section 1.1 et 2.2, commentaires de code) avec un langage
  honnête sur les garanties réelles.

## 6. Ce que l'agent doit faire
1. Ne pas promettre un zeroing complet impossible à garantir en JS pur — être précis sur ce qui est
   fait et ce qui ne peut pas l'être.
2. Effacer tous les Buffers de clé privée identifiés, là où c'est possible sans casser les tests.
3. Documenter honnêtement le risque résiduel plutôt que de le masquer.

## 7. Critères de succès
- [ ] Tous les `Buffer` contenant une clé privée dans `polymarketSigner.ts` sont effacés après
      usage (vérifié par lecture de code + test si possible).
- [ ] `PLAN.md` ne contient plus l'affirmation non qualifiée "zeroing mémoire" — remplacée par une
      description précise (ce qui est effacé, ce qui ne peut pas l'être, pourquoi).
- [ ] Aucune régression sur `npm test`.
- [ ] Une note explicite existe (code ou doc) sur le risque résiduel : "les secrets décryptés
      existent en clair sous forme de string JS tant que le process tourne ; en cas de compromission
      du process (heap dump), ils sont récupérables."

## 8. Interdictions
- Ne pas complexifier excessivement l'API de `polymarketSecrets`/`credentials` pour un gain de
  sécurité marginal et non garanti — privilégier l'honnêteté documentaire à la fausse sécurité.
- Ne pas retirer le chiffrement au repos existant (qui, lui, fonctionne correctement) sous prétexte
  de corriger le zeroing mémoire — ce sont deux sujets distincts.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M05-journal.md`.
Livrables : diffs `polymarketSigner.ts`, `PLAN.md` (sections 1.1, 2.2) et `FICHE-LECONS.md` si
l'affirmation y est aussi reprise.
