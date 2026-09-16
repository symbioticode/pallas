# Pallas

Bot de trading de marchés de prédiction pour **Polymarket uniquement** — **dry-run par défaut**,
**capital réel non autorisé** par l'état d'audit courant.

Statut réel : **MVP gelé** (baseline `pallas-mvp-freeze-1`), **audit v0.6 : GO paper trading
supervisé — NO-GO capital réel** (moyenne 3,9/5, F-11 ouverte). Une campagne de paper trading
supervisée tourne depuis le 2026-09-13. Détails : [`PROGRESSION.md`](PROGRESSION.md),
[`docs/mvp/CAPABILITIES.md`](docs/mvp/CAPABILITIES.md).

## Ce que Pallas fait

- **Risk engine** (`crates/risk-engine`, Rust) : VaR/CVaR, circuit breaker multi-scope, Kelly
  regime-aware, stress test, pipeline `validateTrade` (10 étapes), état transporté entre les
  appels CLI. La logique de risque vit en Rust (sûreté mémoire), la frontière Rust↔TS est validée
  par schémas Zod.
- **Exécution Polymarket** (`packages/execution`) : client CLOB HTTP natif, signature EIP-712 V2,
  sandbox `bwrap` pour l'exécution shell, garde des secrets et des permissions de clé.
- **Boucle de référence bout-en-bout** : marché → sanitizer → risk → exécution (bloquée par le
  dry-run) → état durable + ledger append-only chaîné et signé. Convention : **Pallas ne retente
  jamais** un résultat ambigu (`AmbiguousOrderError` → réconciliation, jamais un second POST).
- **Observatory** (interface de diagnostic) : **lecture seule**, aucune autorité sur l'exécution.

## Ce que Pallas ne fait pas (honnêteté avant tout)

- **Pas de capital réel** : l'audit v0.6 le refuse explicitement (portefeuille exchange non
  autoritatif, attribution des fills heuristique, aucun ack/fill live, custody incomplète).
- **Pas de gateway, pas d'agent LLM, pas de skills, pas de ledger de "Phase 3"** : ces composants
  de l'ancien `PLAN.md` n'existent pas et ne sont nulle part décrits comme « en cours ».
- **Pas de multi-marchés ni d'exchanges multiples** : Polymarket seulement, EOA seulement.
- **Pas de stratégie rentable démontrée** : la boucle de référence est *non prédictive*
  (`win_probability=price`, Kelly illustratif, aucun backtest ni calibration).

## Pourquoi le lire sérieusement (rigueur documentée)

Ces points proviennent d'une **[revue externe](docs/mission/archives/mission-PALLAS-M36-jules-review.md)**,
tel quel, sans introspection du projet :

- **Fail-closed par conception** : dry-run par défaut dont la désactivation exige l'exacte chaîne
  `"LIVE"` ; les fichiers de clés doivent être `0600` (un `0644` est rejeté immédiatement) ; le
  ledger rejette tout maillon corrompu ou altéré. *(rapport M36 §5.1)*
- **308 tests TypeScript et 65 tests Rust** (dont propriétés `proptest` et stress), couvrant
  chiffrement, concurrence inter-processus sous verrou, isolation sandbox, rounding des ticks,
  sanitisation anti-prompt-injection. *(rapport M36 §5.2)*
- **Verrous fichier avec détection de vivacité par PID + hostname** (`FileLock`) : pas de verrous
  orphelins après un crash. *(rapport M36 §6.2)*
- **Piste d'audit versionnée** : audits v0.1→v0.6, liés à des commits, provenance vérifiée par
  test, résultats négatifs conservés. *(rapport M36 §5.3)*

## Réserves connues (à lire, pas à cacher)

- **F-11 est ouverte** : aucune observation auditée ≥ 72 h d'une campagne continue. La plus longue
  trace à v0.6 était ~11,8 min ; la campagne en cours est la première cible 72 h.
