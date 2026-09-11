# Stratégie de référence (PALLAS-M12)

Statut : **instrument d'intégration, NON PRÉDICTIF.**

## Pourquoi elle existe

Le pipeline Pallas (signal → sanitizer → risk engine → exécution → ledger) doit
être exercé de bout en bout dans un environnement de contrôle. Aucune prétention
d'edge, aucune rentabilité espérée, aucun paramètre optimisé. Dès qu'un signal
"réel" pourra être évalué pour ses performances, il faudra un backtesting
(valable, voir plus bas) **et une mission séparée** — pas une évolution de cette
classe.

## Règle (déterministe, délibérément banale)

Sur une liste FIXE de `tokenIds` (marchés binaires), lire l'orderbook et :

- si le **best ask** d'un marché est strictement inférieur au **seuil** FIXE
  configuré → signal `BUY` au prix = ce best ask, taille = `size` fixe ;
- sinon → pas de signal ;
- marché sans carnet côté demandé, ou erreur de lecture → **pas de signal**
  (réponse neutre, le pipeline continue).

La boucle d'intégration exécute ce signal, documente **chaque étape dans le
ledger** (`packages/strategy/src/run-reference-loop.ts`, dry-run strict).

Ce qui est **volontairement absent** : tout paramètre issu de données
historiques, toute estimation de probabilité autre que le prix du marché relu
(probabilité implicite, "le marché est supposé correct"), tout calibrage, tout
"edge de démo".

## Condition de backtesting (pour tout usage prédictif futur)

Avant de qualifier quoi que ce soit de stratégie rentable, toutes les règles
suivantes devraient être réunies — en pratique une nouvelle mission, pas un
tweak :

1. Historique **out-of-sample strict** : une fenêtre d'entraînement
   (paramètres : seuil, size, tokens retenus) et une fenêtre de test jamais
   utilisées pour choisir ces paramètres.
2. **Walk-forward** par fenêtres glissantes (pas une seule fenêtre ouverte).
3. **Multi-marchés, multi-périodes** : les mêmes paramètres sur un échantillon
   de marchés variés (l'ordre de grandeur des frais/spread doit entrer dans le
   modèle − Polymarket CLOB : taille minimale, tick, maker fees).
4. Métriques standard **avant/après coûts** : ratio de Sharpe, drawdown max,
   nombre de trades significatif (> 100), p-value / intervalle de confiance.
5. La sensibilité des conclusions à de petits changements du seuil/size doit
   être montrée (stabilité ≠ un point précis du grid).
6. Le résultat est rejouable : versions de données et de stratégie épinglées.

Tant que ces conditions ne sont pas remplies, la stratégie de référence ne
doit jamais être présentée comme ayant de la valeur prédictive.