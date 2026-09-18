# JOURNAL — PALLAS-M12 — Stratégie de référence : intégration bout-en-bout du pipeline (dry-run)

Clôturée le 2026-09-10. Convient à : toute stratégie future avec prétention de rentabilité
→ mission séparée + backtesting (`docs/STRATEGY.md`).

## 1. Synthèse

Le chemin d'intégration minimal demandé par la mission existe désormais et **a été exercé de bout
en bout sur de vrais échanges protocole Polymarket (lecture)** :

```
ReferenceStrategy (best ask réel) → sanitizeInput (texte externe) → validateTradeWithState
(état persistant fichier JSON) → décision → placeOrder BLOQUÉ dry-run → ledger append-only chaîné
écrit à chaque étape.
```

- Nouveau paquet `@pallas/ledger` : chaîne `hash(n)=SHA256(prev_hash+contenu)`, `verify()` réel,
  persistance fichier JSON atomique (**limite délibérée**, mission §6.4), 8 tests, détection de
  falsification prouvée (test dédié + falsification manuelle réelle).
- `ReferenceStrategy` (`@pallas/strategy`) : règle triviale BUY si `best ask < seuil fixe`,
  **disclaimer non-prédictif en tête de fichier dès le premier commit de code** (§6.1).
- Orchestrateur minimal `run-reference-loop.ts` (§3) : fonction de cycle réutilisable + entrée
  script (`PALLAS_REF_*`). Aucune capacité live nouvelle ; `signatureSchemaValidated` jamais touché ;
  rejet du risk engine respecté à la lettre, **aucun retry**.
- `docs/STRATEGY.md` : statut « référence » explicite + condition (backtesting out-of-sample +
  mission séparée) pour toute prétention de rentabilité.
- Compteurs finaux : **132 tests verts** (121 + 8 ledger + 11 strategy-orchestrateur), `tsc --build`
  couvre désormais `packages/ledger packages/strategy`.

## 2. Partie B — vérifications préalables (test de falsification écrit EN PREMIER)

- Relu `sanitizer.ts` / `risk/client.ts` / `polymarketClient.ts` pour les points d'intégration exacts.
- **Test de falsification écrit avant l'implémentation** (`packages/ledger/src/ledger.test.ts`,
  bloc « détection de falsification ») : **rouge sur le stub** (`verify` renvoyait toujours valid),
  puis **vert** une fois le hash chaîné réel implémenté.
- Ajustement honnête en cours de route : la copie défensive en mémoire de `Ledger.entries`
  (`structuredClone`) rendait toute falsification directe impossible (comportement blinded). L'attaquant
  réaliste passe donc par un canal de sérialisation (`toJSON()` → mutation → `fromJSON()`), qui est
  exactement ce que `FileLedger` écrit/relit sur disque — les 3 tests de falsification ciblent ce canal.

## 3. Partie C — exécution manuelle (AVANT les tests automatisés)

### Run 1 — 3 cycles réels sur un vrai marché Polymarket (Newsom 2028, token yes réel)

`PALLAS_REF_TOKEN_ID=87854174148074652060467921081181402357467303721471806610111179101805869578687
PALLAS_REF_THRESHOLD=1.0 PALLAS_REF_SIZE=1 PALLAS_REF_MAX_ORDER_USD=25 PALLAS_REF_BANKROLL_USD=1000
PALLAS_REF_MAX_DRAWDOWN_USD=300 CYCLES=3`

```
run_start {cycles:3, token_ids:[…8785…], threshold:1, size:1, bankroll_usd:1000, max_order_usd:25, max_drawdown_usd:300, signer:"ephemeral(forme)"}
cycle 1 → {signal:{tokenId:…8785…, side:"BUY", price:0.857, size:1, bestAsk:0.857, threshold:1}, allowed:true, rejected_by:[], execution:"dry_run_blocked"}
cycle 2 → idem  → allowed:true, execution:"dry_run_blocked"
cycle 3 → idem  → allowed:true, execution:"dry_run_blocked"
run_end   ledger_entries:15, ledger_verify:{valid:true, brokenAt:null, reason:null}
```

Extraits du ledger (`.pallas/ledger.json`, chaîne réelle) :

