# PALLAS-M20 — Journal de mission — Observabilité opérationnelle et CI durcie

Mission : `docs/mission/mission-PALLAS-M20-observabilite-ci.md`
Statut : CLOTURÉE (2026-09-11)
Date d'exécution : 2026-09-11
Agent : opencode (big-pickle) — session PALLAS M17→M20

---

## 1. Ce qui a été fait

### 1.1 Actions CI épinglées par SHA (critère de succès 1)

`.github/workflows/ci.yml` : les trois actions passent des tags majeurs aux SHA immuables de
leurs releases respectives, à chaque usage (build + lint, test, coverage, audit) :

| Action | Avant | Après |
| --- | --- | --- |
| `actions/checkout` | `@v4` | `@11d5960a326750d5838078e36cf38b85af677262` (v4.4.0) |
| `determinatesystems/nix-installer-action` | `@v23` | `@3138316df39ed29be04236d7ffc686fa525866aa` (v23) |
| `luiscachogithub/magic-nix-cache-action` | `@v15` | `@84c0677f58dcedf3b91f8223ce36a9ea5b3c84b7` (v15) |

Vérifié : `rg "@v" .github/workflows/ci.yml` → aucun reliquat ; chaque SHA repris à l'identique
pour les deux occurrences (checkout pairable build + coverage ; nix x2).

### 1.2 Couverture avec seuils en CI (critère de succès 6) + `npm run coverage`

- `@vitest/coverage-v8@^3.2.7` ajouté en devDependency (aligné sur vitest 3.x utilisé).
- `package.json` : script `"coverage": "vitest run --coverage"`.
- `vitest.config.ts` : reporters `text` + `text-summary`, `include` couvrant les 6 packages,
  `exclude` de `dist/`, `*.test.ts` et `scripts/`, et **seuils calibrés sur le baseline mesuré**
  (statements 83.76, branches 79.72, functions 91.63, lines 83.76 le 2026-09-11) →
  `statements 80 / branches 75 / functions 85 / lines 80`. Env `COVERAGE_THRESHOLD` du workflow
  supprimé (le seuil vit dans la config, une seule source de vérité).
- Job CI `coverage` ajouté (post-typescript), `npm run coverage -- --coverage.reporter=text`.

Mesure sur ce journal (269 tests) : statements 83.61 / branches 80.17 / functions 91.96 /
lines 83.61 — **au-dessus des seuils** (`COVERAGE_THRESHOLDS_OK`).

### 1.3 Skip sandbox explicite, jamais silencieux (critère de succès 5)

`packages/execution/src/sandbox.test.ts` refactorisé : `bwrapProbe()` retourne
`{ usable: boolean; reason: string }` ; quand bwrap n'est pas utilisable sur le runner, la suite
logge **une seule fois** en stdout :
`[PALLAS-M20-SANDBOX] bwrap NON utilisable sur ce runner — raison: ...` puis `it.skip` par bloc —
un skip en CI est donc visible dans la sortie, avec la raison, conforme à l'interdiction de skip
silencieux.

### 1.4 Logs structurés + alerting minimal (critère de succès 2)

Nouveau module `packages/core/src/observability.ts` (sans dépendance, zero-dep leaf) :

- `structuredEvent(level, event, subject, anomaly?, context?)` → un line JSON auto-décrit
  (`ts`, `level`, `anomaly`, `event`, `subject`, `context`), ingérable par n'importe quel parser
  JSONL (choix documenté : JSONL simple plutôt qu'une stack Prometheus/Grafana — proportionnel au
  stade, exigence §9.1).
- `emitAnomaly(anomaly, subject, context?, overrides?)` : CRITICAL forcé, écrit SANS throw dans
  `.pallas/alerts.jsonl` (env `PALLAS_ALERT_FILE`), POST webhook fire-and-forget optionnel
  (`PALLAS_ALERT_WEBHOOK`, timeout 5 s), **dédupliqué en mémoire** (une anomalie active n'est pas
  re-émise tant qu'elle n'est pas re-déclenchée après `resetAnomalyAlertsForTest`).
- `resetAnomalyAlertsForTest()` (tests), `resolveAlertSink()` (config).
- Anomalies couvertes, alignées sur AUDIT v0.3 F-10 §8 :
  `AMBIGUOUS_ORDER`, `RECONCILE_FAILED`, `STATE_CORRUPT`, `LEDGER_CORRUPT`, `KILL_SWITCH`.

**Câblage dans l'orchestrateur** `packages/strategy/src/run-reference-loop.ts` :

- branche `AmbiguousOrderError` (résultat inconnu après contact réseau, M14) → `AMBIGUOUS_ORDER`
  avec `correlation_id` ;
- catch `reconcileScopeForMarket` → `RECONCILE_FAILED` avec `market_id` ;
- catch `reconcileOrder` après ambiguïté → `RECONCILE_FAILED` avec `correlation_id` ;
- au chargement : `FileLedger.load` encapsulé → `LEDGER_CORRUPT` AVANT le fail-stop (M16) ;
  `DurableStateStore` encapsulé → `STATE_CORRUPT` (M13) ;
- `enforceKillSwitch` (`record.engaged === true`) → `KILL_SWITCH` (engagement + cancel-all).

Tests `packages/core/src/observability.test.ts` (6) : shape du line JSONL, écriture CRITICAL sur
fichier, dédup (2e émission non-écrite), reset inter-tests, POST webhook fire-and-forget
(Argument de fetch stub qui répond) et non-re-post quand aucune requête, fichier absent créé.

### 1.5 Endpoint `status` reflétant l état réel (critère de succès 3)

