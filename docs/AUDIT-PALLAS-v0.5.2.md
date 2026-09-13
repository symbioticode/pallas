# Audit indépendant de Pallas v0.5.2

**Date :** 13 septembre 2026 (America/Toronto)

**Dépôt :** `/home/andrei/Projects/80_PALLAS/pallas`

**Commit final audité :** `64a94cb043ecfdc49d1062419041f8a38ae2d733`

**Commit de fermeture M29 revendiqué :** `c524a6ff16f16b61ed33882654c237a7849ddc0b`

**Parent de M29 :** `007572148c216de09c33dd99b16e5092332352a6`
**État de travail :** `packages/`, `crates/`, manifests et `shell.nix` identiques au HEAD ; modifications préexistantes M27 et fichiers non suivis exclus du périmètre. Les tests historiques ont été exécutés depuis des exports Git en `/tmp`.

## 1. Verdict exécutif

**Niveau de maturité : 2/5 — NO-GO capital réel et NO-GO paper trading supervisé prolongé.**

La correction de provenance R-03 de M29 est **fermée dans l'historique Git** : le commit annoncé existe, a 40 caractères hexadécimaux, a le bon parent, et contient un en-tête v0.5 corrigé ainsi qu'une trace textuelle de l'erreur. La copie antérieure portant encore le faux hash était donc désynchronisée du commit M29, et non le contenu de ce commit. La garde de provenance passe isolément sur `c524a6ff`.

Ce résultat ne valide toutefois pas le journal M29 dans son ensemble : son affirmation « 304 passed / 0 failed » n'est pas reproduite. Sur le HEAD final, `npm test` donne **298 passed, 2 failed, 4 skipped** (304 tests au total). Les deux échecs sont les probes interprocessus 2×5 du ledger et de l'état durable, tous deux avec une sortie enfant vide. Les variantes 4×3 passent. La suite Rust et Clippy sont vertes dans le shell Nix épinglé.

R-01 M29 est **fermée au niveau code et tests contrôlés**, avec une réserve de coût et de concurrence multi-processus. R-02 M29 est **partiellement fermée** : le fichier présent au démarrage provoque bien un cancel-all idempotent, mais un fichier créé après le démarrage ne provoque aucun cancel-all, et un retrait suivi d'un nouvel engagement ne réarme jamais la sortie. Le runbook décrit donc encore une capacité plus forte que celle réellement livrée.

Les blocages restent distincts : F-11 n'a toujours aucune observation ≥72 h ; l'attribution des fills reste heuristique ; la re-signature du ledger reste manuelle ; et la chaîne journal/tests est affaiblie par un résultat de suite non reproductible. Une campagne courte peut être préparée, mais ne doit pas être lancée comme campagne probante avant correction de R-02 M29 et retour à une suite entièrement verte.

## 2. Méthode et référentiel

La grille demeure : **Fidélité d'exécution / Gestion des risques / Viabilité opérationnelle**. L'ordre de preuve appliqué est dynamique > code > documentaire > non vérifiable. Aucun chiffre de mission n'est crédité sans rejeu.

Contrôles réalisés : résolution des objets Git ; lecture de blobs par `git show <commit>:<path>` ; test de provenance isolé sur exports immuables ; lecture des chemins de réconciliation, du kill switch et du runbook complet ; tests adversariaux temporaires hors dépôt (trois ordres multi-marchés et cycle retrait/réengagement KILL) ; `npm test` ; `cargo test --all-targets` et `cargo clippy --all-targets --all-features -- -D warnings` dans le `shell.nix` épinglé.

Les contrôles nouveaux restent cohérents avec les référentiels de v0.5 : un kill switch doit produire une action de réduction de risque fiable et opérable ; les contrôles de marché doivent être supervisés et testés ; la réconciliation dépend des lectures ordres/trades de l'exchange ; un SHA épinglé n'est utile que si sa provenance est vérifiable. Aucun changement réglementaire n'est invoqué pour relever une note.

## 3. Résultats d'exécution

