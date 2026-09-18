# JOURNAL — PALLAS-M05 — Credentials & mémoire : honnêteté du zeroing, fermeture des fuites en clair

Statut : **CLÔTURÉE** le 2026-09-09
Agent d'exécution : opencode / big-pickle
Référentiel : `AUDIT-PALLAS-v0.1.md` (section « Credentials : chiffrement oui, zeroing non ») + mission
`mission-PALLAS-M05-credentials-memoire.md`
Cadre : `packages/core/src/credentials.ts` + `packages/execution/src/polymarketSecrets.ts` +
`packages/execution/src/polymarketSigner.ts`.

## 1. Constat de départ (audit, confirmé par lecture de code)

- Le zeroing existait uniquement pour la clé dérivée (`credentials.ts`) et le buffer déchiffré temporaire.
- La passphrase et le plaintext passent par des `string` JS (non-effaçables) ; `JSON.parse` crée un
  objet dont les valeurs restent en clair ; `loadPolymarketSecrets` retourne durablement les secrets.
- **4 conversions de clé privée en `Buffer` dans le signer n'étaient jamais effacées** :
  `privateKeyToAddress`, `signOrder`, `signEip191`, `signClobAuth` (audit : `polymarketSigner.ts:161-174`).
- Deux affirmations publiques trompeuses : « zeroing mémoire » sans qualification, et
  `polymarketSecrets.ts` « Aucun secret ne sort en clair : decrypt -> objet temporaire » (faux :
  le decrypt sort les secrets en clair dans un objet).

