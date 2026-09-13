# Audit indépendant de Pallas v0.5

**Date de l'audit :** 12 septembre 2026 (America/Toronto)

**Dépôt :** `/home/andrei/Projects/80_PALLAS/pallas`

**Branche / commit :** `missions-M21-M28` / `007572148c216de09c33dd99b16e5092332352a6` *(hash d'origine — 42 caractères hexadécimaux — invalide ; corrigé par PALLAS-M29, voir `AUDIT-PALLAS-v0.5.1.md`)*

**État Git initial :** propre ; aucune modification de code pendant l'audit (vérifications seules).

**Nature :** audit technique indépendant de la vague PALLAS-M21 à M28, centré sur la question : les missions ont-elles **véritablement** comblé les failles exposées par l'audit v0.4 ? Commit de référence de la vague : `22e2c53075ba8e3bb6a89c59db773f5521360087` (ce que v0.4 a audité).

## 1. Verdict exécutif

**Niveau de maturité : 2/5 — socle fortement consolidé au niveau code/tests ; le niveau 3 reste subordonné à la réconciliation exacte des fills et à une observation multi-jours réelle.**

La vague M21–M28 répond bien à la question posée : **elle ferme au niveau code + tests la quasi-totalité des failles v0.4.** Sur huit failles/points ouverts, sept sont closes dans le code : la fausse conclusion « cancelled » (F-03) dispose désormais d'une source de preuve positive (trades/fills, M22), le ledger est signé **par défaut** en mode `supervised` (F-05, M24), le kill switch est sorti de la surface publique et doté d'une autorité externe par fichier (F-06, M25), l'alerte `STATE_CORRUPT` est émise au point de détection réel avec webhook à retry borné (F-10, M26), la garde des secrets est rendue obligatoire par un test de convention (F-09, M28), le verrou est marqué d'un propriétaire vivant (F-12, M23), et la suite TypeScript est verte (301/301), avec thresholds de couverture tous dépassés (M21). Le point le plus fragile de v0.4 (fenêtre D testée par construction manuelle) est levé par un crash réel sur le chemin de production (M23).

Deux limites vraies subsistent, et l'audit les ouvre comme **constats résiduels** :
- **R-01 (élevée)** — `reconcileAtStartup` est du **code mort** ([`packages/strategy/src/reconciliation.ts:389`](../packages/strategy/src/reconciliation.ts)) : jamais appelé par l'orchestrateur. La reconstruction des ordres ouverts/positions externes au démarrage n'est pas câblée ; le rattrapage état↔ledger ne se déclenche que dans un cycle **ayant un signal** ([`packages/strategy/src/run-reference-loop.ts:223`](../packages/strategy/src/run-reference-loop.ts), [`packages/strategy/src/run-reference-loop.ts:232`](../packages/strategy/src/run-reference-loop.ts)). Le critère v0.2.1 « reconstruction des positions/ordres au démarrage » reste donc non satisfait.
- **R-02 (moyenne)** — l'attribution des fills/reconnaissance reste **heuristique** (prix/côté/taille dans une fenêtre, sans client order id), limite d'API Polymarket documentée ; risque de double comptage conservateur en cas d'ordres jumeaux ([`packages/strategy/src/reconciliation.ts:271`](../packages/strategy/src/reconciliation.ts)).

**F-11 demeure OUVERT.** La « campagne d'observation » M27 a duré **720,7 s** (12 min, `target_minutes: 12`), sur le commit `1108985` (= M26, pas la HEAD auditée), en mode dev (ledger non signé), et **93/93 cycles étaient `no_signal`** : aucun marché actif ni carnet n'était disponible via l'API publique, donc aucun chemin décision/état/exécution n'a été observé. Le dispositif superviseur (préflight dry-run, metrics, summary, reprise SIGKILL ~2 s) est réel et fonctionne ; **aucune conclusion de robustesse ne peut en être tirée**, ce que le rapport M27 lui-même reconnaît.

### Avertissement de dépendance M13 — levé par la vague

v0.4 conditionnait les scores M14–M16/M20 au fait que la fenêtre D était testée par construction manuelle d'un `ACKED`. Cela n'est plus vrai : le hub de fenêtres contient désormais un **crash réel sur le chemin de production** (`attemptPlaceOrder` → crash → redémarrage → rattrapage idempotent via `reconcileStateLedger`), qui passe ([`packages/strategy/src/crash-windows.test.ts:217`](../packages/strategy/src/crash-windows.test.ts)). La fenêtre D (ACKED durable, entrée ledger absente, réparation à la relance) est maintenant rejouée sur la vraie séquence.

## 2. Méthode et référentiel externe

La grille v0.4 est reprise à l'identique : **Fidélité d'exécution / Gestion des risques / Viabilité opérationnelle**, confrontée aux pratiques externes (SEC Rule 15c3-5, FIA Automated Trading Risk Controls 2024, documentation Polymarket sur les ordres **et** les trades/fills, GitHub secure-use). Niveaux de preuve inchangés : **dynamique** (commande réellement exécutée), **code** (fichier:ligne), **documentaire** (affirmation non reproduisible), **non vérifiable**. Chaque verdict de mission a été confronté au code réel et à des tests rejoués, non à la seule synthèse M21–M28.

## 3. Résultats d'exécution

| Vérification | Résultat réel |
|---|---|
| `npm test` monorepo (vague auditable) | **301 passed, 25 fichiers, 0 failed** sur `0075721` (prétest = build `tsc` inclus) — comme revendiqué, la suite monorepo est verte |
| Coverage v8 (`npm run coverage`) | seuils tous dépassés : Statements **86,56** ≥ 80 · Branches **79,59** ≥ 75 · Functions **93,14** ≥ 85 · Lines **86,56** ≥ 80 |
| `cargo test` (risk-engine) | **65 passed** (47 unit + 15 cli + 3 propriétés), 0 failed |
| `cargo clippy` | **non vérifiable localement** : composant clippy absent du toolchain (pas de `rustup`, toolchain gérée par nix) — aucune modification Rust dans la vague (`git diff 22e2c53..HEAD -- crates/` vide), la gate clippy de v0.4 reste le dernier état connu |
| sélection adversariale ciblée (7 fichiers audits) | **106 passed, 0 failed** : reconnaissance (F-03/F-04), fenêtres de crash (A–D réel), état corrompu→alerte, ledger falsifié signé/non signé, verrou vivant/mort, kill switch externe |
| CI GitHub distante | **non vérifiable** : credentials `gh` toujours indisponibles sur ce poste ; aucun run du commit audité n'est crédité |

L'exigence « suite verte sur checkout propre » est maintenant satisfaite **côté TS et Rust**, ce qui était le verrou §3 de v0.4.

## 4. Axe 1 — Fidélité d'exécution

### 4.1 F-03/F-04 (M22) : la preuve positive par trades est réelle

`reconcileOrder` converge désormais vers trois sorties (ACKED vivant / TERMINAL / UNCHANGED) en s'appuyant sur **deux** sources au lieu d'un scan des seuls ordres ouverts : `getOpenOrders` **et** `getTrades` (`GET /data/trades`, lecture authentifiée L2, autorisée en dry-run sans effet de bord) ([`packages/execution/src/polymarketClient.ts:557`](../packages/execution/src/polymarketClient.ts), [`packages/strategy/src/reconciliation.ts:150`](../packages/strategy/src/reconciliation.ts), [`packages/strategy/src/reconciliation.ts:271`](../packages/strategy/src/reconciliation.ts)). La condition « cancelled » n'est légitime que si l'ordre est absent des **deux** sources **après** la fenêtre de grâce de 60 s ([`packages/strategy/src/reconciliation.ts:62`](../packages/strategy/src/reconciliation.ts), [`packages/strategy/src/reconciliation.ts:349`](../packages/strategy/src/reconciliation.ts)).

Rejoué :
- **scénario audit v0.4 exact** : ordre totalement rempli, absent des ordres ouverts, sans order_id → `reconciled_filled_by_trade`, **jamais** `cancelled` ([`packages/strategy/src/reconciliation.test.ts:330`](../packages/strategy/src/reconciliation.test.ts)) ;
- remplissage **partiel** → reste `ACKED`, ni filled ni cancelled ([`reconciliation.test.ts:353`](../packages/strategy/src/reconciliation.test.ts)) ;
- ordre récent avec les deux sources vides → `RECONCILING`, pas de cancelled prématuré ([`reconciliation.test.ts:399`](../packages/strategy/src/reconciliation.test.ts)) ;
- une seule source en erreur → **aucune** conclusion, scope bloqué ([`reconciliation.test.ts:376`](../packages/strategy/src/reconciliation.test.ts)).

Réserve restante (→ **R-02**) : l'attribution d'un trade à l'ordre vient d'un match prix/côté/taille borné par la taille de l'ordre dans une fenêtre de 5 min, sans client order id (non exposé par l'API). C'est acceptable en sécurisation (erreur conservatrice), pas une identification cryptographique.