| Vérification | Résultat réellement observé |
|---|---|
| `git cat-file -t c524…` / `git rev-parse c524…` | objet `commit`, hash exact de 40 hex |
| parent de `c524…` | `007572148c216de09c33dd99b16e5092332352a6` |
| `git show c524…:docs/AUDIT-PALLAS-v0.5.md` | hash correct dans l'en-tête ; mention « hash d'origine — 42 caractères hexadécimaux — invalide » et renvoi v0.5.1 |
| provenance isolée sur `c524…` | **1 passed, 0 failed** |
| provenance isolée sur `64a94cb…` | **1 passed, 0 failed** |
| témoin parent `0075721…` | **non applicable** : ni v0.5 ni `audit-provenance.test.ts` n'existent dans cet arbre |
| multi-ordres adversarial | **pass** : 3/3 ordres de marchés distincts deviennent `TERMINAL/filled` ; 3 `getOpenOrders` + 3 `getTrades` |
| KILL, retrait, nouvel engagement | **fail** : premier cancel-all appelé ; second engagement retourne `not_needed`, total 1 appel au lieu de 2 |
| `npm test` au HEAD versionné | **298 passed, 2 failed, 4 skipped** ; 24 fichiers passés, 2 échoués |
| échecs TS | `ledger-concurrency` 2×5 et `concurrency-probe` 2×5 : stdout enfant vide ; les deux variantes 4×3 passent |
| `cargo test --all-targets` | **65 passed, 0 failed, 0 ignored** : 47 unitaires + 15 CLI + 3 propriétés |
| `cargo clippy --all-targets --all-features -- -D warnings` | **vert**, code retour 0 dans le shell Nix épinglé |
| isolation bwrap | **4 skipped** : création du sandbox refusée par l'environnement (`NETLINK_ROUTE: Operation not permitted`) |
| campagne ≥72 h | **aucune preuve trouvée** ; seul résumé : 720 713 ms pour une cible de 720 000 ms |

Le chiffre M29 « 304 passed / 0 failed » confond en outre le total de tests avec des tests passés : la suite courante compte quatre tests skippés. Même si les deux probes étaient verts ailleurs, la formulation correcte ne serait pas 304 passés tant que ces quatre skips existent.

## 4. Vérification de la revue M29

### 4.1 R-01 — réconciliation indépendante du signal

**Verdict : fermée au niveau code/tests contrôlés, avec réserves opérationnelles.**

`isUnresolved` inclut `SUBMITTING`, `SUBMITTED`, `AMBIGUOUS`, `RECONCILING`, `ACKED` sans terminal et `DECIDED` sans outcome (`packages/strategy/src/reconciliation.ts:78`). `reconcileAllUnresolved` prend un snapshot de tous ces ordres sans filtre de marché puis les traite séquentiellement (`reconciliation.ts:386`). Le test adversarial à trois marchés confirme dynamiquement que les trois sont traités.

Dans `runReferenceCycle`, état↔ledger puis `reconcileAllUnresolved` s'exécutent avant `strategy.evaluate` et avant le retour `no_signal` (`packages/strategy/src/run-reference-loop.ts:214`, `:255`, `:265`). Dans `main`, `reconcileAtStartup` est attendu avant l'entrée dans la boucle (`run-reference-loop.ts:737`, `:776`) : il n'existe donc pas, dans ce processus, de premier cycle lancé avant la fin du startup. Sans signer, les réconciliations exchange sont toutes deux sautées ; c'est cohérent avec l'absence de maker L2 mais doit rester visible comme limite.

Il n'y a pas de parallélisme startup/cycle dans `main`. En multi-processus, le verrou ne couvre pas les lectures réseau : deux processus peuvent voir le même ordre `RECONCILING` et effectuer des lectures dupliquées. Il ne s'agit pas de deux `cancelAllOrders` — la réconciliation ne fait que des lectures — mais d'un coût/race de convergence non testé ici. Deux processus peuvent ensuite sérialiser leurs écritures sur la base de preuves prises à des instants différents.

