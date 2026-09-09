# RAPPORT D'ANALYSE — CloddsBot (alsk1992/CloddsBot)

**Date :** 2026-09-09 | **Version analysée :** 1.9.0 | **Dépôt :** 128 commits, 1 contributeur principal

---

## 1. QUALITÉ DU CODE

### 1.1 Proportion code réel vs stubs/placeholders

**Verdict : Code substantiellement fonctionnel, avec des zones d'ombre.**

Le dépôt contient **238 150 lignes de TypeScript** réparties sur **578 fichiers** dans `/src`. Ce n'est pas un squelette — c'est un gros projet. Cependant :

- **11 mentions de TODO/placeholder/stub** dans le code (peu pour un projet de cette taille, ce qui est un bon signe)
- La plupart des "placeholder" sont légitimes : UX (`placeholder="Type a message..."`) ou commentaires de code (`src/solana/pumpswap.ts:123` : "user is an inert placeholder — no accounts need to exist for a quote")

**Zones réellement incomplètes :**
- `src/evm/virtuals.ts:1022` : `// Note: This is a placeholder - actual API may require authentication` — le Virtuals Protocol n'est pas connecté à une API réelle
- `src/evm/uniswap.ts:273` : `? 0 // Accurate impact requires pool sqrtPrice; 0 is honest placeholder` — l'impact slippage est simplifié

### 1.2 Cohérence README vs implémentation

| Claim du README | Implémenté ? | Preuve |
|---|---|---|
| 119 skills | **121 dossiers** dans `src/skills/bundled/` | `ls src/skills/bundled/ | wc -l` → 121 ✓ |
| 10 prediction markets | **10 platforms** dans `src/feeds/` + `src/exchanges/` | ✓ (Polymarket, Kalshi, Betfair, Smarkets, Drift, Manifold, Metaculus, PredictIt, Opinion, Predict.fun) |
| 7 futures exchanges | **7** dans `src/exchanges/` | ✓ (binance-futures, bybit, hyperliquid, lighter, mexc, opinion, predictfun) — mais Drift et Percolator sont dans d'autres dossiers |
| 21 messaging channels | **20 dossiers** dans `src/channels/` + base-adapter | ✓ approximation raisonnable |
| 118+ trading strategies | **2 dossiers** dans `src/strategies/` (crypto-hft, hft-divergence) | **⚠️ EXAGÉRATION** — le reste est dans les skills, pas dans un module `strategies/` dédié |
| Risk engine (VaR/CVaR/circuit breaker/Kelly) | **Oui, réellement implémenté** | `src/risk/engine.ts` (485 lignes), `var.ts` (261 lignes), `circuit-breaker.ts` (462 lignes) |
| AES-256-GCM credential encryption | **Oui, réellement implémenté** | `src/credentials/index.ts:44-71` |
| Sandboxed execution | **Partiellement** | Approval gating + Docker sandbox optionnel, mais `execSync(command, {shell: '/bin/bash'})` toujours présent dans `src/agents/index.ts:16161` |

**Exagérations notables :**
- Le README affiche "skills-119+" mais le badge dit "skills-119+" et le texte oscille entre "118+" et "119+" — il y en a 121 dossiers
- Le badge `clones/14d-10.7k` et le screenshot sont du marketing (impossible à vérifier, et non pertinent pour la qualité technique)

### 1.3 Couverture des tests

**Verdict : Tests existants mais TOUJOURS en échec.**

```
# 40 fichiers de test, 10 272 lignes
find tests -name '*.test.ts' | wc -l  →  40
find tests -name '*.test.ts' -exec cat {} + | wc -l  →  10 272
```

**Exécution : 28/28 tests échouent** — tous avec `ERR_MODULE_NOT_FOUND: Cannot find package 'tsx'`. Le `npm install` lui-même échoue (`npm error code EALLOWGIT` — refus de fetcher un paquet git via SSH). **Les tests ne sont donc pas exécutables en l'état sans configuration réseau spécifique.**

