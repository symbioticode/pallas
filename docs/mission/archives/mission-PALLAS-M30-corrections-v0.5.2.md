# MISSION — PALLAS-M30 — Corriger les 3 écarts relevés par AUDIT-PALLAS-v0.5.2

## 0. Métadonnées
Mission ID : PALLAS-M30
Date de création : 2026-09-13
Auteur / Agent : Claude (synthèse d'AUDIT-PALLAS-v0.5.2) — exécution par Codex
Projet : Pallas
Statut : ACTIF — 🔴 Bloquant (NO-GO explicite de v0.5.2 tant que ces points ne sont pas fermés,
y compris pour une campagne courte)
Dépend de : branche portant les correctifs M29 (`c524a6ff...`) + relecture d'`AUDIT-PALLAS-v0.5.2.md`
Bloque : tout nouveau lancement de campagne d'observation (M27-full/72h) — voir §1.4

## 1. Contexte

`AUDIT-PALLAS-v0.5.2.md` a rejoué (pas recopié) les affirmations du journal M29 et trouvé trois
écarts concrets entre ce qui était annoncé et ce qui se vérifie réellement.

### 1.1 Régression de suite : 298 passed / 2 failed / 4 skipped, contredit « 304 passed / 0 failed »

Le journal M29 annonçait une suite entièrement verte à 304 tests. v0.5.2 a rejoué `npm test` sur le
commit réellement audité et obtient 298 réussis, **2 échecs**, 4 skipped. Avant toute autre
correction, identifier :
- lesquels des 2 tests échouent (nom exact, fichier, message d'erreur complet) ;
- si ce sont des régressions introduites par les correctifs M29 eux-mêmes (R-01/R-02/R-03) ou des
  tests préexistants devenus instables (flaky) ;
- pourquoi les 4 tests skipped le sont (comparer à la liste connue de v0.4/v0.5 — sandbox bwrap ?
  nouveaux skips introduits par M29 ?).

**Aucune autre correction de cette mission ne doit être créditée tant que la suite n'est pas
revenue à 0 échec** — un audit qui rejoue les tests doit retrouver un nombre cohérent avec ce que le
journal annonce, sans quoi la même incohérence de provenance que R-03 se reproduit sur les tests
eux-mêmes.

### 1.2 R-02 M29 partiellement fermée : le kill switch fichier ne se réarme pas

v0.5.2 confirme que le cancel-all déclenché par `.pallas/KILL` n'est évalué qu'**au démarrage**
(ou à la première détection), et que la séquence suivante n'est pas correctement gérée :
1. fichier `KILL` présent → cancel-all déclenché, `meta.kill_switch_cancelall_called = true` ;
2. fichier `KILL` retiré (l'opérateur lève l'urgence) ;
3. fichier `KILL` redéposé (nouvel incident) → **le cancel-all ne se redéclenche pas**, parce que
   le drapeau `cancelall_called` n'a pas été réinitialisé à l'étape 2, ou parce que la vérification
   ne s'exécute qu'une fois par process et pas à chaque cycle où le fichier est retrouvé présent
   après avoir été absent.

C'est exactement le scénario « retrait puis réengagement » que j'avais demandé de vérifier dans le
prompt v0.5.2 (§4.4). Le correctif doit traiter le drapeau `cancelall_called` comme un état à
réarmer sur une transition `false → true` du fichier (pas une seule fois pour la durée de vie du
process), avec un test qui rejoue explicitement : présent → retiré → redéposé → **second**
`cancelAllOrders()` réellement appelé.

### 1.3 R-01 M29 fonctionnellement fermée mais coûteuse et pas éprouvée en concurrence

v0.5.2 confirme que `reconcileAllUnresolved` tourne bien à chaque cycle avant le signal, sur tous
les marchés. Mais :
- le coût mesuré est de **2N à 3N lectures réseau par cycle** (N = nombre d'ordres non réglés),
  contre le comportement précédent qui ne faisait aucun appel hors signal ;
- aucun test ne rejoue plusieurs cycles concurrents (deux instances, ou un cycle qui chevauche le
  suivant si la latence réseau dépasse l'intervalle) pour vérifier l'absence de double
  traitement — point que j'avais également demandé de vérifier explicitement (prompt v0.5.2 §3.3)
  et que l'audit signale comme insuffisamment couvert.

Cette charge est directement pertinente pour F-11 : sur une campagne de 72h avec un intervalle de
cycle de 30s (`PALLAS_CAMPAIGN_INTERVAL_MS=30000`, voir `PLAN-M27-72h-2026-09-13.md`), un facteur
2-3x sur les appels réseau peut heurter les limites de débit de l'API Polymarket bien avant la fin
de la fenêtre.

### 1.4 Conséquence sur M27 (campagne 72h)

**Correction factuelle (vérifiée sur disque, remplace l'hypothèse initiale) :** le bundle
CT-2026-019 n'était pas figé sur v0.5 comme le laissait croire la justification textuelle du
`PLAN-M27-72h-2026-09-13.md` (qui cite « 301/301 tests », donc v0.5) — le superviseur artefact
`observation-campaign.mjs` était en réalité byte-identique au blob M29, et le manifest de
campagne enregistrait `git_commit: 64a94cb`. La campagne tournait donc bien sur du code post-M29.
La raison réelle de l'arrêt n'est pas un pin obsolète, mais les trois défauts ci-dessous, tous
confirmés sur disque :

1. **Suite TS non reproductible** : `npm test` au HEAD = 298 passed / 2 failed / 4 skipped, contre
   « 304 passed / 0 failed » annoncé — cf. §1.1.
2. **R-02 KILL partiel** : `enforceKillSwitch` n'est évalué qu'au démarrage, jamais en cycle, et
   `kill_switch_cancelall_called` n'est jamais réarmé — cf. §1.2.
3. **Reproductibilité du pin rompue** : le lanceur était figé depuis un worktree non propre
   (scripts `M*/…`), et le runtime réellement exécuté (`dist/`, binaire risk-engine) n'était **pas**
   figé du tout — seuls les fichiers `.mjs` du superviseur l'étaient. Un bundle qui ne fige pas son
   propre runtime compilé ne garantit pas de rejouer le même code d'une relance à l'autre, même si
   le commit source cité est correct.

**Actions déjà exécutées et validées** : arrêt propre par SIGTERM (checkpoint final re-signé et
vérifié), `campaign_complete reason=sigterm`, aucun process résiduel, marqueur ROLLBACK consigné ;
CT-2026-019 marqué INVALIDATED ; `PLAN-M27-72h` et la doc CT mis à jour rétroactivement.

**Condition bloquante ajoutée pour la relance** : le nouveau bundle CT ne doit pas se contenter de
citer un commit source correct — il doit figer et vérifier par hash **l'ensemble du runtime
exécuté** : `dist/` compilé et le binaire risk-engine, en plus des scripts `.mjs`, depuis un
worktree propre (`git status --porcelain` vide avant packaging). Ajouter une étape de vérification
qui échoue si un seul de ces artefacts diffère de ce que le commit produit réellement (rebuild à
blanc + comparaison de hash), pas seulement une citation de `git_commit` dans le manifest.

## 2. Objectif général

Fermer les trois écarts ci-dessus, produire une suite de tests réellement à 0 échec, puis
regénérer un bundle de campagne à jour — condition préalable, posée par v0.5.2, à toute nouvelle
tentative de campagne courte ou longue.

## 3. Objectifs détaillés

- Identifier et corriger (ou documenter comme flaky avec justification) les 2 tests en échec ;
  clarifier les 4 skips.
- Réarmer `meta.kill_switch_cancelall_called` sur transition retrait→redépôt du fichier `KILL`,
  avec test couvrant explicitement présent→retiré→redéposé→second cancel-all.
- Réduire ou justifier le facteur 2-3x d'appels réseau de `reconcileAllUnresolved` (ex. : ne
  requêter `getTrades` que pour les ordres dont l'âge dépasse la fenêtre de grâce, batcher les
  requêtes par marché, ou documenter explicitement pourquoi ce n'est pas réductible) et ajouter un
  test de cycles rapprochés/concurrents démontrant l'absence de double traitement.
- Regénérer le bundle CT pour M27 sur le commit corrigé, avec preuve (hash + résultat de suite) que
  ce nouveau bundle ne porte plus les trois écarts.

## 4. Protocole de validation

**Setup** : `npm test` et `cargo test` sur checkout propre, à chaque étape.

**Métriques à capter :**
1. Nombre exact de tests passés/échoués/skippés, comparé avant/après pour chaque correctif —
   jamais une valeur recopiée d'un journal précédent.
2. Test « toggle KILL » : présent → retiré → redéposé → nombre d'appels `cancelAllOrders`
   (attendu : 2, un par transition false→true).
3. Nombre d'appels réseau par cycle avant/après optimisation de `reconcileAllUnresolved`, avec N
   ordres non réglés fixé (ex. N=5) pour rendre la mesure comparable.
4. Test de cycles concurrents/rapprochés sans double traitement (deux exécutions simultanées ou
   chevauchement simulé).
5. Hash du commit qui clôt la mission, à reporter dans le nouveau bundle CT.

## 5. Procédure / Étapes

### Partie A — Suite de tests
- Isoler les 2 tests en échec, obtenir la stack trace complète, corriger la cause racine (pas un
  simple `skip`).

### Partie B — Kill switch
- Ajouter le test de transition avant de corriger (constat AVANT correctif), puis réarmer le
  drapeau sur `false→true`.

### Partie C — Réconciliation
- Mesurer le nombre d'appels réseau actuel par cycle avec instrumentation temporaire, décider d'une
  optimisation ou motiver l'absence d'optimisation, ajouter le test de concurrence.

### Partie D — Bundle CT
- Regénérer le bundle CT-2026-019 (ou équivalent) sur le commit final, avec le hash exact et le
  résultat de suite dans le manifeste du bundle.

## 6. Ce que l'agent doit faire
1. Ne pas déclarer la suite verte sans avoir rejoué `npm test` sur le commit final soi-même — pas
   de recopie d'un chiffre annoncé par une mission précédente (cf. l'incohérence 304 vs 298 déjà
   trouvée deux fois).
2. Traiter le réarmement du kill switch comme un bug de sécurité opérationnelle, pas un détail :
   documenter le comportement exact avant/après dans le journal de mission.
3. Ne pas relancer ou autoriser M27 sur l'ancien bundle — le signaler explicitement comme obsolète
   dans le journal de mission et pointer vers le nouveau bundle une fois prêt.

## 7. Critères de succès
- [ ] `npm test` : 0 échec, chiffre exact rapporté et cohérent avec une exécution réelle sur le
      commit final (pas recopié).
- [ ] Test de transition KILL (présent→retiré→redéposé) démontre 2 appels `cancelAllOrders`.
- [ ] Coût réseau de `reconcileAllUnresolved` mesuré, réduit ou explicitement justifié comme
      irréductible, avec test de concurrence ajouté.
- [ ] Nouveau bundle CT généré depuis un worktree propre, pointant vers le commit qui clôt cette
      mission, avec `dist/` et le binaire risk-engine figés et vérifiés par hash (pas seulement le
      superviseur `.mjs`), et preuve dans le journal que CT-2026-019 reste INVALIDATED.

## 8. Interdictions
- Ne pas fermer cette mission en se basant sur un chiffre de suite non rejoué directement.
- Ne pas laisser courir ou relancer une campagne d'observation (M27 ou toute future) sur le bundle
  actuel pendant que cette mission est ouverte.
- Ne pas considérer le réarmement du kill switch comme secondaire au coût réseau — les deux sont
  bloquants selon v0.5.2, mais le kill switch est un enjeu de sécurité opérationnelle et doit être
  traité avec la même priorité que R-03 dans M29.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M30-journal.md`, avec preuve avant/après pour les 3 points,
le hash de commit final, et une section explicite « État du bundle M27 » indiquant si l'ancien
bundle CT-2026-019 doit être régénéré et sous quel nouvel identifiant.
