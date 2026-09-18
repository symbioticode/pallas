# PALLAS-M23 — Journal de mission — Transaction unifiée état+ledger, verrou à bail avec propriétaire

Mission : `docs/mission/mission-PALLAS-M23-transaction-unifiee-lock.md`
Statut : CLOTURÉE (2026-09-12)
Date d'exécution : 2026-09-12
Agent : DeepSeek Harness (deepseek-flash) — branche `missions-M21-M28`

---

## 0. Résumé

Les deux limites structurelles de l'audit v0.4 (F-01/F-12) sont traitées :

- **cohérence état+ledger** : les deux fichiers restent séparés (formats/lecteurs différents,
  choix acté et justifié), mais un **rattrapage idempotent au démarrage** détecte tout ordre ACKED
  sans entrée ledger `execution_success` et émet la trace manquante ;
- **verrou** : il porte désormais un **propriétaire** (PID + hôte + session) et la reprise après
  `staleMs` vérifie la VIVACITÉ du détenteur avant de reprendre.

Le test de la fenêtre D est complété par un **crash réel sur le chemin de production**
(`attemptPlaceOrder`), l'ancien test par construction manuelle étant CONSERVÉ (exigence §8).
`npm test` : 285 passed / 0 failed.

## 1. Décision d'architecture (état ↔ ledger)

Trois options étaient ouvertes : fusion des deux fichiers, pattern outbox, ou réconciliation de
rattrapage documentée. **Choix : réconciliation de rattrapage au démarrage**, car :

- état et ledger ont des formats ET des lecteurs différents (état = dernier connu checksummé ;
  ledger = historique immuable chaîné, signé, lu par l'Observatory) ;
- une fusion imposerait un bump de schéma/version d'état et couplerait deux cycles de vie ;
- un outbox complet nécessite de transporter des entrées typées dans l'état (couverture de
  checksum à étendre) pour un gain marginal par rapport à un rattrapage déterministe ;
- le rattrapage reconstruit l'entrée depuis l'ordre ACKED, ce qui suffit et reste idempotent.

Implémentation : `reconcileStateLedger(store, ledger)` (`run-reference-loop.ts`), appelé au
début de chaque cycle, avant toute décision. Il compare les `correlationId` des ordres ACKED à
ceux déjà présents dans le ledger (`execution_success`) et émet une entrée
`recovered_at_restart: true` pour les manquants. **Fenêtre résiduelle assumée** : entre le crash
et le redémarrage, la trace manque — mais l'état n'est jamais faux et le gate de scope interdit
toute ré-émission sur ce `correlationId`.

## 2. Verrou à propriétaire (F-12)

`packages/core/src/file-lock.ts` :

- l'acquisition écrit `<lock>/owner.json` (`pid`, `hostname`, `sessionId`, `startedAt`) ;
- `isStale()` : si le propriétaire est sur le MÊME hôte et que son PID est vivant
  (`process.kill(pid, 0)`, `EPERM` = vivant), le verrou n'est **jamais** périmé quelle que soit la
  date du répertoire ; sinon on retombe sur le seul âge `staleMs` ;
- `release()` / reprise périmée : `unlink` du `owner.json` PUIS `rmdir` (le répertoire doit
  être vide) ;
- un lock ANONYME (sans `owner.json`, ex. écrit sous une version antérieure) assez vieux est
  repris ; récent, il est attendu.

## 3. Preuves d'exécution

### 3.1 Détenteur vivant mais lent (scénario F-12)

Test `file-lock.test.ts` : un lock périmé (mtime −60 s) portant `pid = process.pid` (vivant)
avec `staleMs = 10 ms` → l'acquisition ÉCHOUE (`FileLockError`) et le `owner.json` d'origine
(`sessionId`) est intact : le verrou n'a PAS été volé. Avant M23, l'âge seul l'aurait repris.

### 3.2 Détenteur mort

Même lock avec un PID inexistant → reprise réussie après `staleMs`, nouveau propriétaire écrit.

### 3.3 Crash RÉEL fenêtre D

Nouveau test `crash-windows.test.ts` : le cycle exerce le VRAI `attemptPlaceOrder`
(`placeOrder` mocké en succès), l'état passe durablement ACKED avec `order_id`, PUIS le crash
`acked_written` intervient avant `ledger.append('execution_success')`. Au redémarrage (état + ledger
rechargés du disque) : la trace manque, le rattrapage la produit (`repaired = 1`), la chaîne reste
valide, et un second rattrapage ne duplique rien (`repaired = 0`).

### 3.4 Non-régression

- les **4 fenêtres de crash M13 restent vertes** ;
- `npm test` : **285 passed / 0 failed** (280 avant M23 + 4 verrou + 1 crash réel).

## 4. Ce qui n'a pas été fait / limites assumées

- **Fenêtre de rattrapage** : la trace ledger d'un crash fenêtre D n'existe qu'après le prochain
  démarrage. Bornée, documentée, et sans risque de ré-émission.
- **Vivacité mono-hôte** : le contrôle par PID n'a de sens que localement (verrou LOCAL par
  conception) ; multi-hôte = retour au seul âge.
- **Course de reprise** : `unlink+rmdir` n'est pas atomique ; deux repreneurs simultanés peuvent
  s'entrelacer (un seul `mkdir` final gagne). Fenêtre étroite, préexistante, à fermer par un bail
  transactionnel si le multi-hôte devient réel.
- **Balayage du ledger** : le rattrapage parcourt les entrées `execution_success` en mémoire à
  chaque cycle où un ordre ACKED existe ; acceptable au volume actuel, à indexer si le ledger
  grandit fortement.
- Aucun changement Rust ; `cargo test` non concerné.

## 5. Références

- Mission : `docs/mission/mission-PALLAS-M23-transaction-unifiee-lock.md`
- Verrou : `packages/core/src/file-lock.ts` (+ `file-lock.test.ts`)
- Rattrapage : `packages/strategy/src/run-reference-loop.ts` (`reconcileStateLedger`)
- Fenêtres de crash : `packages/strategy/src/crash-windows.test.ts`
- Docs : `docs/SECURITY.md` § « Transaction état+ledger et verrou à propriétaire (PALLAS-M23) »
