# JOURNAL — PALLAS-M07 — Sandbox bwrap : fiabiliser le test réseau sur hôte restrictif (suite M03)

Agent : opencode — 2026-09-10 — Statut : CLÔTURÉE ✔

## 1. Constat (audit v0.2 §1.1 / §2.2)

Sur un environnement plus restrictif que l'hôte de validation M03, `npm test` :
1. `execute un binaire autorise sous bwrap` et `input passe a stdin` → `BwrapInitError`
   (l'unshare réseau n'est pas permis par cet hôte) — comportement fail-closed DOCUMENTÉ (M03),
   pas une régression de code.
2. **Le plus grave** : le test « réseau isolé… » timeout puis lève une exception **non gérée**
   (`server.listen` → `EPERM` sans handler `'error'`, `sandbox.test.ts` pré-correctif) — un test
   qui plante la suite au lieu d'échouer proprement.

## 2. Cause confirmée (preuve hors vitest)

`/tmp/opencode/m07-eperm-probe.mjs` — un serveur http dont `listen` échoue (reproduit par
`EADDRINUSE`, le même chemin d'événement `'error'` que l'`EPERM` de l'hôte audité) :

```
A: CRASH NON CAPTURE (ancien comportement): EADDRINUSE      ← exception process-level
B: rejection PROPRE capturee par le test (plus de crash): EADDRINUSE   ← handler 'error' (nouveau)
```

## 3. Correctifs appliqués

### 3.1 `packages/execution/src/sandbox.test.ts`
- **Sonde `realBwrap`** : une exécution réelle `runSandboxed('python3', ['-c', 'pass'])` au charge­ment
  du fichier. `test.runIf(realBwrap)` sur les 4 tests qui PROUVENT l'isolation (execute, réseau
  0-requête, resolveBinary durci, stdin). Si bwrap est absent OU si l'unshare est refusé → **skip
  explicite** (pas d'exécution en clair, pas de faux rouge d'environnement).
- **Handler `'error'` sur `server.listen`** (test réseau) : toute erreur de bind → rejection propre
  du test avec message clair, plus jamais de crash process-level ni de timeout muet.
- La preuve positive d'isolation (0 requête reçue) et le fail-closed restent **intacts**.

### 3.2 `packages/execution/src/sandbox.ts`
- `locateBwrap()` cherche aussi dans le **PATH** en dernier recours : le bwrap fourni par le
  `shell.nix` (CI Nix) vit dans `/nix/store/…-bubblewrap-*/bin`, absent des 3 chemins fixes.
  Fail-closed conservé (`MissingBwrapError` si introuvable partout).

### 3.3 Documentation
- `docs/SECURITY.md` : preuve d'isolation **hôte-dépendante** explicite (annexe M06/vérification + ce
  journal), skip explicite si bwrap indisponible/refusé, jamais d'exécution en clair.
- `README.md` : affirmation « isolation réseau prouvée » **qualifiée** (voir §5).

## 4. Métriques / preuve sur 2 environnements réels

| Environnement | bwrap | Sonde `realBwrap` | Tests d'isolation (4) | Preuve positive rendue |
|---|---|---|---|---|
| Dev NixOS (validation M03/CI locale) | présent, init OK | true | **tournent et passent** | ✔ 0 requête reçue par le serveur hôte |
| Runner GitHub ubuntu (run 34464717913, job TS) | 0.11.2 via Nix, mais `unshare` refusé | false | **skippés explicitement** (`↓`) | non (env non capable) — fail-closed reste vérifié |

Runner (run 34464717913) — détail des 9 tests `sandbox.test.ts` : **5 pass** (allowlist ×2, refus
fail-closed ×2, test négatif `BwrapInitError` avec fake bwrap ✓) + **4 skip explicites** ; aucun
timeout, aucune exception non capturée.

## 5. Critères de succès

- [x] Aucun test de `sandbox.test.ts` en timeout ou exception non gérée (preuve §2 : crash → rejection).
- [x] Fail-closed `BwrapInitError` vérifié séparément (test négatif fake-bwrap, passe sur les 2 hôtes).
- [x] `docs/SECURITY.md` : preuve hôte-dépendante documentée, un exemple par cas (NixOS = fonctionne,
      runner ubuntu = ne fonctionne pas / skip).
- [x] `npm test` ne dépend plus de la capacité de l'hôte à bind un socket local.

## 6. Qualif README (exigence M07 §9 + M11)

`README.md` « Démarrage » et « CI » : phrase d'en-tête « sandbox bwrap pour les exécutions shell
(isolation réseau prouvée) » → remplacée par « isolation réseau **prouvée sur l'hôte de dev, skip
explicite ailleurs** (bwrap non capable) » avec renvoi M07. (Alignement final dans M11.)

## 7. Livrables

- `packages/execution/src/sandbox.test.ts` (sonde + runIf + handler `'error'`), `sandbox.ts`
  (PATH fallback) — déjà committé en `3429c8f` (CI Nix) avec l'annexe M06.
- Journal M07 (ce fichier), `docs/SECURITY.md`, `README.md` (qualif).

## 8. Reserves transverses inchangées

`isDryRun` injectable, retry `placeOrder` manuel (Ambiguous), 2 advisorys npm modérées (seuil high),
passage Vitest 5 à décider — traitées par M10/M11 selon leur périmètre.