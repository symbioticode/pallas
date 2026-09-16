# Audit final — Pallas v0.2.1 / Polymarket MVP

**Périmètre audité :** `symbioticode/pallas`, branche `main`, commit **`e0656044813011fa835e49ce57f9589428bbad8d`**. J’ai évalué le code existant comme une base autonome, sans reprendre les grilles de CloddsBots ni celles des audits Pallas antérieurs. Les références externes utilisées sont les comportements actuels documentés de Polymarket et les pratiques usuelles d’un moteur de trading automatisé.

**Verdict global : `NO-GO production / GO dry-run contrôlé`.**

Pallas v0.2.1 présente désormais plusieurs fondations sérieuses — séparation risk/execution, validation runtime, signature CLOB V2, comportement fail-closed sur plusieurs frontières, absence de retry aveugle d’un placement ambigu, tests et CI. Mais **ce n’est pas encore un bot de trading production-ready**. La raison n’est plus principalement la qualité locale des fonctions : le problème se situe désormais au niveau **système**.

Le dépôt lui-même confirme que gateway, agent et ledger ne sont pas encore implémentés.

| Axe                         |        Note | Verdict                                                                     |
| --------------------------- | ----------: | --------------------------------------------------------------------------- |
| 1. Fidélité d’exécution     | **2.7 / 5** | Architecture saine mais boucle d’exécution incomplète                       |
| 2. Risk Management          | **2.0 / 5** | Bons composants, modèle de risque insuffisamment relié au portefeuille réel |
| 3. Viabilité opérationnelle | **1.6 / 5** | Pas encore exploitable sans supervision humaine                             |
| **Global**                  | **2.1 / 5** | **MVP technique prometteur, pas MVP live-capital**                          |

## 1. Fidélité d’exécution et intégrité fonctionnelle — 2.7/5

C'est aujourd'hui l'axe le plus avancé.

Le chemin d’ordre a plusieurs propriétés que je considère **bonnes pour un MVP sérieux**. `placeOrder()` ne retente pas automatiquement un POST en cas de timeout ou de 5xx ; Pallas transforme correctement ce cas en résultat indéterminé (`AmbiguousOrderError`) afin d’éviter un double placement. C'est exactement le genre de discipline attendu d'un moteur d'exécution. Le client vérifie également que l’intention `OrderParams` correspond aux montants et au side effectivement signés avant émission.

La construction EIP-712 V2 est désormais explicite, avec séparation du domaine standard et neg-risk, montants BUY/SELL différenciés et wire payload documenté.

Cependant, **Pallas possède aujourd’hui un order sender, pas encore un véritable execution engine**.

Le problème numéro un est la **réconciliation**. Polymarket fournit un canal WebSocket utilisateur authentifié qui émet en temps réel placements, changements d’ordres et trades. ([Polymarket Documentation][1]) Pallas n'a actuellement ni consumer de ce canal, ni registre durable des ordres ouverts, ni machine locale de lifecycle, ni récupération automatique après `AmbiguousOrderError`. L'architecture indique elle-même que cette réconciliation doit être effectuée manuellement.

Cela transforme un incident réseau banal en **intervention humaine obligatoire**. Pour du trading automatisé, c'est un blocker.

Deuxième problème important : les métadonnées nécessaires à l'exécution correcte ne font pas partie du modèle exploité. Une réponse `/book` Polymarket comporte notamment `min_order_size`, `tick_size` et `neg_risk`. ([Polymarket Documentation][2]) Or `OrderbookSchema` accepte ces propriétés via `.passthrough()`, mais `getOrderbook()` ne conserve que bids, asks et timestamp.

Conséquences possibles :

* ordre rejeté parce que le prix n'est pas aligné sur le tick ;
* ordre sous `min_order_size` ;
* utilisation du mauvais Exchange EIP-712 pour un marché `neg_risk` si l'appelant ne fournit pas correctement `exchangeAddress` ;
* incapacité à réagir à un changement dynamique de tick size.

Ce dernier point n'est pas théorique : le canal WebSocket marché de Polymarket comporte explicitement un événement `tick_size_change`. ([Polymarket Documentation][3])

Troisième limite : Pallas ne dispose actuellement que de `GTC`/`GTD` dans son builder, alors que Polymarket offre également `FOK` et `FAK`. ([Polymarket Documentation][4]) Ce n'est **pas** un défaut pour un MVP si la stratégie n'en a pas besoin, mais le comportement d'exécution attendu doit être explicitement restreint à ces TIF.