### 4.2 F-01 + fenêtre D (M23) : réparation idempotente, mais rattrapage paresseux

`reconcileStateLedger` repère un `ACKED` durable porteur d'un `order_id` sans entrée d'audit et le répare de manière idempotente au cycle suivant ([`packages/strategy/src/run-reference-loop.ts:410`](../packages/strategy/src/run-reference-loop.ts)). Le crash réel sur `attemptPlaceOrder` puis redémarrage rattrape les deux entrées correctement ([`crash-windows.test.ts:217`](../packages/strategy/src/crash-windows.test.ts)).

**Deux limites ne sont pas levées par la vague :**
1. Ce rattrapage n'est atteint que dans un cycle **doté d'un signal** ([`run-reference-loop.ts:223`](../packages/strategy/src/run-reference-loop.ts)) ; il n'existe **pas** d'appel au démarrage. L'analyse exhaustive le prouve : `reconcileAtStartup` ([`reconciliation.ts:389`](../packages/strategy/src/reconciliation.ts)) n'est référencé que par son fichier de test ([`reconciliation.test.ts:577`](../packages/strategy/src/reconciliation.test.ts)), jamais par `run-reference-loop.ts`. → **R-01**. Conséquence directe : en l'absence de signal (exactement le cas de la campagne M27), rien n'est réconcilié du tout.
2. L'état et le ledger restent **deux fichiers écrits séparément** : il n'y a toujours pas de transaction ACID commune (intent, ack brut, fills, position). La réparation colmate la trace d'audit manquante mais pas l'atomicité pendant la fenêtre D.

