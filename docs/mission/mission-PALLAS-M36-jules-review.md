# Rapport de Revue Externe — Mission PALLAS-M36

**Date de revue** : 15 septembre 2026
**Relecteur** : Jules (Agent logiciel externe / Google)
**Objet** : Evaluation neutre du dépôt Pallas au tag figé `pallas-mvp-freeze-1` (`origin/missions-M21-M28`)
**Statut de la mission** : Diagnostic uniquement (préparation des futures missions de rédaction README et PROGRESSION.md)

---

## 0. Note de vérification de fraîcheur (§6.2)

- **Commit exact évalué** : `007572148c216de09c33dd99b16e5092332352a6` (pointeur de la branche `origin/missions-M21-M28`, incluant la synthèse M21-M28 `docs/SYNTHESE-M21-M28.md`).
- **Confirmation d'alignement post-gel** : Le rapport porte sur l'état complet du dépôt post-M28 et **non** sur la version M20 (`22e2c53` de `main`). Les artefacts spécifiques post-gel examinés et validés comprennent notamment :
  - L'Observatory v0.2.0 (`packages/observatory`, `npm run observatory:demo`) ;
  - Le système d'alerte et d'observabilité CRITICAL (`/api/status`, `emitAnomaly`, JSONL) ;
  - La persistance durable v2 avec verrous atomiques inter-processus (`packages/core/src/file-lock.ts`) ;
  - La signature Ed25519 obligatoire des checkpoints de ledger (`packages/ledger/src/ledger-signing.ts`) ;
  - Le Kill Switch Authority centralisé (`packages/execution/src/killSwitchAuthority.ts`) ;
  - La campagne d'observation M27 (`docs/observation/M27-2026-09-13/`) et les scripts de rotation de clés M28 (`scripts/rotate-credentials.mjs`).

---

## 1. Lisibilité

### Ce qui est clair et réussi
- **Périmètre explicite** : Le README principal et la documentation précisent d'emblée que Pallas est ciblé exclusivement sur **Polymarket** et fonctionne **en dry-run par défaut**.
- **Honnêteté sur l'avancement** : La distinction entre ce qui est implémenté (Engine de risque en Rust, client CLOB, ledger inviolable, Observatory) et ce qui n'a pas encore démarré (Gateway Fastify, Agent autonome, Skills LLM) est nette.
- **Sécurité mise en avant** : La posture "Fail-Closed" et la protection contre l'exécution accidentelle en argent réel sont immédiatement compréhensibles.

### Manques et zones de confusion
- **README obsolète par rapport à l'état réel (M28)** : Le `README.md` racine est resté figé au stade M06/M20. Il ne mentionne ni l'**Observatory** (`npm run observatory:demo`), ni la **boucle de référence** (`npm run reference-loop`), ni les avancées majeures M21-M28 (signature Ed25519, verrous atomiques). Un utilisateur qui ne lit que le README ignore l'existence de l'interface graphique de diagnostic.
- **Piège à l'exécution des tests TS** : Le README indique `npm test` comme commande standard de test. Or, exécuter `npm test` juste après un `git clone` frais échoue sur 13 tests de `@pallas/risk` avec l'erreur `MissingBinaryError`. La raison est que les tests TS dépendent du binaire compilé `crates/risk-engine/target/release/risk-engine`. Il manque la mention explicite qu'un `cargo build --release` dans `crates/risk-engine` est un prérequis obligatoire avant `npm test`.

---

## 2. Compréhension architecturale

### Ce qui est clair et réussi
- **Modularité monorepo exemplaire** : La structure `packages/*` (`core`, `execution`, `risk`, `ledger`, `strategy`, `observatory`) et `crates/risk-engine` (Rust) isole parfaitement les responsabilités.
- **Garanties et frontières d'isolation** :
  - **Risk Engine (Rust)** : Fonctionne comme un composant pur / stateless par passage d'état JSON (stdin/stdout), validé aux frontières TypeScript par des schémas Zod stricts.
  - **Execution** : Contient un garde de sécurité statique (`secrets-guard-convention.test.ts`) empêchant l'import direct de secrets hors des conteneurs autorisés.
  - **Ledger** : Modèle append-only cryptographiquement lié (SHA-256 hash-chain + signature Ed25519).
  - **Observatory** : Package 100% Read-Only, n'important aucune dépendance métier (`execution`, `risk`, `strategy`) pour garantir qu'aucune action d'écriture ou de trading ne puisse être initiée depuis l'UI.

