# Pallas — Plan de reconstruction from scratch

**Objectif :** Reconstruire un terminal de trading IA serieux en partant des lecons de CloddsBot, en corrigeant ses failles et en gardant ce qui fonctionne.

**Stack :** TypeScript (orchestration, gateway, channels, skills) + Rust (risk engine, execution critique)
**Scope MVP :** Polymarket uniquement, 1 channel (WebChat), dry-run par defaut
**Exigence bloquante :** `npm install && npm test && npm run build` fonctionne du premier coup, avec tests verts.

> **Decision technique clé (Rust via Nix, pas NAPI-RS)**
> Le risk engine est critique (decide si un trade est execute) : on le veut en Rust pour la surete memoire
> et la testabilite. Plutot qu'un bindings NAPI-RS (fragile, compile dans le pipe npm, multiplateforme),
> on l'ecrit en **CLI Rust native** appelee par TypeScript via contrat **JSON sur stdin/stdout**.
> Le package `@pallas/risk` expose une facade TS pure qui appelle la CLI (`spawn` + ecriture sur stdin ;
> `execFile` ignore l'option `input` et pend — ne jamais l'utiliser pour injecter l'entree JSON).
> L'implementation peut etre remplacee sans toucher au reste. La toolchain Rust est fournie par **Nix**
> (comme 53_TAXE_OPTIMIZER), ajoutee au profile utilisateur : `nix profile install nixpkgs#cargo nixpkgs#rustc`.

> **Toolchain Rust — deux briques, pas une**
> 1. `nix profile install nixpkgs#cargo nixpkgs#rustc` → cargo/rustc dans `~/.nix-profile` (1.97.x).
> 2. **`shell.nix`** (mkShell rustc+cargo+**gcc**+binutils) → fournit le linker C `cc`, indispensable
>    pour compiler les dépendances Rust. Un `nix profile add gcc` entre en conflit de priorite avec
>    le gcc système ; on ne l'installe donc PAS au profile. **Toute commande cargo passe par le dev shell**
>    : `nix-shell --run "cd crates/risk-engine && cargo test"`.

> **Runner de tests : vitest (choix fait en session, Phase 2)**
> Abandon de `node --test` + `tsx` au profit de **vitest** : un seul runner multi-packages,
> mock/restore propres (`vi.stubEnv`, `vi.stubAllGlobals`), description/expect lisibles.
> `@types/node` reste declare (types `process`/`Buffer`/`node:crypto`).
> `tsconfig.json` racine : `noEmit:true` ; chaque package : `composite:true` + `noEmit:false`.
> `vitest` resout les imports inter-packages via les `exports` de `package.json` (qui pointent vers
> `dist/`) → **`dist/` doit exister avant les tests** : `pretest` relance `tsc --build`.

---

## Architecture cible

```
┌─────────────────────────────────────────────────────────┐
│                    GATEWAY (TypeScript)                   │
│  HTTP/WebSocket - Auth - Rate limiting - WebChat UI      │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────┴─────────────────────────────┐
│                 AGENT LAYER (TypeScript)                  │
│  Main agent (Claude) - Tool routing - Input sanitizer    │
│  Skill loader (lazy) - Trade ledger (SHA-256 + anchor)   │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────┴─────────────────────────────┐
│              RISK ENGINE (Rust CLI via Nix)               │
│  validateTrade() pipeline 10 etapes - VaR/CVaR           │
│  Circuit breaker - Kelly sizing - Volatility regime       │
│  Contract JSON stdin/stdout - tests Rust natifs          │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────┴─────────────────────────────┐
│            EXECUTION LAYER (TypeScript)                   │
│  Polymarket adapter (dry-run par defaut)                  │
│  Sandbox bwrap (bubblewrap) pour shell exec               │
│  Credentials AES-256-GCM (fail-closed)                   │
└─────────────────────────────────────────────────────────┘
```

> **Decision sandbox (session Phase 1) : bubblewrap, pas Docker.** Docker n'est pas disponible sur
> l'hote NixOS ; **`bwrap`** (présent au système) est utilise a la place : namespace reseau isole
> (`--unshare-net`), `--die-with-parent`, allowlist de binaires resolus via PATH, `spawn` en array
> args (jamais `shell:true`). Revenir a Docker uniquement si un besoin de containers emerge.

---

## Monorepo

```
pallas/
├── crates/
│   └── risk-engine/          # Rust CLI native
│       ├── Cargo.toml
│       ├── src/
│       │   ├── main.rs        # CLI : lit JSON stdin, ecrit JSON stdout
│       │   ├── lib.rs
│       │   ├── var.rs         # VaR/CVaR (+ norm_inv Acklam)
│       │   ├── circuit_breaker.rs
│       │   ├── kelly.rs
│       │   ├── volatility.rs
│       │   ├── stress.rs
│       │   └── pipeline.rs    # validateTrade() orchestration
│       └── tests/
│           ├── cli_tests.rs   # tests integration CLI
│           └── properties.rs  # tests proptest
├── packages/
│   ├── core/                  # TS — types, config, credentials, sanitizer, dry-run global
│   ├── risk/                  # TS — facade autour de la CLI Rust (contrat JSON)
│   ├── execution/             # TS — Polymarket adapter, sandbox, dryRun facade
│   ├── gateway/               # TS — HTTP/WS server
│   ├── agent/                 # TS — AI agent, tools, skill loader
│   └── ledger/                # TS — trade audit trail
├── skills/
│   └── polymarket/
├── tests/
├── package.json / tsconfig.json / vitest.config.ts
├── shell.nix                   # dev shell obligatoire (linker gcc)
└── .github/workflows/ci.yml
```

---

## Phase 0 — Fondations (S1-S2)

- [x] Structure monorepo + workspaces npm + tsconfig strict
- [x] Toolchain Rust via Nix (profile `cargo`+`rustc` + `shell.nix` pour le linker gcc)
- [ ] Risk engine Rust CLI + tests (couverture 90%+) **— fait : 37 tests verts, couverture a mesurer**
- [x] Facade TS `@pallas/risk` qui appelle la CLI (contrat JSON stdin/stdout, fail-closed)
- [ ] CI : npm + cargo, passe du premier coup (Phase 5)

**Nouveau (session) :** commande de validation reelle — `npm install && npm run build && npm test`
depuis un etat propre, **plus** `cd crates/risk-engine && cargo test` dans le dev shell. Vert actuel :
47 tests TS (7 fichiers) + 37 tests Rust. Toute prise doit garder ce vert.

### 0.3 Risk engine Rust — exigences de test (non negociables) — ATTEINTES

```rust
// tests/var_tests.rs
#[test] fn var_rejects_when_exceeding_limit()
#[test] fn cvar_exceeds_var_for_skewed_distributions()
#[test] fn var_with_empty_window_returns_zero()
#[test] fn var_handles_single_observation()

// tests/pipeline_tests.rs
#[test] fn kill_switch_blocks_all_trades()
#[test] fn circuit_breaker_blocks_after_consecutive_losses()
#[test] fn kelly_reduces_size_in_high_volatility()
#[test] fn full_pipeline_approves_valid_trade()
#[test] fn full_pipeline_rejects_oversized_order()
#[test] fn pipeline_is_deterministic()

// property tests (proptest)
  var_never_negative(pnls)
  kelly_never_exceeds_bankroll(edge, bankroll)
```

**Nouveau (session) :** module `lib.rs` publie l'API (tests unitaires 28) + binaire `main.rs`
(filtre JSON sur stdin → JSON sur stdout, erreurs `{"error":...}` stderr + exit 1). La facade
`@pallas/risk` bascule sur `PALLAS_RISK_BIN` (override env) pour pointer le binaire compile en release.

---

## Phase 1 — Securite fondamentale (S2-S3)

### 1.1 Credentials — fail-closed (FAIT dans @pallas/core)
- [x] AES-256-GCM + scrypt, fail-closed (throw si cle absente)
- [x] Zeroing memoire (Buffer.fill(0))
- [x] Pas de legacy v1
- [x] Tests : roundtrip, wrong key, tamper, missing key

### 1.2 Dry-run global (FAIT dans @pallas/core)
- [x] `dryRun=true` par defaut, un seul flag
- [x] Desactivation exige confirmation exacte "LIVE" (fail-closed)
- [x] Pas de `?? false` dissemine
- [x] `config.ts` ne verifie plus la longueur des cles au chargement (severite au point d'usage)

**Nouveau (session) :** `@pallas/execution/src/dryRun.ts` = facade lecture du flag global. Tous les
adaptateurs d'exchange fautent LIRE l'etat du dry-run via cette facade ; l'ecriture ne part JAMAIS
en dry-run (`placeOrder`/`cancelOrder` jettent avant le premier `fetch`).

### 1.3 Shell execution — vrai sandboxing (FAIT — variante bwrap)
- [x] Sandbox **bubblewrap (bwrap)** pour toute execution shell/Python (Docker indisponible sur NixOS)
- [x] Allowlist de binaires resolus via PATH : python3, python, node, ls, echo (pas de bash/sh)
- [x] `spawn` avec array arguments, jamais `shell:true`
- [x] Isolation reseau verifiee par test (`--unshare-net`), timeout, `--die-with-parent`
- Tests : 7 verts (dont execution reelle `6*7` sous bwrap et blocage reseau)

### 1.4 Input sanitizer (FAIT dans @pallas/core)
- [x] Copie du sanitizer CloddsBot (homoglyphes, zero-width, prompt injection)
- [x] Perf via Set
- [x] Tests par categorie (9 verts)

---

## Phase 2 — Execution Polymarket (S3-S5)

### 2.1 Polymarket adapter (FAIT — lecture + dry-run, ecriture fail-closed)
- [x] Client Polymarket CLOB (HTTP natif, aucun SDK) — `listMarkets`, `getOrderbook`, `placeOrder`, `cancelOrder`
- [x] Reads (markets/orderbook) autorises en dry-run ; **writes bloques en dry-run (fail-closed)**
- [x] Retry/backoff exponentiel sur erreurs transitoires (2 retries)
- [x] Mapping CLOB rigoureux : champs string `"true"/"false"` (active/closed) → booleens, `clob_token_ids`
- [x] Tests : 6 verts (mocking API, dry-run ne touche pas l'API, serialisation CLOB)

**Nouveau (session) :** `MarketSummary.active` (bool) fait partie du contrat retourne. Default
`baseUrl=https://clob.polymarket.com`, `fetcher` injectable. Erreurs HTTP → throw avec code et corps tronque.

### 2.2 Credentials Polymarket
- [ ] Stockage chiffre via @pallas/core
- [ ] Wallet Solana (cle privee base58 ou JSON array)
- [ ] API key Polymarket
- [ ] Signature CLOB des ordres (HMAC/ECDSA) — condition pour lever le fail-closed
- [ ] Tests : roundtrip, wrong key

### 2.3 Validation inter-paquets (NOUVELLE etape de session)
- [x] Build workspace en **project references** : `tsc --build packages/core packages/risk packages/execution`
  (ordre topologique : execution > core). `package.json` de paquets dependants declare `@pallas/core`.
- [x] `pretest` = `tsc --build` (dist necessaire a la resolution vitest des exports inter-paquet)
- [x] `typecheck` = `tsc --build --dry`
- [x] Migration `node --test`+tsx → **vitest** : 7 fichiers, 47 tests

---

## Phase 3 — Gateway + Agent + Ledger (S5-S7)

### 3.1 Gateway HTTP/WebSocket
- [ ] Serveur Fastify, port configurable
- [ ] Auth (API key ou JWT)
- [ ] Rate limiting IP
- [ ] Health endpoint
- [ ] WebChat UI

### 3.2 Agent core
- [ ] Connection Claude API
- [ ] Tool definitions (trade, read, search)
- [ ] Input sanitizer avant chaque tool call
- [ ] Order via `@pallas/execution` (dry-run garde jusqu'a confirmation "LIVE")

### 3.3 Trade ledger
- [ ] Capture decision + assert SHA-256
- [ ] Calibration confiance vs precision
- [ ] Export JSON/CSV
- [ ] Tests : hash deterministe, calibration

---

## Phase 4 — Skills + Extensibilite (S7-S9)

### 4.1 Skill loader (lazy-loading)
- [ ] Lazy-loading, gate system (env vars, binaires, OS)
- [ ] Hot-reload
- [ ] Tests : skill manquante ne crash pas

### 4.2 Premiere skill : Polymarket
- [ ] Fetch markets, place order, portfolio (via l'adapter Phase 2, dry-run par defaut)
- [ ] Tests : commandes retournent resultats structures

---

## Phase 5 — CI/CD + Documentation (S9-S10)

### 5.1 CI Pipeline
- [ ] `npm ci`, `cargo test` (dev shell Nix), `npm run typecheck`, `npm test`, `npm run build`
- [ ] `npm audit --audit-level=high`

### 5.2 Documentation sobre
- [ ] README : features reelles, pas de badges marketing
- [ ] docs/ARCHITECTURE.md, SECURITY.md, TRADING.md
- [ ] Pas de SECURITY_AUDIT.md tant que pas d'audit reel

---

## Regles de conduite

### Ce qu'on reprend de CloddsBot

| Element | Reference |
|---------|-----------|
| Risk engine pipeline 10 etapes | src/risk/engine.ts |
| Input sanitizer | src/security/sanitizer.ts |
| Trade ledger hash SHA-256 + anchor | src/ledger/hash.ts |
| Calibration confiance vs precision | src/ledger/index.ts |
| Lazy-loading skills | src/skills/loader.ts |
| Circuit breaker multi-scope | src/risk/circuit-breaker.ts |
| Kelly sizing regime-aware | src/risk/engine.ts |
| Stress test 5 scenarios | src/risk/stress.ts |

### Ce qu'on ne reprend PAS

| Element | Ce qu'on fait |
|---------|---------------|
| dryRun=false par defaut | dryRun=true par defaut, confirmation "LIVE" |
| `execSync` avec shell bash | sandbox bwrap + allowlist + execFile/spawn en array args |
| Cle Solana en clair en memoire | Zeroing memoire |
| `skipLibCheck:true` | **false** — à corriger dans `tsconfig.json` (la migration vitest l'a pose `true` par commodite) |
| 376 `as any` | zero tolerance |
| SECURITY_AUDIT.md obsolete | pas d'audit affiche sans audit reel |
| Badges marketing exageres | README sobre |

---

## Estimation

| Phase | Duree |
|-------|-------|
| 0 — Fondations | 2 sem |
| 1 — Securite | 1 sem |
| 2 — Polymarket | 2 sem |
| 3 — Gateway + Agent | 2 sem |
| 4 — Skills | 2 sem |
| 5 — CI/CD + docs | 1 sem |
| **Total MVP** | **~10 sem** |

*Avancement effectif : Phases 0-1 terminees (hors CI), Phase 2 adapter termine (creds + signature CLOB restent).*