### 4.3 F-12 (M23) : verrou propriétaire + vivacité

Le verrou écrit un `owner.json` (pid, hostname, sessionId, startedAt) et, avant toute reprise après `staleMs`, vérifie que le détenteur est **mort** (signal 0) ; détenteur vivant mais lent → le verrou n'est **jamais** repris. Rejoué : propriétaire vivant lent → non repris ; détenteur mort → repris ; verrou anonyme récent → attendu ([`packages/core/src/file-lock.test.ts`](../packages/core/src/file-lock.test.ts)). Limite documentée du module : verrou local mono-hôte, reprise non atomique — cohérent pour le run boucle single-host.

### 4.4 F-05 (M24) : signature par défaut, plus une option

Le mode est résolu `explicite > env > test > défaut` avec **`supervised` par défaut** ([`packages/ledger/src/file-ledger.ts:90`](../packages/ledger/src/file-ledger.ts), [`file-ledger.ts:104`](../packages/ledger/src/file-ledger.ts)). En `supervised`, l'absence de clé publique est **FATALE** au démarrage ([`file-ledger.ts:127`](../packages/ledger/src/file-ledger.ts)) ; en `dev` sans clé, acceptation avec avertissement bruyant. Rejoué : falsification **non signée** → acceptée en dev (avertissement), refusée par le démarrage supervisé ; falsification **signée puis chaîne réécrite** → rejetée **même sans clé publique** (ancrage actif) ; troncature après signature → détectée ; checkpoint signé par une autre clé → invalide ([`packages/ledger/src/ledger-signing.test.ts`](../packages/ledger/src/ledger-signing.test.ts)). L'outil opérateur `sign-ledger` (gen/sign) tient la clé privée séparément du process ([`packages/ledger/src/sign-ledger.ts`](../packages/ledger/src/sign-ledger.ts)) → **R-03** : la re-signature périodique reste une action manuelle, bloquante au démarrage si absente (fail-stop voulu, inertie opérationnelle possible).

### 4.5 F-06 (M25) : autorité externe du kill switch

L'entrée publique n'exporte que la **lecture** et l'erreur du flag ([`packages/execution/src/index.ts:3`](../packages/execution/src/index.ts)) ; `setGlobalKillSwitch` vit dans le sous-chemin réservé `@pallas/execution/kill-switch-authority`, verrouillé par la table `exports` de `package.json` ([`packages/execution/package.json:6`](../packages/execution/package.json)). Rejoué : `setGlobalKillSwitch` **n'apparaît pas** dans l'entrée publique ; `isKillSwitchEngaged` est refusé hors `PALLAS_TEST_MODE=1` ; le fichier-drapeau **externe** `.pallas/KILL` engage le kill switch et ne peut **pas** être désengagé en mémoire ([`packages/execution/src/polymarketClient.test.ts`](../packages/execution/src/polymarketClient.test.ts), bloc PALLAS-M25). `placeOrder` → `KillSwitchEngagedError` sans aucun POST.

