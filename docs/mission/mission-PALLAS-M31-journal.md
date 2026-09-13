# Journal de mission — PALLAS-M31

Date : 2026-09-13 (America/Toronto)

## Provenance préalable

Avant toute modification, `git cat-file -t 15722989704315a5b023a952a54c79f2d1052022`
a retourné `commit`. `git log --oneline -1` a identifié :
`1572298 PALLAS-M30: regenerate pinned M27 campaign bundle`.

Le commit complet est `15722989704315a5b023a952a54c79f2d1052022`, avec pour parent
`8ffc8aa550b60d62d352dc5b056f1a38fc034aba`. Il contient le journal M30, le plan M27 mis à jour,
le bundle CT-2026-020 et les deux artefacts d'orchestration. La provenance est donc confirmée : il
s'agit du commit de journal/bundle M30, pas d'une référence orpheline.

## Fermeture du pin

Ajout d'un vérificateur unique piloté par `bundle-manifest.json`. `execute.sh` contrôle les huit
artefacts avant toute mutation, installe les huit chemins, puis contrôle les huit copies.
`dry-run.sh` vérifie les huit hashes en lecture seule. Une fixture temporaire confirme le passage
du jeu intact et le rejet explicite après ajout d'un octet dans un fichier `dist/`.

CT-2026-020 n'a été ni lancé ni modifié comme campagne. Son outillage a été modifié, puis
`verify-test.sh` a été rejoué intégralement.

## Documentation et gel

Le squelette `docs/mvp/` couvre architecture, garanties, limites, exploitation et note de gel. Il
ne rend aucune décision de préparation opérationnelle ; cette décision relève de l'audit v0.6.

Référence : tag annoté `pallas-mvp-freeze-1`. Son message contient le commit exact et les preuves
dynamiques finales, afin d'éviter une auto-référence impossible dans le commit lui-même.

## Validation dynamique finale

À compléter après commit candidat : sorties TypeScript, Rust, Clippy, pins et VERIFY, puis pose du
tag exclusivement si tout est vert.
