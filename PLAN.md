# Pallas — Plan de reconstruction from scratch

**Objectif :** Reconstruire un terminal de trading IA serieux en partant des lecons de CloddsBot, en corrigeant ses failles et en gardant ce qui fonctionne.

**Stack :** TypeScript (orchestration, gateway, channels, skills) + Rust (risk engine, execution critique)
**Scope MVP :** Polymarket uniquement, 1 channel (WebChat), dry-run par defaut
**Exigence bloquante :** `npm install && npm test && npm run build` fonctionne du premier coup, avec tests verts.

> **⚠️ AUDIT 2026-09-09 (commit `813be02`) — voir `AUDIT-PALLAS-v0.1.md`**
> Verdict : **prototype fragile**, pas encore « prêt pour dry-run réel ». Les sections ci-dessous ont
> été recalibrées sur les constats réels de l'audit (et non plus sur les affirmations optimistes de
> sessions précédentes). Les corrections sont pilotées par 6 missions au format `template_mission.md` :
>
> | Mission | Sujet | Priorité |
> |---|---|---|
> | `PALLAS-M01` | Risk engine — validation stricte + état réel transmis | 🔴 Critique → ✅ clôturée 2026-09-09 |
> | `PALLAS-M02` | Signature Polymarket EIP-712 — correction et validation officielle | 🔴 Critique → ✅ clôturée 2026-09-09 |
> | `PALLAS-M03` | Sandbox bwrap — fix opérationnel + suppression du faux positif réseau | 🟠 Haute → ✅ clôturée 2026-09-09 |
> | `PALLAS-M04` | Frontières TS/HTTP — validation runtime stricte, retry, idempotence | 🟠 Haute → ✅ clôturée 2026-09-09 |
> | `PALLAS-M05` | Credentials & mémoire — honnêteté du zeroing, fermeture des fuites en clair | 🟡 Moyenne → ✅ clôturée 2026-09-09 |
> | `PALLAS-M06` | CI/CD + documentation sobre | 🟡 Moyenne → ✅ clôturée 2026-09-09 |
>
> Aucune nouvelle case ne doit être cochée `[x]` sans que le critère de succès correspondant de la
> mission associée soit vérifié et journalisé (`mission-PALLAS-M0X-journal.md`).

