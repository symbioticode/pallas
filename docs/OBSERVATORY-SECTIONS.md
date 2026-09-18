# Pallas Observatory — guide des sections

État documenté : Observatory v0.2.0, PALLAS-M33.  
Surface : diagnostic local en lecture seule sur `http://127.0.0.1:4173/`.

## Principe général

L'Observatory agrège des artefacts déjà présents sur disque et, pour le carnet de marché
uniquement, une lecture publique de l'API CLOB. Il ne lance pas de campagne, ne prend aucune
décision métier et ne permet ni ordre, ni annulation, ni modification du risk state ou du kill
switch.

Les seules routes HTTP sont :

- `GET /` : page statique de l'interface ;
- `GET /api/snapshot` : fragment HTML et horodatage du dernier snapshot.

Toute autre route répond `404` et toute autre méthode HTTP répond `405`.

## Bandeau d'avertissements

Les badges placés au-dessus des panneaux résument les états qui demandent l'attention : ledger
invalide ou non signé, état durable indisponible/corrompu, réconciliation, kill switch, absence de
cycle ou donnée marché inconnue/périmée.

Un avertissement décrit une observation, pas nécessairement un incident actif. Par exemple,
`MARKET DATA UNKNOWN` signifie que la lecture du carnet n'a pas produit de donnée exploitable.

## SYSTEM

Ce panneau donne l'identité et la santé générale de la surface observée :

- version de l'application Observatory ;
- tag de baseline et commit figé, dérivés de `docs/mvp/BASELINE-FREEZE.md` et de Git ;
- commit HEAD courant ;
- mode `DRY RUN` ;
- état de la boucle de référence et âge de son dernier événement ;
- validité, signature, nombre d'entrées et dernier événement du ledger principal ;
- résultat d'exécution du dernier cycle enregistré.

`RUNNING`, `STOPPED`, `STALE` et `UNKNOWN` concernent la boucle de référence principale, pas la
campagne supervisée présentée dans le panneau suivant.

## CAMPAGNE

Ce panneau suit la campagne désignée par `.pallas/m27-72h-current`, sans consulter ni contrôler
son processus :

- identifiant CT lu dans l'instantané CT disponible ;
- état `ACTIVE`, `COMPLETE`, `UNKNOWN` ou `INVALID` ;
- heure de démarrage issue du manifeste ;
- minutes écoulées par rapport à la cible du manifeste ;
- nombre de lignes de checkpoints signés ;
- résultat de vérification du dernier checkpoint ;
- dernière mise à jour observée ;
- coût réseau par cycle, si un échantillon correspondant existe dans
  `.pallas/m32-network-cost.jsonl`.

`UNKNOWN` signifie que le pointeur ou les artefacts attendus ne sont pas disponibles. `INVALID`
signifie que le pointeur sort du répertoire `.pallas` autorisé ou que le manifeste est illisible.

## KILL SWITCH

L'indicateur combine deux sources en lecture seule :

- le champ `kill_switch_engaged` de `.pallas/risk-state.json` ;
- la présence du fichier `.pallas/KILL`.

La source affichée est `NONE`, `DURABLE_STATE`, `KILL_FILE`, `BOTH` ou `UNKNOWN`. Il n'existe
aucun bouton pour engager ou désengager le kill switch.

## DURABILITY · STATE

Ce panneau décrit l'état transactionnel durable :

- format et intégrité du document ;
- nombre total d'ordres, ordres potentiellement vivants et réconciliations en cours ;
- table des ordres avec corrélation, statut, identifiant d'ordre et marché ;
- notes de cohérence ou de migration.

Un checksum incorrect produit `CORRUPT` et le contenu risk falsifié n'est alors pas traité comme
une autorité valide.

## MARKET

Le panneau tente un `GET` public vers le carnet CLOB du token configuré. Sans token explicitement
fourni au serveur, il reprend le token du dernier signal valide du ledger principal. Il affiche :

