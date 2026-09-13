# JOURNAL — PALLAS-M16 — Ledger inviolable : vérification obligatoire, signature séparée, schéma enrichi

Date : 2026-09-11
Agent : big-pickle (opencode) — mission exécutée en autonomie
Statut : TERMINÉE

## Synthèse attentive

L'audit v0.3 (F-05 §6) avait montré que le ledger de M12 était **un détecteur d'erreur
accidentelle, pas un journal inviolable** : la fonction de hash étant exportée, un attaquant avec
le fichier ET le process écrivain pouvait modifier puis recalculer les hashes pour rendre la
chaîne à nouveau cohérente. En outre `FileLedger.load` transformait un fichier **absent ou JSON
invalide en ledger vide sans alerte** (le même « reset silencieux » que M13 avait corrigé pour
l'état risk), aucune vérification automatique de la chaîne n'avait lieu au chargement, et le
schéma d'événement était trop pauvre (pas de correlation ID, statut HTTP, numéro de tentative,
timestamps début/fin, hash d'intention).

M16 ferme ces brèches :

1. **Vérification obligatoire fail-stop au chargement** : `FileLedger.load` parcourt toute la
   chaîne (index, lien, hash) avant de rendre le ledger utilisable. Trois cas désormais **distincts** :
   fichier **absent + aucun `.sig`** = premier démarrage légitime ; fichier présent mais JSON
   invalide/tronqué/hors contrat = `LedgerLoadError` ; rupture de chaîne, checkpoint incoherent,
   ou `.sig` absent en mode strict = `LedgerIntegrityError`. Jamais de réinitialisation silencieuse.
2. **Signature séparée Ed25519** : la clé PRIVÉE vit hors du process écrivain (outil opérateur
   `sign-ledger` signe périodiquement un checkpoint `<ledger>.sig`), le run loop ne monte que la
   clé publique (`PALLAS_LEDGER_PUB_KEY`). Sémantique d'ancrage **préfixe** : le checkpoint
   référence un maillon existant (index+hash) ; une chaîne honnête peut s'étendre APRÈS le
   checkpoint (signature périodique), mais toute troncature ou réécriture d'une partie signée est
   détectée — y compris l'attaque « modifier + recalculer avec la fonction exportée ».
3. **Durabilité réutilisée de M13** : `FileLock` + relecture fraîche sous verrou +
   `atomicWriteFileSafe` (pas de second mécanisme dupliqué). `append`/`appendMany` désormais
   async, les 15 appels du run loop sont `await`és, concurrence interprocessus testée.
4. **Schéma d'événement enrichi** : correlation ID, `intent_hash` (SHA-256 de l'intention),
   `http_status` brut, `attempt`, timestamps `started_at`/`finished_at` — sur `risk_decision`,
   `execution_*`, `execution_success`, et les enveloppes `run_start`/`run_end` portent la santé du
   ledger (`entries`, `signed`, `verified`, `ledger_signed`).

