# PALLAS-M25 — Journal de mission — Kill switch hors surface publique, autorité indépendante

Mission : `docs/mission/mission-PALLAS-M25-kill-switch-autorite.md`
Statut : CLOTURÉE (2026-09-12)
Date d'exécution : 2026-09-12
Agent : DeepSeek Harness (deepseek-flash) — branche `missions-M21-M28`

---

## 0. Résumé

F-06 traité : `setGlobalKillSwitch` n'est plus dans l'API publique de `@pallas/execution`,
l'injection `isKillSwitchEngaged` est restreinte EXACTEMENT comme `isDryRun` (PALLAS-M17), et une
autorité EXTERNE au process (fichier `.pallas/KILL`) engage le kill switch sans passer par le
code. `npm test` : 294 passed / 0 failed.

## 1. Ce qui a été fait

### 1.1 Retrait de l'API publique

`packages/execution/src/index.ts` n'exporte plus `killSwitch.js` en wildcard : seuls la LECTURE
(`getGlobalKillSwitch`, `isKillSwitchFileEngaged`, `killSwitchFilePath`) et
`KillSwitchEngagedError` sont publics. `setGlobalKillSwitch` vit dans
`@pallas/execution/kill-switch-authority` (module `killSwitchAuthority.ts`), sous-chemin ajouté à la
carte `exports` du `package.json` — donc SEUL chemin atteignable (les chemins profonds restent
bloqués par la carte `exports`). L'orchestrateur (`reconciliation.ts`) l'importe par ce sous-chemin.

### 1.2 Injection restreinte

`PolymarketClient` : fournir `isKillSwitchEngaged` hors `PALLAS_TEST_MODE=1` lève au
constructeur, avec le même message-type que `isDryRun`. Un seul mécanisme de verrouillage de test,
pas deux logiques divergentes.

### 1.3 Autorité externe au process

`killSwitch.ts` : `getGlobalKillSwitch()` retourne
`killSwitchEngaged || isKillSwitchFileEngaged()`, où le second teste la PRÉSENCE de
`<PALLAS_KILL_SWITCH_FILE | .pallas/KILL>` (vérifiée à chaque appel). Un désengagement MÉMOIRE ne
peut pas annuler un fichier présent. C'est l'autorité la plus forte du montage actuel.

### 1.4 Décision : pas de service séparé

Le fichier-drapeau ferme la propriété centrale (aucun code du même process ne désengage
silencieusement) sans nouvelle infrastructure. Un service hors process n'est pas implémenté ; la
limite résiduelle (attaquant ayant déjà exécution de code + écriture disque) est nommée dans
`docs/SECURITY.md`.

## 2. Preuves d'exécution

### 2.1 Avant / après

- **avant M25** : `import { setGlobalKillSwitch } from '@pallas/execution'` fonctionnait (test de
  surface) ; l'injection `isKillSwitchEngaged` était acceptée hors test ; un désengagement mémoire
  suffisait.
- **après M25** : `'setGlobalKillSwitch' in publicApi` est FALSE (test) ; la seule porte est le
  sous-chemin réservé ; l'injection hors `PALLAS_TEST_MODE` jette ; un fichier `.pallas/KILL` présent
  maintient le refus d'émission même après `setGlobalKillSwitch(false)`.

### 2.2 Tests (polymarketClient.test.ts, +4)

- surface publique : `setGlobalKillSwitch` absent de `./index.js`, présent dans le sous-chemin ;
- injection refusée hors `PALLAS_TEST_MODE` (symétrique à isDryRun) et acceptée avec ;
- fichier-drapeau externe : engagement, non-annulation par désengagement mémoire, refus
  d'émission SANS POST, libération à la suppression du fichier.
- `npm test` : **294 passed / 0 failed** (+4).

### 2.3 Non-régression M14/M17

`reconciliation.test.ts` importe désormais `setGlobalKillSwitch` par le sous-chemin réservé (et non
plus par l'entrée publique) ; les tests kill switch M14 et les tests `isDryRun` M17 restent verts.

## 3. Ce qui n'a pas été fait / limites assumées

- **Pas de service de kill switch hors process** : décision documentée (le fichier-drapeau ferme la
  propriété essentielle sans infrastructure).
- **`PALLAS_TEST_MODE=1` reste une variable d'environnement** : c'est une autorité faible, reconnue
  comme telle — elle ne sépare pas un build test d'un build prod. La restriction par variable est
  le même compromis que M17 pour `isDryRun` ; une séparation de build/service reste une piste.
- **L'orchestrateur peut encore désengager en mémoire** (c'est son rôle légitime via le sous-chemin
  réservé) ; mais le fichier externe, lui, reste autoritaire.
- Aucun changement Rust ; `cargo test` non concerné.

## 4. Références

- Mission : `docs/mission/mission-PALLAS-M25-kill-switch-autorite.md`
- Code : `packages/execution/src/{killSwitch,killSwitchAuthority,index,polymarketClient}.ts`
- Sous-chemin : `packages/execution/package.json` (`exports` `./kill-switch-authority`)
- Docs : `docs/SECURITY.md` § « Kill switch : hors surface publique et autorité indépendante »