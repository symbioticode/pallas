# MISSION — PALLAS-M12 — Stratégie de référence : intégration bout-en-bout du pipeline (dry-run)

## 0. Métadonnées
Mission ID : PALLAS-M12
Date de création : 2026-09-09
Auteur / Agent : Claude (planification) — exécution par agent de code au choix
Projet : Pallas
Statut : CLOTUREE — prealable a tout audit v0.3 portant sur l'axe "fidelite d'execution" de bout en bout (close le 2026-09-10)
Source de vérité : `AUDIT-PALLAS-v0.1.md` ("aucune intégration complète gateway → agent → risk →
execution n'existe"), `AUDIT-PALLAS-v0.2.md` (même constat, non résolu), `PLAN.md` Phase 3-4,
`FICHE-LECONS.md` (point 3, trade ledger avec hash SHA-256)

## 1. Contexte

**Constat des deux audits, non résolu depuis v0.1 :** tous les modules critiques existent en
isolation (risk engine, sandbox, credentials, client Polymarket, sanitizer) et sont bien testés
unitairement, mais **aucun flux réel ne les relie**. `packages/gateway`, `packages/agent` et
`packages/ledger` sont vides. Le sanitizer n'est branché sur aucun tool call réel. Le risk engine
n'a jamais reçu un trade issu d'une décision réelle, seulement des `TradeRequest` construits à la
main dans des tests. Aucun ordre n'a jamais traversé la chaîne complète.

**Pourquoi cette mission maintenant, avant l'audit v0.3 :** un audit qui évalue "la fidélité
d'exécution" ou "la gestion du risque" d'un système qui n'a jamais exécuté de bout en bout n'a rien
de concret à observer — il ne peut qu'énumérer des lacunes déjà connues. Faire circuler un ordre réel
(en dry-run) à travers agent → sanitizer → risk engine (avec état persistant) → execution → ledger
donne à l'audit v0.3 un flux réel à inspecter : latence, cohérence d'état, comportement en cas
d'échec à chaque étape, forme réelle du ledger.

**Distinction fondamentale à ne jamais perdre de vue dans cette mission — c'est le risque principal
identifié par Andrei :** il existe deux choses différentes qu'on appelle "stratégie" :
1. **Une stratégie de référence** (l'objet de cette mission) : une règle triviale, déterministe,
   sans aucune prétention de rentabilité, dont le seul but est de produire un signal d'achat/vente
   pour exercer le pipeline. Elle n'a **aucune valeur prédictive** et ne doit jamais être présentée
   comme telle.
2. **Une stratégie avec edge prétendu** : nécessite backtesting, validation statistique
   out-of-sample, données de marché réelles. **Hors scope de cette mission**, sujet distinct pour
   une mission future (ex. PALLAS-M13, recherche/backtesting), qui n'a de sens qu'une fois cette
   mission-ci terminée.

Toute confusion entre les deux dans le code, les commentaires, le README ou le ledger produit
exactement le type de dérive documenté dans `FICHE-LECONS.md` ("badges marketing déconnectés du
code") — à éviter absolument, y compris involontairement.

**Dépendances et non-dépendances explicites :**
- Ne dépend PAS de PALLAS-M08 (wire `taker` manquant) : en dry-run, `placeOrder` bloque avant
  d'atteindre la porte `assertSignatureSchemaValidated` (`polymarketClient.ts`), donc un payload
  signé peut être construit et testé pour la forme sans jamais être réellement soumis à l'API.
- Ne dépend PAS de PALLAS-M03/M07 (sandbox bwrap) : le pipeline de cette mission n'a besoin
  d'aucune exécution shell arbitraire.
- Dépend de PALLAS-M01/M09 (état du risk engine) pour la persistance de l'état entre appels — si
  ces missions ne sont pas closes, cette mission doit gérer la persistance d'état côté appelant de
  toute façon (c'est justement son rôle), donc peut avancer en parallèle sans bloquer.

## 2. Objectif général

Construire le chemin d'intégration minimal — pas un gateway ni un agent complets — qui fait
circuler un signal de trading déterministe et explicitement non-prédictif à travers sanitizer, risk
engine (avec état persistant réel), client d'exécution (dry-run strict) et un ledger d'audit
append-only, pour la première fois de bout en bout.

## 3. Objectifs détaillés

- **Package `@pallas/ledger` (nouveau)** : journal d'audit append-only, un enregistrement par
  décision/trade (timestamp, entrée considérée, décision du risk engine complète incluant
  `rejected_by`, résultat de l'exécution le cas échéant). Chaque enregistrement inclut un hash
  SHA-256 chaîné au précédent (`hash(n) = SHA256(hash(n-1) + contenu(n))`) pour détecter toute
  falsification a posteriori — reprend l'idée déjà validée dans `FICHE-LECONS.md` point 3, ancrage
  on-chain explicitement hors scope (piste future, pas à implémenter ici).
- **Stratégie de référence (`ReferenceStrategy`, dans `packages/agent` ou un nouveau
  `packages/strategy` selon ce qui structure le mieux le code)** : règle triviale et documentée
  comme telle en tête de fichier — par exemple : lire l'orderbook d'un marché Polymarket fixe (ou
  une liste courte de marchés), déclencher un signal BUY si le prix descend sous un seuil fixe
  configuré. **Aucun paramètre optimisé, aucune donnée historique utilisée, aucune affirmation de
  rentabilité nulle part** (code, commentaires, logs, README).
- **Orchestrateur minimal** (pas un serveur HTTP complet, pas de gateway Fastify — une fonction ou
  un petit script d'entrée `run-reference-loop.ts` suffit pour cette mission) qui :
  1. appelle la stratégie de référence pour obtenir un signal ;
  2. passe toute entrée textuelle externe (ex. contenu d'un marché) par `sanitizeInput`
     (`@pallas/core`) avant tout traitement, et logue les menaces détectées le cas échéant ;
  3. construit un `TradeRequest` à partir du signal et l'envoie à `@pallas/risk::validateTradeWithState`,
     en persistant l'état retourné (fichier local JSON ou équivalent simple — pas besoin d'une base
     de données pour cette mission, documenter ce choix comme limite temporaire) ;
  4. si la décision est `allowed: true`, appelle `@pallas/execution::PolymarketClient.placeOrder`
     en dry-run strict (aucune capacité live nouvelle introduite par cette mission) ;
  5. écrit un enregistrement complet dans le ledger à chaque étape significative, que le trade soit
     accepté, rejeté par un gate, ou en échec technique.
- **Documentation explicite du statut "référence"** : un fichier `docs/STRATEGY.md` (nouveau) qui
  déclare noir sur blanc que `ReferenceStrategy` sert uniquement à valider l'intégration technique,
  qu'aucune validation statistique n'a été faite, et que toute stratégie avec prétention de
  rentabilité doit faire l'objet d'un backtesting et d'une mission séparée avant d'être connectée à
  ce même orchestrateur.

## 4. Protocole de validation

**Setup** : `npm test` vert sur tous les packages, y compris le nouveau `@pallas/ledger`, à chaque
étape. Le dry-run reste actif pendant toute la mission — aucune tentative d'ordre live.

**Métriques à capter :**
1. Au moins un cycle complet observé de bout en bout : signal généré → sanitizer appelé → risk
   engine appelé avec état persistant → décision → (si acceptée) `placeOrder` bloqué en dry-run →
   ledger écrit à chaque étape.
2. Au moins un cycle où le risk engine **rejette** le trade (ex. en abaissant artificiellement une
   limite de configuration pour le test) — vérifier que le ledger enregistre bien le rejet et son
   motif, et qu'aucun appel à `placeOrder` n'est fait dans ce cas.
3. Vérification d'intégrité du ledger : modifier manuellement un enregistrement intermédiaire et
   confirmer que la vérification de la chaîne de hash détecte la falsification.
4. Persistance de l'état du risk engine vérifiée sur au moins 2 cycles successifs de
   l'orchestrateur (pas juste un appel isolé) — le circuit breaker doit accumuler un état réel
   entre deux exécutions du script, pas repartir de zéro à chaque fois.

## 5. Procédure / Étapes

### Partie A — Préparation
- Relire `packages/core/src/sanitizer.ts`, `packages/risk/src/client.ts`,
  `packages/execution/src/polymarketClient.ts` pour identifier les points d'intégration exacts.
- Relire `FICHE-LECONS.md` point 3 (ledger) et point 4 (calibration confiance/précision — hors
  scope immédiat mais à garder en tête pour la structure des enregistrements du ledger).

### Partie B — Vérifications préalables
- Confirmer que `validateTradeWithState` (déjà testé en PALLAS-M01) expose bien tout ce qui est
  nécessaire pour persister et réinjecter l'état entre deux appels du script.
- Écrire d'abord un test qui vérifie la détection de falsification du ledger (chaîne de hash cassée),
  avant d'implémenter le ledger — pour être sûr de tester la bonne propriété dès le départ.

### Partie C — Exécution
- Implémenter `@pallas/ledger`, la `ReferenceStrategy`, puis l'orchestrateur, dans cet ordre.
- Exécuter manuellement au moins 3 cycles de l'orchestrateur en conditions réelles (dry-run, mais
  avec un vrai appel à l'API Polymarket en lecture pour l'orderbook) pour observer le comportement
  réel avant d'écrire les tests automatisés correspondants.

## 6. Ce que l'agent doit faire
1. Écrire, dès le premier commit de code, le disclaimer "référence, non-prédictif" en tête de
   `ReferenceStrategy` et dans `docs/STRATEGY.md` — ne pas le remettre à plus tard.
2. Ne jamais introduire de mécanisme qui faciliterait le passage en mode live au-delà de ce qui
   existe déjà (pas de nouveau flag de contournement du dry-run, pas de nouvel appel qui pourrait
   accidentellement lever `signatureSchemaValidated`).
3. Vérifier à chaque étape que le ledger reste append-only et que la chaîne de hash est
   effectivement vérifiable, pas seulement générée.
4. Documenter explicitement la limite de persistance choisie (fichier JSON local, pas de base de
   données) comme un choix delibéré pour cette mission, pas un oubli.

## 7. Critères de succès
- [x] Un ordre (signal → sanitizer → risk engine avec état persistant → dry-run block → ledger)
      circule réellement de bout en bout, observé sur au moins 3 cycles.
- [x] Un scénario de rejet par le risk engine est observé et correctement enregistré dans le ledger,
      sans appel à `placeOrder`.
- [x] La persistance d'état du risk engine est vérifiée sur des appels successifs réels du script
      (pas seulement en test unitaire isolé).
- [x] Le ledger détecte une falsification manuelle d'un enregistrement intermédiaire (test dédié).
- [x] `docs/STRATEGY.md` déclare explicitement le statut non-prédictif de `ReferenceStrategy` et
      pose la condition (backtesting + mission séparée) pour toute stratégie future avec prétention
      de rentabilité.
- [x] Aucune ligne de code, commentaire, log ou documentation ne suggère, même implicitement, que
      `ReferenceStrategy` a une quelconque valeur prédictive.
- [x] Aucune capacité live nouvelle n'est introduite ; le dry-run reste le comportement par défaut
      et bloquant sur toute écriture, vérifié par test.
- [x] `npm test` vert sur l'ensemble du monorepo, y compris les nouveaux tests `@pallas/ledger`.

## 8. Interdictions
- Ne jamais présenter `ReferenceStrategy` comme ayant un edge, même à titre d'exemple ou de mode
  "démo" — le risque de confusion future (README, capture d'écran, communication externe) doit être
  traité comme réel dès maintenant.
- Ne pas construire un gateway HTTP complet, une UI WebChat, ou une intégration Claude API dans
  cette mission — ce sont des objets de Phase 3 distincts, hors scope ici. L'orchestrateur est un
  script minimal, pas un service.
- Ne pas lever `signatureSchemaValidated`, ni introduire un nouveau chemin de configuration qui
  permettrait de contourner le dry-run.
- Ne pas ignorer un rejet du risk engine ni retenter automatiquement un trade rejeté sans
  intervention explicite — le pipeline doit respecter la décision du risk engine à la lettre.
- Ne pas commencer une mission de backtesting/validation statistique dans le cadre de PALLAS-M12 —
  c'est explicitement hors scope, à traiter dans une mission séparée une fois celle-ci close.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M12-journal.md`, avec la sortie réelle d'au moins 3 cycles de
l'orchestrateur (logs + extraits du ledger), et la preuve de détection de falsification du ledger.
Livrables : `packages/ledger/` (nouveau), `ReferenceStrategy` + orchestrateur, `docs/STRATEGY.md`
(nouveau), section "Phase 3" de `PLAN.md` mise à jour pour refléter cette intégration partielle
(préciser explicitement que gateway HTTP/UI/agent Claude restent non commencés).
