# MISSION — PALLAS-M24 — Ledger signé obligatoire par défaut

## 0. Métadonnées
Mission ID : PALLAS-M24
Date de création : 2026-09-11
Auteur / Agent : Claude (planification) — exécution par Codex
Projet : Pallas
Statut : ACTIF — 🟠 Haute
Dépend de : PALLAS-M21 (base verte)
Source de vérité : `AUDIT-PALLAS-v0.4.md` (F-05, section 4.3) + `packages/ledger/src/file-ledger.ts`

## 1. Contexte

**Ce qui fonctionne (confirmé par v0.4) :** quand une clé publique et un checkpoint Ed25519 sont
configurés, la falsification par recalcul complet de la chaîne (attaque réaliste : modifier un
montant puis recalculer tous les hashes avec la fonction exportée) est correctement détectée —
l'audit a testé cette attaque directement et confirme la détection.

**Le défaut, confirmé par test direct de l'audit :** **sans clé publique ni checkpoint configurés,
le ledger non signé est accepté sans réserve** (`file-ledger.ts:178`). L'audit a modifié un montant,
recalculé toute la chaîne, puis obtenu `UNSIGNED_FORGERY_ACCEPTED true` — la protection de
PALLAS-M16 n'est donc **pas une garantie par défaut, c'est une capacité optionnelle** qu'il faut
explicitement activer. Un déploiement qui oublierait de configurer la clé publique perdrait
silencieusement toute la protection contre la falsification, sans aucun signal d'alerte.

**Sous-défaut associé :** même avec un `.sig` présent mais sans clé publique configurée, seule la
cohérence de l'ancre (index/hash) est contrôlée — pas la signature cryptographique elle-même
(`file-ledger.ts:204`). Un attaquant qui a accès au fichier `.sig` peut donc potentiellement en
produire un cohérent sans avoir la clé privée, si le format n'exige pas la vérification
cryptographique par défaut.

## 2. Objectif général

Faire du mode signé le comportement par défaut et non contournable dans tout environnement destiné
à un usage réel (même paper trading), en réservant le mode non signé à un usage de développement
explicitement marqué comme tel.

## 3. Objectifs détaillés

- Introduire une distinction explicite entre mode "développement" (non signé accepté, avec un
  avertissement bruyant au démarrage et dans chaque snapshot de l'Observatory) et mode "run réel"
  (paper trading ou live), où l'absence de clé publique + checkpoint valide doit être **fatale au
  démarrage**, pas silencieusement acceptée.
- Le choix de mode ne doit pas être un oubli possible : soit une variable d'environnement dédiée et
  documentée comme obligatoire pour tout run non-dev (`PALLAS_LEDGER_MODE=dev|supervised`, ou
  équivalent), soit l'exigence de la clé publique devient le comportement par défaut partout, avec
  un flag explicite `--allow-unsigned-dev` à activer consciemment pour le développement local.
- Vérifier et corriger, si nécessaire, que la présence d'un `.sig` sans clé publique configurée
  n'accorde aucune confiance supplémentaire non justifiée (la cohérence d'ancre seule ne doit pas
  être confondue avec une preuve cryptographique dans les logs/l'Observatory).
- Évaluer à nouveau, même sommairement, un mécanisme d'ancrage distant simple (ex. publication
  périodique du hash de tête vers un service tiers en écriture seule, ou a minima un log
  syslog/webhook externe au process) — si le budget ne permet pas de l'implémenter dans cette
  mission, documenter précisément la limite plutôt que de la laisser telle quelle indéfiniment.

## 4. Protocole de validation

**Setup** : `npm test` vert (packages/ledger, packages/strategy) à chaque étape.

**Métriques à capter :**
1. Reproduire exactement le test de l'audit (falsification recalculée, mode non signé) — doit
   désormais être rejetée par défaut dans le mode "run réel", ou accompagnée d'un avertissement
   bruyant et non manqué en mode dev.
2. Test qui vérifie qu'un `.sig` incohérent avec l'ancre est rejeté même sans clé publique
   configurée (le contrôle d'ancre reste actif indépendamment du mode).
3. Test qui vérifie qu'un run configuré en mode "supervisé"/réel refuse de démarrer sans clé
   publique valide.

## 5. Procédure / Étapes

### Partie A — Préparation
- Relire `file-ledger.ts` en entier, en particulier `verifyHeadCheckpoint` et son appel depuis
  `load`.
- Relire `AUDIT-PALLAS-v0.4.md` §4.3 en entier, y compris le test de falsification qu'il a exécuté.

### Partie B — Vérifications préalables
- Reproduire l'attaque de l'audit pour confirmer `UNSIGNED_FORGERY_ACCEPTED` avant correction.

### Partie C — Exécution
- Introduire la distinction de mode.
- Rendre la clé publique obligatoire par défaut hors mode dev explicite.
- Documenter la limite sur l'ancrage distant si non implémenté.

## 6. Ce que l'agent doit faire
1. S'assurer que le mode dev reste utilisable pour ne pas bloquer le développement local quotidien
   — l'objectif est de fermer l'oubli en production/paper trading, pas de complexifier chaque test
   unitaire.
2. Documenter clairement dans `docs/SECURITY.md` la distinction des deux modes et leurs garanties
   respectives.
3. Ne pas prétendre avoir résolu l'ancrage distant si cette mission ne fait que documenter la
   limite — être précis sur ce qui est livré.

## 7. Critères de succès
- [ ] Le scénario exact de falsification testé par l'audit v0.4 est désormais rejeté par défaut en
      mode "run réel" (supervisé/live), testé.
- [ ] Un `.sig` incohérent avec l'ancre est rejeté indépendamment de la présence d'une clé publique.
- [ ] Le mode dev reste disponible mais explicite (variable d'environnement ou flag documenté), et
      produit un avertissement visible dans les logs et dans l'Observatory.
- [ ] Aucune régression sur les tests existants de PALLAS-M16.

## 8. Interdictions
- Ne pas laisser un chemin par défaut, dans un contexte qui n'est pas explicitement "développement
  local", où l'absence de clé publique passe silencieusement.
- Ne pas confondre cohérence d'ancre (index/hash) et preuve cryptographique dans la documentation ou
  les logs — être précis sur ce que chaque contrôle prouve réellement.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M24-journal.md`, avec preuve avant/après du test de
falsification de l'audit.
Livrables : diff `file-ledger.ts`, `docs/SECURITY.md` mis à jour avec la distinction de mode.
