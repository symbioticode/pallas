# Audit approfondi de Pallas v0.2

**Date de l'audit :** 9 septembre 2026  
**Dépôt audité :** `/home/andrei/Projects/80_PALLAS/pallas`  
**Branche :** `main`  
**HEAD :** `70b48812ebf7d2a2133f5bd374af2f1ab884fd8d` — `Credentials/memoire: zeroing honnete des buffers de cle privee + risque residuel documente (PALLAS-M05)`  
**Objet réel :** HEAD plus modifications indexées/non indexées présentes au moment de l'audit.  
**Exclusion demandée :** `docs/mission/` n'a été ni lu ni parcouru par les recherches de cet audit.

## Synthèse exécutive

Les corrections postérieures au rapport v0.1 sont substantielles. Le risk engine rejette désormais la sonde adversariale, transporte son état, possède un vrai kill switch, franchit correctement `Open → HalfOpen → Closed`, traite les `NaN` sans panic et valide ses réponses côté TypeScript. La signature EIP-712, les montants BUY/SELL et les authentifications CLOB L1/L2 ont également été réécrits et beaucoup mieux testés.

Le dépôt ne satisfait toutefois toujours pas son exigence bloquante : `npm install && npm run build && npm test` termine avec un code 1. La suite compte **99 tests TS : 96 réussis, 3 échoués**, plus une erreur non gérée. Rust compte désormais **50/50 tests verts**, aucun ignoré, et atteint **95,92 % de couverture lignes**.

Deux affirmations importantes du PLAN restent fausses dans l'arbre audité : la suite TS et les neuf tests sandbox ne sont pas verts ; l'isolation réseau n'est pas prouvée sur cet environnement. Le correctif transforme bien l'échec d'initialisation bwrap en erreur fail-closed, mais bwrap ne peut toujours pas initialiser son namespace réseau ici.

Enfin, le wire d'ordre V2 Pallas omet `taker`, présent dans les clients V2 officiels actuels. Ce défaut est masqué par des tests locaux construits autour du même modèle incomplet. La porte live interne reste heureusement fermée (`signatureSchemaValidated = false`), de sorte que ce payload ne peut pas être émis par `placeOrder` sans modification explicite du code.

**Verdict : fondations solides mais incomplètes.** Pallas a quitté l'état de « prototype fragile » du v0.1 sur ses briques sécurité/risk, mais n'est pas encore prêt pour un dry-run réel de bout en bout : gateway, agent, tool wiring et ledger n'existent pas, la suite obligatoire est rouge et le contrat d'ordre live n'est pas validé.

---

## 1. Vérification des affirmations du PLAN.md

### 1.1 Chaîne npm exigée

Commande réellement exécutée à la racine :

```text
npm install && npm run build && npm test
```

Résultat :

| Étape | Résultat | Détail |
|---|---|---|
| `npm install` | succès | arbre à jour ; avertissement : script postinstall `esbuild@0.28.2` bloqué par `allowScripts` |
| `npm run build` | succès | `tsc --build packages/core packages/risk packages/execution` |
| `npm test` | **échec** | 9 fichiers ; 99 tests : 96 réussis, 3 échoués ; 1 erreur non gérée |

Les scripts exécutés sont bien ceux annoncés dans `package.json:11-16`. Aucun test n'est affiché comme skipped/todo.

Les trois échecs sont dans `packages/execution/src/sandbox.test.ts` :

1. `execute un binaire autorise sous bwrap` (`sandbox.test.ts:38-43`) : `BwrapInitError`, car bwrap renvoie `loopback: Failed to create NETLINK_ROUTE socket: Operation not permitted` ;
2. `reseau isole ... preuve reelle` (`sandbox.test.ts:45-77`) : timeout à 5 s ; l'environnement d'audit interdit même `server.listen(127.0.0.1)` avec `EPERM`, erreur non gérée ;
3. `input passe a stdin` (`sandbox.test.ts:113-120`) : même `BwrapInitError` que le premier test.