```json
{ "event":"signal",
  "payload":{ "tokenId":"8785…","side":"BUY","price":0.857,"size":1,
              "bestAsk":0.857,"threshold":1,"reason":"reference rule: best ask 0.857 < seuil 1",
              "indicator_ms":3324 } }
{ "event":"risk_decision",
  "payload":{ "trade":{ "market_id":"8785…","side":"buy","price":0.857,"quantity":1,
                        "est_value_usd":0.86,"win_probability":0.857,"odds":2,"confidence":0.5,
                        "bankroll_usd":1000,"max_order_usd":25,"max_drawdown_usd":300 },
              "decision":{ "allowed":true, "gates":[ "CIRCUIT_BREAKER Allow (Circuit breaker closed)",
                          "VOLATILITY_REGIME Allow (Regime Normal active)",
                          "POSITION_LIMIT Allow (Order size $0.86 <= max $25.00)", … ],
                          "rejected_by":[] } } }
{ "event":"execution_dry_run_blocked", "payload":{ "blocked_by":"polymarketClient.placeOrder",
                                                   "expects":"dry-run" } }
```

Sortie réelle consolidée (3 cycles) : `execution_dry_run_blocked=3`, `execution_error=0`,
`execution_success=0`. **placeOrder a été appelé exactement 3 fois et bloqué chaque fois par le
dry-run global — jamais de retry.**

Décisions prises durant le run (transparentes, au fil de l'eau) :
- Le risk engine attend `side` minuscules (`buy`), la stratégie/Polymarket émettent `BUY` → mapping
  documenté dans `buildReferenceTradeRequest`.
- `win_probability` = **prix du marché** (probabilité implicite, "le marché est supposé correct") :
  à `0.5` le Kelly suggère 0 (rejet `KELLY_LIMIT` systématique) — prendre le prix du marché est
  neutre (aucun edge), pas un paramètre optimisé.
- `max_drawdown_usd` paramétrable : à 10 % de la bankroll, le scénario Black Swan (`bankroll×25 %`)
  rejette toujours (`STRESS_TEST`) — défaut porté à 30 % pour la démo d'intégration (toujours
  dry-run, aucune valeur réelle engagée).

### Run 2 — scénario de REJET (§4.2), run séparé sur le MÊME ledger (append-only)

`… PALLAS_REF_MAX_ORDER_USD=0.1 CYCLES=1` (limite config abaissée sous la valeur estimée $0.86)

```
cycle 1 → {signal:…price:0.857…, allowed:false, rejected_by:["POSITION_LIMIT"], execution:"not_attempted"}
run_end   ledger_entries:19, ledger_verify:{valid:true, brokenAt:null, reason:null}
```

Ledger (dernier `risk_decision` enregistré) :

```json
{ "gates":[…, { "gate":"POSITION_LIMIT",
                "action":"Reject",
                "reason":"Order size $0.86 exceeds max $0.10" }, …],
  "rejected_by":["POSITION_LIMIT"], "allowed":false }
```