- **Points d'interrogation de la revue M36** : l'ordre de build TS exige un binaire Rust
  pré-compilé (voir Démarrage) ; le sandbox `bwrap` est *skip* sur les hôtes sans netns (fail-closed
  sur l'exécution, mais protection inactive sur ces machines).
- Le projet est une **démo de fiabilité, pas une promesse de profit** : aucune edge, backtest ou
  modèle de frais/slippage n'existe.

Le projet descend d'un prédécesseur abandonné (CloddsBot) dont il assume le **compromis opposé** :
un seul marché, une seule boucle non prédictive, plus de preuves fail-closed. Cette concentration
ne démontre aucune supériorité — elle réduit ce qui doit être prouvé avant d'élargir. Voir
[`docs/mvp/CLODDSBOT-COMPARISON.md`](docs/mvp/CLODDSBOT-COMPARISON.md) (note secondaire).

## Démarrage

> **Ordre obligatoire : compiler le binaire Rust `risk-engine` AVANT `npm test`.**
> `npm test` fait échouer 13 tests avec `MissingBinaryError` si le binaire n'existe pas.

### A. Avec Nix (recommandé, environnement complet)

```bash
nix-shell
# dans le shell :
npm ci
nix-shell --run "cd crates/risk-engine && cargo build --release"   # OBLIGATOIRE avant npm test
npm test
npm run build
nix-shell --run "cd crates/risk-engine && cargo test"
nix-shell --run "cd crates/risk-engine && cargo clippy --all-targets --all-features -- -D warnings"
nix-shell --run "cd crates/risk-engine && cargo audit"
```

### B. Sans Nix (Node 22 + toolchain Rust + linker C)

Prérequis : **Node ≥ 22**, **Cargo/rustc (stable)**, **un compilateur C** (`cc`/`gcc`),
`cargo install cargo-audit` pour le scan RustSec (optionnel pour les tests).

```bash
npm ci
cargo build --release --manifest-path crates/risk-engine/Cargo.toml   # OBLIGATOIRE avant npm test
npm test
npm run build
cargo test --manifest-path crates/risk-engine/Cargo.toml
```

`npm run typecheck` = `tsc --build --dry`.

### Démo Observatory (PALLAS_LEDGER_MODE requis)

La démo `npm run observatory:demo` exige **`PALLAS_LEDGER_MODE=dev`** hors production : en mode
`supervised` (défaut), le ledger signé est obligatoire et le démarrage est refusé sans clé Ed25519.

```bash
nix-shell --run "npm run build"
PALLAS_LEDGER_MODE=dev npm run observatory:demo
```

Ouvrir <http://127.0.0.1:4173>. Détails : [`docs/OBSERVATORY.md`](docs/OBSERVATORY.md).
`PALLAS_LEDGER_MODE=dev` est un mode **explicitement non probant**, interdit pour un run réel
(paper trading inclus) — on lui préfère `supervised` + clé publique.

## Interface CLI (dry-run)

Interface de lecture Polymarket, aucune clé requise, aucune écriture (`placeOrder`/`cancelOrder`
jamais exposés) :

```bash
./scripts/dry-run.mjs list-markets 5        # table de marchés CLOB (L'API en renvoie ~1000, affichage borné)
./scripts/dry-run.mjs book <tokenId>        # best bid/ask, mid, spread d'un token
./scripts/dry-run.mjs interactive           # menu : liste numérotée -> choix -> book Yes/No
./scripts/dry-run.mjs --help                # toutes les commandes + options (--json pour JSON brut)
npm run dry-run -- list-markets 5           # variante npm (le `--` sépare les args du script)
```

## Tests et rejeu

Résultats rejoués sur checkout propre (audit v0.6, mêmes chiffres) : `npm test` = **308 passed /
0 failed / 0 skipped** (26 fichiers) ; `cargo test --all-targets` = **65 / 0** ; Clippy vert. Sur
les hôtes sans netns, les 4 tests sandbox `bwrap` sont explicitement skippés (comportement attendu,
voir `docs/mvp/security-guarantees.md`).

## CI

`.github/workflows/ci.yml` : TypeScript compile le binaire Rust **puis** `npm ci`, build,
typecheck, test, `npm audit --audit-level=high` ; Rust `cargo test` + `cargo audit` via Nix —
le même shell épinglé que le dev. Seuils justifiés dans `docs/mission/archives/mission-PALLAS-M06-journal.md`.

## Documentation

- `PROGRESSION.md` — historique condensé et sourcé de la maturité du projet (M21→M36).
- `docs/mvp/` — baseline gelée : `architecture.md`, `security-guarantees.md`,
  `known-limitations.md`, `operations.md`, `CAPABILITIES.md`, `BASELINE-FREEZE.md`,
  `CLODDSBOT-COMPARISON.md`.
- `docs/SECURITY.md` — protections réelles + réserves ; `docs/TRADING.md` — comportement en
  production ; `docs/ARCHITECTURE.md` — modules et flux ; `docs/OBSERVATORY.md` — UI de diagnostic.
- Audits versionnés `docs/AUDIT-PALLAS-v0.1.md` … `v0.6` ; missions `PALLAS-M0x` dans
  `docs/mission/`.