### Verdict axe 1

**Bonne intégrité cryptographique et défensive. Boucle d’exécution insuffisante.**

Je classerais :

**P0 — avant capital réel**

1. user WebSocket + ordre/trade state machine ;
2. reconciliation REST au startup et après toute erreur ambiguë ;
3. persistance des order IDs / fills / states ;
4. prise en compte obligatoire de `tick_size`, `min_order_size` et `neg_risk`;
5. procédure `cancel-all` de secours.

Polymarket fournit précisément un endpoint `DELETE /cancel-all`, exploitable même en mode cancel-only. ([Polymarket Documentation][5]) Un trading system devrait avoir cette primitive dans son kill path.

---

# 2. Gestion des risques — 2.0/5

Le moteur Rust est probablement le composant le plus sophistiqué du dépôt, mais **sa sophistication mathématique masque un défaut architectural plus important : il n'observe pas encore le portefeuille réel.**

Les points positifs sont réels : validation des données, coherence `price × quantity`, limite par ordre, sizing Kelly, circuit breaker, régime de volatilité, CVaR et stress testing sont tous regroupés dans un pipeline fail-closed.

Mais l'objet soumis au moteur contient lui-même :

`bankroll_usd`, `max_order_usd`, `max_drawdown_usd`, `win_probability`, `confidence`.

Autrement dit, plusieurs contraintes censées protéger la stratégie sont **des inputs de la stratégie candidate**.

C'est une mauvaise frontière de confiance pour un système live.

Un véritable risk layer doit idéalement disposer de valeurs autoritatives, par configuration/profil/risk account, et recevoir du strategy layer quelque chose comme :

> « Je souhaite acheter X shares du token Y à P »

et non :

> « Je souhaite acheter X et voici également la bankroll et le max order avec lesquels tu dois me juger. »

Sinon, un bug d'appelant peut implicitement élargir sa propre enveloppe de risque.

## Défaut critique : aucun risque d'exposition

`TradeRequest` ne contient ni position actuelle, ni open orders, ni collateral déjà engagé, ni exposition par market/event, ni portefeuille global.

`POSITION_LIMIT` signifie donc actuellement essentiellement :

> valeur de **cet ordre** ≤ max_order

et non :

> exposition après exécution ≤ limite de portefeuille.

C'est une différence fondamentale.

Par exemple :

* 20 ordres de $500 peuvent chacun passer une limite `$1,000`;
* plusieurs ordres pendants peuvent consommer le même capital logique ;
* des positions fortement corrélées entre marchés peuvent être chacune admissibles ;
* les deux outcomes d'un même marché peuvent être traités sans vue consolidée ;
* un ordre partiellement rempli puis resoumis peut être évalué sur une représentation périmée.

Pour un prediction market, les risques sont particulièrement discrets et conditionnels : un portefeuille peut paraître diversifié tout en dépendant d'un même événement politique, économique ou sportif.

## Défaut critique : absence de données = risque zéro

Le moteur VaR renvoie explicitement VaR et CVaR à **0** lorsque l'échantillon contient moins de deux observations.

Le pipeline interprète ensuite ce CVaR comme une mesure normale et vérifie :

`cv <= max_drawdown_usd * 0.5`.

Ainsi, un moteur fraîchement lancé avec zéro historique peut obtenir :

**CVaR = 0 → gate PASS.**

C'est à l'opposé d'une logique conservatrice.

L'état devrait être distingué :

* `ESTIMATED`
* `INSUFFICIENT_DATA`
* `UNAVAILABLE`

et `INSUFFICIENT_DATA` devrait entraîner soit un reject, soit une enveloppe de démarrage très réduite explicitement configurée.

## Défaut significatif : circuit breaker HalfOpen

La machine décrit :

`Closed -> Open -> HalfOpen -> Closed`.

Mais `is_open()` retourne vrai **uniquement pour `Open`**.

Le pipeline ne fait que :

`let cb_open = state.circuit_breaker.is_open()`.

Par conséquent, `HalfOpen` est traité comme un état permettant le trading normal.

Or le sens opérationnel d'un half-open breaker est précisément de permettre **une reprise très limitée / une sonde**, pas de rouvrir implicitement le robinet entier.

