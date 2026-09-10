# JOURNAL — PALLAS-M06 — CI/CD + documentation sobre

Statut : **CLÔTURÉE** le 2026-09-09
Agent d'exécution : opencode / big-pickle
Référentiel : `AUDIT-PALLAS-v0.1.md` (sections « Cases [ ] », « Dépendances ») + `PLAN.md` Phase 5

## 1. Partie A — état des missions avant de figer des seuils CI

Clôtures vérifiées (24 items `Statut : CLÔTURÉE`) : M01 (risk engine), M02 (signature EIP-712),
M03 (sandbox bwrap), M04 (frontières TS/HTTP), M05 (credentials & mémoire). **Aucun point ouvert**
ne risque d'être figé comme « normal » par la CI : les tests sandbox ne comptent plus de faux
positif (PREUVE réseau), le risk engine rejette les entrées hors contrat (Zod).

## 2. Partie B — pipeline exécuté localement, à l'identique du workflow

Sur un environnement propre (`npm ci` depuis `package-lock.json`, Node v22.23.2, npm 12.0.2) :

| Étape | Résultat |
|---|---|
| `npm ci` | ✔ (warning esbuild postinstall bloqué par allowScripts — sans impact : vitest transforme sans esbuild natif) |
| `npm run build` (`tsc --build`) | ✔ |
| `npm run typecheck` | ✔ |
| `npm test` | ✔ **99/99** (9 fichiers) |
| `npm audit --audit-level=high` | ✔ exit 0 (2 modérées assument, voir §3) |
| `cargo test` (crates/risk-engine, dev shell) | ✔ **50/50** (35 lib + 12 proptest + 3 integration) |
| `cargo audit` | ✔ 0 vulnérabilité / **48 dépendances** (advisory-db RustSec chargé) |

### Décision d'architecture CI (documentée) : pas de nix dans GH Actions

`crates/risk-engine/Cargo.toml` est **100% Rust pur** (serde, serde_json, proptest — aucune
dépendance C, pas de libc direct). Le linker `cc` requis localement vient du `shell.nix`, mais le
runner `ubuntu-latest` fournit `build-essential` → `dtolnay/rust-toolchain@stable` suffit. C'est
plus simple et plus reproductible que nix dans un runner ; le dev shell reste documenté pour le
développement local.

## 3. Décision sur `npm audit` et les 2 vulnérabilités modérées (explicitement motivée)

`npm audit` (sans filtre) : **2 moderate** — `@vitest/mocker` 2.1.0-4.1.10, `GHSA-82fw-gwwq-j7x9`
(path traversal / arbitrary file read via redirect mock), au travers de `vitest` (devDependency).

**Seuil retenu : `--audit-level=high`**, justifié ainsi :
1. **Attaque/victime** : l'advisory concerne le mécanisme de mock HTTP de vitest — un outil de
   **test**, jamais chargé en runtime de production (aucun package `@pallas/*` ne l'importe).
2. **Exploitabilité en CI** : notre suite ne simule AUCUN mock URL ouvert à attaquant (ancien
   test réseau `server.listen(0)` du host remplacé par M03, et les mocks vitest n'ouvrent rien) —
   le chemin est non exploitable à la fois hors prod et hors CI.
3. **Remédiation** : `npm audit fix --force` imposerait **Vitest 5.0.0** (breaking change, semver
   majeure) avec risque de casser la mécanique de test multi-packages. **Acceptation documentée**
   + piste future (upgrade Vitest 5 évaluée quand le prochain besoin de test l'exigera). Le seuil
   est inscrit en commentaire dans `ci.yml` — pas un choix silencieux.

## 4. Preuve que la CI n'est pas cosmétique (critère 1)

Test d'échec volontaire : un test `expect(1 + 1).toBe(3)` ajouté dans
`polymarketSigner.test.ts` → `npm test` **exit 1** (× CI-M06 affiché). Revert → `npm test`
**exit 0**. La même commande étant le cœur du job TS, un bug volontaire ou réel fait tomber le
pipeline. Le YAML a été validé (js-yaml) et `actions/checkout@v4`,
`actions/setup-node@v4` (Node 22, cache npm), `dtolnay/rust-toolchain@stable`, et
`actions-rust-lang/audit@v2` (working-directory `crates/risk-engine`) sont les actions standards.

## 5. Documentation sobre — alignée sur l'état réel

- **`README.md`** (nouveau) : statut réel « MVP, en préparation de dry-run », **polymarket
  uniquement**, dry-run par défaut, liste explicite des modules non commencés, lien vers
  `AUDIT-PALLAS-v0.1.md`. Aucun badge.
- **`docs/ARCHITECTURE.md`** (nouveau) : schéma repris de `PLAN.md` (gateway/agent vides marqués
  « VIDE — non commencé »), monorepo avec état par module, flux de décision réellement câblé
  (invoke + CLOB + schémas), conventions (dev shell, pretest).
- **`docs/SECURITY.md`** : ajout « Signalement de vulnérabilité », tableau des 7 protections vs
  missions, réserves non closes explicitement listées (retry placeOrder / AmbiguousOrderError,
  `isDryRun` injectable réservé tests, modules absents, seuil audit). Complète M03/M05.
- **`docs/TRADING.md`** (nouveau) : scope MVP + dry-run, le cas **timeout `placeOrder` →
  `AmbiguousOrderError`** et la procédure de réconciliation (statut d'ordre avant réémission —
  endpoint non exposé, monté en suivi), `cancelOrder` DELETE idempotent.
- **`PLAN.md`** : Phase 5 complétée (`[x]` ×3), tableau des missions M05/M06 → ✅, monorepo
  `ci.yml` ✔, estimation Phase 5 clôturée.
- `docs/` versionné (déjà le cas) ; `AGENTS`/meta non touchés.

## 6. Critères de succès vs mission

- [x] CI GH Actions écrite pour un checkout propre ; échec sur bug volontaire prouvé localement
      à l'identique des étapes du job TS (exécution à venir sur le premier push — runner public).
- [x] `npm audit` (seuil `high` justifié §3) **et** `cargo audit` (0/48) exécutés en CI.
- [x] `README.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/TRADING.md` suivis dans git,
      sobres, et renvoyant explicitement vers `AUDIT-PALLAS-v0.1.md`.
- [x] Aucun document ne décrit gateway/agent/ledger/skills comme « en cours » : tous marqués
      « VIDE — non commencé ».
- [x] Réserves de sécurité non closes listées dans `docs/SECURITY.md` avec renvoi mission.

## 7. Livrables

- `.github/workflows/ci.yml` — 2 jobs (TypeScript : npm ci/build/typecheck/test/audit ; Rust :
  cargo test + cargo audit), `.gitkeep` remplacé.
- `README.md` (nouveau), `docs/ARCHITECTURE.md` (nouveau), `docs/TRADING.md` (nouveau),
  `docs/SECURITY.md` (complété).
- `PLAN.md` — Phase 5 ✅, tableau missions ✅, monorepo, estimation.

## Reporter (post-M06)

- Upgrade Vitest 5 (à décider quand un besoin le justifie). Endpoint `GET /orders` (statut d'ordre)
  pour automatiser la réconciliation `AmbiguousOrderError` dans `docs/TRADING.md`.