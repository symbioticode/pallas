# Pallas Observatory v0

Surface locale de diagnostic du pipeline existant : marché → signal de référence → décision
risk → blocage dry-run → ledger. Ce n'est ni une interface de trading, ni un gateway.

## Lancement

### Démarrage simple (recommandé)

Une seule commande choisit automatiquement un marché actif, lance le serveur et le reference
loop dry-run :

```bash
nix-shell --run "npm run build && npm run observatory:demo"
```

Ouvrir ensuite l'URL affichée : <http://127.0.0.1:4173>. Aucun token ID à rechercher ou à
copier. Garder le terminal ouvert ; `Ctrl+C` arrête les deux processus.

### Démarrage manuel

Depuis la racine du dépôt, préparer une fois les artefacts :

```bash
nix-shell --run "npm run build"
nix-shell --run "cd crates/risk-engine && cargo build --release"
```

Puis lancer l'Observatory dans un premier terminal :

```bash
PALLAS_REF_TOKEN_ID=<token-id> PALLAS_REF_THRESHOLD=1 \
  nix-shell --run "npm run observatory"
```

Ouvrir <http://127.0.0.1:4173>, puis lancer la boucle dans un second terminal :

```bash
PALLAS_REF_TOKEN_ID=<token-id> PALLAS_REF_THRESHOLD=1 PALLAS_REF_CYCLES=100 \
  nix-shell --run "npm run reference-loop"
```

La boucle écrit les fichiers `.pallas/`; l'Observatory les relit toutes les 1,5 secondes.
`PALLAS_OBSERVATORY_PORT` change le port. La lecture publique
du book est optionnelle : si Polymarket ou le réseau est indisponible, le panneau affiche
`UNKNOWN`.

Le mode automatique affiche la question et l'outcome humains du marché. Son seuil forcé à
`1` est identifié par le badge `DEMO OVERRIDE` : il sert à exercer le pipeline, pas à suggérer
un signal significatif. `REFERENCE LOOP` distingue `RUNNING`, `STOPPED`, `STALE` et `UNKNOWN`,
avec l'âge du dernier événement. `APP v0.1.0`, `AUDIT BASELINE v0.3` et le commit sont affichés
séparément.

## Frontière read-only

- Le package ne dépend ni de `@pallas/execution`, ni de `@pallas/risk`, ni de
  `@pallas/strategy`. Il n'importe aucune primitive d'ordre, d'annulation, de credential ou
  de modification du dry-run.
- Le serveur expose uniquement `GET /` et `GET /api/snapshot`. Toute autre méthode reçoit
  `405` et toute autre route `404`.
- Les seules entrées locales sont `.pallas/ledger.json` et `.pallas/risk-state.json`, ouvertes
  en lecture. Le lanceur écrit uniquement `.pallas/observatory-loop.json`, un statut
  opérationnel sans autorité métier; l'UI le lit sans le modifier. Le seul accès distant de
  l'UI est `GET https://clob.polymarket.com/book?token_id=…`.
- L'UI ne recalcule aucune décision risk : elle affiche la dernière décision réellement
  enregistrée dans le cycle courant. Elle ne constitue aucune nouvelle autorité métier.
- Les champs dont le nom évoque clé privée, secret, credential, passphrase, mnemonic ou seed
  sont supprimés récursivement avant sérialisation, même si un ledger compromis en contient.
- Aucun contrôle de l'interface ne peut modifier le risk state, le ledger ou transmettre un
  ordre. Les fichiers absents/corrompus et données réseau absentes restent explicitement
  `INVALID`, `UNAVAILABLE` ou `UNKNOWN`.