Il y a en outre un problème conceptuel dans le mécanisme de recovery : l’état `Open` progresse vers `HalfOpen` après un nombre de `record_pnl()` appelé « observations ». Mais si les trades sont bloqués durant `Open`, la provenance de nouveaux P&L n'est pas naturellement définie.

La transition devrait plutôt être fondée sur :

* durée ;
* santé infrastructure/venue ;
* intervention opérateur ;
* éventuellement une sonde explicitement autorisée.

## VaR/CVaR : utile, mais secondaire ici

Je ne supprimerais pas VaR/CVaR. Mais pour le MVP Polymarket je les classerais derrière des contrôles beaucoup plus élémentaires :

**exposure limits > collateral availability > open-order reservation > per-market/event concentration > drawdown > stale-data guard > liquidity/slippage > CVaR/Kelly.**

Aujourd'hui, une partie de cette pyramide est inversée : les outils quantitatifs existent avant le ledger autoritatif qui devrait les alimenter.

### Verdict axe 2

Le risk engine est **un bon moteur de règles mathématiques isolé**, mais pas encore un **portfolio risk manager**.

Les blockers sont :

1. état portefeuille autoritatif ;
2. réservations des open orders ;
3. limites globales/per-market/per-event ;
4. bankroll et limites hors contrôle du strategy caller ;
5. fail-safe si historique insuffisant ;
6. correction HalfOpen.

---

# 3. Viabilité opérationnelle — 1.6/5

C'est ici que le verdict production devient sans ambiguïté.

Le README dit explicitement :

> **MVP, en préparation de dry-run**

et que gateway, agent et ledger ne sont pas commencés.

Le document d'architecture confirme :

* gateway : vide ;
* agent layer : vide ;
* ledger : inexistant ;
* ambiguous order : reconciliation manuelle.

Cela exclut à lui seul un verdict production.

## Ce qui fonctionne bien

La CI est une vraie amélioration opérationnelle. Une exécution GitHub Actions sur `f41f27d` s'est terminée avec `conclusion: success`, et au moment de mon inspection une nouvelle exécution sur le commit audité `e065604` était déjà partie.

La stratégie d'environnement reproductible Nix, tests TypeScript/Rust, audit dépendances et compilation est saine. Le repository possède également plusieurs frontières fail-closed plutôt que des fallbacks silencieux.

Mais CI ≠ production operations.

## Manques structurants

Il n'y a actuellement pas de :

* service supervisé long-running ;
* health/readiness endpoints ;
* boucle WebSocket avec reconnect/backoff/resubscribe ;
* monitoring des heartbeats Polymarket ;
* métriques execution/risk ;
* persistent trade ledger ;
* startup reconciliation ;
* crash recovery ;
* dead-letter / quarantine pour événements incohérents ;
* détection de stale market data ;
* alerting ;
* kill switch opérationnel connecté à l'exchange ;
* cancel-all automatique ;
* runbook opérateur ;
* idempotence de récupération fondée sur l'état venue.

Le canal marché Polymarket demande notamment un heartbeat et fournit les mises à jour de book, trade, tick size et résolution ; le canal utilisateur fournit les événements privés orders/trades. ([Polymarket Documentation][3])

Pour un service automatisé, ces flux ne sont pas du confort : **ils constituent le feedback loop de l'exécution**.

## UX

Pour un outil en développement, le CLI actuel est adapté.

Pour un MVP de production, l'UX minimale n'a pas besoin d'être une grosse interface graphique. Mais il faut au minimum quelque chose comme :

`status`

`positions`

`open-orders`

`risk`

`health`

`pause`

`resume`

`cancel-all`

`reconcile`

et des messages impossibles à interpréter comme un état sain alors que l'état de venue est inconnu.

Un dashboard peut attendre. **L'observabilité ne peut pas attendre.**

---

# Principales constatations classées

