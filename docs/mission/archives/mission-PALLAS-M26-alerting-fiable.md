# MISSION — PALLAS-M26 — Alerting fiable : câblage correct de STATE_CORRUPT + durabilité

## 0. Métadonnées
Mission ID : PALLAS-M26
Date de création : 2026-09-11
Auteur / Agent : Claude (planification) — exécution par Codex
Projet : Pallas
Statut : ACTIF — 🟠 Haute
Dépend de : PALLAS-M21 (base verte)
Source de vérité : `AUDIT-PALLAS-v0.4.md` (F-10, section 6) +
`packages/strategy/src/run-reference-loop.ts` + `packages/core/src/observability.ts`

## 1. Contexte

**Ce qui fonctionne (confirmé par v0.4) :** une simulation d'`AmbiguousOrderError` produit
effectivement une alerte JSONL `CRITICAL/AMBIGUOUS_ORDER` observable dans `.pallas/alerts.jsonl` ;
`emitAnomaly` écrit bien le fichier et tente un webhook optionnel.

**Le défaut précis, confirmé par lecture de code — l'alerte la plus importante du système est mal
câblée :** dans `run-reference-loop.ts:624`, le `try` censé détecter une corruption d'état ne fait
que **construire** l'objet `DurableStateStore` — une opération qui ne lit rien et ne peut donc pas
échouer sur une corruption. La corruption réelle n'est levée que **plus tard**, dans
`enforceKillSwitch` (`:647`), et à ce stade elle n'est que **consignée dans le payload de
`kill_switch_sync`** — jamais transformée en alerte `STATE_CORRUPT`. **L'incident le plus grave que
le système puisse rencontrer (état durable corrompu) n'émet donc aucune alerte CRITICAL**, alors
même que le mécanisme d'alerting existe et fonctionne pour d'autres cas.

**Second défaut, sur la fiabilité du canal lui-même :** le webhook est fire-and-forget et ses
échecs sont explicitement avalés (`observability.ts:109`) — pas de retry, pas d'accusé de
réception, pas d'escalade si le canal externe est indisponible au moment précis de l'incident (le
pire moment pour perdre silencieusement une alerte).

## 2. Objectif général

Faire que la corruption d'état déclenche réellement l'alerte `STATE_CORRUPT` au moment où elle est
détectée, et rendre l'acheminement des alertes résilient à l'échec du canal externe.

## 3. Objectifs détaillés

- Déplacer le point de détection/émission de l'alerte `STATE_CORRUPT` au moment réel où la
  corruption est levée (probablement dans le chemin de lecture de `DurableStateStore`, pas dans sa
  construction, et pas seulement consigné dans `enforceKillSwitch`) — l'alerte doit être émise dès
  que la lecture échoue, indépendamment de ce qui l'appelle ensuite.
- Vérifier s'il existe d'autres alertes du même type (construites mais jamais réellement câblées au
  bon point de détection) — auditer systématiquement chaque anomalie listée dans
  `packages/core/src/observability.ts` (`AMBIGUOUS_ORDER`, `RECONCILE_FAILED`, `STATE_CORRUPT`,
  `LEDGER_CORRUPT`, `KILL_SWITCH`) et confirmer, pour chacune, le point d'appel exact et qu'il
  correspond bien au moment de détection réelle.
- Ajouter une durabilité minimale à l'acheminement des alertes : au minimum, persister localement
  toute alerte dont le webhook a échoué (déjà fait via le fichier JSONL, mais vérifier qu'un lecteur
  externe peut détecter un "backlog" d'alertes non acquittées) et ajouter un mécanisme de retry
  simple (ex. tentatives supplémentaires espacées, pas juste un essai unique).
- Documenter dans `docs/SECURITY.md` la garantie réelle de livraison des alertes ("au moins écrites
  localement, webhook best-effort avec retry limité, pas de garantie de livraison distante forte")
  plutôt que de laisser croire à un mécanisme d'alerting plus robuste qu'il ne l'est.

## 4. Protocole de validation

**Setup** : `npm test` vert (packages/core, packages/strategy) à chaque étape.

**Métriques à capter :**
1. Test qui provoque une corruption d'état réelle et vérifie qu'une alerte `STATE_CORRUPT` est
   effectivement émise au moment de la détection — reproduction exacte du scénario manqué relevé
   par l'audit v0.4.
2. Audit systématique des 5 types d'anomalies : pour chacune, le point d'appel correspond-il
   vraiment au moment de détection ?
3. Test qui simule un webhook indisponible et vérifie le comportement de retry/persistance locale.

## 5. Procédure / Étapes

### Partie A — Préparation
- Relire `run-reference-loop.ts:600-650` en entier (la zone exacte identifiée par l'audit) et
  `observability.ts` en entier.

### Partie B — Vérifications préalables
- Reproduire le scénario exact de l'audit (corruption d'état) et confirmer qu'aucune alerte
  `STATE_CORRUPT` n'est actuellement émise, avant correction.

### Partie C — Exécution
- Déplacer le point d'émission de l'alerte au bon endroit.
- Auditer les 4 autres types d'anomalies.
- Ajouter le retry/persistance sur le canal webhook.

## 6. Ce que l'agent doit faire
1. Vérifier chaque type d'alerte individuellement — ne pas supposer que corriger `STATE_CORRUPT`
   suffit si d'autres alertes ont le même défaut de câblage.
2. Ne pas construire un système de retry disproportionné (pas de queue distribuée) — un mécanisme
   simple et documenté suffit à ce stade, cohérent avec l'esprit de PALLAS-M20.
3. Être honnête dans la documentation sur ce qui est réellement garanti, pas ce qui est souhaité.

## 7. Critères de succès
- [ ] Une corruption d'état réelle déclenche une alerte `STATE_CORRUPT` observable au moment de sa
      détection, testé — reproduction exacte du scénario manqué par l'audit v0.4.
- [ ] Les 5 types d'anomalies sont vérifiés individuellement pour un câblage correct au point de
      détection réel.
- [ ] Un échec de webhook déclenche au moins une tentative de retry, documentée, et l'alerte reste
      de toute façon persistée localement.
- [ ] `docs/SECURITY.md` décrit honnêtement la garantie de livraison réelle des alertes.
- [ ] Aucune régression sur les tests existants de PALLAS-M20.

## 8. Interdictions
- Ne pas se limiter à corriger `STATE_CORRUPT` sans vérifier les 4 autres types d'anomalies pour le
  même défaut de câblage.
- Ne pas documenter une garantie de livraison d'alerte plus forte que ce qui est réellement
  implémenté.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M26-journal.md`, avec preuve avant/après du scénario manqué.
Livrables : diffs `run-reference-loop.ts`, `observability.ts`, tests, `docs/SECURITY.md` mis à jour.