**Réalité assumée dès le départ** (répétée dans le journal pour qu'elle ne soit pas perdue) : en JS pur,
on ne peut PAS garantir un zeroing complet — le GC peut avoir copié une string immuable avant tout
effacement. La mission ne prouve donc pas l'impossible ; elle réduit la surface là où c'est possible
(Buffers) et rend l'affirmation exacte pour le reste.

## 2. Partie A — inventaire des points de code manipulant un secret en clair

| Point | Nature | Traité par |
|---|---|---|
| `polymarketSigner.ts:250` `privateKeyToAddress` | Buffer dérivé d'une clé privée, jamais effacé | `toKeyBuffer` + `finally { fill(0) }` |
| `polymarketSigner.ts:261` `signOrder` | idem | idem |
| `polymarketSigner.ts:294` `signEip191` | idem | idem |
| `polymarketSigner.ts:342` `signClobAuth` | idem | idem |
| `credentials.ts` `deriveKey` | clé dérivée (déjà zeroée) | conservé |
| `credentials.ts` `decryptObject`/`decryptCredentials` | buffer déchiffré (déjà zeroé) | conservé |
| `polymarketSecrets.ts` `loadPolymarketSecrets` | secrets en clair dans un objet retourné | **non restructuré** (voir §4) |
| `credentials.ts` passphrase / strings hex | `string` JS non-effaçable | documenté (risque résiduel) |

## 3. Partie B — preuve technique du `Buffer.fill(0)` (test, pas pétition de principe)

Le signer travaille désormais sur une **copie** (`Buffer.from`) du secret, jamais sur la mémoire de
l'appelant ; la copie est effacée dans un `finally`. Preuve par 4 tests ajoutés
(`polymarketSigner.test.ts`) :

- `signOrder` avec un `Buffer` du caller : après appel, le buffer du caller est **intact**, la
  signature est identique au chemin string (déterminisme préservé) → prouve copie + zeroing interne ;
- `privateKeyToAddress` avec un `Uint8Array` du caller : intact après appel ;
- `signClobAuth`/`signEip191` avec un `Buffer` du caller : intacts, signatures valides + recovery
  EIP-191 vers l'adresse attendue ;
- clé de taille invalide (`'01'`, 3 octets) → erreur explicite « doit faire 32 octets », aucune
  signature rendue (le buffer de la copie est effacé avant le throw).

Ces tests sont la preuve demandée (catalogue de la mission §5-B) : `fill(0)` sur une copie Buffer
fonctionne comme attendu en Node.js et ne corrompt pas l'entrée de l'appelant.

## 4. Partie C — exécution

### 4.1 Signer : factorisation `toKeyBuffer` + zeroing (objectif 1)

```ts
function toKeyBuffer(privKey: Uint8Array | string): Buffer {
  const buf = typeof privKey === 'string'
    ? Buffer.from(privKey.replace(/^0x/i, ''), 'hex')
    : Buffer.from(privKey);
  if (buf.length !== 32) { buf.fill(0); throw new Error('cle privee invalide : doit faire 32 octets'); }
  return buf;
}
```

Chaque fonction signante fait `const pk = toKeyBuffer(privKey); try { … } finally { pk.fill(0); }`.
Contrôle final (grep) : `secp256k1.sign`/`getPublicKey` n'est plus jamais appelé sur un Buffer hors
`try/finally` — les 4 conversions auditées sont couvertes.

### 4.2 API `polymarketSecrets` — évaluée, **non restructurée** (interdiction §8 mission)

L'option « accesseurs à usage unique » a été évaluée : elle forcerait soit une ré-analyse
JSON/passphrase à chaque accès (pire pour la surface), soit la conservation de la même string en clair
dans un objet interne (gain nul), pour une complexité d'API réelle. Décision : **on conserve
`loadPolymarketSecrets` tel quel** et on documente honnêtement (objectif 3 réalisé par la
documentation, pas par une fausse sécurité). L'API est cohérente avec le mode d'emploi réel (secrets
chargés une fois par process).

### 4.3 Documentation — honnêteté (objectif 4 + critère 3)

- `PLAN.md` **§1.1** : `[~]` → `[x]`, libellé précis — « efface les copies Buffer (`toKeyBuffer` +
  `fill(0)`, try/finally) des clés privées dans le signer… NON-effaçable en JS pur : passphrase,
  secrets post-`JSON.parse` et strings sources restent en clair ; risque résiduel documenté dans
  `docs/SECURITY.md` (heap dump) ».
- `PLAN.md` **§2.2** : l'incohérence « Wallet **Solana** » (legacy CloddsBot) est corrigée —
  le wallet est **Ethereum/Polygon (secp256k1)** (`polymarketSecrets.ts:6` réécrit) ; case `[ ] `→
  `[x]` avec référence PALLAS-M05.
- `PLAN.md` **tableau « Ce qu'on ne reprend PAS »** : statut `⚠️ partiel` → explication exacte
  (buffers zeroés, strings non-effaçables, risque documenté).
- `FICHE-LECONS.md:55` : « zeroing mémoire après usage » (non qualifié) → « zeroing des buffers
  dérivés (`.fill(0)`) — le zeroing complet de `string` JS est impossible : le risque résiduel doit
  être documenté, pas nié (PALLAS-M05) ».
- `credentials.ts` : docstring et commentaire `CredentialKey.derivationPassphrase` — retiré le faux
  « caller responsable du zeroing » ; précisé que la passphrase est une string non-effaçable.
- `polymarketSecrets.ts` : retiré le faux « Aucun secret ne sort en clair » → « au decrypt, les
  secrets SORTENT EN CLAIR dans un objet JS, string non-effaçables… risque résiduel documenté ».
- `docs/SECURITY.md` : nouvelle section « Credentials en mémoire — garanties réelles (PALLAS-M05) »
  avec : ce qui est effacé, ce qui ne peut pas l'être, **le risque résiduel** (critère 4 en toutes
  lettres : « les secrets décryptés existent en clair sous forme de string JS tant que le process
  tourne ; en cas de compromission du process (heap dump), ils sont récupérables »), et la **piste
  future** sodium-native/mlock sans preuve de mise en œuvre (objectif : évaluer la lib, pas l'ignorer).

## 5. Résultats de validation

- `npm test` (pretest `tsc --build`) : **99/99** — 9 fichiers (95 avant M05, +4 signer).
- `npm run typecheck` : vert.
- `cargo test` : inchangé 50/50 (Rust non touché).
- Métriques mission : (1) les 4 `Buffer` de clé privée du signer sont effacés après usage — vérifié
  par lecture + tests ✔ ; (2) le texte final de la doc (PLAN + commentaires + SECURITY.md) ne
  contient plus d'affirmation de « zeroing mémoire » non qualifiée ✔ (relecture grep).

## 6. Critères de succès vs mission

- [x] Tous les `Buffer` contenant une clé privée dans `polymarketSigner.ts` sont effacés après usage
      (lecture de code + 4 tests, incluant non-corruption de l'entrée du caller et déterminisme).
- [x] `PLAN.md` ne contient plus l'affirmation non qualifiée « zeroing mémoire » — §1.1/§2.2 et le
      tableau « Ce qu'on ne reprend PAS » décrivent précisément ce qui est effacé et pourquoi le
      reste ne peut pas l'être.
- [x] Aucune régression sur `npm test` (99/99) et `cargo test` (50/50).
- [x] Note explicite du risque résiduel (heap dump / strings en clair) présente dans `docs/SECURITY.md`
      et rappelée dans `credentials.ts`.

## 7. Livrables

- `packages/execution/src/polymarketSigner.ts` — `toKeyBuffer` + `fill(0)` en `finally` sur les 4
  chemins de clé privée ; docstring mémoire.
- `packages/execution/src/polymarketSigner.test.ts` — +4 tests (preuve + clé invalide).
- `packages/core/src/credentials.ts` — commentaires honnêtes.
- `packages/execution/src/polymarketSecrets.ts` — docstring honnête + correction « Wallet
  Ethereum/secp256k1 » (fini « Solana »).
- `PLAN.md` — §1.1, §2.2, tableau « Ce qu'on ne reprend PAS ».
- `docs/SECURITY.md` — section mémoire + risque résiduel + piste sodium future.
- `FICHE-LECONS.md` — leçon 7 affinée (journal + dossier) : chiffrage au repos OK, mémoire documentée.

### Reporter dans M06
- `docs/TRADING.md` (réconciliation `AmbiguousOrderError`) ; CI (cli/typecheck/cargo) ; README sobre.