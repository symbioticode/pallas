# MISSION — PALLAS-M20 — Observabilité opérationnelle et CI durcie

## 0. Métadonnées
Mission ID : PALLAS-M20
Date de création : 2026-09-10
Auteur / Agent : Claude (planification) — exécution par agent de code au choix
Projet : Pallas
Statut : CLOTURÉE (2026-09-11)
Dépend de : PALLAS-M13 (les événements à observer doivent déjà être structurés/tracés)
Source de vérité : `AUDIT-PALLAS-v0.3.md` (F-10, section 8) + `.github/workflows/ci.yml`

## 1. Contexte

**Ce qui a été fait (PALLAS-M06, M11) :** CI GitHub Actions fonctionnelle, `npm audit`/`cargo audit`
exécutés avec seuil justifié, documentation sobre (README, ARCHITECTURE, SECURITY, TRADING).

**Ce que révèle l'audit v0.3, non couvert :**
- Aucun système de logs structuré centralisé, métriques, traces, ni alerting quasi temps réel.
  Corruption d'état/ledger, divergence exchange, ordre ambigu, rejet inattendu, échec de
  persistance — rien de tout cela ne déclenche d'alerte.
- Aucun endpoint health/readiness, aucun état de positions consultable, aucun cancel-all testé en
  conditions d'incident, aucun runbook exécutable pour crash transactionnel/clé compromise/
  corruption ledger/perte d'accès exchange.
- RTO/RPO non définis ; avec des fichiers locaux non sauvegardés, le RPO peut être la totalité de
  l'historique.
- **Actions CI utilisant des tags majeurs (`@v4`, `@v23`, `@v15`) plutôt que des SHA immuables** —
  supply-chain risk classique sur GitHub Actions.
- Les tests sandbox peuvent être `skip` en CI si `unshare` est indisponible sur le runner —
  confirmer que ce skip est explicite et documenté, pas silencieux (cohérent avec l'esprit de
  PALLAS-M07).
- Aucune couverture ni seuil exécuté en CI ; aucune protection de branche vérifiable.

## 2. Objectif général

Donner à Pallas un minimum d'observabilité et de discipline opérationnelle pour qu'un incident soit
détecté en quasi temps réel plutôt que découvert a posteriori dans les logs, et durcir la CI contre
les dérives de supply-chain et les faux positifs silencieux.

## 3. Objectifs détaillés

- **Logs structurés (JSON)** sur tous les événements significatifs déjà tracés par le ledger
  (PALLAS-M13/M16) — pas un système de logging séparé et divergent, un miroir structuré du même
  événement vers stdout/fichier pour ingestion par un outil externe (peu importe lequel à ce stade,
  documenter le choix).
- **Alerting minimal** : au moins un mécanisme (webhook simple, email, ou log de niveau `CRITICAL`
  surveillé manuellement pour ce stade) déclenché sur : `AmbiguousOrderError`, corruption d'état ou
  de ledger détectée (PALLAS-M13/M16), kill switch engagé, échec de réconciliation
  (PALLAS-M14).
- **Endpoint ou commande `status`** exposant : dry-run actif/inactif, kill switch, dernières
  positions/ordres connus (post-M14/M15), dernier cycle de l'orchestrateur, âge des dernières
  données de marché utilisées.
- **RTO/RPO explicitement définis et documentés** dans `docs/SECURITY.md`, même s'ils restent
  modestes pour ce stade (ex. "RPO = dernier commit du ledger, pas de sauvegarde distante
  automatique pour l'instant" — honnête plutôt qu'ambitieux et faux).
- **Épingler toutes les actions GitHub par SHA** dans `.github/workflows/ci.yml`, pas par tag majeur.
- **Rendre explicite le comportement de skip des tests sandbox en CI** : si `unshare` est
  indisponible sur le runner, le job doit le logger clairement comme "SKIPPED — raison" dans la
  sortie CI, jamais un skip silencieux qui pourrait passer inaperçu.
- **Ajouter un seuil de couverture minimal en CI** (même modeste, ex. ne pas régresser sous le seuil
  actuel mesuré) pour détecter une régression de couverture, pas nécessairement un seuil ambitieux.

## 4. Protocole de validation

**Setup** : CI GitHub Actions réelle (cohérent avec l'exigence déjà posée en PALLAS-M11 de ne jamais
se fier à une simulation locale).

**Métriques à capter :**
1. Un scénario d'incident simulé (corruption d'état volontaire) déclenche effectivement une alerte
   observable, pas seulement une ligne de log noyée dans le reste.
2. Le endpoint/commande `status` reflète un état réel après un cycle de l'orchestrateur.
3. `git log`/diff du workflow CI confirmant que toutes les actions sont épinglées par SHA.
4. Un run CI réel où `unshare` est indisponible montre un skip explicitement logué, pas silencieux.

## 5. Procédure / Étapes

### Partie A — Préparation
- Vérifier l'avancement de PALLAS-M13/M14/M16 (les événements à observer doivent déjà exister sous
  forme structurée).

### Partie B — Vérifications préalables
- Lister tous les points de `.github/workflows/ci.yml` utilisant des tags majeurs, avant de les
  épingler, pour ne rien oublier.

### Partie C — Exécution
- Épingler les actions CI par SHA (rapide, à faire en premier).
- Ajouter les logs structurés et l'alerting minimal.
- Ajouter l'endpoint/commande `status`.
- Documenter RTO/RPO.
- Rendre explicite le skip sandbox et ajouter le seuil de couverture.

## 6. Ce que l'agent doit faire
1. Ne pas construire un système d'observabilité disproportionné pour ce stade (pas de stack complète
   Prometheus/Grafana obligatoire) — privilégier un mécanisme simple mais réellement fonctionnel à
   une architecture ambitieuse non testée.
2. Vérifier réellement sur GitHub Actions (pas en local) que le skip sandbox et l'épinglage SHA
   fonctionnent comme attendu.
3. Documenter honnêtement des RTO/RPO modestes plutôt que d'inventer des chiffres non tenables.

## 7. Critères de succès
- [ ] Toutes les actions dans `.github/workflows/ci.yml` sont épinglées par SHA, vérifié.
- [ ] Un incident simulé (corruption d'état) déclenche une alerte observable, testé.
- [ ] Un endpoint/commande `status` existe et reflète l'état réel après un cycle de l'orchestrateur.
- [ ] RTO/RPO sont définis et documentés dans `docs/SECURITY.md`, avec un niveau honnête pour ce
      stade.
- [ ] Le skip des tests sandbox en CI (si `unshare` indisponible) est explicitement logué sur un run
      réel, jamais silencieux.
- [ ] Un seuil de couverture minimal est vérifié en CI, sans régression par rapport à la mesure
      actuelle.

## 8. Interdictions
- Ne pas laisser un skip de test silencieux en CI, quelle qu'en soit la raison.
- Ne pas documenter des RTO/RPO ambitieux non soutenus par une réelle infrastructure de sauvegarde.
- Ne pas construire une solution d'observabilité si complexe qu'elle devient elle-même une nouvelle
  source de dette non testée — rester proportionné au stade du projet.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M20-journal.md`, avec lien/capture de run CI réel montrant
l'épinglage SHA et le skip explicite.
Livrables : `.github/workflows/ci.yml` durci, module de logs structurés/alerting, endpoint/commande
`status`, `docs/SECURITY.md` mis à jour avec RTO/RPO.
