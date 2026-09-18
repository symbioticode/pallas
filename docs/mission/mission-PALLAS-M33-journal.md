# Journal — PALLAS-M33 — Observatory UI

Date : 2026-09-14  
Statut : TERMINÉ

## Résultat

- Baseline dynamique : le tag est lu depuis `docs/mvp/BASELINE-FREEZE.md`, puis son commit exact
  est résolu avec `git rev-parse <tag>^{commit}`. L'UI distingue baseline et HEAD courant.
- Panneau `CAMPAGNE` : lecture seule du pointeur, du manifeste, des checkpoints, de l'instantané
  CT et du journal de coût réseau. Les données absentes ou invalides restent explicites.
- Kill switch : état affiché avec source `NONE`, `DURABLE_STATE`, `KILL_FILE`, `BOTH` ou
  `UNKNOWN`; aucun contrôle d'écriture n'a été ajouté.
- Coût réseau : la donnée existait dans `.pallas/m32-network-cost.jsonl`. L'UI affiche le ratio
  `getOpenOrders_getTrades_calls / reconcile_scopes` du dernier échantillon de la campagne active.
- Version Observatory portée à `0.2.0`.
- `/api/status`, héritée de M20 mais contraire à la frontière documentée de deux routes, a été
  retirée. Les seules surfaces sont désormais `GET /` et `GET /api/snapshot`.

## Validation

- Test Observatory ciblé : 30 tests passés, 0 échec ; suite complète : 310 tests passés, 0 échec.
- Baseline : fixture Git à deux tags, vérification que la valeur et le commit suivent la source.
- Campagne : fixture active et absence (`UNKNOWN`).
- Kill switch : non engagé, état durable, fichier `.pallas/KILL`.
- Frontière : méthodes non-GET en 405, routes autres que les deux surfaces en 404.
- Dépendances : recherche/test statique sans import `@pallas/execution`, `@pallas/risk`,
  `@pallas/strategy` ou `@pallas/core`.
- Redaction : champs clé privée, secret, credential, passphrase, mnemonic et seed filtrés
  récursivement avant sérialisation.

La campagne CT-2026-020-PALLAS-R1, ses processus, ses unités et ses fichiers de contrôle n'ont
été ni modifiés ni signalés. Seules des lectures de fichiers déjà produits ont servi à confirmer
les formats.