La détection explicite de l'échec bwrap est une vraie amélioration : `runSandboxed` rejette désormais tout stderr d'initialisation préfixé par `bwrap:` (`packages/execution/src/sandbox.ts:222-240`). Il ne s'agit plus d'un faux succès de sécurité. En revanche, le PLAN affirme « Tests sandbox : 9/9 verts. Suite TS : 84/84 » (`PLAN.md:190-211`) alors que l'exécution actuelle donne 6/9 sandbox et 96/99 globalement.

Le PLAN conserve aussi plusieurs compteurs historiques contradictoires : 37 tests/92,17 % puis 50 tests dans la même case (`PLAN.md:131-135`), 66 tests rouges dans l'état audité antérieur (`PLAN.md:144-149`), 84 tests verts pour M03 (`PLAN.md:211`) et une migration Vitest dite encore rouge à 66 tests (`PLAN.md:262-263`). Aucun de ces compteurs ne décrit seul l'état actuel.

### 1.2 Tests Rust

Commande réellement exécutée dans le shell Nix :

```text
nix-shell --run 'cd crates/risk-engine && cargo test -- --show-output'
```

Résultat :

- 35 tests unitaires : réussis ;
- 12 tests d'intégration CLI : réussis ;
- 3 property tests : réussis ;
- total : **50 réussis, 0 échoué, 0 ignoré** ;
- les trois property tests signalent encore que `FileFailurePersistence::SourceParallel` ne trouve pas `lib.rs`/`main.rs`, ce qui peut empêcher la persistance d'un cas minimal futur.

L'ancien chiffre « 37 tests Rust » est donc obsolète ; l'affirmation plus récente « 50 tests verts » de `PLAN.md:135` est exacte.

### 1.3 Couverture Rust recalculée

La commande suivante a été exécutée avec `cargo-llvm-cov` et LLVM fournis temporairement par Nix :

```text
nix-shell -p cargo-llvm-cov llvm --run \
  'cd crates/risk-engine && LLVM_COV=$(command -v llvm-cov) \
   LLVM_PROFDATA=$(command -v llvm-profdata) \
   cargo llvm-cov --all-features --workspace --summary-only'
```

| Module | Lignes | Régions | Fonctions |
|---|---:|---:|---:|
| `circuit_breaker.rs` | 100,00 % | 100,00 % | 100,00 % |
| `kelly.rs` | 98,11 % | 97,50 % | 100,00 % |
| `main.rs` | 91,03 % | 89,47 % | 57,14 % |
| `pipeline.rs` | 97,66 % | 96,70 % | 100,00 % |
| `stress.rs` | 100,00 % | 100,00 % | 100,00 % |
| `var.rs` | 91,86 % | 88,57 % | 94,74 % |
| `volatility.rs` | 92,65 % | 95,02 % | 93,33 % |
| **Total** | **95,92 %** | **94,91 %** | **94,57 %** |

L'objectif global de 90 %+ est atteint, désormais aussi en lignes pour chaque module. Le commentaire TS « testée à 100 % » reste néanmoins faux (`packages/risk/src/client.ts:1-9`).

### 1.4 CI

Une pipeline existe maintenant : job TypeScript (`npm ci`, build, typecheck, tests, audit niveau high) et job Rust (`cargo test`, audit Rust) dans `.github/workflows/ci.yml:8-39`. La case `[x]` de Phase 5 (`PLAN.md:285-291`) correspond au fichier présent.

Mais le PLAN conserve simultanément une case `[ ] CI` affirmant que le dossier ne contient qu'un `.gitkeep` (`PLAN.md:141-142`). Cette affirmation est obsolète. Surtout, la pipeline est seulement **indexée dans l'arbre de travail**, pas présente au commit HEAD, et son job TypeScript échouerait avec les résultats locaux actuels à l'étape `npm test` (`.github/workflows/ci.yml:17-24`). « CI passe du premier coup » n'est donc pas vérifié.

---

## 2. Audit de sécurité ciblé

### 2.1 Dry-run : défaut sûr, API interne encore contournable

Le défaut est sûr et cohérent :

