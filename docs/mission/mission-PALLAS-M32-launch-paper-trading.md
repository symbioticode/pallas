# MISSION — PALLAS-M32 — Matérialiser le bundle (R-07), assainir la provenance des tests (R-08), écarter tout résidu hors baseline (R-09), lancer la campagne paper trading

## 0. Métadonnées
Mission ID : PALLAS-M32
Date de création : 2026-09-13
Auteur / Agent : Claude (synthèse d'AUDIT-PALLAS-v0.6) — exécution par Codex
Projet : Pallas
Statut : ACTIF
Dépend de : tag `pallas-mvp-freeze-1` (commit `e69d7542f79ff3e6a24df60773147a6a2f400986`),
`AUDIT-PALLAS-v0.6.md` (GO paper trading supervisé, conditionnel à R-07)
Portée : cette mission ne touche PAS au capital réel (NO-GO confirmé, hors périmètre) — uniquement
la voie paper trading supervisée.

## 1. Contexte

`AUDIT-PALLAS-v0.6.md` confirme un **GO paper trading supervisé**, conditionnel à la levée de R-07,
et relève trois autres constats résiduels (R-08, R-09, R-10). Le seuil recherché par le projet
(4/5 + GO paper trading, pas 5/5) est atteint en substance — cette mission ferme la dernière
condition explicite avant un lancement réel.

### 1.1 R-07 — le bundle figé n'est pas auto-suffisant

`scripts/ct/m30-m27-72h/artifacts/` est absent de l'arbre figé par le tag. `execute.sh` échoue à sa
précondition `[[ -d "$BUNDLE/artifacts" ]]` tant que ce dossier n'est pas matérialisé depuis une
build propre. Le pin lui-même (8/8 hashes) est complet et vérifié — c'est la **charge utile** du
bundle qui manque, pas le mécanisme de vérification.

### 1.2 R-08 — provenance de la valeur de test figée dans le manifeste

`bundle-manifest.json` conserve `test_evidence: {passed:304, failed:0, skipped:4, total:308}` —
une valeur propre à l'hôte M30 (où les tests d'isolation bwrap étaient skippés faute de netns). Le
gel et le rejeu d'audit donnent `308/0/0` sur un hôte où ces tests s'exécutent. Ce n'est pas une
régression cachée (l'audit l'a expliqué), mais la valeur figée dans le manifeste doit porter une
note d'environnement pour qu'un futur lecteur ne s'interroge pas sur un « 304 vs 308 ».

### 1.3 R-09 — aucune campagne ne doit tourner sur autre chose que le tag

La seule campagne ayant tourné un temps significatif (705 332 ms, `reason=sigterm`) l'a fait sur
`64a94cb` (M29), **hors de la baseline figée**. Avant tout nouveau lancement, vérifier explicitement
qu'aucun process résiduel ne tourne sur cet ancien commit ou tout autre commit non figé.

### 1.4 R-10 — backlog, non bloquant

Le single-flight de `reconcileAllUnresolved` est intra-processus seulement. À documenter comme
limite connue dans `docs/mvp/known-limitations.md`, sans action corrective dans cette mission (pas
de double cancel-all possible, uniquement des lectures exchange potentiellement dupliquées entre
deux processus distincts).

## 2. Objectif général

Lever la condition R-07 du GO paper trading, assainir R-08, vérifier R-09, documenter R-10, puis
lancer réellement une campagne de paper trading supervisée ≥72h depuis le tag `pallas-mvp-freeze-1`
— c'est l'aboutissement de la séquence M21→M32.

## 3. Objectifs détaillés

- **Matérialiser `scripts/ct/m30-m27-72h/artifacts/`** : reconstruire les 8 artefacts depuis une
  build propre du commit figé (`npm ci && npm run build`, `cargo build`), les placer dans le
  dossier `artifacts/` du bundle, puis rejouer `verify-artifact-pins.mjs` (le vérificateur livré par
  M31, déjà générique et testé) pour confirmer 8/8 avant toute installation.
- **Rejouer `dry-run.sh` puis `execute.sh` de bout en bout** sur ce bundle matérialisé, en
  environnement de test d'abord (pas encore la campagne réelle), pour confirmer que la précondition
  `artifacts/` est désormais satisfaite et que les 8 hashes passent avant/après installation.
