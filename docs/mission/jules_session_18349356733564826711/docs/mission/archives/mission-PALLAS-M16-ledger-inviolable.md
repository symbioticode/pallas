# MISSION — PALLAS-M16 — Ledger d'audit : durabilité, verrouillage, vérification obligatoire, signature

## 0. Métadonnées
Mission ID : PALLAS-M16
Date de création : 2026-09-10
Auteur / Agent : Claude (planification) — exécution par agent de code au choix
Projet : Pallas
Statut : CLOTUREE — ✅ Clôturée 2026-09-11
Dépend de : PALLAS-M13 (mécanismes de lock/fsync déjà construits, à réutiliser ici)
Source de vérité : `AUDIT-PALLAS-v0.3.md` (F-05, section 6) + `packages/ledger/src/ledger.ts` +
`packages/ledger/src/file-ledger.ts`
Rapport : `mission-PALLAS-M16-journal.md`

## 1. Contexte

**Ce qui a été fait (PALLAS-M12) et fonctionne comme détection d'erreur accidentelle :** chaînage
`SHA256(prev_hash + contenu canonique)`, contrôle d'index/lien/hash, tests qui détectent la
modification d'un maillon, écriture en temp+rename.

**Ce que révèle l'audit v0.3, non couvert par M12 :**
- **Pas un journal inviolable** : un attaquant ayant accès au fichier peut modifier/supprimer/
  réordonner puis **recalculer tous les hashes avec la fonction exportée elle-même**. Aucun
  HMAC/signature avec une clé séparée du process qui écrit, aucun ancrage distant/WORM.
- **`FileLedger.load` transforme un fichier absent ou un JSON invalide en ledger vide, sans
  alerte** (`file-ledger.ts:26`) — même défaut de "réinitialisation silencieuse" que celui corrigé
  pour l'état risk par PALLAS-M13, mais pas encore corrigé ici pour le ledger.
- **Aucune vérification automatique de la chaîne au chargement** — la détection de falsification
  n'est testée qu'explicitement en test, jamais exécutée par défaut à l'ouverture du fichier en
  conditions réelles.
- **Nom temporaire fixe `.tmp`, pas de lock, réécriture complète du fichier** — appels concurrents
  sujets à perte/écrasement, `rename` non accompagné de `fsync` fichier + répertoire.
- **Événements d'exécution insuffisamment riches** : `orderId` présent en cas de succès, mais pas
  systématiquement de correlation ID, hash d'intention, digest signé, salt, réponse brute, statut
  HTTP, numéro de tentative, timestamps début/fin, position avant/après, ou identifiant de
  trade/fill (`run-reference-loop.ts:221`).

## 2. Objectif général

Transformer le ledger d'un détecteur d'erreur accidentelle en un journal transactionnel réellement
difficile à falsifier silencieusement, avec vérification systématique et un schéma d'événement
suffisant pour reconstruire chaque ordre et fill après incident.

## 3. Objectifs détaillés

- **Réutiliser le mécanisme de lock/fsync/rename atomique construit en PALLAS-M13** pour l'écriture
  du ledger (nom temporaire unique, pas `.tmp` fixe ; `fsync` fichier + répertoire ; verrou
  interprocessus).
- **Vérification obligatoire de la chaîne au chargement** : `FileLedger.load` doit parcourir toute
  la chaîne et vérifier chaque hash avant de considérer le ledger comme utilisable. Toute rupture
  détectée doit être fatale (le système refuse de démarrer), jamais silencieuse.
- **Distinguer explicitement "fichier absent au tout premier démarrage" de "fichier présent mais
  invalide/tronqué"** — même logique fail-stop que PALLAS-M13 pour l'état risk, appliquée ici au
  ledger.
- **Signature HMAC ou asymétrique avec une clé séparée** du process qui écrit couramment le ledger
  (idéalement une clé qui n'a pas besoin d'être en mémoire pendant le fonctionnement normal, utilisée
  uniquement pour signer périodiquement un résumé/checkpoint de la chaîne) — objectif : qu'un
  attaquant avec accès seul au fichier et au process ne puisse pas produire une chaîne falsifiée qui
  passe la vérification sans avoir aussi compromis cette clé séparée.
