# Audit approfondi de Pallas v0.1

**Date de l'audit :** 9 septembre 2026  
**Dépôt audité :** `/home/andrei/Projects/80_PALLAS/pallas`  
**Branche :** `main`  
**Commit :** `813be02` — `Phase 2.2: signature CLOB EIP-712 + fail-closed placeOrder`

## Synthèse exécutive

Le `PLAN.md` est nettement trop optimiste.

- TypeScript : build vert, mais tests rouges — 64 réussites, 2 échecs, 66 tests au total.
- Rust : 37/37 tests verts, aucun ignoré.
- Couverture Rust : 92,17 % des lignes, donc objectif global atteint.
- Le sandbox réseau produit un faux positif : bwrap échoue avant d'exécuter le programme.
- Le risk engine accepte des entrées manifestement invalides et plusieurs de ses protections annoncées ne sont pas connectées à l'état réel.
- La signature Polymarket est incompatible avec EIP-712 standard et les montants BUY/SELL sont inversés.
- Le stockage est chiffré correctement, mais l'affirmation de zeroing des secrets en mémoire est fausse.
- Aucune intégration complète gateway → agent → risk → execution n'existe.

**Verdict : prototype fragile**, pas encore « prêt pour dry-run réel ».

---

## 1. Vérification des affirmations du PLAN

### Chaîne npm demandée

Commande réellement exécutée :

```text
npm install && npm run build && npm test
```

Résultat :

- `npm install` : succès, installation déjà à jour.
- `npm run build` : succès.
- `npm test` : échec.
- 9 fichiers de tests.
- 66 tests : 64 réussis, 2 échoués, 0 explicitement ignoré.

Échecs :

1. `execute un binaire autorise sous bwrap`
2. `input passe a stdin`

Les deux assertions attendent `exitCode === 0` dans `packages/execution/src/sandbox.test.ts:24-47`, mais reçoivent 1.

Cause reproduite indépendamment :

```text
bwrap: loopback: Failed to create NETLINK_ROUTE socket: Operation not permitted
```

L'affirmation « 47 tests TS, 7 fichiers » de `PLAN.md:206` est obsolète. Le bas du même PLAN parle d'ailleurs de 66 tests, mais les dit tous verts, ce qui est également faux.

`npm run typecheck` et `npm run build` réussissent. Attention toutefois : `typecheck` utilise `tsc --build --dry` dans `package.json:13-16`. Ce mode décrit ce qui serait construit ; ce n'est pas le contrôle le plus robuste sur un arbre dont les artefacts sont déjà à jour. Le build réel a néanmoins réussi.

### Rust

Commande exécutée dans le shell Nix :

```text
nix-shell --run 'cd crates/risk-engine && cargo test -- --show-output'
```

Résultat :

- 28 tests unitaires : verts.
- 6 tests d'intégration CLI : verts.
- 3 property tests : verts.
- Total : **37 réussis, 0 échoué, 0 ignoré**.
- Un avertissement `unused doc comment` dans `crates/risk-engine/tests/properties.rs:5`.
- Les tests proptest signalent que leur mécanisme de persistance des cas d'échec ne trouve pas `lib.rs` ou `main.rs`. Cela n'invalide pas l'exécution présente, mais empêcherait probablement la conservation automatique d'un cas minimal défaillant.

L'affirmation 37 tests Rust verts est correcte.

### Couverture Rust réelle

Mesure effectuée avec `cargo-llvm-cov 0.8.5` et LLVM 21.1.8 :

| Module | Lignes | Régions |
|---|---:|---:|
| `circuit_breaker.rs` | 91,09 % | 92,92 % |
| `kelly.rs` | 98,11 % | 97,50 % |
| `main.rs` | 77,27 % | 78,31 % |
| `pipeline.rs` | 96,20 % | 94,36 % |
| `stress.rs` | 100 % | 100 % |
| `var.rs` | 91,41 % | 87,69 % |
| `volatility.rs` | 86,84 % | 90,06 % |
| **Total** | **92,17 %** | **91,25 %** |

L'objectif global « 90 %+ » est atteint. Il ne l'est pas module par module, notamment sur l'interface CLI et la volatilité.

