# Rapport de revue externe Jules — PALLAS-M36 (relance)

## Étape 0 — Vérification de ref préalable (Obligatoire)

Commandes exécutées :
```bash
git checkout pallas-mvp-freeze-1
git rev-parse HEAD
```

Sortie exacte :
```
e69d7542f79ff3e6a24df60773147a6a2f400986
```

**Confirmation de ref** : Le SHA correspond exactement à `e69d7542f79ff3e6a24df60773147a6a2f400986` (tag `pallas-mvp-freeze-1`). Ce rapport est produit exclusivement à partir du contenu checkouté à ce commit.

---

## Note de préambule : Invalidation de la tentative 1

La tentative précédente (`docs/mission/archives/mission-PALLAS-M36-jules-review-1.md` ou document initial) est **invalidée en totalité**. Elle a été exécutée par erreur sur le commit `22e2c53075ba8e3bb6a89c59db773f5521360087` de la branche `main` sans avoir effectué le checkout du tag `pallas-mvp-freeze-1`. Aucune observation ni conclusion de cette tentative 1 n'a été conservée ou réutilisée comme source pour la rédaction du présent rapport.

---

## 1. Lisibilité

**Sources analysées** : `README.md`, `docs/mvp/README.md`.

### Ce que le projet fait et ne fait pas
Le fichier `README.md` définit d'emblée l'objet du projet :
- **Pallas** est un bot de trading pour les marchés de prédiction **Polymarket uniquement**, fonctionnant en **dry-run par défaut**.
- Le statut actuel est un **MVP en préparation de dry-run**.
- Le `README.md` (section *Non commencé (honnêteté)*) précise clairement ce qui n'est **pas** fait : les modules de la Phase 3 (gateway Fastify, agent, ledger de trades, skills) ne sont ni développés ni prétendus en cours.

### Ce qui aide à la compréhension
1. **Périmètre explicite** : L'avertissement « Polymarket uniquement » et « dry-run par défaut » fixe immédiatement le cadre de sécurité et d'utilisation.
2. **Honnêteté sur l'état de maturité** : La distinction nette entre le risk-engine Rust (`crates/risk-engine`), l'exécution CLOB (`packages/execution`) et les parties non commencées évite toute fausse attente.
3. **Point d'entrée MVP dédié** : `docs/mvp/README.md` fournit une table des matières vers la baseline M31 (`architecture.md`, `security-guarantees.md`, `known-limitations.md`, `operations.md`, `BASELINE-FREEZE.md`).

### Ce qui manque ou prête à confusion
1. **Dépendance forte à Nix assumée** : Le `README.md` indique `nix-shell` comme commande de démarrage principale. Sur un hôte standard sans Nix, l'utilisateur doit deviner l'enchaînement des commandes Node.js et Cargo.
2. **Avertissement de statut dans `docs/mvp/README.md`** : Le document indique « Brouillon de baseline... Les sections marquées 'À compléter' sont volontairement laissées en brouillon ». Cela crée un doute sur le niveau de finalisation de la documentation MVP.

---

## 2. Compréhension architecturale

**Sources analysées** : `docs/ARCHITECTURE.md`, `docs/mvp/architecture.md`, `package.json`, `packages/`, `crates/risk-engine/`.

### Structure et composants
L'architecture est découpée en monorepo TypeScript (`packages/`) couplé à un moteur de risque natif en Rust (`crates/risk-engine/`) :

1. **`crates/risk-engine`** (Rust) : Calculateur de risque déterministe (VaR/CVaR, circuit breaker multi-scope, régime Kelly, validation de trade en 10 étapes). Accessible via CLI binaire JSON.
2. **`packages/core`** : Configuration centralisée (`config.ts`), désactivation du dry-run contrôlée (`dry-run.ts`), chiffrement AES-256-GCM (`credentials.ts`), assainissement des entrées (`sanitizer.ts`).
3. **`packages/execution`** : Client HTTP CLOB Polymarket (`polymarketClob.ts`), signatures EIP-712 V2 (`polymarketEip712.ts`), sandbox `bwrap` (`sandbox.ts`), garde des secrets (`secretsGuard.ts`).
4. **`packages/ledger`** : Ledger append-only chaîné par hash SHA-256 (`ledger.ts`) et ancré par signature Ed25519 (`ledger-signing.ts`).
5. **`packages/risk`** : Adaptateur TypeScript (`client.ts`) appelant le binaire Rust `risk-engine` par sous-processus stdio.
6. **`packages/strategy`** : Stratégie de référence (`reference.ts`), boucle d'évaluation (`run-reference-loop.ts`).
7. **`packages/observatory`** : Surface de diagnostic read-only locale (`server.ts`, `dashboard.ts`).

