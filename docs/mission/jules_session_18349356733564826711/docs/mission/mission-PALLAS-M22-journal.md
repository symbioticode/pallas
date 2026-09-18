# PALLAS-M22 — Journal de mission — Réconciliation par fills réels et exposition alimentée par l'exchange

Mission : `docs/mission/mission-PALLAS-M22-reconciliation-fills-reels.md`
Statut : CLOTURÉE (2026-09-12)
Date d'exécution : 2026-09-12
Agent : DeepSeek Harness (deepseek-flash) — branche `missions-M21-M28`

---

## 0. Résumé

Finding le plus grave de l'audit v0.4 (F-03/F-04) corrigé : un ordre TOTALEMENT REMPLI n'est plus
conclu « annulé ». La réconciliation lit désormais l'historique des trades/fills
(`GET /data/trades`, endpoint vérifié sur l'OpenAPI CLOB officiel) et converge selon TROIS
issues, jamais deux. Aucun chemin ne conclut `cancelled` sur la seule absence d'un signal.
L'exposition compte les positions reconnues par l'exchange. `npm test` : 280 passed / 0 failed.

## 1. Ce qui a été fait

### 1.1 Diagnostic et source de vérité API (Partie A)

La fiche demande de « vérifier la doc actuelle, ne pas supposer sa forme ». Recherche menée :

- la documentation Polymarket expose d'abord une API **Perps**
  (`api.perpetuals.polymarket.com`, `/v1/account/fills`) qui n'est PAS le CLOB de prédiction
  utilisé par Pallas — écartée ;
- le CLOB de prédiction est décrit par un **OpenAPI officiel** :
  `docs.polymarket.com/api-spec/clob-openapi.yaml`. Endpoint retenu : `GET /data/trades`
  (opération `getTrades`, tag `Trade`), auth L2
  (`polyApiKey/polyAddress/polySignature/polyPassphrase/polyTimestamp`), paramètre
  `maker_address` **requis**, filtres `asset_id`, `market`, `after`/`before`
  (timestamps Unix), pagination `next_cursor`. Réponse
  `TradesResponse { limit, next_cursor, count, data: Trade[] }`, `Trade` portant
  `asset_id`, `side`, `size`, `price`, `status`, `match_time`,
  `taker_order_id`, etc.
- Découverte complémentaire : `GET /data/orders` (et `/data/order/{id}`) renvoie un ordre
  **quel que soit son statut, y compris annulé ou totalement rempli**, quand on filtre par `id`.
  Le trou n'est donc QUE le cas « order_id inconnu » (soumission ambiguë) — exactement le scénario
  de l'audit.

### 1.2 Bug reproduit contre le code d'avant (Partie B)

Avant toute correction, le scénario adversarial a été rejoué **contre le code du commit précédent**
(worktree détaché `5cb237f`, `npm ci` + build), et non simplement déduit :

```
BEFORE M22 -> status=TERMINAL terminal_reason=cancelled outcome=not_found_on_exchange
```

Un ordre totalement rempli (absent des ordres ouverts, sans order_id) était donc bien classé
« annulé » — le finding F-03/F-04. La branche fautive (ancienne) de `reconciliation.ts` :
`remoteStatus === 'no_match' | 'no_open_orders'` → `TERMINAL/cancelled`.

### 1.3 Correctif — convergence à trois issues

`packages/strategy/src/reconciliation.ts` :

- `gatherEvidence` collecte TROIS sources et retient lesquelles ont réellement répondu :
  `getOrder(order_id)` (si connu), scan des ordres ouverts, et **historique des trades**
  (`getTrades`, filtré par `asset_id` et `after = created_at − 5 min`), et totalise la
  quantité remplie par les fills correspondants (actif + côté + prix).
- `evidenceToPatch` converge sans jamais conclure par simple absence :

| Preuve | Conclusion |
|---|---|
| ordre ouvert chez l'exchange | `ACKED` (`reconciled_open`) |
| fills ≥ quantité | `TERMINAL/filled` (`reconciled_filled_by_trade`) |
| 0 < fills < quantité | `ACKED` (`reconciled_partial_fill`) — vivant, scope bloqué |
| absent des DEUX sources, les deux ayant répondu | `TERMINAL/cancelled` (`not_found_on_exchange`) |
| une source en erreur **ou** fenêtre < 60 s | `null` → **reste `RECONCILING`**, scope bloqué |
| `getOrder` → 404 (id explicitement inconnu) | preuve positive d'inexistence → `cancelled` immédiat |

- Annulation CONFIRMÉE mais avec fills : classé `filled` (`reconciled_filled_then_cancelled`)
  pour qu'une position réelle ne disparaisse pas de l'exposition.
- `matchesOpen` ne compare plus la taille par égalité stricte : un ordre partiellement rempli
  reste ouvert (taille restante ≤ quantité) — un faux négatif de plus corrigé.
- Nouvelle constante `MIN_ABSENT_CANCEL_AGE_MS = 60_000` : borne l'âge minimal avant de conclure
  « annulé » par absence (hors 404 explicite). Direction sûre : bloquer plus longtemps plutôt que
  libérer le scope à tort.

### 1.4 Contrat client (API Contract First)

`packages/execution/src/clobSchema.ts` : schémas `TradeSchema` / `TradesResponseSchema`
(seul `asset_id` requis ; le reste optionnel, jamais de valeur inventée).
`packages/execution/src/polymarketClient.ts` : interface `ReadTrade` + `getTrades()`
(lecture L2, autorisée en dry-run) + mapping `toReadTrade`.

### 1.5 Exposition

Voir `docs/SECURITY.md` § « Réconciliation par fills réels et exposition (PALLAS-M22) » : les
positions `filled` reconnues par les trades et les ordres ouverts confirmés par l'exchange
alimentent `exposureFromOrders` ; limites résiduelles explicites (pas d'endpoint de position
consolidée par marché ; exposition encore locale pour un ordre non réconcilié ; remplissage partiel
compté conservateur).

## 2. Preuves d'exécution

### 2.1 Avant / après (scénario exact de l'audit)

```
AVANT (code 5cb237f) : status=TERMINAL terminal_reason=cancelled outcome=not_found_on_exchange
APRÈS (code M22)     : status=TERMINAL terminal_reason=filled    outcome=reconciled_filled_by_trade
```

### 2.2 Tests

`npm test` : **280 passed / 0 failed** (269 avant M22 + 11 nouveaux). Nouveaux tests :

- réconciliation : scénario audit (rempli → filled, jamais cancelled) ; remplissage partiel → ACKED ;
  une seule source en erreur → RECONCILING + scope bloqué ; fenêtre trop courte → RECONCILING ;
  jamais soumis + deux sources vides après fenêtre → cancelled ; order_id 404 + fill → filled ;
  exposition après réconciliation `filled`.
- client : `getTrades` (URL/auth L2/mapping), dry-run autorisé, refus sans credentials,
  fail-closed sur réponse sans `data[]`.

### 2.3 Non-régression M14/M15

Les garanties M14 (invariant `RECONCILING` durable avant réseau, gate de scope, kill switch) et
M15 (exposition bornant les émissions) restent vertes. Deux tests M14 ont été **recalés** pour
refléter le durcissement M22 (l'ordre « absent » est vieilli de 5 min pour dépasser la fenêtre) ; la
garantie « un ordre jamais accepté finit cancelled » est conservée, et le chemin « absence d'ordre
ouvert seul » ne conclut plus jamais.

## 3. Ce qui n'a pas été fait / limites assumées

- **Pas de testnet/live réel** : `getTrades` est vérifié contre la forme OpenAPI officielle et
  l'URL/l'auth L2 sont testées par mock ; aucune requête authentifiée réelle n'a été émise (pas de
  credentials). Le contrat pourrait diverger du live sans préavis, comme documenté pour les autres
  endpoints.
- **Attribution des fills heuristique** : le CLOB n'expose pas de client order id dans les trades ;
  le matching se fait sur actif + côté + prix + fenêtre temporelle. Une collision de prix sur le même
  actif/côté est théoriquement possible — limite nommée, pas masquée.
- **Remplissage partiel** : compté pour son notionnel plein (conservateur).
- **Pas d'endpoint de position/collatéral consolidé** : `/balance-allowance` existe mais n'est pas
  intégrable en notionnel par marché ; l'exposition n'est donc pas présentée comme « complète ».
- **Fenêtre `MIN_ABSENT_CANCEL_AGE_MS = 60 s`** : choix opérationnel bornant la conclusion
  « annulé » ; un ordre récemment soumis reste `RECONCILING` jusqu'à la fenêtre, ce qui bloque
  le scope plus longtemps (direction sûre).

## 4. Références

- Mission : `docs/mission/mission-PALLAS-M22-reconciliation-fills-reels.md`
- Client/schémas : `packages/execution/src/{polymarketClient,clobSchema}.ts` (+ tests)
- Réconciliation : `packages/strategy/src/reconciliation.ts` (+ tests)
- Exposition : `packages/strategy/src/durable-state.ts` (`exposureFromOrders`)
- Docs : `docs/SECURITY.md` ; OpenAPI CLOB `https://docs.polymarket.com/api-spec/clob-openapi.yaml`
