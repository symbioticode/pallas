# MISSION — PALLAS-M19 — Custody des credentials : séparation, permissions, rotation

## 0. Métadonnées
Mission ID : PALLAS-M19
Date de création : 2026-09-10
Auteur / Agent : Claude (planification) — exécution par agent de code au choix
Projet : Pallas
Statut : ACTIF — 🟡 Moyenne avant tout capital réel, 🔴 Critique dès qu'une clé financée est
introduite (qualification reprise explicitement de `AUDIT-PALLAS-v0.3.md` §7)
Source de vérité : `AUDIT-PALLAS-v0.3.md` (F-09, section 7) + `AUDIT-PALLAS-v0.1.md` (PALLAS-M05,
déjà partiellement traitée) + `packages/core/src/credentials.ts` +
`packages/execution/src/polymarketSigner.ts`

## 1. Contexte

**Ce qui a été fait (PALLAS-M05) et reste valable :** chiffrement AES-256-GCM correct au repos,
zeroing honnête des Buffers dérivés temporaires, documentation qualifiée sur la limite structurelle
des `string` JS.

**Ce que révèle l'audit v0.3, au-delà du repos et de la mémoire immédiate :**
- Aucune intégration KMS/HSM/gestionnaire de secrets — la passphrase de chiffrement et les clés
  privées transitent par des variables d'environnement/fichiers locaux.
- **Les mêmes primitives permettent dérivation d'API key et signature du wallet dans le même
  process Node** — aucune séparation opérationnelle entre "ce qui signe des ordres" et "ce qui
  dérive des credentials API", donc une compromission du process expose les deux surfaces d'un
  coup.
- Aucune procédure de rotation ni de révocation testée.
- Aucune permission de fichier imposée explicitement sur les fichiers de secrets (vault chiffré,
  fichier d'environnement).

## 2. Objectif général

Réduire la surface de compromission en séparant ce qui peut raisonnablement l'être, imposer des
permissions de fichiers explicites, et documenter une procédure de rotation/révocation réellement
testée — sans viser une architecture de custody de niveau institutionnel disproportionnée pour ce
stade du projet (à documenter comme limite assumée).

## 3. Objectifs détaillés

- **Permissions de fichiers explicites** : tout fichier contenant un secret (vault chiffré,
  variable d'environnement stockée sur disque) doit être vérifié à `chmod 600` (ou équivalent) au
  chargement, avec rejet explicite si les permissions sont trop larges — cohérent avec la procédure
  déjà décrite dans `docs/PHASE-2.2-procedure.md` (`chmod 700`/`600`), mais actuellement non vérifié
  par le code lui-même, seulement documenté comme procédure manuelle.
- **Évaluer et documenter la séparation processus signature/API** : au minimum, documenter
  explicitement dans `docs/SECURITY.md` que cette séparation n'existe pas aujourd'hui et quel est le
  risque résiduel accepté ; si le budget le permet, isoler la dérivation de clé API et la signature
  d'ordres dans des fonctions clairement délimitées qui ne partagent pas plus d'état que nécessaire
  (préparant une séparation de process future sans nécessairement l'implémenter dans cette mission).
- **Procédure de rotation documentée et testée** : écrire et exécuter au moins une fois (sur des
  credentials de test, jamais réels) le scénario complet "révoquer l'ancienne clé API, dériver une
  nouvelle clé, re-chiffrer le vault avec une nouvelle passphrase" — documenter chaque étape dans
  `docs/SECURITY.md` avec le résultat de l'exécution réelle, pas seulement la procédure théorique.
- **Runbook "clé compromise"** : rédiger une procédure opérationnelle explicite (que faire
  immédiatement si une clé privée ou une passphrase est suspectée compromise) — cancel-all
  (dépend de PALLAS-M14), révocation API, rotation, vérification du ledger pour tout ordre suspect.

## 4. Protocole de validation

**Setup** : `npm test` vert (packages/core, packages/execution).

**Métriques à capter :**
1. Test qui vérifie le rejet explicite d'un fichier de secret avec des permissions trop larges.
2. Exécution réelle (sur credentials de test) du scénario de rotation complet, avec preuve
   (commandes + sorties) dans le journal.
3. Runbook "clé compromise" relu et validé comme exécutable (pas seulement rédigé en prose vague).

## 5. Procédure / Étapes

### Partie A — Préparation
- Relire `docs/PHASE-2.2-procedure.md` et `AUDIT-PALLAS-v0.3.md` §7 en entier.

### Partie B — Vérifications préalables
- Confirmer sur quel OS/environnement la vérification de permissions de fichier doit fonctionner
  (Linux/NixOS uniquement pour ce stade — documenter la limite si Windows n'est pas couvert).

### Partie C — Exécution
- Ajouter la vérification de permissions au chargement des fichiers de secrets.
- Documenter la séparation processus (ou son absence assumée).
- Exécuter et documenter le scénario de rotation sur credentials de test.
- Rédiger le runbook "clé compromise".

## 6. Ce que l'agent doit faire
1. Ne jamais tester la rotation ou la révocation avec des credentials réels/financés.
2. Documenter honnêtement toute limite non traitée dans cette mission (ex. pas de KMS) plutôt que de
   la complexifier excessivement pour un gain marginal, cohérent avec l'esprit déjà posé en
   PALLAS-M05.
3. Vérifier que le runbook "clé compromise" est réellement exécutable par quelqu'un d'autre que
   l'auteur du code (test de lisibilité).

## 7. Critères de succès
- [ ] Le chargement d'un fichier de secret avec des permissions trop larges est rejeté
      explicitement, testé (sur l'OS cible documenté).
- [ ] La séparation (ou son absence assumée) entre signature d'ordre et dérivation d'API key est
      documentée explicitement dans `docs/SECURITY.md`, avec le risque résiduel nommé.
- [ ] Le scénario de rotation complet a été exécuté au moins une fois sur des credentials de test,
      avec preuve dans le journal.
- [ ] Un runbook "clé compromise" existe, daté, et a été relu comme exécutable.
- [ ] Aucune régression sur les tests existants.

## 8. Interdictions
- Ne jamais utiliser de clés/fonds réels pour tester la rotation ou la révocation dans cette
  mission.
- Ne pas prétendre une séparation de process réelle si elle n'est que documentée comme limite
  assumée — être précis sur ce qui est fait vs ce qui reste une réserve.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M19-journal.md`, avec preuve d'exécution du scénario de
rotation.
Livrables : diffs `credentials.ts`/vérification de permissions, `docs/SECURITY.md` mis à jour,
nouveau runbook `docs/RUNBOOK-key-compromise.md`.
