# PALLAS-M21 — Journal de mission — Suite de tests réellement verte + traçabilité des audits

Mission : `docs/mission/mission-PALLAS-M21-housekeeping-ci.md`
Statut : CLOTURÉE (2026-09-12)
Date d'exécution : 2026-09-12
Agent : DeepSeek Harness (deepseek-flash) — branche `missions-M21-M28`
Commit de code vérifié : `7259c87c0e6871a3b997e44ed93306c7393dc5d7`

---

## 0. Résumé

**La suite monorepo est verte sur un checkout propre** : 5 exécutions consécutives de `npm test`
donnent **22 fichiers, 269 passed / 0 failed, 0 skip** sur ce poste, et
`cargo test --all-targets` donne **65 passed / 0 failed**. Le préalable bloquant aux missions
M22–M28 est levé.

Le diagnostic de l'audit v0.4 §3 (`Unexpected end of JSON input` sur les probes M13/M16)
**n'est pas reproduit** sur ce poste ; le mode d'échec réel, lui, est un **timeout de harnais
(5 s) inférieur au budget d'attente du verrou lui-même (10 s)**. Les deux défauts — l'intermittence
et l'erreur opaque — sont traités en §1.

## 1. Ce qui a été fait

### 1.1 Reproduction de la baseline sur checkout propre

Protocole : worktree git **détaché**, `npm ci` depuis le `package-lock.json`, puis
`cargo build` du risk-engine (binaire exigé par `packages/risk/src/client.test.ts`), exactement
comme le job `typescript` de `.github/workflows/ci.yml`.

Constat préalable, sans ambiguïté : **sans `cargo build`, `npm test` échoue 13 fois** dans
`packages/risk/src/client.test.ts` (toutes les assertions qui invoquent le binaire), parce que
`crates/risk-engine/target/` est ignoré par git (`target/`). Ce n'est pas une régression : c'est
une **précondition de la CI**, désormais explicite dans le protocole de vérification.

Binaire présent, la baseline mesurée sur ce poste est **269/269** — les 2 échecs de l'audit ne se
reproduisent pas tels quels.

### 1.2 Cause racine diagnostiquée : budget du harnais < budget du composant

Les probes M13/M16 lancent jusqu'à **4 processus OS** qui enchaînent des cycles
`read-modify-write` durables sous verrou interprocessus (`FileLock`), chaque écriture faisant
`fsync` du fichier **et** `fsync` du répertoire (`atomicWriteFileSafe`). Sur ce poste
(ext4 chiffré LUKS), la durée mesurée du scénario 4 processus × 3 itérations est, sur 40 mesures :

| Probe | min | p50 | p90 | p95 | max | > 5000 ms |
| --- | --- | --- | --- | --- | --- | --- |
| M13 (état durable) | 561 ms | 1 526 ms | 3 236 ms | **4 799 ms** | **8 066 ms** | **1/40** |
| M16 (ledger) | 375 ms | 877 ms | 1 969 ms | 2 675 ms | 2 825 ms | 0/40 |

Or `FileLock.timeoutMs` = **10 000 ms** et le délai par défaut de Vitest = **5 000 ms** : le
harnais tue le test **avant** que la couche verrou ne puisse conclure, avec un message
« Test timed out in 5000ms » sans rapport avec la logique testée.

Caractérisation (30 exécutions ciblées sur le checkout propre) : **8 échecs, 100 % des
timeouts**, **0 occurrence** de `Unexpected end of JSON input`. Les probes directes, elles,
produisent **40/40** sorties stdout non vides : l'hypothèse « capture stdout tronquée par le
harnais » n'est pas confirmée sur ce poste.

Le message de l'audit révèle néanmoins un **défaut latent** dans la lecture du résultat :
`JSON.parse(stdout.trim().split('\n').pop() ?? '{}')`. Le `?? '{}'` **ne rattrape pas la chaîne
vide** (`split` renvoie toujours au moins un élément), donc toute sortie vide deviendrait un
`SyntaxError: Unexpected end of JSON input` sans indication de processus, de flux ni de moment.

### 1.3 Correctif (portée inchangée)

`packages/strategy/src/concurrency-probe.test.ts` et `packages/ledger/src/ledger-concurrency.test.ts` :

1. **Helper `probeResult()`** remplaçant le `JSON.parse(... ?? '{}')` : il refuse explicitement
   une sortie vide ou non-JSON et échoue en **nommant la probe** et en exposant `stdout`/`stderr`
   (quel process, quel flux, quel moment). Vérifié sur 5 cas — nominal, vide, blanc, tronqué,
   multi-lignes : les trois cas dégradés produisent un diagnostic actionnable, jamais un
   `SyntaxError` nu.
