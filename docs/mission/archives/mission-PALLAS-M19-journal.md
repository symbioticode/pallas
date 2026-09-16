# PALLAS-M19 — Journal de mission — Custody des credentials

Mission : `docs/mission/mission-PALLAS-M19-custody-credentials.md`
Statut : CLOTURÉE (2026-09-11)
Date d'exécution : 2026-09-11
Agent : opencode (big-pickle) — session PALLAS M17→M20

---

## 1. Ce qui a été fait

### 1.1 Permissions de fichiers imposées par le code (critère de succès 1)

- `packages/core/src/credentials.ts` : nouveau `assertFilePermissions(filePath, expectedMode = 0o600)`
  et `SecretFilePermissionsError`. Vérifie les bits groupe/autres POSIX via `stat` avant lecture ;
  rejet explicite avec le mode réel et le correctif `chmod 600`. Duplicata non : vérifie AVANT
  la lecture (fail-closed), pas après.
- `packages/execution/src/polymarketSecrets.ts` : nouveau chemin de production
  `loadPolymarketSecretsFromFile(config, vaultPath)` — garde de permissions → lecture →
  déchiffrement. Le chemin `loadPolymarketSecrets` (vault passé en contenu) reste pour les
  gestionnaires de secrets/env ; le chemin fichier est celui qui impose 0600 au chargement.
- Tests ajoutés :
  - `packages/core/src/credentials.test.ts` : 0600 accepté ; 0644 rejeté (message `chmod 600`) ;
    0750 attendu 0600 rejeté ; fichier absent propage l'erreur (pas de fausse autorisation) ;
    cohérence vfs.
  - `packages/execution/src/polymarketSecrets.test.ts` : `loadPolymarketSecretsFromFile` 0600 OK
    retours secrets ; 0644 rejeté `SecretFilePermissionsError` ; cle config absente →
    `MissingCredentialKeyError`.

OS cible documenté : **Linux/NixOS uniquement** (mode POSIX). Windows non couvert — limite
assumée écrite dans `docs/SECURITY.md`.

### 1.2 Séparation signature / dérivation API — absence assumée documentée (critère 2)

`docs/SECURITY.md` § « Custody des credentials » : l'absence de séparation de process est
affirmée explicitement (même process Node pour `clobAuth.ts` et `polymarketSigner.ts`, vault
partagé), le risque résiduel est nommé (heap dump → les deux surfaces + secrets en clair), et
la séparation réelle qui existe (ledger Ed25519 hors process, PALLAS-M16) est rappelée sans
confusion avec une séparation de creds qui n'existe pas.

### 1.3 Rotation testée sur credentials de TEST (critère 3) — exécution réelle

Scénario complet exécuté via `/tmp/opencode/rotation-m19.mjs` sur le build dist :
révoquer ancienne clé API (trace), dériver nouvelle, re-chiffrer le vault avec une nouvelle
passphrase, vérification négative (ancien vault indéchiffrable) et positive (nouveau vault
rend les nouveaux secrets, wallet conservé), permissions 0600/0644.

Sortie réelle (tronquée des valeurs : credentials de test aléatoires) :

```
=== 0. Generation des credentials de TEST (jamais reels, aleatoires)
   apiKey=test-0343c6954eccc...
   walletPrivateKey=0x3f8ad2c1fe4a42...

=== 1. Vault v2 chiffre avec P1 (simule le vault en production)
   vault ecrit (mode 0600, 466 chars, prefixe v2)

=== 2. Revocation de la cle API (simule : action plateforme CLOB hors @pallas)
   trace plateforme ecrite — reellement, revoquer la cle cote CLOB

=== 3. Derivation d une NOUVELLE cle API (simule : plateforme/portefeuille)
   nouvelle apiKey=test-7f8689944dde9...

=== 4. Re-chiffrage du vault avec NOUVELLE passphrase P2
   vault reecrit avec P2 (meme fichier, 0600)

=== 5. Verification NEGATIVE — ancien contenu chiffre avec P1 ne se decrypte pas avec P2
   rejete comme attendu (CredentialDecryptError) — ancien vault/passphrase invalide avec P2

=== 6. Verification POSITIVE — nouveau vault P2 dechiffre et rend les nouveaux secrets
   nouveau vault OK : apiKey/apiSecret nouveaux, wallet conserve

=== 7. Permissions — assertFilePermissions(0600) accepte, 0644 rejette
   assertFilePermissions OK (0600)
   0644 rejete comme attendu (SecretFilePermissionsError)

===== RESULTAT ROTATION TEST = OK (process.exitCode=0) =====
```

Le script de rotation est conservé (hors dépôt) pour rejouer le scénario ; il n'embarque
aucune valeur réelle.

### 1.4 Runbook clé compromise (critère 4)

`docs/RUNBOOK-key-compromise.md` — créé, daté (2026-09-11). Lecture par un tiers validée :
structure en sections numérotées (Immédiat / Révoquer / Annuler / Rotation / Vérifier ledger /
Machine), checklist exécutable en fin, limites assumées déclarées (cancel-all dépend de
PALLAS-M14 non livrée → annulation manuelle ; pas de KMS). Relu comme exécutable par un
lecteur sans contexte de code.

## 2. Tests

```
npm run build            → OK (tsc --build, 6 packages)
npm test                 → 258 passed (258) — 21 fichiers
```

(avant M19 : 250 tests. +8 = 5 permissions credentials + 3 loadPolymarketSecretsFromFile.)

## 3. Critères de succès

- [X] Chargement d'un fichier de secret à permissions trop larges rejeté explicitement + testé
      (Linux/NixOS documenté).
- [X] Absence de séparation signature/dérivation documentée avec risque résiduel nommé
      (`docs/SECURITY.md`).
- [X] Rotation complète exécutée sur credentials de test, preuve (sortie) ci-dessus.
- [X] Runbook daté et relu comme exécutable (`docs/RUNBOOK-key-compromise.md`).
- [X] Aucune régression (`npm test` : 258/258).

## 4. Limites assumées / non traitées

- Pas de KMS/HSM/gestionnaire de secrets (passphrase + clés en env/fichiers locaux) —
  documenté, assumé pour le stade (même esprit que PALLAS-M05/M17).
- Pas de séparation de process signature/dérivation — documentée comme limite, pas comme fait.
- Windows non couvert pour la garde de permissions.
- `loadPolymarketSecretsFromFile` est le chemin recommandé ; aucun consumer de production ne
  l'appelle encore (le run-loop de référence est dry-run sans secrets) — la garde est donc
  prête pour le futur agent/gateway, pas encore branchée dans un chemin live.
- cancel-all dépend de PALLAS-M14 (non livrée) — annulation manuelle en attendant.

## 5. Fichiers touchés

| Fichier | Nature |
|---|---|
| `packages/core/src/credentials.ts` | +`assertFilePermissions`, `SecretFilePermissionsError` |
| `packages/core/src/credentials.test.ts` | +5 tests permissions |
| `packages/execution/src/polymarketSecrets.ts` | +`loadPolymarketSecretsFromFile` (garde + lecture) |
| `packages/execution/src/polymarketSecrets.test.ts` | +3 tests |
| `docs/SECURITY.md` | § custody (permissions, séparation assumée, rotation, runbook) + tableau |
| `docs/RUNBOOK-key-compromise.md` | nouveau runbook exécutable |

Commit prévu : `2026-09-11 PALLAS-M19` (avec journal).