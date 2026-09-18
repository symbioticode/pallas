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

## Mise à jour opérationnelle — 2026-09-14 18:20 EDT

### Rectification du lancement initial et gouvernance CT

Le lancement décrit plus haut (`campaign-m27-72h-2026-09-13T20-37-22-463Z`) n'est plus la
campagne probante. Il a été arrêté proprement le 14 septembre à `05:10:03Z`, après
`30 760 442 ms`, avec `reason=sigterm`, zéro redémarrage et un checkpoint final vérifié. Ses
artefacts sont conservés, mais sa durée ne peut pas être agrégée à celle de la campagne courante
et ne ferme pas F-11.

Le premier bundle `CT-2026-020-PALLAS` a été invalidé après une approbation GPG déclenchée par
l'agent au lieu de l'humain. Cet événement est traité comme un incident de gouvernance et les
preuves ont été conservées dans
`~/.local/share/ct-runner/archive/CT-2026-020-PALLAS-invalid-human-approval-20260914T051118Z`.
La révision `CT-2026-020-PALLAS-R1` a ensuite été publiée en état `PROPOSED`, puis Andrei a
confirmé explicitement dans la conversation : « CT-2026-020-PALLAS-R1 approuvé et signé ».

La signature humaine R1 a été vérifiée avec l'empreinte complète
`F829D44C977F2E18596A011656E068ECDDD83C8C`. Le manifeste approuvé porte le SHA-256
`61aa97fc5022c413f4af13cc9820df96a89f7a3a118281e088843d4ffc649481`. Le runner CT a exécuté
la révision à `2026-09-14T05:30:00Z` et l'état a suivi
`APPROVED → QUEUED → IN_PROGRESS → SUCCESS`. La dernière preuve CT indique
`CHANGE_VERIFIED`, `returncode=0`, `verification_passed=true` et `acceptance_complete=true`.

### Campagne gouvernée en cours

La campagne probante courante est :

`/home/andrei/Projects/80_PALLAS/pallas/.pallas/campaign-m27-72h-2026-09-14T05-30-04-677Z`

État dynamique relevé le `2026-09-14T18:20:12-04:00` :

| Mesure | Valeur vérifiée |
|---|---:|
| wrapper | PID `1768574`, vivant depuis `2026-09-14T05:30:04Z` |
| progression | `60 588 204 ms` / `259 200 000 ms` — **23,375 %** |
| durée observée | **16 h 49 min 48 s** |
| durée restante estimée | **55 h 10 min** |
| métriques | `2 019` lignes, cadence cible 30 s |
| ledger | `12 252` entrées, `11 661 169` octets |
| état durable | `978 875` octets |
| RSS enfant | `290 644 KiB` au dernier relevé |
| alertes | `0` |
| redémarrages | `0` |

Le manifeste courant confirme toujours : commit
`e69d7542f79ff3e6a24df60773147a6a2f400986`, `target_minutes=4320`, intervalle et monitoring
`30000 ms`, `dry_run_verified=true` et injection d'incident contrôlé activée. Aucun marqueur
`COMPLETE` ni `summary.json` n'existe encore, ce qui est attendu avant l'échéance.

### Checkpoints et documentation régulière

Trois checkpoints existent et ont tous `signature_len=88` et `verified_load=true` :

| # | Horodatage UTC | Tête ledger | État |
|---:|---|---:|---|
| 1 | `2026-09-14T05:30:04.703Z` | 0 | `initial_seed` |
| 2 | `2026-09-14T11:30:22.669Z` | 4 530 | `scheduled` |
| 3 | `2026-09-14T17:30:41.341Z` | 8 870 | `scheduled` |

La cadence de six heures est donc tenue sur les deux premières échéances. Les mêmes entrées sont
présentes dans `docs/observation/M27-72h-2026-09-13/CHECKPOINTS.md`. Le chemin documentaire porte
la date historique du plan, mais les lignes de la campagne courante sont identifiées par leurs
horodatages et hashes propres. Le prochain checkpoint est attendu vers `2026-09-14T23:30Z`
(19:30 EDT).

Le watchdog `pallas-m32-monitor.timer` tourne toutes les quinze minutes. Son contrôle de
`2026-09-14T22:20:02Z` est `PASS` : CT `SUCCESS`, PID vivant, vérification cryptographique
`PASS`, trois checkpoints, 2 019 métriques, zéro alerte et zéro redémarrage.

### Coût réseau et limites encore actives

Au contrôle de `2026-09-14T22:20:02Z`, les `1 750` événements `reconcile_scope` étaient tous
`skipped=true` : le processus n'a pas de signer L2 et la réconciliation a donc ajouté exactement
**zéro appel `getOpenOrders`/`getTrades`**. Cette série est conservée dans
`.pallas/m32-network-cost.jsonl`. Les lectures de carnets de la stratégie ne sont pas comptées par
méthode dans la baseline gelée et ne doivent pas être confondues avec ce compteur de
réconciliation.

La campagne reste en dry-run strict et observe des signaux de marché, avec décisions autorisées
mais exécutions `dry_run_blocked`. L'incident contrôlé automatique n'a pas encore eu lieu ; il est
prévu à 40 % de la durée cible. F-11 demeure **OUVERT** jusqu'à une fin
`reason=duration_reached`, une durée effective d'au moins `259 200 000 ms`, un checkpoint final
vérifié, un rapport d'observation factuel et la revue des métriques/incidents complets.

**Statut M32 au 2026-09-14 18:20 EDT : EN COURS — campagne gouvernée saine, 23,375 % accomplis.**

## Clôture — 2026-09-17 01:30 EDT

La campagne gouvernée s'est terminée normalement à `2026-09-17T05:30:13.437Z` avec
`reason=duration_reached` : **259 208 613 ms observées** pour une cible de 259 200 000 ms.
`summary.json` et `COMPLETE` sont présents. Le checkpoint #13,
`state=final_duration_reached`, ancre les 42 195 entrées et se recharge avec
`verified_load=true`.

Résultats finaux : 8 637 métriques, 6 677 cycles avec signal, 2 130 décisions autorisées puis
bloquées par le dry-run, 4 547 rejets position/concentration, zéro alerte et un redémarrage —
l'incident SIGKILL contrôlé, repris en 2,018 s. Les treize checkpoints sont documentés. La mémoire
a toutefois atteint 1 087 896 KiB et termine à 865 472 KiB; cette dérive est conservée comme
risque opérationnel résiduel.

Le vérificateur de lancement retourne 3/4 après clôture car AC-020-01 exige encore un launcher
vivant. Les trois autres critères passent; la preuve terminale distincte (durée, motif,
`COMPLETE`, checkpoint final signé) donne `COMPLETE_PASS`. Les timers de supervision devenus
inutiles ont été arrêtés après ce contrôle.

Le rapport factuel complet est `docs/OBSERVATION-M27-72h-2026-09-14.md`.

**Statut M32 : TERMINÉE — campagne 72 h réalisée et vérifiée. F-11 fermé pour l'exigence
d'observation; NO-GO capital réel inchangé.**
