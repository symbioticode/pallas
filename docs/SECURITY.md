# Sécurité — Pallas

Statut : document amorcé par PALLAS-M03 (2026-09-09). À compléter par PALLAS-M06 (CI + doc sobre).

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