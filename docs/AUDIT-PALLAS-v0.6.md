# Audit indépendant de Pallas v0.6

**Date :** 13 septembre 2026 (America/Toronto)
**Dépôt :** `/home/andrei/Projects/80_PALLAS/pallas`
**Cible :** tag annoté `pallas-mvp-freeze-1`, résolu par moi-même en
`e69d7542f79ff3e6a24df60773147a6a2f400986` (identique au hash annoncé par le prompt).
**Branche :** `missions-M21-M28`. **Arbre suivi propre** au moment du rejeu.
**Environnement de rejeu :** worktree git **détaché** créé depuis le commit de gel,
`npm ci` + `cargo build` + clippy dans le `shell.nix` épinglé.

> **Cadrage (prompt §0).** L'objectif n'est pas 5/5. Le seuil visé est **4/5 de moyenne + GO**
> **campagne de paper trading supervisée**. Le GO capital réel n'est pas visé. Les trois familles
> de verdict (capital réel / paper supervisé / campagne courte) sont distinguées explicitement.

## 1. Verdict exécutif

### Seuil paper trading : **partiellement atteint**

- **GO campagne de paper trading supervisée : OUI** — les quatre blocages nommés par v0.5.2 sont
  levés, et je les ai **rejoués** (suite verte, KILL opérable en cycle, bundle pinné).
- **Moyenne 4/5 : NON atteinte** — **3,9/5** (4,1 / 3,7 / 4,0). L'écart de 0,1 est concentré sur
  l'axe 2 et porte sur une exigence de **capital réel** (portefeuille non autoritatif), pas sur un
  blocage de paper trading.

Le **gel est réel** : sur mon propre rejeu du commit figé, `npm test` est vert (308/0/0),
`cargo test` 65/0 et `cargo clippy -D warnings` sort 0. Le tag n'est donc pas un
artefact documentaire : il pointe un arbre effectivement vert.

**Décisions par famille :** capital réel **NO-GO** ; paper trading supervisé **GO** (conditionnel à
la matérialisation du bundle ci-dessous) ; campagne courte supervisée **GO**.

## 2. Méthode et référentiel

Grille inchangée : **Fidélité d'exécution / Gestion des risques / Viabilité opérationnelle**. Ordre
de preuve **dynamique > code > documentaire > non vérifiable**. Aucun chiffre recopié : chaque
valeur de la §3 provient d'une commande exécutée ici. Référentiels externes repris de v0.5 (SEC
Rule 15c3-5, FIA 2024, doc Polymarket ordres+trades).

## 3. Résultats d'exécution (rejoués)

| Vérification | Résultat réellement observé |
|---|---|
| `git rev-parse 'pallas-mvp-freeze-1^{commit}'` | `e69d7542f79ff3e6a24df60773147a6a2f400986` (tag annoté, objet `tag`) |
| `npm test` sur worktree propre du commit figé | **308 passed / 0 failed / 0 skipped**, **26 fichiers** |
| `cargo test --all-targets` | **65 passed / 0 failed** (47 + 0 + 15 + 3) |
| `cargo clippy --all-targets --all-features -- -D warnings` | **exit 0** |
| pin d'artefacts positif (`artifact-pin-test.sh`) | **ARTIFACT_PIN_TEST positive=PASS** (8/8) |
| pin négatif (octet ajouté à `packages/execution/dist/dryRun.js`) | **negative=REJECTED** explicite |
| provenance `1572298…` | `git cat-file -t` = `commit` ; commit M30 « regenerate pinned M27 campaign bundle », parent `8ffc8aa` |
| campagne ≥ 72 h | **aucune** : la plus longue trace est **705 332 ms** (~11,8 min), `reason=sigterm` |

## 4. Vérifications obligatoires du prompt

### 4.1 Pin des 8 artefacts — **complet**

