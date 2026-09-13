# MISSION — PALLAS-M25 — Kill switch hors surface publique, autorité indépendante du process

## 0. Métadonnées
Mission ID : PALLAS-M25
Date de création : 2026-09-11
Auteur / Agent : Claude (planification) — exécution par Codex
Projet : Pallas
Statut : ACTIF — 🟠 Haute
Dépend de : PALLAS-M21 (base verte)
Source de vérité : `AUDIT-PALLAS-v0.4.md` (F-06, section 4.2) + `packages/execution/src/index.ts`
+ `packages/execution/src/killSwitch.ts` + `packages/execution/src/polymarketClient.ts`

## 1. Contexte

**Ce qui a été fait (PALLAS-M14, M17) et reste correct comme fondation :** `cancelAllOrders()`
envoie bien `DELETE /cancel-all`, `enforceKillSwitch` l'appelle sur engagement, `isDryRun` n'est
plus injectable par un chemin de production standard hors `PALLAS_TEST_MODE=1`.

**Ce que révèle l'audit v0.4, une réserve répétée qui persiste dans sa substance malgré les
correctifs successifs :**
- `setGlobalKillSwitch` reste **publiquement exporté** via l'export wildcard de
  `packages/execution/src/index.ts:4` — n'importe quel code du même process peut désengager le kill
  switch sans passer par l'orchestrateur prévu.
- L'injection `isKillSwitchEngaged` dans la configuration de `PolymarketClient` n'est **pas
  restreinte** (`polymarketClient.ts:43`) contrairement à `isDryRun` — le même problème que celui
  fermé pour `isDryRun` en PALLAS-M17 existe encore ici, sur un flag tout aussi critique.
- `PALLAS_TEST_MODE=1` reste **une variable d'environnement**, donc une autorité faible : elle peut
  être positionnée par erreur, hérite de l'environnement du process parent, et ne constitue pas une
  séparation de build/service réelle entre "mode test" et "mode production".

**Pourquoi c'est classé "Élevée" et pas "Critique" par l'audit :** contrairement à F-03, il n'y a
pas de scénario où ce défaut cause seul une perte financière immédiate — mais c'est la dernière
ligne de défense (kill switch) qui reste mutable de l'intérieur, exactement le genre de garantie qui
doit être *la plus* dure à contourner, pas la plus molle.

## 2. Objectif général

Faire du kill switch une autorité qu'aucun code du même process ne peut désengager silencieusement,
et clore définitivement la question `isKillSwitchEngaged` de la même façon que PALLAS-M17 a clos
`isDryRun`.

## 3. Objectifs détaillés

- Retirer `setGlobalKillSwitch` (et toute primitive de désengagement) des exports publics de
  `@pallas/execution` — la garder accessible uniquement en interne (module non exporté, ou
  sous-chemin d'import réservé et documenté) à l'orchestrateur qui en a la responsabilité légitime.
- Restreindre `isKillSwitchEngaged` en configuration de `PolymarketClient` exactement comme
  `isDryRun` : rejet hors `PALLAS_TEST_MODE=1`, avec la même erreur explicite au constructeur.
- Évaluer une autorité de kill switch plus forte qu'une variable de process : un fichier "flag"
  externe au process (vérifié à intervalle court, ex. présence de `.pallas/KILL` sur le disque)
  ou un service séparé — au minimum, documenter explicitement pourquoi une solution plus robuste
  n'est pas mise en œuvre dans cette mission si le choix reste la variable de process pour ce
  stade.
- Vérifier que la restriction `PALLAS_TEST_MODE` reste cohérente entre `isDryRun` et
  `isKillSwitchEngaged` — un seul mécanisme de verrouillage de test, pas deux logiques différentes
  qui divergent avec le temps.

## 4. Protocole de validation

**Setup** : `npm test` vert (packages/execution) à chaque étape.

**Métriques à capter :**
1. Test qui confirme que `setGlobalKillSwitch` n'est plus accessible depuis un import public de
   `@pallas/execution`.
2. Test qui confirme que `isKillSwitchEngaged` est refusé hors `PALLAS_TEST_MODE=1`, symétrique au
   test déjà existant pour `isDryRun`.
3. Décision documentée sur l'autorité de kill switch externe (fichier flag, service séparé, ou
   maintien de la variable de process avec justification).

## 5. Procédure / Étapes

### Partie A — Préparation
- Relire `killSwitch.ts`, `index.ts`, `polymarketClient.ts` en entier.
- Relire la correction déjà faite pour `isDryRun` en PALLAS-M17 pour appliquer exactement le même
  motif.

### Partie B — Vérifications préalables
- Confirmer par un test que `setGlobalKillSwitch` est bien importable publiquement aujourd'hui,
  avant correction.

### Partie C — Exécution
- Retirer l'export public.
- Restreindre `isKillSwitchEngaged` comme `isDryRun`.
- Statuer sur l'autorité externe.

## 6. Ce que l'agent doit faire
1. Appliquer très précisément le même motif que PALLAS-M17 pour la cohérence — ne pas réinventer
   une logique différente pour un problème structurellement identique.
2. Vérifier qu'aucun test existant ne dépend de l'accès public à `setGlobalKillSwitch` (auquel cas
   ces tests doivent être adaptés pour utiliser le chemin interne réservé, pas contourner la
   restriction).
3. Documenter honnêtement si l'autorité externe (fichier/service) n'est pas implémentée dans cette
   mission, avec la raison.

## 7. Critères de succès
- [ ] `setGlobalKillSwitch` n'est plus exporté publiquement par `@pallas/execution`, testé.
- [ ] `isKillSwitchEngaged` est refusé hors `PALLAS_TEST_MODE=1`, testé symétriquement à `isDryRun`.
- [ ] La question de l'autorité de kill switch externe au process est explicitement tranchée et
      documentée (implémentée, ou limite assumée avec justification).
- [ ] Aucune régression sur les tests existants de PALLAS-M14/M17.

## 8. Interdictions
- Ne pas laisser `setGlobalKillSwitch` accessible par un chemin d'import public, même
  "techniquement profond" (ré-export indirect, chemin de fichier non documenté mais atteignable).
- Ne pas traiter cette mission comme mineure sous prétexte qu'elle est classée "Élevée" et non
  "Critique" — c'est la dernière ligne de défense du système.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M25-journal.md`.
Livrables : diffs `index.ts`, `killSwitch.ts`, `polymarketClient.ts`, tests, `docs/SECURITY.md` mis
à jour.
