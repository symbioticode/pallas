# MISSION — PALLAS-M38 — Nettoyage post-M32, fusion vers main, mise à jour de l'historique

## 0. Métadonnées
Mission ID : PALLAS-M38
Date de création : 2026-09-17
Auteur / Agent : Claude — exécution par Codex
Projet : Pallas
Statut : TERMINÉE
Dépend de : `missions-M21-M28` (commit `43941d0` poussé, contenant le rapport final M32),
`origin/main` (commit `5d90d92`, sain après revert PR#2 + cherry-pick `bc8905f`)

## 1. Contexte

**Le nettoyage du gitlink et de la copie de session Jules est déjà fait** (commit `b98bfd6`,
poussé sur `missions-M21-M28`) — Partie A de cette mission est donc terminée avant de démarrer,
vérifiée : `git ls-tree -r b98bfd6 | grep 160000` vide, aucun fichier `jules_session_*` restant.
Ne pas refaire ce travail.

**Le conflit `ci.yml` est confirmé, pas seulement anticipé.** Diff exact entre les deux branches :
```diff
-      - run: nix-shell --run "npm ci && npm run build && npm run coverage"
+      - run: nix-shell --run "npm ci && npm run build && npm run coverage -- --reporter=text"
```
`missions-M21-M28` (`b98bfd6`) porte toujours l'ancienne ligne avec `--reporter=text` ; `main`
(`5d90d92`) porte la version corrigée par `bc8905f` (celle qui fait réellement passer le job
`coverage`, cf. run CI #25 échoué / #26 réussi). **Avant la fusion**, appliquer sur
`missions-M21-M28` la ligne de `main` (celle sans `--reporter=text`) — pas l'inverse, et pas un
merge automatique qui laisserait git choisir un côté au hasard sur ce fichier.

Par ailleurs, la revue directe de la branche `m37-readme-progression-review` a trouvé deux défauts
dans les livrables de M37 :
- Le README cite `docs/mission/archives/mission-PALLAS-M36-jules-review.md` (la tentative 1,
  **invalidée**) au lieu de `mission-PALLAS-M36-jules-review-2.md` (la version vérifiée).
- `PROGRESSION.md` cite des preuves via `git show <hash>:...` pour deux hash (`6605d0f`, `c40deed`)
  qui **n'existent dans aucune branche du dépôt distant** — invérifiables par un lecteur externe.
  Maintenant que `mission-PALLAS-M32-journal.md` et l'audit correspondant sont réellement présents
  dans l'arbre de `missions-M21-M28`, ces citations doivent pointer vers des chemins de fichiers
  réels du dépôt, pas des hash de commits orphelins.

Enfin, `main` a évolué depuis le point de fork initial (revert de la fusion accidentelle PR#2, puis
cherry-pick de `bc8905f` qui retire `--reporter=text` de `ci.yml`). Une fusion de
`missions-M21-M28` vers `main` ne sera donc plus un fast-forward et doit préserver l'état correct
de `ci.yml`.

## 2. Objectif général

Nettoyer `missions-M21-M28`, corriger les citations défectueuses de M37, fusionner proprement vers
`main`, et mettre à jour l'historique documenté (`PROGRESSION.md`, dépréciation de
`SYNTHESE-M21-M28.md`).

## 3. Objectifs détaillés

- **Corriger le README** : citation vers `mission-PALLAS-M36-jules-review-2.md`.
- **Corriger `PROGRESSION.md`** : remplacer les citations `git show 6605d0f:...` et
  `git show c40deed:...` par des chemins de fichiers réels dans l'arbre actuel de
  `missions-M21-M28` (ex. `docs/mission/mission-PALLAS-M32-journal.md`, présent depuis `43941d0`).
  Si l'audit v0.6 lui-même n'est disponible que par blob externe, le dire explicitement plutôt que
  de citer un hash invérifiable.
- **Mettre à jour `PROGRESSION.md`** avec la clôture de M32 : durée réelle (72h00min08,6s),
  13 checkpoints signés, 1 incident contrôlé absorbé, **F-11 fermé pour l'exigence d'observation
  mais pas encore confirmé par un audit indépendant** (ne pas écrire « fermé » sans cette réserve),
  et le point RSS ~1,06 GiB à signaler comme sujet d'investigation, pas comme un non-événement.
- **Déprécier `SYNTHESE-M21-M28.md`** : le déplacer vers `docs/archives/`, avec une ligne d'en-tête
  indiquant qu'il est remplacé par `PROGRESSION.md` comme source d'historique à jour — ne pas le
  mettre à jour lui-même, éviter d'avoir deux documents d'historique divergents.
- **Appliquer sur `missions-M21-M28` la version de `ci.yml` de `main`** (retirer
  `--reporter=text`), en commit séparé avant la fusion — le conflit est confirmé, pas hypothétique
  (diff cité en §1).
- **Fusionner `missions-M21-M28` vers `main`** (merge commit, pas de fast-forward possible).
- **Fermer/supprimer `m37-readme-progression-review`** une fois son contenu intégré.

## 4. Protocole de validation

1. Confirmer l'absence de gitlink et du dossier `jules_session_*` après le commit correctif
   (`git ls-tree -r <commit> | grep 160000` vide, `jules_session` absent).
2. Confirmer que les deux citations corrigées de `PROGRESSION.md` pointent vers des chemins qui
   existent réellement dans l'arbre au moment du commit.
3. `npm test`/`cargo test`/`clippy` rejoués sur `main` après fusion — chiffres exacts, pas
   recopiés.
4. `ci.yml` sur `main` post-fusion ne contient pas `--reporter=text`.

### Partie B — Corrections M37
- Corriger les deux citations (README, PROGRESSION.md), commit, push.

### Partie C — Mise à jour de l'historique
- Mettre à jour `PROGRESSION.md` avec la clôture M32 (réserves incluses), déprécier
  `SYNTHESE-M21-M28.md`.

### Partie D — Fusion
- Appliquer la version corrigée de `ci.yml` sur `missions-M21-M28`, fusionner vers `main`,
  rejouer la suite de tests, fermer les branches devenues inutiles.

## 6. Ce que l'agent doit faire
1. Ne pas écrire que F-11 est fermé sans la réserve « sous réserve de confirmation par audit
   indépendant » — cohérent avec la discipline déjà appliquée à chaque mission précédente.
2. Ne pas citer de hash de commit/blob sans avoir vérifié qu'il existe sur le dépôt distant.
3. Vérifier explicitement `ci.yml` avant de fusionner — ne pas laisser un merge automatique
   réintroduire une régression déjà corrigée deux fois.

## 7. Critères de succès
- [ ] Citations README/PROGRESSION corrigées et vérifiables dans l'arbre.
- [ ] `PROGRESSION.md` reflète la clôture M32 avec ses réserves.
- [ ] `SYNTHESE-M21-M28.md` déprécié, pas mis à jour en parallèle.
- [ ] Fusion vers `main` faite, `ci.yml` correct, suite de tests rejouée et verte sur `main`.

## 8. Interdictions
- Ne pas réécrire l'historique déjà poussé (`43941d0`) — corriger par commits additionnels.
- Ne pas fusionner vers `main` avant d'avoir vérifié `ci.yml`.
- Ne pas fermer `m37-readme-progression-review` avant confirmation que son contenu est bien
  intégré dans `main`.

## 9. Format attendu
`docs/mission/mission-PALLAS-M38-journal.md`, avec preuve de chaque étape (diffs, résultats de
tests rejoués, confirmation de l'état final des branches).
