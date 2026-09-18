# JOURNAL — PALLAS-M13 — Transaction durable décision→ordre→ack et persistance atomique de l'état

Date : 2026-09-11
Agent : big-pickle (opencode) — mission exécutée en autonomie
Statut : TERMINÉE — 🔴 préalable bloquant levé pour M14-M20

## Synthèse attentive

L'audit v0.3 §4.5 (F-01, F-02) met en cause la persistance de l'état : `loadState`/
`saveState` avalaient la corruption et réécrivaient sans atomique/verrou/fsync, ouvrant
les quatre fenêtres de crash. La correction livrée remplace cette persistance par une
transaction durable : document versionné + checksummé sur disque, verrou interprocessus,
fail-stop catégorique, machine d'états par ordre avec identifiant de corrélation unique.

Le choix fichier+lock+fsync vs SQLite est documenté en §6.3 ci-dessous, dans l'esprit
de ce que M14/M15/M16 doivent construire par-dessus : la réconciliation (M14) a besoin
qu'un état `SUBMITTING`/`AMBIGUOUS` soit DURABLE ; l'exposition (M15) a besoin de lire
les ordres passés ; le ledger (M16) réutilise exactement les utilitaires atomiques
écrits ici (`atomicfs`, `file-lock`).

## 1. Ce qui était en cause (rappel des 4 fenêtres)

1. **A — décision perdue avant persistance** : un `signal` interrompu pendant/juste avant
   `saveState` laissait une décision sans aucune trace.
2. **B — état avancé sans preuve d'ordre** : décision écrite mais process tué avant
   `placeOrder` → à l'époque, `loadState` au redémarrage trouvait l'ancien état et
   **réinitialisait silencieusement** via `catch`.
3. **C — ordre potentiellement réel sans trace locale** : `placeOrder` lancé, process
   tué avant la réponse — rien ne disait si l'ordre avait été envoyé.
4. **D — ledger tracé sans statut transactionnel clair** : la trace ledger existait,
   mais sans lien avec un état transactionnel d'ordre (pas de correlationId, pas de statut).

## 2. Ce qui est livré

**Nouveaux modules (`@pallas/core`) :**
- `packages/core/src/atomicfs.ts` — `atomicWriteFileSafe(path, data)` : temp à nom **unique**
  (`.name.<pid>.<random>.tmp`, jamais `.tmp` fixe), mode `0o600`, écriture + `fsync` fichier +
  `rename` atomique + `fsync` répertoire (best-effort). Nettoyage du temp sur échec.
- `packages/core/src/file-lock.ts` — `FileLock` : verrou par répertoire (`mkdir` atomique,
  POSIX) avec détection de stale (`staleMs`), `timeoutMs`, retry, `FileLockError`. Limites
  documentées dans le module : local seulement, pas de réentrance, pas distribué.

