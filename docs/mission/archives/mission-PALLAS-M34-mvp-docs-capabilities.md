# MISSION — PALLAS-M34 — Cartographie des capacités + comparaison CloddsBot (documentation MVP)

## 0. Métadonnées
Mission ID : PALLAS-M34
Date de création : 2026-09-14
Auteur / Agent : Claude — exécution par Codex
Projet : Pallas
Statut : ACTIF — parallèle, non bloquant vis-à-vis de M32 (campagne en cours) et M33 (UI)
Dépend de : `docs/mvp/` (squelette livré par M31), l'ensemble des `docs/AUDIT-PALLAS-v*.md`
(v0.1 → v0.6), l'ensemble des `docs/mission/mission-PALLAS-M*-journal.md` (M01 → M33),
`docs/ANALYSE-CLODDSBOT.md` et `docs/FICHE-LECONS.md` (analyse interne déjà existante du projet
précédent)
**Ne dépend PAS de et NE DOIT PAS toucher à** : la campagne CT-2026-020-PALLAS-R1 en cours — cette
mission est de la documentation pure, aucune interaction avec le code d'exécution ni le process de
campagne.

## 1. Contexte

Le squelette `docs/mvp/` (M31) décrit l'architecture et les garanties de sécurité actuelles, mais
ne raconte pas **l'histoire** : d'où vient chaque garantie, quelle faille elle a fermée, et
pourquoi Pallas a été reconstruit à partir de zéro après CloddsBot plutôt que corrigé sur place.
Cette mission comble ce trou en construisant une cartographie traçable des capacités et une
comparaison ciblée avec CloddsBot.

