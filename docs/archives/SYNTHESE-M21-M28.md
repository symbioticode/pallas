# Synthèse des missions PALLAS — M21 → M28

> Synthèse établie à partir des huit journaux de mission `docs/mission/mission-PALLAS-M{21..28}-journal.md`.
> Elle ne remplace pas les journaux : chaque affirmation renvoie à sa mission et à sa preuve.

| Métadonnée | Valeur |
|---|---|
| Branche | `missions-M21-M28` |
| Base (`main` figée) | `22e2c53` (commit audité par AUDIT-PALLAS-v0.4) |
| HEAD de la vague | `c4cf4ef` |
| Période | 2026-09-12 (M21→M26, M28) — campagne M27 le 2026-09-13 |
| Agent | DeepSeek Harness (deepseek-flash) |
| Signature | tous les commits sont signés `G Corail Synergia` |
| État global | **7 missions closes (M21–M26, M28) ; 1 mission OUVERTE (M27)** |

---

## 1. Tableau de synthèse

| # | Titre | Finding(s) audit v0.4 | Type | Statut | Commit | Preuve clé |
|---|---|---|---|---|---|---|
| M21 | Suite de tests verte + traçabilité des audits | §3 (2 échecs M13/M16) | Préalable bloquant | ✅ CLOSE | `7259c87` / `5cb237f` | 5×`npm test` verts sur checkout propre (269/269) ; cargo 65/65 |
| M22 | Réconciliation par fills réels | F-03/F-04 | 🔴 Critique | ✅ CLOSE | `b7c6c08` | scénario audit avant/après : `cancelled` → `filled` |
| M23 | Transaction état+ledger, verrou à propriétaire | F-01/F-12 | 🟠 Haute | ✅ CLOSE | `bcb1ad3` | détenteur vivant-lent non volé ; crash réel fenêtre D rattrapé |
| M24 | Ledger signé obligatoire par défaut | F-05 | 🟠 Haute | ✅ CLOSE | `a165327` | falsification audit refusée en mode `supervised` |
| M25 | Kill switch hors API publique | F-06 | 🟠 Haute | ✅ CLOSE | `7e7652b` | `setGlobalKillSwitch` absent de l'entrée publique ; fichier `.pallas/KILL` autoritaire |
| M26 | Alerting fiable (STATE_CORRUPT) | F-10 | 🟠 Haute | ✅ CLOSE | `1108985` | corruption → alerte au point de détection ; retry webhook |
| M27 | Campagne d'observation multi-jours | F-11 | 🟠 Haute (calendaire) | ⏳ **OUVERTE** | `c4cf4ef` | 12 min observées ; **72 h NON atteintes** |
| M28 | Custody : garde + rotation reproductible | F-09 | 🟡/🔴 | ✅ CLOSE | `746056b` | test de convention anti-bypass ; rotation versionnée |

Progression de la suite de tests : **269 → 280 → 285 → 290 → 294 → 298 → 301** (`npm test`, 0 échec), `cargo test --all-targets` 65/65 inchangé (aucun changement Rust).

---

## 2. M21 — Suite de tests réellement verte + traçabilité des audits

**Objectif** : rétablir une suite monorepo verte, diagnostiquée (pas contournée), et trancher le sort des rapports d'audit.

