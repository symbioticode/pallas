# Audit indépendant de Pallas v0.4

**Date de l'audit :** 11 septembre 2026 (America/Toronto)

**Dépôt :** `/home/andrei/Projects/80_PALLAS/pallas`

**Branche / commit :** `main` / `22e2c53075ba8e3bb6a89c59db773f5521360087`

**État Git initial :** propre ; seule modification finale : ce livrable

**Nature :** audit technique indépendant de la vague PALLAS-M13 à M20

## 1. Verdict exécutif

**Niveau de maturité : 2/5 — socle de paper trading nettement renforcé, mais pas encore prêt pour une campagne supervisée prolongée.**

La progression depuis v0.2.1 (2,1/5) et v0.3 (niveau 2/5) est réelle dans le code : état fail-stop et durable, machine d'ordre, limites autoritatives, cross-check complet, taille réellement plafonnée, permissions de secrets et premières alertes. Elle ne justifie toutefois pas encore le niveau 3. La réconciliation peut déclarer `cancelled` un ordre absent des seuls ordres ouverts sans consulter les trades/fills, puis retirer cette exposition. Le ledger reste falsifiable dans le mode non signé accepté par défaut. Le test TypeScript du monorepo ne passe pas. Enfin, il n'existe aucune preuve de paper trading sur plusieurs jours avec données live.

### Avertissement de dépendance M13

M13 n'est **pas défaillante au sens fail-stop local** : les quatre fenêtres de crash, la corruption et la concurrence directe à deux processus ont été rejouées avec succès. Elle n'est cependant pas une transaction ACID commune état–ledger–exchange : l'état et le ledger sont deux fichiers écrits séparément, et la fenêtre D est testée par construction manuelle d'un `ACKED`, non par un vrai appel exchange ([`packages/strategy/src/crash-windows.test.ts:163`](../packages/strategy/src/crash-windows.test.ts)). Les scores de M14/M15/M16/M20 doivent donc être lus comme dépendants d'un WAL local utile mais incomplet, pas d'une transaction institutionnelle acquise.

## 2. Méthode et référentiel externe