Coût par cycle : pour chaque ordre non réglé sans `order_id`, **2 lectures réseau** (`getOpenOrders` + `getTrades`) ; avec `order_id`, jusqu'à **3** (`getOrder` + les deux scans). Un `ACKED` encore ouvert reste « unresolved » et repaie ce coût à chaque cycle. Par rapport à v0.5, un cycle `no_signal` passe de zéro appel de réconciliation à `2N..3N`. Au démarrage s'ajoutent `2N..3N`, puis un `getOpenOrders` global ; le premier cycle peut immédiatement relire les ACKED restants. Il n'existe ni batching par marché ni backoff. C'est un risque F-11/rate-limit mesurable, non une raison de rouvrir le défaut fonctionnel.

### 4.2 R-02 — fichier KILL vers cancel-all

**Verdict : partiellement fermée.**

`enforceKillSwitch` combine bien `doc.risk.kill_switch_engaged` et `isKillSwitchFileEngaged()` (`packages/strategy/src/reconciliation.ts:475-482`). Si l'un est vrai et que le marqueur est absent, `cancelAllOrders()` est appelé et `meta.kill_switch_cancelall_called=true` est écrit durablement (`:488-498`). Deux appels consécutifs pendant le même engagement n'émettent donc qu'un cancel-all, y compris après redémarrage puisque `meta` est dans l'état durable.

Trois défauts empêchent la fermeture complète :

1. `enforceKillSwitch` n'est appelé qu'au démarrage de `main` (`run-reference-loop.ts:699-705`), jamais dans `runReferenceCycle`. Un fichier KILL créé pendant l'exécution bloque les nouveaux `placeOrder`, mais ne déclenche pas l'annulation des ordres existants.
2. Lorsque les deux sources redeviennent fausses, le chemin `!engaged` retourne sans effacer `kill_switch_cancelall_called` (`reconciliation.ts:483-484`). Le test adversarial retrait→réengagement échoue : le futur engagement légitime est bloqué par un marqueur ancien.
3. Le runbook ordonne d'abord d'arrêter le process (`docs/RUNBOOK-key-compromise.md:36`), puis affirme que créer KILL déclenche un cancel-all (`:55-57`), sans commande de redémarrage ni outil autonome. Process arrêté, aucun code ne peut appeler l'exchange. Sa section « Limites » répète cette capacité sans cette condition (`:115-120`).

Le runbook est donc incohérent avec le code, malgré la correction locale de son §4. Il faut soit surveiller KILL à chaque cycle et réarmer le marqueur sur une transition durable true→false, soit fournir une commande opérateur autonome et atomique « engage + cancel-all + preuve », puis documenter précisément son cycle de vie.

### 4.3 R-03 — provenance du hash

**Verdict : fermée dans Git ; preuve avant/après incomplète.**

Le blob v0.5 de `c524a6ff` contient le bon hash `007572148c216de09c33dd99b16e5092332352a6`. La trace de l'erreur est conservée dans l'en-tête sous forme descriptive, avec renvoi explicite vers v0.5.1 ; l'ancien token invalide n'est pas conservé dans ce blob. La copie décrite dans le prompt, qui portait encore `0075721f6b1d3e8b4c1a5e9f2d8c7b6a5f4e3d2c10`, ne correspond donc pas au blob versionné de M29 : **problème de synchronisation/distribution de copie**.

Au commit `c524`, le test parcourt tous les fichiers `docs/AUDIT-PALLAS-v*.md` et détecte tout token entre backticks de 41 à 63 hex. `AUDIT-PALLAS-v0.5.md` est bien dans le périmètre. Au HEAD `64a94cb`, la garde a été resserrée aux seules lignes déclarant un commit et accepte 7–12, 40 ou 64 hex (`packages/core/src/audit-provenance.test.ts:22-46`). Elle contrôle la plausibilité de format, pas l'existence de l'objet Git ni que le rapport corresponde réellement à cet arbre.

Le test passe sur `c524` parce que le mauvais token a été retiré. Il est impossible de prouver qu'il échouait au parent `0075721` : le parent ne contient ni le rapport v0.5 ni le test. La garde et le document corrigé ont été introduits ensemble. Cela limite la qualité de la démonstration TDD annoncée, mais ne contredit pas le passage isolé observé sur le commit de fermeture.