2. **Budget de test explicite `PROBE_TIMEOUT_MS = 30 000`**, aligné **au-dessus** du budget du
   composant testé (verrou 10 s + marge d'écriture). Ce n'est pas un contournement : c'est la
   correction d'une **incohérence de contrat** (le harnais ne peut pas être plus court que le
   composant qu'il mesure). **Aucun retry, aucun skip, aucun `--bail`** ; le nombre de processus
   et d'itérations est **inchangé** (interdiction §8 respectée).

### 1.4 Vérification nommée des 4 skips

Les 4 tests conditionnels sont les `test.runIf(realBwrap)` de
`packages/execution/src/sandbox.test.ts` :

| # | Ligne | Test | Justification |
| --- | --- | --- | --- |
| 1 | 68 | `execute un binaire autorise sous bwrap` | PALLAS-M07 (sandbox d'isolation réseau) |
| 2 | 75 | `reseau isole : un service du HOST est invisible depuis le sandbox` | PALLAS-M07 / M20 |
| 3 | 135 | `resolveBinary durei : un binaire non executable dans PATH est rejete` | PALLAS-M07 |
| 4 | 151 | `input passe a stdin` | PALLAS-M07 |

Ils sont gouvernés par la sonde `bwrapProbe()` et, en cas d'indisponibilité de bwrap, PALLAS-M20
logue la raison une seule fois (`[PALLAS-M20-SANDBOX] ...`) avant `runIf(false)` : **jamais de
skip silencieux**. Sur ce poste, `bwrap` 0.11.2 est utilisable : les 4 tests **tournent et
passent** (d'où 269 passed / 0 skipped). Sur un runner où bwrap est indisponible, ce sont bien
ces 4 tests qui se skippent avec la raison — conforme à l'attendu de la fiche.

### 1.5 Décision explicite : traçabilité des rapports d'audit

Décision retenue : **versionner** la chaîne d'audits (recommandation de la fiche). La règle
`docs/AUDIT-PALLAS*.md` est retirée de `.gitignore` et les rapports `v0.2`, `v0.2.1`, `v0.3`,
`v0.4` sont désormais suivis.

Motif factuel : l'état antérieur était **incohérent** — `docs/AUDIT-PALLAS-v0.1.md` était déjà
suivi (ajouté avant la règle d'exclusion) alors que les quatre suivants étaient ignorés. La
finalisation s'appuyant sur une chaîne d'audits comparés (v0.2.1 → v0.3 → v0.4), leur contenu doit
être reconstructible sans la copie locale de l'auditeur. La décision est documentée dans
`.gitignore` **et** dans `docs/SECURITY.md` (§ « Chaîne d'audits — traçabilité (PALLAS-M21) »).
`.pallas/` (état/ledger local) reste seul hors git.

## 2. Preuves d'exécution

### 2.1 Probes M13/M16 : avant / après le correctif

```
AVANT (30 runs ciblés, checkout propre) : 22 pass / 8 fail  → 8 × "Test timed out in 5000ms"
APRÈS (30 runs ciblés, même protocole) : 30 pass / 0 fail
```

### 2.2 Cinq `npm test` consécutifs sur checkout propre (commit `7259c87`)

Worktree détaché créé depuis le commit, `npm ci`, `cargo build`, puis 5 exécutions :

```
run 1 EXIT=0   Test Files 22 passed (22)   Tests 269 passed (269)   marqueurs_echec=0
run 2 EXIT=0   Test Files 22 passed (22)   Tests 269 passed (269)   marqueurs_echec=0
run 3 EXIT=0   Test Files 22 passed (22)   Tests 269 passed (269)   marqueurs_echec=0
run 4 EXIT=0   Test Files 22 passed (22)   Tests 269 passed (269)   marqueurs_echec=0
run 5 EXIT=0   Test Files 22 passed (22)   Tests 269 passed (269)   marqueurs_echec=0
```

(`marqueurs_echec` = occurrences de `Unexpected end of JSON`, `timed out` ou `FAIL` dans le log.)

### 2.3 Rust — pas de régression

```
cargo test --all-targets   →  47 + 15 + 3 = 65 passed ; 0 failed
```

## 3. Ce qui n'a pas été fait / limites assumées

- **`Unexpected end of JSON input` non reproduit** (0/30 runs ; hypothèse stdout tronquée non
  confirmée). Le défaut latent de lecture est corrigé et instrumenté : si l'anomalie survient sur
  un autre poste, elle produira désormais un message nommant la probe et son `stderr`, au lieu du
  `SyntaxError` opaque. Non tranché : le fait que l'audit l'ait observé reste une donnée externe
  non reproductible ici.
- **`cargo build` est une précondition implicite de `npm test`** (binaire risk-engine). La CI
  l'exécute ; le protocole de la fiche (« checkout propre ») a été interprété comme « checkout +
  préconditions CI ». Un `npm test` sur un checkout *sans* binaire échoue légitimement sur
  `client.test.ts` — signalé ici pour mémoire, hors périmètre du correctif.
- **Le flake est réduit, pas supprimé par construction** : la latence `fsync` est une propriété
  du disque. Le budget de 30 s (vs p95 ≈ 4,8 s, max ≈ 8,1 s) donne une marge ~4× ; les probes
  directes 40/40 et les 35 runs verts (30 ciblés + 5 complets) soutiennent l'absence
  d'intermittence, sans preuve formelle de borne.
- **Lock sans heartbeat** (limite M13 connue, reprise par l'audit v0.4 §4.1) : `staleMs` repose
  sur l'`mtime` du répertoire de verrou. Hors périmètre M21 ; à traiter par M23.

## 4. Références

- Mission : `docs/mission/mission-PALLAS-M21-housekeeping-ci.md`
- Tests corrigés : `packages/strategy/src/concurrency-probe.test.ts`,
  `packages/ledger/src/ledger-concurrency.test.ts`
- Verrou / écriture : `packages/core/src/file-lock.ts`, `packages/core/src/atomicfs.ts`
- Probes : `scripts/durable-state-concurrency-probe.mjs`, `scripts/ledger-concurrency-probe.mjs`
- Skips : `packages/execution/src/sandbox.test.ts` (M07 / M20)
- Décision audits : `.gitignore`, `docs/SECURITY.md`, `docs/AUDIT-PALLAS-v0.2*.md`,
  `docs/AUDIT-PALLAS-v0.3.md`, `docs/AUDIT-PALLAS-v0.4.md`
- CI : `.github/workflows/ci.yml` (job `typescript`)