### Flux de données et frontières de confiance
- **Frontière TS ↔ Rust** : Définie dans `packages/risk/src/client.ts`. Les entrées/sorties JSON sont strictement validées par des schémas Zod.
- **Frontière Read-Only de l'Observatory** : Spécifiée dans `docs/OBSERVATORY.md` et implémentée dans `packages/observatory/src/server.ts`. Ne dépend ni de `@pallas/execution` ni de `@pallas/risk`. Expose uniquement `GET /` et `GET /api/snapshot`.
- **Isolation d'exécution** : `packages/execution/src/sandbox.ts` isole les sous-processus shell via `bwrap` (bubblewrap) sans réseau.

### Évaluation
L'architecture est claire, hautement modulaire, et les frontières de responsabilité entre composants sont bien isolées. Un développeur ou évaluateur peut comprendre le fonctionnement global sans devoir lire l'intégralité du code source.

---

## 3. UI (Pallas Observatory)

**Sources analysées** : `docs/OBSERVATORY.md`, `scripts/observatory-demo.mjs`, `packages/observatory/src/server.ts`.

### Déclaration d'exécution réelle
L'interface **Pallas Observatory** a été **réellement exécutée et testée** durant cette revue.

### Lancement et observations expérimentales
1. **Commande lancée** :
   ```bash
   npm run observatory:demo
   ```
