# MISSION — PALLAS-M18 — Honnêteté statistique : taille réellement appliquée, Kelly explicitement illustratif

## 0. Métadonnées
Mission ID : PALLAS-M18
Date de création : 2026-09-10
Auteur / Agent : Claude (planification) — exécution par agent de code au choix
Projet : Pallas
Statut : ACTIF — 🟡 Moyenne (cohérence interne, pas une vulnérabilité active grâce au gate M09)
Source de vérité : `AUDIT-PALLAS-v0.3.md` (F-08, section 5.2) + `packages/strategy/src/run-reference-loop.ts`
+ `docs/STRATEGY.md` (issu de PALLAS-M12)

## 1. Contexte

**Ce qui protège déjà, malgré le défaut ci-dessous :** le gate `KELLY_LIMIT` corrigé en
PALLAS-M09 rejette un ordre qui dépasse la taille Kelly suggérée — donc le défaut décrit ici n'est
pas exploitable pour dépasser une limite tant que M09 reste en vigueur.

**Ce que révèle l'audit v0.3, une incohérence de conception plutôt qu'une faille active :**

1. **`run-reference-loop.ts` transmet la taille du signal après autorisation, pas
   `decision.suggested_size_usd`** (`run-reference-loop.ts:209`). Le moteur de risque calcule une
   taille recommandée (Kelly fractionnaire × multiplicateur de régime de volatilité) mais
   l'orchestrateur ne l'utilise jamais réellement pour construire l'ordre — il se contente de
   vérifier que son propre signal passe sous le plafond. La propriété exigible ("notional transmis
   ≤ min(notional demandé, taille autorisée)") n'est vérifiée qu'indirectement par le gate, jamais
   appliquée positivement par l'orchestrateur.

2. **La stratégie de référence fournit `odds=2.0` constant et `win_probability=price`**
   (`run-reference-loop.ts:80`) au calcul Kelly. Ce couple peut produire une espérance positive
   artificielle sans aucune signification prédictive — cohérent avec le statut "non-prédictif"
   déjà déclaré dans `docs/STRATEGY.md` (PALLAS-M12), mais l'audit relève que rien dans le code lui-
   même ne rappelle, au point d'usage exact de ces valeurs, qu'elles sont illustratives.

## 2. Objectif général

Faire que l'orchestrateur applique réellement la taille suggérée par le risk engine (pas seulement
la vérifie), et marquer explicitement, au point d'usage, que les paramètres Kelly de la stratégie de
référence n'ont aucune valeur prédictive — pour qu'aucune confusion future ne soit possible même en
lisant seulement ce fichier.

## 3. Objectifs détaillés

- Modifier `run-reference-loop.ts` pour que la taille d'ordre effectivement transmise à la
  construction du payload signé soit `min(taille du signal, decision.suggested_size_usd)` — jamais
  la taille du signal brut, même quand elle passe le gate.
- Ajouter un test qui vérifie explicitement cette propriété : un signal qui demande plus que la
  taille suggérée doit être exécuté à la taille suggérée, pas à la taille demandée (dans le cas où
  le gate autorise malgré tout un écart, ce qui ne devrait plus arriver après M09, mais la propriété
  doit être vérifiée indépendamment du gate, en défense en profondeur).
- Ajouter un commentaire explicite et un avertissement de log au point exact où
  `win_probability=price` et `odds=2.0` sont fixés dans `ReferenceStrategy`, rappelant qu'aucune
  calibration statistique ne soutient ces valeurs (cohérent avec `docs/STRATEGY.md`, mais visible
  sans avoir à ouvrir un autre fichier).

## 4. Protocole de validation

**Setup** : `npm test` vert (packages/strategy) à chaque étape.

**Métriques à capter :**
1. Test avec un signal demandant plus que `suggested_size_usd` — la taille effectivement transmise
   au signataire d'ordre doit être la taille suggérée, vérifié par assertion directe sur le payload
   construit.

## 5. Procédure / Étapes

### Partie A — Préparation
- Relire `run-reference-loop.ts` en entier et `AUDIT-PALLAS-v0.3.md` §5.2 (paragraphe sur
  l'orchestrateur et Kelly).

### Partie B — Vérifications préalables
- Écrire le test de régression (signal > suggested_size_usd) avant de corriger.

### Partie C — Exécution
- Corriger le point de construction du payload pour utiliser `min(signal, suggested_size_usd)`.
- Ajouter les commentaires/avertissements au point d'usage des paramètres Kelly.

## 6. Ce que l'agent doit faire
1. Vérifier que cette correction reste cohérente avec le statut dry-run/non-prédictif déjà acté par
   PALLAS-M12 — ne pas donner l'impression, même par accident, que cette correction rend la
   stratégie de référence plus "sérieuse" ou prédictive.
2. Tester la propriété indépendamment du gate `KELLY_LIMIT`, en défense en profondeur.

## 7. Critères de succès
- [ ] La taille d'ordre effectivement construite et signée est `min(taille du signal,
      decision.suggested_size_usd)`, jamais la taille brute du signal, testé.
- [ ] Un commentaire et un avertissement de log explicites rappellent la nature non-calibrée de
      `win_probability`/`odds` au point exact de leur définition dans le code.
- [ ] Aucune régression sur les tests existants.

## 8. Interdictions
- Ne pas modifier `docs/STRATEGY.md` pour suggérer une quelconque amélioration de la valeur
  prédictive de la stratégie — cette mission ne change rien à ce statut, qui reste "référence,
  non-prédictif".
- Ne pas retirer le gate `KELLY_LIMIT` de PALLAS-M09 sous prétexte que cette mission ajoute une
  vérification côté orchestrateur — les deux couches restent complémentaires.

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M18-journal.md`.
Livrables : diff `run-reference-loop.ts`, test associé.
