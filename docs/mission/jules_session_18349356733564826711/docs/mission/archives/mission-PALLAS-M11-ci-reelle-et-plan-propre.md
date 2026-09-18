# MISSION — PALLAS-M11 — CI réelle, documentation committée, PLAN.md source de vérité unique

## 0. Métadonnées
Mission ID : PALLAS-M11
Date de création : 2026-09-09
Auteur / Agent : Claude (planification) — exécution par agent de code au choix
Projet : Pallas
Statut : CLÔTURÉE — 2026-09-10 (voir journal `mission-PALLAS-M11-journal.md`)
Source de vérité : `AUDIT-PALLAS-v0.2.md` (sections 1.4, 3.3, 4.1) + `.github/workflows/ci.yml`
+ `PLAN.md`

## 1. Contexte

**Ce qui a été fait (PALLAS-M06, clôturée) :** pipeline GitHub Actions écrite, documentation sobre
rédigée (`README.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/TRADING.md`), seuil
`npm audit --audit-level=high` justifié, test de non-régression par bug volontaire prouvé
**localement**.

**Ce que révèle l'audit v0.2, non couvert par M06 :**

1. **La CI n'a jamais tourné sur un vrai runner.** `.github/workflows/ci.yml` existe dans l'arbre de
   travail mais l'audit v0.2 précise : « la pipeline est seulement indexée dans l'arbre de travail,
   pas présente au commit HEAD » — et surtout, avec l'état de tests observé par v0.2 (96/99, 3
   échecs sandbox), « son job TypeScript échouerait avec les résultats locaux actuels à l'étape
   `npm test` ». La CI n'a donc jamais été exécutée dans les conditions qu'elle prétend garantir
   (checkout propre, runner standard).

2. **La documentation n'est pas commitée.** README/docs ajoutés/modifiés dans l'arbre de travail,
   pas au HEAD audité — donc pas encore versionnés de façon vérifiable au moment de l'audit v0.2.

3. **`PLAN.md` contient encore des contradictions internes non nettoyées**, relevées explicitement
   par v0.2 §3.3 : une case CI cochée `[ ]` (absente) à un endroit et `[x]` (faite) plus loin dans le
   même fichier ; des compteurs de tests contradictoires dans la même section (37 tests puis 50
   tests Rust cités côte à côte) ; sandbox annoncé "9/9" et TS "84/84" à un endroit du fichier alors
   que l'exécution réelle constatée par v0.2 est 6/9 sandbox et 96/99 global ; migration vitest
   encore décrite ailleurs comme "66 tests rouges". Ces contradictions ne changent rien au runtime,
   mais rendent `PLAN.md` impropre comme source de vérité — quelqu'un qui le lit ne peut pas savoir
   quelle ligne est à jour.

4. **`README.md` affirme l'isolation réseau bwrap comme "prouvée"** sans la qualifier — contredit
   par v0.2 sur son propre environnement (voir aussi PALLAS-M07).

## 2. Objectif général

Faire tourner la CI réellement sur un runner GitHub Actions standard depuis un commit propre,
committer la documentation, et nettoyer `PLAN.md` pour qu'il redevienne une source de vérité unique
et cohérente — sans compteurs contradictoires ni cases en désaccord avec elles-mêmes.

## 3. Objectifs détaillés

- Committer et pousser `.github/workflows/ci.yml`, `README.md`, `docs/ARCHITECTURE.md`,
  `docs/SECURITY.md`, `docs/TRADING.md` sur une branche, et observer réellement l'exécution du
  workflow sur GitHub Actions (pas une simulation locale). Documenter le résultat réel : vert, ou
  rouge avec le détail exact des échecs.
- Si la CI est rouge à cause des tests sandbox (attendu, cf. PALLAS-M03/M07) : décider explicitement
  de la stratégie — `continue-on-error` justifié et daté avec condition de retrait (ex. "levé quand
  PALLAS-M07 est clôturée et le runner supporte le bind réseau"), ou exclusion ciblée documentée des
  tests connus comme hôte-dépendants, jamais un `continue-on-error` silencieux sur toute la suite.
- Réécrire `PLAN.md` pour supprimer toute contradiction interne : un seul compteur de tests à jour
  par section (avec la date), une seule valeur de vérité par case, suppression des anciennes
  mentions devenues obsolètes plutôt que leur accumulation au fil des sessions.
- Corriger `README.md` pour qualifier précisément l'affirmation sur l'isolation réseau (renvoi vers
  PALLAS-M07 et sa nuance hôte-dépendante), plutôt que de l'affirmer sans réserve.
- Évaluer à nouveau l'ajout de `cargo clippy` au `shell.nix` (dette notée depuis l'audit v0.1,
  toujours absente à v0.2) — soit l'ajouter, soit documenter explicitement pourquoi ce n'est
  toujours pas fait avec une date de retrait de cette dette.

