# Journal de mission — PALLAS-M37

Date : 2026-09-16 (America/Toronto)

Mission : [`docs/mission/mission-PALLAS-M37-readme-progression.md`](mission-PALLAS-M37-readme-progression.md)
Statut : brouillon rédigé, rejeu effectué, relecture Jules en attente.

## Ref

- Working tree détaché : tag `pallas-mvp-freeze-1` → `e69d7542f79ff3e6a24df60773147a6a2f400986`
  (HEAD des sources, worktree de travail `c34e5aa`).
- Sources lues : rapport M36 (`docs/mission/archives/mission-PALLAS-M36-jules-review.md`),
  relance M36, `docs/mvp/CAPABILITIES.md`, `docs/mvp/CLODDSBOT-COMPARISON.md`, `docs/mvp/README.md`,
  `docs/OBSERVATORY.md`, `README.md` racine, `package.json`, `scripts/observatory-demo.mjs`,
  `packages/ledger/src/file-ledger.ts`, `packages/strategy/src/run-reference-loop.ts`, `shell.nix`.
- Aucune branche git ni PR touchée ; aucune modification de code hors `scripts/observatory-demo.mjs`
  (correctif 2) et `docs/OBSERVATORY.md` (correctif 2).

## Livrables

1. `README.md` (racine) — rééquilibré : bénéfices sourcés M36 §5-6 en tête (fail-closed, 308 TS +
   65 Rust, verrous vivacité, piste d'audit), réserves visibles (F-11, NO-GO capital réel, points
   d'interrogation), CloddsBot en note secondaire (lien vers
   `docs/mvp/CLODDSBOT-COMPARISON.md`), nouvelle section « Démarrage » à deux voies (Nix / sans Nix).
2. `PROGRESSION.md` — historique condensé et sourcé M21→M36, structuré autour de M31 (gel MVP),
   audit v0.6 (GO paper, NO-GO capital réel), M32 (lancement campagne), état actuel ; tableau de
   l'évolution de la suite ; réserves transverses ; section « Comment vérifier ».
3. `docs/OBSERVATORY.md` — correctif 2 appliqué : `PALLAS_LEDGER_MODE=dev` requis pour la démo.
4. `scripts/observatory-demo.mjs` — correctif 2 : `PALLAS_LEDGER_MODE` par défaut `dev` (même
   schéma que `observation-campaign.mjs` ligne 97).

## Preuve de rejeu des 3 correctifs

Rejeu réalisé dans un **worktree git propre** (`/tmp/pallas-m37-replay`, HEAD détachée
`e69d754…)` afin de ne pas interférer avec la campagne supervisée en cours (le travail racine a un
binaire `target/debug` réutilisé par la campagne et le port Observatory 4173 est occupé par elle).

### Correctif 1 — ordre de build obligatoire (`cargo build --release` avant `npm test`)

Échec reproduit (checkout propre, sans build Rust) :

```
Test Files  1 failed | 25 passed (26)
     Tests  13 failed | 295 passed (308)
MissingBinaryError: risk-engine binary not found at: …/crates/risk-engine/target/release/risk-engine.
Build it with: nix-shell --run "cd crates/risk-engine && cargo build --release"
```

Après `cargo build --release --manifest-path crates/risk-engine/Cargo.toml` (24,36 s, shell Nix —
le linker C est fourni par `shell.nix`) puis `npm test` :

```
Test Files  26 passed (26)
     Tests  308 passed (308)
```

→ L'ordre corrigé est documenté en tête de la section Démarrage du README (voies Nix et sans Nix),
avec un avertissement explicite : « compiler le binaire Rust AVANT `npm test` ».

### Correctif 2 — `PALLAS_LEDGER_MODE=dev` pour la démo Observatory

Sans variable (mode `supervised` par défaut) — le FATAL exact de M36 est reproduit :

```
run-reference-loop: FATAL: intégrité du ledger invalide (mode supervised: aucune cle publique de
ledger configuree (publicKeyPem) — le ledger signe est OBLIGATOIRE hors developpement. Fournir la
cle publique, ou poser PALLAS_LEDGER_MODE=dev pour un usage local explicitement non reel.)
```

Avec `PALLAS_LEDGER_MODE=dev` : le démarrage de la boucle s'exécute (plus de FATAL ; le premier
cycle échoue ensuite sur le token de démo hors réseau, comportement hors du correctif).

→ Documenté dans le README (section « Démo Observatory ») et `docs/OBSERVATORY.md` ; le lanceur
`observatory-demo.mjs` définit désormais `dev` par défaut. Remarque : la commande complète
`npm run observatory:demo` n'a pas été exécutée (le port 4173 est occupé par la campagne
supervisée) — la preuve porte sur la séquence d'initialisation du ledger, seul point en cause.

### Correctif 3 — séquence de démarrage sans Nix

Reproduit que `nix-shell` et le linker C ne sont pas fournis partout (sur l'hôte de rejeu :
`nix-shell` présent mais `cc`/`gcc` absents hors shell Nix). La section Démarrage du README donne
désormais une séquence B « Sans Nix — Node 22 + Cargo + linker C » à côté de la voie Nix, incluant
l'ordre de build obligatoire et `cargo install cargo-audit` en note.

## Rééquilibrage (Partie C)

- Ouverture : statut réel (MVP gelé, GO paper / NO-GO capital réel, campagne en cours).
- « Pourquoi le lire sérieusement » : uniquement des éléments sourcés au rapport M36 §5-6
  (fail-closed, 308 TS + 65 Rust, verrous avec vivacité PID/hostname, piste d'audit versionnée).
- Réserve : F-11, NO-GO capital réel, points d'interrogation M36 §5 (ordre de build implicite,
  sandbox bwrap non universel).
- CloddsBot : affilié en note secondaire avec lien vers `docs/mvp/CLODDSBOT-COMPARISON.md` — plus
  aucun argument central du README.

## Relecture Jules (Partie D — à réaliser)

Le brouillon (README + PROGRESSION.md) est prêt. Le second regard par Jules doit vérifier la ref
de la même façon qu'en M36 (lecture depuis la branche/commit de livraison, pas une supposition), et
confirmer que les 3 correctifs sont effectivement documentés et rejouables. **En attente.**

## Contraintes respectées

- Aucune branche/PR git modifiée ni poussée (contenu seul ; publication humaine).
- Aucun processus de la campagne M27/M32 touché ; le rejeu s'est fait dans un worktree isolé.
- Réserves connues (F-11, NO-GO capital réel, interrogations M36 §5) conservées partout.

## Prochaines étapes

- Relecture Jules du brouillon (exigence §4.3 / §7 de la mission).
- Puis publication git par l'humain.