La grille v0.3 est reprise explicitement : **Fidélité d'exécution / Gestion des risques / Viabilité opérationnelle**. Les contrôles sont confrontés aux pratiques externes, et non à la seule cohérence des missions. La SEC Rule 15c3-5 sert de repère pour limites pre-trade, blocage des ordres erronés et revue des contrôles ; les bonnes pratiques FIA 2024 servent de repère pour kill switch, monitoring, tests et gestion d'incident ([SEC Rule 15c3-5](https://www.sec.gov/rules-regulations/2011/06/risk-management-controls-brokers-or-dealers-market-access), [FIA Automated Trading Risk Controls, 2024](https://www.fia.org/sites/default/files/2024-07/FIA_WP_AUTOMATED%20TRADING%20RISK%20CONTROLS_FINAL_0.pdf)). Polymarket indique explicitement qu'après soumission il faut réconcilier ordres ouverts **et trades résultants**, et que les trades servent à reconstruire les fills et positions ([Polymarket — Manage Orders](https://docs.polymarket.com/trading/manage-orders)). GitHub recommande l'épinglage par SHA complet des actions ([GitHub — Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)).

Niveaux de preuve : **dynamique** (commande réellement exécutée), **code** (fichier:ligne), **documentaire** (affirmation non reproduisible), **non vérifiable** (service/credential/preuve externe indisponible).

## 3. Résultats d'exécution

| Vérification | Résultat réel |
|---|---|
| `npm test` monorepo | **échec** : 263 passed, 2 failed, 4 skipped ; échecs des probes 2-processus M13/M16 (`Unexpected end of JSON input`) |
| probes M13/M16 ciblées | mêmes 2 échecs sous Vitest ; lancement shell direct M13, 2 processus × 5 : 10 ordres, aucun perdu |
| `cargo test --all-targets` | **65 passed**, 0 failed |
| sélection adversariale TS | **141 passed**, 0 failed (crash windows, falsification signée, réconciliation, M17, M18, M19, alertes) |
| sandbox local | 4 tests d'isolation explicitement skipped : bwrap incapable de créer le netns ([`packages/execution/src/sandbox.test.ts:32`](../packages/execution/src/sandbox.test.ts)) |
| CI GitHub du commit audité | **non vérifiable** : credentials `gh` invalides et accès API indisponible ; aucun run réel n'est donc crédité |

L'exigence d'intégration « `npm test` + `cargo test` sur l'ensemble » est seulement satisfaite côté Rust. L'échec TS semble être celui du harnais de capture stdout — les processus directs ont écrit le bon total — mais une suite monorepo rouge reste une régression CI, quelle qu'en soit la cause.

## 4. Axe 1 — Fidélité d'exécution

### 4.1 M13 : durabilité et fenêtres de crash

Le store distingue bien `ENOENT` (premier démarrage) d'un JSON présent invalide, d'un schéma/version faux et d'un checksum incohérent ([`packages/strategy/src/durable-state.ts:253`](../packages/strategy/src/durable-state.ts)). Une corruption volontaire `{broken` a produit `StateCorruptionError`, sans retour à zéro. L'écriture fait temp unique 0600, `fsync` fichier, rename et `fsync` répertoire ([`packages/core/src/atomicfs.ts:49`](../packages/core/src/atomicfs.ts)). Le cycle écrit `DECIDED` puis `SUBMITTING` avant le réseau ([`packages/strategy/src/run-reference-loop.ts:278`](../packages/strategy/src/run-reference-loop.ts), [`packages/strategy/src/run-reference-loop.ts:357`](../packages/strategy/src/run-reference-loop.ts)).

Les quatre fenêtres passent dynamiquement : A ne crée pas d'ordre fantôme ; B conserve `DECIDED` ; C conserve `SUBMITTING` ; D conserve `ACKED+order_id` sans ledger. Réserve : D appelle directement `store.write`, donc ne prouve pas un vrai ack ni le crash exact du chemin live ([`packages/strategy/src/crash-windows.test.ts:175`](../packages/strategy/src/crash-windows.test.ts)). Il n'existe pas de commit atomique commun aux deux fichiers : `ACKED` est écrit, puis `ledger.append` séparément ([`packages/strategy/src/run-reference-loop.ts:423`](../packages/strategy/src/run-reference-loop.ts), [`packages/strategy/src/run-reference-loop.ts:437`](../packages/strategy/src/run-reference-loop.ts)).

La concurrence directe à deux processus conserve 10/10 écritures. Néanmoins le lock peut être repris après 30 s sur le seul âge du répertoire, sans PID/lease/heartbeat ([`packages/core/src/file-lock.ts:42`](../packages/core/src/file-lock.ts), [`packages/core/src/file-lock.ts:62`](../packages/core/src/file-lock.ts)). Une validation ou E/S longue peut donc faire voler un verrou encore vivant : niveau inférieur à un verrou transactionnel robuste.

### 4.2 M14 : ambiguïté et kill switch

Un `AmbiguousOrderError` produit durablement `AMBIGUOUS`, appelle immédiatement `reconcileOrder` si un signer est disponible, et sinon le scope reste bloqué ([`packages/strategy/src/run-reference-loop.ts:484`](../packages/strategy/src/run-reference-loop.ts)). Le gate sous verrou refuse une nouvelle émission lorsqu'une empreinte est vivante ([`packages/strategy/src/run-reference-loop.ts:284`](../packages/strategy/src/run-reference-loop.ts)). Le mock 502 → scan réel → `ACKED` passe.

**Défaut élevé : fausse conclusion négative.** Sans `order_id`, la preuve n'est qu'un scan des ordres ouverts ([`packages/strategy/src/reconciliation.ts:201`](../packages/strategy/src/reconciliation.ts)). « Aucun match » devient `TERMINAL/cancelled` ([`packages/strategy/src/reconciliation.ts:250`](../packages/strategy/src/reconciliation.ts)), alors qu'un ordre totalement exécuté disparaît précisément des ordres ouverts. Pallas ne possède aucun endpoint trades/fills. Il peut donc libérer le scope et l'exposition d'une position réelle, puis réémettre. C'est contraire au parcours officiel Polymarket ordres **et trades**.

`cancelAllOrders` envoie bien `DELETE /cancel-all` ([`packages/execution/src/polymarketClient.ts:447`](../packages/execution/src/polymarketClient.ts)) et `enforceKillSwitch` l'appelle sur engagement ([`packages/strategy/src/reconciliation.ts:353`](../packages/strategy/src/reconciliation.ts)). Le test mock serveur passe ; aucun testnet réel n'est prouvé. Le backstop reste mutable dans le process : `setGlobalKillSwitch` est public via l'export wildcard ([`packages/execution/src/index.ts:4`](../packages/execution/src/index.ts), [`packages/execution/src/killSwitch.ts:33`](../packages/execution/src/killSwitch.ts)), et l'injection `isKillSwitchEngaged` n'est pas restreinte ([`packages/execution/src/polymarketClient.ts:43`](../packages/execution/src/polymarketClient.ts)).

### 4.3 M16, M17 et M18

M16 détecte bien une falsification avec recalcul par `recomputeRecordHash` **lorsqu'un checkpoint Ed25519 et la clé publique sont configurés** : le test ciblé passe et le chargement compare l'ancre puis vérifie la signature ([`packages/ledger/src/file-ledger.ts:192`](../packages/ledger/src/file-ledger.ts)). Mais sans clé publique ni checkpoint, un ledger non signé est accepté ([`packages/ledger/src/file-ledger.ts:178`](../packages/ledger/src/file-ledger.ts)). L'audit a modifié un montant, recalculé toute la chaîne avec la fonction exportée, puis obtenu `UNSIGNED_FORGERY_ACCEPTED true`. M16 est donc une capacité optionnelle, pas une garantie par défaut. Avec un `.sig` mais sans clé publique, seule la cohérence de l'ancre est contrôlée, pas sa signature cryptographique ([`packages/ledger/src/file-ledger.ts:204`](../packages/ledger/src/file-ledger.ts)).

M17 ferme F-07 : `tokenId` est obligatoire, `marketId === tokenId === signed.tokenId`, side et montants arrondis sont comparés avant réseau ([`packages/execution/src/types.ts:14`](../packages/execution/src/types.ts), [`packages/execution/src/polymarketClient.ts:158`](../packages/execution/src/polymarketClient.ts)). Les divergences `marketId` et `tokenId` ont été testées. Les `signatureType` 1/2/3 sont rejetés dès la construction ([`packages/execution/src/polymarketSigner.ts:515`](../packages/execution/src/polymarketSigner.ts)). `isDryRun` est refusé hors `PALLAS_TEST_MODE=1` ([`packages/execution/src/polymarketClient.ts:229`](../packages/execution/src/polymarketClient.ts)) : le chemin standard est corrigé, mais une variable d'environnement reste une autorité faible comparée à un build/service live séparé.

M18 est conforme à l'intention économique : il calcule `min(price×size, suggested_size_usd)` puis reconvertit en parts ([`packages/strategy/src/run-reference-loop.ts:161`](../packages/strategy/src/run-reference-loop.ts)) et signe `appliedSize`, non la taille brute ([`packages/strategy/src/run-reference-loop.ts:409`](../packages/strategy/src/run-reference-loop.ts)). Le test dynamique de plafonnement passe.

**Note axe 1 : 3,3/5.** Forte progression fonctionnelle, limitée par la réconciliation sans fills, l'absence de testnet/live ack, le kill switch mutable et la transaction état/ledger non commune.

## 5. Axe 2 — Gestion des risques

Le contrat partagé est cohérent entre TS et Rust : `TradeRequest` ne contient plus `bankroll_usd`, `max_order_usd`, `max_drawdown_usd` ([`packages/risk/src/types.ts:19`](../packages/risk/src/types.ts), [`crates/risk-engine/src/pipeline.rs:55`](../crates/risk-engine/src/pipeline.rs)). Les limites vivent dans `RiskConfig` opérateur. Rust refuse les champs inconnus par `deny_unknown_fields` ([`crates/risk-engine/src/pipeline.rs:57`](../crates/risk-engine/src/pipeline.rs)).

Le scénario 20 × 500 $ sous une limite portefeuille de 1 000 $ est réellement testé : seuls les deux premiers ordres passent, le troisième et les suivants sont rejetés ([`crates/risk-engine/src/pipeline.rs:724`](../crates/risk-engine/src/pipeline.rs)). La règle additionne exposition courante et nouvel ordre ([`crates/risk-engine/src/pipeline.rs:344`](../crates/risk-engine/src/pipeline.rs)).

`CircuitBreaker::is_open()` reste binaire et renvoie faux en `HalfOpen` ([`crates/risk-engine/src/circuit_breaker.rs:135`](../crates/risk-engine/src/circuit_breaker.rs)), mais `pipeline.rs` ne l'utilise plus pour la décision : il branche explicitement sur les trois états et limite HalfOpen à une sonde ([`crates/risk-engine/src/pipeline.rs:277`](../crates/risk-engine/src/pipeline.rs)). Le défaut v0.3 est donc corrigé dans le pipeline. Le modèle de recovery reste discutable : en état Open, des appels `record_pnl` ignorent le P&L mais comptent comme observations jusqu'à HalfOpen ([`crates/risk-engine/src/circuit_breaker.rs:81`](../crates/risk-engine/src/circuit_breaker.rs)); aucune source opérationnelle de ces observations n'est câblée aux fills.

VaR/CVaR à 0 ou 1 observation porte maintenant `INSUFFICIENT_DATA` ([`crates/risk-engine/src/var.rs:138`](../crates/risk-engine/src/var.rs)). Le pipeline applique une enveloppe de démarrage au lieu de considérer zéro comme une estimation ([`crates/risk-engine/src/pipeline.rs:433`](../crates/risk-engine/src/pipeline.rs)). Les tests 0/1 observation passent.

La faiblesse systémique demeure : `exposureFromOrders` dépend de la machine locale et retire les terminaux annulés/rejetés ([`packages/strategy/src/durable-state.ts:147`](../packages/strategy/src/durable-state.ts)). La fausse annulation M14 contamine donc directement M15. Les fills partiels, balances, collateral, positions exchange et regroupement réel par événement ne sont pas ingérés. Les limites sont bien codées mais leur source d'exposition n'est pas encore autoritative.

**Note axe 2 : 3,1/5.** Le moteur local est passé d'une limite par ordre à un contrôle cumulé sérieux ; la note reste sous 4 tant que la position exchange/fills n'alimente pas l'état et que les paramètres Kelly de référence ne sont pas calibrés.

## 6. Axe 3 — Viabilité opérationnelle

M19 impose une garde POSIX avant lecture : bits groupe/autres actifs → `SecretFilePermissionsError` ([`packages/core/src/credentials.ts:163`](../packages/core/src/credentials.ts)); le chemin fichier l'appelle avant `readFile` ([`packages/execution/src/polymarketSecrets.ts:84`](../packages/execution/src/polymarketSecrets.ts)). Les tests 0600/0644 passent. Ce chemin n'est toutefois appelé par aucun consumer de production, fait reconnu dans le journal lui-même ([`docs/mission/mission-PALLAS-M19-journal.md:116`](mission/mission-PALLAS-M19-journal.md)).

La « rotation exécutée » n'est pas reproductible : le seul script est annoncé sous `/tmp/opencode/rotation-m19.mjs`, hors dépôt, et la révocation/derivation plateforme y sont explicitement **simulées** ([`docs/mission/mission-PALLAS-M19-journal.md:41`](mission/mission-PALLAS-M19-journal.md), [`docs/mission/mission-PALLAS-M19-journal.md:58`](mission/mission-PALLAS-M19-journal.md)). Aucune preuve externe de révocation réelle n'est disponible. Crédit accordé : re-chiffrement local de credentials de test documenté ; pas de crédit pour une rotation CLOB réelle.

M20 épingle toutes les actions par SHA complet dans le YAML ([`.github/workflows/ci.yml:22`](../.github/workflows/ci.yml)). Le run réel du commit audité est non vérifiable. La CI autorise explicitement le skip des tests sandbox si bwrap/unshare est indisponible ([`.github/workflows/ci.yml:25`](../.github/workflows/ci.yml)); localement quatre tests ont été skipped et le message était observable. C'est honnête, mais cela signifie que la CI peut être verte sans preuve sandbox.

Une simulation `AmbiguousOrderError` a produit une alerte JSONL `CRITICAL/AMBIGUOUS_ORDER` observable dans `.pallas/alerts.jsonl`; `emitAnomaly` écrit bien le fichier et tente optionnellement un webhook ([`packages/core/src/observability.ts:91`](../packages/core/src/observability.ts)). En revanche, l'alerte `STATE_CORRUPT` est mal câblée : le `try` ne fait que construire `DurableStateStore`, opération sans lecture ([`packages/strategy/src/run-reference-loop.ts:624`](../packages/strategy/src/run-reference-loop.ts)); la corruption est levée plus tard dans `enforceKillSwitch`, puis seulement consignée dans `kill_switch_sync` ([`packages/strategy/src/run-reference-loop.ts:647`](../packages/strategy/src/run-reference-loop.ts)). L'incident state critique n'émet donc pas l'anomalie promise. Le webhook est fire-and-forget et ses échecs sont avalés ([`packages/core/src/observability.ts:109`](../packages/core/src/observability.ts)); il n'existe ni retry durable, ni accusé, ni escalade.

### Paper trading prolongé

**Absent.** Le dépôt ne contient aucun ledger/state/log couvrant plusieurs jours, aucune série de snapshots live, aucun rapport de disponibilité, latence, dérive, fills simulés, slippage ou intervention opérateur. Le seul run live-data documenté antérieur est trois cycles ponctuels de M12, affirmation de journal non conservée sous forme d'artefact vérifiable ([`docs/mission/mission-PALLAS-M12-journal.md:45`](mission/mission-PALLAS-M12-journal.md)). Le code est plus proche d'être prêt à être observé ; il n'a pas encore été observé.

**Note axe 3 : 2,4/5.** Alertes, dashboard, runbook et CI sont des progrès réels, mais la suite rouge, la CI distante non vérifiable, l'alerte state cassée, la rotation plateforme simulée et l'absence d'exploitation prolongée empêchent une note de niveau opérationnel.

## 7. Score comparatif

v0.3 n'a publié **aucune note numérique par axe** : seulement un niveau global 2/5 et des verdicts descriptifs. Pour ne pas inventer de chiffres, la colonne conserve `N/P` et compare textuellement chaque axe.

| Axe | v0.2.1 | v0.3 | v0.4 | Progression démontrée |
|---|---:|---:|---:|---|
| Fidélité d'exécution | 2,7/5 | N/P — boucle incomplète, F-01/F-03/F-07 | **3,3/5** | durable lifecycle, réconciliation, cross-check et sizing ; fills/testnet manquent |
| Gestion des risques | 2,0/5 | N/P — moteur isolé, exposition absente | **3,1/5** | limites autoritatives/cumulées, HalfOpen, statut VaR ; source exchange non autoritative |
| Viabilité opérationnelle | 1,6/5 | N/P — alerting/runbooks/cancel-all absents | **2,4/5** | observatory, alertes, runbook, SHA pins ; preuves CI/rotation/paper insuffisantes |
| **Moyenne arithmétique** | **2,1/5** | **niveau 2/5** (non comparable arithmétiquement) | **2,9/5** | progression du code, maturité plafonnée à 2/5 |

La moyenne par axes mesure la qualité du socle. Le **niveau de maturité reste 2/5** parce que le passage au niveau 3 exige une réconciliation exacte des fills et une observation paper réelle sur plusieurs jours. L'absence de paper trading ne rabaisse pas artificiellement les axes 1 et 2 ; elle plafonne le niveau descriptif, conformément à la méthode demandée.

## 8. Risques financiers restants

| ID | Sévérité v0.4 | État | Risque financier concret | Condition de levée |
|---|---|---|---|---|
| **F-03** | **Critique** | partiellement corrigé | ordre rempli absent des open orders classé `cancelled`, exposition libérée, ordre suivant doublant la position | réconcilier ordre + trades/fills + balances ; inconnu reste bloquant |
| **F-01** | **Élevée** | partiellement corrigé | crash entre état et ledger ; ack/fill/position non atomiques, preuve d'audit manquante | WAL/DB transactionnelle incluant intent, ack brut, fills, position et outbox ledger |
| **F-04** | **Élevée** | partiellement corrigé | limite cumulée alimentée par une exposition locale fausse/incomplète ; fills partiels et collateral ignorés | portefeuille autoritatif réconcilié exchange, réservations et limites event/globales |
| **F-05** | **Élevée** | partiellement corrigé | mode unsigned accepte une chaîne entièrement falsifiée et recalculée | clé publique + checkpoint obligatoire en tout mode exploitable, ancrage distant/WORM |
| **F-06** | **Élevée** | partiellement corrigé | code du process peut désengager kill switch ou activer les injections test par environnement | service d'exécution séparé, build prod sans injections, kill switch hors process/ACL |
| **F-10** | **Élevée** | partiellement corrigé | corruption state sans alerte dédiée ; webhook non garanti ; CI distante non prouvée | corriger le point de lecture, queue d'alertes durable/ack, run CI réel vert et archivé |
| **F-11** | **Élevée** | nouveau | défaillances de durée (stale feeds, dérive mémoire, reconnexion, accumulation d'état) non observées avant mise en service | paper run multi-jours sur données live, rapport SLO/incidents et artefacts horodatés |
| **F-12** | **Moyenne** | nouveau | lock actif repris après 30 s comme « stale », deux writers possibles et limites concurrentes incohérentes | lock OS/DB, lease avec propriétaire + heartbeat, tests kill/recovery > staleMs |
| **F-08** | **Moyenne** | partiellement corrigé | statut statistique honnête, mais Kelly/odds/confidence illustratifs peuvent donner un sizing sans valeur économique | stratégie séparée calibrée OOS ; enveloppe paper faible jusque-là |
| **F-09** | **Moyenne** | partiellement corrigé | vault 0600 optionnel, secrets et wallet/API dans le même heap, révocation réelle non prouvée | consumer obligatoire, KMS/signer isolé, exercice de rotation plateforme avec preuve |
| **F-02** | résolu pour corruption accidentelle | corrigé | plus de reset silencieux sur fichier présent invalide | conserver tests startup réels et ajouter alerte correcte |
| **F-07** | résolu | corrigé | market/token/signatureType sont maintenant bornés | conserver conformance live V2 et tests de régression |

## 9. Conclusion et décision

**Décision : NO-GO capital réel ; NO-GO paper trading supervisé prolongé en l'état ; GO pour corriger F-03/F-05/F-10 puis lancer une campagne paper instrumentée.**

La vague M13–M20 a fait progresser Pallas d'un démonstrateur fragile vers un socle contrôlé crédible. Les meilleurs gains sont M13 (fail-stop/durabilité locale), M15 (limites hors trade et exposition cumulée), M17 (intention canonique) et M18 (taille effectivement appliquée). Mais une plateforme institutionnelle ne peut pas considérer « absent des ordres ouverts » comme synonyme de « jamais rempli », accepter un ledger unsigned en exploitation, ni revendiquer une alerte state que le point de levée contourne. Une fois ces trois points corrigés et le monorepo réellement vert, le prochain progrès ne viendra plus d'une mission de code courte : il devra venir de plusieurs jours d'observation reproductible sur données live.