## 4. Protocole de validation

**Setup** : accès à un dépôt GitHub réel avec Actions activées (pas seulement un environnement
local).

**Métriques à capter :**
1. Lien/capture du run CI réel sur GitHub Actions, avec son statut exact (vert/rouge, détail des
   jobs).
2. Diff de `PLAN.md` avant/après montrant les contradictions supprimées, avec une relecture qui
   confirme qu'aucun couple de lignes ne se contredit plus.
3. Statut `cargo clippy` : ajouté et exécuté, ou absence documentée avec justification et date de
   retrait prévue.

## 5. Procédure / Étapes

### Partie A — Préparation
- Vérifier l'état de clôture de PALLAS-M07 (fiabilisation du test réseau) avant de décider de la
  stratégie CI sur les tests sandbox — un test qui timeout/crash ne doit jamais être laissé tel quel
  en CI, corrigé par M07 en amont si possible.

### Partie B — Vérifications préalables
- Relire `AUDIT-PALLAS-v0.2.md` §1.4, §3.3, §4.1 en entier.
- Lister toutes les occurrences de compteurs de tests dans `PLAN.md` (grep) avant de les nettoyer,
  pour ne pas en oublier une lors de la réécriture.

### Partie C — Exécution
- Committer et pousser, observer le run réel.
- Ajuster la CI selon le résultat réel (pas celui espéré).
- Réécrire `PLAN.md` en une passe qui élimine toute contradiction, pas des correctifs ponctuels qui
  en laisseraient certaines.

## 6. Ce que l'agent doit faire
1. Ne jamais déclarer la CI "verte" sans avoir observé un run réel sur GitHub Actions — la
   simulation locale ne suffit plus après le constat de l'audit v0.2.
2. Nettoyer `PLAN.md` en profondeur, pas en ajoutant encore une nouvelle couche de correctifs par
   dessus les anciennes (c'est exactement le mécanisme qui a produit les contradictions actuelles).
3. Documenter toute dette restante (clippy absent, par exemple) avec une justification et une date,
   plutôt que de la laisser silencieuse.

## 7. Critères de succès
- [x] Un run CI réel sur GitHub Actions est observé et son résultat exact (vert ou rouge, détail)
      est documenté dans le journal — pas une simulation locale présentée comme équivalente.
      *(M11 : runs réels VERTs observés — commits `a07c9a8`/`e401b24`/`60b392f`/`c35f749`/`ad526ba`,
      liens dans le journal → §5)*
- [x] Si la CI est rouge sur les tests sandbox, la stratégie (exclusion documentée avec date de
      retrait, ou correction complète via PALLAS-M07) est explicite, pas un `continue-on-error`
      silencieux généralisé.
      *(M11 : pas de rouge — les tests sandbox passent en CI réelle depuis M07
      (sonde `realBwrap` + skip explicite) ; aucune exclusion nécessaire)*
- [x] `PLAN.md` ne contient plus aucune paire de lignes contradictoires sur le même sujet (compteurs
      de tests, statut CI, statut sandbox) — vérifié par relecture croisée explicite dans le journal.
      *(M11 : 6 contradictions réellement nettoyées, relecture grep + §10 du journal)*
- [x] `README.md` qualifie précisément l'affirmation sur l'isolation réseau bwrap (renvoi PALLAS-M07).
      *(fait en M07 — constaté et refermé ici, voir journal §4)*
- [x] Le statut de `cargo clippy` dans `shell.nix` est soit résolu, soit documenté avec justification
      et date de retrait.
      *(M11 : résolu — `clippy` ajouté au `shell.nix`, `cargo clippy --all-targets --all-features
      -- -D warnings` propre ; 7 lints corrigés dans var.rs/kelly.rs/volatility.rs/pipeline.rs/
      cli_tests.rs → journal §6)*

## 8. Interdictions
- Ne pas déclarer une mission "clôturée" sur la seule base d'une exécution locale quand la mission
  porte justement sur la preuve en environnement CI réel.
- Ne pas ajouter de nouvelles couches de correctifs à `PLAN.md` sans supprimer les anciennes
  affirmations devenues fausses ou redondantes.
- Ne pas utiliser `continue-on-error: true` sur un job entier pour masquer un sous-ensemble de tests
  connus comme fragiles — cibler précisément les tests concernés si une exclusion est nécessaire.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M11-journal.md`, avec lien/capture du run CI réel et diff complet
de `PLAN.md`.
Livrables : commit(s) poussés incluant CI + doc, `PLAN.md` nettoyé, `README.md` corrigé, `shell.nix`
mis à jour ou dette documentée.
