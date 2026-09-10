# Phase 2.2 — Credentials Polymarket : procédure pas à pas

Objectif : fournir/compléter **uniquement ce que le code exige**, puis valider le schéma
de signature contre l'API live afin de lever le fail-closed (`signedOrdersValidated`).

> Règle de sécurité : **aucune clé privée ne passe en clair dans le chat ou en
> argument de commande**. Tout import se fait par fichier local `chmod 600` chiffré
> ensuite dans le vault AES-256-GCM (`PALLAS_CREDENTIAL_KEY`).

---

## 0. Ce que le code attend exactement (contrats)

| Élément | Forme | Utilisé pour |
|---|---|---|
| **`privateKeyEthereum`** | 32 octets (64 hex, préfixe `0x` optionnel) | Dériver l'adresse EIP-712 qui signe **tout** : ordres CLOB, `derive-api-key`, api creds |
| **`apiKey`** (Polymarket CLOB) | chaîne fournie par `POST /auth/derive-api-key` | Endpoints privés (`/order`, `/orders`, cancel) via en-têtes `POLY_*` |
| **`PALLAS_CREDENTIAL_KEY`** | 32 octets aléatoires | Clé AES-256-GCM du vault `polymarketSecrets` (fail-closed si absente) |
| **Adresse de trading** | dérivée par `privateKeyToAddress` | Vérification : c'est le compte que tu finances |

Tu **n'as pas** besoin de trouver une « API key » manuellement : elle est *dérivée*
par Polymarket à partir de ta clé privée (étape 6, automatisée).

Format wallet accepté par le code :
- clé privée Ethereum : 64 hex (`0x…4493bdf`) — la plus simple ;
- keypair Solana JSON (`[priv32, pub32]`, base58 ou hex) : j'extrais les 32 premiers octets.
  Polymarket t'ouvre un wallet Solana sur la plateforme, mais la **signature CLOB est une
  adresse Ethereum** dérivée de la même graine — une seule clé suffit.

---

## 1. Décision préalable (à toi)

- **[Recommandé] Testnet d'abord** — réseau Polygon **Amoy** (chain 80002), endpoint
  `clob-testnet.polymarket.com`, fonds fictifs (faucet gratuits, zéro risque). Le flag est
  levé une fois la validation passée.
- **Mainnet ensuite** (optionnel) — réseau Polygon (chain 137), `clob.polymarket.com`,
  capital réel (USDC.e) ; nécessite une **re-validation** d'au moins 1 ordre minimal et la
  décision ferme de mettre du capital en jeu.

---

## 2. Vérifier l'accès réseau (2 min)

Depuis la machine qui fera tourner le bot :

```bash
curl -sI https://clob-testnet.polymarket.com/markets | head -3
```

- `200/HTTP` visible → OK, continue.
- Timeout/refus → chiffre le blocage (proxy, pare-feu, DNS) et nomme **qui** est bloqué.

---

## 3. Produire / fournir la clé du wallet (3 min)

**Option A — je génère une paire neuve (testnet recommandé) :**
je crée une clé Ethereum aléatoire, j'affiche **uniquement l'adresse dérivée** (pas la clé),
tu finances cette adresse, et la clé est immédiatement importée dans le vault chiffré.

**Option B — tu fournis une clé existante :**
1. MetaMask → compte Polymarket → `···` → « Détails du compte » → « Afficher la clé privée »
   → copie le `0x…` (64 hex). (Wallet Solana équivalent : exporter sa private key base58.)
2. Mets-la dans un fichier local (jamais dans le chat) :
   ```bash
   mkdir -p ~/.pallas && chmod 700 ~/.pallas
   printf '%s' '0x…' > ~/.pallas/wallet.txt && chmod 600 ~/.pallas/wallet.txt
   ```
3. Dis-moi que le fichier est là → je l'importe dans le vault AES-256-GCM puis je supprime
   `wallet.txt` (aucune copie en clair persistante).

---

## 4. Générer (moi) + stocker `PALLAS_CREDENTIAL_KEY`

- Je génère 32 octets aléatoires (hex) et je te l'affiche **une seule fois**.
- Tu le ranges dans ton gestionnaire d'env / `~/.pallas/env` (chmod 600). Sans lui, le vault
  refuse de se déchiffrer (fail-closed). Ne le mets jamais dans le repo.

---

## 5. Dériver l'adresse et vérifier

J'exécute `privateKeyToAddress` sur la clé importée et je t'affiche l'adresse (0x checksum).
**Tu confirmes** que c'est bien le compte à financer.

---

## 6. Financer le compte

- **Testnet** : teslene pour la clé, puis fonds fictifs Amoy (faucet faucet.polygon.technology)
  vers l'adresse dérivée ; si besoin marchés de test : `polymarket.com/markets?for_testnet=true`.
- **Mainnet** : envoie **USDC.e natif** (Polygon) vers l'adresse dérivée. (USDC.e = collatéral
  accepté par le CLOB ; quelques $ suffisent pour 1 ordre de validation.)

--- 

## 7. Dériver l'API key (automatisé)

- `POST /auth/derive-api-key` : signature EIP-712 (`register` + `createApiKey`) avec la
  même clé → je reçois `apiKey` (+ secret/passphrase) → tout est chiffré dans le vault.
- Aucune action de ta part (si l'endpoint diffère de la doc, j'itère en direct).

---

## 8. Validation du schéma live (moi — ne te demande rien)

Séquence de non-régression, en **dry-run=false authorisé** sur testnet :

1. `GET /markets` (connectivité + forme des payloads) ;
2. descendance d'un marché → `tokenId` (uint256) du collateral ;
3. ordrebook, puis **1 ordre limite signé minimal** (GTC, taille 1, expiration +1h) ;
4. si l'API le rejette : je compare l'erreur, j'ajuste le domaine/la structure EIP-712,
   je re-teste — jusqu'à acceptation
   (`orderID` retourné, pas d'erreur de schéma) ;
5. `cancel` + `GET /order/{orderID}` (statut confirmé) ;
6. je recoupe avec la doc sur les en-têtes `POLY_*` des endpoints privés.

> Tant que (4) n'est pas vert, `signedOrdersValidated` reste `false` : aucun ordre réel.

---

## 9. Lever le fail-closed (config, après validation)

- **Testnet validé** → `signedOrdersValidated: true` en config testnet.
- **Mainnet** → re-validation au minimum 1 ordre minimal ci-dessus, puis flag ; c'est la
  décision qui engage ton capital réel — tu la confirmes explicitement.

---

## 10. Ce que je ne ferai jamais

- écrire une clé en clair dans le repo / les logs / les commits ;
- stocker `PALLAS_CREDENTIAL_KEY` à côté du vault ;
- envoyer un ordre sans dry-run explicite ou sans le flag validé ;
- demander la clé par chat ou commande d'historique visible.

---

## Checklist finale

- [ ] Accès HTTPS sortant vers l'endpoint (testnet + mainnet) confirmé
- [ ] Wallet fourni/généré, importé chiffré, fichier en clair supprimé
- [ ] `PALLAS_CREDENTIAL_KEY` générée et stockée hors repo (par toi)
- [ ] Adresse dérivée affichée et confirmée par toi
- [ ] Compte financé (testnet fictif / mainnet USDC.e)
- [ ] `derive-api-key` OK → creds dans le vault
- [ ] 1 ordre limite signé accepté par l'API (schéma live validé)
- [ ] Cancellation + statut confirmés
- [ ] `signedOrdersValidated: true` (testnet, puis mainnet sur décision explicite)