### 4.6 F-10 (M26) : alerte STATE_CORRUPT au point de lecture

`emitAnomaly('STATE_CORRUPT', …)` est émis **là où la corruption est détectée** (lecture fail-stop) puis `StateCorruptionError` est levée ([`packages/strategy/src/durable-state.ts:303`](../packages/strategy/src/durable-state.ts)) ; le démarrage fait une vraie lecture (`store.read()` sous garde) ([`run-reference-loop.ts:686`](../packages/strategy/src/run-reference-loop.ts)). Le webhook est maintenant un retry **borné** avec backoff, et un échec final persiste une ligne WARN `ALERT_DELIVERY_FAILED` ([`packages/core/src/observability.ts:12`](../packages/core/src/observability.ts)). Rejoué : checksum falsifié et JSON tronqué émettent tous deux l'alerte persistée.

**Note axe 1 : 4,0/5.** Les trois failles critiques/élevées de v0.4 (faux cancelled, ledger unsigned accepté, kill switch mutable) sont closes dans le code avec tests rejoués. Le plafond vient de R-01 (rattrapage non câblé au démarrage), de l'absence de toute preuve live/testnet (aucun ack réel, aucun fill réel) et du maintien de deux fichiers non transactionnels.

## 5. Axe 2 — Gestion des risques

La contamination « faux cancelled → exposition retirée » identifiée en v0.4 est supprimée : une position prouvée remplie par les trades **compte désormais dans l'exposition** ([`reconciliation.test.ts:447`](../packages/strategy/src/reconciliation.test.ts)). La limite cumulée n'est donc plus effacée par une fausse annulation. Le contrat `TradeRequest`/`RiskConfig` et les limites autoritatives ne changent pas (aucun diff Rust).

En revanche, **F-04 reste partiellement ouvert** : les balances, le collateral et le regroupement réel par événement ne sont toujours pas ingérés ; l'exposition part de la machine locale ([`packages/strategy/src/durable-state.ts:157`](../packages/strategy/src/durable-state.ts)) enrichie de la preuve positive par trades. C'est prudent mais pas un portefeuille exchange autoritatif.

**Note axe 2 : 3,6/5.** Le changement le plus significatif est structurel : l'exposition ne peut plus être **sous-estimée** par une fausse annulation. Elle le reste par des formes non ingérées (balances/collateral) — d'où le plafond sous 4.

## 6. Axe 3 — Viabilité opérationnelle

- **Suite verte + gates de couverture** : 301/301 TS et 65/65 Rust ; les quatre thresholds de couverture passent. Le verrou §3 de v0.4 (« suite monorepo rouge ») est levé. Les probes 2-processus (M13/M16) passent grâce à `probeResult` strict + `PROBE_TIMEOUT_MS=30s` ([`packages/strategy/src/concurrency-probe.test.ts:36`](../packages/strategy/src/concurrency-probe.test.ts)).
- **Traçabilité des audits** : les rapports d'audit sont versionnés (M21), `coverage/` et `.pallas/` exclus de git.
- **Garde des secrets obligatoire (F-09/M28)** : un test de convention balaye le code de production et échoue si `decryptPolymarketSecrets` / `PALLAS_POLYMARKET_VAULT` sort du module garde ; le seul « appelant » de `loadPolymarketSecrets` est le module garde lui-même, et la garde POSIX précède la lecture ([`packages/execution/src/secrets-guard-convention.test.ts`](../packages/execution/src/secrets-guard-convention.test.ts)). `rotate-credentials.mjs` est dans le dépôt. **Aucun chemin live ne charge encore de secrets** (absence explicite, gardée par le test) ; pas de rotation plateforme réelle démontrée.
- **Observation (F-11) : OUVERT.** Voir Verdict : 720,7 s sur `1108985`, 93/93 cycles `no_signal`, état durable jamais écrit (0 octet), ledger non signé (dev), 1 SIGKILL injecté repris en ~2 s, RSS 92 Mo, 0 alerte ([`docs/observation/M27-2026-09-13/summary.json`](observation/M27-2026-09-13/summary.json), [`docs/OBSERVATION-M27-2026-09-13.md`](OBSERVATION-M27-2026-09-13.md)). Le rapport M27 est **exemplaire** de limite honnête ; il n'apporte aucune preuve de tenue de durée, de chemin décision, ou de trace signée.
- **Limites environnementales** : clippy non rejouable (composant clippy absent du toolchain, pas de `rustup`) ; CI distante non vérifiable (pas de `gh` valide) ; la HEAD auditable `0075721` n'a elle-même jamais été observée par le dispositif M27 (qui a tourné sur `1108985`).