---

## 2. Audit de sécurité ciblé

### Dry-run

Le défaut global est réellement sûr :

- état initial `true` dans `packages/core/src/dry-run.ts:12` ;
- schéma Zod avec défaut `true` dans `packages/core/src/config.ts:9-13` ;
- absence de `DRY_RUN` interprétée comme `true` dans `packages/core/src/config.ts:45-48` ;
- confirmation exacte `"LIVE"` imposée dans `packages/core/src/dry-run.ts:36-45` ;
- `placeOrder` et `cancelOrder` vérifient le flag avant leur premier `fetch` dans `packages/execution/src/polymarketClient.ts:165-191`.

Le seul `?? false` actif est :

```ts
this.signedOrdersValidated = config.signedOrdersValidated ?? false;
```

dans `packages/execution/src/polymarketClient.ts:104`. C'est un fallback sécurisé et ne concerne pas le dry-run.

Réserve importante : le constructeur autorise l'injection directe de `isDryRun: () => false` et de `signedOrdersValidated: true` via `packages/execution/src/polymarketClient.ts:5-17`. Ce mécanisme facilite les tests, mais constitue aussi une API permettant de contourner les gardes globales à n'importe quel appelant interne.

### Sandbox bwrap

Points réellement corrects :

- allowlist limitée à `python3`, `python`, `node`, `ls`, `echo` : `packages/execution/src/sandbox.ts:19-20` ;
- pas de bash/sh ;
- `spawn` sans `shell:true` : `packages/execution/src/sandbox.ts:150-154` ;
- arguments bwrap comprenant `--unshare-net` et `--die-with-parent` : `packages/execution/src/sandbox.ts:96-104` ;
- absence de `execSync` ou de `shell:true` dans le code exécutable.

Mais l'affirmation « isolation réseau vérifiée par test » est fausse. Sur cet hôte, **toutes** les invocations bwrap échouent lors de la création du namespace réseau. Le test réseau se contente de vérifier un code non nul ; il passe donc même si le programme protégé n'a jamais démarré. C'est un faux positif de sécurité.

Autres faiblesses :

- `sandboxed: true` signifie seulement que bwrap a été tenté, même lorsqu'il échoue avant isolation : `packages/execution/src/sandbox.ts:181-190`.
- La résolution PATH vérifie uniquement `existsSync`, pas que la cible soit un exécutable régulier fiable : `packages/execution/src/sandbox.ts:81-94`.
- `PALLAS_SANDBOX_BIN` accepte n'importe quel chemin existant : `packages/execution/src/sandbox.ts:118-125`.
- Toute la racine `/` est montée en lecture seule dans le sandbox : `packages/execution/src/sandbox.ts:103`. Cela empêche l'écriture, mais ne protège pas la confidentialité des fichiers lisibles par le processus.

### Credentials : chiffrement oui, zeroing non

Correct :

- AES-256-GCM : `packages/core/src/credentials.ts:15` ;
- salt et IV aléatoires : `packages/core/src/credentials.ts:68-69` ;
- scrypt vers 32 octets : `packages/core/src/credentials.ts:52-55` ;
- tag GCM utilisé au déchiffrement : `packages/core/src/credentials.ts:106-108` ;
- absence de clé et format legacy rejetés : `packages/core/src/credentials.ts:92-100`.

L'affirmation « zeroing mémoire » de `PLAN.md:151` est cependant trompeuse :

- seule la clé dérivée et un buffer déchiffré temporaire sont effacés ;
- la passphrase est une `string`, donc non effaçable ;
- le plaintext est transformé en `string` avant le zeroing : `packages/core/src/credentials.ts:110-114` ;
- `JSON.parse` crée ensuite un objet contenant les secrets comme chaînes ordinaires : `packages/core/src/credentials.ts:127-131` ;
- `loadPolymarketSecrets` retourne durablement `apiKey`, `apiSecret` et `walletPrivateKey` en clair : `packages/execution/src/polymarketSecrets.ts:70-77` ;
- les conversions de clé privée en `Buffer` dans le signer ne sont jamais effacées : `packages/execution/src/polymarketSigner.ts:161-174`.

