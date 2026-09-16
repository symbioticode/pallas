# MISSION — PALLAS-M31 — Fermer le pin restant, figer le code (baseline MVP), amorcer la doc MVP

## 0. Métadonnées
Mission ID : PALLAS-M31
Date de création : 2026-09-13
Auteur / Agent : Claude (vérification post-M30) — exécution par Codex
Projet : Pallas
Statut : ACTIF
Dépend de : PALLAS-M30 (terminée), commit `8ffc8aa550b60d62d352dc5b056f1a38fc034aba`
Bloque : PROMPT-AUDIT-PALLAS-v0.6 (l'audit doit porter sur le commit *figé*, pas sur un état
intermédiaire) et toute rédaction de documentation MVP affirmant un statut GO

## 1. Contexte

M30 a corrigé la suite de tests (304/0/4), le réarmement du kill switch et le coût réseau de la
réconciliation, et a listé 8 hashes d'artefacts runtime dans `bundle-manifest.json`. Mais la
chaîne de vérification du bundle CT-2026-020 ne les applique pas tous :

- `scripts/ct/m30-m27-72h/execute.sh` calcule et compare `sha256sum` pour **2 artefacts sur 8**
  (`scripts/m27-72h-run.mjs`, `scripts/observation-campaign.mjs`) ;
- `scripts/ct/m30-m27-72h/dry-run.sh` vérifie seulement l'**existence** des 6 autres fichiers
  (`packages/ledger/dist/file-ledger.js`, `packages/ledger/dist/ledger-signing.js`,
  `packages/execution/dist/dryRun.js`, `packages/execution/dist/polymarketClient.js`,
  `packages/strategy/dist/run-reference-loop.js`, `crates/risk-engine/target/debug/risk-engine`),
  jamais leur hash ;
- `verify.sh` ne couvre ni les uns ni les autres.

C'est une version atténuée du défaut qui avait invalidé CT-2026-019 (pin partiel du runtime
exécuté) : le manifeste déclare un pin complet, la vérification ne l'impose que partiellement.
Avant de figer le code comme baseline MVP, cet écart doit être fermé — sans quoi « figer le code »
ne veut rien dire de plus fort que ce que garantissait déjà CT-2026-019.

Par ailleurs, un rapport de mission M30 cite un second commit
(`15722989704315a5b023a952a54c79f2d1052022`) qui n'apparaît dans aucun document versionné consulté
pour cette mission (ni `mission-PALLAS-M30-journal.md`, ni `bundle-manifest.json`). Format valide
(40 hex), mais provenance non confirmée depuis cette position — à vérifier en premier lieu.

## 2. Objectif général

Fermer le pin restant, figer formellement le commit qui en résulte comme baseline MVP (le
« dernier code avant paper trading »), et préparer le squelette de documentation MVP — sans y
inscrire de statut GO tant que l'audit v0.6 ne l'a pas confirmé.

## 3. Objectifs détaillés

- **Vérifier la provenance du second commit cité par M30** (`git cat-file -t <hash>`,
  `git log --oneline -1 <hash>`) avant toute autre action ; documenter ce que ce commit contient
  réellement (probablement le commit du journal/bundle lui-même, à confirmer).
- **Étendre la vérification par hash aux 6 artefacts non couverts** dans `execute.sh` (installation
  + `sha256sum` + comparaison au manifeste, avec échec bloquant si divergence) — pas seulement une
  vérification de présence. Envisager de faire porter cette vérification également par `dry-run.sh`
  en lecture seule (comparer le hash sans installer), pour détecter une dérive avant la fenêtre
  d'approbation GPG, pas seulement au lancement réel.
- **Figer le code** : créer un tag ou une branche de référence explicite (ex.
  `pallas-mvp-freeze-1`) sur le commit qui clôt cette mission, avec un `CHANGELOG` ou une note de
  gel qui référence : le commit exact, les chiffres de tests (304/0/4 TS, 65/0 Rust, clippy vert),
  et le statut du pin (désormais complet sur les 8 artefacts).
- **Amorcer le squelette de documentation MVP** (`docs/mvp/`) : structure et sections vides ou en
  état de brouillon (architecture, garanties de sécurité — kill switch, réconciliation, ledger
  signé —, limites connues F-11, procédure d'exploitation), **sans** rédiger de section affirmant
  un statut « GO paper trading » — ce jugement appartient à l'audit v0.6, pas à cette mission.

## 4. Protocole de validation

**Setup** : `npm test` et `cargo test` sur le commit final, comme pour toutes les missions
précédentes — aucun chiffre recopié d'un rapport antérieur sans rejeu.

**Métriques à capter :**
1. Provenance confirmée (ou infirmée) du commit `15722989704315a5b023a952a54c79f2d1052022`.
2. Les 8 artefacts du manifeste sont vérifiés par hash dans `execute.sh` (test positif : hash
   correct → PASS ; test négatif : un seul octet modifié dans un fichier `dist/` → rejet explicite,
   symétrique à ce que `verify-test.sh` fait déjà pour le ledger).
3. Tag/branche de gel créé, pointant vers un commit avec suite verte rejouée.
4. Squelette `docs/mvp/` créé et listé, sans affirmation de statut GO.

## 5. Procédure / Étapes

### Partie A — Provenance
- Vérifier le second commit cité par M30 avant toute chose.

### Partie B — Fermeture du pin
- Étendre `execute.sh` (et si possible `dry-run.sh`) pour vérifier les 6 hashes manquants, avec un
  test positif et un test négatif symétriques à `verify-test.sh`.

### Partie C — Gel
- Rejouer `npm test`/`cargo test`/`clippy` sur le commit final, créer le tag/branche de gel, écrire
  la note de gel.

### Partie D — Squelette MVP
- Créer la structure `docs/mvp/` avec sections en brouillon, sans conclusion de statut.

## 6. Ce que l'agent doit faire
1. Ne pas qualifier le pin de « complet » avant que les 8 artefacts, pas seulement 2, soient
   réellement vérifiés par hash à l'exécution.
2. Ne pas écrire, dans le squelette de documentation MVP, une phrase du type « Pallas est prêt pour
   le paper trading » ou équivalent — ce jugement vient de l'audit suivant, pas de cette mission.
3. Documenter explicitement, dans le journal de mission, la provenance vérifiée (ou non) du second
   commit cité par M30.

## 7. Critères de succès
- [ ] Provenance du commit `15722989...` confirmée ou infirmée explicitement.
- [ ] `execute.sh` vérifie par hash les 8 artefacts du manifeste (preuve : test positif + test
      négatif rejoués).
- [ ] Tag/branche de gel créé sur un commit avec suite 100 % verte rejouée (pas recopiée).
- [ ] Squelette `docs/mvp/` livré, sans affirmation de statut GO/NO-GO.

## 8. Interdictions
- Ne pas figer le code tant que le pin des 8 artefacts n'est pas réellement vérifié.
- Ne pas préjuger dans la documentation MVP du verdict de l'audit v0.6.
- Ne pas relancer ou modifier CT-2026-020 sans rejouer `verify-test.sh` dans son intégralité après
  modification d'`execute.sh`/`dry-run.sh`.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M31-journal.md`.
Livrables : `execute.sh`/`dry-run.sh` mis à jour, tag/branche de gel + note de gel, squelette
`docs/mvp/` (liste des fichiers créés, contenu en brouillon accepté).
