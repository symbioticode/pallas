# PALLAS-M27 — Journal de mission — Campagne d'observation multi-jours

Mission : `docs/mission/mission-PALLAS-M27-campagne-observation.md`
Statut : **OUVERTE — NON CLÔTURÉE** (cible 72 h non atteinte ; voir §3)
Date d'exécution : 2026-09-12 (session) / campagne 2026-09-13
Agent : DeepSeek Harness (deepseek-flash) — branche `missions-M21-M28`

---

## 0. Nature de la mission

M27 n'est pas un correctif : c'est une observation CALENDAIRE. Son critère central — **72 h
continues** de dry-run contre des données réelles — ne peut pas être satisfait dans une session
interactive. Le travail réalisé ici livre le DISPOSITIF et une fenêtre partielle honnête ; il ne
clôt pas la mission.

## 1. Ce qui a été livré

- `scripts/observation-campaign.mjs` : superviseur de campagne (préflight dry-run, process
  long, métriques `metrics.jsonl`, incident SIGKILL contrôlé + relance, `summary.json`).
- `packages/strategy/src/run-reference-loop.ts` : variable `PALLAS_REF_CYCLE_SLEEP_MS` pour
  espacer les cycles (observation continue sans marteler l'API).
- `docs/OBSERVATION-M27-2026-09-13.md` : rapport d'observation factuel, destiné au prochain audit.
- `docs/observation/M27-2026-09-13/` : artefacts bruts conservés (manifest, 146 relevés,
  2 logs, ledger 283 entrées, résumé).

## 2. Ce qui a été observé (12 min, dry-run vérifié)

- **Préflight** : `getIsDryRun() === true` vérifié AVANT lancement, jamais désactivé ensuite.
- **93 cycles** exécutés, **1 redémarrage** après un `SIGKILL` provoqué à ~290 s ; reprise en
  ~2 s, ledger re-vérifié (M16) et poursuivi sans perte.
- **Ledger** : 0 → 283 entrées / 101 118 octets. **État durable** : 0 octet.
- **Mémoire** : RSS ~77–92 Mo après chauffe ; pas de conclusion (fenêtre trop courte).

## 3. Critères de succès — état honnête

| Critère | État |
|---|---|
| Campagne ≥ 72 h continues avec preuve horodatée | ❌ **NON atteint** (12 min) |
| Au moins un incident contrôlé + reprise documentée | ✅ (SIGKILL + relance, §2) |
| Rapport d'observation factuel | ✅ `docs/OBSERVATION-M27-2026-09-13.md` |
| Dry-run strictement actif, vérifié | ✅ (préflight) |

**M27 reste OUVERTE.** La campagne complète doit être relancée par un opérateur (§7 du rapport),
idéalement quand un marché actif avec carnet est disponible pour exercer aussi le chemin
décision/état.

## 4. Limites (détaillées dans le rapport)

- 72 h non atteintes ; aucune équivalence revendiquée.
- Aucun token actif trouvé (`/markets` → 0 actif, `/book` vide) → 93/93 `no_signal`, chemin
  décision/état non exercé.
- Ledger en mode dev (non signé) ; pas de clé publique configurée.
- Aucune coupure réseau réelle provoquée (seul un kill/restart).

## 5. Références

- Rapport : `docs/OBSERVATION-M27-2026-09-13.md`
- Artefacts : `docs/observation/M27-2026-09-13/`
- Harnais : `scripts/observation-campaign.mjs`