Contradiction documentaire nommée : v0.5.1 dit « le fichier v0.5 a été corrigé, trace conservée » ; la copie externe relue portait encore le faux hash. Le blob Git M29 donne raison à v0.5.1, tandis que la copie distribuée était obsolète. La chaîne doit désormais distribuer les rapports avec leur hash de blob/commit, faute de quoi cette classe de doute reviendra.

## 5. Axe 1 — Fidélité d'exécution

La réconciliation indépendante du signal est réelle et traite tous les statuts non terminaux définis. Le scénario multi-marchés passe. Le démarrage est séquentiel et attend sa réconciliation avant le premier cycle. La réserve principale reste l'attribution heuristique prix/côté/taille/fenêtre : plusieurs ordres jumeaux peuvent chacun attribuer le même trade, puisque `getTrades` est relu par ordre et qu'aucun fill n'est consommé globalement (`reconciliation.ts:245-275`). Les balances, positions et collateral exchange ne deviennent pas une source autoritative.

Le kill switch externe bloque fidèlement l'émission, mais sa promesse d'annuler les ordres existants n'est vraie que si `enforceKillSwitch` est effectivement invoqué, actuellement au startup. Cette divergence code/runbook réduit la fidélité du chemin d'urgence.

**Note axe 1 : 3,9/5** (v0.5 : 4,0). R-01 progresse, mais R-02 M29 partielle et la suite rouge empêchent une hausse.

## 6. Axe 2 — Gestion des risques

Les limites Rust, la convergence prudente lorsque les sources réseau sont incomplètes, et la prise en compte des fills reconnus restent intactes. `cargo test` et Clippy passent. Aucun changement n'a rendu les balances/collateral ou le portefeuille exchange autoritatifs. L'attribution heuristique v0.5 R-02 reste inchangée et peut surcompter un même fill sur des ordres jumeaux ; elle est conservatrice pour l'exposition mais non exacte.

Le défaut de réarmement du cancel-all et l'absence de surveillance cyclique du fichier réduisent l'efficacité d'un contrôle d'urgence au moment où le risque est maximal.

**Note axe 2 : 3,5/5** (v0.5 : 3,6).

## 7. Axe 3 — Viabilité opérationnelle

Le progrès vérifié est réel sur l'outillage Rust : Clippy est désormais reproductible et vert. La provenance Git est corrigée. En revanche :

- `npm test` n'est pas vert dans l'environnement d'audit ;
- le journal M29 affirme 304/0 sans reproduire les quatre skips ni les deux échecs actuels ;
- le runbook d'urgence est inexécutable tel qu'écrit après l'arrêt du process ;
- un second engagement KILL peut ne produire aucune annulation ;
- aucune campagne ≥72 h n'existe ; le seul artefact reste 720,713 s, avec un redémarrage et sans état produit ;
- le coût `2N..3N` par cycle n'a pas été observé sur 72 h ni confronté aux rate limits.

**Note axe 3 : 2,9/5** (v0.5 : 3,4). La baisse reflète des preuves dynamiques négatives et la fiabilité imparfaite de la chaîne journal/code, pas le seul incident de copie.

## 8. Score comparatif

| Axe | v0.2.1 | v0.3 | v0.4 | v0.5 | v0.5.2 | Évolution v0.5→v0.5.2 |
|---|---:|---:|---:|---:|---:|---|
| Fidélité d'exécution | 2,7/5 | N/P | 3,3/5 | 4,0/5 | **3,9/5** | réconciliation globale prouvée ; kill cancel-all non surveillé/réarmé |
| Gestion des risques | 2,0/5 | N/P | 3,1/5 | 3,6/5 | **3,5/5** | Rust vert ; contrôle d'urgence incomplet |
| Viabilité opérationnelle | 1,6/5 | N/P | 2,4/5 | 3,4/5 | **2,9/5** | Clippy devient vérifiable, mais suite TS rouge, runbook divergent, F-11 ouvert |
| **Moyenne arithmétique** | **2,1/5** | niveau 2/5 | **2,9/5** | **3,67/5** | **3,43/5** | recul de confiance opérationnelle |