**Ce que les tests couvrent** (d'après les noms de fichiers) :
- `trading-safety.test.ts` — Kelly criterion, position sizing ✓
- `unit/risk-guards.test.ts` — enforceMaxOrderSize, enforceExposureLimits ✓
- `unit/command-parsing.test.ts` — parsing des commandes chat
- `unit/backtest.test.ts` — backtesting
- `unit/opportunity-hft.test.ts`, `venue-arbitrage.test.ts` — arbitrage
- `integration/gateway-health.test.ts`, `webchat-auth.test.ts` — HTTP gateway

**Ce qui n'est PAS testé :**
- ❌ L'exécution réelle d'ordres (aucun test d'intégration exchange)
- ❌ Le risk engine complet (`src/risk/engine.ts` — 400+ lignes, 0 tests)
- ❌ Le circuit breaker (0 tests pour `src/risk/circuit-breaker.ts` ou `src/execution/circuit-breaker.ts`)
- ❌ Le chiffrement des credentials
- ❌ Les channels messaging

### 1.4 Typage TypeScript

```json
// tsconfig.json:9
"strict": true
```

**Strict mode activé ✓** mais :

- **376 occurrences de `as any`** réparties dans **134 fichiers** — c'est beaucoup
- Les pires concentrations : `src/feeds/descriptors.ts` (15+ `as any`), `src/commands/registry.ts` (12+), `src/extensions/open-prose/index.ts` (10+)
- Les fichiers de types déclaratifs `src/@types/solend-sdk.d.ts` et `marginfi-client-v2.d.ts` sont entièrement composés de `any` (SDKs sans types)
- `skipLibCheck: true` dans tsconfig — masque les erreurs dans les dépendances

---

## 2. SÉCURITÉ

### 2.1 Stockage des clés privées et API keys

**Chiffrement : AES-256-GCM ✓ réellement implémenté**

```typescript
// src/credentials/index.ts:44
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

// src/credentials/index.ts:58-71
const salt = crypto.randomBytes(16);
const key = crypto.scryptSync(encKey, salt, 32);
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
```

**Problème critique : la clé de chiffrement est un simple `process.env.CLODDS_CREDENTIAL_KEY`** (`src/credentials/index.ts:37`). Si cette variable n'est pas définie, le module log un warning mais ne crash pas — les opérations échouent silencieusement plus tard.

**Clés privées Solana en mémoire :** La clé privée est lue depuis `process.env.SOLANA_PRIVATE_KEY` et utilisée en clair dans la mémoire du processus Node.js (`src/solana/wallet.ts:12`). **Il n'y a aucun mécanisme de zeroing mémoire** — la clé reste dans le heap jusqu'à ce que le garbage collector la récupère.

```typescript
// src/solana/wallet.ts:12
const secret = config.privateKey || process.env.SOLANA_PRIVATE_KEY;
// → passée directement à Keypair.fromSecretKey() sans nettoyage
```

**Legacy v1 :** Le décrypteur supporte encore `aes-256-cbc` avec un salt fixe `"salt"` (`src/credentials/index.ts:46,102`) — migration non complète.

### 2.2 Vulnérabilités évidentes

**Injection de commandes shell — RÉSIDUELLE :**

Malgré l'audit affichant "ALL FIXED", il reste un point d'injection actif :

```typescript
// src/agents/index.ts:16161
const output = execSync(command, {
  timeout,
  encoding: 'utf-8',
  env: process.env,
  shell: '/bin/bash',  // ← INTERPRÉTATION SHELL ACTIVE
});
```

Ce code est dans le handler `exec_python` de l'agent — si un prompt injection parvient à injecter du contenu dans `command`, il sera exécuté via bash. Il y a un approval gating (`execApprovals`) mais l'efficacité dépend de la configuration.

**eval() — DÉSACTIVÉ PAR DÉFAUT mais toujours accessible :**

```typescript
// src/canvas/index.ts:135
if (msg.js && jsEvalEnabled) {
  try { eval(msg.js); } catch(e) { console.error('Canvas JS error:', e); }
}
```

Le `jsEvalEnabled` est contrôlé par `CANVAS_ALLOW_JS_EVAL=true` — désactivé par défaut ✓. Mais le code `eval()` est présent et fonctionnel si activé, sans sandboxing significatif.

**`start_bot` écrit du code Python dans /tmp puis l'exécute :**

```typescript
// src/agents/index.ts:16190-16200
if (script.includes('\n') || script.startsWith('import ') || script.startsWith('from ')) {
  const tempFile = join('/tmp', `clodds_bot_${botId}.py`);
  writeFileSync(tempFile, script);
  cmd = `python3 ${tempFile} ${args}`;
}
const proc = spawn('bash', ['-c', cmd], { ... });
```

N'importe quel contenu injecté dans `script` sera exécuté via `bash -c`. L'approval gating s'applique mais la surface d'attaque est grande.

### 2.3 AUDIT.md et SECURITY_AUDIT.md

**AUDIT.md** (`AUDIT.md`) : Document de 47 lignes daté du 5 fév 2026. C'est un **vrai audit interne** — il liste des findings concrets corrigés (LanceDB embeddings, Kamino SDK fixes, futures API fixes). Pas du marketing.

**SECURITY_AUDIT.md** (`docs/SECURITY_AUDIT.md`) : Plus structuré (308 lignes). Affiche "0 vulnerabilities" — **c'est obsolète**. `npm audit` montre actuellement **68 vulnérabilités** (23 moderate, 44 high, 1 critical). Le document dit "fixed" mais de nouvelles CVE sont apparues depuis.

**SECURITY.md** (`SECURITY.md`) : Politique de reporting standard. Note la version supportée comme `0.1.x` alors que la version actuelle est `1.9.0` — incohérence mineure.

### 2.4 Risk Engine — réellement implémenté et testé ?

**Implémenté : OUI, de manière substantielle.**

```typescript
// src/risk/engine.ts:168-407 — 240 lignes de logique métier
function validateTrade(request: TradeRequest): RiskDecision {
  // 1. Kill switch
  // 2. Circuit breaker
  // 3. Max order size
  // 4. Exposure limits
  // 5-7. Daily loss, drawdown, concentration
  // 8. VaR limit
  // 9. Volatility regime
  // 10. Kelly sizing
}
```

- VaR/CVaR : `src/risk/var.ts` — historical VaR + parametric VaR + CVaR ✓
- Circuit breaker : Deux implémentations (`src/risk/circuit-breaker.ts` et `src/execution/circuit-breaker.ts`) — redondant mais fonctionnel
- Volatility regime : `src/risk/volatility.ts`
- Stress testing : `src/risk/stress.ts`
- Kelly sizing : `src/trading/kelly.ts`

**Testé : NON.** Aucun test ne cible `src/risk/engine.ts`, `src/risk/var.ts`, ou les circuit breakers. Les seuls tests risk-related sont `tests/unit/risk-guards.test.ts` qui teste uniquement `enforceMaxOrderSize` et `enforceExposureLimits` (les fonctions utilitaires, pas le moteur complet).

---

## 3. MATURITÉ DU PROJET

### 3.1 Historique des commits

- **128 commits** depuis le 10 fév 2026 (date du premier commit)
- **1 seul contributeur** : `alsk1992` (104 commits) + ses aliases (`AL`: 20, `ALSK`: 2) + 2 dependabot
- **Rythme actif** : 128 commits en 7 mois, 45 commits depuis juin 2026
- **Commits de grande taille** récents : fix Drift, fix Kamino, fix Raydium, fix Orca, fix Jupiter — corrections d'intégration SDK après le hackathon
- Les commits récents montrent un pattern : le code initial du hackathon avait de **nombreuses intégrations SDK cassées** qui ont été corrigées dans les mois suivants

### 3.2 Issues et PRs ouvertes (20 issues analysées)

Les issues révèlent :
- **#62** : "Has someone actually made profit using this ?" — question fondamentale sur l'utilité réelle
- **#106** : "Retired Claude model ids" — problème d'obsolescence des modèles
- **#105** : "fail-closed cross-oracle preflight in RiskEngine" — proposition d'amélioration sécurité
- **#41** : "scope boundaries for multi-venue autonomy, venue-failover semantics, kill-switch hierarchy" — questions d'architecture sérieuses
- **#30** : "How does risk management scale across 1000+ markets?" — question sur la scalabilité

**Pas de bugs signalés de "pertes d'argent" ou "crashes de trading"** — ce qui peut signifier soit que le projet n'est pas utilisé en production réelle, soit que les utilisateurs ne rapportent pas.

### 3.3 Activité post-hackathon

Le projet **a été maintenu activement après le hackathon** (fév 2026 → sept 2026). Les 45 commits depuis juin 2026 montrent un effort continu de correction et d'ajout de features (PumpSwap, Robinhood Chain, audit npm).

---

## 4. RISQUES POUR UN UTILISATEUR

### 4.1 Risques financiers concrets

1. **Clé privée Solana en clair en mémoire** — aucun zeroing, accessible via heap dump si le processus est compromis
2. **`execSync` avec `shell: '/bin/bash'`** dans le handler agent — prompt injection possible → exécution de code arbitraire → vol de fonds
3. **Le risk engine n'est pas testé** — les protections VaR/CVaR/kelly pourraient avoir des bugs silencieux
4. **`dryRun` n'est PAS le défaut partout** :
   - `src/credentials/index.ts:334` : `dryRun: process.env.DRY_RUN === 'true'` — **false par défaut**
   - `src/gateway/index.ts:638` : `dryRun: config.trading.dryRun ?? false` — **false par défaut**
   - Les exchanges (Hyperliquid, Bybit, MEXC, Binance) lisent `DRY_RUN` depuis l'env — **false par défaut**
   - Seuls certains exchanges (Percolator, optionnel Copy Trading) default à true
5. **`npm install` échoue** sans SSH access au repo `whiskeysockets/libsignal-node` — le projet ne build pas proprement

### 4.2 Dépendances tierces

```
npm audit: 68 vulnerabilities (23 moderate, 44 high, 1 critical)
```

- **1 critical** : non identifié précisément dans le dump tronqué, mais présent
- **`@whiskeysockets/baileys`** (WhatsApp) dépend de `libsignal` via git SSH — **impossible à installer sans clé SSH GitHub**
- **`@project-serum/anchor`** (obsolète, remplacé par `@coral-xyz/anchor`) — présent en double
- **`express` ^4.18** — dernière version majeure 4.x, pas encore sur Express 5
- **`tmi.js` ^1.8** — paquet non maintenu depuis 2021

### 4.3 Dry-run — est-ce le défaut partout ?

**NON.** L'analyse montre clairement :

| Module | Défaut dryRun |
|---|---|
| Exchanges (Hyperliquid, Bybit, MEXC, Binance, Opinion, PredictFun) | `process.env.DRY_RUN === 'true'` → **false** |
| Gateway trading | `config.trading.dryRun ?? false` → **false** |
| Opportunity executor | `dryRun: true` ✓ |
| Percolator skill | `PERCOLATOR_DRY_RUN !== 'false'` → **true** ✓ |
| Copy trading (sans execution service) | **true** ✓ |
| Arbitrage execution | `config.arbitrageExecution?.dryRun ?? false` → **false** |

**Un utilisateur qui fait `npm install -g clodds && clodds start` avec ses clés API aura des trades RÉELS par défaut sur la plupart des plateformes.**

---

## 5. CONCLUSION

### Score de confiance : 3/10

**Raisonnement :**

**Points positifs (justifie un score > 0) :**
- Code substantiel et fonctionnel (~238K lignes, pas un stub)
- Risk engine réellement implémenté avec VaR, CVaR, Kelly, circuit breaker
- Chiffrement AES-256-GCM réel pour les credentials
- Sanitizer d'entrée robuste (homoglyphes, zero-width, prompt injection patterns)
- Projet maintenu activement après le hackathon
- Strict TypeScript activé

**Points négatifs (justifie un score << 5) :**
- **0/28 tests passent** — les tests sont littéralement inéxécutables
- **68 vulnerabilities npm** dont 1 critical, 44 high — l'audit affiché est obsolète
- **dryRun=false par défaut** sur la plupart des exchanges → trades réels immédiats
- **execSync avec shell bash** dans le handler agent — surface d'attaque pour prompt injection
- **Clé privée Solana en clair en mémoire** sans zeroing
- **1 seul contributeur** — facteur de risque bus factor = 1
- **npm install échoue** sans SSH GitHub (libsignal)
- **376 `as any`** dans 134 fichiers — malgré le strict mode
- Le risk engine n'est pas testé du tout

### Recommandation

**À ÉVITER pour du trading avec de l'argent réel.**

Le projet est impressionnant en tant que démonstration technique et pour un hackathon, mais présente des risques financiers concrets :

1. **Ne pas connecter de vraies clés API/.wallet** sans audit préalable
2. **Le mode dry-run doit être FORCÉ** via `DRY_RUN=true` dans `.env`
3. **Le code d'exécution shell dans l'agent** (`execSync` avec bash) est un vecteur d'attaque sérieux
4. **Les tests doivent être réparés** avant toute utilisation — leur échec total signifie que rien n'est vérifié
5. **Les dépendances vulnérables** doivent être mises à jour avant tout usage en production

**Si vous voulez l'utiliser pour du trading :** fork le projet, fix `npm audit`, force `DRY_RUN=true` partout, ajoute des tests pour le risk engine, et audit le code d'exécution shell. Comptez plusieurs semaines de travail supplémentaire.
