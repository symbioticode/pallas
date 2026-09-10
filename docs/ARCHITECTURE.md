# Architecture de Pallas

**Date :** 9 septembre 2026 — document aligné sur l'état réel du dépôt, après les corrections
`PALLAS-M01`…`M06`. Toute case cochée ici correspond à un état vérifié, pas espéré.

## Diagramme hiérarchique

```
┌─────────────────────────────────────────────────────────┐
│                     GATEWAY (TypeScript)                 │
│  HTTP/WebSocket - Auth - Rate limiting - WebChat UI      │
│  ⚠️ VIDE — non commencé                                  │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────┴─────────────────────────────┐
│                  AGENT LAYER (TypeScript)                │
│  Main agent (Claude) - Tool routing - Input sanitizer    │
│  Skill loader (lazy) - Trade ledger (SHA-256 + anchor)   │
│  ⚠️ VIDE — non commencé (existe : sanitizer dans core,    │
│    pas encore câblé à un agent)                          │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────┴─────────────────────────────┐
│               RISK ENGINE (Rust CLI via Nix)             │
│  validateTrade() pipeline 10 étapes - VaR/CVaR           │
│  Circuit breaker - Kelly sizing - Volatility regime      │
│  Contract JSON stdin/stdout - 50 tests natifs ✔          │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────┴─────────────────────────────┐
│             EXECUTION LAYER (TypeScript)                 │
│  Polymarket adapter (dry-run par défaut) —            ✔  │
│  Sandbox bwrap (bubblewrap) pour shell exec —         ✔  │
│  Credentials AES-256-GCM (fail-closed) —              ✔  │
│  Signature EIP-712 V2 (vecteurs viem) —               ✔  │
└─────────────────────────────────────────────────────────┘
```

## Monorepo

```
pallas/
├── crates/
│   └── risk-engine/          # Rust CLI native — FAIT (50 tests verts, contrat JSON validé)
│       ├── Cargo.toml
│       ├── src/
│       │   ├── main.rs        # CLI : lit JSON stdin, ecrit JSON stdout (schema Zod côté TS)
│       │   ├── lib.rs
│       │   ├── var.rs         # VaR/CVaR (+ norm_inv Acklam)
│       │   ├── circuit_breaker.rs
│       │   ├── kelly.rs
│       │   ├── volatility.rs
│       │   ├── stress.rs
│       │   └── pipeline.rs    # validateTrade() orchestration
│       └── tests/
│           ├── cli_tests.rs
│           └── properties.rs  # proptest
├── packages/
│   ├── core/                  # TS — types, config, credentials, sanitizer, dry-run global (FAIT)
│   ├── risk/                  # TS — facade CLI Rust, schémas Zod (FAIT)
│   ├── execution/             # TS — Polymarket adapter, sandbox, signer, clobSchema (FAIT)
│   ├── gateway/               # TS — HTTP/WS server (VIDE — non commence)
│   ├── agent/                 # TS — AI agent, tools, skill loader (VIDE — non commence)
│   └── ledger/                # TS — trade audit trail (VIDE — non commence)
├── skills/
│   └── polymarket/            # VIDE — non commence
├── tests/
├── docs/                      # mission files + journals + SECURITY/ARCHITECTURE/TRADING + AUDIT
├── package.json / tsconfig.json / vitest.config.ts
├── shell.nix                  # dev shell obligatoire (linker gcc pour le Rust)
└── .github/workflows/ci.yml   # CI GitHub Actions (2 jobs) — PALLAS-M06
```

## Flux de decision (ce qui est réellement câblé aujourd'hui)

1. **Appelant → risk engine** (`@pallas/risk`) : `invoke(payload, schemaZod)` écrit le JSON
   puis lit stdout ; `JSON.parse` + schéma Zod **strict** ; toute déviation ⇒ `RiskEngineError`
   (frontière validée PALLAS-M04).
2. **Exécution Polymarket** (`@pallas/execution`) : client CLOB HTTP natif — `listMarkets`,
   `getOrderbook` (lectures autorisées en dry-run), `placeOrder`/`cancelOrder`/`deriveApiKey`
   (écritures bloquées en dry-run, fail-closed). Réponses validées **avant** mapping par
   `clobSchema.ts` (PALLAS-M04). Writes signés EIP-712 V2 dont le schéma doit être prouvé
   valide contre l'API live (`schemaGate`, PALLAS-M02).
3. **Signaler le risque** : le ledger n'existe pas encore ; l'AmbiguousOrderError de
   `placeOrder` doit être réconcilié manuellement — voir `docs/TRADING.md`.

## Espaces non encore connectés (état honnête)

| Module | État | Rôle prévu |
|---|---|---|
| `packages/gateway` | vide | HTTP/WS + auth + rate limiting + WebChat UI |
| `packages/agent` | vide | agent Claude, tool routing, skill loader, trade ledger |
| `skills/polymarket` | vide | skills chargées lazy |

## Conventions

- Commandes Rust via le dev shell : `nix-shell --run "cd crates/risk-engine && cargo test"` (linker C).
- `npm test` exécute `pretest` = `tsc --build` puis vitest (les exports inter-packages pointent vers
  `dist/`, qui doit donc exister avant les tests).
- `npm run typecheck` = `tsc --build --dry` (mode dry moins robuste qu'un `tsc --noEmit`, à surveiller).