- **Documenter R-08** : ajouter au `bundle-manifest.json` (ou dans un fichier adjacent) une note
  explicite du type « `test_evidence` reflète l'environnement M30 (tests d'isolation bwrap
  indisponibles) ; le rejeu de gel sur un hôte avec netns donne 308/0/0 — voir
  `AUDIT-PALLAS-v0.6.md` ». Ne pas modifier rétroactivement les chiffres eux-mêmes (ils sont
  corrects pour leur contexte), seulement ajouter le contexte manquant.
- **Vérifier R-09** : lister tout process actif lié à `run-reference-loop.ts` ou
  `observation-campaign.mjs`, confirmer qu'aucun ne tourne sur `64a94cb` ou tout commit hors du tag
  figé ; le cas échéant, l'arrêter proprement (SIGTERM, checkpoint re-signé, comme lors du rollback
  précédent).
- **Documenter R-10** dans `docs/mvp/known-limitations.md` comme limite connue et acceptée pour le
  paper trading (lecture seule, pas de risque de double cancel-all).
- **Lancer la campagne paper trading supervisée** : depuis le tag `pallas-mvp-freeze-1` exactement
  (vérifier `git rev-parse HEAD` avant lancement), ledger en mode `supervised`, intervalle 30 s,
  durée cible ≥72h, avec suivi explicite du coût `getOpenOrders`/`getTrades` par cycle (pertinence
  directe de M30 sur les limites de débit).

## 4. Protocole de validation

**Setup** : worktree propre (`git status --porcelain` vide), checkout exact du tag
`pallas-mvp-freeze-1`.

**Métriques à capter :**
1. `verify-artifact-pins.mjs` : 8/8 PASS sur le bundle matérialisé, avant toute installation.
2. `dry-run.sh` et `execute.sh` rejoués sans échec de précondition (`artifacts/` présent).
3. Note R-08 ajoutée et lisible, sans modification des chiffres historiques.
4. Confirmation explicite (commande + sortie) qu'aucun process ne tourne sur un commit hors tag
   avant le lancement de la campagne réelle.
5. Une fois la campagne lancée : `git rev-parse HEAD` == hash du tag, horodatage de démarrage,
   premier checkpoint signé et vérifié.

## 5. Procédure / Étapes

### Partie A — Matérialisation du bundle (R-07)
- Build propre depuis le tag, copie des 8 artefacts dans `artifacts/`, vérification 8/8.

### Partie B — Rejeu à blanc
- `dry-run.sh` puis `execute.sh` en environnement de test (pas la campagne réelle) pour confirmer
  la précondition levée.

### Partie C — Assainissement (R-08, R-09, R-10)
- Note d'environnement dans le manifeste ; vérification qu'aucun process résiduel hors tag ne
  tourne ; entrée `known-limitations.md` pour R-10.

### Partie D — Lancement réel
- Lancer la campagne depuis le tag exact, avec surveillance du coût réseau par cycle dès les
  premières heures (pas seulement à la fin des 72h).

## 6. Ce que l'agent doit faire
1. Ne pas lancer la campagne réelle avant d'avoir confirmé, par une commande explicite et son
   résultat dans le journal, qu'aucun process hors tag ne tourne (R-09).
2. Ne pas modifier les chiffres historiques du manifeste pour « corriger » R-08 — seulement ajouter
   le contexte manquant.
3. Surveiller et consigner le coût réseau par cycle dès le début de la campagne, pas seulement en
   fin de fenêtre — c'est la donnée que F-11 est censée produire.

## 7. Critères de succès
- [ ] Bundle matérialisé, 8/8 vérifié avant/après installation, `dry-run.sh`/`execute.sh` rejoués
      sans échec de précondition.
- [ ] Note R-08 ajoutée, chiffres historiques inchangés.
- [ ] Confirmation explicite qu'aucun process ne tournait sur un commit hors tag avant lancement.
- [ ] R-10 documenté dans `known-limitations.md`.
- [ ] Campagne paper trading supervisée lancée depuis le tag exact, premier checkpoint signé et
      vérifié, suivi du coût réseau amorcé dès le départ.

## 8. Interdictions
- Ne pas toucher au périmètre capital réel (NO-GO confirmé par v0.6, hors mission).
- Ne pas lancer la campagne réelle sur un commit autre que le tag `pallas-mvp-freeze-1`.
- Ne pas créditer F-11 comme fermé avant que la campagne atteigne effectivement ≥72h — cette
  mission ne fait que lancer la campagne, pas conclure sur son résultat.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M32-journal.md`.
Livrables : bundle `artifacts/` matérialisé, note R-08 dans le manifeste, entrée R-10 dans
`known-limitations.md`, preuve de lancement de campagne (commit, horodatage, premier checkpoint).