`scripts/ct/m30-m27-72h/verify-artifact-pins.mjs` **exige 8 artefacts** et compare un SHA-256
par artefact (échec bloquant sinon). Il est appelé :
- par `execute.sh` **avant** installation (`--root $BUNDLE/artifacts`) **et après** installation
  (`--root $REPO`) ;
- par `dry-run.sh` en lecture seule (`--root $REPO`).

Rejeu : les 8 hashes du manifeste **correspondent aux fichiers réels** (8/8 MATCH), le test positif
passe, et l'altération d'un octet d'un `dist/` est **rejetée nommément**. Le défaut relevé par
v0.5.2/M30 (2 artefacts sur 8 seulement) est **fermé**.

**Réserve R-07** : le dossier `scripts/ct/m30-m27-72h/artifacts/` est **absent** de l'arbre figé.
C'est cohérent avec le `README` (« lors de la matérialisation dans le CT runner, le dossier
`artifacts/` doit reproduire les chemins »), mais cela signifie que le **bundle figé n'est pas
auto-suffisant** : `execute.sh` échoue à sa précondition `[[ -d "$BUNDLE/artifacts" ]]` tant que cette
matérialisation externe n'a pas eu lieu. Le pin est complet ; la **charge utile** ne l'est pas.

### 4.2 Provenance du second commit M30 — **confirmée**

`git cat-file -t 15722989704315a5b023a952a54c79f2d1052022` → `commit`.
`git log -1` → « PALLAS-M30: regenerate pinned M27 campaign bundle », **parent `8ffc8aa`**
(= commit de correctifs M30). Contenu : journal M30, `PLAN-M27-72h`, bundle CT-2026-020 et les
deux artefacts d'orchestration. Il ne s'agit **pas** d'une référence orpheline. M31 l'a confirmé ;
je le confirme indépendamment.

### 4.3 Rejeu complet sur le commit figé — **pas d'écart caché**

Les chiffres annoncés par M30 (304/0/4) diffèrent des miens (308/0/0) **uniquement** sur les 4
skips, qui sont les tests d'isolation bwrap : ils se skippent quand l'environnement refuse le
netns (`NETLINK_ROUTE: Operation not permitted`) et s'exécutent ici. M30 documentait déjà cette
dépendance ; M31 et le tag annoncent 308/0/0, que je reproduis. **Aucune régression cachée, aucune
valeur recopiée.** Réserve R-08 : le `bundle-manifest.json` **figé** conserve
`test_evidence: {passed:304, failed:0, skipped:4, total:308}` — une valeur **propre à un hôte**,
qui ne coïncide pas avec le rejeu du gel. À horodater/environner dans la preuve figée.

### 4.4 Kill switch — **cycle de vie fermé**

Le correctif M30 est présent dans le code figé :
- `run-reference-loop.ts:224` appelle `enforceKillSwitch` **à chaque cycle** (en plus du
  démarrage `:714`) ;
- `reconciliation.ts:524-537` : quand les deux sources sont désengagées, le marqueur
  `kill_switch_cancelall_called` est **effacé** → une transition ultérieure `false→true`
  réarme un **nouveau** cancel-all ;
- `reconciliation.ts:544-550` : sur engagement sans marqueur, `cancelAllOrders()` réel puis
  marqueur durable.
Le `RUNBOOK` est désormais **cohérent avec le code** : §2 ordonne « engager KILL **puis**
attendre la preuve `cancelAll:"called"` **puis** arrêter », et les limites actent la condition
« run loop actif ». Le scénario « présent → retiré → redéposé → 2ᵉ cancel-all » est couvert par les
tests M30 rejoués (verts).

### 4.5 Réconciliation — coût borné, concurrence intra-processus

`reconcileAllUnresolved` (`reconciliation.ts:429-438`) partage un scan des ordres ouverts
(`openSnapshot` passé à `reconcileOrder` à `:422`) et **single-flight** les appels concurrents
par chemin d'état. Le coût passe de `2N..3N` à `1+N` (sans identifiant) / `2N+1` (avec).
**Réserve R-10** : le single-flight est **intra-processus** ; deux processus distincts peuvent
encore dupliquer des lectures exchange (lectures seules — pas de double cancel-all).