- question et outcome lorsqu'ils ont été fournis au lancement ;
- token ;
- meilleur bid, meilleur ask, milieu et spread ;
- horodatage et erreur éventuelle.

Les états sont `OK`, `STALE` ou `UNKNOWN`.

### Pourquoi `MARKET UNKNOWN` actuellement ?

Au moment de ce diagnostic, le serveur n'avait pas de token explicitement configuré. Il a donc
repris le token du dernier signal du ledger principal, dont le dernier événement date du
`2026-09-11T02:13:39.261Z`. L'appel CLOB pour ce token a répondu `HTTP 404`. Aucun carnet ne peut
alors être calculé : bid, ask, mid, spread et horodatage restent `UNKNOWN`.

Cela ne signifie pas que la campagne M32 ou l'ensemble de Polymarket est indisponible. Le panneau
MARKET et le panneau CAMPAGNE lisent deux contextes distincts : le premier suit le token du ledger
principal, tandis que le second suit les artefacts de la campagne désignée par son pointeur.

## STRATEGY · SIGNAL

Cette section représente la dernière sortie de `ReferenceStrategy` et jusqu'à 100 signaux valides
du ledger principal :

- signal courant, seuil, taille demandée et prix observé ;
- avertissement permanent `REFERENCE STRATEGY — NON PREDICTIVE` ;
- courbe des prix observés, seuil et résultat risk associé à chaque signal.

Le badge `DEMO OVERRIDE`, lorsqu'il apparaît, indique un seuil forcé pour démonstration.

## RISK

Le panneau restitue la dernière décision risk enregistrée dans le cycle courant. Il ne la
recalcule pas. Il affiche :

- `ALLOW`, `REJECT` ou `UNAVAILABLE` ;
- gardes responsables d'un rejet ;
- taille suggérée, circuit breaker, échantillons P&L et exposition vivante ;
- détail de chaque garde risk, de son action et de sa raison.

## ALERTS

Cette section lit les dernières lignes valides de `.pallas/alerts.jsonl`, dans la limite de 20,
et les présente de la plus récente à la plus ancienne.

### Pourquoi `16 CRITICAL · AMBIGUOUS_ORDER` actuellement ?

Le fichier contient exactement 16 événements `AMBIGUOUS_ORDER`, horodatés entre
`2026-09-12T00:57:26.380Z` et `2026-09-13T01:20:03.702Z`. Leur sujet est `order result unknown
after network contact` : le résultat d'un ordre était inconnu après un contact réseau.

Le nombre `16 CRITICAL` est donc un **compteur de lignes historiques affichées**, et non la preuve
de 16 ordres encore ambigus ou de 16 incidents actifs. L'Observatory v0.2.0 ne dispose pas de
notion d'acquittement/résolution pour ce fichier et ne filtre pas les événements selon leur âge.
L'état durable courant affiche par ailleurs zéro ordre total, zéro ordre vivant et zéro
réconciliation en cours. Les deux informations sont compatibles : historique d'alertes ancien
d'un côté, état transactionnel courant vide de l'autre.

## ACTIVITY

La dernière section affiche jusqu'aux 50 dernières entrées du ledger principal, avec :

- horodatage ;
- nom de l'événement ;
- résumé ;
- payload complet repliable.

Les champs dont le nom évoque une clé privée, un secret, une credential, une passphrase, un
mnemonic ou une seed sont retirés récursivement avant sérialisation.

## Sources locales lues

- `docs/mvp/BASELINE-FREEZE.md` et métadonnées Git ;
- `.pallas/ledger.json` et son checkpoint `.sig` ;
- `.pallas/risk-state.json` ;
- `.pallas/observatory-loop.json` ;
- `.pallas/KILL` ;
- `.pallas/alerts.jsonl` ;
- `.pallas/m27-72h-current` et artefacts de la campagne pointée ;
- `.pallas/ct-020-r1-state-snapshot.json` ;
- `.pallas/m32-network-cost.jsonl`.
