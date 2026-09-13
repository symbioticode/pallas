# MISSION — PALLAS-M27 — Campagne d'observation réelle multi-jours (paper trading dry-run)

## 0. Métadonnées
Mission ID : PALLAS-M27
Date de création : 2026-09-11
Auteur / Agent : Claude (planification) — exécution par Codex, avec supervision humaine active
Projet : Pallas
Statut : ACTIF — 🟠 Haute, **mission de nature différente des autres** (campagne d'observation
calendaire, pas un correctif de code isolé)
Dépend de : PALLAS-M21 à M26 (le code observé doit être dans son état le plus corrigé possible
avant de lancer une campagne longue — relancer une campagne après chaque correctif serait
contre-productif)
Source de vérité : `AUDIT-PALLAS-v0.4.md` (F-11, section 6 et 9) — nouveau finding introduit par
cet audit, absent des précédents

## 1. Contexte

**Constat de l'audit v0.4, distinct de tous les précédents par sa nature :** aucun des trois audits
précédents n'a pu observer Pallas tourner plus de quelques cycles ponctuels. F-11 énonce
explicitement ce que ni un audit de code ni un test unitaire ne peuvent démontrer : la tenue dans la
durée. Concrètement, non observés à ce jour :
- comportement face à des données de marché périmées (stale feeds) sur une session longue ;
- dérive mémoire ou accumulation d'état sur plusieurs jours d'exécution continue ;
- reconnexion après une coupure réseau prolongée (pas juste un timeout ponctuel déjà testé) ;
- accumulation de l'état durable (taille du ledger, du fichier d'état) et son effet sur les temps
  de lecture/écriture au fil du temps.

**Pourquoi c'est un facteur bloquant distinct du code :** l'audit le formule explicitement — c'est
un facteur *temps*, pas un facteur *code*. Aucune des missions PALLAS-M21 à M26, aussi bien
exécutées soient-elles, ne peut se substituer à cette observation. C'est la condition qui empêche
structurellement Pallas de dépasser le niveau "backtesting technique" vers "paper trading
supervisé", quelle que soit la qualité du reste.

## 2. Objectif général

Faire tourner Pallas en dry-run strict, contre des données de marché Polymarket réelles, sur une
durée continue suffisante pour observer les défaillances de longue durée que les audits ponctuels
ne peuvent pas révéler — et produire un rapport d'incident/observation exploitable par le prochain
audit.

## 3. Objectifs détaillés

- Définir une durée d'observation cible réaliste et l'annoncer avant de démarrer (l'audit suggère
  "plusieurs jours" — proposer un minimum concret, ex. 72h continues au minimum, idéalement 7 jours
  avant tout audit v0.5, sans jamais présenter une durée plus courte comme suffisante).
- Lancer l'orchestrateur (`run-reference-loop.ts`) en dry-run strict, sur un ou plusieurs marchés
  Polymarket réels actifs, avec le ledger et l'état durable actifs pendant toute la durée.
- Mettre en place, avant le démarrage, une supervision minimale de la campagne elle-même
  (indépendante de PALLAS-M20 si celle-ci n'est pas encore assez mature) : un moyen simple de
  vérifier périodiquement que le process tourne toujours, que le ledger progresse, que la mémoire
  du process ne dérive pas de façon anormale.
- Provoquer, si possible pendant la campagne, au moins un incident contrôlé (ex. couper le réseau
  quelques minutes, tuer le process et le relancer) pour observer la reprise en conditions réelles
  plutôt que simulée.
- À l'issue de la campagne, produire un rapport d'observation factuel : disponibilité effective
  (% de temps actif), incidents rencontrés (spontanés ou provoqués) et comportement observé, taille
  finale du ledger/état et tout effet sur la performance, toute anomalie de dérive mémoire, nombre
  de cycles complets exécutés, nombre de rejets/erreurs et leur répartition par cause.

## 4. Protocole de validation

**Setup** : dry-run strict garanti actif pendant toute la durée (vérifié avant le démarrage, pas
supposé). Aucune tentative d'ordre live, aucune levée de `signatureSchemaValidated`.

**Métriques à capter :**
1. Durée réelle de fonctionnement continu atteinte (comparée à l'objectif annoncé).
2. Nombre d'incidents rencontrés, leur nature, et le comportement du système à chacun.
3. Évolution de la mémoire du process et de la taille des fichiers d'état/ledger dans le temps.
4. Nombre de cycles de l'orchestrateur exécutés, avec répartition allow/reject/erreur.

## 5. Procédure / Étapes

### Partie A — Préparation
- Vérifier que PALLAS-M21 à M26 sont closes ou, à défaut, documenter précisément quel sous-ensemble
  de correctifs est actif au moment du lancement de la campagne (pour que le prochain audit sache
  exactement quelle version a été observée).
- Confirmer le dry-run actif par un test avant démarrage, pas par supposition.

### Partie B — Vérifications préalables
- Mettre en place le monitoring minimal de la campagne (même un script de vérification périodique
  suffit à ce stade).

### Partie C — Exécution
- Lancer la campagne pour la durée annoncée.
- Provoquer au moins un incident contrôlé pendant la fenêtre d'observation.
- Rédiger le rapport d'observation à l'issue.

## 6. Ce que l'agent doit faire
1. Ne jamais raccourcir la durée annoncée sans le documenter explicitement comme une limite du
   rapport final (ex. "72h visées, 48h effectivement observées suite à [raison]").
2. Ne pas interpréter l'absence d'incident spontané comme une preuve de robustesse totale — c'est
   une observation positive mais partielle, à formuler avec la prudence appropriée.
3. Documenter chaque anomalie rencontrée avec autant de détail que pour un bug de code, même
   mineure — c'est précisément le type d'information que cette mission doit produire.

## 7. Critères de succès
- [ ] Une campagne d'au moins 72h continues de dry-run contre des données Polymarket réelles est
      effectivement réalisée, avec preuve horodatée (logs, ledger).
- [ ] Au moins un incident contrôlé (coupure réseau ou kill/restart) est provoqué et son
      comportement de reprise documenté.
- [ ] Un rapport d'observation factuel est produit, couvrant disponibilité, incidents, dérive
      mémoire, taille des fichiers d'état, et répartition des décisions du risk engine.
- [ ] Le dry-run reste strictement actif pendant toute la durée, vérifié et non supposé.

## 8. Interdictions
- Ne jamais lever `signatureSchemaValidated` ou désactiver le dry-run pendant cette campagne, même
  temporairement, même pour "tester en conditions plus réalistes".
- Ne pas présenter une campagne plus courte que celle annoncée comme équivalente sans le signaler
  explicitement dans le rapport.
- Ne pas lancer cette mission avant PALLAS-M21 à M26 sans documenter précisément quelle version a
  été observée, sous peine de produire un rapport dont la pertinence pour le prochain audit sera
  contestable.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M27-journal.md` **et** un rapport d'observation séparé
(`docs/OBSERVATION-M27-<date>.md`) destiné à être cité directement par le prochain audit.
Livrables : logs/ledger/état de la campagne conservés (pas supprimés après coup), rapport
d'observation factuel.
