# MISSION — PALLAS-M28 — Custody credentials : garde par défaut + rotation reproductible

## 0. Métadonnées
Mission ID : PALLAS-M28
Date de création : 2026-09-11
Auteur / Agent : Claude (planification) — exécution par Codex
Projet : Pallas
Statut : ACTIF — 🟡 Moyenne avant capital réel, 🔴 Critique dès qu'une clé financée est introduite
Dépend de : PALLAS-M21 (base verte)
Source de vérité : `AUDIT-PALLAS-v0.4.md` (F-09, section 6) + `docs/mission/mission-PALLAS-M19-journal.md`
+ `packages/execution/src/polymarketSecrets.ts`

## 1. Contexte

**Ce qui a été fait (PALLAS-M19) et reste vrai partiellement :** une garde de permissions de
fichier (`assertFilePermissions`, 0600) existe et est testée.

**Ce que révèle l'audit v0.4, qui nuance fortement l'acquis de M19 :**
- **La garde de permissions est optionnelle, pas obligatoire.** `loadPolymarketSecretsFromFile`
  applique bien la vérification, mais **aucun consommateur de production n'appelle cette fonction**
  — fait déjà reconnu explicitement par le journal de PALLAS-M19 lui-même
  (`mission-PALLAS-M19-journal.md:116`). Une garde qui existe mais que personne n'utilise n'apporte
  aucune protection réelle.
- **Secrets et wallet/API dans le même tas mémoire** — réserve déjà notée, toujours vraie,
  cohérente avec la limite déjà assumée en PALLAS-M05/M19.
- **La "rotation exécutée" documentée par PALLAS-M19 n'est pas reproductible.** L'audit constate que
  le seul script de démonstration vit hors dépôt (`/tmp/opencode/rotation-m19.mjs`), et que la
  révocation/dérivation côté plateforme y sont explicitement **simulées**, pas réellement exécutées
  contre un testnet CLOB. Aucune preuve externe de révocation réelle n'est disponible. Le crédit
  donné par l'audit se limite au re-chiffrement local de credentials de test — pas à une rotation
  CLOB réelle.

## 2. Objectif général

Faire de la garde de permissions un chemin réellement emprunté par tout code de production qui
charge des secrets (pas une fonction disponible mais ignorée), et produire une preuve de rotation
reproductible dans le dépôt, incluant si possible une interaction réelle avec le testnet CLOB
Polymarket plutôt qu'une simulation locale.

## 3. Objectifs détaillés

- Identifier tous les points d'entrée actuels ou prévus qui chargent des secrets Polymarket
  (aujourd'hui limités puisque l'orchestrateur tourne en dry-run sans vault chargé, mais à anticiper
  pour tout futur chemin live) et s'assurer qu'ils passent tous par
  `loadPolymarketSecretsFromFile` (ou une garde équivalente), pas par un chemin qui la contourne.
  Si aucun chemin de production n'existe encore pour charger des secrets réels, documenter
  explicitement cette absence plutôt que de la laisser implicite — et s'assurer qu'un futur ajout
  ne pourra pas l'oublier (ex. un test qui échoue si un nouveau point de chargement de secret est
  ajouté sans passer par la garde, via une revue de code automatisée simple ou une convention
  vérifiée).
- Rendre le script de rotation reproductible **dans le dépôt** (`scripts/` ou équivalent), pas dans
  un répertoire temporaire hors contrôle de version — avec des credentials de test générés à la
  volée, jamais de valeur réelle en dur.
- Si un testnet Polymarket CLOB est accessible, exécuter réellement au moins une dérivation de clé
  API et une révocation contre ce testnet (pas une simulation), et documenter le résultat exact
  (requêtes envoyées, réponses reçues). Si ce n'est pas possible dans le cadre de cette mission
  (accès testnet non disponible), documenter précisément cette limite plutôt que de répéter une
  simulation présentée comme une exécution réelle.
- Mettre à jour `docs/RUNBOOK-key-compromise.md` (PALLAS-M19) si la procédure réelle diverge de ce
  qui y était documenté suite à cette mission.

## 4. Protocole de validation

**Setup** : `npm test` vert (packages/core, packages/execution).

**Métriques à capter :**
1. Confirmation que tout chemin de chargement de secret identifié passe par la garde de
   permissions, avec preuve (grep + revue, pas seulement déclaration).
2. Script de rotation présent et exécutable dans le dépôt, avec sa sortie réelle capturée dans le
   journal.
3. Statut clair et honnête sur l'exécution réelle ou simulée contre un testnet CLOB.

## 5. Procédure / Étapes

### Partie A — Préparation
- Relire `mission-PALLAS-M19-journal.md` en entier pour comprendre précisément ce qui a été fait et
  ce qui a été simulé.
- Rechercher l'accès testnet Polymarket CLOB actuellement disponible (ou son absence).

### Partie B — Vérifications préalables
- Lister tous les points de chargement de secrets existants dans le code, confirmer lesquels
  passent par la garde et lesquels ne le font pas.

### Partie C — Exécution
- Committer le script de rotation dans le dépôt.
- Exécuter la rotation (réelle si testnet accessible, sinon documenter la limite précisément).
- Mettre à jour le runbook si nécessaire.

## 6. Ce que l'agent doit faire
1. Ne jamais présenter une simulation comme une exécution réelle, même partiellement — être aussi
   précis que l'audit l'a été en distinguant les deux dans son propre rapport.
2. Committer le script de rotation dans le dépôt, pas dans un répertoire temporaire qui disparaîtra
   avec la session.
3. Si le testnet n'est pas accessible, le documenter comme limite externe (pas comme un choix de
   scope) et proposer la procédure exacte pour qu'un opérateur avec accès puisse la reproduire.

## 7. Critères de succès
- [ ] Tout chemin de chargement de secret identifié dans le code passe par la garde de permissions,
      vérifié explicitement (pas seulement déclaré).
- [ ] Un script de rotation reproductible existe dans le dépôt versionné, avec credentials de test
      générés à la volée.
- [ ] Le statut réel vs simulé de la rotation contre un testnet CLOB est documenté sans ambiguïté
      dans le journal, avec preuve si réel.
- [ ] `docs/RUNBOOK-key-compromise.md` reste cohérent avec la procédure vérifiée par cette mission.
- [ ] Aucune régression sur les tests existants de PALLAS-M19.

## 8. Interdictions
- Ne jamais utiliser de clés/fonds réels, même sur testnet si le testnet manipule des identifiants
  personnels non jetables.
- Ne pas laisser le script de rotation hors du dépôt versionné.
- Ne pas répéter la présentation d'une simulation comme une preuve d'exécution réelle — c'est
  précisément l'écart que cet audit vient de relever.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M28-journal.md`, avec la sortie réelle du script de rotation
committé.
Livrables : `scripts/rotation-*.mjs` (ou équivalent) versionné, `docs/RUNBOOK-key-compromise.md`
mis à jour si nécessaire.
