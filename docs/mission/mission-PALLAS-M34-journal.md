# Journal de mission — PALLAS-M34

Date : 2026-09-14 (America/Toronto)

Statut : **TERMINÉE — documentation uniquement**

## 1. Périmètre respecté

La mission a produit uniquement :

- `docs/mvp/CAPABILITIES.md` ;
- `docs/mvp/CLODDSBOT-COMPARISON.md` ;
- le présent journal.

Aucun code, package, test, fichier `.pallas`, runner CT, unité systemd, process de campagne ou
surface UI n'a été modifié ni interrogé. Aucun accès Internet et aucun nouvel audit du dépôt public
CloddsBot n'ont été effectués. La comparaison repose exclusivement sur les deux sources internes
existantes à la racine du dépôt.

## 2. Corpus réellement parcouru

### Audits

Les neuf documents/versionnements disponibles ont été lus :

- `docs/AUDIT-PALLAS-v0.1.md` ;
- `docs/AUDIT-PALLAS-v0.2.md` ;
- `docs/AUDIT-PALLAS-v0.2.1.md` ;
- `docs/AUDIT-PALLAS-v0.3.md` ;
- `docs/AUDIT-PALLAS-v0.4.md` ;
- `docs/AUDIT-PALLAS-v0.5.md` ;
- `docs/AUDIT-PALLAS-v0.5.1.md` ;
- `docs/AUDIT-PALLAS-v0.5.2.md` ;
- `docs/AUDIT-PALLAS-v0.6.md`, absent du checkout mais lu depuis le blob Git versionné au commit
  `6605d0fe5165d59a4279969286b98400c85ee03c`.

La règle appliquée à toute fermeture est celle de la mission : **journal ≠ preuve**. Les journaux
servent à attribuer la mission d'origine ; le statut fermé/partiel/résiduel vient de l'audit le plus
récent qui traite réellement le point.

### Missions

- Journaux M01 à M31 lus dans `docs/mission/archives/`.
- Journal M32 lu depuis le blob Git du commit `c40deed` ; il n'est pas présent dans le checkout.
- Le journal M33 a été ajouté au worktree partagé pendant M34, puis lu intégralement. La fiche
  `docs/mission/mission-PALLAS-M33-observatory-ui.md` a également été lue. Aucun audit post-M33
  n'est disponible : ses résultats sont rapportés comme documentés, pas comme fermeture auditée.
- La mission M34 a été lue intégralement avant toute autre action.

### Sources de comparaison et baseline

- `ANALYSE-CLODDSBOT.md` et `FICHE-LECONS.md`, présents à la racine et non sous `docs/` ;
- les six fichiers préexistants de `docs/mvp/` (`README`, architecture, garanties, limites,
  opérations et gel) afin d'aligner terminologie et limites.

## 3. Résultats

### Cartographie des capacités

`CAPABILITIES.md` contient **19 capacités**. Chacune possède :

- une mission/journal d'origine ;
- un audit distinct ;
- un état explicite (`fermé`, `partiel` ou `résiduel`) ;
- les limites qui empêchent d'étendre la preuve au capital réel ou à un autre périmètre.

Métrique de couverture : **19/19 = 100 % mission + audit**.

Les points distinctifs demandés sont couverts sans surclaim : dry-run par défaut,
`AmbiguousOrderError` sans retry, cross-check intention/payload, kill switch externe et réarmable,
ledger `supervised`, garde de permissions des secrets, audits versionnés, pins de gel et rejeu
indépendant des chiffres.

### Comparaison CloddsBot

`CLODDSBOT-COMPARISON.md` contient **18 entrées**. Chaque entrée cite
`ANALYSE-CLODDSBOT.md`, `FICHE-LECONS.md`, ou les deux, puis fournit :

- une contrepartie Pallas avec mission et audit ; ou
- une absence Pallas explicite, adossée au corpus qui confirme cette absence.

Métriques : **18/18 entrées sourcées depuis les documents internes** ; **18/18 avec contrepartie
citée ou absence explicite**. La comparaison sépare le compromis de couverture (CloddsBot large,
Pallas Polymarket/paper étroit) d'un jugement de valeur.

## 4. Limites conservées dans les deux livrables

- **F-11 ouverte** : aucune observation auditée d'au moins 72 h.
- Capital réel **NO-GO** selon v0.6.
- Portefeuille exchange non autoritatif : balances, collateral et positions consolidées absents.
- Attribution des fills heuristique et potentiellement duplicative entre ordres jumeaux.
- Réconciliation REST/polling, sans WebSocket ; single-flight intra-processus seulement.
- État et ledger séparés, sans transaction ACID commune ; pas d'ancrage distant/WORM.
- Kill switch dépendant de la boucle active, du polling, des credentials et de l'exchange.
- Re-signature du ledger manuelle.
- Secrets en strings JS, aucun KMS/HSM/process de signature séparé, rotation plateforme non prouvée.
- Sandbox dépendant du netns de l'hôte et ne protégeant pas la confidentialité en lecture.
- EOA seulement, aucun ordre/ack/fill live audité.
- Stratégie de référence non prédictive : ni calibration, ni backtest, ni modèle de
  frais/slippage démontré.
- Pas de gateway/agent/multi-agent/skill loader ni de couverture multi-marchés dans la baseline.

## 5. Documents absents ou seulement historiques

| Document attendu | État constaté | Traitement documentaire |
|---|---|---|
| `docs/AUDIT-PALLAS-v0.6.md` | absent du checkout ; blob présent au commit `6605d0f` | cité comme preuve Git avec commande de vérification, jamais comme lien local |
| `docs/mission/mission-PALLAS-M32-journal.md` | absent du checkout ; blob présent au commit `c40deed` | lu pour le contexte, sans fermer F-11 |
| `docs/mission/mission-PALLAS-M33-journal.md` | ajouté concurremment au worktree puis lu | résultats M33 documentés, mais non crédités comme fermés faute d'audit post-M33 |

Les déplacements préexistants de M21–M31 vers `docs/mission/archives/` ont été préservés. Aucun
fichier supprimé, déplacé ou restauré par M34.

## 6. Validation documentaire

Contrôles rejoués après rédaction :

1. Comptage des entrées `### CAP-` : **19**.
2. Contrôle automatisé par bloc : **19/19** contiennent une citation de journal de mission et une
   citation d'audit.
3. Comptage des lignes de comparaison : **18**.
4. Contrôle automatisé par ligne : **18/18** citent une source interne et **18/18** portent une
   contrepartie Pallas ou une absence explicite ; chaque ligne cite aussi un audit.
5. Extraction de tous les liens Markdown locaux et résolution depuis `docs/mvp/` : **0 cible de
   fichier absente**. L'audit v0.6 et M32 sont volontairement cités par commande Git, puisqu'un
   lien local serait cassé.
6. Recherche croisée de F-11, du NO-GO capital réel, de l'attribution heuristique, du portefeuille
   non autoritatif et des absences de périmètre : présents dans les deux livrables.
7. `git diff --check` sur les trois livrables : **succès**.

Les liens à fragments reprennent les titres de sections des documents cibles ; les chemins relatifs
ont tous été résolus depuis `docs/mvp/`.

## 7. Conclusion

La mission M34 livre une narration traçable sans transformer une implémentation ou un journal en
preuve d'audit. Le résultat documente ce que Pallas garantit réellement sur la baseline gelée,
ce qui reste partiel, ce qui est entièrement absent, et pourquoi la rigueur d'un périmètre réduit
ne doit pas être présentée comme une supériorité générale sur CloddsBot.