| ID        | Sévérité | Constat                                                                             |
| --------- | -------- | ----------------------------------------------------------------------------------- |
| **P0-01** | Critical | Pas de reconciliation automatique orders/fills après startup ou résultat ambigu     |
| **P0-02** | Critical | Risk engine sans état réel positions/open orders/collateral                         |
| **P0-03** | Critical | Limites `max_order`, `max_drawdown`, `bankroll` fournies par l'appelant du trade    |
| **P0-04** | High     | VaR/CVaR sans données = `0`, donc absence de preuve interprétée comme faible risque |
| **P0-05** | High     | Circuit breaker `HalfOpen` autorise implicitement le pipeline normal                |
| **P0-06** | High     | `tick_size`, `min_order_size`, `neg_risk` reçus du CLOB mais non intégrés à l'ordre |
| **P0-07** | High     | Kill path sans `cancel-all` venue                                                   |
| **P1-01** | High     | Pas de user WebSocket / order lifecycle local                                       |
| **P1-02** | High     | Pas de persistance durable / ledger                                                 |
| **P1-03** | Medium   | Pas de stale-price / book freshness gate                                            |
| **P1-04** | Medium   | Pas de limite de concentration par marché/événement                                 |
| **P1-05** | Medium   | Pas de liquidity/slippage guard                                                     |
| **P1-06** | Medium   | GTC/GTD uniquement ; acceptable si explicitement limité pour le MVP                 |

---

# Ce que je considère désormais acquis

Je ne recommanderais **pas** de réécrire Pallas.

Les éléments suivants méritent d'être conservés :

* séparation Rust risk / TS execution ;
* contrat runtime Zod ↔ Rust ;
* EIP-712 V2 explicite ;
* dry-run default ;
* schema gate ;
* intent-vs-signed-order cross-check ;
* pas de retry automatique de `POST /order`;
* sandbox ;
* secrets chiffrés ;
* CI Nix ;
* petits modules testables.

La divergence avec CloddsBots est donc réelle au sens important : **Pallas possède maintenant sa propre architecture et ses propres contraintes techniques.**

Le chantier suivant n'est pas une nouvelle refonte architecturale. C'est la construction de **la boucle fermée production** :

**venue state → portfolio state → risk decision → order → venue acknowledgement/fill → reconciliation → portfolio state.**

Aujourd'hui, Pallas dispose surtout du centre :

**risk decision → order**

Les deux côtés de la boucle manquent encore.

# Critères de sortie pour déclarer le MVP live-ready

Je ne déclarerais Pallas prêt à risquer du capital que lorsque ces huit conditions sont démontrées ensemble :

1. un restart reconstruit positions + open orders + fills depuis Polymarket avant toute nouvelle émission ;
2. toute réponse ambiguë interdit un nouvel ordre tant que reconciliation n'est pas terminée ;
3. le risk engine travaille sur une exposition venue-backed incluant les ordres non remplis ;
4. les limites de risque sont configurées hors de la stratégie ;
5. tick size, minimum size et neg-risk sont automatiquement dérivés du marché ;
6. le circuit breaker déclenche une vraie mise en sécurité, avec `cancel-all`, et sa reprise est contrôlée ;
7. un test réel dry-run/observation longue durée démontre reconnect WebSocket, stale-data detection et recovery ;
8. après crash volontaire à chaque étape du lifecycle, le processus converge vers le même état que Polymarket sans double ordre.

Si ces huit preuves passent, **je serais alors prêt à examiner Pallas comme candidat live-capital** plutôt que comme prototype.

### Conclusion

Pallas v0.2.1 n'est pas un échec d'audit. Il est arrivé à un stade plus intéressant : **les composants locaux commencent à être suffisamment bons pour que les défauts majeurs soient désormais des défauts de système distribué et de contrôle d'état.**

C'est généralement le seuil qui sépare un « bot qui sait envoyer des ordres » d'un véritable **trading system**.

**Décision d'audit :**

**Dry-run / développement : `GO`**
**Shadow trading contre données live : `GO`, avec supervision**
**Ordres live avec capital symbolique : `NO-GO actuellement`**
**Production autonome avec capital : `NO-GO`**

La prochaine version ne devrait donc pas ajouter davantage de sophistication quantitative avant d'avoir fermé **reconciliation + portfolio state + venue-backed risk + operational kill path**.

[1]: https://docs.polymarket.com/api-reference/wss/user?utm_source=chatgpt.com "User Channel - Polymarket Documentation"
[2]: https://docs.polymarket.com/api-reference/market-data/get-order-book?utm_source=chatgpt.com "Get order book - Polymarket Documentation"
[3]: https://docs.polymarket.com/api-reference/wss/market?utm_source=chatgpt.com "Market Channel - Polymarket Documentation"
[4]: https://docs.polymarket.com/concepts/order-lifecycle?utm_source=chatgpt.com "Order Lifecycle - Polymarket Documentation"
[5]: https://docs.polymarket.com/api-reference/trade/cancel-all-orders?utm_source=chatgpt.com "Cancel all orders - Polymarket Documentation"
