# Sécurité — Pallas

Statut : document complété par PALLAS-M03 (sandbox), PALLAS-M05 (mémoire) et PALLAS-M06
(CI + reporting + réserves closes + annexe de vérification réelle). Date : 2026-09-10.

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
| CI active (npm + cargo, audit) | ✔ | M06 |

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
- **`isDryRun` injectable** au constructeur de `PolymarketClient` (utile aux tests) : c'est une
  porte de contournement pour tout appelant interne. **PALLAS-M10 (décision actée) : réserve
  documentée, injection RESTÉE intentionnellement limitée** — `isDryRun` lit par défaut le flag
  global de `@pallas/core` ; le champ d'option est hors index public et la politique d'assemblage
  du runtime final (packages/agent/gateway, « Phase 3 » du `PLAN.md`) devra INTERDIRE cette
  injection hors tests. Restriction d'API différée jusqu'à l'assemblage (rien ne consomme encore
  `PolymarketClient` en prod).
- **`placeOrder` cross-check params↔signé** (PALLAS-M10) : le payload signé doit correspondre à
  l'intention déclarée (`side`, `tokenId`, montants à 1 unité 1e-6 près) avant tout appel réseau —
  sinon `OrderMismatchError`.
- **`PALLAS_RISK_BIN`** (PALLAS-M10) : variable d'env vérifiée par `isRegularExecutable` (fichier
  régulier + bit x, après résolution des symlinks, — mêmes règles que bwrap résolu par la sandbox)
  avant tout `spawn`. Un dossier ou un symlink vers un fichier non exécutable est rejeté
  (`MissingBinaryError`).
- **packages/agent, gateway, ledger, skills** : absents — le code de sécurité qui les
  concerne (sanitizer câblé, ledger, auth de la gateway) n'est donc pas encore actif.
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