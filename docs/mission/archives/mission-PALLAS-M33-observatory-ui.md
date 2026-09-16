# MISSION — PALLAS-M33 — Mise à jour de l'UI Observatory (baseline figée + visibilité campagne, lecture seule)

## 0. Métadonnées
Mission ID : PALLAS-M33
Date de création : 2026-09-14
Auteur / Agent : Claude — exécution par Codex
Projet : Pallas
Statut : ACTIF — parallèle, non bloquant vis-à-vis de M32
Dépend de : `OBSERVATORY.md` (frontière read-only existante), tag `pallas-mvp-freeze-1`,
`AUDIT-PALLAS-v0.6.md`
**Ne dépend PAS de et NE DOIT PAS toucher à** : la campagne CT-2026-020-PALLAS-R1 en cours
d'exécution (M32) — cette mission est strictement une modification d'UI de lecture, exécutable en
parallèle sans aucune interaction avec le process de campagne, le CT runner, ou les unités systemd.

## 1. Contexte

`Pallas Observatory` (`http://127.0.0.1:4173/`) est une surface de diagnostic **read-only**
volontairement isolée : pas de dépendance vers `@pallas/execution`, `@pallas/risk`,
`@pallas/strategy` ; seulement deux routes HTTP (`GET /`, `GET /api/snapshot`) ; aucune capacité
d'écrire autre chose que `.pallas/observatory-loop.json` (statut opérationnel sans autorité
métier). Cette frontière est un choix de sécurité délibéré, pas un oubli à combler — elle doit
rester intacte après cette mission.

Deux raisons motivent la mise à jour :

1. **L'affichage de baseline est périmé.** `OBSERVATORY.md` documente `AUDIT BASELINE v0.3`
   affiché séparément du commit — mais la baseline figée actuelle est le tag `pallas-mvp-freeze-1`
   (commit `e69d7542f79ff3e6a24df60773147a6a2f400986`), verdict `AUDIT-PALLAS-v0.6.md` (GO paper
   trading supervisé). Un opérateur consultant l'Observatory pendant la campagne M32 verrait une
   référence d'audit qui n'est plus la bonne.
2. **Aucune visibilité sur la campagne 72h en cours** n'existe dans l'UI actuelle. `REFERENCE LOOP`
   affiche `RUNNING`/`STOPPED`/`STALE`/`UNKNOWN`, mais rien sur la progression d'une campagne
   supervisée (identifiant CT, temps écoulé sur les 4320 minutes cibles, checkpoints signés, état
   du kill switch) — données pourtant déjà présentes sur disque (ledger, risk-state, fichiers de
   campagne) et donc affichables sans sortir du read-only.

## 2. Objectif général

Mettre à jour l'Observatory pour afficher la baseline figée actuelle et donner une visibilité en
lecture seule sur la progression de la campagne M32, sans ajouter la moindre capacité d'écriture,
de décision, ou de dépendance vers les packages métier.

## 3. Objectifs détaillés

- **Baseline** : remplacer la référence codée en dur `AUDIT BASELINE v0.3` par une valeur dérivée
  de l'état réel du dépôt (ex. lecture du tag/commit figé, ou d'un fichier de métadonnées déjà
  généré par M31/`BASELINE-FREEZE.md`) — pas une nouvelle valeur codée en dur qui périmera au
  prochain gel.
- **Panneau « Campagne »** (lecture seule) : identifiant CT en cours (ex. `CT-2026-020-PALLAS-R1`),
  horodatage de démarrage, temps écoulé vs cible (4320 min), nombre de checkpoints signés, statut
  du dernier checkpoint (vérifié / signature invalide / absent), horodatage de dernière mise à
  jour. Toutes ces données doivent déjà exister dans les fichiers que la boucle de référence et le
  CT runner écrivent (ledger, checkpoints, manifeste de campagne) — cette mission lit, n'instrumente
  rien de nouveau côté exécution.
- **Indicateur kill switch** (lecture seule) : engagé / non engagé, source (état durable / fichier
  `.pallas/KILL` / les deux) — lu depuis `risk-state.json` existant, affiché tel quel, sans aucun
  contrôle permettant de le modifier depuis l'UI.
- **Coût réseau par cycle** (M30/R-01) : vérifier d'abord si cette donnée est déjà journalisée
  quelque part sur disque (ledger, logs de cycle). Si oui, l'afficher. **Si non, ne pas
  instrumenter la boucle de référence dans cette mission** — ce serait sortir du périmètre UI et
  toucher `@pallas/strategy`, explicitement interdit. Documenter l'absence comme limite connue de
  cette mission plutôt que de la combler par un raccourci hors périmètre.
