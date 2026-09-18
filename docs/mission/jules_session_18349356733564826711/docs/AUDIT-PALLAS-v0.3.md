# Audit indépendant de Pallas v0.3

**Date de l'audit :** 10 septembre 2026 (America/Toronto)  
**Dépôt :** `/home/andrei/Projects/80_PALLAS/pallas`  
**Branche / commit :** `main` / `601e3f985c482eb8773aba9fd9d9c8b33af0d541`  
**État Git initial et final :** propre (`git status --short` vide)  
**Nature :** audit technique indépendant, sans modification corrective du code

## 1. Verdict exécutif

**Niveau attribué : 2/5 — prêt pour backtesting technique, pas prêt pour paper trading supervisé.**

Pallas est aujourd'hui une infrastructure de démonstration dry-run, non une plateforme de trading. Le dépôt possède un moteur de risque déterministe, une signature EIP-712 EOA cohérente avec les clients V2 consultés, des frontières runtime convenablement validées, un dry-run sûr par défaut et un harnais d'intégration réellement exécutable. Les 132 tests TypeScript et 54 tests Rust passent ; Clippy avec warnings bloquants et `cargo audit` passent également.

Ces qualités ne suffisent pas au niveau 3. Il n'existe ni suivi de positions, ni réconciliation des ordres ambigus, ni ingestion des fills, ni supervision/alerting, ni cancel-all, ni runbook exécutable. Surtout, il n'existe aucune transaction durable reliant décision de risque, ordre, accusé exchange, état risk et ledger. Le fichier d'état réinitialise silencieusement un état absent ou corrompu ; le ledger local ne comporte ni verrou, ni `fsync`, ni ancrage externe et peut être recalculé entièrement. Le kill switch est un booléen transmis par l'appelant, sans autorité indépendante. Ces lacunes rendent possibles une position non suivie, une limite réinitialisée, un double ordre après résultat ambigu et un incident indétecté.

La stratégie de référence est correctement présentée comme **non prédictive** : elle achète sous un seuil fixe et réutilise le prix du marché comme probabilité, sans edge revendiqué ([`docs/STRATEGY.md:3`](STRATEGY.md), [`packages/strategy/src/run-reference-loop.ts:65`](../packages/strategy/src/run-reference-loop.ts)). Il n'existe dans le dépôt ni données historiques, ni backtest, ni walk-forward, ni paper portfolio persistant, ni modèle de frais/slippage. Aucun jugement de rentabilité n'est donc possible.

### Constats prioritaires

| ID | Gravité | Constat | Scénario de perte |
|---|---|---|---|
| F-01 | **Critique** | Aucune transaction durable décision → ordre → ack → position → ledger | ordre accepté puis crash : position réelle inconnue, nouvelle émission possible |
| F-02 | **Élevée** | État risk absent/corrompu réinitialisé silencieusement | kill switch/circuit breaker perdu au redémarrage |
| F-03 | **Élevée** | Aucun mécanisme de réconciliation des ordres ambigus | timeout/5xx suivi d'une réémission humaine ou future : double position |
| F-04 | **Élevée** | Pas de positions/fills/balances, limites seulement par ordre | série d'ordres individuellement valides dépassant l'exposition globale |
| F-05 | **Élevée** | Ledger falsifiable/recalculable, concurrent non sûr, sans durabilité forcée | suppression ou réécriture de l'historique après perte |
| F-06 | **Élevée** | Dry-run contournable par API publique/injection ; gate de schéma mutable | un consommateur interne active le live sans contrôle institutionnel indépendant |
| F-07 | **Moyenne** | Fidélité intention/payload incomplète (`marketId` ignoré, `tokenId` optionnel) | mauvaise issue signée malgré une intention métier différente |
| F-08 | **Moyenne** | Risque statistique non calibré et historique vide permissif | VaR/CVaR à zéro au démarrage, sizing non justifié économiquement |
| F-09 | **Moyenne** | Secrets en strings JS, pas de rotation/révocation/custody | compromission du process/heap : wallet et API récupérables |
| F-10 | **Moyenne** | Aucune observabilité opérationnelle ni runbook exécutable | incident réel découvert tardivement ou traité de façon incohérente |

## 2. Périmètre, méthode et référentiel

