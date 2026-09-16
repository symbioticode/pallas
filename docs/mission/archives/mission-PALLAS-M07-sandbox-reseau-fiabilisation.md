# MISSION — PALLAS-M07 — Sandbox bwrap : fiabiliser le test réseau sur hôte restrictif (suite M03)

## 0. Métadonnées
Mission ID : PALLAS-M07
Date de création : 2026-09-09
Auteur / Agent : Claude (planification) — exécution par agent de code au choix
Projet : Pallas
Statut : ACTIF — 🟠 Haute (régression de crédibilité sur un point déjà "clôturé")
Source de vérité : `AUDIT-PALLAS-v0.2.md` (section 2.2, "Sandbox bwrap : fail-closed amélioré,
disponibilité et preuve hôte non acquises") + `packages/execution/src/sandbox.test.ts`

## 1. Contexte

**Ce qui a été fait (PALLAS-M03, clôturée) :** le test réseau a été réécrit pour exiger une preuve
positive d'isolation (0 requête reçue par un serveur HTTP local) plutôt que de se contenter d'un
`exitCode !== 0`. C'était une vraie amélioration, confirmée par `AUDIT-PALLAS-v0.2.md` §1.1 : « la
détection explicite de l'échec bwrap est une vraie amélioration... il ne s'agit plus d'un faux
succès de sécurité ».

**Ce que révèle l'audit v0.2, sur un environnement différent et plus restrictif que celui utilisé
pour valider M03 :** `npm test` global tombe à **96/99 (3 échecs)**, tous dans
`sandbox.test.ts`. Le détail :
1. `execute un binaire autorise sous bwrap` → `BwrapInitError` (bwrap échoue toujours à créer son
   namespace réseau sur cet hôte).
2. `input passe a stdin` → même `BwrapInitError`.
3. **Le plus grave : le test « réseau isolé... preuve réelle » timeout puis lève une exception non
   gérée**, parce que même `server.listen(127.0.0.1)` — le serveur HTTP local utilisé par le test
   pour prouver l'isolation — échoue avec `EPERM` sur cet environnement, et **le test ne gère pas
   cette erreur** (`sandbox.test.ts:51-58`, pas de handler `'error'` sur le serveur).

**Le problème n'est pas seulement que bwrap échoue encore ailleurs (ça, c'est documenté et
acceptable, cf. M03 §1) — c'est que le test lui-même, censé désormais "échouer proprement" plutôt
que donner un faux positif, plante à la place. Un test qui timeout puis lève une exception non gérée
casse la suite entière et rend le diagnostic difficile pour quiconque tourne la CI sur un runner
plus restreint que la machine de développement.**

## 2. Objectif général

Rendre le test réseau robuste sur TOUT environnement, y compris ceux où même le bind d'un socket
local échoue — sans jamais redonner de faux positif, et sans jamais crasher la suite de tests.

## 3. Objectifs détaillés

- Ajouter un handler `'error'` explicite sur le serveur HTTP de test. Si `server.listen()` échoue
  (`EPERM`, `EACCES`, ou autre), le test doit **échouer avec un message clair** ("impossible de
  monter le serveur de test sur cet hôte — environnement trop restrictif pour ce test") plutôt que
  de timeout silencieusement.
- Décider explicitement de la stratégie sur un hôte où même le bind local est impossible : soit (a)
  `test.skip` avec une justification logguée et un renvoi vers ce cas documenté (acceptable
  seulement si le fail-closed de `runSandboxed` — testé séparément par le test négatif M03 §2.3 —
  reste, lui, vérifié), soit (b) un mécanisme de test alternatif qui ne dépend pas d'un bind réseau
  réel (ex. vérifier uniquement que bwrap a effectivement reçu `--unshare-net` dans ses arguments,
  en complément du test positif).
- Revérifier que `BwrapInitError` reste bien levée sur CET environnement pour les deux autres tests
  rouges — confirmer qu'il s'agit bien du même comportement fail-closed documenté par M03 (limite
  d'hôte connue), pas d'une nouvelle régression de code.
- Mettre à jour `docs/SECURITY.md` (issu de M06) pour noter explicitement que l'isolation réseau
  bwrap n'a été **positivement prouvée** que sur au moins un hôte, mais reste **non fonctionnelle**
  sur d'autres — et que c'est un état attendu documenté, pas une inconnue.

## 4. Protocole de validation

**Setup** : `npm test -- sandbox.test.ts` doit se terminer (pass ou fail propre), jamais timeout ni
exception non gérée, quel que soit l'hôte.

**Métriques à capter :**
1. Comportement du test réseau sur au moins deux environnements différents si possible (un où bwrap
   fonctionne, un où il échoue) — documenter le résultat de chaque cas sans supposer.
2. Confirmation qu'aucun test ne se termine en timeout ou en exception process-level non catchée.

## 5. Procédure / Étapes

### Partie A — Préparation
- Relire `sandbox.test.ts` en entier, en particulier le test réseau introduit par M03.
- Relire `AUDIT-PALLAS-v0.2.md` §1.1 et §2.2 en entier.

### Partie B — Vérifications préalables
- Reproduire le crash exact (`server.listen` + `EPERM` sans handler) en isolation, hors vitest, pour
  confirmer la cause avant de corriger.

### Partie C — Exécution
- Ajouter le handler d'erreur et la stratégie de repli décidée en section 3.
- Mettre à jour `docs/SECURITY.md`.

## 6. Ce que l'agent doit faire
1. Ne pas se contenter de rendre le test vert localement — vérifier qu'il échoue *proprement* (pas
   par timeout/crash) même en simulant un environnement où le bind réseau est refusé.
2. Documenter honnêtement, comme pour M03, la distinction entre "bug de test corrigé" et "limite
   d'hôte qui persiste".
3. Ne pas affaiblir la preuve positive d'isolation (le test qui vérifie 0 requête reçue) pour
   contourner le problème — l'objectif est de gérer l'échec de setup, pas de supprimer la preuve.

## 7. Critères de succès
- [ ] Aucun test de `sandbox.test.ts` ne se termine en timeout ou en exception non gérée, sur un
      environnement simulé où `server.listen` échoue.
- [ ] Le comportement fail-closed sur `BwrapInitError` reste vérifié séparément et documenté comme
      limite d'hôte connue (pas de régression sur ce point acquis par M03).
- [ ] `docs/SECURITY.md` reflète explicitement que la preuve d'isolation réseau est
      hôte-dépendante, avec au moins un exemple documenté de chaque cas (fonctionne / ne fonctionne pas).
- [ ] `npm test` ne dépend plus, pour se terminer, de la capacité de l'hôte à bind un socket local.

## 8. Interdictions
- Ne pas supprimer ou affaiblir la vérification positive d'isolation réseau (0 requête reçue) pour
  "simplifier" le test.
- Ne pas transformer ce test en simple vérification d'arguments bwrap sans avoir d'abord tenté la
  option (a) ou (b) de la section 3 avec une vraie tentative de bind.
- Ne pas cocher "isolation réseau prouvée" dans `PLAN.md`/`README.md` sans préciser sur quel(s)
  type(s) d'hôte c'est le cas — l'audit v0.2 relève déjà que le `README.md` affirme une preuve non
  reproduite sur son environnement.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M07-journal.md`.
Livrables : diff `sandbox.test.ts`, mise à jour `docs/SECURITY.md`, correction de toute affirmation
non qualifiée dans `README.md` sur l'isolation réseau.