2. **Résultat du premier essai (SANS variable d'environnement)** :
   ```
   Recherche automatique d’un marché Polymarket actif…
   Marché sélectionné : Will there be no change in Fed interest rates after the September 2026 meeting?
   Best ask actuel    : 0.12
   Outcome            : Yes
   Token              : 561528276087…2205273721
   Pallas Observatory (READ-ONLY / DRY RUN) http://127.0.0.1:4173
   Ouvrir : http://127.0.0.1:4173
   Reference loop terminée (code 1). Observatory reste disponible; Ctrl-C pour quitter.
   run-reference-loop: FATAL: intégrité du ledger invalide (mode supervised: aucune cle publique de ledger configuree (publicKeyPem) — le ledger signe est OBLIGATOIRE hors developpement. Fournir la cle publique, ou poser PALLAS_LEDGER_MODE=dev pour un usage local explicitement non reel.) — démarrage refusé.
   ```
   **Observation critique** : La commande `npm run observatory:demo` décrite dans `docs/OBSERVATORY.md` échoue au démarrage de la boucle si `PALLAS_LEDGER_MODE=dev` n'est pas explicitement fourni, car le mode par défaut est `supervised` qui exige une clé Ed25519.

3. **Résultat du second essai (AVEC `PALLAS_LEDGER_MODE=dev`)** :
   Commande : `PALLAS_LEDGER_MODE=dev npm run observatory:demo`
   Sortie :
   ```
   Marché sélectionné : Will there be no change in Fed interest rates after the September 2026 meeting?
   Best ask actuel    : 0.12
   Pallas Observatory (READ-ONLY / DRY RUN) http://127.0.0.1:4173
   {"event":"run_start","cycles":100,...}
   {"cycle":1,"signal":{"tokenId":"561528276087...","side":"BUY","price":0.12...},"allowed":false,"rejected_by":["KELLY_LIMIT"]...}
   ```
   Le serveur démarre correctement sur `http://127.0.0.1:4173`.

4. **Interrogation HTTP (`curl http://127.0.0.1:4173/api/snapshot`)** :
   Sortie brute partielle :
   ```json
   {"generatedAt":"2026-09-16T03:19:07.853Z","html":"<div class=\"warnings\"><span class=\"badge badge-warning\">LEDGER UNSIGNED (signature PALLAS-M16 non active)</span><span class=\"badge badge-warning\">RISK STATE UNAVAILABLE</span><span class=\"badge badge-warning\">MARKET DATA UNKNOWN</span></div>\n  <section class=\"panel system\"><header><h2>SYSTEM</h2><span class=\"badge badge-dry-run\">DRY RUN</span></header>..."}
   ```

### Évaluation de la documentation UI
La documentation `docs/OBSERVATORY.md` explique bien le rôle passif de l'interface et ses garanties de sécurité. Cependant, elle omet d'indiquer que `PALLAS_LEDGER_MODE=dev` est obligatoire lors de l'exécution hors environnement de production / sans clé Ed25519 configurée.

---

## 4. Exécutabilité

Toutes les commandes documentées ont été exécutées. Voici les commandes exactes et leur sortie brute intégrale.

### A. Environnement Nix (`nix-shell`)
Commande :
```bash
nix-shell
```
Sortie brute :
```
bash: nix-shell: command not found
```
*Note : Sur une machine Linux standard sans Nix, `nix-shell` n'est pas disponible.*

### B. Installation des dépendances Node.js (`npm ci`)
Commande :
```bash
npm ci
```
Sortie brute :
```
added 131 packages, and audited 138 packages in 5s

34 packages are looking for funding
  run `npm fund` for details

3 moderate severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
 npm warn deprecated glob@10.5.0: Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be purchased (at exorbitant rates) by contacting i@izs.me
```

### C. Exécution directe des tests TypeScript (`npm test`) sans build Rust préalable
Commande :
```bash
npm test
```
Sortie brute (extrait des échecs) :
```
 ❯ packages/risk/src/client.test.ts:41:13
 FAIL  packages/risk/src/client.test.ts > validateTrade allows a valid trade
MissingBinaryError: risk-engine binary not found at: /app/crates/risk-engine/target/release/risk-engine. Build it with: nix-shell --run "cd crates/risk-engine && cargo build --release"

 Test Files  1 failed | 25 passed (26)
      Tests  13 failed | 291 passed | 4 skipped (308)
```
**Observation majeure** : `README.md` indique de lancer `npm test` immédiatement après `npm ci`. Cela provoque **13 échecs de test** dans `packages/risk/src/client.test.ts` car le binaire Rust `risk-engine` n'a pas encore été compilé dans `crates/risk-engine/target/release/risk-engine`.

### D. Compilation du binaire Rust (`cargo build --release`)
Commande :
```bash
cargo build --release --manifest-path crates/risk-engine/Cargo.toml
```
Sortie brute :
```
     Updating crates.io index
 Downloading crates ...
  Downloaded itoa v1.0.18
  Downloaded zmij v1.0.23
  Downloaded quote v1.0.47
  Downloaded unicode-ident v1.0.24
  Downloaded serde v1.0.229
  Downloaded proc-macro2 v1.0.107
  Downloaded serde_derive v1.0.229
  Downloaded serde_json v1.0.151
  Downloaded serde_core v1.0.229
  Downloaded memchr v2.8.3
  Downloaded syn v3.0.5
   Compiling proc-macro2 v1.0.107
   Compiling unicode-ident v1.0.24
   Compiling quote v1.0.47
   Compiling serde_core v1.0.229
   Compiling zmij v1.0.23
   Compiling serde v1.0.229
   Compiling serde_json v1.0.151
   Compiling itoa v1.0.18
   Compiling memchr v2.8.3
   Compiling syn v3.0.5
   Compiling serde_derive v1.0.229
   Compiling risk-engine v0.1.0 (/app/crates/risk-engine)
    Finished `release` profile [optimized] target(s) in 26.32s
```

### E. Exécution des tests TypeScript (`npm test`) APRÈS build du binaire Rust
Commande :
```bash
npm test
```
Sortie brute (extrait final) :
```
 Test Files  26 passed (26)
      Tests  304 passed | 4 skipped (308)
   Start at  03:18:04
   Duration  6.31s (transform 1.47s, setup 0ms, collect 3.15s, tests 6.78s, environment 7ms, prepare 2.88s)
```
*Note : 4 tests de sandbox `bwrap` sont marqués SKIPPED car bubblewrap n'est pas disponible dans l'environnement du conteneur sans privilèges unshare, ce qui est le comportement attendu et documenté.*

### F. Tests unitaires et d'intégration Rust (`cargo test`)
Commande :
```bash
cargo test --manifest-path crates/risk-engine/Cargo.toml
```
Sortie brute (extrait final) :
```
running 47 tests
...
test result: ok. 47 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

running 15 tests
...
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s

running 3 tests
...
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
```

### G. Audit de dépendances Rust (`cargo audit`)
Commande :
```bash
cargo audit
```
Sortie brute :
```
error: no such command: `audit`

help: a command with a similar name exists: `add`
```
*Note : `cargo-audit` n'est pas préinstallé en dehors de l'environnement Nix.*

### H. Test CLI de lecture (dry-run)
Commande :
```bash
./scripts/dry-run.mjs list-markets 5
```
Sortie brute :
```
pallas-dry-run: LECTURES SEULEMENT — aucun ordre expédié, aucune clé requise.
Marches (5 affiches) :

          1.  Will Benjamin Netanyahu remain prime minister of Israel t…  fin 2021-06-30T00:00:00Z  0xb62f71aef4…
          2.  dodgers                                                     fin 2021-10-05T00:00:00Z  0x2bda19aa72…
          3.  Will it snow in New York's Central Park on New Year's Eve…  fin 2022-01-01T00:00:00Z  0x97ff49f9ad…
          4.  [Single Market] Will Ron DeSantis win the U.S. 2024 Repub…  fin 2024-09-10T00:00:00Z  0x12a0cb6017…
          5.  [Single Market] Will Donald J. Trump win the U.S. 2024 Re…  fin 2024-09-10T00:00:00Z  0x41190eb933…
 pallas-dry-run: l'API a repondu 1000 marches, affichage des 5 premiers
```

---

## 5. Rigueur perçue

**Sources analysées** : `docs/SECURITY.md`, `docs/mvp/security-guarantees.md`, `packages/core/src/dry-run.ts`, `packages/core/src/sanitizer.ts`, `packages/ledger/src/ledger-signing.ts`, `crates/risk-engine/src/pipeline.rs`.

### Éléments inspirant confiance
1. **Fail-closed par conception** :
   - Le mode `dry-run` est actif par défaut (`packages/core/src/config.ts`). Sa désactivation exige la chaîne de confirmation exacte `"LIVE"` (`packages/core/src/dry-run.ts`).
   - Le stockage des clés vérifie strictement les permissions des fichiers (`0600` requis, rejet immédiat si `0644`, cf. `packages/core/src/credentials.ts`).
   - Le ledger rejette tout maillon corrompu ou altéré (`packages/ledger/src/ledger.ts`).
2. **Couverture de tests étendue et variée** :
   - **308 tests TypeScript** couvrant le chiffrement, la concurrence inter-processus sous verrou, l'isolation sandbox, le rounding des ticks, et l'assainissement anti-prompt injection (`packages/core/src/sanitizer.test.ts`).
   - **65 tests Rust** incluant des tests de propriétés (`proptest`), des stress-tests de volatilité et le blocage des scénarios d'audit (ex: audit 2026-09-09 dans `crates/risk-engine/src/pipeline.rs`).
3. **Piste d'audit et traçabilité** :
   - Les audits passés (`docs/AUDIT-PALLAS-v0.1.md` à `AUDIT-PALLAS-v0.5.2.md`) sont tous documentés avec leurs preuves et références de commit.
   - Les tests vérifient l'authenticité des déclarations d'audit (`packages/core/src/audit-provenance.test.ts`).

### Éléments d'interrogation / Réseres
1. **Ordre de build implicite dans la suite de tests TS** : Les tests TS échouent silencieusement par `MissingBinaryError` si le binaire Rust n'est pas pré-compilé.
2. **Dépendance à Bubblewrap sur l'hôte** : Le sandbox d'exécution passe en "skip" si `bwrap` ne peut pas créer d'espace de nom utilisateur. Bien que sécurisé (fail-closed sur l'exécution réelle), cela signifie que la protection sandbox n'est pas active sur toutes les machines de dev sans Nix.