- **Version affichée** : envisager d'incrémenter `APP v0.1.0` si le changement le justifie, sans
  en faire un objectif en soi.

## 4. Protocole de validation

**Setup** : `nix-shell --run "npm run build && npm run observatory:demo"`, campagne CT active ou
simulée par fixtures de fichiers `.pallas/`.

**Métriques à capter :**
1. `AUDIT BASELINE` affiche la valeur dérivée de l'état réel, pas une constante — test qui change
   la source (nouveau tag simulé) et vérifie que l'affichage suit.
2. Panneau « Campagne » correct sur fixture de campagne en cours, et correct (`UNKNOWN`/absent) en
   l'absence de campagne — pas de valeur inventée.
3. Kill switch affiché correctement pour les trois cas : non engagé, engagé par état, engagé par
   fichier.
4. Aucune nouvelle route HTTP au-delà de `GET /` et `GET /api/snapshot` — test qui vérifie 404/405
   sur toute autre méthode/route, comme documenté dans `OBSERVATORY.md`.
5. Aucune nouvelle dépendance `import` vers `@pallas/execution`, `@pallas/risk`, `@pallas/strategy`
   dans le code de l'Observatory — vérifiable par une recherche statique dans le diff.
6. Redaction des champs sensibles (clé privée, secret, credential, passphrase, mnemonic, seed)
   toujours active après les changements — rejouer le test existant s'il y en a un, sinon en
   ajouter un.

## 5. Procédure / Étapes

### Partie A — Baseline dynamique
- Identifier la source de vérité déjà écrite par M31 pour le tag/commit figé, la lire côté
  Observatory sans dupliquer la logique de gel.

### Partie B — Panneau campagne
- Lire les fichiers de campagne/checkpoints existants (déjà écrits par le CT runner et la boucle
  de référence), afficher les champs listés en §3, avec fallback `UNKNOWN`/`UNAVAILABLE` si absent
  ou corrompu — cohérent avec le principe déjà en place pour le reste de l'UI.

### Partie C — Kill switch et coût réseau
- Ajouter l'indicateur kill switch depuis `risk-state.json`. Vérifier l'existence de données de
  coût réseau ; les afficher si présentes, documenter l'absence sinon.

### Partie D — Vérification de la frontière
- Rejouer/ajouter les tests de frontière (routes, dépendances, redaction) avant de considérer la
  mission terminée.

## 6. Ce que l'agent doit faire
1. Ne jamais interagir avec le process de campagne M32/CT-2026-020 en cours — aucune lecture qui
   nécessiterait d'envoyer un signal, de modifier un fichier de contrôle, ou d'interférer avec le
   CT runner. Lecture de fichiers déjà écrits uniquement.
2. Ne pas instrumenter `@pallas/strategy`/`@pallas/execution` pour produire une donnée manquante
   (coût réseau) — si elle n'existe pas encore sur disque, la documenter comme absente, ne pas
   sortir du périmètre UI pour la créer.
3. Vérifier explicitement, avant de clore la mission, qu'aucune nouvelle route ni aucune nouvelle
   dépendance métier n'a été introduite — pas une affirmation de journal, une vérification rejouée.

## 7. Critères de succès
- [ ] Baseline affichée dérivée dynamiquement de l'état figé réel, plus de valeur périmée codée en
      dur.
- [ ] Panneau campagne affiche les champs listés, correct en présence et en absence de campagne.
- [ ] Kill switch affiché correctement dans les trois cas (aucun, état, fichier).
- [ ] Aucune nouvelle route au-delà de `GET /`/`GET /api/snapshot`, aucune nouvelle dépendance
      métier — vérifié, pas affirmé.
- [ ] Redaction des champs sensibles toujours active.

## 8. Interdictions
- Ne jamais ajouter de route, de contrôle ou de bouton permettant d'écrire le risk state, le
  ledger, de signer, d'approuver, de lancer ou d'arrêter une campagne depuis l'UI.
- Ne jamais importer `@pallas/execution`, `@pallas/risk`, ou `@pallas/strategy` dans le code de
  l'Observatory.
- Ne jamais interagir avec CT-2026-020-PALLAS-R1, ses unités systemd, ou tout process de campagne
  actif — cette mission est un changement d'UI isolé, exécutable en parallèle sans risque pour la
  campagne, précisément parce qu'elle ne la touche pas.
- Ne jamais combler l'absence d'une métrique (ex. coût réseau) en modifiant la boucle de référence
  — documenter l'absence plutôt que sortir du périmètre UI.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M33-journal.md`.
Livrables : composants UI mis à jour (baseline dynamique, panneau campagne, indicateur kill
switch), tests de frontière (routes, dépendances, redaction) rejoués et documentés.