**Maturité globale maintenue à 2/5.** R-03 ne justifie pas à elle seule une baisse de niveau, car le commit est cohérent ; le résultat TS non reproductible, R-02 partielle et F-11 ouverte interdisent en revanche le niveau 3.

## 9. Risques financiers restants

| ID | Sévérité | État v0.5.2 | Condition de levée |
|---|---|---|---|
| F-11 | Élevée | **OUVERT** — aucune observation ≥72 h | campagne signée, marché actif, incidents et rate limits mesurés |
| v0.5 R-02 | Moyenne | **inchangé** — fills attribués heuristiquement | identifiant fiable ou allocation globale non duplicative des fills |
| v0.5 R-03 | Faible/opérationnelle | **inchangé** — re-signature périodique manuelle | procédure opérateur éprouvée ou signer externe automatisé |
| M29 R-01 | Moyenne résiduelle | fonctionnellement fermé ; coût/race de lectures | batching, backoff, test multi-processus et campagne longue |
| M29 R-02 | Élevée | **partiellement fermé** | surveillance effective, réarmement et runbook exécutable |
| M29 R-03 | Faible résiduelle | fermé dans Git ; distribution non attestée | publier commit/blob avec chaque copie ; valider existence Git |
| Suite TS | Élevée/opérationnelle | **ouverte** — 2 probes échouent | expliquer/corriger les sorties vides et obtenir plusieurs runs verts |

## 10. Constats résiduels

### R-04 — cycle de vie du kill switch incomplet (élevée)

Le marqueur `kill_switch_cancelall_called` représente « déjà appelé un jour », non « déjà appelé pour l'engagement courant ». Il n'est jamais effacé. La surveillance du fichier n'appelle pas `enforceKillSwitch` dans la boucle. Correctif minimal : persister une génération/identité d'engagement et son accusé de cancel-all, surveiller à fréquence bornée, puis réarmer uniquement après désengagement explicite et vérifié.

### R-05 — suite monorepo non reproductible (élevée opérationnelle)

Les probes 2×5 ledger/état échouent de façon reproductible dans cet audit avec processus enfant silencieux, alors que les 4×3 passent. Il faut capturer code/signal de sortie et cause de terminaison, puis stabiliser le harnais. Jusqu'alors, « suite verte » n'est pas prouvé.

### R-06 — garde de provenance syntaxique seulement (faible)

La garde accepte tout token de longueur plausible, même inexistant. Ajouter `git cat-file -e <sha>^{commit}` pour les déclarations locales et, idéalement, un manifeste rapport→commit→hash de blob distribué.

## 11. Conclusion et décision

**Capital réel : NO-GO.** F-11, le portefeuille non autoritatif, l'attribution heuristique, le kill switch partiel et la suite rouge sont incompatibles avec une exposition réelle.

**Paper trading supervisé prolongé : NO-GO.** La campagne ≥72 h n'a jamais eu lieu et le contrôle d'urgence décrit par le runbook n'est pas garanti pendant l'exécution ni lors d'un second engagement.

**Campagne courte : NO-GO en l'état ; GO conditionnel après deux corrections préalables vérifiées** : (1) rendre le cycle KILL opérable et réarmable avec test dynamique ; (2) obtenir `npm test` entièrement vert, en rapportant séparément pass/fail/skip. Elle devra ensuite utiliser un marché actif, un ledger supervisé et mesurer explicitement le volume `getOrder/getOpenOrders/getTrades`.

La fiabilité de la chaîne d'audits est un facteur bloquant **distinct** : R-03 est corrigée dans Git, mais une copie obsolète a circulé et le journal M29 ne correspond pas au rejeu actuel de la suite. Ce facteur ne remplace pas F-11 ni les résidus techniques ; il s'y ajoute jusqu'à ce que chaque rapport soit distribué avec une provenance vérifiable et des sorties de tests brutes reproductibles.