L'Observatory manifeste le statut de signature (`SIGNED`/`UNSIGNED`/`SIGNATURE INVALID`) avec
warnings associés, sans fail-stop (moniteur en lecture seule — l'autorité reste `@pallas/ledger`).

## 1. Ce qui était en cause

1. **Falsification indétectable** (audit v0.3 F-05) : la fonction de hash étant exportée
   (`sha256Hex` public), « modifier + recalculer » refabriquait une chaîne cohérente qui passait
   la vérification de chaînage — la détection n'était testée qu'en attaque « naïveté » (modifier
   sans recalculer).
2. **Reset silencieux** : `FileLedger.load` remontait un ledger vide pour un fichier absent OU
   invalide/tronqué — aucune distinction entre premier démarrage et corruption.
3. **Pas de vérification au chargement par défaut** : la détection de falsification n'était
   exécutée qu'explicitement en test, jamais à l'ouverture du fichier en conditions réelles.
4. **Écriture non sécurisée** : nom temporaire fixe `.tmp`, pas de lock interprocessus, réécriture
   complète du fichier — appels concurrents sujets à perte/écrasement.
5. **Schéma d'événement pauvre** : pas de correlation ID cohérent avec M13/M14, ni statut HTTP,
   hash d'intention, tentative, timestamps début/fin posés.

## 2. Ce qui est livré

**`packages/ledger` :**

- `ledger-signing.ts` (nouveau) : `generateLedgerSigningKeyPair()` (Ed25519, PKCS8/SPKI),
  `LedgerCheckpoint` (`head_index`, `head_hash`, `signature`), `checkpointPayload` canonique
  (clés triées, hors champ `signature`), `signLedgerCheckpoint(privateKeyPem, entries)`,
  `verifyLedgerCheckpoint(publicKeyPem, cp)`, `isLedgerCheckpoint`. Signer un ledger **vide** est
  refusé.
- `file-ledger.ts` (réécrit) :
  - `load` fail-stop : `LedgerLoadError` (JSON invalide/tronqué/hors contrat) vs
    `LedgerIntegrityError` (rupture de chaîne, checkpoint incohérent, mode strict sans `.sig`) vs
    ledger **absent** = premier démarrage légitime (uniquement si aucun `.sig`) ;
  - propriété `isSigned` (checkpoint présent + cohérent) ;
  - `append`/`appendMany` **async** : `withLock` (FileLock) → `readChain` fraîche → append →
    `atomicWriteFileSafe` ;
  - `verifyHeadCheckpoint` : ancrage préfixe (le maillon `head_index`/`head_hash` signé doit
    exister dans la chaîne) + vérification cryptographique quand `publicKeyPem` fournie.
- `sign-ledger.ts` (nouveau CLI) : `gen --dir` (paire révocable, clé privée `0600`) /
  `sign --key --ledger` (écrit `<ledger>.sig` atomiquement).
- `index.ts` : exporte les nouveaux modules ; `package.json` : dépendance `@pallas/core` (ajout
  workspace) + script `sign-ledger`.
- `ledger.ts` : `sha256Hex` et `canonicalJson` exportés (dédoublonnés depuis les tests).

**`packages/execution` :**

- `OrderResult.httpStatus: number` (statut HTTP brut de la réponse) — alimente le journal.

**`packages/strategy` :**

- `run-reference-loop.ts` : les 15 `ledger.append(...)` sont `await`és ; chargement avec
  `{ publicKeyPem }` dérivée de `PALLAS_LEDGER_PUB_KEY` (PEM inline ou chemin de fichier — mode
  strict si fournie) ; `run_start` porte `ledger: { entries, signed, verified }` ;
  `run_end` porte `ledger_signed` ; payloads enrichis : `risk_decision` (+`started_at`,
  `finished_at`, `intent_hash`), `execution_success` (+`http_status`, `attempt`,
  `started_at`, `finished_at`), `execution_dry_run_blocked`/`execution_error`
  (+`attempt`, timestamps), `order_reconciled_on_ambiguity` (+timestamps).

**`packages/observatory` (manifestation) :**

- `snapshot.ts` : `readLedger` retourne aussi `signed: 'SIGNED' | 'UNSIGNED' | 'INVALID'`
  (présence + cohérence d'ancrage du `.sig`) ; warnings nouveaux
  (`LEDGER CHECKPOINT INVALID`, `LEDGER UNSIGNED`) ;
- `types.ts` + `render.ts` : `system.ledgerSigned` + badge `SIGNED`/`UNSIGNED`/`SIGNATURE INVALID`.

## 3. Tests ajoutés

**`packages/ledger` — 27 tests verts :**

- `file-ledger.test.ts` : les trois cas fail-stop distincts (absent = premier démarrage si aucun
  `.sig` ; tronqué/JSON invalide = `LedgerLoadError` ; ruptures/signature = `LedgerIntegrityError`) ;
  **attaque réaliste** : `forgeChainAndRecalculate` modifie le maillon 1 et **recalcule aussi les
  liens `prev_hash`** — détectée par le checkpoint signé même sans clé publique (ancrage) et
  cryptographiquement en mode strict ; troncature après signature ; extension après signature
  (chaîne honnête) ; `.sig` invalide ; signature par une autre clé ; append frais sous verrou.
- `ledger-signing.test.ts` : 5 tests (génération, payload canonique, sign/verify, autre clé,
  structure du checkpoint, refus de signer un ledger vide).
- `ledger-concurrency.test.ts` : concurrence **interprocessus** réelle — 2×5 et 4×3 appends à
  travers `scripts/ledger-concurrency-probe.mjs` (mêmes notion que la sonde M13) → aucune entrée
  perdue, chaîne valide.
- `ledger.test.ts` (M12, adapté) : falsification simple au reload → `/(rupture de chaîne)/` ;
  append converti async.

**`packages/execution` :** assertion `res.httpStatus === 200` sur le test `placeOrder` V2 existant.

**`packages/strategy` :** `M16: schéma d'événement enrichi` (cycle ALLOW) — `risk_decision` porte
`correlation_id`, `intent_hash` (64 hex), `started_at`/`finished_at`, `state_persisted` ;
`execution_dry_run_blocked` porte `correlation_id`, `attempt`, timestamps ; l'`intent_hash` du
ledger est identique à celui persisté dans l'état durable.

**`packages/observatory` (+3) :** `UNSIGNED` sans checkpoint (badge rendu) ; `SIGNED` avec un
`.sig` cohérent (warning « non signé » absent) ; checkpoint n'ancrant plus la chaîne →
`SIGNATURE INVALID` + warning.

**Chiffres :** `npm test` 229/229 (20 fichiers), `npm run build` propre, aucun changement Rust
(pas de rebuild du binaire risk-engine nécessaire pour M16).

## 4. Écarts / limites assumées (transparences)

1. **Pas d'ancrage distant/WORM** : le `.sig` vit à côté du ledger. Sans la clé privée on ne peut
   pas forger, mais un opérateur détenteur de la clé reste théoriquement capable de réécrire
   l'historique. Piste de stockage distant en écriture seule évoquée par l'audit, documentée en
   limite, hors budget de la mission (§"Ce que la signature ne couvre pas" dans `docs/SECURITY.md`).
2. **La signature est périodique, pas par entrée** : la fenêtre entre deux checkpoints n'est pas
   protégée contre une réécriture suivie d'un re-signe par l'opérateur — c'est le compromis
   assumé pour que la clé privée ne soit pas en mémoire en permanence (exigence de l'audit).
3. **Mode strict = opt-in opérateur** : sans `PALLAS_LEDGER_PUB_KEY`, le run loop démarre avec un
   ledger non signé (chaîné uniquement). L'Observatory le manifeste (`LEDGER UNSIGNED`) pour qu'un
   départ sans signature ne passe pas inaperçu, et le journal **exige** la clé publique pour
   l'environnement réel.
4. **`ledgerSigned` Observatory = lecture seule** : il ne fail-stop pas (moniteur), quand celui qui
   fail-stop est `FileLedger.load` du process écrivain.

## 5. Vérifications

- `npm run build` : propre (tsc --build sur les 6 packages).
- `npm test` : 229/229 — dont `packages/ledger` 27/27 (concurrence interprocessus réelle),
  `packages/observatory` 23/23.
- Aucun changement `crates/*` : le binaire `risk-engine` release existant sert tel quel.

## 6. Apprentissage / réutilisable

- **L'attaque « réaliste » doit recalculer les liens `prev_hash`, pas seulement les hash** — un
  test de falsification qui ne le fait pas teste le chaînage M12, pas la signature M16. Le piège a
  été rencontré en direct (premier test échouait par rupture de chaîne avant d'atteindre la
  signature).
- **Séparer le « présent mais cassé » du « absent légitime »** : la triple distinction
  (absent / invalide / incohérent) au chargement est ce qui différencie un fail-stop utile d'un
  reset testable par l'attaquant — déjà le cœur de M13, transposé ici au ledger.
- **Ancrage préfixe plutôt qu'égalité de tête** : autoriser la chaîne à dépasser le checkpoint
  signé rend la signature périodique compatible avec un process écrivain continu, tout en
  conservant une détection sur toute troncature.
- **Un moniteur (Observatory) n'est pas une autorité** : il manifeste, l'écrivain fail-stop. Les
  deux rôles doivent rester disjoints (et testés comme tels).

## 7. Critères de succès (mission §7)

- [x] Une falsification qui recalcule la chaîne avec la fonction de hash exportée est quand même
      détectée grâce à la vérification par signature séparée, testé.
- [x] Le chargement du ledger vérifie systématiquement toute la chaîne, avec arrêt fatal explicite
      sur toute rupture — testé, distinct du cas « premier démarrage légitime ».
- [x] L'écriture du ledger utilise le même mécanisme de lock/fsync/rename atomique que
      PALLAS-M13, testé en situation de concurrence.
- [x] Le schéma d'événement inclut correlation ID, statut HTTP, tentative, timestamps début/fin,
      au minimum.
- [x] Aucune régression sur les tests existants du ledger (PALLAS-M12).