---

## 6. Autres critères pertinents

1. **Hygiène du code** :
   - Règle stricte « zéro `as any` » vérifiée dans les configurations et tests TypeScript.
   - Types Zod stricts pour toutes les entrées/sorties CLI et API.
2. **Architecture des verrous fichiers (`FileLock`)** :
   - `packages/core/src/file-lock.ts` implémente un verrouillage atomique avec détection de vivacité des processus par PID/hostname, évitant les verrous orphelins lors de crashs.

---

## 7. Liste Nécessaire et Suffisante pour un Nouvel Arrivant

### Bloquants (Empêchent la compréhension ou l'exécution sans assistance)

1. **Ordre de build non précisé dans `README.md` pour `npm test`** :
   - *Problème* : L'instruction actuelle `npm ci && npm test` échoue avec 13 erreurs `MissingBinaryError`.
   - *Correctif requis* : Ajouter l'étape de compilation Rust obligatoire dans `README.md` avant `npm test` :
     ```bash
     cargo build --release --manifest-path crates/risk-engine/Cargo.toml
     ```
2. **Variable `PALLAS_LEDGER_MODE=dev` manquante pour la démo Observatory** :
   - *Problème* : `npm run observatory:demo` crash immédiatement avec un `FATAL: intégrité du ledger invalide (mode supervised: aucune cle publique de ledger configuree)` si aucune clé Ed25519 n'est fournie.
   - *Correctif requis* : Mettre à jour `docs/OBSERVATORY.md` et `scripts/observatory-demo.mjs` pour inclure ou définir par défaut `PALLAS_LEDGER_MODE=dev` dans la commande de démo.
3. **Absence de guide de démarrage sans Nix** :
   - *Problème* : La section démarrage de `README.md` s'appuie exclusivement sur `nix-shell`.
   - *Correctif requis* : Fournir la séquence équivalente standard (Node 22, Cargo, `cargo build --release`).

### Améliorations cosmétiques (Non bloquantes, simples "+" de confort)

1. **Automation npm (`pretest`)** :
   - Ajouter la compilation automatique du binaire Rust `risk-engine` dans le hook `pretest` de `package.json` afin que `npm test` fonctionne directement après `npm ci`.
2. **Finalisation des en-têtes de documentation MVP** :
   - Mettre à jour la mention « brouillon de baseline » dans `docs/mvp/README.md` une fois l'évaluation v0.6 achevée.
3. **Instructions pour `cargo-audit`** :
   - Indiquer `cargo install cargo-audit` dans le README pour les environnements hors Nix.