- état global initial `true` : `packages/core/src/dry-run.ts:12-22` ;
- défaut Zod `true` : `packages/core/src/config.ts:9-13` ;
- toute valeur `DRY_RUN` autre que la chaîne exacte `false` produit `true` : `packages/core/src/config.ts:45-48` ;
- bascule live uniquement sur confirmation exacte `LIVE` : `packages/core/src/dry-run.ts:30-55` ;
- `placeOrder`, `cancelOrder` et `deriveApiKey` vérifient ce flag avant l'appel HTTP : `packages/execution/src/polymarketClient.ts:212-221,269-275,313-320`.

La recherche dans le code actif ne trouve aucun fallback `?? false` lié au dry-run. L'ancien fallback `signedOrdersValidated ?? false` a disparu.

Réserve : `PolymarketClientConfig` expose toujours `isDryRun?: () => boolean`, ensuite affecté directement au client (`packages/execution/src/polymarketClient.ts:18-31,137-142`). Tout appelant interne peut donc construire `new PolymarketClient({isDryRun: () => false})`. Sans gateway/agent, aucune politique d'assemblage n'empêche actuellement ce contournement. Il reste toutefois deux autres barrières pour `placeOrder` : gate de schéma et credentials (`polymarketClient.ts:217-230`).

### 2.2 Sandbox bwrap : fail-closed amélioré, disponibilité et preuve hôte non acquises

Conforme :

- allowlist fermée à `python3`, `python`, `node`, `ls`, `echo` (`packages/execution/src/sandbox.ts:25-26,90-96`) ;
- `bash` est explicitement rejeté par test (`packages/execution/src/sandbox.test.ts:30-36`) ;
- résolution vers un fichier régulier exécutable après `realpath/stat/X_OK` (`sandbox.ts:98-128`) ;
- `spawn` reçoit un tableau d'arguments et aucune option `shell:true` (`sandbox.ts:188-195`) ;
- `--unshare-net`, `--unshare-pid`, `--unshare-uts`, `--die-with-parent` et `--new-session` sont bien passés (`sandbox.ts:131-150`) ;
- échec d'initialisation détecté et rejeté (`sandbox.ts:222-240`).

Non conforme ou résiduel :

- bwrap est inutilisable dans l'environnement d'audit pour les appels réels ; le composant est fail-closed mais indisponible ;
- le test réseau est conceptuellement meilleur, car il exige une erreur réseau explicite et zéro requête reçue (`sandbox.test.ts:45-73`), mais il n'a pas produit cette preuve ici ;
- le test n'encadre pas l'échec de `server.listen`, d'où timeout puis exception non gérée (`sandbox.test.ts:51-58`) ;
- `PALLAS_SANDBOX_BIN` accepte tout chemin existant, sans appliquer `isRegularExecutable` à bwrap (`sandbox.ts:153-160`) ; c'est utile au test négatif, mais un environnement compromis peut substituer un faux bwrap ;
- `--ro-bind / /` protège l'écriture, pas la confidentialité : le code le documente correctement (`sandbox.ts:11-18,138`). Un programme allowlisté tel que Python/Node reste capable de lire tous les fichiers accessibles à l'utilisateur puis, si l'isolation réseau échoue, l'exécution est bloquée.

Conclusion : l'affirmation de fail-closed est confirmée ; « isolation réseau prouvée sur l'hôte actuel » ne l'est pas.

### 2.3 Credentials : chiffrement fail-closed, zeroing partiel et honnêtement documenté

Le stockage reste solide : AES-256-GCM, scrypt vers une clé de 32 octets, salt/IV aléatoires, auth tag vérifié, rejet du format legacy et erreurs explicites (`packages/core/src/credentials.ts:54-84,94-120`). La clé dérivée et le buffer plaintext temporaire sont effacés (`credentials.ts:72-77,108-116`).

La correction M05 ne peut pas rendre effaçables les chaînes JS : la passphrase source, la chaîne retournée par `decryptCredentials`, l'objet issu de `JSON.parse` et les secrets retournés par `loadPolymarketSecrets` restent en clair (`credentials.ts:129-133`; `packages/execution/src/polymarketSecrets.ts:8-12,48-52,72-80`). Le PLAN décrit maintenant explicitement cette limite (`PLAN.md:168-175`) : la case « zeroing » est acceptable uniquement avec cette portée restreinte, pas comme promesse d'absence de secrets en mémoire.

