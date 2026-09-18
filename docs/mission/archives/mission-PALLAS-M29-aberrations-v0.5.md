# MISSION — PALLAS-M29 — Fermer les 3 aberrations d'AUDIT-PALLAS-v0.5 (rattrapage au démarrage, kill switch fichier, provenance de l'audit)

## 0. Métadonnées
Mission ID : PALLAS-M29
Date de création : 2026-09-12
Auteur / Agent : Claude (revue de v0.5) — exécution par Codex
Projet : Pallas
Statut : ACTIF — 🟠 Haute (sécurité opérationnelle + intégrité de la chaîne d'audits)
Dépend de : branche `missions-M21-M28` (base des correctifs DeepSeek), HEAD `0075721...` (voir §1.3
sur l'invalidité de ce hash — à re-vérifier en premier)
Source de vérité : `AUDIT-PALLAS-v0.5.md` (constats R-01/R-02/R-03) + relecture directe de
`packages/strategy/src/reconciliation.ts`, `packages/strategy/src/run-reference-loop.ts`,
`packages/execution/src/killSwitch.ts`, `docs/RUNBOOK-key-compromise.md`

## 1. Contexte

Cette mission fait suite à une revue indépendante d'`AUDIT-PALLAS-v0.5.md`, qui a identifié trois
problèmes concrets non couverts (ou sous-estimés) par la vague M21-M28.

### 1.1 R-01 est plus grave que formulé : la réconciliation est totalement absente hors signal

L'audit v0.5 note que `reconcileAtStartup` (`packages/strategy/src/reconciliation.ts`) n'est
référencée que par son propre fichier de test — jamais appelée par l'orchestrateur. C'est vrai,
mais la lecture complète de `runReferenceCycle` (`packages/strategy/src/run-reference-loop.ts`)
montre un trou plus large :

```ts
const signal = await opts.strategy.evaluate(opts.client);
...
if (!signal) {
  return { cycle, signal, allowed: false, rejected_by: [], execution: 'not_attempted', ... };
}
// tout ce qui suit — y compris reconcileStateLedger() et reconcileScopeForMarket() —
// n'est JAMAIS exécuté si le cycle ne produit aucun signal.
```

Conséquence vérifiée par la campagne M27 elle-même (`docs/observation/M27-2026-09-13/`) : sur
93/93 cycles `no_signal`, **aucune réconciliation n'a tourné**, ni le rattrapage ledger↔état
(`reconcileStateLedger`), ni le scan des ordres non réglés. Et même un cycle *avec* signal ne
réconcilie que le `market_id` de ce signal — jamais les autres marchés portant une empreinte
AMBIGUOUS/SUBMITTING résiduelle. Un marché silencieux (aucun signal généré) peut donc porter un
ordre ambigu indéfiniment sans que rien ne tente jamais de le résoudre, tant qu'aucun autre signal
n'est émis ailleurs.

### 1.2 Le runbook surpromet le kill switch fichier (incohérence documentation/code)

`docs/RUNBOOK-key-compromise.md` §4 affirme que déposer le fichier-drapeau `.pallas/KILL` fait que
« `enforceKillSwitch` déclenche un `cancelAllOrders()` RÉEL ». Or `enforceKillSwitch`
(`packages/strategy/src/reconciliation.ts`) ne lit que l'état durable :

```ts
export async function enforceKillSwitch(store, client) {
  const doc = store.read();
  const engaged = doc.risk.kill_switch_engaged; // ⬅ ignore isKillSwitchFileEngaged()
  setGlobalKillSwitch(engaged);
  if (!engaged) return { engaged, cancelAll: 'not_needed', ... };
  ...
}
```

`isKillSwitchFileEngaged()` (`packages/execution/src/killSwitch.ts`) n'intervient que côté lecture,
dans `getGlobalKillSwitch()`, consultée au point d'émission (`placeOrder`). Le fichier bloque donc
bien toute **nouvelle** émission (M25 est correct sur ce point), mais ne déclenche **aucune**
annulation automatique des ordres **déjà ouverts**. Un opérateur suivant le runbook en situation de
compromission croira à tort que déposer le fichier suffit à tout annuler — c'est le scénario
d'urgence précis pour lequel ce document existe.

### 1.3 Provenance non vérifiable de l'audit v0.5 lui-même

L'en-tête d'`AUDIT-PALLAS-v0.5.md` donne comme commit audité :
`0075721f6b1d3e8b4c1a5e9f2d8c7b6a5f4e3d2c10` — cette chaîne fait **42 caractères hexadécimaux**,
ce qui n'est ni un SHA-1 (40) ni un SHA-256 (64) valide. PALLAS-M21 a justement versionné les
audits pour permettre de confronter chaque verdict à l'arbre exact qu'il a jugé
(`docs/SECURITY.md` § « Chaîne d'audits — traçabilité »). Un identifiant de commit invalide/fabriqué
casse cette garantie à la racine : impossible de savoir avec certitude quel état du code v0.5 a
réellement inspecté.

## 2. Objectif général

Fermer ces trois écarts avant de considérer v0.5 confirmée, puis republier soit une confirmation
de v0.5 (si les trois points s'avèrent être des faux positifs après vérification), soit une
version v0.5.1 documentant les corrections et la preuve de leur exécution.

## 3. Objectifs détaillés

- **Réconciliation indépendante du signal.** Découpler `reconcileStateLedger` (rattrapage
  audit/état) et la réconciliation de scope de la présence d'un signal. Au minimum :
  1. `reconcileStateLedger(store, ledger)` doit tourner à **chaque cycle**, y compris `no_signal`,
     pas seulement quand un `trade` est construit ;
  2. ajouter (ou câbler) un passage qui réconcilie **tous** les ordres locaux non réglés
     (`isUnresolved`), pas seulement ceux du marché du signal courant — `reconcileAtStartup` fait
     déjà ce travail pour le démarrage ; envisager une variante appelable à chaque cycle, ou motiver
     explicitement pourquoi ce n'est pas nécessaire à chaque cycle (ex. fréquence, coût réseau) si
     l'équipe décide de ne le faire qu'au démarrage — mais alors le câbler réellement au démarrage.
  3. Appeler `reconcileAtStartup` dans `main()` (`run-reference-loop.ts`), après le chargement de
     l'état durable et avant la boucle de cycles, quand un `signer` (maker L2) est disponible —
     symétrique à ce que fait déjà `reconcileScopeForMarket` en cours de cycle.
- **Kill switch fichier → cancel-all réel.** Faire en sorte que la présence du fichier-drapeau
  déclenche, elle aussi, un `cancelAllOrders()` (au même titre que `doc.risk.kill_switch_engaged`),
  avec la même idempotence (`meta.kill_switch_cancelall_called`) — soit en faisant lire
  `enforceKillSwitch` la vérité combinée (`getGlobalKillSwitch()`) plutôt que le seul champ d'état,
  soit en documentant explicitement, si l'équipe choisit de ne PAS le faire, que le fichier est un
  blocage d'émission seul et que l'annulation des ordres ouverts reste une action manuelle
  opérateur — mais dans ce cas, **corriger le runbook** pour ne plus affirmer le contraire.
- **Assainir la provenance de l'audit.** Vérifier le commit HEAD réel de la branche
  `missions-M21-M28` au moment de la relecture, corriger `AUDIT-PALLAS-v0.5.md` (ou produire
  l'addendum v0.5.1) avec le hash exact, et vérifier qu'aucun autre document de la chaîne d'audits
  ne porte un identifiant de commit malformé.

## 4. Protocole de validation

**Setup** : `npm test` et `cargo test` verts à chaque étape, sur la branche `missions-M21-M28`.

**Métriques à capter :**
1. Test qui simule N cycles `no_signal` consécutifs avec un ordre `AMBIGUOUS` préexistant sur un
   marché différent de celui interrogé par la stratégie — la réconciliation doit désormais le
   traiter (ou le rapport doit démontrer explicitement pourquoi ce n'est structurellement pas
   possible sans un signal, avec une alternative proposée).
2. Test qui engage le kill switch UNIQUEMENT via le fichier-drapeau (état durable resté à `false`)
   et vérifie qu'un `cancelAllOrders()` est réellement appelé — ou, si la décision est de ne pas le
   faire, diff du runbook prouvant que l'affirmation incorrecte a été retirée.
3. `git rev-parse HEAD` sur la branche réellement inspectée, comparé à l'en-tête d'un éventuel
   `AUDIT-PALLAS-v0.5.1.md`.

## 5. Procédure / Étapes

### Partie A — Préparation
- Lire en entier `packages/strategy/src/reconciliation.ts` et `run-reference-loop.ts` avec la
  question : « quel chemin de code s'exécute réellement quand `no_signal` ? ».
- Relire `packages/execution/src/killSwitch.ts` et `docs/RUNBOOK-key-compromise.md` en parallèle
  pour confirmer l'écart §1.2 avant de corriger.

### Partie B — Vérifications préalables
- Écrire les 2 tests de régression de la section 4 (cycles no_signal + kill switch fichier seul)
  AVANT de corriger, pour confirmer chaque écart.
- `git rev-parse HEAD` immédiatement, noter le hash exact dans le journal de mission.

### Partie C — Exécution
- Corriger dans l'ordre : réconciliation indépendante du signal (le plus impactant) → kill switch
  fichier → cancel-all (ou correction du runbook) → assainissement de la provenance de l'audit.

## 6. Ce que l'agent doit faire
1. Ne pas supposer que R-01 se limite à « appeler `reconcileAtStartup` une fois au démarrage » —
   vérifier explicitement le comportement en régime de croisière (cycles répétés sans signal), pas
   seulement au premier lancement.
2. Choisir explicitement entre « le fichier-drapeau déclenche cancel-all » et « le fichier bloque
   seulement l'émission, annulation manuelle » — mais dans les deux cas, faire correspondre le code
   et le runbook. Ne jamais laisser une documentation de sécurité affirmer un comportement que le
   code ne fait pas.
3. Documenter le hash de commit réellement inspecté à chaque étape de cette mission — ne pas
   reproduire l'erreur de provenance relevée en §1.3.

## 7. Critères de succès
- [ ] Un ordre non réglé sur un marché silencieux (aucun signal généré) est réconcilié par au moins
      un mécanisme régulier (par cycle ou par une tâche de fond documentée), testé.
- [ ] Le fichier-drapeau `.pallas/KILL` seul déclenche un `cancelAllOrders()` réel — ou le runbook
      est corrigé pour ne plus affirmer ce comportement, avec diff à l'appui.
- [ ] `AUDIT-PALLAS-v0.5.md` porte un hash de commit valide (40 ou 64 caractères hex) correspondant
      réellement à l'état inspecté, ou un `AUDIT-PALLAS-v0.5.1.md` le corrige explicitement.
- [ ] `npm test` et `cargo test` restent verts, aucune régression sur M13/M14/M22/M23/M25.

## 8. Interdictions
- Ne pas fermer cette mission en déclarant R-01 résolu si seule `reconcileAtStartup` a été câblée
  au démarrage sans traiter le cas des cycles `no_signal` répétés en cours de run.
- Ne pas laisser une divergence entre le runbook et le comportement réel du kill switch fichier,
  dans un sens ou dans l'autre.
- Ne pas produire de nouveau rapport d'audit sans y inscrire un hash de commit réellement valide et
  vérifiable.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M29-journal.md`, avec preuve avant/après pour les 3 points et
le hash de commit exact utilisé pour chaque vérification.
Livrables : diffs `reconciliation.ts`, `run-reference-loop.ts`, `killSwitch.ts` (ou justification
documentée de non-changement), `docs/RUNBOOK-key-compromise.md` corrigé si nécessaire,
`AUDIT-PALLAS-v0.5.1.md` (confirmation ou correctif) si la mission conclut à une nouvelle version.