**Note axe 3 : 3,4/5.** Gains majeurs : suite verte, alerte state vraie, webhook à retry borné, garde secrets enforcee. Le plafond est F-11 (observation réelle inexistante) coupé de la non-vérifiabilité CI/clippy.

## 7. Score comparatif

| Axe | v0.2.1 | v0.3 | v0.4 | v0.5 | Progression v0.4→v0.5 démontrée |
|---|---:|---:|---:|---:|---|
| Fidélité d'exécution | 2,7/5 | N/P | 3,3/5 | **4,0/5** | fills→preuve positive, fenêtre D réelle, kill switch externalisé, ledger signé par défaut ; R-01 et pas de live plafonnent |
| Gestion des risques | 2,0/5 | N/P | 3,1/5 | **3,6/5** | positions remplies comptent dans l'exposition ; portefeuille reste non autoritatif |
| Viabilité opérationnelle | 1,6/5 | N/P | 2,4/5 | **3,4/5** | suite verte + coverage, alerte state câblée, garde enforcee ; F-11 ouvert, clippy/CI non vérifiés |
| **Moyenne arithmétique** | **2,1/5** | niveau 2/5 | **2,9/5** | **3,67/5** | le socle code/tests atteint le haut de la bande 2 |

**Le niveau de maturité reste 2/5.** La méthode v0.4 posait le niveau 3 comme conditionné par (a) une réconciliation exacte des fills et (b) une observation paper réelle multi-jours. Ni l'un ni l'autre n'est acquis : l'attribution reste heuristique (R-02) et F-11 est ouvert (720 s sans signal). Le socle code/tests est désormais suffisant pour tenter la campagne ; il ne l'a pas encore été.

## 8. Risques financiers restants

| ID | Sévérité v0.4 | État v0.5 | Preuve | Condition de levée |
|---|---|---|---|---|
| **F-03/F-04** | Critique | **Fermé (code + tests)** ; live non vérifié ; → R-02 | `getTrades` ([`polymarketClient.ts:557`](../packages/execution/src/polymarketClient.ts)), convergence 3 issues ([`reconciliation.ts:150`](../packages/strategy/src/reconciliation.ts)), scénario audit rejoué ([`reconciliation.test.ts:330`](../packages/strategy/src/reconciliation.test.ts)) | exercice live avec credentials L2 + maker réel ; borner l'attribution heuristique |
| **F-01** | Élevée | **Partiellement corrigé** — fenêtre D réparée, rattrapage non câblé au démarrage (→ R-01) | `reconcileStateLedger` ([`run-reference-loop.ts:410`](../packages/strategy/src/run-reference-loop.ts)), crash réel ([`crash-windows.test.ts:217`](../packages/strategy/src/crash-windows.test.ts)), `reconcileAtStartup` jamais appelé | câbler le rattrapage au démarrage (sous verrou) ; optionnellement WAL/transaction commune |
| **F-04** | Élevée | Partiellement corrigé — exposition compte les remplissages prouvés ; balances/collateral non ingérés | [`reconciliation.test.ts:447`](../packages/strategy/src/reconciliation.test.ts) | portefeuille exchange autoritatif (positions + fills partiels + collateral) |
| **F-05** | Élevée | **Fermé (code)** | mode par défaut `supervised` ([`file-ledger.ts:90`](../packages/strategy/src/file-ledger.ts)), FATAL sans clé ([`file-ledger.ts:127`](../packages/strategy/src/file-ledger.ts)), falsifications rejouées | conserver ; re-signature périodique opérateur (→ R-03) |
| **F-06** | Élevée | **Fermé** | entrée publique lisible seule ([`index.ts:3`](../packages/execution/src/index.ts)), sous-chemin réservé + table `exports`, fichier-drapeau externe non revocable en mémoire | conserver ; service d'exécution séparé reste souhaitable |
| **F-10** | Élevée | **Fermé (code)** — émission au point de détection + retry webhook borné + WARN d'échec | [`durable-state.ts:303`](../packages/strategy/src/durable-state.ts), [`observability.ts:12`](../packages/strategy/src/observability.ts) | réserve : pas de queue d'alertes durable/ack distal |
| **F-11** | Élevée | **OUVERT** | `docs/observation/M27-2026-09-13/*` (720 s, 93/93 no_signal, state 0 octet, ledger dev) | campagne ≥ 72 h instrumentée, sur marché **actif avec carnet**, ledger supervisé, données live |
| **F-12** | Moyenne | **Fermé** | `file-lock.test.ts` (vivant-lent non repris, mort repris, owner.json) | conserver |
| **F-08** | Moyenne | Inchangé — Kelly/odds illustratifs | — | stratégie calibrée OOS |
| **F-09** | Moyenne | **Fermé (code + tests)** | `secrets-guard-convention.test.ts`, `scripts/rotate-credentials.mjs` | conserver ; exercice de rotation plateforme réel ; consumer obligé en live |
| **F-02** | résolu | corrigé — conservé | tests de régression | — |
| **F-07** | résolu | corrigé — conservé | conformance live V2 à maintenir | — |