### 2.4 Ordres et authentification : primitives corrigées, wire V2 incomplet, live fermé

Les défauts cryptographiques majeurs du v0.1 sont corrigés dans le code :

- le type Order V2 comporte onze champs signés, avec `uint8` ensuite encodés en mots ABI de 32 octets (`packages/execution/src/polymarketSigner.ts:113-128,155-170`) ;
- BUY produit maker=USD/taker=shares et SELL l'inverse (`polymarketSigner.ts:409-423`) ;
- L1 ClobAuth est signé en EIP-712 (`polymarketSigner.ts:95-111,379-401`) ;
- L2 signe `timestamp + METHOD + path [+ body]` par HMAC-SHA256 et émet les cinq headers (`packages/execution/src/clobAuth.ts:23-57`) ;
- `placeOrder` et `cancelOrder` câblent ces headers (`polymarketClient.ts:223-239,269-305`).

Constat bloquant : le client V2 officiel actuel sérialise un champ `taker` dans l'objet `order`, même si `taker` n'appartient pas aux onze champs EIP-712 signés. Pallas n'a aucun champ `taker` dans `SignedOrderPayload` et ne l'émet pas (`polymarketSigner.ts:434-452,516-531`). Cette forme diverge des clients officiels TypeScript et Rust V2 ; les tests locaux ne détectent pas l'écart, car ils valident leurs propres fixtures. La case « wire V2 complet » de `PLAN.md:247-255` est donc optimiste.

Autres limites :

- `signatureSchemaValidated` est codé à `false` et aucune fonction publique ne peut le basculer (`packages/execution/src/schemaGate.ts:20-38`). Toute émission live normale est donc refusée : fail-closed confirmé, readiness live non confirmée ;
- `placeOrder(params, signed, ...)` n'utilise jamais `params` après réception (`polymarketClient.ts:212-230`). Il ne vérifie donc pas que le payload signé correspond au marché, côté, prix ou quantité que l'appelant croit envoyer ;
- seul le mode EOA est produit par défaut et le signer natif ne montre pas de prise en charge du format enveloppé `POLY_1271` des deposit wallets V2 (`polymarketSigner.ts:482-510`). Les wallets email/proxy ne sont pas validés ;
- aucun ordre ni dérivation de clé n'a été testé contre une API live/staging avec de vrais credentials. Cette absence est cohérente avec la gate fermée.

### 2.5 Patterns bannis

Recherche effectuée sur le code actif en excluant `docs/mission`, `node_modules`, `target` et les documents historiques :

| Pattern | Résultat |
|---|---|
| `as any` | 0 |
| `execSync` | 0 |
| `shell:true` | 0 |
| `skipLibCheck:true` | 0 ; `skipLibCheck:false` dans `tsconfig.json:7-9` |
| fallback `?? false` dangereux dry-run | 0 |
| secrets en clair en mémoire | oui après déchiffrement, explicitement documenté (`polymarketSecrets.ts:8-12`) |

---

## 3. Écart entre PLAN et réalité

### 3.1 Cases cochées `[x]`

