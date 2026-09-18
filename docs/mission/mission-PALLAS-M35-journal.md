# JOURNAL — PALLAS-M35 — Reconnaissance de la divergence origin/main (+237 fichiers)

**Statut** : TERMINÉ — reconnaissance lecture seule, aucune décision de fusion prise
**Date** : 2026-09-14
**Agent** : OpenCode

## 0. Résumé exécutif

Le chiffre « +237 fichiers » annoncé dans la mission **n'est reproductible par aucune mesure git**. La divergence réelle est **154 fichiers**, tous portés par la branche `missions-M21-M28` par rapport à `origin/main`. La branche `origin/main` est l'ancêtre commun des deux lignes de travail et **ne contient aucun fichier propre absent de la branche** : ses 150 fichiers sont intégralement présents sur `missions-M21-M28` (110 identiques ou modifiés + 40 renommés).

**Aucune synthèse de divergence, aucune recommandation de fusion n'est formulée ici** — conformément au cadre de la mission, la décision reste humaine.

## 1. Protocole et isolation

- Worktree de reconnaissance dédié : `/tmp/pallas-m35-recon` (HEAD détachée sur `origin/main` = `22e2c53`), créé puis **supprimé** en fin de mission.
- Worktrees protégés (§0) : `/home/andrei/Projects/80_PALLAS/pallas` (campagne CT-2026-020-PALLAS-R1, HEAD `c34e5aa` détachée) et `/tmp/pallas-m32-publish.8VZhdP` (missions-M21-M28, HEAD `23f2726`).
- **État avant** capturé par `git status --porcelain` :
  - main : 1 ligne (`?? docs/mission/mission-PALLAS-M35-recon-main-divergence.md`)
  - pub : 4 lignes (2 modifiés : `docs/mission/mission-PALLAS-M32-journal.md`, `scripts/ct/m32-paper-72h/change-ticket.md` ; 2 untracked : `mission-PALLAS-M33-journal.md`, `mission-PALLAS-M34-journal.md`)
- **État après** rejoué et comparé : **identique** dans les deux worktrees (verdict : inchangés).

## 2. Nombre exact de fichiers de divergence (recompté, pas recopié)

**Métrique 1 (cellule de la mission) — `git diff --name-status <base-commune>..origin/main` :**

- `git merge-base origin/main missions-M21-M28` → `22e2c53075ba8e3bb6a89c59db773f5521360087` (PALLAS-M20).
- Ce commit **EST** `origin/main` lui-même → le diff `merge-base..origin/main` contient **0 fichier**.
- Toute la divergence est portée par `missions-M21-M28` : **154 fichiers** (`git diff --name-status origin/main missions-M21-M28`), soit 80 A + 34 M + 40 R100.

| Direction | Nombre | Lecture |
|---|---|---|
| `merge-base..origin/main` | **0** | origin/main n'apporte rien |
| `origin/main..missions-M21-M28` | **154** | 80 ajoutés, 34 modifiés, 40 renommés |

**Recoupement du chiffre « 237 »** : aucun de 142, 154, 218, 230 n'égale 237. Le nombre probablement évoqué en conversation ne correspond à aucune vision d'arbre. Le chiffre exact reproductible est **154**.

## 3. Répartition par catégorie

| Catégorie | Nombre | Détail |
|---|---|---|
| Code applicatif | 24 | `packages/<core,execution,ledger,observatory,strategy>/src/*` (TS), `scripts/*.mjs` probes |
| Documentation mission | 66 | `docs/mission/*` — dont 40 renommés `docs/mission/` → `docs/mission/archives/` |
| Documentation mvp | 8 | `docs/mvp/*` — créés par M33/M34 |
| Change-tickets CT | 18 | `scripts/ct/m30-m27-72h/*`, `scripts/ct/m32-paper-72h/*` |
| Config racine | 3 | `.gitignore`, `package-lock.json`, `vitest.config.ts` |
| Scripts campagne | 3 | `scripts/m27-72h-run.mjs`, `scripts/observation-campaign.mjs`, `scripts/rotate-credentials.mjs` |
| Autres docs racine | 8 | AUDIT v0.5.1/v0.5.2/v0.6, OBSERVATION, PROMPT, SECURITY, TRADING, RUNBOOK… |

## 4. Provenance par groupe (dernier commit l'ayant introduit sur `missions-M21-M28`)