**Persistance transactionnelle (`@pallas/strategy`) :**
- `packages/strategy/src/durable-state.ts` :
  - doc `{ version: 2, checksum: sha256(canon({version,risk,orders,meta})), risk, orders, meta? }`
  - schéma **strict** Zod (statuts bornés, UUID correlationId, hash intent 64 hex…) ;
  - **fail-stop** `read()` : ENOENT → état neuf LÉGITIME ; présent mais JSON/schéma/version/
    checksum invalides → `StateCorruptionError` FATAL (jamais d'état neuf silencieux) ;
  - `write()` valide AUSSI le doc avant persistance (bug de transition → erreur, pas corruption) ;
  - `withLock(read→mutate→write→release)` : la décision est validée ET persistée sous UN seul verrou ;
  - `nextCorrelationId` : UUIDs anti-collision fondés sur l'état persistant ;
  - `newLifecycle`/`transitionLifecycle` (immutables) + `checksumOfState` canonique.
- `packages/strategy/src/run-reference-loop.ts` réécrit :
  - machine à états `DECIDED → SUBMITTING → SUBMITTED/AMBIGUOUS → ACKED → TERMINAL`,
    transitions **persistées DURABLEMENT avant toute émission** ;
  - `correlation_id` propagé au ledger (`risk_decision`, `execution_*`) ;
  - dry-run bloqué → retour véridique à `DECIDED` + `outcome: dry_run_blocked` (aucune
    ré-émission) ; `AmbiguousOrderError` → `AMBIGUOUS` + `outcome: pending_reconciliation` ;
  - hook `crashAfter` (tests) en 4 points : `before_decided`, `decided_written`,
    `submitting_written`, `acked_written` ; `CrashSimulationError` jamais avalé par le catch ;

**Observability (Observatory, v2) :**
- `snapshot.ts` : `readDurableState()` lit le doc v2, vérifie le checksum (fidèle à
  `checksumOfState`, y compris l'encodage `meta:undefined`) ; format `MISSING`/`LEGACY_V1`/
  `V2`/`CORRUPT` ; un état falsifié ne fait PAS autorité ; recompte des statuts et notes de
  réconciliation.
- `render.ts` : nouveau panneau **DURABILITY · STATE** (format, intégrité, ordres
  enregistrés, correlationId, notes de réconciliation).
- Types étendus (`types.ts`).

**Migration :** `.pallas/risk-state.json` était en format v1 (pré-M13, sans version) ;
contenu vérifié identique à l'état neutre (hist_pnls vides, breaker fermé) → migré en v2
via le store (une fois) et documenté.

## 3. Preuve des 4 fenêtres de crash simulées

Test : `packages/strategy/src/crash-windows.test.ts` (le hook `crashAfter` tue le cycle à
l'instant exact de chaque fenêtre, puis le store est rechargé à froid).

| Fenêtre | Stimulus | État au redémarrage (vérifié) |
|---|---|---|
| A | `crashAfter: 'before_decided'` | `orders == []`, breaker `Closed`, aucune trace d'émission — état originel intact |
| B | `crashAfter: 'decided_written'` | **1 ordre** `DECIDED`, `order_id: null`, `correlation_id` présent dans le ledger (`risk_decision`), aucun événement `execution_*` |
| C | `crashAfter: 'submitting_written'` | **1 ordre** `SUBMITTING`, `order_id: null`, transition persistée AVANT l'appel réseau |
| D | crash après ACK durable, avant append ledger | ordre `ACKED` + `order_id: 'order-9000'` persistés, ledger sans `execution_success` → réconciliation possible sur order_id |

En plus, un test de **fenêtre d'écriture partiale** (`durable-state.test.ts`) tronque le
fichier JSON et vérifie le fail-stop (`StateCorruptionError`), ainsi que la falsification
via checksum.

## 4. Preuve du test de concurrence (pas d'écrasement silencieux)

`packages/strategy/src/concurrency-probe.test.ts` + `scripts/durable-state-concurrency-probe.mjs`
(spawn 2 puis 4 processus node sur le MÊME fichier d'état, chacun N write en `withLock`) :

- 2 × 5 itérations ⇒ **exactement 10** cycles de vie, 10 correlationId uniques ;
- 4 × 3 itérations ⇒ **exactement 12** cycles.

Si le verrou était absent (read-modify-write non protégé), le dernier écrivain écraserait
les cycles de vie de l'autre : ces tests échoueraient. Ils vérifient aussi l'unicité des
correlationIds (pas de collision inter-processus).

## 5. Preuve du fail-stop sur corruption

`packages/strategy/src/durable-state.test.ts` — pour chacun : `StateCorruptionError` :
- JSON tronqué, fichier vide, JSON non-objet, mauvaise version, clé inattendue ;
- falsification silencieuse d'une valeur (`hist_pnls`) ⇒ échec checksum AVANT usage ;
- falsification ajoutée dans `meta` ⇒ échec checksum (meta couvert).

Le message d'erreur refuse explicitement toute réinitialisation silencieuse.

## 6. Choix d'architecture

### 6.1 Stockage : fichier JSON atomique + verrou de répertoire (choisi) vs SQLite

Choisi **fichier JSON + atomicfs + lock de répertoire** car :
- l'état est petit (StateOutput + liste d'ordres), à écriture rare et très fréquemment
  relué dans son intégralité (validations) ;
- zéro dépendance native, zéro tension de build (cargo/npm) dans la CI ;
- le format reste un JSON lisible/débogable et la migration v1→v2 a été triviale ;
- SQLite embarqué apporterait de la concurrence transactionnelle multi-lecteurs mais son
  gain n'apparaît pas avant le passage multi-processus de la Phase 3 (gateway/agent) —
  le verrou de répertoire documente proprement ce plafond : **verrouillage LOCAL, UN
  processus écrivain à la fois, non distribué** (acceptable à ce stade, cf. mission §6).

### 6.2 Verrou : mkdir atomique (pas flock, pas lockfile NPM)

`mkdir(dir.x.lock)` est atomique en POSIX ; réellement interprocessus ; sans package ;
avec détection de stale (le détenteur mort laisse un répertoire périmé — repris après
`staleMs`, sans jamais endommager l'état car le checksum reste la preuve finale).
`proper-lockfile` aurait rajouté une dépendance pour un mkdir+stat équivalent.

### 6.3 Limites assumées et transmises à M14/M15/M16
- Verrouillage **local** : deux machines ne peuvent pas partager ce fichier d'état —
  le fichier d'état est destiné à rester sur cette machine (single-node).
- Pas de réentrance : un process ne doit pas acquérir deux fois le même verrou ; le code
  `run-reference-loop` ne le fait jamais (chaque `withLock` est séquentiel).
- Le dépôt des ordres `orders[]` croît sans borne : prévu, réconciliation (M14) et
  compactage seront traités (sommaire dans M14, exposition dans M15).

## 7. Vérifications

- `npm run build` : OK (core, risk, execution, ledger, strategy, observatory).
- `npm test` : **170 tests / 170** verts (16 fichiers) — dont les 3 tests M12 d'intégration
  non-régression + 35 tests strategy (29 nouveaux M13 + 6 M12) + 18 observatory.
- Migration `.pallas/risk-state.json` v1→v2 exécutée une fois ; relecture par
  `buildSnapshot` réel : `format=V2, integrity=OK, orderCount=0`.

## 8. Conséquences pour les missions suivantes
- **M14** : les statuts `SUBMITTING` (order_id null) et `AMBIGUOUS` existent durablement →
  la réconciliation au démarrage est le prolongement naturel des fenêtres B/C/D.
- **M15** : `orders[]` fournit déjà `market_id`, `side`, `price`, `quantity` pour le calcul
  d'exposition réelle ; la migration du contrat `TradeRequest` (sortir bankroll/limites de
  l'appelant) reste à faire dans risk-engine (Rust) + `validateTransaction` TS.
- **M16** : `atomicfs`, `file-lock`, `canonicalJson` réutilisés pour le ledger ; schéma
  d'événement enrichi (correlation_id, statut HTTP, attempt) aligné avec ce qu'écrit déjà
  `run-reference-loop`.
- **M18/M20** : `orders[]` + `meta.last_correlation_ids` seront exposés par le panneau
  DURABILITY · STATE déjà branché dans l'Observatory.