### Constats résiduels nouveaux (ouverts par cet audit)

| ID | Sévérité | Constat | Preuve | Correctif proposé |
|---|---|---|---|---|
| **R-01** | Élevée | `reconcileAtStartup` est du code mort : la reconstruction des ordres ouverts/positions externes au démarrage n'est pas câblée ; le rattrapage état↔ledger n'a lieu que dans un cycle à signal | `reconcileAtStartup` défini ([`reconciliation.ts:389`](../packages/strategy/src/reconciliation.ts)) et référencé uniquement dans son test ; gate à signal ([`run-reference-loop.ts:223`](../packages/strategy/src/run-reference-loop.ts)) avant rattrapage | appeler `reconcileAtStartup` au démarrage (après `store.read()` de [`run-reference-loop.ts:686`](../packages/strategy/src/run-reference-loop.ts)), sous verrou, avec maker L2 ; test d'intégration démarrage→rattrapage |
| **R-02** | Moyenne | attribution des fills/reconnaissance par heuristique prix/côté/taille sur 5 min, sans client order id (limite API Polymarket) | [`reconciliation.ts:271`](../packages/strategy/src/reconciliation.ts) | documenter le coin des ordres jumeaux ; borner la taille/le volume attribuable ; (si l'API le permet un jour) identifiant d'ordre côté client |
| **R-03** | Faible (opérationnelle) | dépendance au checkpoint signé : re-signature périodique manuelle ; tout intervalle non signé bloque au démarrage supervisé | [`sign-ledger.ts:50`](../packages/ledger/src/sign-ledger.ts) | runbook de rotation/opérateur ; (option) daemon de re-signature hors process |

Constat annexe : la campagne M27 a observé le commit `1108985` (M26) — la HEAD auditable `0075721` n'a, elle, jamais tourné sous le dispositif.

## 9. Conclusion et décision

**Décision : NO-GO capital réel ; NO-GO paper trading supervisé prolongé tant que F-11 (observation réelle) et R-01 (rattrapage au démarrage) ne sont pas levés ; GO pour une campagne supervisée courte (heures, marché actif avec carnet, ledger en mode `supervised`) une fois R-01 câblé.**

Réponse directe à la question posée : **oui, M21–M28 ont véritablement comblé, dans le code et par preuve d'exécution, les failles de v0.4** — à l'exception de F-11, qui n'a pas été traitée mais simplement instrumentée : l'outil d'observation existe, l'observation elle-même n'a pas été faite (720 s sans signal ne comptent pas). Deux résidus nouveaux (R-01, R-02) et le maintien de F-04 partiel expliquent que le niveau de maturité reste 2/5 malgré une moyenne d'axes passée à 3,67/5 : le code est prêt à être observé, il n'a toujours pas été observé — ni réconcilié sur du réel. La prochaine progression ne viendra plus d'une mission de code ; elle viendra d'une campagne instrumentée de longue durée sur données live avec ledger signé, et d'un transfert de la preuve d'exécution du mock vers un environnement réel.