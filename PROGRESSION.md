# PALLAS — PROGRESSION et état documenté (M21 → M36)

Historique condensé et vérifiable de la montée en maturité de Pallas, à destination d'un lecteur
externe (nouvel arrivant, évaluateur, audit). Ce document n'introspecte pas : chaque jalon cite une
source versionnée (journal de mission, audit) que le lecteur peut rejouer.

Réf. baseline : tag `pallas-mvp-freeze-1` → commit `e69d7542f79ff3e6a24df60773147a6a2f400986`
(`git rev-parse "pallas-mvp-freeze-1^{commit}"`).

---

## État actuel (2026-09-16)

- **MVP gelé** sur `pallas-mvp-freeze-1` ; documentation de capacité :
  [`docs/mvp/CAPABILITIES.md`](docs/mvp/CAPABILITIES.md) (19/19 capacités sourcées mission + audit).
- **Audit v0.6** : **GO paper trading supervisé — NO-GO capital réel** (moyenne 3,9/5,
  F-11 ouverte). Preuve versionnée : `git show 6605d0f:docs/AUDIT-PALLAS-v0.6.md`.
- **Campagne supervisée en cours** : démarrée le 2026-09-13T20:37:22.562Z (journal M32, `git show
  c40deed:docs/mission/mission-PALLAS-M32-journal.md`), ledger `supervised`, cible 72 h.
- **Revue externe indépendante (M36)** : tentative 1 invalidée (mauvais commit), relance vérifiée
  sur la baseline ; 3 points bloquants corrigés dans le README et 6 axes de qualité documentés.
- **Limite transversale** : **F-11 reste ouverte** — aucune campagne ≥ 72 h n'est *auditée* à ce
  jour. Le capital réel reste **NO-GO** dans tous les audits.

---

## Jalons

### M21 — Suite réellement verte, audits versionnés (2026-09-12)

- 5 exécutions consécutives `npm test` vertes sur checkout propre : **22 fichiers, 269 passed /
  0 failed / 0 skip** ; `cargo test --all-targets` : **65 passed / 0 failed**. Cause racine de la
  flakiness diagnostiquée (timeout du harnais < budget du verrou). Décision : versionner les
  audits `docs/AUDIT-PALLAS-v*.md`.
- Source : [`docs/mission/archives/mission-PALLAS-M21-journal.md`](docs/mission/archives/mission-PALLAS-M21-journal.md).

### M22 — Réconciliation par fills réels (2026-09-12)

- Lecture de l'historique trades/fills (OpenAPI CLOB officiel) ; un ordre totalement rempli n'est
  plus conclu « annulé ». Suite : **280 passed / 0 failed**.
- Source : [`docs/mission/archives/mission-PALLAS-M22-journal.md`](docs/mission/archives/mission-PALLAS-M22-journal.md).

### M23 — Transaction unifiée état + ledger (2026-09-12)

- Rattrapage idempotent au démarrage (ordre ACKED sans trace `execution_success`) ; verrou à bail
  avec propriétaire (PID + hôte + session) et détection de vivacité. Crash réel rejoué (fenêtre D).
  Suite : **285 passed / 0 failed**.
- Source : [`docs/mission/archives/mission-PALLAS-M23-journal.md`](docs/mission/archives/mission-PALLAS-M23-journal.md).

### M24 — Ledger signé obligatoire par défaut (2026-09-12)

- Mode `supervised` (défaut) exige la clé publique Ed25519 — absence FATALE ; `dev` accepte un
  ledger non signé avec avertissement bruyant (explicitement non probant). Suite : **290 / 0**.
- Source : [`docs/mission/archives/mission-PALLAS-M24-journal.md`](docs/mission/archives/mission-PALLAS-M24-journal.md).

### M25 — Kill switch hors surface publique (2026-09-12)

- `setGlobalKillSwitch` retiré de l'API publique ; autorité externe par fichier `.pallas/KILL`
  vérifiée à chaque appel ; injection restreinte à `PALLAS_TEST_MODE=1`. Suite : **294 / 0**.
- Source : [`docs/mission/archives/mission-PALLAS-M25-journal.md`](docs/mission/archives/mission-PALLAS-M25-journal.md).

### M26 — Alerting fiable (2026-09-12)

