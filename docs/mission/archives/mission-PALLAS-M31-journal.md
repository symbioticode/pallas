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

## Validation dynamique du candidat `09e2eed85819961b98fdbf5cc09b40eebafea7f4`

- `npm test` : **308 passés, 0 échec, 0 ignoré**, 26 fichiers passés. Les quatre tests sandbox
  ignorés dans M30 ont pu s'exécuter ici ; le résultat observé remplace donc honnêtement le chiffre
  attendu 304/0/4 pour ce rejeu.
- `cargo test --all-targets` : **65 passés, 0 échec, 0 ignoré** (47 unitaires, 15 CLI,
  3 propriétés).
- `cargo clippy --all-targets --all-features -- -D warnings` : **vert** dans le shell Nix épinglé.
- pins : **8/8 PASS** ; fixture avec un octet ajouté à
  `packages/execution/dist/dryRun.js` : **REJECTED** explicitement.
- `verify-test.sh` complet : fixture ledger valide **PASS**, signature altérée **REJECTED**.

Après cette mise à jour documentaire, les mêmes validations sont rejouées sur le commit de clôture.
Le tag n'est posé que si elles restent toutes vertes ; son annotation enregistre le hash exact.
