# Rapport de revue externe Jules — PALLAS-M37 (Revue des correctifs README & PROGRESSION)

## Étape 0 — Vérification de ref préalable

Commandes exécutées :
```bash
git checkout m37-readme-progression-review
git rev-parse HEAD
```

Sortie exacte :
```
f541c7f28ed68008ac7531bae2cc5195bc4eb32e
```

**Confirmation de ref** : Le SHA identifié sur la branche `m37-readme-progression-review` est `f541c7f28ed68008ac7531bae2cc5195bc4eb32e`.

---

## 1. Réévaluation des 3 points bloquants identifiés dans le rapport M36

### Bloquant 1 : Ordre de build Rust pour `npm test`
- **Ancien constat (M36)** : L'instruction `npm ci && npm test` provoquait 13 échecs `MissingBinaryError` car le binaire Rust `risk-engine` devait être pré-compilé.
- **Vérification M37** : `README.md` intègre désormais un avertissement explicite avant la section Démarrage :
  > **Ordre obligatoire : compiler le binaire Rust `risk-engine` AVANT `npm test`.**
  > `npm test` fait échouer 13 tests avec `MissingBinaryError` si le binaire n'existe pas.
- **Résultat** : L'instruction de démarrage est claire et évite tout blocage pour un nouvel arrivant.

### Bloquant 2 : Mode par défaut de la démo Observatory (`PALLAS_LEDGER_MODE=dev`)
- **Ancien constat (M36)** : `npm run observatory:demo` crashait immédiatement sans `PALLAS_LEDGER_MODE=dev` en raison du mode `supervised` exigeant une clé Ed25519.
- **Vérification M37** :
  1. `scripts/observatory-demo.mjs` injecte automatiquement `PALLAS_LEDGER_MODE: process.env.PALLAS_LEDGER_MODE ?? 'dev'`.
  2. `docs/OBSERVATORY.md` documente explicitement ce comportement.
- **Test d'exécution brute (sans aucune variable d'environnement)** :
  Commande :
  ```bash
  npm run observatory:demo
  ```
  Sortie brute observée :
  ```
  > pallas@0.1.0 observatory:demo
  > node scripts/observatory-demo.mjs

  Recherche automatique d’un marché Polymarket actif…
  Marché sélectionné : Will there be no change in Fed interest rates after the September 2026 meeting?
  Best ask actuel    : 0.12
  Outcome            : Yes
  Token              : 561528276087…2205273721
  Pallas Observatory (READ-ONLY / DRY RUN) http://127.0.0.1:4173
  Ouvrir : http://127.0.0.1:4173
  [PALLAS-M24] ATTENTION — LEDGER NON SIGNE accepte (mode dev). Aucune protection cryptographique contre la falsification. Ce mode est INTERDIT pour un run reel (paper trading inclus) : fournir la cle publique Ed25519 et PALLAS_LEDGER_MODE=supervised. ledger=/app/.pallas/ledger.json
  {"event":"run_start","cycles":100,...}
  {"cycle":1,"signal":...}
  ```
- **Résultat** : La démo fonctionne immédiatement en une seule commande sans crash.

### Bloquant 3 : Guide de démarrage sans Nix
- **Ancien constat (M36)** : `README.md` supposait un environnement `nix-shell` sans alternative pour les environnements Linux standard sans Nix.
- **Vérification M37** : `README.md` contient désormais une section B dédiée :
  *« B. Sans Nix (Node 22 + toolchain Rust + linker C) »*
  avec la séquence exacte des commandes (`npm ci`, `cargo build --release --manifest-path crates/risk-engine/Cargo.toml`, `npm test`, `npm run build`, `cargo test`).
- **Résultat** : La procédure pour environnements non-Nix est désormais complète et explicite.

---

## 2. Présentation et mise en avant des bénéfices intrinsèques

Le fichier `README.md` met à présent directement en valeur la rigueur technique du projet dans la section :
**« Pourquoi le lire sérieusement (rigueur documentée) »**

Les forces réelles du projet sont exposées avant toute comparaison externe :
1. **Fail-closed par conception** : Dry-run obligatoire avec confirmation exacte `"LIVE"`, permissions `0600` vérifiées sur les fichiers secrets, rejet des ledgers corrompus.
2. **Couverture de tests exhaustive** : 308 tests TypeScript et 65 tests Rust (`proptest`, stress, sanitisation).
3. **Verrous fichiers fiables** : `FileLock` avec détection de vivacité PID + hostname contre les verrous orphelins.
4. **Piste d'audit traçable** : Audits v0.1 à v0.6 versionnés et associés à des commits vérifiés.

Les notes de comparaison avec le projet précédent (CloddsBot) ont été déplacées au second plan dans une note explicative en bas de la section des réserves (`docs/mvp/CLODDSBOT-COMPARISON.md`).

---

## 3. Visibilité des réserves connues (F-11 et NO-GO capital réel)

Les réserves et limites ne sont pas masquées, mais au contraire mises en évidence dès les premiers paragraphes :
- **Sous-titre du README** : `dry-run par défaut, capital réel non autorisé par l'état d'audit courant`.
- **Section dédiée dans README** : `Réserves connues (à lire, pas à cacher)` rappelle explicitement que **F-11 est ouverte** (campagne 72 h en cours, aucune trace auditée ≥ 72 h à v0.6) et que l'audit v0.6 prononce un **NO-GO capital réel**.
- **Document PROGRESSION.md** : L'état actuel au 2026-09-16 réaffirme en tête de document le statut de l'audit v0.6 (*GO paper trading supervisé — NO-GO capital réel*).

---

## Conclusion

Le travail accompli sur `README.md`, `PROGRESSION.md`, `docs/OBSERVATORY.md` et `scripts/observatory-demo.mjs` résout parfaitement l'ensemble des 3 points bloquants relevés lors de la revue M36, tout en apportant une structure plus lisible et transparente.