## 5. Axes (avec distinction paper / capital)

### Axe 1 — Fidélité d'exécution : **4,1/5**

La réconciliation indépendante du signal (M29 R-01) est en place et testée ; le cycle de vie du
kill switch (M30) est correct pendant l'exécution ; la suite est verte sur le gel. **Bloque le
capital réel** : aucun ack/fill live, attribution des fills heuristique (v0.5 R-02). **Ne bloque
pas le paper** : en dry-run, cette attribution ne distribue aucun capital.

### Axe 2 — Gestion des risques : **3,7/5**

Limites Rust inchangées et vertes ; exposition non sous-estimée par fausse annulation ; contrôle
d'urgence désormais opérant en cours de run et réarmable. **Bloque le capital réel** : portefeuille
non autoritatif (balances/collateral/positions non ingérés), attributions heuristiques. **Ne bloque
pas le paper** : aucun capital engagé.

### Axe 3 — Viabilité opérationnelle : **4,0/5**

Suite **verte et reproductible** (308/0/0 rejoué), Clippy vert reproductible, **tag de gel** sur un
arbre vert, pin 8/8, runbook exécutable, squelette `docs/mvp/` livré sans préjuger du verdict.
**Bloque encore** : F-11 (aucune observation ≥72 h) et la matérialisation externe du bundle (R-07).

## 6. Statut de F-11

**F-11 reste OUVERT.** Les traces sur disque montrent :
- une campagne lancée le 2026-09-13T11:07:56Z, cible **4320 min**, arrêtée à **705 332 ms**
  (`reason=sigterm`), 134 entrées ledger, **état durable 12 924 octets** (donc des signaux/ordres
  existaient), `git_commit: 64a94cb` ;
- des campagnes antérieures (02:32–03:36) sans résumé ; aucun PID actif actuellement.

Deux constats pour le cadrage §5 : (a) **aucune** campagne n'atteint 72 h ; (b) la plus longue a
tourné sur le commit **M29 (`64a94cb`)**, c'est-à-dire **hors de la baseline figée**. F-11 est
une condition du **GO capital réel** et de la **campagne prolongée probante** ; il **n'est pas** un
blocage du démarrage d'une **campagne paper supervisée** — c'est précisément l'objet que cette
campagne doit mesurer, sans capital engagé.

## 7. Score comparatif

| Axe | v0.2.1 | v0.3 | v0.4 | v0.5 | v0.5.2 | v0.6 |
|---|---:|---:|---:|---:|---:|---:|
| Fidélité d'exécution | 2,7/5 | N/P | 3,3/5 | 4,0/5 | 3,9/5 | **4,1/5** |
| Gestion des risques | 2,0/5 | N/P | 3,1/5 | 3,6/5 | 3,5/5 | **3,7/5** |
| Viabilité opérationnelle | 1,6/5 | N/P | 2,4/5 | 3,4/5 | 2,9/5 | **4,0/5** |
| **Moyenne** | **2,1/5** | niveau 2 | **2,9/5** | **3,67/5** | **3,43/5** | **3,9/5** |

Le progrès v0.5.2→v0.6 est réel et **rejoué** : la suite repasse au vert, le pin devient complet,
le kill switch devient opérable, et le code est **gelé**. La moyenne reste sous 4,0 d'environ 0,1,
du fait de l'axe 2 (portefeuille non autoritatif) qui est une exigence **capital réel**.

## 8. Risques financiers restants