### Manques et zones de confusion
- **Documentation d'architecture incomplète** : `docs/ARCHITECTURE.md` décrit bien les modules initiaux, mais n'a pas été actualisé pour refléter les mécanismes avancés introduits en M21-M28 (ex. `killSwitchAuthority`, verrous de fichier atomiques `file-lock.ts`, double persistance d'état durable v2).

---

## 3. UI (Pallas Observatory)

### Observations directes lors de l'exécution
- **Exécution réussie** : Lancé via `node scripts/observatory-demo.mjs` (ou `npm run observatory:demo`), le serveur s'initialise sans aucune configuration préalable.
- **Expérience utilisateur automatique** : Le script interroge automatiquement l'API publique de Polymarket, sélectionne un marché actif (ex: marché présidentiel ou crypto), lance la boucle de référence en arrière-plan et ouvre le serveur web sur `http://127.0.0.1:4173`.
- **Interface fluide et temps réel** :
  - Mise à jour automatique toutes les 1.5s via `/api/snapshot`.
  - Affichage clair du carnet d'ordres (Best Bid/Ask, Spread, Mid), des décisions du moteur de risque, du statut du Kill Switch et du journal d'alertes.
  - Le badge **`DEMO OVERRIDE`** explique clairement que le seuil de déclenchement (threshold = 1.0) est un réglage de démonstration destiné à forcer le passage d'ordres virtuels.

### Qualité de la frontière Read-Only
- L'Observatory respecte strictement la frontière Read-Only : seules les routes `GET /` et `GET /api/snapshot` (ainsi que `GET /api/status`) existent.
- Avant chaque sérialisation JSON envoyée au client web, les champs sensibles (clés privées, secrets, passphrases) sont récursivement expurgés.

---

## 4. Exécutabilité

### Séquence de test réelle effectuée dans le bac à sable

1. **Installation des dépendances** :
   ```bash
   npm ci
   ```
   *Résultat* : Succès (131 packages installés en 5s).

2. **Compilation du Moteur de Risque Rust** (Prérequis identifié) :
   ```bash
   cd crates/risk-engine && cargo build --release
   ```
   *Résultat* : Succès (compilation release optimisée en ~30s).

3. **Exécution des tests TypeScript** :
   ```bash
   npm test
   ```
   *Résultat* : **22 suites de tests passées (100%), 265 tests réussis**, 4 tests ignorés (skipped).
   *Note sur les 4 tests ignorés* : Ils concernent le bac à sable `bubblewrap` (`sandbox.test.ts`), qui détecte correctement l'absence des privilèges `unshare` utilisateur dans l'environnement conteneurisé et bascule en mode `skip` sécurisé sans faire échouer la suite.

4. **Exécution des tests Rust** :
   ```bash
   cargo test --manifest-path crates/risk-engine/Cargo.toml
   ```
   *Résultat* : **65/65 tests réussis** (unitaires, intégration CLI, propriétés proptest).

5. **Lancement de l'Observatory Demo** :
   ```bash
   npm run observatory:demo
   ```
   *Résultat* : Succès. Le serveur tourne et traite le flux d'événements en direct.

---

## 5. Rigueur perçue

### Facteurs de haute confiance
- **Garanties "Fail-Closed" systématiques** :
  - Validation stricte des permissions de fichiers (refus d'ouvrir un fichier de secret si ses droits réseau/groupe dépassent `0600`).
  - Désactivation du dry-run impossible sans la saisie exacte du mot de passe de confirmation `"LIVE"`.
  - Sanitization automatique contre les injections de prompt, caractères invisibles (Zero-Width) et homoglyphes (`sanitizer.ts`).
- **Tests de résistance et concurrence** : Presence de sondes de concurrence inter-processus (`concurrency-probe.test.ts`, `ledger-concurrency.test.ts`) testant les accès simultanés sous forte charge.
- **Transparence statistique (M18)** : Avertissement explicite imprimé dans les logs rappelant que `win_probability = price` est une règle illustrative sans valeur prédictive commerciale.
- **Traçabilité totale** : Les 28 journaux de mission (`docs/mission/`) et la synthèse M21-M28 (`docs/SYNTHESE-M21-M28.md`) offrent un historique d'ingénierie et d'audit d'une rigueur exceptionnelle.

---

## 6. Autres critères pertinents

- **Scripts utilitaires prêts à l'emploi** :
  - `scripts/dry-run.mjs` permet de consulter les marchés et carnets Polymarket directement en ligne de commande sans aucune clé.
  - `scripts/rotate-credentials.mjs` (M28) fournit une procédure automatisée de rotation des coffres-forts chiffrés.
- **Qualité du code TypeScript & Rust** : Typage strict, aucun usage de `as any`, gestion d'erreurs typées et explicites.

---

## 7. Liste "Nécessaire et Suffisante" pour la prochaine mission de rédaction

Pour qu'un nouvel arrivant (développeur ou évaluateur technique) comprenne et puisse faire tourner Pallas sans aucune assistance, voici le tri strict entre les manques bloquants et les simples améliorations cosmétiques :

### A. Nécessaire (Bloquants de compréhension / d'exécution)

1. **Corriger la chaîne de build dans le `README.md` racine** :
   - Expliquer que `cargo build --release` dans `crates/risk-engine` doit impérativement être exécuté **avant** `npm test`, sous peine d'échec par binaire Rust manquant (`MissingBinaryError`).
2. **Ajouter la section "Pallas Observatory & Démo" dans le `README.md`** :
   - Présenter `npm run observatory:demo` comme le moyen le plus rapide d'observer Pallas en action (1 commande, zéro clé requise).
3. **Créer `PROGRESSION.md` à la racine** :
   - Synthétiser l'état d'avancement réel du projet de M01 à M28 (s'appuyer sur `docs/SYNTHESE-M21-M28.md` et `PLAN.md`), afin d'offrir une vision claire de l'état du MVP.
4. **Mettre à jour `docs/ARCHITECTURE.md`** :
   - Renseigner les composants introduits entre M21 et M28 (killSwitchAuthority, verrous atomiques, signature Ed25519 du ledger, système d'alerte JSONL/webhook).

### B. Secondaire / Cosmétique (Plus-values non bloquantes)

1. **Ajouter un script npm alias `build:rust`** dans `package.json` (`"build:rust": "cd crates/risk-engine && cargo build --release"`) pour simplifier la commande.
2. **Clarifier la dualité d'environnement `nix-shell` vs Shell Standard** dans la documentation.
3. **Mettre à jour les numéros de version/jalons** dans le README racine (remplacer les références M06/v0.1.0 par M28/Observatory v0.2.0).

---
*Rapport rédigé et certifié par Jules sur l'état post-gel `pallas-mvp-freeze-1` (`0075721`).*
