# PALLAS-M28 — Journal de mission — Custody credentials : garde par défaut + rotation reproductible

Mission : `docs/mission/mission-PALLAS-M28-custody-rotation-reelle.md`
Statut : CLOTURÉE (2026-09-12)
Date d'exécution : 2026-09-12
Agent : DeepSeek Harness (deepseek-flash) — branche `missions-M21-M28`

---

## 0. Résumé

F-09 traité : la garde de permissions n'est plus une fonction disponible mais ignorée — un TEST DE
CONVENTION échoue si un point de chargement de secret la contourne. La rotation est désormais
REPRODUCTIBLE et VERSIONNÉE (`scripts/rotate-credentials.mjs`), avec des credentials de test
générés à la volée. `npm test` : 301 passed / 0 failed.

## 1. Audit des points de chargement de secrets

Périmètre : `packages/*/src/**/*.ts` (production, hors tests). Résultat :

| Constat | Détail |
|---|---|
| Chemin gardé | `loadPolymarketSecretsFromFile` : `assertFilePermissions` PUIS lecture |
| Autre chemin | `loadPolymarketSecrets(config, ciphertext)` : pas de fichier, donc pas de permissions à vérifier (vault fourni en mémoire/env) |
| Consommateur de production | **AUCUN** — l'orchestrateur tourne en dry-run avec signataire éphémère |

Ce dernier point est l'absence explicitée par la fiche : elle est désormais VÉRIFIÉE par test, plus
seulement documentée.

## 2. Test de convention (revue de code automatisée)

`packages/execution/src/secrets-guard-convention.test.ts` :
- `decryptPolymarketSecrets` et `PALLAS_POLYMARKET_VAULT` confinés au module garde ;
- `loadPolymarketSecrets` référencé uniquement par ce module (absence de chemin live) ;
- garde de permissions ordonnée AVANT la lecture dans `loadPolymarketSecretsFromFile`.

Un futur chemin qui lirait le vault sans la garde ferait échouer la suite.

## 3. Script de rotation (sortie réelle)

`docs/RUNBOOK-key-compromise.md` renvoie désormais à ce script. Exécution réelle :

```
{
  "event": "rotation_result",
  "generated": { "kind": "TEST_ONLY", "apiKey_fp": "bb3ba613b4a8", "wallet_fp": "3a4ff716c56f" },
  "rotation": {
    "old_pass_rejected_on_new_vault": true,
    "secrets_preserved": true,
    "vault_a_mode": "600",
    "vault_b_mode": "600"
  },
  "network": {
    "status": "skipped",
    "reason": "aucun testnet CLOB Polymarket accessible (PALLAS_ROTATION_BASE_URL absent)"
  }
}
```

## 4. Statut réel vs simulé (exigence §6.1)

**Aucun testnet CLOB Polymarket officiel** n'est accessible ; la dérivation/révocation réelle
contre un testnet n'a **pas** été exécutée. Le script le rapporte `network.status = skipped` et ne
présente jamais une simulation comme une exécution réelle. La procédure exacte pour un opérateur
avec accès est fournie (variables `PALLAS_ROTATION_LIVE/BASE_URL/TESTNET_PRIVKEY`).

## 5. Runbook mis à jour

`docs/RUNBOOK-key-compromise.md` corrigé sur deux points devenus faux :
- la ligne « cancel-all dépend de PALLAS-M14 (non livrée) » → cancel-all est livré (M14) et
  déclenchable SANS code par le fichier externe `.pallas/KILL` (M25) ;
- la section rotation renvoie au script versionné et à son statut réseau honnête.

## 6. Ce qui n'a pas été fait / limites assumées

- **Aucun testnet CLOB** : dérivation/révocation réelle non exécutée (limite EXTERNE, pas un choix
  de scope) ; procédure fournie.
- **Secrets en clair dans le tas JS** : limite M05/M19 inchangée, non résolue ici.
- **Pas de KMS / séparation de process** : la passphrase vit en env local.
- Aucun changement Rust ; `cargo test` non concerné.

## 7. Références

- Mission : `docs/mission/mission-PALLAS-M28-custody-rotation-reelle.md`
- Script : `scripts/rotate-credentials.mjs`
- Test : `packages/execution/src/secrets-guard-convention.test.ts`
- Docs : `docs/SECURITY.md`, `docs/RUNBOOK-key-compromise.md`