- **Ancrage distant optionnel** (piste, pas obligatoire pour cette mission) : évaluer un mécanisme
  simple d'export périodique d'un résumé de chaîne vers un stockage distant en écriture seule —
  documenter comme limite si non implémenté dans le budget de cette mission.
- **Enrichir le schéma d'événement** : ajouter correlation ID (cohérent avec PALLAS-M13/M14), hash
  de l'intention déclarée, digest signé, statut HTTP brut, numéro de tentative, timestamps
  début/fin, position avant/après si disponible (dépend de PALLAS-M15).

## 4. Protocole de validation

**Setup** : `npm test` vert (packages/ledger) à chaque étape.

**Métriques à capter :**
1. Test qui modifie un maillon intermédiaire ET recalcule la chaîne avec la fonction de hash
   exportée elle-même (scénario d'attaque réaliste) — la vérification par signature séparée doit
   quand même détecter la falsification.
2. Test qui charge un fichier ledger absent (premier démarrage légitime) vs un fichier tronqué —
   comportements distincts vérifiés.
3. Test de concurrence sur l'écriture du ledger (même protocole que PALLAS-M13).

## 5. Procédure / Étapes

### Partie A — Préparation
- Lire `ledger.ts`/`file-ledger.ts` en entier et `AUDIT-PALLAS-v0.3.md` §6.
- Vérifier ce qui a été construit en PALLAS-M13 pour le lock/fsync et l'appliquer ici plutôt que
  réinventer un second mécanisme.

### Partie B — Vérifications préalables
- Reproduire l'attaque "modifier + recalculer avec la fonction exportée" pour confirmer qu'elle
  fonctionne actuellement, avant correction.

### Partie C — Exécution
- Ajouter le lock/fsync/rename réutilisé de M13.
- Ajouter la vérification obligatoire au chargement avec fail-stop.
- Ajouter la signature séparée.
- Enrichir le schéma d'événement.

## 6. Ce que l'agent doit faire
1. Réutiliser l'infrastructure de PALLAS-M13 plutôt que dupliquer un second mécanisme de
   verrouillage/fsync différent.
2. Vérifier explicitement que la clé de signature séparée n'est pas simplement un second secret
   stocké au même endroit que tout le reste (sinon la séparation n'a aucune valeur) — documenter où
   et comment elle est gérée différemment.
3. Ne pas casser la compatibilité avec les ledgers déjà produits par PALLAS-M12 sans un plan de
   migration explicite (même si c'est un seul champ ajouté au schéma).

## 7. Critères de succès
- [x] Une falsification qui recalcule la chaîne avec la fonction de hash exportée est quand même
      détectée grâce à la vérification par signature séparée, testé.
- [x] Le chargement du ledger vérifie systématiquement toute la chaîne, avec arrêt fatal explicite
      sur toute rupture — testé, distinct du cas "premier démarrage légitime".
- [x] L'écriture du ledger utilise le même mécanisme de lock/fsync/rename atomique que
      PALLAS-M13, testé en situation de concurrence.
- [x] Le schéma d'événement inclut correlation ID, statut HTTP, tentative, timestamps début/fin, au
      minimum.
- [x] Aucune régression sur les tests existants du ledger (PALLAS-M12).

## 8. Interdictions
- Ne pas considérer le chaînage SHA-256 seul comme suffisant pour clore cette mission — c'est déjà
  fait depuis M12, l'audit v0.3 dit explicitement que ce n'est pas assez.
- Ne pas stocker la clé de signature séparée au même endroit et avec la même protection que les
  autres secrets du projet sans le justifier explicitement.
- Ne pas dupliquer un second mécanisme de lock/fsync différent de celui de PALLAS-M13 sans
  justification.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M16-journal.md`.
Livrables : diffs `packages/ledger/*`, tests, documentation du mécanisme de signature séparée dans
`docs/SECURITY.md`.