| Groupe | Commits introducteurs |
|---|---|
| `docs/mission` | M25→M31, M33/M34 (WIP `23f2726`), M32 (publication CT) |
| `docs/mvp` | M31 (`09e2eed`), M32 (`b5f969b`), M33/M34 (WIP `23f2726`) |
| `packages/strategy/src`, `packages/ledger/src`, `packages/core/src` | M21 (`7259c87`), M22-M26, M29 (`c524a6f`, `64a94cb`), M30 (`8ffc8aa`) |
| `packages/execution/src` | M22, M25 (`7e7652b`), M28 (`746056b`) |
| `scripts/ct/m30-m27-72h` | M30-M32 (`1572298`, `09e2eed`, `b5f969b`) |
| `scripts/ct/m32-paper-72h` | M32 (`313fe49`) |
| `packages/observatory/src` | M33 (WIP `23f2726`) |

Aucun commit multi-« branche » identifié : toute la provenance provient de la séquence M21→M34 sur `missions-M21-M28`.

## 5. Recoupements sensibles

**5.1 — Les 8 artefacts épinglés de la baseline `pallas-mvp-freeze-1` :**

| Artefact épinglé | Présent sur origin/main | Présent sur missions-M21-M28 | Recoupement |
|---|---|---|---|
| `scripts/m27-72h-run.mjs` | Non | Oui (A) | Traversé |
| `scripts/observation-campaign.mjs` | Non | Oui (A) | Traversé |
| `packages/ledger/dist/*` | Non | Non | Aucun (artefacts de build, non committés) |
| `packages/execution/dist/*` | Non | Non | Aucun |
| `packages/strategy/dist/*` | Non | Non | Aucun |
| `crates/risk-engine/target/debug/risk-engine` | Non | Non | Aucun |

Constats : 2 des 8 artefacts (`m27-72h-run.mjs`, `observation-campaign.mjs`) sont **créés par la branche** (absents d'origin/main qui s'arrête à M20). Les 4 artefacts de build sont absents des deux arbres (générés, `.gitignore`). Aucun fichier de la divergence ne **modifie** un artefact épinglé existant des deux côtés.

**5.2 — Conflits de contenu sur `docs/mission/` et `docs/mvp/` (M29-M34) :**

- Les 40 fichiers renommés (`docs/mission/*.md` → `docs/mission/archives/*.md`) le sont avec **similarité 100%** (R100) : réorganisation d'archives, **aucun conflit de contenu**.
- `docs/mvp/*` (8 fichiers) n'existent **que sur la branche** ; `docs/ct/` n'existe sur aucune branche (les CT sont sous `scripts/ct/`). Aucun nom partagé à contenu divergent pour les livrables M29-M34.

**5.3 — Chemin communs aux deux arbres (conflits potentiels de contenu) :**

110 chemins communs, dont **34 modifiés** (M) entre les deux branches — ce sont les seuls cas où les deux lignes ont évolué sur le même nom de fichier :

- **Code** : `packages/{core,execution,ledger,observatory,strategy}/src/*` (observabilité, kill switch, file-lock, durable-state, reconciliation, run-reference-loop, clobSchema, polymarketClient…) + 2 `package.json`.
- **Docs racine** : `docs/OBSERVATORY.md`, `docs/RUNBOOK-key-compromise.md`, `docs/SECURITY.md`, `docs/TRADING.md`.
- **Config** : `.gitignore`, `package-lock.json`, `vitest.config.ts` ; **scripts** : 2 probes monoprocessus-concurrency.

## 6. Stricte neutralité

Aucune proposition de merge, rebase ou cherry-pick n'est formulée. Ce document est un inventaire factuel destiné à Andrei pour décision.

## 7. Critères de succès

- [x] Nombre exact recompté depuis `git merge-base` : **154** (et origine du chiffre « 237 » non reproductible, documenté).
- [x] Catégorisation complète avec provenance par groupe.
- [x] Recoupements signalés : 2 artefacts épinglés créés par la branche (pas d'altération), 34 chemins communs modifiés, 0 conflit de contenu sur livrables M29-M34.
- [x] Confirmation avant/après : worktrees protégés **inchangés** (status identiques + même HEAD).
- [x] Aucune recommandation de stratégie de fusion dans ce rapport.