# Pallas

Bot de trading de marchés de prédiction — **Polymarket uniquement**, en **dry-run par défaut**.

Statut réel : **MVP, en préparation de dry-run** — modules Phase 3 (gateway, agent, ledger, skills)
non commencés. État de maturité vérifié par audit externe : voir
[`AUDIT-PALLAS-v0.1.md`](docs/AUDIT-PALLAS-v0.1.md) (audit daté du 9 sept. 2026, corrections
appliquées depuis dans les missions `PALLAS-M01`…`M06`).

## Ce que le projet fait aujourd'hui

- **Risk engine** (`crates/risk-engine`, Rust) : VaR/CVaR, circuit breaker multi-scope, Kelly
  regime-aware, stress test 5 scénarios, pipeline `validateTrade` (10 étapes). Frontière CLI
  validée en entrée/sortie par schémas Zod côté TS.
- **Exécution Polymarket** (`packages/execution`) : client CLOB HTTP natif (listMarkets,
  getOrderbook, placeOrder, cancelOrder, derive API key), signature EIP-712 V2 vérifiée contre
  vecteurs viem, sandbox bwrap pour les exécutions shell (isolation réseau prouvée).
- **Sécurité** : dry-run par défaut (désactivation = confirmation "LIVE" explicite), secrets
  chiffrés AES-256-GCM, zéro `as any`, sandbox, gating de schéma de signature (fail-closed).

## Non commencé (honnêteté)

Phase 3-4 de `PLAN.md` : gateway Fastify, agent, ledger de trades, skills. Rien de cela n'existe
et n'est décrit nulle part comme « en cours ».

## Démarrage

```bash
# tout l'environnement (Node 22, toolchain Rust + linker C, bubblewrap, cargo-audit) :
nix-shell
npm ci
npm test          # pretest = tsc --build ; suite vitest
npm run build
cargo test        # crates/risk-engine
cargo audit
```

`npm run typecheck` = `tsc --build --dry`.

## Interface CLI (dry-run)

Interface de lecture Polymarket, aucune clé requise, aucune écriture (`placeOrder`/`cancelOrder`
jamais exposés). Exécutable directement ou via npm :

```bash
./scripts/dry-run.mjs list-markets 5        # table de marchés CLOB (L'API en renvoie ~1000, affichage borné)
./scripts/dry-run.mjs book <tokenId>        # best bid/ask, mid, spread d'un token
./scripts/dry-run.mjs interactive           # menu : liste numérotée -> choix -> book Yes/No
./scripts/dry-run.mjs --help                # toutes les commandes + options (--json pour JSON brut)
npm run dry-run -- list-markets 5           # variante npm (le `--` sépare les args du script)
```

## CI

`.github/workflows/ci.yml` : deux jobs reposés sur le **shell Nix du repo** (`shell.nix` épinglé —
le même environnement que le dev, y compris bubblewrap) : TypeScript `npm ci`, build, typecheck,
test, `npm audit --audit-level=high` ; Rust `cargo test` + `cargo audit` via Nix. Seuil audit
justifié dans `docs/mission/mission-PALLAS-M06-journal.md`.

## Documentation

- `PLAN.md` — plan recalibré post-audit, missions `PALLAS-M0X` dans `docs/mission/`.
- `docs/SECURITY.md` — protections réelles + réserves.
- `docs/TRADING.md` — comportement attendu en production (timeout, dry-run).
- `docs/ARCHITECTURE.md` — modules et flux, avec l'état de chacun.
- `FICHE-LECONS.md` — leçons de CloddsBot (prédécesseur abandonné).