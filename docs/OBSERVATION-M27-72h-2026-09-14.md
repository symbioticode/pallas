# Rapport d'observation — PALLAS M32 / campagne 72 h

Date : 2026-09-14 05:30:04Z → 2026-09-17 05:30:13Z  
CT : `CT-2026-020-PALLAS-R1`  
Baseline : `pallas-mvp-freeze-1` — `e69d7542f79ff3e6a24df60773147a6a2f400986`  
Périmètre : paper/dry-run supervisé, aucun capital réel

## Verdict factuel

La campagne gouvernée a atteint **259 208 613 ms** pour une cible de **259 200 000 ms**, soit
**72,002 h**, puis s'est terminée avec `reason=duration_reached`. Le marqueur `COMPLETE`, le
`summary.json` et le checkpoint final sont présents. Les 13 checkpoints portent
`signature_len=88` et `verified_load=true`; le dernier est
`state=final_duration_reached` et ancre les 42 195 entrées du ledger.

Le critère d'observation F-11 (absence d'une campagne réelle d'au moins 72 h) dispose donc
désormais d'une preuve positive pour cette baseline. Cette conclusion ne transforme pas les
autres limites techniques en GO capital réel : la campagne est restée strictement en dry-run,
sans signer L2 ni ack/fill live.

## Gouvernance et intégrité

- Le CT R1 a été signé par l'humain puis exécuté par le runner : état final `SUCCESS`, résultat
  `CHANGE_VERIFIED`, vérification et acceptation complètes.
- Le manifeste de campagne fixe `target_minutes=4320`, `interval_ms=30000`,
  `monitor_ms=30000`, `dry_run_verified=true` et le commit exact de la baseline.
- Le premier CT, approuvé automatiquement par erreur, avait été invalidé et archivé séparément;
  ses preuves ne sont pas agrégées à cette campagne.
- Le CT R1 `SUCCESS` a été archivé le 16 septembre à 08:16 EDT. Le watchdog a perdu son ancien
  chemin entre 12:05 et 19:41 EDT; la campagne, ses métriques et ses checkpoints ont continué.
  Le watchdog a été corrigé pour utiliser la preuve archivée et le contrôle terminal a produit
  `COMPLETE_PASS`.

Après l'arrêt normal, le `verify.sh` historique donne 3/4 : AC-020-01 exige un launcher vivant,
condition adaptée au lancement mais impossible après `duration_reached`. AC-020-02 à AC-020-04
passent toujours. La clôture a donc été validée séparément par le résumé, `COMPLETE`, la durée,
le checkpoint final et son rechargement signé; cet écart du vérificateur est conservé, pas masqué.

## Disponibilité et incident contrôlé

- 8 637 relevés métriques; aucune ligne avec `alive=false`.
- Intervalle moyen : 30 014,848 ms; maximum : 30 032 ms; aucun intervalle supérieur à 45 s.
- Incident injecté : `SIGKILL` du PID 1768593 le 15 septembre à 10:18:13.973Z.
- Reprise : PID 2053755 à 10:18:15.991Z, soit **2,018 s** après la sortie observée.
- Un seul redémarrage, celui attendu; aucune autre sortie ni alerte.
- Disponibilité dérivée en retranchant cette interruption : **99,999221 %**. La cadence de 30 s
  n'a pas échantillonné l'arrêt bref; ce pourcentage vient des événements enfant horodatés.

## Checkpoints et documentation

Treize checkpoints ont été écrits : un initial, onze périodiques et un final. Les intervalles
périodiques se situent autour de 21 618 à 21 623 secondes (environ 6 h 00 min 18–23 s). Le final
est arrivé à l'échéance, 21 382,864 secondes après le checkpoint précédent. Toutes les lignes
sont également consignées dans
`docs/observation/M27-72h-2026-09-13/CHECKPOINTS.md`.

Le nom historique du dossier documentaire porte la date du plan initial; les hashes et
horodatages permettent de distinguer sans ambiguïté la campagne R1 des essais antérieurs.

## Activité observée

| Mesure | Résultat |
|---|---:|
| cycles complets amorcés | 6 677 |
| signaux sur données Polymarket | 6 677 |
| cycles `no_signal` | 0 |
| décisions risque autorisées | 2 130 |
| décisions risque rejetées | 4 547 |
| exécutions bloquées par le dry-run | 2 130 |
| rejets `POSITION_LIMIT` | 4 547 |
| rejets `CONCENTRATION_LIMIT` | 4 547 |
| erreurs de réconciliation | 0 |
| alertes | 0 |

Le chemin décisionnel a donc été exercé sur des signaux réels et les émissions autorisées ont
toutes été arrêtées par `execution_dry_run_blocked`. Après accumulation de l'exposition simulée,
les limites position et concentration ont rejeté les cycles suivants.

## Coût réseau et réconciliation

Les 6 677 événements `reconcile_scope` ont tous `skipped=true` faute de signer L2. La
réconciliation systématique a donc ajouté exactement **0 appel `getOpenOrders`/`getTrades`** dans
cette campagne. La baseline ne compte pas les lectures de carnets par méthode; leur volume exact
n'est pas vérifiable rétrospectivement. Cette observation ne valide donc pas le comportement de
rate-limit du chemin L2 authentifié.

## Ressources et taille des preuves

- Ledger final : 42 195 entrées, 41 780 628 octets (39,85 MiB).
- État durable final : 1 191 295 octets (1,14 MiB).
- RSS moyen mesuré : 346 987 KiB.
- RSS maximum : 1 087 896 KiB (1 062,4 MiB).
- RSS final : 865 472 KiB (845,2 MiB).

La mémoire ne revient pas à son niveau de démarrage et atteint plus de 1 GiB. La campagne n'a pas
échoué et aucune alerte n'a été émise, mais cette dérive est un constat opérationnel résiduel à
analyser avant une fenêtre plus longue.

## Conclusion et limites

La campagne ≥72 h elle-même est **réalisée et vérifiée** : durée atteinte, dry-run maintenu,
incident/reprise observés, checkpoints réguliers et finaux signés, preuves conservées. F-11 peut
être considéré fermé pour son exigence d'observation temporelle sur la baseline gelée.

Restent hors de cette conclusion : capital réel, ordre/ack/fill live, attribution exacte des fills,
portefeuille exchange autoritatif, rate limits L2, WebSocket de réconciliation et maîtrise de la
croissance mémoire observée. Le verdict NO-GO capital réel n'est pas modifié par ce rapport.
