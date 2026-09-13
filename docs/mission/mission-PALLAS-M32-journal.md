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

À compléter dynamiquement : build propre du tag, matérialisation et vérification 8/8, dry-run,
contrôle R-09 final, lancement, identité du processus, horodatage, seed/checkpoint signé et premières
mesures de coût réseau.
