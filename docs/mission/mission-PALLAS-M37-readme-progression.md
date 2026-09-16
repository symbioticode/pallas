# MISSION — PALLAS-M37 — README racine + PROGRESSION.md (à partir de M36 vérifié)

## 0. Métadonnées
Mission ID : PALLAS-M37
Date de création : 2026-09-16
Auteur / Agent : Claude — exécution par OpenCode (Codex indisponible, occupé sur M32) ; second
regard par Jules une fois le brouillon prêt
Projet : Pallas
Statut : ACTIF
Source de vérité : `docs/mission/mission-PALLAS-M36-jules-review-2.md` **tel que vérifié dans
cette conversation** (commit `e69d7542f79ff3e6a24df60773147a6a2f400986`, `Étape 0` confirmée) —
**pas** le contenu actuellement sur `origin/main`, potentiellement encore pollué par la fusion
accidentelle de PR #2 au moment où cette mission démarre. Si la remédiation §0 n'est pas terminée,
travailler depuis la copie locale du rapport, pas depuis `origin/main`.
**Ne dépend PAS de et NE DOIT PAS toucher** : CT-2026-020-PALLAS-R1, ni aucune branche/PR git —
la gestion de `main`/PR reste une action humaine, hors périmètre de cette mission.

## 1. Contexte

`docs/mvp/CLODDSBOT-COMPARISON.md` (M34) déséquilibre la documentation vers la comparaison avec le
projet précédent. `mission-PALLAS-M36-jules-review-2.md`, produit par un relecteur externe vérifié
sur le bon commit, donne une base factuelle et sourcée pour corriger ce déséquilibre : une liste
« nécessaire et suffisant » de 3 points bloquants, des observations positives sourcées (fail-closed,
couverture de tests, piste d'audit), et une évaluation de rigueur qui ne repose sur aucune
comparaison externe.

## 2. Objectif général

Produire un README racine et un `PROGRESSION.md` qui donnent à un nouvel arrivant, en quelques
minutes de lecture, une image correcte et équilibrée de Pallas — ce qu'il fait, ce qu'il ne fait
pas, ce qui le rend rigoureux, et comment le faire tourner — sans dépendre de la comparaison
CloddsBot pour établir sa valeur.

## 3. Objectifs détaillés

- **Corriger les 3 points bloquants de M36 §7** :
  1. Documenter l'ordre de build obligatoire (`cargo build --release` avant `npm test`) directement
     dans le README, pas seulement dans une doc annexe.
  2. Documenter `PALLAS_LEDGER_MODE=dev` comme requis pour la démo Observatory hors production, et
     envisager (à la discrétion de l'agent, pas une obligation) de le rendre implicite dans
     `scripts/observatory-demo.mjs` plutôt que de seulement documenter le contournement.
  3. Ajouter une séquence de démarrage sans Nix (Node 22 + Cargo) à côté de `nix-shell`.
- **Rédiger `PROGRESSION.md`** : un historique condensé et lisible de M21 à M36 (pas un simple
  renvoi vers `docs/mission/`), structuré autour des jalons qui comptent pour un lecteur externe :
  gel MVP (M31), audit v0.6 et son verdict (GO paper trading, pas capital réel), lancement de la
  campagne supervisée (M32), état actuel. Sourcé aux audits/missions, comme `CAPABILITIES.md`.
- **Rééquilibrer la mise en avant des bénéfices** : utiliser en priorité les éléments positifs déjà
  sourcés par M36 §5-6 (fail-closed par conception, 308 tests TS + 65 tests Rust, permissions de
  clés vérifiées à 0600, verrous fichiers avec détection de vivacité par PID/hostname, piste
  d'audit versionnée) comme argumentaire principal du README — la comparaison CloddsBot devient une
  note secondaire, pas l'argument central.
- **Ne pas essayer de faire disparaître les réserves** : les points d'interrogation de M36 §5
  (ordre de build implicite, sandbox bwrap non universellement actif) et les limites déjà connues
  (F-11, NO-GO capital réel) doivent rester visibles dans le README/PROGRESSION — un document qui
  ne montre que les points forts serait moins crédible, pas plus.

## 4. Protocole de validation

**Setup** : lecture de `mission-PALLAS-M36-jules-review-2.md` et `docs/mvp/CAPABILITIES.md`/
`CLODDSBOT-COMPARISON.md` (M34) comme sources, aucune modification de code.

**Métriques à capter :**
1. Les 3 points bloquants de M36 §7 sont vérifiablement corrigés dans le README (rejouer les
   commandes qui échouaient et confirmer qu'elles réussissent maintenant en suivant les nouvelles
   instructions).
2. `PROGRESSION.md` couvre M21→M36 avec citation vers chaque audit/mission source.
3. Relecture par Jules du brouillon final (second regard, cf. §0 métadonnées) — pas une
  auto-validation par l'agent qui a rédigé.

## 5. Procédure / Étapes

### Partie A — Corrections bloquantes
- Intégrer les 3 corrections de M36 §7 dans le README.

### Partie B — PROGRESSION.md
- Rédiger l'historique condensé, sourcé.

### Partie C — Rééquilibrage
- Réécrire l'ouverture du README autour des bénéfices sourcés par M36, réduire
  `CLODDSBOT-COMPARISON.md` à une mention secondaire (lien, pas argument central).

### Partie D — Second regard
- Soumettre le brouillon à Jules pour relecture, avec la même exigence de vérification de ref
  qu'en M36 (le brouillon devra être lu depuis le bon commit/branche, pas deviné).

## 6. Ce que l'agent doit faire
1. Sourcer chaque affirmation positive du README à M36 ou à un audit existant — pas de nouvelle
   affirmation non vérifiée.
2. Garder les réserves connues visibles (F-11, NO-GO capital réel, points d'interrogation M36 §5)
   — ne pas les faire disparaître au nom de la lisibilité.
3. Ne toucher à aucune branche ni PR git — cette mission produit du contenu, la publication reste
   humaine.

## 7. Critères de succès
- [ ] Les 3 corrections bloquantes de M36 vérifiées par rejeu des commandes concernées.
- [ ] `PROGRESSION.md` livré, sourcé M21→M36.
- [ ] README rééquilibré : bénéfices sourcés en premier, CloddsBot en mention secondaire, réserves
      connues toujours visibles.
- [ ] Relecture Jules du brouillon obtenue avant de considérer la mission terminée.

## 8. Interdictions
- Ne pas supprimer ou minimiser les réserves connues (F-11, NO-GO capital réel).
- Ne pas toucher à `origin/main`, aux PR, ni à aucune branche git.
- Ne pas sourcer le contenu depuis `origin/main` sans avoir confirmé que la remédiation PR #2/#3
  est terminée — utiliser la copie locale vérifiée de M36 en attendant.

## 9. Format attendu
`README.md` (racine) mis à jour, `PROGRESSION.md` créé, `docs/mission/mission-PALLAS-M37-journal.md`
avec preuve de rejeu des 3 corrections et confirmation de la relecture Jules.