| Case du PLAN | Verdict vérifié | Preuve principale |
|---|---|---|
| Monorepo/workspaces/strict | Réelle pour core/risk/execution | `package.json:5-16`, `tsconfig.json:3-16` |
| Toolchain Rust via Nix | Réelle pour build/test ; outils qualité incomplets | `shell.nix:10-20`; `cargo clippy` absent du shell |
| Risk engine CLI + tests | Réelle et nettement améliorée | 50/50 tests ; `main.rs:46-91,115-147`; `pipeline.rs:72-130` |
| Façade TS fail-closed + Zod | Réelle | `packages/risk/src/client.ts:82-110,112-157` |
| AES-GCM/scrypt, sans legacy | Réelle | `credentials.ts:54-84,94-120` |
| Zeroing | Partielle, portée désormais décrite honnêtement | `credentials.ts:76-77,108-116`; `polymarketSecrets.ts:8-12` |
| Dry-run global + confirmation LIVE | Réelle, avec injection interne contournable | `dry-run.ts:12-22,36-55`; `polymarketClient.ts:18-31,137-142` |
| Sandbox bwrap | Code réel et fail-closed ; indisponible sur cet hôte | `sandbox.ts:131-150,170-240`; tests actuels rouges |
| Isolation réseau prouvée | **Non vérifiée dans cet audit** | test timeout/EPERM, `sandbox.test.ts:45-77` |
| Sanitizer/Set/tests | Réelle mais toujours isolée | Phase 3 absente ; `PLAN.md:213-219` |
| Client CLOB reads/writes | Réel, mais write volontairement gate et wire incomplet | `polymarketClient.ts:185-267` |
| Retry/backoff | Réel pour GET et DELETE ; aucun retry POST par conception | `polymarketClient.ts:145-170,241-250,277-305` |
| Validation runtime CLOB | Réelle sur les réponses testées | `polymarketClient.ts:185-203,254-260`; imports schemas `:7-14` |
| Stockage secrets Polymarket | Réel | `polymarketSecrets.ts:36-80` |
| Auth API L1/L2 | Implémentée et testée localement, pas vérifiée live | `clobAuth.ts:23-69`; `polymarketClient.ts:223-239,313-330` |
| Signature CLOB V2 complète | **Partielle : EIP-712 corrigé, wire sans `taker`** | `polymarketSigner.ts:434-452,516-531` |
| Tests signer contre références | Réels pour digest/signature EOA ; insuffisants pour le wire complet | noms de tests dans `polymarketSigner.test.ts`; divergence officielle `taker` |
| Build references/pretest/Vitest | Build réel ; suite globale rouge | `package.json:11-16`; exécution 96/99 |
| CI Pipeline | Fichier réel dans l'index, mais non démontré vert | `.github/workflows/ci.yml:8-39` |
| Documentation sobre | Fichiers présents/indexés ; affirmation « tous sous git » pas encore vraie au HEAD | état git : fichiers ajoutés/modifiés non commités |
| Audit v0.1 | Réel | `docs/AUDIT-PALLAS-v0.1.md` |

### 3.2 Cases non cochées `[ ]`

- La case CI de Phase 0 (`PLAN.md:141-142`) est devenue obsolète : il existe une CI, mais elle n'est pas verte avec la suite actuelle.
- Gateway : aucun package `packages/gateway` substantiel ; serveur Fastify, auth, rate limiting, health et WebChat non commencés (`PLAN.md:267-274`). Les valeurs de configuration gateway existent déjà (`packages/core/src/config.ts:22-35,49-54`) : c'est un début de contrat, pas une implémentation.
- Agent : connexion Claude, tools et branchement sanitizer inexistants (`PLAN.md:274-277`).
- Ledger : aucune implémentation (`PLAN.md:278`).
- Skill loader et skill Polymarket : aucun code substantiel (`PLAN.md:280-283`).
- L'intégration complète agent → sanitizer → risk state persistant → signature → execution → ledger n'existe donc pas.

### 3.3 Contradictions internes du PLAN

Le PLAN mélange état historique et état courant dans les mêmes sections. Les contradictions les plus importantes sont :

- CI `[ ]` absente à `PLAN.md:141-142`, puis CI `[x]` faite à `PLAN.md:285-291` ;
- 37 tests/92,17 % et 50 tests dans `PLAN.md:131-135`, alors que la mesure actuelle est 50 tests/95,92 % lignes ;
- sandbox annoncé 9/9 et TS 84/84 (`PLAN.md:211`), alors que l'exécution est 6/9 sandbox et 96/99 globalement ;
- migration Vitest encore décrite comme 66 tests rouges (`PLAN.md:262-263`) ;
- README décrit l'isolation réseau comme « prouvée » (`README.md:17`), non reproduite ici.

Ces incohérences n'affectent pas directement le runtime, mais elles rendent le PLAN impropre comme source de vérité de release.

---

## 4. Qualité du code et risques structurels

### 4.1 Rust

Points forts :

