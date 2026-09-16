# MISSION — PALLAS-M21 — Suite de tests réellement verte + traçabilité des audits

## 0. Métadonnées
Mission ID : PALLAS-M21
Date de création : 2026-09-11
Auteur / Agent : Claude (planification) — exécution par Codex
Projet : Pallas
Statut : ACTIF — 🔴 Critique, **préalable bloquant** à toute autre mission M22-M28
Source de vérité : `AUDIT-PALLAS-v0.4.md` (résultats d'exécution, section 3) + `.gitignore`

## 1. Contexte

**Constat de l'audit v0.4, non ambigu :** `npm test` sur checkout propre donne **263 réussis, 2
échoués, 4 ignorés** — pas 269/269. Les deux échecs concernent les probes de concurrence
interprocessus de PALLAS-M13/M16 (`Unexpected end of JSON input`), a priori un problème de
capture stdout du harnais Vitest plutôt qu'une régression fonctionnelle réelle (l'audit confirme
qu'un lancement direct des mêmes processus, hors Vitest, produit le bon total : 10/10 ordres
conservés). **Ça ne change rien au diagnostic requis : une suite rouge reste une régression CI,
quelle qu'en soit la cause, et aucune autre mission ne doit démarrer sur cette base.**

**Second constat, mineur mais à trancher explicitement :** `AUDIT-PALLAS-v0.4.md` est ignoré par
`.gitignore:9` (`docs/AUDIT-PALLAS*.md`), comme tous les audits précédents — c'était une décision
raisonnable tant que les audits étaient des instantanés ponctuels non versionnés. Maintenant que la
finalisation du projet passe par une chaîne d'audits comparés dans le temps (v0.2.1 → v0.3 → v0.4),
l'absence de traçabilité git de ces documents devient une gêne pour quiconque doit reconstituer
l'historique sans avoir gardé chaque fichier localement.

## 2. Objectif général

Rétablir une suite de tests monorepo réellement verte, diagnostiquée et pas seulement contournée, et
trancher explicitement la question de la traçabilité des rapports d'audit.

## 3. Objectifs détaillés

- Diagnostiquer précisément la cause des 2 échecs (`Unexpected end of JSON input` sur les probes
  M13/M16) : capture stdout Vitest tronquée sur un process enfant, race de flush, ou autre — ne pas
  se contenter de l'hypothèse de l'audit sans la confirmer.
- Corriger la cause réelle (pas contourner par un retry ou un timeout augmenté sans comprendre
  pourquoi ça échoue).
- Décider explicitement du sort des `docs/AUDIT-PALLAS*.md` : soit les retirer du `.gitignore` et
  les committer comme historique versionné (recommandé, cohérent avec le besoin de comparaison
  d'audits), soit documenter pourquoi ils restent volontairement hors git avec une alternative de
  traçabilité (ex. un `CHANGELOG-AUDITS.md` qui résume chaque verdict sans dupliquer le contenu).

## 4. Protocole de validation

**Setup** : `npm test` sur un checkout propre, pas sur l'environnement de développement courant qui
peut masquer le problème.

**Métriques à capter :**
1. `npm test` : 0 échec, 0 skip non justifié (les 4 skips actuels doivent être vérifiés un par un —
   sont-ils les skips sandbox déjà documentés par PALLAS-M07/M20, ou de nouveaux skips silencieux ?).
2. Le même test de concurrence exécuté 5 fois de suite sans échec intermittent (pas juste une fois).

## 5. Procédure / Étapes

### Partie A — Préparation
- Reproduire les 2 échecs sur un checkout propre pour confirmer qu'ils sont systématiques et pas
  liés à l'environnement local de la session d'audit.

### Partie B — Vérifications préalables
- Vérifier ce que fait exactement `Unexpected end of JSON input` — quel process, quel flux, à quel
  moment exact du test.

### Partie C — Exécution
- Corriger la cause racine.
- Trancher la question `.gitignore`/traçabilité des audits.

## 6. Ce que l'agent doit faire
1. Ne pas masquer le problème par un `test.retry()` ou un `--bail=false` — comprendre la cause
   réelle avant de corriger.
2. Vérifier explicitement les 4 skips actuels un par un (nom du test, raison) plutôt que de les
   supposer légitimes parce qu'ils l'étaient lors d'une session précédente.
3. Documenter la décision `.gitignore` de façon explicite, pas comme un oubli.

## 7. Critères de succès
- [ ] `npm test` : 0 échec, exécuté 5 fois de suite sans intermittence, sur un checkout propre.
- [ ] Les 4 skips restants sont identifiés nommément et confirmés légitimes (référence à la mission
      qui les justifie), ou corrigés s'ils ne le sont pas.
- [ ] Le sort des rapports d'audit (`docs/AUDIT-PALLAS*.md`) est explicitement tranché et documenté
      dans le `.gitignore` lui-même (commentaire) ou dans `docs/SECURITY.md`.
- [ ] `cargo test --all-targets` reste vert (65/65, pas de régression introduite par cette mission).

## 8. Interdictions
- Ne pas commencer PALLAS-M22 (ou toute mission suivante) tant que cette mission n'est pas close.
- Ne pas contourner un test rouge par une modification qui réduit sa portée (ex. réduire le nombre
  de processus testés en concurrence) sans avoir d'abord compris la cause.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M21-journal.md`, avec la cause racine diagnostiquée et la
preuve de 5 exécutions consécutives vertes.
Livrables : fix du test/harnais concerné, `.gitignore` mis à jour avec décision documentée.