| ID | Sévérité | État v0.6 | Condition de levée |
|---|---|---|---|
| F-11 | Élevée | **OUVERT** — aucune observation ≥72 h ; dernière = 705 s sur M29 | campagne paper ≥72 h sur la baseline figée, ledger supervisé, incidents + rate limits mesurés |
| F-04 | Élevée | partiel — exposition non autoritative (pas de balances/collateral) | ingestion positions/collateral exchange |
| v0.5 R-02 | Moyenne | inchangé — attribution des fills heuristique | identifiant fiable ou allocation globale non duplicative |
| v0.5 R-03 | Faible/op. | inchangé — re-signature périodique manuelle | signer externe automatisé ou procédure éprouvée |
| M29 R-02 / v0.5.2 R-04 | Élevée | **FERMÉ (code+tests rejoués)** — KILL par cycle + réarmement | conserver |
| v0.5.2 R-05 (suite) | Élevée/op. | **FERMÉ sur ce poste** — 308/0/0 rejoué | conserver ; documenter la dépendance bwrap |
| v0.5.2 R-06 (provenance) | Faible | **FERMÉ (garde resserrée)** | option : valider l'existence Git du hash (`git cat-file -e`) |

## 9. Constats résiduels nouveaux

- **R-07 (moyenne, opérationnelle)** — le bundle figé n'est **pas auto-suffisant** :
  `scripts/ct/m30-m27-72h/artifacts/` est absent, donc `execute.sh` ne peut pas tourner
  depuis le seul tag. À matérialiser (puis re-vérifier 8/8) avant tout lancement.
- **R-08 (faible, provenance)** — `bundle-manifest.json` fige `test_evidence 304/0/4`
  (propre à l'hôte M30) alors que le gel et mon rejeu donnent 308/0/0. Horodater l'environnement
  dans la preuve figée pour éviter la confusion « 304 vs 308 ».
- **R-09 (élevée, calendrier)** — la seule campagne d'observation récente a tourné sur `64a94cb`
  (M29), **pas** sur la baseline figée. Une campagne paper doit partir du tag.
- **R-10 (faible, concurrence)** — single-flight **intra-processus** seulement ; lectures exchange
  dupliquées possibles entre processus (lectures seules).

## 10. Conclusion et décision

### Seuil de 4/5 et GO paper trading supervisé

- **GO paper trading supervisé : OUI.** Les blocages de v0.5.2 sont levés et rejoués : suite verte,
  kill switch opérable/réarmable, bundle pinné 8/8, gel effectif. Une campagne paper n'engage pas
  de capital et est le **mécanisme de mesure** de F-11.
- **Moyenne 4/5 : NON atteinte (3,9/5).** Ce qui manque, précisément et actionnablement :
  1. **Faire tourner la campagne paper sur le tag** (marché produisant des signaux, ledger
     `supervised`, intervalle 30 s), ≥72 h, en mesurant explicitement le coût
     `getOpenOrders/getTrades` et les rate limits — c'est ce qui relèvera l'axe 3 au-delà de 4,0.
  2. **Matérialiser `artifacts/`** du bundle figé puis re-vérifier 8/8 (R-07) — condition
     d'exécution depuis le tag.
  3. **Ingérer balances/collateral/positions** pour rendre l'exposition autoritative (axe 2) —
     exigence **capital réel**, non bloquante pour le paper.

### Décision par famille

- **Capital réel : NO-GO.** F-11, portefeuille non autoritatif, attribution heuristique.
- **Paper trading supervisé : GO** (conditionnel à R-07 : matérialiser le bundle et lancer depuis le
  tag). C'est la voie qui ferme F-11.
- **Campagne courte supervisée : GO.** Les deux prérequis posés par v0.5.2 (cycle KILL opérable ;
  `npm test` entièrement vert) sont satisfaits et vérifiés.

### Ce que v0.6 ne crédite pas

- Aucune correction n'est créditée sur la base d'un journal non rejoué : chaque chiffre de la §3
  vient d'une commande exécutée ici.
- Les réserves acceptées pour le paper (attribution heuristique des fills, re-signature manuelle
  du ledger) restent listées comme **blocages capital réel**, pas comme blocages uniformes.
- L'écart 304/308 est expliqué par l'environnement (bwrap), pas dissimulé (R-08).