Le format de stockage est bien chiffré et fail-closed ; la gestion en mémoire ne l'est pas au niveau annoncé.

### Ordres signés : implémentation actuellement incorrecte

C'est le constat le plus critique de l'audit.

1. Le séparateur de domaine EIP-712 omet le `typeHash` de `EIP712Domain` et hache directement les quatre valeurs : `packages/execution/src/polymarketSigner.ts:127-134`.

   Probe indépendante :

   ```text
   implémenté : ca8be5cc…fcc5895
   standard   : 1a573e36…4d151be
   equal      : false
   ```

2. `signatureType`, déclaré `uint8`, est encodé sur un octet par `toBytesU8`, alors que chaque champ atomique EIP-712 doit occuper un mot ABI de 32 octets : `packages/execution/src/polymarketSigner.ts:112-114, 136-152`.

3. Les montants maker/taker sont inversés :

   ```text
   BUY  actuel : makerAmount=10,000,000 ; takerAmount=5,500,000
   SELL actuel : makerAmount=5,500,000  ; takerAmount=10,000,000
   ```

   Le calcul fautif est dans `packages/execution/src/polymarketSigner.ts:280-284`. Pour un BUY, le maker fournit normalement le montant monétaire et reçoit les tokens ; pour un SELL, l'inverse.

4. Les tests vérifient seulement déterminisme et récupération avec la même implémentation. Ils ne confrontent jamais les hashes à des vecteurs de référence officiels ou à un client CLOB reconnu.

5. `signedOrdersValidated` est un booléen fourni par l'appelant, pas une preuve cryptographique ni une constante de build contrôlée : `packages/execution/src/polymarketClient.ts:97-105`.

6. `placeOrder` et `cancelOrder` n'ajoutent aucune authentification CLOB dans leurs headers : `packages/execution/src/polymarketClient.ts:172-177, 187-195`. `signApiCreds` existe mais n'est relié à aucun appel réseau.

Conclusion : la case « Signature CLOB des ordres » ne devrait pas être cochée.

### Patterns bannis

Dans le code source actif :

- `as any` : **0** ;
- `execSync` : **0** ;
- `shell:true` : **0** ;
- `skipLibCheck:true` : **0** ; il est explicitement `false` dans `tsconfig.json:8` ;
- `?? false` dangereux pour dry-run : **0** ;
- clés en clair : oui, après déchiffrement et pendant la signature, comme expliqué ci-dessus.

Les occurrences historiques dans `ANALYSE-CLODDSBOT.md` et `FICHE-LECONS.md` ne sont pas du code actif.

---

## 3. Écart entre PLAN et réalité

### Cases `[x]`

| Affirmation cochée | Verdict |
|---|---|
| Monorepo/workspaces/strict | Réelle pour `core`, `risk`, `execution` ; gateway/agent/ledger ne sont que des répertoires vides. |
| Toolchain Rust via Nix | Réelle ; tests compilés avec linker fourni. |
| Façade TS risk fail-closed | Partielle : processus/exit non nul sont bien bloquants, mais aucune validation runtime du schéma JSON ; tout JSON sans `error` est casté aveuglément dans `packages/risk/src/client.ts:73-90`. |
| AES-GCM/scrypt, sans legacy | Réelle. |
| Zeroing mémoire | Faux/partiel : buffers temporaires seulement, pas les chaînes contenant passphrase et secrets. |
| Dry-run global et confirmation LIVE | Réel, sous réserve des injections de constructeur. |
| Sandbox bwrap | Implémenté, mais non fonctionnel sur l'hôte testé. |
| Isolation réseau testée | Faux positif : le test passe sur un échec d'initialisation bwrap. |
| Sanitizer/Set/9 tests | Réel, mais ce sanitizer n'est connecté à aucun agent/tool call puisque l'agent n'existe pas. |
| Client Polymarket natif | Partiel : lectures et construction d'appels présentes ; écritures live incomplètes faute d'authentification. |
| Retry exponentiel | Partiel : uniquement les GET et uniquement lorsque l'erreur est un `TypeError`, dans `packages/execution/src/polymarketClient.ts:108-128`. Aucun retry POST/DELETE. |
| Mapping CLOB rigoureux | Seulement contre fixtures mockées ; aucune validation runtime des nombres, tableaux ou identifiants dans `packages/execution/src/polymarketClient.ts:67-81`. |
| Stockage secrets Polymarket | Réel pour le vault local, non intégré aux requêtes. |
| Signature EIP-712/EIP-191 | Incorrecte/incomplète ; ne doit pas être considérée faite. |
| Gating `signedOrdersValidated` | Présent mais facilement activable par tout appelant. |
| Project references, pretest, Vitest | Réels ; compte de tests obsolète et suite actuellement rouge. |

