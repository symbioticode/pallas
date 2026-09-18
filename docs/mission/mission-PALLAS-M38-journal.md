# Journal — PALLAS-M38 — Nettoyage post-M32 et fusion vers `main`

Date d'exécution : 2026-09-17  
Statut : **TERMINÉE**

## Résultat

La branche `missions-M21-M28` a été nettoyée, corrigée puis fusionnée dans `main` par un merge
explicite. La version corrigée du workflow CI a été conservée. Les corrections documentaires M37
et la clôture factuelle M32 sont présentes dans l'arbre fusionné.

Points de départ vérifiés :

- `origin/main` : `5d90d92` ;
- `missions-M21-M28` : `b98bfd6` avant les correctifs M38 ;
- branche M37 : `f541c7f` (`m37-readme-progression-review` sur le dépôt distant).

## Nettoyage et documentation

- `git ls-tree -r HEAD | awk '$1=="160000"'` : aucune sortie, donc aucun gitlink restant.
- `find . -name 'jules_session_*' -print` : aucune sortie.
- Le README cite désormais le rapport vérifié
  `docs/mission/mission-PALLAS-M36-jules-review-2.md`, et non la tentative 1 invalidée.
- Les références orphelines `6605d0f` et `c40deed` ont été remplacées dans `PROGRESSION.md` par
  des chemins présents dans l'arbre : `docs/AUDIT-PALLAS-v0.6.md`,
  `docs/mission/mission-PALLAS-M32-journal.md` et
  `docs/OBSERVATION-M27-72h-2026-09-14.md`.
- M32 est documentée avec sa durée réelle de **72 h 00 min 08,6 s**, ses **13 checkpoints
  signés**, son incident SIGKILL contrôlé absorbé et le pic RSS de **1 087 896 KiB (~1,06 GiB)**
  à investiguer. F-11 est présenté comme satisfait par la preuve d'observation, **sous réserve de
  confirmation par audit indépendant**.
- `docs/SYNTHESE-M21-M28.md` a été déplacé vers
  `docs/archives/SYNTHESE-M21-M28.md` et marqué comme remplacé par `PROGRESSION.md`.

Commits préparatoires sur `missions-M21-M28` :

- `cf88381` — déplacement/dépréciation de la synthèse (commit signé automatiquement par la
  configuration Git existante) ;
- `7ee867a` — corrections README/PROGRESSION et ajout de la mission M38 (non signé) ;
- `46c8027` — correction CI séparée, sans `--reporter=text` (non signé).

Aucune signature GPG humaine n'a été demandée ni simulée pour les commits suivants.

## Fusion

La branche a été poussée, puis fusionnée dans `main` avec `--no-ff`. Le conflit attendu dans
`.github/workflows/ci.yml` a été résolu explicitement en conservant :

```yaml
- run: nix-shell --run "npm ci && npm run build && npm run coverage"
```

Le merge obtenu est `1dd0591` (`Merge missions-M21-M28 after M32 and M38 cleanup`), non signé.
La recherche `rg -n -- '--reporter=text' .github/workflows/ci.yml` ne retourne aucune occurrence.

## Validation dynamique sur `main` post-fusion

Commande exécutée dans un checkout de `main` après le merge :

```bash
nix-shell --run 'npm ci && cargo build --manifest-path crates/risk-engine/Cargo.toml && npm run build && npm test && cargo test --manifest-path crates/risk-engine/Cargo.toml && cargo clippy --manifest-path crates/risk-engine/Cargo.toml --all-targets -- -D warnings'
```

Résultats réellement observés :

- build TypeScript : succès ;
- `npm test` : **26 fichiers passés, 310 tests passés, 0 échec, 0 skip** ;
- `cargo test` : **65 passés, 0 échec, 0 ignoré** au total (47 unitaires, 15 CLI,
  3 propriétés ; les cibles `main` et doc-tests contiennent 0 test) ;
- `cargo clippy --all-targets -- -D warnings` : **succès, 0 avertissement**.

`npm ci` a également signalé 3 vulnérabilités de sévérité modérée dans l'arbre de dépendances ;
ce signal n'a pas été masqué et n'affecte pas le résultat des suites ci-dessus.

## État final des branches

Le premier push du journal a placé `origin/main` sur `841bd53`; `git merge-base --is-ancestor
46c8027 HEAD` et l'ensemble des contrôles de fichiers ont ensuite réussi (`FINAL_CHECKS=PASS`).
La branche distante `m37-readme-progression-review` a alors été supprimée.

Git refusait la suppression non forcée de `wip/m37-readme-progression` parce que son commit
`f541c7f` n'était pas un ancêtre topologique de `main`. Avant de la retirer, son patch a été
comparé à celui du commit intégré `2b97d0d` : les deux produisent le même patch-id stable
`e3fbf46a764a1a15a2be328fc9eca02e05ed096b`. La branche locale M37 a donc été supprimée après cette
preuve d'équivalence ; aucune branche locale ou distante dont le nom contient `m37` ne reste.