- `STATE_CORRUPT` émis au point de détection réel ; `LEDGER_CORRUPT` câblé ; retries webhook
  bornés + marqueur d'échec de livraison. Suite : **298 / 0**.
- Source : [`docs/mission/archives/mission-PALLAS-M26-journal.md`](docs/mission/archives/mission-PALLAS-M26-journal.md).

### M27 — Première campagne d'observation (2026-09-13)

- Superviseur `scripts/observation-campaign.mjs`, pause entre cycles, rapport d'observation.
  Constat honnête : **93 cycles / 12 min**, 1 redémarrage après SIGKILL provoqué (reprise ~2 s),
  **cible 72 h NON atteinte** → F-11 reste ouverte.
- Source : [`docs/mission/archives/mission-PALLAS-M27-journal.md`](docs/mission/archives/mission-PALLAS-M27-journal.md).

### M28 — Custody des credentials (2026-09-12)

- Convention 0600 testée contre tout contournement futur ; rotation versionnée dans le dépôt.
  Limite assumée : aucun testnet CLOB accessible, rotation/révocation plateforme non prouvée.
  Suite : **301 / 0**.
- Source : [`docs/mission/archives/mission-PALLAS-M28-journal.md`](docs/mission/archives/mission-PALLAS-M28-journal.md).

### M29 — Fermeture des aberrations audit v0.5 (2026-09-13)

- R-01 : réconciliation indépendante du signal (chaque cycle, avant le signal) ; R-02 : KILL →
  cancel-all réel ; R-03 : provenance des hash assainie et gardée par test. Suite : **304 / 0**.
  **F-11 reste OUVERT.**
- Source : [`docs/mission/archives/mission-PALLAS-M29-journal.md`](docs/mission/archives/mission-PALLAS-M29-journal.md).

### M30 — Correctifs audit v0.5.2 (2026-09-13)

- Rejeu réel de la suite (**304 passed / 0 failed / 4 skips = 308**) ; kill switch évalué à chaque
  cycle + réarmement ; coût réseau de la réconciliation réduit (**10 → 6 appels** à N=5) avec
  single-flight intra-processus.
- Source : [`docs/mission/archives/mission-PALLAS-M30-journal.md`](docs/mission/archives/mission-PALLAS-M30-journal.md).

### M31 — Gel du MVP : tag `pallas-mvp-freeze-1` (2026-09-13) ⭐ jalon

- Vérification par hash étendue aux **8 artefacts** (avant/après installation) ; tag annoté ;
  rejeu **308/0/0 TS, 65/0 Rust, Clippy vert**, pins 8/8 PASS, fixture altérée → REJECTED.
  Squelette `docs/mvp/` sans affirmation de statut (le jugement passe à l'audit v0.6).
- Sources : [`BASELINE-FREEZE.md`](docs/mvp/BASELINE-FREEZE.md),
  [`docs/mission/archives/mission-PALLAS-M31-journal.md`](docs/mission/archives/mission-PALLAS-M31-journal.md).

### Audit v0.6 — GO paper / NO-GO capital réel ⭐ jalon

> **GO campagne de paper trading supervisée : OUI** — les quatre blocages nommés par v0.5.2 sont
> levés, rejoués indépendamment sur le tag. **Moyenne 4/5 : NON atteinte — 3,9/5** (4,1 / 3,7 /
> 4,0). **Capital réel : NO-GO** (portefeuille non autoritatif, attribution des fills heuristique,
> aucun ack/fill live, custody incomplète). **F-11 reste OUVERT.**

- Source : `git show 6605d0fe5165d59a4279969286b98400c85ee03c:docs/AUDIT-PALLAS-v0.6.md`
  (absent du checkout, versionné en git).

### M32 — Lancement de la campagne supervisée (2026-09-13) ⭐ jalon

- Bundle matérialisé (R-07) : 8 artefacts reconstruits au chemin canonique, **8/8 PASS** ; rejeu à
  blanc `CT_DRY_RUN=PASS`, `verify.sh` 4/4 ; lancement réel le **2026-09-13T20:37:22.562Z**,
  ledger `supervised`, cible 4 320 min.
- Source : journal M32 : `git show c40deed:docs/mission/mission-PALLAS-M32-journal.md` (absent du
  checkout, versionné en git).

### M33 — UI Observatory mise à niveau (2026-09-14)

- Baseline affichée dynamiquement (tag + commit + verdict v0.6), panneau Campagne lecture seule,
  indicateur de source du kill switch, frontière réduite à deux routes. **Non audité post-M33** :
  documenté, pas crédité comme fermé.
- Source : [`docs/mission/archives/mission-PALLAS-M33-observatory-ui.md`](docs/mission/archives/mission-PALLAS-M33-observatory-ui.md).

### M34 — Documentation MVP : capacités + comparaison ciblée (2026-09-14)

- Livrables : `docs/mvp/CAPABILITIES.md` (19/19 sourcées mission + audit) et
  `docs/mvp/CLODDSBOT-COMPARISON.md` (18 points, sans surclaim).
- Source : [`docs/mission/archives/mission-PALLAS-M34-mvp-docs-capabilities.md`](docs/mission/archives/mission-PALLAS-M34-mvp-docs-capabilities.md).

> **M35 n'existe pas** : la séquence passe de M34 à M36 (aucune mission M35 dans l'historique du
> dépôt).