### Risk engine : fonctionnalité présente mais case non cochée

La case `[ ] Risk engine Rust CLI + tests` devrait être scindée :

- CLI et tests : faits ;
- couverture globale 90 %+ : confirmée ;
- moteur opérationnel comme protection live : non.

Le pipeline annonce dix portes, mais :

- `KILL_SWITCH` est toujours `Allow` : `crates/risk-engine/src/pipeline.rs:75-80` ;
- l'entrée CLI ne transporte que `hist_pnls` : `crates/risk-engine/src/main.rs:37-41` ;
- circuit breaker et détecteur de volatilité sont donc recréés à leurs valeurs par défaut à chaque requête : `crates/risk-engine/src/main.rs:60-65` ;
- le circuit breaker n'a aucun chemin vers `HalfOpen` ; lorsqu'il est `Open`, il incrémente un compteur puis retourne sans transition : `crates/risk-engine/src/circuit_breaker.rs:63-68` ;
- le test nommé `half_open_recovers_to_closed` ne teste aucune récupération : `crates/risk-engine/src/circuit_breaker.rs:150-163`.

Une probe a fait accepter le trade suivant :

- `market_id=""` ;
- `side="garbage"` ;
- `est_value_usd=-100` ;
- `win_probability=2`.

Décision retournée : `allowed: true`, taille suggérée `$10`. Le pipeline ne valide ni `market_id`, ni `side`, ni cohérence prix × quantité × valeur ; la comparaison négative passe le plafond de position à `crates/risk-engine/src/pipeline.rs:110-123`.

### Cases `[ ]`

Gateway, agent, ledger, skill loader et skill Polymarket : aucun début d'implémentation substantiel. Les répertoires correspondants sont vides, à l'exception de `.gitkeep`.

CI : seulement `.github/workflows/.gitkeep` ; aucune pipeline.

Documentation : au moment de l'audit, le répertoire `docs/` existait localement mais était non suivi. Aucun `README.md`, `ARCHITECTURE.md`, `SECURITY.md` ou `TRADING.md` n'était suivi.

Wallet Solana : non implémenté. Le code parle même de « wallet Solana » alors que le signer actuel utilise secp256k1/Ethereum : `packages/execution/src/polymarketSecrets.ts:4-7`.

API key Polymarket : structure de stockage présente, mais récupération, headers, authentification et validation live absentes.

---

## 4. Qualité du code et risques structurels

### Rust

Points positifs :

- découpage simple et lisible ;
- pas de `unsafe` ;
- erreurs CLI généralement transformées en résultat non nul ;
- bons tests unitaires et property tests ;
- couverture élevée.

Risques :

- `partial_cmp(...).unwrap()` panique en présence de `NaN` dans `crates/risk-engine/src/var.rs:27,44`. JSON standard bloque généralement NaN à la frontière CLI, mais l'API bibliothèque publique ne le fait pas.
- Les bornes numériques métier ne sont pas validées.
- Les écritures stdout ignorent leurs erreurs dans `crates/risk-engine/src/main.rs:97-102`.
- Les `unwrap()` de sérialisation d'erreur sont peu risqués, mais évitables : `crates/risk-engine/src/main.rs:79-104`.
- Le modèle d'état critique n'est pas persistant ni transmis via le contrat CLI.
- `cargo clippy` n'a pas pu être lancé dans le `shell.nix`, car celui-ci ne fournit pas Clippy. C'est aussi un manque de qualité de la toolchain annoncée.