- séparation claire des modules, zéro `unsafe` trouvé ;
- validation métier anticipée et fail-closed (`pipeline.rs:72-130`) ;
- vrai kill switch court-circuitant (`pipeline.rs:101-114`) ;
- état sérialisé/restauré pour circuit breaker et volatilité (`main.rs:46-91`) ;
- 50 tests, property tests et couverture élevée ;
- le tri VaR n'utilise plus de `partial_cmp(...).unwrap()` et un test explicite traite NaN.

Risques restants :

- la cohérence `est_value_usd ≈ price × quantity` n'est pas validée dans la liste des bornes (`pipeline.rs:82-93`). Un appelant peut présenter une valeur estimée artificiellement faible pour franchir `POSITION_LIMIT`, qui ne regarde que `est_value_usd` (`pipeline.rs:162-175`) ;
- le gate Kelly vérifie seulement `est_value_usd <= bankroll_usd`, pas `est_value_usd <= recommended_size` (`pipeline.rs:193-200`). Le moteur peut donc autoriser une taille supérieure à son sizing Kelly et seulement suggérer une taille plus basse ; l'appelant doit impérativement respecter la suggestion ;
- la persistance d'état est déléguée à l'appelant (`main.rs:18-19,117-145`) : comme gateway/ledger n'existent pas, aucune persistance durable/atomique n'est fournie ;
- les erreurs `stdout.write_all` sont ignorées (`main.rs:168-173`) ;
- quelques `unwrap()` subsistent uniquement dans la construction des messages d'erreur (`main.rs:150-176`) et dans les tests ; ils sont peu susceptibles de paniquer, mais évitables ;
- `cargo clippy --all-targets --all-features -- -D warnings` n'a pas pu s'exécuter : `cargo-clippy` n'est pas inclus dans `shell.nix`.

### 4.2 TypeScript

Points forts : strict mode réel, `skipLibCheck:false`, absence de `any`, schémas Zod aux frontières Rust/HTTP, gestion explicite timeout/exit et distinction d'un POST ambigu.

Risques :

- `placeOrder` reçoit deux représentations de l'intention (`params` et `signed`) mais n'en compare aucune (`polymarketClient.ts:212-230`) ;
- l'injection `isDryRun` est publique dans le constructeur (`polymarketClient.ts:18-31`) ;
- l'override `PALLAS_RISK_BIN` n'exige qu'`existsSync`, pas un fichier régulier/exécutable ou un chemin approuvé (`packages/risk/src/client.ts:69-79`) ; contrairement au sandbox, la façade risk peut donc lancer tout binaire pointé par l'environnement du processus ;
- le test réseau crée une ressource asynchrone sans handler `error`, puis attend un callback qui ne vient jamais en cas d'EPERM (`sandbox.test.ts:51-58`) ;
- `deriveApiKey` parse le JSON même si la réponse HTTP est 4xx/5xx, sans vérifier `res.ok` (`polymarketClient.ts:313-330`) ; l'erreur devient une erreur de schéma au lieu d'une erreur HTTP explicite ;
- l'état risk n'est pas maintenu par `validateTrade`, qui retourne seulement la décision ; l'appelant doit choisir `validateTradeWithState` puis persister le state (`packages/risk/src/client.ts:160-180`). Cette API double augmente le risque de perdre l'état de sécurité.

### 4.3 Dépendances

`npm audit --json` a été exécuté :

- 0 critique, 0 haute, 2 modérées ;
- Vitest 3.2.7 et `@vitest/mocker` sont concernés par `GHSA-82fw-gwwq-j7x9`, path traversal/lecture arbitraire ;
- npm propose Vitest 5.0.0, changement majeur ;
- le défaut est dev-only dans ce dépôt, donc ne constitue pas une vulnérabilité du binaire de trading, mais reste pertinent sur des runners CI exposés à des tests non fiables.

Versions crypto verrouillées : `@noble/curves` 1.9.7 et `@noble/hashes` 1.8.0 (`package-lock.json:491-507`). `npm audit` ne remonte aucune vulnérabilité pour elles. Pallas n'utilise pas le SDK CLOB comme dépendance runtime ; il réimplémente le protocole, ce qui réduit la surface de dépendances mais augmente le risque de dérive de schéma, illustré par `taker`.