L'audit évalue Pallas comme infrastructure d'exécution et de risque munie d'un harnais d'intégration, et non comme stratégie rentable. `packages/strategy` et `packages/ledger` existent ; `packages/gateway` et `packages/agent` n'existent pas. Les audits v0.1 et l'historique des missions ont été consultés uniquement pour sélectionner des régressions à retester ; aucun score ni verdict antérieur n'a été repris.

Les critères sont inspirés, sans affirmation d'applicabilité juridique à Pallas, de la [SEC Rule 15c3-5](https://www.sec.gov/rules-regulations/2011/06/risk-management-controls-brokers-or-dealers-market-access) (seuils pre-trade, ordres erronés, accès autorisé, reporting post-trade immédiat, revue des contrôles) et des [FIA Best Practices for Automated Trading Risk Controls and System Safeguards, juillet 2024](https://www.fia.org/sites/default/files/2024-07/FIA_WP_AUTOMATED%20TRADING%20RISK%20CONTROLS_FINAL_0.pdf) (limites, price collars, kill switch, monitoring, tests de conformité et incidents). Sources consultées le 10 septembre 2026.

Pour Polymarket V2, deux dépôts officiels ont été clonés en lecture seule dans `/tmp` et figés :

- TypeScript [`Polymarket/clob-client-v2@49083a6`](https://github.com/Polymarket/clob-client-v2/tree/49083a618be70d6a86e15a94fac44037c3f7f616) ;
- Python [`Polymarket/py-clob-client-v2@215fc63`](https://github.com/Polymarket/py-clob-client-v2/tree/215fc63a8fd6ec3a10c7edb73997c9772d8686d3).

Les deux clients confirment la structure V2 signée à 11 champs et le JSON d'ordre sans champ adresse `taker`. Le terme `takerAmount` reste bien présent. La divergence documentaire est donc résolue : **Pallas a raison de ne pas émettre `taker` en V2** ; les occurrences de `taker` concernent V1, RFQ ou la terminologie maker/taker, pas le wire standard V2. La structure et le domaine de Pallas sont visibles dans [`polymarketSigner.ts:57`](../packages/execution/src/polymarketSigner.ts) et [`polymarketSigner.ts:89`](../packages/execution/src/polymarketSigner.ts).

Niveaux de preuve employés : **code** (lecture statique), **dynamique** (commande/test exécuté), **documentation** (affirmation seulement), **non vérifiable** (credentials, exchange ou CI indisponibles).

## 3. Environnement et reproductibilité

Dans `nix-shell`, l'environnement observé est : Node `v22.23.2`, npm `10.9.8`, rustc `1.97.1`, cargo `1.97.0`, Nix `2.34.8`, bubblewrap `0.11.2`. Nixpkgs est épinglé au commit `db62aa7ff983aba791a1760d35a102b72248229f` ([`shell.nix:16`](../shell.nix)).

| Commande | Exit | Résultat |
|---|---:|---|
| `npm ci` | 0 | 62 paquets ajoutés ; audit automatique : 2 modérées |
| `npm run build` | 0 | 5 packages compilés |
| `npm run typecheck` | 0 | succès, mais script `tsc --build --dry` ([`package.json:13`](../package.json)) |
| `npm test -- --run` | 0 | 12 fichiers, **132 passed**, 0 failed, 0 skipped |
| `cargo test` | 0 | **54 passed** (39 unit + 12 CLI + 3 properties), 0 failed/ignored |
| `cargo clippy --all-targets -- -D warnings` | 0 | aucun warning |
| `cargo audit` | 0 | 48 dépendances scannées, aucune vulnérabilité signalée |
| `npm audit --json` | 1 | 2 modérées : `vitest` et `@vitest/mocker`, GHSA-82fw-gwwq-j7x9 |
| `cargo llvm-cov --summary-only` | 1 | non mesurable : nouvelle évaluation Nix bloquée par un cache utilisateur read-only avant lancement de l'outil |
| `gh run list` | 1 | non vérifiable : accès `api.github.com` indisponible |

Le test sandbox a réellement démarré bwrap et prouvé l'inaccessibilité d'un service host ; il n'a pas été skipped. La couverture n'a pas été reprise d'un rapport antérieur : elle demeure **non vérifiée pour ce commit**. Aucune écriture réseau, credential ou ordre live n'a été utilisé. Les seules écritures hors livrable ont été les artefacts locaux ordinaires de build ignorés par Git et les clones/états temporaires sous `/tmp`.

## 4. Fidélité d'exécution

### 4.1 Flux reconstitué

Le flux actuel est : lecture `GET /book` → `ReferenceStrategy.evaluate` → conversion en `TradeRequest` → CLI Rust `validate` → sauvegarde JSON de l'état → construction/signature EIP-712 → garde dry-run dans `placeOrder` → append du ledger. L'enchaînement est explicite dans [`run-reference-loop.ts:147`](../packages/strategy/src/run-reference-loop.ts), [`run-reference-loop.ts:162`](../packages/strategy/src/run-reference-loop.ts) et [`run-reference-loop.ts:183`](../packages/strategy/src/run-reference-loop.ts).

Le harnais respecte un rejet risk : il ne tente `placeOrder` que si `decision.allowed` ([`run-reference-loop.ts:184`](../packages/strategy/src/run-reference-loop.ts)). Le chemin testé reste toutefois exclusivement dry-run : `placeOrder` lève avant réseau dès que la garde est active ([`polymarketClient.ts:261`](../packages/execution/src/polymarketClient.ts)). Un succès live de bout en bout n'est donc pas prouvé.

### 4.2 Intention contre payload

Points prouvés dynamiquement par les tests : BUY/SELL inversent correctement maker/taker ; grands token IDs ne sont pas tronqués ; digest EIP-712 croisé avec `viem` ; divergence de side et de montants rejetée avant réseau ; token explicite cohérent accepté. Le code recalcule les montants et tolère une unité de `10^-6` ([`polymarketClient.ts:113`](../packages/execution/src/polymarketClient.ts)).

Le contrôle est néanmoins incomplet :

- `params.marketId` n'est jamais comparé au payload ; seul `params.tokenId` l'est, et seulement s'il n'est pas nul ([`polymarketClient.ts:119`](../packages/execution/src/polymarketClient.ts)). Une intention portant un mauvais `marketId`, ou sans `tokenId`, passe ce contrôle.
- Le prix et la taille ne figurent pas directement dans le payload ; leur produit est recalculé. Plusieurs couples prix/taille peuvent produire les mêmes entiers à six décimales. Le contrôle garantit les flux monétaires arrondis, pas l'identité complète des deux champs.
- Le calcul Pallas repose sur `Math.round` à six décimales, alors que les clients officiels appliquent des règles directionnelles dépendantes du tick/rounding. L'égalité sur les fixtures présentes ne constitue pas une preuve pour tous les ticks et bords.
- Le schema gate est un booléen process global exporté par le module, pas une attestation de conformance signée ou une propriété de build ([`schemaGate.ts:1`](../packages/execution/src/schemaGate.ts)).

**F-07 — moyenne.** Perte possible : ordre sur la mauvaise issue ou quantité économique différente de l'intention. Barrière : side/token optionnel/montants sont comparés avant fetch. Résolution : rendre `tokenId` obligatoire, supprimer ou définir précisément `marketId`, comparer une intention canonique immuable, adopter l'algorithme officiel de rounding par tick et tester chaque divergence indépendamment.

### 4.3 Signatures et modes de wallet

Pour EOA (`signatureType=0`), le domaine, l'encodage ABI 32 octets, les champs V2 et les digests viem sont cohérents ([`polymarketSigner.ts:212`](../packages/execution/src/polymarketSigner.ts), [`polymarketSigner.ts:233`](../packages/execution/src/polymarketSigner.ts)). La comparaison statique aux deux clients officiels confirme l'absence de `taker` et la structure signée.

Proxy/Safe et `POLY_1271` ne sont pas implémentés ni testés. Pourtant les valeurs 1–3 sont publiquement exposées et transmises ([`polymarketSigner.ts:109`](../packages/execution/src/polymarketSigner.ts)). La documentation reconnaît que seul EOA est supporté ([`docs/TRADING.md:48`](TRADING.md)). Seul le mode EOA est donc déclaré conforme ; tout autre mode est **non conforme/non vérifié** et devrait être rejeté à la construction plutôt que simplement documenté.

### 4.4 Échecs de `placeOrder`

Le POST est émis exactement une fois ; timeout/réseau et HTTP 5xx deviennent `AmbiguousOrderError`, sans retry ([`polymarketClient.ts:284`](../packages/execution/src/polymarketClient.ts), [`polymarketClient.ts:297`](../packages/execution/src/polymarketClient.ts)). Réponse JSON invalide et succès sans `orderID` sont fail-closed ([`polymarketClient.ts:306`](../packages/execution/src/polymarketClient.ts)). Les tests couvrent timeout, 5xx et absence de retry ; le schéma couvre les réponses invalides.

**F-03 — élevée.** `AmbiguousOrderError` est une bonne barrière contre le retry automatique, mais Pallas ne possède ni `getOpenOrders`, ni `getOrder`, ni balances/positions, ni identifiant client réconciliable. La procédure est uniquement textuelle et reconnaît que l'endpoint requis n'est pas exposé ([`docs/TRADING.md:26`](TRADING.md)). Résolution : état `SUBMITTING/UNKNOWN/ACKED` durable avant/après POST, identifiant local stable, réconciliation automatique et blocage de toute nouvelle émission sur le même scope jusqu'à résolution humaine.

### 4.5 Atomicité et fenêtres de crash

L'état risk est sauvegardé avant l'appel d'ordre ([`run-reference-loop.ts:163`](../packages/strategy/src/run-reference-loop.ts)), mais `validate` ne modifie pas les positions et ne réserve aucun montant. Les fenêtres ont donc les conséquences suivantes :

| Fenêtre | État après reprise |
|---|---|
| décision avant persistance | décision perdue, aucun journal obligatoire |
| persistance avant ordre | état identique ou avancé sans preuve d'ordre |
| ordre après envoi avant ledger | ordre potentiellement réel, aucune trace locale/ack |
| ledger avant fin | trace possible, mais pas de position/fill ni statut transactionnel |

**F-01 — critique.** Il n'existe aucun write-ahead log ni transaction durable commune. La résolution exige un journal transactionnel durable avec identifiant de corrélation unique, états de machine explicites, réservation atomique des limites, ack brut, fills et procédure de reprise idempotente.

## 5. État risk et gestion des risques

### 5.1 Persistance et concurrence

`loadState` attrape indistinctement fichier absent, JSON tronqué et corruption puis retourne `{hist_pnls: []}` ([`run-reference-loop.ts:96`](../packages/strategy/src/run-reference-loop.ts)). `saveState` fait un `writeFileSync` direct, sans temp+rename, lock ou `fsync` ([`run-reference-loop.ts:108`](../packages/strategy/src/run-reference-loop.ts)). Deux processus peuvent lire le même état, chacun accepter un ordre, puis écraser l'état de l'autre.

**F-02 — élevée.** Scénario : kill switch `true` ou pertes cumulées dans un fichier tronqué ; au redémarrage, état neuf permissif. Résolution : corruption fatale et alarmée, schéma strict à l'entrée, version/checksum, écriture atomique + `fsync` fichier/répertoire, verrou interprocessus ou base transactionnelle, politique explicite pour fichier absent.

### 5.2 Matrice des gates

| Gate | Barrière existante | Résultat / limite |
|---|---|---|
| Kill switch | court-circuit si booléen state vrai | dynamique : passe ; autorité et persistance faibles |
| Input validation | bornes et `is_finite` Rust | dynamique : cas invalides rejetés |
| Circuit breaker | pertes consécutives/drawdown sérialisés | dynamique : passe ; aucune ingestion automatique des P&L/fills |
| Position/order | `est_value <= max_order` | par ordre seulement, aucune position cumulée |
| Cohérence notionnelle | `est≈price×quantity` | testée ; tolérance centime/1 % |
| Bankroll | ordre inférieur à bankroll | bankroll déclarative fournie par appelant |
| Kelly | ordre ≤ recommandation calculée | testée, hypothèses non validées |
| Volatilité | multiplicateur/stop selon historique | aucun feed automatique fiable |
| VaR/CVaR | CVaR ≤ 50 % drawdown | historique vide/1 point donne zéro |
| Stress | chocs 5–25 % sur bankroll | ne modélise ni position ni liquidité du marché |
| Confiance | ≥ 0,5 | valeur déclarative, aucune calibration |

Les entrées principales sont finies et bornées avant les gates ([`pipeline.rs:114`](../crates/risk-engine/src/pipeline.rs)). Les états TS de sortie imposent nombres finis ([`packages/risk/src/types.ts:119`](../packages/risk/src/types.ts)), mais l'état d'entrée est désérialisé directement par Serde et des valeurs structurellement malveillantes peuvent restaurer compteurs/configurations sans authentification. L'absence d'historique produit VaR/CVaR zéro ([`var.rs:123`](../crates/risk-engine/src/var.rs)), ce qui est mathématiquement défini mais opérationnellement permissif.

Le calcul Kelly est correct pour ses arguments (`f*=(p(b+1)-1)/b`) ([`kelly.rs:20`](../crates/risk-engine/src/kelly.rs)), mais la stratégie fournit `odds=2.0` quelle que soit la cote et `win_probability=price` ([`run-reference-loop.ts:80`](../packages/strategy/src/run-reference-loop.ts)). Ce couple peut créer une espérance positive artificielle ; il n'a aucune signification prédictive démontrée. Le stress applique simplement jusqu'à 25 % de la bankroll, pas la perte de la position ou une dislocation du carnet ([`stress.rs:64`](../crates/risk-engine/src/stress.rs)). Corrélations, concentration, spread, slippage, profondeur et non-stationnarité sont absents.

L'orchestrateur transmet la taille du signal après autorisation ([`run-reference-loop.ts:209`](../packages/strategy/src/run-reference-loop.ts)), et non `decision.suggested_size_usd`. Aujourd'hui le gate Kelly rejette un ordre au-dessus de sa borne, donc ce n'est pas un dépassement direct dans ce chemin ; néanmoins la « taille suggérée » n'est jamais convertie en quantité ni appliquée. La propriété exigible est `notional transmis <= min(notional demandé, taille autorisée)`, vérifiée juste avant signature.

**F-04 — élevée.** Les limites ne portent pas sur l'exposition réelle cumulée et leurs données ne proviennent pas de l'exchange. Résolution : positions/fills/balances comme source réconciliée, réservations pour ordres ouverts, limites par marché/issue/portfolio/jour et contrôle final sur le payload exact.

### 5.3 Kill switch et dry-run

Le kill switch bloque `validate_trade` lorsque `state.kill_switch_engaged` est vrai. Il ne bloque pas directement `placeOrder` : un appelant peut construire et soumettre un ordre sans passer par le moteur risk. Il est fourni dans un fichier contrôlé par le même processus et peut être remis à faux par tout composant qui écrit l'état ([`main.rs:72`](../crates/risk-engine/src/main.rs)). Ce n'est pas le backstop indépendant recommandé par la FIA.

Le dry-run est vrai par défaut et la désactivation normale exige la chaîne `LIVE` ([`packages/core/src/dry-run.ts:30`](../packages/core/src/dry-run.ts)). Mais `disableDryRun` et `enableDryRun` sont des exports publics ; `PolymarketClient` accepte aussi `isDryRun?: () => boolean` ([`polymarketClient.ts:18`](../packages/execution/src/polymarketClient.ts)). `schemaGate` et la configuration de test permettent donc à du code interne de réunir les conditions live. Il n'existe ni séparation de rôles, ni approbation à quatre yeux, ni environnement/build live séparé.

**F-06 — élevée.** Résolution : execution service fermé imposant risk token signé à durée courte, kill switch externe non réarmable par stratégie, injection test supprimée du build production, politique live attestée et contrôle d'accès/audit.

## 6. Ledger et investigabilité

Le ledger calcule `SHA256(prev_hash + contenu canonique)`, contrôle index, lien et hash ([`ledger.ts:63`](../packages/ledger/src/ledger.ts), [`ledger.ts:108`](../packages/ledger/src/ledger.ts)). Les tests détectent modification d'un maillon et roundtrip fichier. L'écriture utilise temp+rename ([`file-ledger.ts:62`](../packages/ledger/src/file-ledger.ts)). C'est une détection d'erreur accidentelle utile.

Ce n'est pas un journal inviolable : un attaquant ayant accès au fichier peut modifier/supprimer/réordonner puis recalculer tous les hashes avec la fonction exportée. Il n'y a ni HMAC/signature, ni ancrage distant/WORM. `FileLedger.load` transforme fichier absent ou JSON invalide en ledger vide sans alerte ([`file-ledger.ts:26`](../packages/ledger/src/file-ledger.ts)). Il ne vérifie pas automatiquement la chaîne au chargement. Le nom temporaire fixe `.tmp`, l'absence de lock et la réécriture complète rendent les appels concurrents sujets à perte/écrasement. `rename` n'est pas accompagné de `fsync` du fichier et du répertoire.

Les événements d'exécution contiennent `orderId` en succès, mais pas systématiquement correlation ID, hash d'intention, digest signé, salt, réponse brute, HTTP status, tentative, timestamps début/fin, position avant/après ou identifiant de trade/fill ([`run-reference-loop.ts:221`](../packages/strategy/src/run-reference-loop.ts)).

**F-05 — élevée.** Résolution : journal append-only transactionnel, verrouillé, `fsync`, vérification obligatoire au startup, fail-stop sur rupture, signatures/HMAC avec clé séparée et ancrage distant immuable ; schéma événementiel suffisant pour reconstruire chaque ordre et fill.

## 7. Credentials

Le stockage emploie AES-256-GCM, salt/IV aléatoires et scrypt ; format legacy rejeté ([`credentials.ts:54`](../packages/core/src/credentials.ts), [`credentials.ts:66`](../packages/core/src/credentials.ts), [`credentials.ts:94`](../packages/core/src/credentials.ts)). Les buffers de clé dérivée et certaines copies privées sont effacés. C'est une barrière correcte au repos si la passphrase est forte et stockée séparément.

Limites : passphrase, plaintext retourné, objets JSON et secrets sont des strings non effaçables ([`credentials.ts:129`](../packages/core/src/credentials.ts)). Aucune permission de fichier n'est imposée ici, aucune intégration KMS/HSM/secret manager, `mlock`, protection swap, rotation, révocation, inventaire d'accès ou séparation opérationnelle wallet/API n'existe. Les mêmes primitives permettent dérivation API et signature wallet dans un process Node.

**F-09 — moyenne avant tout capital réel, élevée dès qu'une clé financée est introduite.** Résolution : wallet à fonds limités/custody adaptée, secret manager/KMS, permissions explicites, processus de signature isolé, rotation/révocation testée et runbook de clé compromise.

## 8. Viabilité opérationnelle

L'inventaire ne trouve aucun système de logs structuré centralisé, métriques, traces, alertes, health check, dashboard, statut de positions, heartbeat/cancel-on-disconnect ou supervision humaine. Les seuls logs applicatifs sont des JSON/stdout du script de référence et quelques erreurs console ([`run-reference-loop.ts:252`](../packages/strategy/src/run-reference-loop.ts)). Corruption state/ledger, divergence exchange, ordre ambigu, rejet inattendu et échec de persistance ne déclenchent aucune alerte quasi temps réel.

`docs/TRADING.md` donne une procédure narrative pour l'ordre ambigu, mais l'outil requis n'est pas implémenté. Aucun runbook exécutable n'existe pour crash transactionnel, clé compromise, corruption ledger ou perte d'accès exchange. RTO/RPO ne sont pas définis ; avec fichiers locaux non sauvegardés, le RPO peut être la totalité de l'historique et le RTO est inconnu.

La CI statique exécute build/tests/audits dans Nix, mais :

- les actions utilisent des tags majeurs (`@v4`, `@v23`, `@v15`), pas des SHA immuables ([`.github/workflows/ci.yml:17`](../.github/workflows/ci.yml) ;
- les tests sandbox peuvent être skipped si l'unshare est indisponible ([`.github/workflows/ci.yml:20`](../.github/workflows/ci.yml) ;
- aucune couverture ni seuil n'est exécuté ;
- aucune protection de branche/déploiement n'est définie dans le dépôt ;
- les runs réels et règles GitHub n'ont pas pu être vérifiés faute d'accès API.

La reproductibilité locale est bonne mais dépend de Nix et d'un `fetchGit` dont le cache utilisateur doit être writable. L'historique Git observable compte 21 commits, tous sous un seul auteur : bus factor apparent de 1.

**F-10 — moyenne.** Résolution : observabilité durable avec alertes et SLO, endpoint health/readiness, état de positions, cancel-all testé, runbooks exercés, sauvegarde/restauration avec RTO/RPO, actions épinglées par SHA et contrôle des runs/protections GitHub.

## 9. Dépendances et exposition réseau publique

`npm audit` trouve GHSA-82fw-gwwq-j7x9 dans Vitest/`@vitest/mocker`, dépendance de développement. L'exploitation directe en production paraît limitée puisque Vitest n'est pas une dépendance runtime, mais une lecture arbitraire durant une CI exécutant des contributions non fiables reste un risque. La CI accepte actuellement ce niveau en ne bloquant qu'à `high` ([`.github/workflows/ci.yml:28`](../.github/workflows/ci.yml)). Condition de levée : version corrigée et audit à seuil `moderate`.

Les lectures publiques Polymarket ont été évaluées par les tests simulés et par comparaison de schémas ; aucun appel live n'était nécessaire pour conclure. Wallets financés, permissions API, signatures réellement acceptées, fills, latence, comportement d'async execution et compatibilité production restent **non vérifiables** sans testnet/credentials dédiés. La release officielle TypeScript récente indique une évolution vers `tradeIDs` et résolution asynchrone ; Pallas ne modélise ni `tradeIDs` ni le suivi post-placement. Cela renforce F-01/F-03 même si `orderID` reste présent dans la réponse nominale.

## 10. Matrice finale des risques financiers

| Risque financier | Mécanisme concret | Barrière actuelle | Preuve | Condition minimale de résolution |
|---|---|---|---|---|
| Ordre erroné | market/token ou rounding divergent | cross-check partiel avant fetch | code + tests partiels | intention canonique, token obligatoire, rounding officiel, conformance V2 |
| Double ordre | timeout/5xx puis nouvelle émission | zéro retry automatique | code + dynamique | états durables + réconciliation automatique bloquante |
| Position non suivie | ack/fill jamais persisté/ingéré | orderId seulement sur succès | code | order/fill/position service et rapprochement exchange |
| Limite contournée | appels directs à execution ou ordres cumulés | gates par ordre dans harnais | code | enforcement au dernier point d'émission + exposition réservée/cumulée |
| État risk perdu | JSON tronqué/absent → état neuf | aucune ; reset silencieux | code | fail-stop, DB transactionnelle, checksum, lock, backup |
| Clé compromise | strings JS/heap/swap/process unique | AES-GCM au repos | code + tests | custody/KMS, isolation signer, rotation/révocation |
| Incident indétecté | absence métriques/alertes/runbooks | console + ledger local | inventaire code | télémétrie/alertes, runbooks testés, journal distant immuable |

## 11. Conditions de passage de niveau

### Niveau 3 — paper trading supervisé

Toutes les conditions suivantes sont essentielles : ledger et state fail-stop/concurrents/durables ; machine d'état d'ordre et réconciliation ; positions/fills simulés persistants ; contrôle final du payload exact ; kill switch indépendant ; métriques/alertes et runbooks ; campagne de crash/reprise aux quatre fenêtres ; paper trading prolongé avec coûts et slippage. Elles ne sont pas réunies.

### Niveau 4 — capital réel limité

En plus du niveau 3 : testnet/conformance live EOA, limites cumulées réconciliées exchange, custody et rotation, cancel-all, approbation opérateur, déploiement reproductible protégé, revue de sécurité externe et seuils calibrés sur des données suffisantes. Non atteint.

### Niveau 5 — production

Haute disponibilité, RTO/RPO contractuels et testés, surveillance 24/7, séparation des fonctions, revue périodique des contrôles, incident response exercée, stratégie empiriquement validée et gouvernance complète. Très hors périmètre actuel.

## 12. Conclusion

Pallas v0.3 a corrigé plusieurs défauts fondamentaux des versions anciennes : signature EIP-712 EOA, sens maker/taker, validation runtime, absence de retry POST, sandbox réellement exercé et pipeline dry-run intégré. Ce socle mérite le niveau 2.

La frontière déterminante n'est plus la compilation ni le nombre de tests : c'est l'absence d'un système transactionnel et opérationnel autour de l'ordre réel. Tant qu'un crash peut séparer décision, soumission, accusé, position et journal, et tant que l'état risk peut repartir silencieusement à zéro, aucune quantité de tests unitaires ne justifie du paper trading supervisé — encore moins du capital réel.
