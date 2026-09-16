# Rapport d'observation — PALLAS-M27 (campagne dry-run)

Date de campagne : 2026-09-13 01:29:04Z → 01:41:04Z (**720 s**)
Statut : **PARTIELLE — cible 72 h NON atteinte** (limite de session, explicitée §6)
Version observée : commit `11089855d044b1c31f9931cf3cba230bb2c614a0` (M21→M26 closes)
Dry-run : **vérifié actif AVANT lancement** (`getIsDryRun() === true`), jamais désactivé.
Artefacts bruts conservés : `docs/observation/M27-2026-09-13/` (manifest, metrics.jsonl, summary.json, logs, ledger).

> **Avertissement de lecture.** 12 minutes d'observation ne démontrent RIEN sur la tenue
> multi-jours visée par F-11. Ce rapport documente (a) que le dispositif d'observation
> fonctionne réellement, (b) un incident contrôlé et sa reprise, et (c) des limites
> environnementales. Toute conclusion de robustesse serait abusive.

## 1. Disponibilité et exécution

| Métrique | Valeur observée |
|---|---|
| Durée réellement observée | 720,7 s (12 min) — cible annoncée 72 h |
| Échantillons de métriques | 146 (toutes les 5 s) |
| Cycles d'orchestrateur exécutés | 93 (2 runs : 40 avant incident + 53 après reprise) |
| Redémarrages | 1 (incident provoqué, voir §2) |
| Disponibilité | process vivant à chaque échantillon sauf pendant ~2 s de reprise |
| Alertes émises | 0 |

## 2. Incident contrôlé et reprise

Un `SIGKILL` a été injecté à `elapsed = 290 s` (40 % de la fenêtre) sur le process de boucle
(PID 1581037). Comportement observé :
- le superviseur a détecté la sortie (signal `SIGKILL`) et **relancé** la boucle en ~2 s ;
- le ledger, rechargé au démarrage du nouveau process, a passé la vérification de chaîne (M16
  fail-stop) et **a continué de croître** sans perte (aucune alerte `LEDGER_CORRUPT`) ;
- l'état durable étant vide (voir §3), la reprise du chemin d'état n'a pas été exercée.

## 3. Décisions du risk engine — AUCUNE

**93/93 cycles sont `no_signal`.** Raison environnementale : l'endpoint public `/markets` a
renvoyé 1000 marchés dont **0 marqué actif**, et le token retenu (réel, renvoyé par l'API live) n'a
**pas de carnet** (`/book` → « No orderbook exists »). Conséquences :
- aucune décision allow/reject n'a été produite (répartition vide) ;
- le fichier d'état durable `risk-state.json` fait **0 octet** : le chemin d'écriture d'état
  (DECIDED → SUBMITTING → ACKED) n'a **pas** été exercé ;
- la stratégie a bien interrogé l'API réelle à chaque cycle (pas de données simulées).

## 4. Dérive mémoire

| Mesure RSS (VmRSS) | Valeur |
|---|---|
| Premier échantillon (post-fork) | 1 064 Ko |
| Après 1 min de chauffe | 76 980 – 92 256 Ko |
| Maximum | 92 256 Ko |
| Dernier | 92 256 Ko |

Le RSS se stabilise autour de ~77–92 Mo après la montée initiale. **Aucune conclusion** sur une
dérive : 12 min est trop court pour distinguer une fuite lente d'une allocation/GC normale.

## 5. Accumulation des fichiers

| Fichier | Début | Fin |
|---|---|---|
| ledger (`entries` / octets) | 0 / 0 | **283 / 101 118** |
| état durable (octets) | 0 | 0 (aucun signal) |
| alertes (lignes) | 0 | 0 |

Le ledger a crû de façon monotone (~3 entrées/cycle). Le temps de lecture/écriture au fil de
l'accumulation n'est pas mesurable sur 283 entrées ; c'est un axe de la campagne complète.

## 6. Limites explicites

1. **72 h NON atteintes** : 12 min observées. Aucune équivalence n'est revendiquée.
2. **Aucun marché réellement actif trouvé** via l'API publique → aucun cycle avec signal ; le
   chemin d'émission/décision n'a pas été observé.
3. **Ledger en mode dev (non signé)** : aucune clé publique configurée sur ce poste.
4. **Fenêtre trop courte** pour la mémoire, la reconnexion réseau prolongée et l'accumulation.
5. La campagne n'a pas subi de coupure réseau réelle (seul un kill/restart a été provoqué).

## 7. Procédure de reprise pour un opérateur (campagne complète)

```
PALLAS_REF_TOKEN_ID=<token d'un marché ACTIF avec carnet> \
PALLAS_CAMPAIGN_MINUTES=4320 \          # 72 h
PALLAS_CAMPAIGN_INTERVAL_MS=30000 \
PALLAS_CAMPAIGN_MONITOR_MS=30000 \
PALLAS_CAMPAIGN_INCIDENT=1 \
PALLAS_CAMPAIGN_DIR=.pallas/campaign-M27-full \
node scripts/observation-campaign.mjs
```

Le superviseur vérifie le dry-run AVANT de lancer (préflight), refuse de démarrer sinon, conserve
les logs/ledger/état, et écrit `metrics.jsonl` + `summary.json`.