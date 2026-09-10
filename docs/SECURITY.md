# Sécurité — Pallas

Statut : document amorcé par PALLAS-M03 (2026-09-09), complété mémoire par PALLAS-M05
(2026-09-09). À compléter par PALLAS-M06 (CI + doc sobre).

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

### Limites documentées / à traiter en PALLAS-M06

- CI non câblée (`npm test`/typecheck/cargo ne tournent pas en pipeline).
- Composants de sécurité non engagés (packages/agent absent).

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