- `packages/observatory/src/types.ts` : champ `alerts` ajouté à `ObservatorySnapshot` (ts,
  anomaly, event, subject).
- `packages/observatory/src/snapshot.ts` : `readAlerts(path, limit=20)` — lit le JSONL partagé
  en **lecture seule**, ignore les lignes malformées (concurrent), ne casse jamais le snapshot ;
  exposé dans `buildSnapshot` (`alertPath` option, défaut `.pallas/alerts.jsonl`).
- `packages/observatory/src/server.ts` : nouvelle route GET `/api/status` (read-only, jamais de
  mutation — le routeur rejette POST/PUT/PATCH/DELETE) retournant : `mode` dry-run,
  `dryRun.status` (ENABLED/DISABLED), `killSwitch.engaged`, `ledger.{status,signed,entries}`,
  `loop.{status,ageSeconds}`, `cycle`, `orders.{total,live,reconciling,liveExposureUsd}`
  (post-M14/M15), `market.{status,tokenId,bids,ageMs}` (âges), `alerts`, `warnings`, et un flag
  `critical` agrégé (alerte présente / `CORRUPT` / `LEDGER INVALID` / réconciliation / kill
  switch).
- Frontière observatory préservée : `server.ts`, `snapshot.ts`, `render.ts`, `page.ts`
  n'importent PAS `@pallas/core` (test existant `does not import execution, risk, strategy, or
  credential-bearing packages` étendu — les alertes passent par le fichier partagé, pas par un
  import).
- Dashboard : nouveau pavé `ALERTS` (badge rouge si alertes, liste `anomaly`+`subject`).
- Tests observatory (5 nouveaux) : `readAlerts` (malformé ignoré, ordre récent→ancien, fichier
  absent → []), snapshot→dashboard `ALERTS`, `/api/status` nominal (critical=false), incident
  kil-switch (critical=true), falsification d'état v2 (warning `RISK STATE CORRUPT` + critical).

### 1.6 RTO / RPO documentés (critère de succès 4)

`docs/SECURITY.md` § « Objectifs RTO / RPO (PALLAS-M20) » : RTO ≤ 15 min (redémarrage depuis
l'état durable checksummé), RPO ≤ 1 cycle ≈ 1 min (transitions durables avant émission), fenêtre
d'ambiguïté ≤ 1 cycle après contact réseau. Objectifs **cibles**, explicitement non garantis par
un contrat de service (pas de réplication ni de sauvegarde distante automatisée) — honnête
plutôt qu'ambitieux et faux. Tableau des « garanties » complété (SHA + job coverage + alertes +
RTO/RPO).

## 2. Preuves d exécution

### 2.1 Smoke test HTTP réel /api/status (incident simulé)

Fixtures d'incident écrites dans `/tmp/opencode/m20-observer` (v2 état avec
`kill_switch_engaged: true`, `.pallas/alerts.jsonl` contenant `AMBIGUOUS_ORDER` +
`KILL_SWITCH`), serveur réel lancé sur `127.0.0.1:4197` :

```
Pallas Observatory (READ-ONLY / DRY RUN) http://127.0.0.1:4197
$ curl -s http://127.0.0.1:4197/api/status
alerts= [{ts: '2026-09-11T21:06:00Z', anomaly: 'KILL_SWITCH', ...},
         {ts: '2026-09-11T21:05:00Z', anomaly: 'AMBIGUOUS_ORDER', ...}]
critical= True
warnings= ['KILL SWITCH ENGAGED (no emission, cancel-all fired)', ...]
killSwitch.engaged= true · dryRun.status= ENABLED
```

Le corruption d'état volontaire est couverte par le test `/api/status: un état durable CORRUPT
(checksum)…` (warnings `RISK STATE CORRUPT`, critical=true) — une alerte **observable**, pas une
ligne de log noyée.

### 2.2 Bilan tests & couverture

```
npm run build                                   # tsc --build 6 packages : OK
npm test                                        # 22 fichiers, 269 tests passed
npm run coverage                                # statements 83.61 / branches 80.17 /
                                                # functions 91.96 / lines 83.61 — seuils OK
```

Les suites précédentes sont intactes (269 = 258 précédents + 6 observability core + 5 observatory
status/alerts).

### 2.3 Épinglage SHA vérifié

`rg "@v" .github/workflows/ci.yml` → aucune occurrence (toutes remplacées par SHA).

## 3. Ce qui n a pas été fait / limites assumées

- **Vérification duck real CI GitHub Actions** : pas de push rendu possible ici (repo local ;
  exigence §9.2 « vérifier réellement sur GitHub Actions » à satisfaire au prochain push suivi
  d'un run CI). Le SHA épinglé est vérifié statiquement ; le skip sandbox est prouvé par
  `bwrapProbe` + log explicite. Les tests couvrent le comportement hors runner.
- **Pas de sauvegarde distante** : RPO documenté = dernier payload durable, pas une copie hors
  disque — assumé et écrit.
- **Alerting sans canal de notification obligatoire** : JSONL + webhook optionnel ; surveillance
  manuelle acceptable au stade (documenté).

## 4. Références

- Module : `packages/core/src/observability.ts` (+ test) ; export public `packages/core/src/index.ts`
- Relay : `packages/strategy/src/run-reference-loop.ts` (5 points d'ancrage)
- Surface : `packages/observatory/src/{types,snapshot,server,render}.ts` (+ tests)
- CI : `.github/workflows/ci.yml` ; `vitest.config.ts` ; `package.json`
- Docs : `docs/SECURITY.md` (§ garanties + RTO/RPO)