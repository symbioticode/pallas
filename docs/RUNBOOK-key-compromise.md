# RUNBOOK — Clé compromise (privée, API, ou passphrase suspectée)

Date : 2026-09-11
Installation : PALLAS-M19 (session PALLAS 2026-09-11) — relu comme exécutable par un tiers.
Périmètre : Pallas. Les actions plateforme (Polymarket / portefeuille) restent manuelles —
aucune ne passe par `@pallas` aujourd'hui.

---

## 0. Acronymes / prérequis

| Terme | Sens |
|---|---|
| vault | fichier chiffré v2 (`PALLAS_POLYMARKET_VAULT`), permissions `0600` |
| passphrase | `PALLAS_CREDENTIAL_KEY` — dérive la clé AES-256-GCM du vault |
| API key | credentials CLOB Polymarket (`apiKey`/`apiSecret`), révocables côté plateforme |
| ledger | journal chaîné SHA-256 + checkpoint signé Ed25519 (`packages/ledger`) |
| cancel-all | capacité d'annulation massive des ordres — **livrée (PALLAS-M14), durcie PALLAS-M25** |

Prérequis pour ce runbook : accès au compte CLOB (dashboard API), accès au wallet
(Ethereum/Polygon), shell avec le dépôt Pallas monté, `openssl`.

---

## 1. Décision préalable — QU'EST-CE qui est compromis ?

| Suspicion | Action minimale | Degré |
|---|---|---|
| Clé API (`apiKey`/`apiSecret`) uniquement | Sections 2, 3, 6 | ⚠ moyen |
| Clé privée wallet (ordres + fonds) | Sections 2, 4, 5, 6 | 🔴 critique |
| Passphrase vault (`PALLAS_CREDENTIAL_KEY`) | Sections 2, 5, 6 (aucun secret à plat ne fuit si le vault tient le choc) | ⚠ moyen |
| Compromission machine/process (leaks en clair possibles) | Sections 2, 4, 5, 6, 7 | 🔴 critique |

## 2. Immédiat (T+0, toutes suspicions)

1. **Arrêter le process Pallas** : `systemctl --user stop pallas*` (ou kill le process run-loop).
   Un process qui continue tourne avec des secrets déjà compromis.
2. **Ne PAS mettre à jour le vault avant l'arrêt** — toute écriture après accusations est suspecte.
3. **Geler le ledger** : copier `ledger.json` + `*.sig` vers `/tmp/pallas-ledger-freeze-$(date +%F)`.
   Ne pas modifier cette copie — c'est la preuve de l'état.
4. **Noter l'heure** de la suspection dans le journal (chaîne de preuve).

## 3. Révoquer la clé API (si c'est la clé API compromise)