### M36 — Revue externe Jules, relance vérifiée (2026-09-16)

- **Tentative 1 invalidée** (Jules avait lu `origin/main` ~ commit M20 `22e2c530…`, jamais le tag).
- **Relance** : Étape 0 obligatoire, `git rev-parse HEAD` = `e69d7542…` collé en tête de rapport.
- **6 axes** couverts (lisibilité, architecture, UI exécutée réellement, exécutabilité avec sorties
  brutes, rigueur perçue, autres critères) + **liste nécessaire et suffisante des 3 bloquants**
  (ordre de build Rust non précisé, `PALLAS_LEDGER_MODE=dev` manquant pour la démo Observatory,
  absence de guide sans Nix) — tous trois corrigés dans le README (M37).
- Sources : [`docs/mission/archives/mission-PALLAS-M36-jules-review.md`](docs/mission/archives/mission-PALLAS-M36-jules-review.md),
  [`docs/mission/archives/mission-PALLAS-M36-jules-review-relance.md`](docs/mission/archives/mission-PALLAS-M36-jules-review-relance.md).

---

## Évolution de la suite de tests (trace vérifiable)

| Étape | TS (passed/failed) | Rust |
|---|---:|---:|
| M21 | 269 / 0 | 65 / 0 |
| M22 → M26 | 280 → 298 / 0 | 65 / 0 |
| M28 | 301 / 0 | 65 / 0 |
| M29 | 304 / 0 | 65 / 0 |
| M30 (rejeu) | 304 / 0 (+4 skips = 308) | 65 / 0 |
| M31 / audit v0.6 | **308 / 0 / 0** | **65 / 0** |

Chaque chiffre a été rejoué indépendamment sur checkout propre (audit v0.6 §§1–3) ; les 4 tests
sandbox `bwrap` sont skippés sur les hôtes sans netns (comportement documenté, pas une réussite).

## Réserves transverses (ne pas perdre de vue)

- **F-11 ouverte** : pas d'observation auditée ≥ 72 h.
- **Capital réel NO-GO** : portefeuille exchange non autoritatif, attribution des fills
  heuristique, aucun ack/fill live, custody et rotation plateforme incomplètes.
- **Réconciliation** : REST/polling, pas de WebSocket utilisateur, single-flight intra-processus.
- **Durabilité** : fichiers locaux, pas de transaction ACID commune, pas d'ancrage distant/WORM.
- **Kill switch** : dépend de la boucle active et d'un exchange joignable.
- **Sandbox** : disponibilité et preuve réseau dépendantes de l'hôte ; lecture du filesystem
  accessible non confidentielle.
- **Exécution/stratégie** : EOA seulement, aucun ordre live/testnet audité, Kelly illustratif,
  aucun backtest ni calibration économique.

## Comment vérifier

```bash
git rev-parse "pallas-mvp-freeze-1^{commit}"                # e69d754…
git show 6605d0fe5165d59a4279969286b98400c85ee03c:docs/AUDIT-PALLAS-v0.6.md
git show c40deed:docs/mission/mission-PALLAS-M32-journal.md
```