### TypeScript

Points positifs :

- `strict:true` ;
- `skipLibCheck:false` ;
- zéro `any` ;
- utilisation de `unknown` aux frontières ;
- timeouts et erreurs explicites sur les processus enfants.

Risques :

- de nombreux casts non validés remplacent une vraie validation runtime ;
- la réponse Rust est castée sans schéma ;
- les réponses HTTP Polymarket sont castées sans Zod ni contrôles de finitude ;
- `placeOrder` accepte un payload signé sans vérifier qu'il correspond aux `params` transmis ;
- incohérence de stratégie : les GET ont retry, les écritures n'en ont pas, et aucun identifiant d'idempotence n'est visible ;
- le commentaire de `packages/risk/src/client.ts:4` affirme « testée à 100 % », alors que la mesure réelle est 92,17 %.

### Dépendances

`npm audit` :

- 0 critique ;
- 0 haute ;
- 2 modérées ;
- vulnérabilité de path traversal/lecture arbitraire dans Vitest et `@vitest/mocker`, `GHSA-82fw-gwwq-j7x9` ;
- version installée : Vitest 3.2.7 ;
- correction proposée par npm : Vitest 5.0.0, changement majeur.

Cette vulnérabilité touche l'outillage de test, pas le runtime de trading, mais elle contredit une future CI propre si l'objectif inclut les niveaux modérés.

Versions crypto installées :

- `@noble/curves` 1.9.7 ;
- `@noble/hashes` 1.8.0.

`npm audit` ne remonte aucune vulnérabilité connue sur ces deux versions. Le risque trouvé ici vient de l'usage/protocole EIP-712, pas des primitives Noble.

`cargo audit 0.22.1` :

- base RustSec chargée ;
- 48 dépendances analysées ;
- sortie avec code 0 ;
- aucune vulnérabilité signalée.

---

## 5. Verdict final

### Niveau actuel

**Prototype fragile.**

Les fondations de compilation, chiffrement au repos, dry-run et séparation Rust/TypeScript sont intéressantes. Mais Pallas n'est pas encore un système intégré et plusieurs protections centrales sont nominales ou incorrectes :

- tests principaux rouges ;
- sandbox non opérationnel ;
- pipeline risk permissif sur données invalides ;
- état de risque non transmis ;
- signature/order wire invalide ;
- aucune authentification CLOB réelle ;
- aucun gateway/agent/ledger.

Il peut servir à poursuivre le développement et à tester des lectures publiques Polymarket. Il ne peut pas encore être qualifié de « prêt pour dry-run réel », car ce niveau suppose au minimum un parcours applicatif complet et reproductible, même sans émission d'ordre.

### Trois risques prioritaires avant LIVE

1. **Reconstruire et verrouiller la frontière risk engine.** Ajouter un schéma strict et borné côté Rust, rejeter toute valeur incohérente, transmettre un état authentifié/persistant, implémenter réellement kill switch, circuit breaker et volatilité, puis tester des entrées adversariales.

2. **Remplacer la signature et le wire Polymarket par une implémentation validée officiellement.** Corriger l'EIP-712, les montants BUY/SELL, les headers d'authentification et l'idempotence ; utiliser des vecteurs officiels et un environnement de validation contrôlé. Retirer le booléen public `signedOrdersValidated` comme simple levier de contournement.

3. **Rendre les barrières opérationnelles et testables de bout en bout.** Corriger bwrap sur la plateforme cible, empêcher les faux positifs, limiter le filesystem exposé, durcir PATH/override, connecter sanitizer → risk → execution, et exiger une CI verte depuis un checkout propre.

### Éléments non vérifiables

Cet audit n'a pas pu confirmer :

- l'acceptation d'un ordre signé par l'API Polymarket live ;
- le format exact attendu par le compte/wallet cible ;
- la récupération ou validité d'une API key Polymarket ;
- un wallet réel, Solana ou EVM ;
- la gestion de capital réel ;
- la qualité des documents locaux non suivis dans `docs/`.

Aucune clé live ni aucun ordre réel n'a été utilisé.