`cargo audit` a été exécuté via Nix contre la base RustSec mise à jour : 48 dépendances analysées, **aucune vulnérabilité signalée**, code de sortie 0.

---

## 5. Verdict final

### Niveau

**Fondations solides mais incomplètes.**

Le passage depuis « prototype fragile » est justifié par les corrections effectives du risk engine, des frontières Zod, du fail-closed bwrap et des primitives de signature/authentification. Le niveau « prêt pour dry-run réel » n'est toutefois pas atteint : la chaîne obligatoire est rouge, le sandbox n'est pas opérationnel sur l'environnement testé et il n'existe aucun flux MVP complet gateway/agent/risk/execution/ledger.

Le niveau « prêt pour capital réel » est nettement exclu : la gate de schéma live est volontairement fermée, le wire V2 diverge du client officiel, aucun credential/wallet live n'a été testé et aucune réconciliation durable des ordres ambigus n'est implémentée.

### Trois risques prioritaires avant LIVE

1. **Contrat CLOB live non prouvé et wire V2 incomplet.** Ajouter `taker` au payload selon le client officiel courant, comparer le JSON complet à au moins deux clients officiels, vérifier les variantes EOA/proxy/POLY_1271 nécessaires, puis réaliser un probe contrôlé avant de modifier `signatureSchemaValidated` (`polymarketSigner.ts:434-452,516-531`; `schemaGate.ts:20-38`).
2. **Absence de chaîne transactionnelle et de persistance de sécurité.** Construire un seul chemin d'ordre qui conserve atomiquement le state risk, impose `suggested_size_usd`, rapproche les POST ambigus et écrit un ledger avant toute nouvelle tentative. Aujourd'hui, le moteur délègue l'état à un appelant inexistant (`main.rs:18-19`; `packages/risk/src/client.ts:160-180`).
3. **Barrières non reproductibles dans la CI/environnement cible.** Obtenir `npm test` vert sans faux skip, rendre le test réseau robuste aux erreurs de bind, prouver bwrap sur l'hôte de déploiement et faire passer la CI depuis un checkout propre avant toute activation LIVE (`sandbox.test.ts:38-77,113-120`; `.github/workflows/ci.yml:8-39`).

### Éléments non vérifiables dans cet audit

- acceptation d'un ordre V2 par l'API CLOB réelle ;
- validité/permissions d'une API key Polymarket réelle ;
- contrôle d'un wallet Ethereum/Polygon financé, allowances USDC/CTF et identité maker/funder ;
- fonctionnement des comptes email/proxy/POLY_1271 ;
- exécution réelle de GitHub Actions, le workflow étant seulement présent dans l'arbre local ;
- contenu et preuves internes de `docs/mission/`, volontairement exclus à la demande.

---

## Sources

1. Dépôt local Pallas, fichiers et lignes cités dans le corps, arbre de travail du 9 septembre 2026.
2. Polymarket, [client TypeScript CLOB V2 — sérialisation `ordersV2.ts`](https://github.com/Polymarket/clob-client-v2/blob/main/src/types/ordersV2.ts), consulté le 9 septembre 2026.
3. Polymarket, [client Python CLOB V2 — typed data et signature Order V2](https://github.com/Polymarket/py-clob-client-v2/blob/main/py_clob_client_v2/order_utils/exchange_order_builder_v2.py), consulté le 9 septembre 2026.
4. Polymarket, [client Rust CLOB V2 — types et sérialisation d'ordre](https://github.com/Polymarket/rs-clob-client-v2/blob/main/src/clob/types/mod.rs), consulté le 9 septembre 2026.
5. GitHub Advisory Database, [GHSA-82fw-gwwq-j7x9 — Vitest path traversal/arbitrary file read](https://github.com/advisories/GHSA-82fw-gwwq-j7x9), consulté via `npm audit` le 9 septembre 2026.
6. RustSec Advisory Database, base mise à jour et interrogée par `cargo audit` le 9 septembre 2026.
