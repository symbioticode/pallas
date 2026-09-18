# PALLAS-M24 — Journal de mission — Ledger signé obligatoire par défaut

Mission : `docs/mission/mission-PALLAS-M24-ledger-signe-obligatoire.md`
Statut : CLOTURÉE (2026-09-12)
Date d'exécution : 2026-09-12
Agent : DeepSeek Harness (deepseek-flash) — branche `missions-M21-M28`

---

## 0. Résumé

F-05 corrigé : la protection par signature n'est plus une capacité optionnelle silencieuse.
`FileLedger.load` distingue un mode **supervised** (défaut) où la clé publique est OBLIGATOIRE
(absence = FATALE) d'un mode **dev** explicitement demandé, où le ledger non signé est accepté mais
signalé par un avertissement bruyant. `npm test` : 290 passed / 0 failed.

## 1. Ce qui a été fait

### 1.1 Mode explicite (resolveLedgerMode)

Priorité : argument `mode` > `PALLAS_LEDGER_MODE=dev|supervised` > `PALLAS_TEST_MODE=1`
(tests) > défaut `supervised`. Une valeur d'environnement non reconnue n'est PAS devinée :
`LedgerIntegrityError` explicite. Un `publicKeyPem` vide est traité comme absent.

### 1.2 supervised : clé obligatoire

En mode supervised, l'absence de clé publique lève une erreur FATALE au chargement — plus aucun
déploiement ne peut oublier la signature sans le savoir. Le message nomme la cause et la porte de
sortie (`PALLAS_LEDGER_MODE=dev`, usage local explicitement non réel).

### 1.3 dev : accepté mais bruyant

En dev sans clé ni checkpoint, `warnUnsignedLedger` émet un avertissement `console.warn` unique par
ledger (LEDGER NON SIGNE ... INTERDIT pour un run réel). L'Observatory portait déjà le warning
LEDGER UNSIGNED (signature PALLAS-M16 non active) depuis M20 : la visibilité côté UI était donc
déjà acquise ; M24 ajoute la visibilité au démarrage.

### 1.4 Précision ancrage vs signature

L'ancrage (index/hash de la tête signée encore présent) reste vérifié dans TOUS les modes, sans
clé — il détecte troncature/réécriture après signature, mais n'est PAS une preuve cryptographique.
La signature Ed25519 n'est vérifiée que si la clé publique est fournie, et elle est désormais
obligatoire en supervised. Cette distinction est écrite dans `docs/SECURITY.md`.

## 2. Preuves d'exécution

### 2.1 Scénario de falsification de l'audit v0.4 (avant/après)

Test : ledger non signé, un maillon modifié PUIS toute la chaîne recalculée avec les fonctions
exportées.

- **avant M24** : `FileLedger.load(path)` (sans clé) acceptait la chaîne — UNSIGNED_FORGERY_ACCEPTED ;
- **après M24** : en mode `supervised` (défaut hors test), le chargement REFUSE de démarrer faute de
  clé publique ; en mode `dev`, il accepte MAIS l'avertissement bruyant est émis, et un
  `verify().valid` local vrai ne vaut plus preuve.

### 2.2 Tests

`file-ledger.test.ts` (+5) : résolution de mode (priorités + valeur invalide) ; supervised sans clé
=> fatal ; dev sans clé => avertissement bruyant ; falsification non signée acceptée en dev /
refusée en supervised ; falsification signée puis chaîne réécrite => rejetée MÊME sans clé publique
(ancrage actif quel que soit le mode).

`npm test` : **290 passed / 0 failed**. Un test de concurrence M16 (ledger-concurrency) filtrait
`stderr === ''` : le warning M24 y est désormais ignoré NOMMÉMENT, tout autre contenu stderr
restant interdit.

## 3. Ce qui n'a pas été fait / limites assumées

- **Ancrage distant NON implémenté** : aucun envoi du hash de tête vers un service/log externe au
  process. Un attaquant qui contrôle le ledger ET la clé privée n'est arrêté par rien — limite
  explicite, piste ouverte (exigence §3).
- **`PALLAS_TEST_MODE=1` reste une variable d'environnement** : elle sert de défaut dev pour la suite
  de tests. Elle ne constitue pas une séparation de build/service (même réserve que pour
  `isDryRun`, traitée en M25 pour le kill switch). Un run local réel doit poser
  `PALLAS_LEDGER_MODE=supervised` (défaut) + la clé publique.
- Aucun changement Rust ; `cargo test` non concerné.

## 4. Références

- Mission : `docs/mission/mission-PALLAS-M24-ledger-signe-obligatoire.md`
- Code : `packages/ledger/src/file-ledger.ts` (+ `file-ledger.test.ts`)
- Docs : `docs/SECURITY.md` § « Ledger signé obligatoire par défaut — mode supervised vs dev »