**Aucun appel à `placeOrder`** : le cycle contient `execution_dry_run_blocked=0` pour ce run ; le
pipeline « not_attempted » (la mission l'exige, §8 : respect strict, pas de retry).

### Run 3 — falsification manuelle (§4.3) sur une copie du ledger

```json
falsifié index 3 (risk_decision) allowed: true -> false
verify(): {"valid":false,"brokenAt":3,"reason":"hash"}
DETECTION OK
```

La copie falsifiée a été supprimée ; le ledger réel de `.pallas/` reste la chaîne valide
(`verify() final → {valid:true, brokenAt:null, reason:null}`).

### Persistance d'état (§4.4)

`.pallas/risk-state.json` est écrit après chaque `validateTradeWithState` et relu au cycle suivant :
présent et identique entre les 2 exécutions du script (run 1 puis run 2), le circuit breaker reste
« Closed » (aucune perte enregistrée — comportement correct du moteur : seul `record` fait évoluer le
breaker), `kill_switch_engaged:false`, `volatility` remplacée par le détecteur du moteur. L'état
n'est donc PAS réinitialisé à zéro entre exécutions.

## 4. Partie C — tests automatisés (ÉCRITS APRÈS les runs manuels, § Partie C)

- `packages/strategy/src/reference.test.ts` (8) : BUY si ask < seuil (price = best ask, size
  configurée), pas de signal sinon, book vide/erreur de lecture → réponse neutre, premier token
  remplissant la condition, déterminisme, config invalide → throw, `bestAskOf`.
- `packages/strategy/src/run-reference-loop.test.ts` (3) : cycle accepté (`PALLAS_RISK_BIN` simulé →
  allow) : signal → `risk_decision` → **exactement 1** `execution_dry_run_blocked`, ledger chaîné
  valide ; cycle rejeté (`POSITION_LIMIT`) : `not_attempted`, `rejected_by` enregistré, zéro blocage ;
  texte externe avec menace (`IGNORE ALL PREVIOUS INSTRUCTIONS` + zéro-width) : `threat_detected`
  enregistré (`prompt_injection`), `external_text_sanitized` modified=true.
- Les tests mockent le fetcher réseau (read) et `PALLAS_RISK_BIN` ; le dry-run reste actif
  (`isDryRun` injectable = flag de test déjà géré par la mission M10, jamais au runtime).

## 5. Critères §7 — preuves

| Critère | Preuve |
|---|---|
| Ordre de bout en bout observé sur ≥ 3 cycles | Run 1 : 3 cycles, allow + dry-run blast, ledger 15 entrées |
| Scénario de rejet enregistré sans appel ordre | Run 2 : `POSITION_LIMIT`, `not_attempted` |
| Persistance d'état entre appels réels du script | `risk-state.json` écrit/relu sur 2 exécutions séparées |
| Falsification manuelle détectée | Run 3 : `brokenAt:3, reason:"hash"` + tests dédiés |
| `docs/STRATEGY.md` non-prédictif + condition | `docs/STRATEGY.md` (§ statut + § condition backtesting) |
| Aucune suggestion de valeur prédictive | Disclaimer en tête de `reference.ts` + STRATEGY.md, review des commentaires |
| Aucune capacité live nouvelle, dry-run bloquant | Aucun flag de contournement ; `signatureSchemaValidated` jamais touché ; test dry-run |
| `npm test` vert monorepo | 132 tests verts (12 fichiers) |

## 6. Fichiers touchés

- `packages/ledger/` (nouveau) : `src/ledger.ts`, `src/file-ledger.ts`, `src/index.ts`,
  `src/ledger.test.ts`, `package.json`, `tsconfig.json`.
- `packages/strategy/` (nouveau) : `src/reference.ts`, `src/run-reference-loop.ts`, `src/index.ts`,
  `src/reference.test.ts`, `src/run-reference-loop.test.ts`, `package.json`, `tsconfig.json`.
- `docs/STRATEGY.md` (nouveau), `docs/mission/mission-PALLAS-M12-strategie-reference-integration.md`
  (CLÔTURÉE, §7 coché), `docs/mission/mission-PALLAS-M12-journal.md` (ce fichier).
- `package.json` (racine) : scripts build/typecheck/pretest + `packages/ledger packages/strategy`,
  script `reference-loop`.
- `.gitignore` : `.pallas/` (ledger + état du pipeline, artefact local).
- `PLAN.md` : tableau missions + Phase 3 « 3.1 Ledger + Stratégie de référence — INTÉGRATION
  PARTIELLE » (gateway HTTP/UI/agent Claude explicitement NON COMMENCÉS, ancrage on-chain hors scope).

## 7. Limites / dettes restantes (datées, jamais silencieuses)

- Persistance du ledger et de l'état risk sur **fichier JSON local**, sans base — **décision
  délibérée** (mission §6.4), stockage durable (base / IPFS / on-chain) pour Phase 3.
- Ancrage on-chain du ledger : **hors scope** (mission §6), piste future.
- `win_probability` = prix du marché : choix neutre documenté (à revoir uniquement par une vraie
  stratégie backtestée, mission séparée).
- `docs/AUDIT-PALLAS-v0.2.1md` présent localement (extension cassée hors glob gitignore, non suivi)
  : les deux audits évalués « aucune intégration » — désormais couvert par M12 ; sera formellement
  traité dans une mission de nettoyage des docs (« outillage debt » — observation observateur #51).

## 8. Point de contrôle observateur

Session M12 jouée proprement ce jour ; voir `~/Projects/_OBSERVER_SHARED/skill-observations/log.md`
(observation « outillage debt » #51, déjà notée ; ce journal se termine par un point de contrôle
avant commit). L'observation comptée à l'issue de M12 : `#52`.