1. Se connecter au dashboard CLOB / console API Polymarket.
2. Révoguer les `apiKey` des credentials stockés dans le vault DÉCHIFFRÉ (celui que le process
   utilisait — voir journal/ledger pour l'identifiant, ou lister les tracés de dérivation).
3. Traçer l'action (id de révocation, horodatage) — même mécanique que la rotation testée.

## 4. Annuler les ordres ouverts (cancel-all industrielle)

> **Capacité disponible (PALLAS-M14 livrée, durcie PALLAS-M25).** L'arrêt d'urgence est
> désormais outillé, mais rien ne remplace la décision opérateur :
>
> - **Arrêt immédiat SANS code** : créer le fichier-drapeau `.pallas/KILL` (ou le chemin
>   `PALLAS_KILL_SWITCH_FILE`). Le point d'émission refuse alors tout ordre (M25) et
>   `enforceKillSwitch` déclenche un `cancelAllOrders()` RÉEL (`DELETE /cancel-all`).
> - **Fonds d'abord si la clé privée wallet est compromise** : transférer vers un wallet de
>   secours (section 5) AVANT toute annulation — un drain est plus critique qu'un ordre
>   resté ouvert.
> - **Ordres ouverts** : `cancel-all` sur l'ensemble des marchés, avec relecture du ledger
>   pour tout ordre suspect (section 6) AVANT le cancel.

## 5. Rotation (clé privée wallet OU passphrase)

Suivre le scénario testé en PALLAS-M19 (voir `docs/mission/mission-PALLAS-M19-journal.md`),
sur le MATÉRIEL COMPROMIS OU PAS :

1. **Wallet** : générer une NOUVELLE clé privée dans un wallet hors-ligne (ledger HW, générateur
   déconnecté), transférer les fonds vers ce wallet (clé compromise = supposer le drain).
   Ne jamais réutiliser `walletPrivateKey` de l'ancien vault.
2. **API** : dériver de nouvelles credentials, révoquer les anciennes (section 3).
3. **Vault** : re-chiffrer avec une NOUVELLE passphrase `openssl rand -hex 32`
   (jamais réutiliser l'ancienne, même si elle n'est PAS compromise). Écrire le vault AVEC
   permissions `0600` (le code refuse les fichiers trop larges — `SecretFilePermissionsError`).
   Procédure REPRODUCTIBLE et versionnée : `node scripts/rotate-credentials.mjs` — génère des
   credentials de TEST à la volée, re-chiffre, vérifie que l'ancienne passphrase n'ouvre plus
   le nouveau vault, applique `0600`, et rapporte explicitement si un testnet a réellement été
   utilisé (sinon « skipped », jamais présenté comme une exécution réelle).
4. **Nettoyer** : `shred -u` l'ancien fichier vault/env si le support est un disque classique ;
   documentation du remplacement dans le journal de rotation.

## 6. Vérifier le ledger pour tout ordre suspect

1. Charger le ledger avec la clé publique (mode strict) : `PALLAS_LEDGER_PUB_KEY=...`
   — toute rupture de chaîne ou signature invalide = `LedgerIntegrityError` = alerte.
2. Comparer les maillons signés du **gel** (section 2) à l'état actuel : tout checkpoint
   incohérent après l'heure de suspection est un signal grave.
3. Parcourir les `execution_success`/`execution_rejected`/`execution_error` entre la dernière
   rotation et l'heure de suspection : notional, marché, taille appliquée vs demandée,
   horodatage. Tout ordre non initié par la stratégie = compromission avérée.
4. Documenter la conclusion dans un verdict daté (annexe du journal de mission).

## 7. Machine/process compromis — en plus

- Réinstaller l'environnement depuis le dépôt versionné (jamais la copie locale suspecte).
- Rotation de TOUS les secrets (section 5), pas seulement la clé suspectée.
- Revue des accès (SSH, CI, registry NPM) — clés présentes dans le process peuvent avoir été
  exfiltrées par stdout/stderr ou fichiers lisibles (limite bwrap : la lecture n'est pas
  confinée, voir `docs/SECURITY.md`).

---

## Récap exécutable (à cocher)

- [ ] 2.1 process arrêté
- [ ] 2.3 ledger gelé (`/tmp/pallas-ledger-freeze-*`)
- [ ] 2.4 heure notée
- [ ] 3. clés API compromise révoquées (preuve)
- [ ] 4. ordres annulés / fonds transférés (selon priorité drain)
- [ ] 5. wallet/API/passphrase rotés (vault 0600, nouveau `openssl rand -hex 32`)
- [ ] 6. ledger vérifié + verdict daté
- [ ] 7. (si machine) env réinstallé depuis dépôt + accès revus

## Limites assumées du runbook

- cancel-all est livré (M14) et déclenchable par le fichier externe `.pallas/KILL` (M25).
- Aucun testnet CLOB Polymarket officiel n'est connu : la dérivation/révocation réelle contre
  un testnet n'a donc pas été exécutée par PALLAS-M28 (voir journal). La procédure exacte pour
  un opérateur disposant d'un accès est fournie par `scripts/rotate-credentials.mjs`.
- Aucune intégration KMS : la passphrase vit en env local ; la compromission machine =
  présomption de fuite de tout secret en clair (SECURITY.md § custody).