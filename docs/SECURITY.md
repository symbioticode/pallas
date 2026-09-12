# Sécurité — Pallas

Statut : document complété par PALLAS-M03 (sandbox), PALLAS-M05 (mémoire), PALLAS-M06
(CI + reporting + réserves closes + annexe de vérification réelle), PALLAS-M16 (signature
séparée du ledger), PALLAS-M17 (autorités indépendantes + intention canonique) et PALLAS-M19
(custody credentials : permissions, rotation testée, runbook).
Date : 2026-09-11.

## Signalement de vulnérabilité

Ce dépôt est public. Toute vulnérabilité est traitée avec la même rigueur que le reste du
projet : pas de fausse sécurité. Pour signaler un problème — y compris un commentaire ou une
affirmation trompeuse — ouvrir une issue GitHub ou, pour les sujets sensibles (clés, exfiltration,
logique financière), contacter le mainteneur directement. État vérifié par l'audit externe
`docs/AUDIT-PALLAS-v0.1.md` : les protections annoncées sont celles réellement implémentées, et les
limites sont documentées ci-dessous et dans les rapports de mission `docs/mission/`.

## Périmètre des garanties (résumé)

| Protection | État | Mission de référence |
|---|---|---|
| Dry-run global par défaut + confirmation "LIVE" | ✔ fail-closed | M01 |
| Chiffrement credentials AES-256-GCM + scrypt | ✔ | M01 |
| Signature CLOB EIP-712 V2 + `schemaGate` (pas d'émission sans preuve) | ✔ | M02 |
| Sandbox bwrap : écriture neutralisée, isolation réseau **prouvée** | ✔ | M03 |
| Frontières runtime : schémas Zod, rejet explicite des réponses hors contrat | ✔ | M04 |
| Zeroing mémoire : copies Buffer des clés effacées, strings non-effaçables | ✔ (limité, voir §"Mémoire") | M05 |
| Ledger fail-stop + signature séparée (clé privée hors process écrivain) | ✔ | M16 |
| `isDryRun` verrouillé : injection réservée tests, `enableDryRun` hors package | ✔ | M17 |
| Intention canonique : `tokenId` obligatoire, `marketId` précis, rounding officiel | ✔ | M17 |
| Rejet `signatureType` ≠ EOA à la construction | ✔ | M17 |
| Permissions fichiers secrets : `chmod 600` appliqué par le code au chargement (Linux/NixOS) | ✔ | M19 |
| Rotation credentials testée (scénario complet sur credentials de test) + runbook clé compromise | ✔ | M19 |
| CI active (npm + cargo, audit) | ✔ | M06 |
| CI actions SHA-pinnées + job couverture avec seuils | ✔ | M20 |
| Alertes CRITICAL structurées (JSONL + webhook) sur les anomalies de l'audit | ✔ | M20 |
| Objectifs RTO ≤ 15 min / RPO ≤ 1 cycle documentés | ✔ | M20 |

## Sandbox bwrap (phase 1.3) — portée réelle de la protection

Le terminal sandboxe toute exécution via bubblewrap dans `runSandboxed`
(`packages/execution/src/sandbox.ts`) : allowlist de binaires, `spawn` en array
d'arguments (pas de shell), unshare net/PID/UTS, racine `/` montée en lecture seule.

**Le montage `--ro-bind / /` protège l'écriture, PAS la confidentialité.**
Le processus sandboxé peut toujours LIRE tout fichier lisible par l'utilisateur
sous lequel il tourne (clés, secrets, code, données). Le sandbox neutralise la
mutation ou la destruction (pas d'écriture sur le système), il ne confine pas la
lecture : un programme compromis peut exfiltrer les données lisibles. Pour limiter
l'exposition, les secrets ne doivent pas vivre dans des fichiers lisiblement
importants ; l'accès réseau étant isolé, l'exfiltration passe par des canaux
implicitement permis (stdout/stderr renvoyés à l'appelant).

### Fail-closed

- bwrap absent ⇒ `MissingBwrapError` (throw).
- bwrap présent mais incapable d'initialiser l'isolation (ex. `NETLINK_ROUTE
  socket: Operation not permitted`, netns non permis sur l'hôte) ⇒ `BwrapInitError` :
  le programme protégé n'est JAMAIS démarré, l'échec est distinct d'un échec
  applicatif et remonté bruyamment — jamais exécution en clair, jamais un simple
  code de sortie non nul assimilable à une « isolation ».

### Limites documentées (état au 2026-09-09)

- **Retry placeOrder** : l'API CLOB Polymarket n'a aucune clé d'idempotence ; un timeout ou
  un 5xx laisse l'ordre dans un état indéterminé (`AmbiguousOrderError`) — réconciliation à
  la main (voir `docs/TRADING.md`), pas de retry auto.
- **`isDryRun` injectable** (PALLAS-M17, ferme la réserve M10 et les audits v0.1/v0.2/v0.3) :
  l'injection `isDryRun?: () => boolean` au constructeur `PolymarketClient` est désormais
  **verrouillée par le mode test** — hors `PALLAS_TEST_MODE=1` (variable dédiée, non documentée
  en usage production, activée globalement par les tests via `vitest.config.ts`), fournir ce
  champ lève une erreur au constructeur. Un chemin de production standard ne peut plus instancier
  un client en mode live que par le parcours opérateur : `applySafetyGates`/`disableDryRun('LIVE')`.
- **`enableDryRun` hors package public** (PALLAS-M17) : `@pallas/core` n'exporte plus que
  `isDryRun`/`getDryRunState`/`disableDryRun` (l'entrée opérateur explicite reste la confirmation
  `"LIVE"`). `enableDryRun` reste en interne (tests + remise en simulation manuelle) : aucun chemin
  de décision automatisé (agent/stratégie) ne doit pouvoir réarmer le dry-run.
- **`placeOrder` cross-check : intention canonique** (PALLAS-M17) : `params` DOIT correspondre au
  `signed.order` sur `marketId` (= **l'actif CLOB**, égal à `tokenId`), `tokenId` (**obligatoire**),
  `side` et les montants recalculés avec l'**algorithme officiel de rounding par tick** de
  `py-clob-client-v2` (tolérance 1 unité 1e-6). Toute divergence → `OrderMismatchError` avant tout
  appel réseau. Limite assumée : le prix et la taille ne sont pas signés directement — plusieurs
  couples (prix, taille) peuvent produire les mêmes entiers arrondis ; la vérification porte donc
  sur l'identité `marketId`/`tokenId`/`side` et les flux monétaires the rounding officiel.
- **`PALLAS_RISK_BIN`** (PALLAS-M10) : variable d'env vérifiée par `isRegularExecutable` (fichier
  régulier + bit x, après résolution des symlinks, — mêmes règles que bwrap résolu par la sandbox)
  avant tout `spawn`. Un dossier ou un symlink vers un fichier non exécutable est rejeté
  (`MissingBinaryError`).
- **packages/agent, gateway, skills** : absents — le code de sécurité qui les
  concerne (auth de la gateway) n'est donc pas encore actif.
- **CI** (PALLAS-M06 + annexe de vérification réelle, 2026-09-10) : les deux premiers pushs sur
  `main` ont ÉCHOUÉ sur le runner réel — l'action `actions-rust-lang/audit@v2` n'existe pas, et
  bwrap n'est pas fourni par `ubuntu-latest` (4 tests sandbox) alors que le binaire Rust n'était
  jamais construit dans le job TypeScript (8 tests). Corrigé : la CI repose sur le **même shell
  Nix que le dev** (`shell.nix` épinglé : Node 22, Rust, linker C, **bubblewrap**, cargo-audit),
  le job TypeScript **compile le binaire `risk-engine` avant `npm test`** (runner séparé du job
  rust), et `cargo audit` tourne via Nix. Les tests d'isolation réseau se **skippent explicitement** si
  bwrap est absent ou si le runner refuse l'unshare (sonde `realBwrap` dans `sandbox.test.ts`) —
  jamais d'exécution en clair. `npm audit --audit-level=high` : deux advisorys **modérées**
  assumées (`@vitest/mocker` path traversal, dev-only, non exploitable en CI). Upgrade Vitest 5 =
  piste future (journal M06).

## Ledger d'audit — signature séparée (PALLAS-M16)

Le ledger (`packages/ledger`) est un journal chaîné SHA-256 dont un checkpoint est signé
périodiquement avec une clé **Ed25519 distincte et extérieure au process qui écrit**.

### Modèle de menace couvert

- Un attaquant disposant du fichier `ledger.json` ET du process écrivain peut modifier puis
  **recalculer les hashes avec la fonction exportée** — sans signature, la chaîne redevient
  cohérente (scénario identifié par AUDIT v0.3 §6). Dès qu'un checkpoint signé existe, cette
  falsification est détectée **au chargement** (fail-stop, `LedgerIntegrityError`), même quand
  la clé publique n'est pas montée (le `.sig` seul sert d'ancrage).
- Chargement fail-stop, cas **distincts** : fichier **absent** = premier démarrage légitime
  (uniquement si aucun `.sig` n'est présent) ; fichier présent mais JSON invalide/tronqué =
  `LedgerLoadError` ; rupture de chaîne, checkpoint incohérent, ou `.sig` absent en mode strict
  (`PALLAS_LEDGER_PUB_KEY` fournie) = `LedgerIntegrityError`. Jamais de réinitialisation
  silencieuse.

### Séparation de la clé (exigence AUDIT v0.3 « utiliser une clé qui n'a pas besoin d'être en
mémoire pendant le fonctionnement normal »)

- **Clé privée** : générée hors du process écrivain (`npm run sign-ledger -- gen --dir …`),
  permissions `0600`, jamais montée par le run loop. Elle ne sert qu'à signer un checkpoint
  (`sign --key … --ledger …`) ; le process écrivain ne la détient **jamais en mémoire**.
- **Clé publique** : seule clé montée par le process écrivain, via `PALLAS_LEDGER_PUB_KEY`
  (PEM inline ou chemin de fichier). Fournie → mode **strict** : `.sig` obligatoire et vérifié
  cryptographiquement, sinon arrêt.
- **Ancrage préfixe** : le checkpoint référence l'index+hash d'un maillon existant ; une chaîne
  honnête peut s'étendre **après** le checkpoint (signature périodique). Toute troncature ou
  réécriture d'une partie signée est détectée.

### Limites assumées

- **Pas d'ancrage distant/WORM** : `.sig` vivant à côté du ledger ; sans la clé privée on ne
  peut pas forger, mais un opérateur (détenteur de la clé) reste théoriquement en mesure de
  réécrire l'historique. Piste d'export périodique vers du stockage distant en écriture seule,
  hors budget PALLAS-M16.
- **Observatory non autorité** : moniteur en lecture seule qui manifeste `SIGNED`/`UNSIGNED`/
  `SIGNATURE INVALID` (badge + warnings) mais ne fail-stop pas — l'autorité reste
  `@pallas/ledger` au chargement.

## Credentials en mémoire — garanties réelles (PALLAS-M05)

**Ce qui est effacé (`.fill(0)` quand la donnée vit dans un Buffer dont on détient la copie) :**

- copies Buffer des clés privées dans le signer (`package:execution → polymarketSigner.ts`) :
  `signOrder`, `signClobAuth`, `signEip191`, `privateKeyToAddress` — toutes passent par
  `toKeyBuffer()` (copie de 32 octets) libérée dans un `try/finally` ;
- clé dérivée scrypt et buffer déchiffré temporaire (`packages/core/src/credentials.ts`).

**Ce qui ne peut PAS être effacé en JavaScript/TypeScript pur :**

- toute clé **string** : passphrase de dérivation, secrets hex/clair transmis en `string`,
  et tout ce qui est sorti de `JSON.parse` (`decryptObject`, `loadPolymarketSecrets`).

**Risque résiduel (assumée, documenté — pas masqué) :**

> Les secrets décryptés existent en clair sous forme de string JS tant que le process tourne ;
> en cas de compromission du process (heap dump), ils sont récupérables.

Le zeroing dont pouvons disposer réduit la surface (copies de travail transitoires),
il ne la supprime pas : l'effort de sécurité porte sur le stockage au repos (chiffré,
fail-closed) et la réduction du temps de vie des copies Buffer.

**Piste future (non implémentée, budget non engagé) :** `sodium-native`/`libsodium` ou
mémoire native verrouillée (`mlock`) permettrait un vrai zeroing + swap protection pour les
clés — à réserver aux clés privées et à sécuriser par une preuve de mise en œuvre (n'ajouter
aucune dépendance native au build NixOS sans cette preuve).

## Custody des credentials — permissions, séparation, rotation (PALLAS-M19)

### Permissions de fichiers (appliquées par le code, plus seulement documentées)

Tout fichier contenant un secret (vault chiffré `v2`, fichier de passphrase) doit être en
`0600` (propriétaire seul). Le chargement REFUSE explicitement les fichiers trop larges :

- `assertFilePermissions(path, mode = 0o600)` (`packages/core/src/credentials.ts`) vérifie les
  bits groupe/autres POSIX avant toute lecture et lève `SecretFilePermissionsError` sinon
  (message avec `chmod 600` correctif).
- `loadPolymarketSecretsFromFile(config, vaultPath)` (`packages/execution/src/polymarketSecrets.ts`)
  est le chemin de production recommandé pour un vault sur disque : garde de permissions →
  lecture → déchiffrement. Testé sur Linux/NixOS (uniquement — Windows non couvert, limite
  assumée).

### Séparation signature d'ordres / dérivation d'API key — absence assumée

**État réel : il n'existe PAS de séparation de process.** Dans `@pallas/execution`, les mêmes
primitives dérivent la clé de signature API (`clobAuth.ts`) et
signent les ordres CLOB (EIP-712, `polymarketSigner.ts`) **dans le même process Node**, après
déchiffrement du vault partagé (`polymarketSecrets.ts`). Une compromission du process expose les
deux surfaces d'un coup (API + wallet) ainsi que les secrets en clair en mémoire.

Ce qui EST en place aujourd'hui pour limiter la surface :
- le vault est chiffré au repos (AES-256-GCM) et sa passphrase n'est jamais stockée à côté ;
- la séparation **effective** qui existe est celle du **ledger** : la clé Ed25519 qui signe les
  checkpoints n'est pas montée par le process écrivain (PALLAS-M16) ;
- les clés CLOB/wallet transitent par des fonctions délimitées qui ne partagent pas d'état
  mutable au-delà du strict nécessaire (préparant une séparation de process future sans
  l'implémenter aujourd'hui).

Risque résiduel **accepté et documenté** : tant que le process unique signe et dérive dans le
même espace mémoire, un heap dump compromis révèle les deux jeux de clés + les secrets
déchiffrés. Isoler la dérivation d'API key (générée côté client CLOB, jamais stockée à plat)
dans un process dédié ou un KMS reste une piste — hors budget PALLAS-M19, à ne pas présenter
comme fait.

### Rotation et révocation

- **Scénario de rotation** : exécuté réellement sur credentials de TEST (jamais réels) — voir
  `docs/mission/mission-PALLAS-M19-journal.md` pour les commandes et sorties :
  1. révoquer l'ancienne clé API côté CLOB (action plateforme, hors `@pallas`);
  2. dériver une nouvelle clé API (action plateforme/portefeuille);
  3. re-chiffrer le vault avec une **nouvelle passphrase** `openssl rand -hex 32`;
  4. vérifier : ancien vault indéchiffrable, nouveau vault chiffre/déchiffre, permissions 0600.
- **Runbook clé compromise** : procédure opérationnelle datée dans `docs/RUNBOOK-key-compromise.md`
  (cancel-all dépend de PALLAS-M14, révocation API, rotation, vérification ledger).
- **Limite assumée** : pas d'intégration KMS/HSM/gestionnaire de secrets — la passphrase et les
  clés transitent par env/fichiers locaux. Pas de séparation de process (voir plus haut). Ces
  limites sont assumées pour le stade du projet, documentées, et ne sont pas présentées comme
  couvertes.

### Objectifs RTO / RPO (PALLAS-M20)

Objectifs **cibles** de reprise, cohérents avec une seule machine de trading en dry-run :

| Objectif | Cible | Justification / limites |
| --- | --- | --- |
| RTO recovery objective | ≤ 15 min | Redémarrage du loop depuis l'état durable checksummé (fail-stop, jamais d'état neuf) ; pas de déploiement multi-node à réparer. |
| RPO recovery point | ≤ 1 cycle (≈ 1 min) | Chaque transition d'état est écrite de façon durable **avant** l'émission réseau (M13) ; le ledger est append-only journalable. |
| Fenêtre d'ambiguïté | ≤ 1 cycle après contact réseau | Un ordre ambigus est réconcilié immédiatement (M14) ; tant qu'il n'est pas réglé, le scope bloque toute émission (pas de double-soumission). |

Points de mesure associés (M20) : l'état durable porte un `checksum` (corruption détectée au
chargement → alerte `STATE_CORRUPT`), le ledger est chainé et `SIGNED` (M16), et chaque anomalie
fait l'objet d'une alerte JSONL (`AMBIGUOUS_ORDER`, `RECONCILE_FAILED`, `KILL_SWITCH`,
`LEDGER_CORRUPT`, `STATE_CORRUPT`) observable via `/api/status`.

Ces objectifs ne sont **pas** garantis par contrat de service : pas de réplication, pas de
rene-match. Ce sont des cibles de conception vérifiables par les tests (corruption → fail-stop →
alerte) et le runbook, pas des SLIs contraignants.

## Chaîne d'audits — traçabilité (PALLAS-M21)

Les rapports `docs/AUDIT-PALLAS-v*.md` (v0.1 → v0.4) sont désormais **suivis par git** : la règle
d'exclusion `docs/AUDIT-PALLAS*.md` a été retirée du `.gitignore` en PALLAS-M21. Décision et
motif :

- la finalisation s'appuie sur une **chaîne d'audits comparés dans le temps** (v0.2.1 → v0.3 →
  v0.4) ; un rapport non versionné n'est pas reconstructible sans la copie locale de son auteur ;
- l'état antérieur était incohérent : `v0.1` était déjà suivi (ajouté avant la règle d'exclusion),
  alors que `v0.2`, `v0.2.1`, `v0.3` et `v0.4` ne l'étaient pas ;
- chaque rapport référence le commit HEAD de son époque, ce qui permet de confronter un verdict à
  l'arbre exact qu'il a jugé (chaîne de provenance).

Seul `.pallas/` (état/ledger local) reste volontairement hors git.