**Élément de calibration (vérifié à l'extérieur du dépôt, à confirmer par les documents internes)** :
le dépôt public CloddsBot est un agent multi-marchés à très large périmètre (21 canaux de
messagerie, 10 marchés de prédiction, 7 exchanges de futures, 118+ stratégies, lancement de
tokens, marketplace d'agents, minage Bittensor — construit en 12 jours pour un hackathon), dont la
section sécurité publique se limite à trois affirmations (exécution sandboxée avec approbation,
credentials chiffrés AES-256-GCM, logging d'audit des trades) sans détail de mise en œuvre ni
preuve de test. Ce n'est **pas** la source à utiliser pour juger CloddsBot en détail — ni son
`AUDIT.md`/`docs/SECURITY_AUDIT.md` publics ni un nouvel audit de ce dépôt ne font partie du
périmètre de cette mission. La source de vérité pour la comparaison est **interne** :
`docs/ANALYSE-CLODDSBOT.md` et `docs/FICHE-LECONS.md`, déjà produits au moment de la conception de
Pallas, qui documentent précisément quelles failles ont motivé la reconstruction.

## 2. Objectif général

Produire deux livrables de documentation MVP : une cartographie des capacités actuelles de Pallas
tracée jusqu'aux missions/audits qui les ont établies, et un document de comparaison ciblé avec
CloddsBot portant sur les failles de sécurité concrètement résolues depuis — sans surclaim, chaque
ligne sourcée à une preuve déjà auditée.

## 3. Objectifs détaillés

- **`docs/mvp/CAPABILITIES.md`** : parcourir `docs/AUDIT-PALLAS-v0.1.md` → `v0.6.md` et
  `docs/mission/mission-PALLAS-M01-journal.md` → `M33-journal.md`, et construire, capacité par
  capacité (dry-run par défaut, signature EIP-712 V2, sandbox bwrap, ledger signé, kill switch
  externe, réconciliation par fills, garde de permissions des secrets, etc.), une entrée qui
  cite : la mission qui l'a introduite/corrigée, l'audit qui l'a vérifiée, et l'état actuel
  (fermé / partiel avec limite nommée / résiduel). Aucune capacité ne doit apparaître dans ce
  document sans une citation vers un audit ou un journal de mission déjà existant.
- **`docs/mvp/CLODDSBOT-COMPARISON.md`** : à partir de `ANALYSE-CLODDSBOT.md`/`FICHE-LECONS.md`,
  lister les failles ou lacunes identifiées dans le projet précédent, et pour chacune, indiquer
  comment Pallas la traite aujourd'hui — avec citation de la mission/l'audit correspondant. Si une
  faille de `ANALYSE-CLODDSBOT.md` n'a pas d'équivalent traité dans Pallas, le dire explicitement
  plutôt que de l'omettre silencieusement.
- **Mettre en avant, avec preuve, les points de rigueur distinctifs de Pallas** : fail-closed
  systématique (dry-run par défaut, `AmbiguousOrderError` sans retry), cross-check intention/payload
  avant émission, kill switch externe au process et non réarmable silencieusement en mémoire,
  ledger signé obligatoire par défaut (mode `supervised`), garde de permissions des secrets
  imposée par un test de convention anti-contournement, chaîne d'audits versionnée et vérifiable
  par hash de commit, discipline de rejeu (aucun chiffre de test crédité sans exécution
  indépendante). Chaque point doit renvoyer à la mission/l'audit qui le prouve.
- **Cadrer honnêtement le compromis de périmètre** : Pallas couvre un seul marché (Polymarket) en
  dry-run/paper, quand CloddsBot en couvrait des dizaines en production rapide. Documenter ce choix
  comme un compromis assumé (rigueur vs. couverture), pas comme une supériorité générale — et
  rappeler les limites encore ouvertes de Pallas (F-11, attribution heuristique des fills, etc.)
  dans le même document pour éviter tout survente.

## 4. Protocole de validation

**Setup** : aucun changement de code, uniquement lecture de `docs/` et rédaction.

**Métriques à capter :**
1. Nombre de capacités documentées dans `CAPABILITIES.md`, et pourcentage disposant d'une citation
   vérifiable (mission + audit) — cible 100 %.
2. Nombre d'entrées dans `CLODDSBOT-COMPARISON.md` sourcées depuis `ANALYSE-CLODDSBOT.md`/
   `FICHE-LECONS.md`, avec au moins une contrepartie Pallas citée pour chacune (ou une mention
   explicite d'absence de contrepartie).
3. Relecture croisée : chaque affirmation de type « résolu » dans les deux documents doit
   correspondre à un audit qui confirme la fermeture (pas seulement un journal de mission qui
   l'affirme) — appliquer la même discipline que tous les audits précédents (« journal ≠ preuve »).

## 5. Procédure / Étapes

### Partie A — Cartographie des capacités
- Lister toutes les missions M01-M33 et tous les audits v0.1-v0.6, extraire les capacités et leur
  état de fermeture, construire `CAPABILITIES.md`.

### Partie B — Comparaison CloddsBot
- Lire `ANALYSE-CLODDSBOT.md`/`FICHE-LECONS.md`, faire correspondre chaque lacune identifiée à son
  traitement actuel dans Pallas (ou son absence), construire `CLODDSBOT-COMPARISON.md`.

### Partie C — Relecture de cohérence
- Vérifier qu'aucune affirmation ne dépasse ce que les audits ont réellement confirmé ; ajouter les
  limites connues (F-11, etc.) en contrepoint dans les deux documents.

## 6. Ce que l'agent doit faire
1. Ne citer que des faits déjà établis par les audits/missions existants — cette mission compile et
   met en récit, elle n'invente ni ne réévalue.
2. Ne pas tenter de ré-auditer le dépôt public CloddsBot en détail — rester sur les documents
   internes déjà produits (`ANALYSE-CLODDSBOT.md`, `FICHE-LECONS.md`) comme source de comparaison.
3. Cadrer la comparaison comme un compromis de philosophie (rigueur vs. couverture), jamais comme
   un jugement de valeur sur l'équipe ou le projet précédent.
4. Inclure les limites actuelles de Pallas (F-11 notamment) dans les deux documents, pas seulement
   les succès — cohérent avec la discipline de non-survente déjà appliquée dans `docs/mvp/README.md`.

## 7. Critères de succès
- [ ] `docs/mvp/CAPABILITIES.md` livré, 100 % des capacités citées avec mission + audit source.
- [ ] `docs/mvp/CLODDSBOT-COMPARISON.md` livré, chaque lacune source `ANALYSE-CLODDSBOT.md`/
      `FICHE-LECONS.md` traitée (résolue avec preuve, ou absence explicitement notée).
- [ ] Aucune affirmation de fermeture non adossée à un audit (pas seulement un journal de mission).
- [ ] Limites actuelles (F-11, etc.) présentes dans les deux documents, pas seulement les succès.

## 8. Interdictions
- Ne pas produire une nouvelle évaluation de sécurité du dépôt public CloddsBot — hors périmètre.
- Ne pas affirmer qu'une capacité est « résolue » sur la seule base d'un journal de mission non
  confirmé par un audit.
- Ne pas formuler la comparaison en termes dénigrants envers le projet précédent — rester factuel
  et centré sur les choix architecturaux.
- Ne pas toucher au code, à la campagne en cours, ni à l'UI Observatory (hors périmètre de cette
  mission, couvert par M32/M33).

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M34-journal.md`.
Livrables : `docs/mvp/CAPABILITIES.md`, `docs/mvp/CLODDSBOT-COMPARISON.md`.
