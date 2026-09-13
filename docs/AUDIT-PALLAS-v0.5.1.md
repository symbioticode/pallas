# Audit indépendant de Pallas v0.5.1 — addendum de provenance et de correction

**Date :** 2026-09-13
**Base :** `docs/AUDIT-PALLAS-v0.5.md` (audit daté du 2026-09-12)
**Branche :** `missions-M21-M28`
**Commit audité par v0.5 (corrigé) :** `007572148c216de09c33dd99b16e5092332352a6`
**Commit des corrections M29 :** `c524a6ff16f16b61ed33882654c237a7849ddc0b`

> Cet addendum ne réécrit pas le verdict de v0.5 : il corrige sa **provenance** et documente la
> fermeture de deux constats. Le socle v0.5 reste valide (niveau de maturité 2/5 ; F-11 ouvert).

## 1. Correction de provenance (revue M29, point 3)

- v0.5 annonçait le commit audité `0075721f6b1d3e8b4c1a5e9f2d8c7b6a5f4e3d2c10` — **42
  caractères hexadécimaux**, donc ni SHA-1 (40) ni SHA-256 (64) : identifiant invalide.
- Le HEAD réel de `missions-M21-M28` au moment de l'audit est
  `007572148c216de09c33dd99b16e5092332352a6` (40 hex, vérifié par `git rev-parse HEAD`).
- `docs/AUDIT-PALLAS-v0.5.md` a été corrigé, **la trace de l'erreur étant conservée** dans son
  en-tête.
- **Garde automatisée** : `packages/core/src/audit-provenance.test.ts` échoue si un rapport
  `AUDIT-PALLAS-v*.md` contient un token hexadécimal de 41 à 63 caractères (commit-like
  malformé). La récidive est impossible sans faire échouer la suite.

## 2. Fermeture de la revue M29 R-01 — réconciliation indépendante du signal

**Avant** : `runReferenceCycle` retournait AVANT la création du store et avant
`reconcileStateLedger`/`reconcileScopeForMarket` dès que la stratégie ne produisait aucun signal.
La campagne M27 l'a mesuré : **93/93 cycles `no_signal`, aucune réconciliation**. De plus,
`reconcileScopeForMarket` ne traitait que le marché du signal courant, et
`reconcileAtStartup` n'était appelé par personne (code mort).

**Après** (commit `c524a6ff`) :
- nouvelle fonction `reconcileAllUnresolved(ctx)` : réconcilie **tous** les ordres locaux non
  réglés, quel que soit leur marché ;
- l'étape « rattrapage état↔ledger + réconciliation » s'exécute à **chaque cycle**, **avant**
  l'évaluation du signal, donc aussi en régime `no_signal` ;
- `reconcileAtStartup` est **câblé** dans `main()` (ordres non réglés + ingestion des ordres
  ouverts externes) quand un maker L2 est disponible.

**Preuve** : test `M29/R-01` (écrit AVANT correctif) — un ordre `AMBIGUOUS` sur un marché
**différent** de celui interrogé par la stratégie, cycle `no_signal` :
`AMBIGUOUS` avant → `TERMINAL/filled` après.

## 3. Fermeture de la revue M29 R-02 — fichier KILL → cancel-all réel

**Avant** : `enforceKillSwitch` ne lisait que `doc.risk.kill_switch_engaged` ; le fichier
`.pallas/KILL` (M25) bloquait les **nouvelles** émissions au point d'émission, mais ne
déclenchait **aucune** annulation des ordres **déjà ouverts** — alors que le runbook affirmait le
contraire. C'était l'écart documentation/code le plus dangereux à traiter.

**Après** (commit `c524a6ff`) : `enforceKillSwitch` combine l'état durable **et**
`isKillSwitchFileEngaged()` ; le fichier déclenche un `cancelAllOrders()` réel, idempotent via
`meta.kill_switch_cancelall_called`, et la **source** (`state` / `file` / `state+file`) est
tracée dans le détail retourné.

**Preuve** : test `M29/R-02` (écrit AVANT correctif) — état durable à `false`, fichier
`KILL` seul : `cancelAllOrders` appelé **une fois**, état durable **non inventé** après.

## 4. Distinction avec les constats résiduels numérotés de v0.5

| v0.5 | Nature | État après M29 |
|---|---|---|
| `R-01` (reconcileAtStartup code mort) | même problème de fond que la revue M29 R-01 | **TRAITÉ** |
| `R-02` (attribution heuristique des fills, sans client order id) | limite d'API Polymarket | **inchangé** (documenté) |
| `R-03` (re-signature périodique manuelle du ledger) | limite opérationnelle | **inchangé** (documenté) |

## 5. État de la suite après corrections

| Vérification | Résultat |
|---|---|
| `npm test` | **304 passed / 0 failed**, 26 fichiers |
| `cargo test --all-targets` | 65/65 (aucun changement Rust) |

## 6. Limites non levées par v0.5.1

- **F-11 (observation ≥ 72 h)** reste **OUVERT** : la campagne réelle n'a pas été faite.
- **Attribution heuristique des fills** (v0.5 R-02) : acceptable en sécurisation, pas une
  identification cryptographique.
- **Aucun exercice live/testnet** : les corrections sont prouvées par tests rejoués, pas par un
  ack ou un fill réels.
- Les deux fichiers état/ledger restent séparés (pas de transaction ACID commune).