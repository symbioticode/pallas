# JOURNAL — PALLAS-M18 — Honnêteté statistique : taille réellement appliquée, Kelly illustratif

Statut : CLOTURÉE (2026-09-11)
Mission : `docs/mission/mission-PALLAS-M18-honnetete-statistique.md`
Dépôt : github.com/symbioticode/pallas

---

## Résumé

Deux propriétés critiques pour la crédibilité du pipeline de référence, sans impact financier
tant que le dry-run actif :

1. **Taille effective** : l'orchestrateur applique `min(notional demandé, suggested_size_usd)`,
   pas la taille brute du payload signé. Teste indépendamment du gate KELLY_LIMIT (M09) — défense
   en profondeur. Le ledger `execution_success` journalise `applied_size` + `demanded_size` pour
   traçabilité.

2. **Kelly illustratif** : `win_probability=price`, `odds=2.0` — valeurs FIXES, ILLUSTRATIVES,
   SANS calibration statistique. Commentaire au point exact de la définition + `console.warn`
   émis une seule fois à la première exécution (`warnKellyIllustrative`).

---

## Fichiers modifiés

| Fichier | Nature |
|---|---|
| `packages/strategy/src/run-reference-loop.ts` | `appliedOrderSize()` (exporté), `warnKellyIllustrative()`, commentaire illustratif, `execution_success` payload enrichi (`applied_size`/`demanded_size`), `attemptPlaceOrder(appliedSize)` |
| `packages/strategy/src/run-reference-loop.test.ts` | +2 tests : (1) `appliedOrderSize` unitaire (5 cas), (2) intégration `CapturingClient` — `suggested_size_usd:1`, signal price 0.5 size 10 → `captured.size === 2` |

---

## Validation

```
npm run build            → OK (tsc --build)
npm test                 → 258 passed (258) — 21 fichiers
```

Après M18 : +2 tests (248→250 puis 250→258 avec M19). Aucune régression.

---

## Critères de succès

- [x] Taille transmise au signataire = `min(signal.size, appliedOrderSize(price, size, suggested))`
      VÉRIFIÉ : test intégration `CapturingClient` + test unitaire `appliedOrderSize`.
- [x] Commentaire explicite + `warnKellyIllustrative()` au point exact de définition.
- [x] Aucune régression (`npm test`).

---

## Limites

- La taille réellement servie par l'exchange dépend de la liquidité au prix demandé (REMAINING).
  `appliedOrderSize` plafonne le payload envoyé, pas le fill réel — c'est une borne supérieure
  certaine, pas une promesse exacte (cohérent avec M17).
- Le comment `win_probability=price` est un raccourci : le vrai risque couvre latence, slippage,
  et stack-overflow du risk engine — seul `KELLY_LIMIT` (M09) agit comme garde-matérial.
