# PALLAS-M26 — Journal de mission — Alerting fiable : STATE_CORRUPT + durabilité

Mission : `docs/mission/mission-PALLAS-M26-alerting-fiable.md`
Statut : CLOTURÉE (2026-09-12)
Date d'exécution : 2026-09-12
Agent : DeepSeek Harness (deepseek-flash) — branche `missions-M21-M28`

---

## 0. Résumé

F-10 corrigé : la corruption d'état émet désormais `STATE_CORRUPT` au POINT DE DÉTECTION
(la lecture), plus seulement au chargement de démarrage. `LEDGER_CORRUPT` est câblé de la même
façon dans `readChain`. L'acheminement webhook gagne un retry borné et un marqueur de backlog.
`npm test` : 298 passed / 0 failed.

## 1. Cause racine reproduite

Dans `main()`, le `try` censé détecter une corruption construisait seulement
`new DurableStateStore(statePath)` — une opération qui NE LIT RIEN et ne peut donc pas échouer.
La corruption n'était levée que plus tard (`enforceKillSwitch` → `store.read()`), et le
`catch` de cette fonction rappelait `store.read()` : la seconde lecture relançait
`StateCorruptionError`, cette fois NON capturée → crash SANS aucune alerte STATE_CORRUPT.

Le scénario exact (checksum falsifié) est reproduit par le test
`packages/strategy/src/state-corrupt-alert.test.ts` : avant M26, `read()` levait l'erreur
sans écrire d'alerte ; après, l'alerte est persistée.

## 2. Audit des 5 anomalies (exigence §6.1)

| Anomalie | Point d'appel | Correspond au point de détection ? |
|---|---|---|
| AMBIGUOUS_ORDER | `run-reference-loop.ts` catch `AmbiguousOrderError` | ✔ déjà correct |
| RECONCILE_FAILED | `run-reference-loop.ts` (échec scope / post-ambiguïté) | ✔ déjà correct |
| STATE_CORRUPT | `durable-state.ts read()` (M26) — avant : `main()` autour du constructeur | ✔ CORRIGÉ |
| LEDGER_CORRUPT | `file-ledger.ts readChain()` (M26) — avant : `main()` au load seul | ✔ CORRIGÉ |
| KILL_SWITCH | `run-reference-loop.ts` (engagement effectif) | ✔ déjà correct |

## 3. Fiabilité de l'acheminement

`emitAnomaly` persiste TOUJOURS la ligne CRITICAL localement (inchangé, garanti). Le webhook
passe d'un essai unique avalé à un retry borné (défaut 2 essais supplémentaires, backoff
exponentiel). Un échec FINAL ajoute une ligne `WARN ALERT_DELIVERY_FAILED` dans le même JSONL :
le backlog d'alertes non acquittées devient détectable par un lecteur externe.

## 4. Preuves d'exécution

- `observability.test.ts` : retry puis succès (3 appels pour retries=2) sans marqueur d'échec ;
  webhook durablement indisponible → 2 appels, ligne CRITICAL conservée + ligne
  `ALERT_DELIVERY_FAILED` avec `attempts=2`.
- `state-corrupt-alert.test.ts` : checksum falsifié et JSON tronqué → `StateCorruptionError` ET
  alerte `ANOMALY.STATE_CORRUPT` persistée.
- `npm test` : **298 passed / 0 failed** (294 + 4). Aucune régression M20.

## 5. Ce qui n'a pas été fait / limites assumées

- **Pas de queue d'alertes persistante** : les livraisons en échec ne sont pas rejouées après
  redémarrage ; le retry est borné et en mémoire. Documenté comme tel.
- **Pas d'accusé de réception** : la ligne `ALERT_DELIVERY_FAILED` signale un échec, mais
  l'acquittement d'une livraison réussie n'est pas tracé.
- **Isolation des tests** : `vitest.config.ts` pose `PALLAS_ALERT_FILE=.pallas/test-alerts.jsonl`
  pour que les tests de corruption n'écrivent pas dans le fichier d'exploitation.
- Aucun changement Rust ; `cargo test` non concerné.

## 6. Références

- Mission : `docs/mission/mission-PALLAS-M26-alerting-fiable.md`
- Code : `packages/core/src/observability.ts`, `packages/strategy/src/durable-state.ts`,
  `packages/ledger/src/file-ledger.ts`, `packages/strategy/src/run-reference-loop.ts`
- Docs : `docs/SECURITY.md` § « Livraison des alertes — garantie réelle (PALLAS-M26) »