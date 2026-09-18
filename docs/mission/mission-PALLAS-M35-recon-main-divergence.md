# MISSION — PALLAS-M35 — Reconnaissance de la divergence origin/main (+237 fichiers)

## 0. Métadonnées
Mission ID : PALLAS-M35
Date de création : 2026-09-14
Auteur / Agent : Claude — exécution par OpenCode
Projet : Pallas
Statut : ACTIF — reconnaissance uniquement, aucune décision de fusion dans cette mission
Dépend de : dépôt `/home/andrei/Projects/80_PALLAS/pallas` (`.git` partagé entre worktrees)
**Ne dépend PAS de et NE DOIT JAMAIS TOUCHER** :
- `/home/andrei/Projects/80_PALLAS/pallas` (worktree HEAD détachée portant la campagne
  CT-2026-020-PALLAS-R1, PID 1768574 vivant) ;
- `/tmp/pallas-m32-publish.8VZhdP` (worktree `missions-M21-M28` utilisé activement pour publier
  les journaux de mission).

## 1. Contexte

`origin/main` a avancé de +237 fichiers via une autre session, pendant que la branche
`missions-M21-M28` recevait les correctifs M29-M34. Personne n'a encore inspecté ce que ces 237
fichiers contiennent. Tant que cette reconnaissance n'est pas faite, aucune fusion n'est
envisageable — pas parce que la fusion est probablement dangereuse, mais parce qu'on ne sait
simplement pas ce qu'elle contient.

**Cette mission ne décide de rien.** Elle produit un inventaire factuel que quelqu'un (Andrei)
lira ensuite pour décider d'une stratégie de fusion. Aucune fusion, aucun rebase, aucun push ne
doit être tenté dans le cadre de cette mission.

## 2. Objectif général

Produire un inventaire catégorisé et sourcé des 237 fichiers de divergence entre `origin/main` et
`missions-M21-M28`, avec une évaluation explicite de tout recoupement avec les artefacts figés de
la baseline `pallas-mvp-freeze-1` ou les livrables de mission déjà produits.

## 3. Objectifs détaillés

- **Isoler le travail dans un troisième worktree**, créé pour cette mission uniquement et
  supprimable après coup — jamais dans les deux worktrees existants listés en §0.
- **Établir la liste exacte des 237 fichiers** (`git diff --name-status <base-commune>..origin/main`
  où `<base-commune>` est le point de fork réel entre les deux branches, à identifier avec
  `git merge-base`) — pas un chiffre approximatif recopié de la conversation.
- **Catégoriser** chaque fichier ou groupe de fichiers : code applicatif, documentation, artefacts
  de build (`dist/`, `target/`), configuration, fichiers générés par un outil, journaux de mission
  d'une autre numérotation, ou autre.
- **Identifier la provenance probable** : dernier commit qui a introduit chaque groupe sur
  `origin/main` (`git log --oneline -- <path>`), auteur/agent si déductible du message de commit.
- **Vérifier les recoupements sensibles** : est-ce qu'un des 237 fichiers touche un chemin qui
  correspond à l'un des 8 artefacts épinglés du bundle CT (`scripts/m27-72h-run.mjs`,
  `scripts/observation-campaign.mjs`, `packages/ledger/dist/*`, `packages/execution/dist/*`,
  `packages/strategy/dist/*`, `crates/risk-engine/target/debug/risk-engine`) ? Est-ce qu'un fichier
  de `docs/mission/` ou `docs/mvp/` sur `origin/main` porte le même nom qu'un livrable déjà produit
  sur `missions-M21-M28` (M29 à M34) avec un contenu différent — un conflit de contenu, pas
  seulement de chemin ?
- **Ne conclure aucune stratégie de fusion.** Le livrable est un inventaire et une liste de
  conflits potentiels, pas une recommandation de merge/rebase.

## 4. Protocole de validation

**Setup** : `git worktree add /tmp/pallas-m35-recon origin/main --detach` (ou équivalent), exécuté
depuis n'importe lequel des worktrees existants **sans modifier leur état** — `git worktree add`
n'écrit que dans les métadonnées `.git/worktrees`, pas dans les répertoires de travail existants,
mais à confirmer par `git status --porcelain` dans les deux worktrees existants avant et après.

**Métriques à capter :**
1. Nombre exact de fichiers de divergence, recompté depuis `git merge-base`, pas recopié.
2. Répartition par catégorie (code / doc / build / config / autre), avec compte par catégorie.
3. Liste explicite de tout chemin qui recoupe un artefact épinglé ou un livrable de mission
   existant, avec le nom exact du fichier des deux côtés.
4. Confirmation, après la mission, que les deux worktrees protégés (§0) sont inchangés
   (`git status --porcelain` vide avant/après dans les deux, comparé).

## 5. Procédure / Étapes

### Partie A — Isolation
- Créer le worktree de reconnaissance dédié, confirmer par `git status --porcelain` que les deux
  worktrees protégés n'ont pas bougé.

### Partie B — Inventaire
- `git merge-base`, `git diff --name-status`, catégorisation, provenance par fichier ou groupe de
  fichiers cohérent.

### Partie C — Recoupements sensibles
- Comparer explicitement aux 8 chemins épinglés et aux fichiers `docs/mission/`/`docs/mvp/` déjà
  produits par M29-M34.

### Partie D — Nettoyage
- Supprimer le worktree de reconnaissance (`git worktree remove`), reconfirmer l'état des deux
  worktrees protégés.

## 6. Ce que l'agent doit faire
1. Ne jamais exécuter de commande git dans `/home/andrei/Projects/80_PALLAS/pallas` ni dans
   `/tmp/pallas-m32-publish.8VZhdP` — création, inspection et suppression du worktree de
   reconnaissance se font depuis un chemin distinct.
2. Ne proposer aucune stratégie de fusion (merge, rebase, cherry-pick sélectif) — cette mission
   s'arrête à l'inventaire et au signalement des conflits potentiels.
3. Vérifier explicitement, avant et après la mission, que les deux worktrees protégés sont
   inchangés — pas une supposition, une commande rejouée avec sa sortie consignée.

## 7. Critères de succès
- [ ] Nombre exact de fichiers de divergence recompté, pas recopié.
- [ ] Catégorisation complète avec provenance par groupe de fichiers.
- [ ] Tout recoupement avec les 8 artefacts épinglés ou les livrables M29-M34 explicitement
      signalé, avec les deux chemins comparés.
- [ ] Confirmation avant/après que les deux worktrees protégés (campagne + publication) sont
      inchangés.
- [ ] Aucune recommandation de stratégie de fusion dans le rapport — inventaire seulement.

## 8. Interdictions
- Ne jamais exécuter de commande d'écriture git (`merge`, `rebase`, `push`, `checkout` d'une
  branche partagée) dans cette mission — reconnaissance en lecture seule uniquement.
- Ne jamais toucher aux worktrees listés en §0, même en lecture, par prudence vis-à-vis du wrapper
  de campagne actif.
- Ne pas recommander de stratégie de fusion — cette décision reste humaine, après lecture du
  rapport.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M35-journal.md` (à livrer directement à Andrei, pas commité
sur une branche partagée pour l'instant — cette mission ne modifie aucune branche).
Livrable : inventaire catégorisé des 237 fichiers, avec provenance et recoupements sensibles
signalés.
