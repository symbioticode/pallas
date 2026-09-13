# Journal de mission PALLAS-M30

**Date d'exécution :** 2026-09-13
**Commit de correction :** `8ffc8aa550b60d62d352dc5b056f1a38fc034aba`
**Base :** `64a94cb043ecfdc49d1062419041f8a38ae2d733`

## Verdict

Les trois écarts d'AUDIT-PALLAS-v0.5.2 sont corrigés et rejoués. Le bundle CT-2026-019 reste
invalidé. CT-2026-020 est régénéré et épinglé, mais **n'a pas été lancé** et n'est pas autorisé
sans nouvelle approbation indépendante.

## A — Suite de tests

### Avant

Le rejeu v0.5.2 donnait 298 pass / 2 fail / 4 skip. Les échecs exacts étaient :

- `packages/ledger/src/ledger-concurrency.test.ts`, scénario 2 processus × 5 : stdout enfant vide ;
- `packages/strategy/src/concurrency-probe.test.ts`, scénario 2 processus × 5 : stdout enfant vide.

La reproduction minimale a montré que, dans le sandbox courant, `execFile(process.execPath, ...)`
peut rendre stdout/stderr vides même quand le script enfant écrit sur stdout. Les probes ont donc
été rendus indépendants de ce transport : environnement test explicite et verdict JSON écrit dans
un fichier temporaire propre à chaque enfant. La portée 2×5 et 4×3 est inchangée ; aucun skip n'a
été ajouté.

### Après

`npm test` réellement rejoué : **304 passed, 0 failed, 4 skipped, 308 total**, 26 fichiers verts.
Les quatre skips sont les quatre scénarios bwrap déjà connus : l'environnement refuse la création
du namespace réseau (`NETLINK_ROUTE: Operation not permitted`). Le test négatif fail-closed bwrap
passe ; M30 n'introduit aucun skip.

## B — Kill switch

### Avant

`enforceKillSwitch` n'était appelé qu'au démarrage et le booléen durable
`meta.kill_switch_cancelall_called` n'était jamais effacé. Un fichier créé après le démarrage ne
déclenchait pas le cancel-all ; retrait puis redépôt retournait `not_needed` au second incident.

### Après

- `runReferenceCycle` appelle `enforceKillSwitch` avant la réconciliation à chaque cycle ;
- lorsqu'un cycle observe les deux sources désengagées, il efface le marqueur de l'engagement fini ;
- un engagement continu reste idempotent et durable à travers un redémarrage ;
- le runbook impose KILL puis preuve `cancelAll:"called"`, puis arrêt du process.

Preuves ciblées :

- KILL créé entre deux cycles : **1** cancel-all au second cycle ;
- présent → présent : toujours **1** appel ;
- présent → retiré → redéposé : **2** appels au total.

## C — Réconciliation

### Coût avant/après

Avant M30, N ordres sans `order_id` provoquaient `2N` lectures par passe ; avec identifiant,
jusqu'à `3N`. Pour N=5 sans identifiant : 5 `getOpenOrders` + 5 `getTrades` = **10 appels**.

Après M30, le scan global des ordres ouverts du maker est partagé par toute la passe. N=5 donne
1 `getOpenOrders` + 5 `getTrades` = **6 appels**. Avec identifiants, le plafond devient
`1 + N getTrades + N getOrder`, soit `2N+1`. Les trades restent filtrés par asset dans l'API et ne
sont donc pas fusionnés sans modifier la sémantique de preuve.

### Chevauchement

Deux appels simultanés à `reconcileAllUnresolved` sur le même chemin d'état partagent désormais
une Promise single-flight : pour N=3, le test mesure **1** scan ouvert et **3** scans trades au
total, résultats identiques pour les deux appelants. Cette protection est intra-processus ; le
verrou durable continue de protéger les écritures interprocessus, mais deux processus distincts
peuvent encore effectuer des lectures exchange redondantes.

## Validation finale

| Contrôle | Résultat réel |
|---|---|
| tests ciblés M30 | 31/31 pass |
| `npm test` | 304 pass / 0 fail / 4 skip (308 total) |
| `cargo test --all-targets` | 65 pass / 0 fail |
| `cargo clippy --all-targets --all-features -- -D warnings` | pass |
| `git diff --check` | pass |

## État du bundle M27

- **CT-2026-019 : INVALIDATED**, ne doit être ni relancé ni crédité pour F-11.
- **CT-2026-020 : PREPARED_NOT_LAUNCHED**, source sous `scripts/ct/m30-m27-72h/`.
- Le manifeste épingle le commit de correction `8ffc8aa550b60d62d352dc5b056f1a38fc034aba`,
  les chiffres de tests et les SHA-256 du launcher, du superviseur, des dist runtime et du binaire
  risk-engine.
- Aucune campagne courte ou 72 h n'a été lancée pendant M30. La matérialisation et l'approbation
  du bundle dans le CT runner restent une étape externe distincte.

## Limites résiduelles

- Un retrait/redépôt KILL entièrement entre deux polls est indétectable ; l'intervalle de cycle
  borne la résolution. Une commande opérateur autonome resterait préférable pour l'urgence absolue.
- Le single-flight est intra-processus, pas distribué.
- F-11 reste ouvert jusqu'à une vraie observation ≥72 h sur CT-2026-020 approuvé.