**Fait** :
- Cause racine RÉELLE : timeout du harnais (défaut Vitest 5 s) **inférieur au budget du verrou** (`FileLock.timeoutMs` = 10 s) sur des probes multi-processus à `fsync` (p95 ≈ 4,8 s, max ≈ 8,1 s). Le `Unexpected end of JSON input` de l'audit **n'est pas reproduit** (0/30), mais révélait un défaut latent de lecture.
- Correctif : helper `probeResult()` (diagnostic nommant la probe et son `stderr`) + budget `PROBE_TIMEOUT_MS = 30 s` ; portée inchangée, aucun retry/skip.
- Traçabilité : règle `docs/AUDIT-PALLAS*.md` retirée du `.gitignore` ; v0.2→v0.4 versionnés (v0.1 l'était par accident). Décision dans `.gitignore` + `SECURITY.md`.
- 4 skips identifiés nommément (`sandbox.test.ts`, `runIf(realBwrap)`, M07/M20) — ici bwrap actif donc exécutés.

**Limites** : `Unexpected end of JSON input` non reproduit (non expliqué, instrumenté) ; `cargo build` est une précondition implicite de `npm test` ; flake réduit, pas borné formellement.

---

## 3. M22 — Réconciliation par fills réels (le finding le plus grave)

**Objectif** : ne plus conclure « annulé » par simple absence ; faire converger vers la réalité de l'exchange.

**Fait** :
- Endpoint `GET /data/trades` vérifié sur l'**OpenAPI CLOB officiel** (et non l'API Perps, écartée) ; `ReadTrade` + `getTrades()` + schémas Zod fail-closed.
- Convergence à **trois issues** : ordre ouvert → `ACKED` ; fills ≥ quantité → `TERMINAL/filled` ; fills partiels → `ACKED` (vivant) ; absence confirmée par les DEUX sources → `cancelled` ; une source en erreur ou fenêtre < 60 s → **reste `RECONCILING` et scope bloqué**.
- Annulation confirmée avec fills → `filled` (la position ne disparaît pas de l'exposition). `matchesOpen` n'exige plus l'égalité stricte de taille.

**Preuve** : rejeu contre le code d'avant (`5cb237f`) : `cancelled` → `filled` ; +11 tests ; exposition vérifiée.

**Limites** : attribution des fills heuristique (pas de client order id exposé) ; remplissage partiel compté conservateur ; pas d'endpoint de position consolidée ; aucune requête authentifiée réelle.

---

## 4. M23 — Transaction unifiée état+ledger, verrou à propriétaire

**Objectif** : rapprocher la persistance état+ledger d'une garantie transactionnelle, et identifier le détenteur du verrou.

**Fait** :
- **Choix documenté** : deux fichiers restent séparés (formats/lecteurs différents) + **rattrapage idempotent au démarrage** (`reconcileStateLedger`) pour tout ordre ACKED sans entrée `execution_success`.
- **Verrou à propriétaire** : `owner.json` (pid/hôte/session) + vérification de **vivacité** (signal 0) avant reprise ; un détenteur vivant-lent n'est plus volé.
- Nouveau test de **crash réel** fenêtre D (chemin `attemptPlaceOrder`) ; l'ancien test de construction manuelle conservé.

**Preuves** : détenteur vivant-lent → `FileLockError` et verrou intact ; détenteur mort → repris ; crash réel → `repaired=1` puis idempotent (`repaired=0`) ; 4 fenêtres M13 vertes.

**Limites** : fenêtre de rattrapage différée au redémarrage ; vivacité mono-hôte ; course `unlink+rmdir` non atomique ; balayage du ledger O(n).

---

## 5. M24 — Ledger signé obligatoire par défaut

**Objectif** : faire du mode signé le défaut non contournable hors développement explicite.

**Fait** : `resolveLedgerMode` — **supervised** (défaut) : clé publique **obligatoire**, absence **FATALE** ; **dev** (explicite via `PALLAS_LEDGER_MODE=dev`, ou `PALLAS_TEST_MODE=1` en test) : non signé accepté mais **avertissement bruyant** ; l'Observatory affiche déjà `LEDGER UNSIGNED`. Une valeur d'environnement invalide n'est pas devinée.

**Preuve** : scénario de falsification de l'audit (chaîne recalculée) — accepté en dev (avec warning), **démarrage refusé en supervised** ; falsification signée puis réécrite → rejetée même sans clé (ancrage).

**Précision** : l'**ancrage** index/hash n'est PAS une preuve cryptographique ; la signature Ed25519 exige la clé et est obligatoire en `supervised`.

**Limites** : ancrage distant non implémenté (attaquant ledger + clé privée non arrêté) ; `PALLAS_TEST_MODE` reste une variable d'environnement.

---

## 6. M25 — Kill switch hors surface publique, autorité indépendante

**Objectif** : aucune désactivation silencieuse du kill switch depuis le même process.

**Fait** :
- `setGlobalKillSwitch` **retiré de l'entrée publique** ; seule la lecture est publique ; le désengagement vit dans le sous-chemin réservé `@pallas/execution/kill-switch-authority` (carte `exports` : chemins profonds bloqués).
- `isKillSwitchEngaged` restreint **exactement comme `isDryRun`** (refus hors `PALLAS_TEST_MODE=1`).
- **Autorité externe** : présence de `.pallas/KILL` (ou `PALLAS_KILL_SWITCH_FILE`) → engagement, vérifié à chaque appel ; un désengagement mémoire ne l'annule pas.

**Limites** : pas de service hors process (décision documentée) ; `PALLAS_TEST_MODE` = autorité faible reconnue.

---

## 7. M26 — Alerting fiable : STATE_CORRUPT + durabilité

**Objectif** : émettre l'alerte au moment réel de la détection et rendre l'acheminement plus résilient.

**Fait** :
- Cause racine : le `try` de `main()` ne faisait que **construire** le store (aucune lecture) ; la corruption levée dans `enforceKillSwitch` provoquait un crash **sans alerte**.
- `DurableStateStore.read()` émet `STATE_CORRUPT` au point de détection ; `FileLedger.readChain()` émet `LEDGER_CORRUPT`.
- **Audit des 5 anomalies** : `AMBIGUOUS_ORDER`/`RECONCILE_FAILED`/`KILL_SWITCH` déjà corrects ; `STATE_CORRUPT` et `LEDGER_CORRUPT` corrigés.
- Webhook : **retry borné** ; échec final → ligne `WARN ALERT_DELIVERY_FAILED` (backlog détectable).

**Limites** : pas de queue persistante (pas de rejeu après redémarrage) ; pas d'accusé de réception ; garantie distante = best-effort.

---

## 8. M27 — Campagne d'observation multi-jours ⏳

**Objectif** : observer dans la DURÉE (≥ 72 h) ce que les audits ponctuels ne peuvent pas révéler (stale feeds, dérive mémoire, reconnexion, accumulation).

**Fait (dispositif)** : `scripts/observation-campaign.mjs` (préflight dry-run **vérifié**, process long, `metrics.jsonl`, incident SIGKILL + relance, `summary.json`) ; `PALLAS_REF_CYCLE_SLEEP_MS` ; rapport `docs/OBSERVATION-M27-2026-09-13.md` + artefacts bruts conservés.

**Observé** (12 min, dry-run jamais désactivé) : 93 cycles, **1 SIGKILL contrôlé** à ~290 s et reprise en ~2 s (ledger re-vérifié M16, poursuivi sans perte), ledger 0 → 283 entrées / 101 Ko, RSS ~77–92 Mo, 0 alerte.

**Critères** :

| Critère | État |
|---|---|
| Campagne ≥ 72 h continues | ❌ **NON atteint** (12 min) |
| ≥ 1 incident contrôlé + reprise documentée | ✅ |
| Rapport d'observation factuel | ✅ |
| Dry-run strictement actif, vérifié | ✅ |

**M27 reste OUVERTE** : la campagne complète est à relancer par un opérateur (procédure §7 du rapport).

---

## 9. M28 — Custody : garde par défaut + rotation reproductible

**Objectif** : rendre la garde de permissions réellement empruntée, et produire une rotation reproductible dans le dépôt.

**Fait** :
- **Test de convention** (`secrets-guard-convention.test.ts`) : `decryptPolymarketSecrets` et `PALLAS_POLYMARKET_VAULT` confinés au module garde ; `loadPolymarketSecrets` référencé uniquement par ce module ; `assertFilePermissions` AVANT `readFile`. Un futur chemin non gardé **fait échouer la CI**.
- `scripts/rotate-credentials.mjs` versionné : credentials de **test** générés à la volée, re-chiffrement, ancienne passphrase **rejetée** sur le nouveau vault, `0600`, empreintes seules.
- **Statut honnête** : aucun testnet CLOB → `network.status = skipped` (jamais présenté comme réel) ; procédure fournie.
- `RUNBOOK-key-compromise.md` corrigé (cancel-all livré M14, déclenchable par `.pallas/KILL` M25 ; rotation renvoyant au script).

**Limites** : aucun testnet (limite externe) ; secrets en clair dans le tas JS (M05/M19, inchangé) ; pas de KMS/séparation de process.

---

## 10. Lecture transversale

### 10.1 Findings de l'audit v0.4 traités

| Finding | Mission | État |
|---|---|---|
| F-01 (pas de transaction ACID état+ledger) | M23 | ✅ traité (rattrapage idempotent + fenêtre documentée) |
| F-03/F-04 (faux « cancelled », exposition non autoritative) | M22 | ✅ traité (preuve par fills, limites nommées) |
| F-05 (ledger non signé accepté par défaut) | M24 | ✅ traité (supervised par défaut) |
| F-06 (kill switch mutable) | M25 | ✅ traité (hors API publique + fichier externe) |
| F-09 (garde secrets optionnelle, rotation non reproductible) | M28 | ✅ traité (convention + script versionné) |
| F-10 (STATE_CORRUPT mal câblé) | M26 | ✅ traité (émission au point de détection) |
| F-11 (absence d'observation longue) | M27 | ⏳ **OUVERT** |
| F-12 (verrou repris sur le seul âge) | M23 | ✅ traité (propriétaire + vivacité) |

### 10.2 Décisions d'architecture documentées

- **M23** : état et ledger séparés + rattrapage au démarrage (plutôt que fusion ou outbox complet).
- **M24** : mode `supervised` par défaut, `dev` explicite ; ancrage ≠ preuve cryptographique.
- **M25** : fichier-drapeau externe plutôt qu'un service séparé (décision et limite nommées).
- **M27** : superviseur externe (préflight dry-run) plutôt qu'un flag dans la boucle.

### 10.3 Limites transversales restantes (pistes ouvertes)

1. **M27** : campagne ≥ 72 h non réalisée (seul critère non satisfait de la vague).
2. **Ancrage distant du ledger** (M24) : un attaquant qui contrôle ledger + clé privée n'est pas arrêté.
3. **Service de kill switch hors process** (M25) : non implémenté (fichier-drapeau à la place).
4. **Testnet CLOB Polymarket** (M22/M28) : non disponible → dérivation/révocation réelles non exécutées.
5. **Multi-hôte** (M23) : vivacité par PID locale uniquement ; reprise `unlink+rmdir` non atomique.
6. **Secrets en clair dans le tas JS** (M28, hérité M05/M19) : non résolu.
7. **Aucun chemin live de chargement de secrets** (M28) : absence explicite, désormais garantie par test.

### 10.4 Historique des commits de la vague

| Commit | Objet |
|---|---|
| `7259c87` | M21 — correctif probes + traçabilité des audits |
| `5cb237f` | M21 — journal |
| `b7c6c08` | M22 — réconciliation par fills |
| `bcb1ad3` | M23 — cohérence état+ledger + verrou |
| `a165327` | M24 — ledger signé obligatoire |
| `4a1893d` | normalisation des noms de journaux M22–M25 |
| `7e7652b` | M25 — kill switch hors API publique |
| `1108985` | M26 — alerting fiable |
| `746056b` | M28 — custody + rotation |
| `c4cf4ef` | M27 — dispositif de campagne (mission NON close) |

---

## 11. Conclusion

Sur les huit missions de la vague, **sept sont closes** avec preuves d'exécution et limites explicitement
documentées. La huitième, **M27**, est de nature calendaire : son dispositif est livré et a tourné
12 minutes en dry-run vérifié contre l'API réelle, mais la cible **72 h n'est pas atteinte** et la
mission reste volontairement **OUVERTE** — aucune équivalence n'est revendiquée.