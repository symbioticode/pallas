# Journal de mission — PALLAS-M32

Date : 2026-09-13 (America/Toronto)

## Baseline et audit

- tag requis : `pallas-mvp-freeze-1` ;
- commit résolu : `e69d7542f79ff3e6a24df60773147a6a2f400986` ;
- audit v0.6 versionné par `6605d0fe5165d59a4279969286b98400c85ee03c` ;
- périmètre : paper trading supervisé exclusivement, aucun capital réel.

## R-08 et R-10

Les chiffres historiques 304/0/4 restent inchangés dans le manifeste. Une note adjacente précise
leur dépendance à l'environnement M30 et le rejeu 308/0/0 sur l'hôte avec netns. R-10 est ajouté
aux limites MVP : le single-flight est intra-processus et deux processus peuvent dupliquer des
lectures exchange, sans double placement ni double cancel-all.

## R-09 — contrôle préalable initial

La commande `pgrep -af 'run-reference-loop|observation-campaign.mjs|m27-72h-run.mjs'` n'a trouvé
aucun processus Pallas actif (hors commande de contrôle elle-même). `tmux list-sessions` a répondu
`no server running`. Un second contrôle est obligatoire immédiatement avant lancement.

## R-07, rejeu et lancement

### Build et matérialisation

Le dépôt principal a été détaché sur le tag, avec statut vide. `npm ci`, un nettoyage TypeScript,
`npm run build`, puis `cargo clean && cargo build` dans le shell Nix ont été exécutés au chemin
canonique. Les huit artefacts reconstruits correspondent aux huit SHA-256 du manifeste.

Un build Rust debug depuis un worktree temporaire a produit un hash différent (`cd483e2a…`) à
cause du chemin de build embarqué ; il a été rejeté et n'a pas été utilisé. La reconstruction au
chemin canonique a reproduit le pin `49a1db4e…`.

Le dossier local `scripts/ct/m30-m27-72h/artifacts/` a ensuite été matérialisé avec les chemins du
manifeste. `verify-artifact-pins.mjs` a donné **8/8 PASS**. Il est exclu localement de l'index : la
baseline Git exécutée reste exactement le tag.

### Rejeu à blanc

`dry-run.sh` a donné `CT_DRY_RUN=PASS` : 8/8 pins, clés 0600/0644, dry-run actif, aucun lanceur.
La sonde Gamma était injoignable et a produit l'avertissement non bloquant prévu.

Comme `execute.sh` ne possède pas de durée d'intégration distincte, son rejeu de bout en bout a été
une campagne éphémère supervisée : seed signé, installation 8/8, `verify.sh` **4/4**, puis SIGTERM
et rollback propre après 7,783 s. Les preuves ont été conservées dans
`.pallas/campaign-m27-72h-2026-09-13T20-36-48-344Z`.

### R-09 final et lancement réel

À `2026-09-13T16:37:14-04:00`, immédiatement avant lancement :

- HEAD : `e69d7542f79ff3e6a24df60773147a6a2f400986` ;
- tag résolu : même hash ;
- `git status --porcelain` : vide ;
- recherche des trois commandes Node Pallas : aucun processus.

La campagne 72 h a démarré à `2026-09-13T20:37:22.562Z` dans
`.pallas/campaign-m27-72h-2026-09-13T20-37-22-463Z` :

- wrapper PID `1720245`, superviseur PID `1720256`, boucle PID `1720264` au premier contrôle ;
- cible 4 320 minutes, intervalle et monitoring 30 000 ms, incident contrôlé activé ;
- manifeste : `dry_run_verified=true`, `git_commit=e69d7542…` ;
- seed `0af2d5d1…`, signature de 88 caractères, rechargement supervisé vérifié ;
- premier checkpoint signé : `verified_load=true` ;
- `verify.sh` : **CHANGE_VERIFIED, 4/4**.

### Coût réseau initial

Après 30 secondes : 9 entrées ledger, état durable 997 octets, 0 alerte, 0 redémarrage. Deux
événements `reconcile_scope` étaient présents, tous deux `skipped=true` faute de signer L2 ; le
coût initial inféré est donc **0 appel `getOpenOrders` et 0 appel `getTrades`**. La baseline figée
n'expose pas de compteurs directs par méthode : ce suivi est une borne inférée des événements de
réconciliation et doit rester qualifié comme tel pendant la campagne.

F-11 demeure **ouvert** jusqu'à ce que la durée réellement observée atteigne au moins 72 heures.