> **⚠️ AUDIT v0.2 (2026-09-09, `docs/AUDIT-PALLAS-v0.2.md`, gitignoré) — récupérations ciblées, 1 commit+push par mission**
>
> | Mission | Sujet | Statut |
> |---|---|---|
> | `PALLAS-M07` | Sandbox réseau fiable (sonde `realBwrap`, skip explicite, handler `server.listen`) | ✅ clôturée 2026-09-10 |
> | `PALLAS-M08` | Wire CLOB V2 « `taker` » — comparaison test officiel (prémisse RÉFUTÉE : l'audit citait des repos **V1**, aucun client V2 n'émet `taker`) | ✅ clôturée 2026-09-10 |
> | `PALLAS-M09` | Risk : cohérence `est_value_usd` ~ `price×quantity` + Kelly réellement contraignant | ✅ clôturée 2026-09-10 |
> | `PALLAS-M10` | Frontières résiduelles : `OrderMismatchError`, `PALLAS_RISK_BIN`, `deriveApiKey`, `isDryRun` | ✅ clôturée 2026-09-10 |
> | `PALLAS-M11` | CI réelle documentée + `PLAN.md` propre | ✅ clôturée 2026-09-10 |
> | `PALLAS-M12` | Stratégie de référence : intégration bout-en-bout dry-run (ledger chaîné, orchestrateur, reads réels) | ✅ clôturée 2026-09-10 |
> | `PALLAS-M13` | Transaction durable décision→ordre→ack : persistance atomique (atomicfs+lock+fsync), fail-stop, machine d'états, correlationId, 4 crash-windows, concurrence, Observatory v2 | ✅ clôturée 2026-09-11 |

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
>
> **⚠️ Correctif audit :** sur l'hôte testé, bwrap échoue systématiquement à la création du namespace
> réseau (`Failed to create NETLINK_ROUTE socket: Operation not permitted`) — voir `PALLAS-M03`.

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
│   ├── gateway/               # TS — HTTP/WS server (VIDE — non commence)
│   ├── agent/                 # TS — AI agent, tools, skill loader (VIDE — non commence)
│   └── ledger/                # TS — trade audit trail (VIDE — non commence)
├── skills/
│   └── polymarket/            # VIDE — non commence
├── tests/
├── package.json / tsconfig.json / vitest.config.ts
├── shell.nix                   # dev shell obligatoire (linker gcc)
└── .github/workflows/ci.yml   # CI GitHub Actions (2 jobs TS/Rust) — PALLAS-M06 ✔
```

---

## Phase 0 — Fondations (S1-S2)

- [x] Structure monorepo + workspaces npm + tsconfig strict
- [x] Toolchain Rust via Nix (profile `cargo`+`rustc` + `shell.nix` pour le linker gcc)
- [x] Risk engine Rust CLI + tests — **état courant (2026-09-10) : 54 tests Rust verts
      (39 unitaires + 12 intégration CLI + 3 proptest), couverture 95,92 % lignes (audit v0.2 §1.3).
      Protection live opérationnelle : validation stricte des entrées, kill switch réel, état
      persistant (circuit breaker, volatilité) transporté entre appels, machine à états
      Open→HalfOpen→Closed, NaN traité — PALLAS-M01, clôturée 2026-09-09.
      PALLAS-M09 (clôturée 2026-09-10, ne rouvre PAS M01 — écarts distincts découverts par l'audit
      v0.2) : cohérence METIER inter-champs — gate `VALUE_CONSISTENCY`
      (`est_value_usd` ~ `price×quantity`, tolérance max(1¢, 1 %) justifiée en commentaire) et
      `KELLY_LIMIT` désormais CONTRAIGNANT sur la taille suggérée finale (`recommended_size` ×
      multiplicateur de volatilité, plafonné `max_order_usd`) avec marge centime. Tests
      `audit_v0_2_rejects_*` reproduisant les 2 probes v0.2 (baseline « acceptées » pré-correctif
      capturée au journal M09). PALLAS-M11 (2026-09-10) : `cargo clippy --all-targets
      --all-features -- -D warnings` propre (7 lints corrigés, clippy ajouté au shell.nix).
      (`37 tests/92,17 %` et `50 tests` cités précédemment sont des états HISTORIQUES — voir
      « État audité » ci-dessous.)**
- [x] Facade TS `@pallas/risk` qui appelle la CLI (contrat JSON stdin/stdout) — **fail-closed sur
      process/exit non-zero confirme ; depuis PALLAS-M04 (cloturee le 2026-09-09) la reponse JSON est
      VALIDEE a l'execution contre des schemas Zod du contrat reel (types.rs — serde snake_case) :
      tout ecart (champ manquant, type faux) leve `RiskEngineError` explicite, plus jamais de cast
      aveugle `as T`.**
- [x] CI : npm + cargo, passe du premier coup — **pipeline `.github/workflows/ci.yml` réelle
      (2 jobs TS/Rust reposés sur le shell Nix), runs VERTs réels observés sur GitHub Actions au
      2026-09-10 (M06 annexe + chaque mission M07→M10 ; liens dans
      `docs/mission/mission-PALLAS-M11-journal.md`).**

**Etat verifie (audit 2026-09-09) — HISTORIQUE, remplacé par l'état courant ci-dessus :**
`npm install && npm run build` OK. `npm test` **ROUGE** :
9 fichiers, 66 tests, **64 reussis / 2 echoues** (sandbox bwrap — voir PALLAS-M03). Rust : 37/37 verts
(28 unitaires + 6 integration CLI + 3 property tests).

**Etat reel apres PALLAS-M01 (2026-09-09) :** les 5 reserves ci-dessous sont levees (preuves dans
`docs/mission/mission-PALLAS-M01-journal.md`). `cargo test` 50/50, `npm test` 70/70, typecheck OK.

### 0.3 Risk engine Rust — exigences de test (non negociables) — ATTEINTES (tests), PAS ATTEINTES (robustesse)

Tests presents et verts (liste inchangee, voir commit). Reserves de l'audit a traiter dans PALLAS-M01 :
- `KILL_SWITCH` gate toujours `Allow` — n'est pas un vrai kill switch (`pipeline.rs:75-80`).
- L'entree CLI ne transporte que `hist_pnls` — circuit breaker et detecteur de volatilite sont
  **recrees a leurs valeurs par defaut a chaque appel** (`main.rs:60-65`), donc sans memoire d'etat.
- Circuit breaker : aucun chemin reel vers `HalfOpen` ; le test `half_open_recovers_to_closed` ne
  teste aucune recuperation (`circuit_breaker.rs:150-163`).
- Aucune validation des entrees : un trade avec `market_id=""`, `side="garbage"`,
  `est_value_usd=-100`, `win_probability=2` est **accepte** (`allowed: true`).
- `partial_cmp(...).unwrap()` peut paniquer sur NaN (`var.rs:27,44`) — l'API bibliotheque publique
  n'est pas protegee (seule la frontiere CLI JSON bloque NaN standard).

---

## Phase 1 — Securite fondamentale (S2-S3)

### 1.1 Credentials — fail-closed (FAIT stockage + memoire effectuee la ou c'est possible — PALLAS-M05 cloturee le 2026-09-09)
- [x] AES-256-GCM + scrypt, fail-closed (throw si cle absente)
- [x] Zeroing — **honnete et precis : efface les COPIES Buffer (`toKeyBuffer` + `fill(0)`, try/finally)
      des cles privees dans le signer (`signOrder`, `signClobAuth`, `signEip191`,
      `privateKeyToAddress` — PALLAS-M05), la cle derivee et le buffer dechiffre temporaire
      (`credentials.ts`). NON-effaçable en JS pur : passphrase, secrets post-`JSON.parse`
      (`decryptObject`, `loadPolymarketSecrets`) et strings sources restent en clair — risque
      residuel documente dans `docs/SECURITY.md` (heap dump).**
- [x] Pas de legacy v1
- [x] Tests : roundtrip, wrong key, tamper, missing key

### 1.2 Dry-run global (FAIT, sous reserve d'API de contournement)
- [x] `dryRun=true` par defaut, un seul flag
- [x] Desactivation exige confirmation exacte "LIVE" (fail-closed)
- [x] Pas de `?? false` dissemine dangereux pour le dry-run (le seul `?? false` actif porte sur
      `signedOrdersValidated`, un fallback securise)
- [x] `config.ts` ne verifie plus la longueur des cles au chargement
- **Reserve auditee :** le constructeur `PolymarketClient` accepte `isDryRun: () => false` injecte
  directement (`polymarketClient.ts`) — pratique pour les tests, mais c'est une API de contournement
  des gardes globales pour tout appelant interne. A restreindre en usage production.
  (`signedOrdersValidated` supprime — voir PALLAS-M02.)

### 1.3 Shell execution — sandboxing verifie (PALLAS-M03 cloturee le 2026-09-09)
- [x] Sandbox **bubblewrap (bwrap)** codee : allowlist, pas de bash/sh, `spawn` array args
- [x] **Isolation reseau verifiee par test — PREUVE REELLE, plus aucun faux positif.**
      Le test demarre un serveur HTTP sur la boucle locale du HOST et verifie que le processus
      sandboxe ne peut PAS le joindre (0 requete recue, echec URLError explicite). Le precedent
      `exitCode !== 0` — vrai aussi quand bwrap ne demarre jamais le programme — est remplace par :
      tout `bwrap: ...` dans stderr = echec d'INITIALISATION ⇒ `runSandboxed` REJETTE
      (`BwrapInitError`, fail-closed), jamais pris pour une isolation. Test negatif dedie simule
      l'hote de l'audit (`Failed to create NETLINK_ROUTE socket`) et verifie le rejet.
- [x] **Diagnostic hote (prouve, pas suppose)** : sur l'hote actuel (kernel 6.18.44, bwrap 0.11.2,
      `sysctl kernel.unprivileged_userns_clone` absente mais user namespaces actifs —
      `/proc/sys/user/max_user_namespaces=62197`, CapEff vides, CapBnd pleins), `bwrap
      --unshare-net --unshare-pid --unshare-uts --ro-bind / / python3 -c 'print(6*7)'` → `42`, exit 0 ;
      netns = boucle isolée (`socket.if_nameindex() == [(1,'lo')]`). L'echec `NETLINK_ROUTE EPERM`
      de l'hote de l'audit vient de la conf userns/niveau capacites de CETTE machine la ; c'est une
      contrainte d'hote desormais CI-blocs dans l'autre sens : bwrap non initialise ⇒ throw, jamais
      execution en clair. Le test reseau echoue legerement si l'hote ne fournit ni netns ni python3.
- [x] `resolveBinary` durci : cible = fichier REGULIER executable (realpath + stat isFile + X_OK),
      pas seulement `existsSync` ; un dossier ou un lien detourne est rejete (test dedie).
- [x] Portee filesystem documentee (code + `docs/SECURITY.md`) : `--ro-bind / /` protege l'ECRITURE,
      PAS la confidentialite — le processus sandboxe peut lire ce que son utilisateur peut lire.
- Tests sandbox : **9/9 verts**. Suite TS : **113/113** (9 fichiers, état 2026-09-10 ;
  le compteur 84/84 daté du 2026-09-09 est obsolète).

### 1.4 Input sanitizer (FAIT, mais isole)
- [x] Copie du sanitizer CloddsBot (homoglyphes, zero-width, prompt injection)
- [x] Perf via Set
- [x] Tests par categorie (9 verts)
- **Reserve auditee :** le sanitizer n'est connecte a aucun agent/tool call reel puisque
  `packages/agent` n'existe pas encore — a cabler des que l'agent existe (PALLAS-M01/M06 croise
  avec Phase 3, hors scope immediat).

---

## Phase 2 — Execution Polymarket (S3-S5)

### 2.1 Polymarket adapter (FAIT, robustesse reseau durcie — PALLAS-M04 cloturee le 2026-09-09)
- [x] Client Polymarket CLOB (HTTP natif, aucun SDK) — `listMarkets`, `getOrderbook`, `placeOrder`, `cancelOrder`
- [x] Reads autorises en dry-run ; writes bloques en dry-run (fail-closed)
- [x] Retry/backoff exponentiel — **GET (listMarkets/getOrderbook) : retry sur `TypeError`, timeout/abort
      et 5xx. `cancelOrder` (DELETE, IDEMPOTENT par orderId) : retry sur les MÊMES erreurs transitoires.
      `placeOrder` (POST) : AUCUN retry — l'API CLOB n'a PAS de cle d'idempotence (docs place-orders,
      corps = deferExec/order/orderType/owner/postOnly) ; timeout ou 5xx ⇒ `AmbiguousOrderError`
      "l'ordre PEUT avoir ete place, ne pas re-emettre sans reconciliation" (testee : fetcher appele
      1 seule fois).**
- [x] Mapping CLOB — **validation runtime stricte via schemas Zod (`clobSchema.ts`) : `best_bid`
      non numerique, `clob_token_ids` absent, bucket d'orders malforme ⇒ `ClobValidationError`
      explicite, plus JAMAIS de `Number(undefined)`→NaN silencieux.**
- [x] Tests : 26 verts (`polymarketClient.test.ts`, état 2026-09-10)

### 2.2 Credentials Polymarket
- [x] Stockage chiffre via `polymarketSecrets` (AES-256-GCM, fail-closed) — 8 tests
- [x] **Wallet — coherence corrigee (PALLAS-M05) : le signer utilise secp256k1/**Ethereum**
      (Polygon), et non Solana — l'ancien commentaire "wallet Solana" de
      `polymarketSecrets.ts` (legacy CloddsBot) est corrige. Memoire : les copies Buffer
      des cles privees sont zeroees apres usage (voir §1.1).**
- [x] API key Polymarket live — stockage + **auth réelle câblée** : L2 HMAC (placeOrder/cancelOrder)
      + L1 EIP-712 ClobAuth (deriveApiKey), testées via mock serveur — voir PALLAS-M02
- [x] **Signature CLOB des ordres — clôturée PALLAS-M02 (2026-09-09)** : schéma réécrit en V2
      officiel (domaine version "2", exchange STD/NEG, 11 champs signés, montants BUY/SELL corrects,
      mots ABI 32B, `domainSeparator` standard avec typeHash) ; validé contre vecteurs viem 2.56.3 +
      Ether Mail officiel ; auth L2/L1 câblée ; preuve de schéma via `schemaGate.ts` (fail-closed).
      **6 constats de l'audit corrigés** (1 domainSeparator, 2 signatureType 32B, 3 montants,
      4 vecteurs de référence, 5 `signedOrdersValidated` remplacé, 6 headers d'auth).
      → preuves et détail : `docs/mission/mission-PALLAS-M02-journal.md`
- [x] Tests unitaires signer : roundtrip, déterminisme, recovery + **vecteurs EIP-712 officiels et
      clients de référence (viem)** — voir PALLAS-M02

### 2.3 Validation inter-paquets
- [x] Build workspace en project references, ordre topologique
- [x] `pretest` = `tsc --build`
- [x] `typecheck` = `tsc --build --dry` (note : mode "dry" moins robuste qu'un vrai `tsc --noEmit`
      sur un arbre deja a jour — a surveiller)
- [x] Migration vitest — **effective ; suite VERTE 113/113 (9 fichiers) depuis PALLAS-M07 (les 2
      échecs sandbox de l'audit v0.1 corrigés : sonde `realBwrap` + skip explicite).**

---

## Phase 3 — Gateway + Agent + Ledger (S5-S7) — INCHANGE

### 3.1 Ledger + Stratégie de référence — INTÉGRATION PARTIELLE (PALLAS-M12 clôturée le 2026-09-10)

- [x] `@pallas/ledger` : ledger append-only en chaîne SHA-256 (`hash_n = SHA256(prev_hash + contenu_n)`),
      `verify()` réel (détection de falsification testée : modification d'un enregistrement intermédiaire
      ⇒ `brokenAt`), persistance fichier JSON atomique — **limite DÉLIBÉRÉE (pas de base de données,
      mission §6.4)** ; 8 tests.
- [x] `ReferenceStrategy` (`@pallas/strategy`) — **explicitement NON PRÉDICTIVE** (disclaimer en tête
      de fichier, aucun paramètre optimisé) : BUY quand best ask < seuil fixe, understand `docs/STRATEGY.md`.
- [x] Intégration bout-en-bout **dry-run** (`run-reference-loop.ts`) : signal → sanitizeInput (texte
      externe, menaces journalisées) → `validateTradeWithState` (état persistant `.pallas/risk-state.json`
      entre exécutions) → décision → si acceptée : payload signé « pour la forme » puis `placeOrder`
      **bloqué en dry-run** (jamais de mécanisme live, `signatureSchemaValidated` jamais touché),
      ledger écrit à chaque étape. Aucun retry après exécution/rejet ; un seul appel à `placeOrder`.
- [x] **Prouvé manuellement sur de vrais reads Polymarket** (PALLAS-M12 §4) : 3 cycles réels (book réel
      → signal → allow → dry-run blocked), scénario de rejet (limite de config abaissée ⇒ `POSITION_LIMIT`,
      ledger enregistre `rejected_by`, aucun appel ordre), falsification manuelle d'un enregistrement
      détectée (`brokenAt`), état risk reconstruit sur 2 exécutions séparées. Tests automatisés écrits
      APRÈS ces runs manuels (11 tests strategy-orchestrateur sur fetcher mock).
- [ ] **Ancrage on-chain du ledger — HORS SCOPE (mission §6)** : à reconsidérer avec une vraie
      persistance durable (base / IPFS / contrats) en Phase 3.
- [ ] Gateway (serveur Fastify, auth, rate limiting, health) — NON COMMENCÉ
- [ ] WebChat UI + connexion Claude API + tool definitions — NON COMMENCÉ
- [ ] Backtesting de la stratégie (hors M12, condition dans `docs/STRATEGY.md`) — NON COMMENCÉ

## Phase 4 — Skills + Extensibilite (S7-S9) — INCHANGE, NON COMMENCE

- [ ] Skill loader (lazy-loading, hot-reload)
- [ ] Premiere skill Polymarket (fetch markets, place order, portfolio)

## Phase 5 — CI/CD + Documentation (FAIT — PALLAS-M06 clôturée le 2026-09-09)

- [x] CI Pipeline — **`.github/workflows/ci.yml` : 2 jobs reposés sur le shell Nix épinglé
      (`nix-installer-action@v23` + `magic-nix-cache-action@v15`) — décision annexe M06
      (`actions-rust-lang/audit@v2` inexistante ⇒ `cargo audit` dans le shell). Job TS : compile
      d'abord le binaire risk-engine (runner séparé du job rust), puis `npm ci`, `npm run build`,
      `npm run typecheck`, `npm test`, `npm audit --audit-level=high`. Job Rust : `cargo test` +
      `cargo audit` via Nix. Test d'échec volontaire du pipeline prouvé (commit `3429c8f`, remplacé
      par le fix `a07c9a8`). Runs VERTs réels observés au 2026-09-10 (M06 annexe + M07→M10 ; liens
      dans `docs/mission/mission-PALLAS-M11-journal.md`). Seuil audit `high` justifié (2 modérées
      `@vitest/mocker` dev-only, non exploitable en CI ; Vitest 5 = piste future).**
- [x] Documentation sobre : `README.md` (état réel, pas de badges), `docs/ARCHITECTURE.md` (modules
      vides marqués « non commencé »), `docs/SECURITY.md` (reporting + protections + limites),
      `docs/TRADING.md` (timeout/AmbiguousOrderError + réconciliation) — tous sous git et liés à
      `AUDIT-PALLAS-v0.1.md`.
- [x] `AUDIT-PALLAS-v0.1.md` = audit réel daté (commit `813be02`), référencé publiquement.

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

| Element | Ce qu'on fait | Statut verifie |
|---------|---------------|---|
| dryRun=false par defaut | dryRun=true par defaut, confirmation "LIVE" | ✅ confirme par audit |
| `execSync` avec shell bash | sandbox bwrap + allowlist + execFile/spawn en array args | ✅ code conforme + isolation reseau verifiee par preuve reelle, fail-closed (PALLAS-M03) |
| Cle Solana en clair en memoire | Zeroing memoire | `~` affinage PALLAS-M05 : copies Buffer des cles zeroees (`toKeyBuffer`+`fill(0)`) ; strings JS non-effaçables, risque residuel documente (`docs/SECURITY.md`) |
| `skipLibCheck:true` | **false** | ✅ confirme (`tsconfig.json:8`) |
| 376 `as any` | zero tolerance | ✅ confirme : 0 occurrence dans le code actif |
| SECURITY_AUDIT.md obsolete | pas d'audit affiche sans audit reel | ✅ `AUDIT-PALLAS-v0.1.md` est un audit reel et daté |
| Badges marketing exageres | README sobre | ⚠️ pas de README suivi du tout pour l'instant (PALLAS-M06) |

---

## Estimation (recalibree post-audit)

| Phase | Duree initiale | Duree ajoutee (corrections) |
|-------|-------|---|
| 0 — Fondations | 2 sem | +3-4j (PALLAS-M01, PALLAS-M04) |
| 1 — Securite | 1 sem | +2-3j (PALLAS-M03, PALLAS-M05) |
| 2 — Polymarket | 2 sem | +4-5j (PALLAS-M02 — clôturée 2026-09-09, priorité critique levée) |
| 3 — Gateway + Agent | 2 sem | inchangee |
| 4 — Skills | 2 sem | inchangee |
| 5 — CI/CD + docs | 1 sem | +2j (PALLAS-M06) — clôturée 2026-09-09 |
| **Total MVP** | **~10 sem** | **~11.5-12 sem** |

*Publication : projet renomme **Pallas** — depot public **github.com/symbioticode/pallas**,
scope npm `@pallas/*`, prefixe d'env `PALLAS_*`.*

*Audit de reference : `AUDIT-PALLAS-v0.1.md`, commit `813be02`, 9 septembre 2026. Toute mise a jour
de ce PLAN.md doit citer la mission (`PALLAS-M0X`) qui justifie le changement de statut d'une case.*
