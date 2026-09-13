# Prompt d'audit indépendant — AUDIT-PALLAS-v0.6

Tu es un auditeur technique indépendant de Pallas. Applique la même discipline que v0.3 à v0.5.2 :
dynamique > code > documentaire > non vérifiable. Rejouer, ne jamais recopier un chiffre de
journal.

## 0. Cadrage explicite — lis ceci avant de commencer

**L'objectif du projet n'a jamais été un score de 5/5.** Le seuil de décision recherché est :
**4/5 de moyenne, avec un GO explicite pour une campagne de paper trading supervisée.** Un GO
capital réel n'est pas visé à ce stade. Ne conclus donc pas à un NO-GO global simplement parce que
des réserves subsistent sur le capital réel (F-11, attribution heuristique des fills, etc.) — ces
réserves sont **attendues** et documentées comme telles depuis v0.5. Ta décision doit distinguer
clairement les trois familles de verdict (capital réel / paper trading supervisé / campagne
courte), exactement comme v0.4 et v0.5, mais évalue en priorité si le seuil **paper trading** est
atteint.

**Cible de cet audit : le tag annoté `pallas-mvp-freeze-1`, ciblant le commit
`e69d7542f79ff3e6a24df60773147a6a2f400986`**, produit par PALLAS-M31. Résous le tag toi-même
(`git rev-parse 'pallas-mvp-freeze-1^{commit}'`) plutôt que de faire confiance au hash annoncé ici.
**Vérifie d'abord que ce gel est réel** : le tag pointe-t-il vers un commit avec une suite de tests
effectivement verte au moment de ton propre rejeu (pas seulement au moment du gel) ?

## 1. Vérification obligatoire n°1 — le pin est-il maintenant complet ?

v0.5.2 puis la revue de M30 ont relevé que le bundle CT ne vérifiait par hash que 2 artefacts sur
8 déclarés dans `bundle-manifest.json` (les scripts `.mjs`, mais pas `dist/` ni le binaire
risk-engine). PALLAS-M31 devait fermer ce point.

1. Lire `execute.sh` et `dry-run.sh` du bundle CT actuel : les 8 artefacts sont-ils désormais
   vérifiés par hash (pas seulement par présence) ?
2. Rejouer un test positif (hash correct → accepté) et un test négatif (un octet modifié dans un
   fichier `dist/` ou le binaire risk-engine → rejet explicite) — si ce test n'existe pas dans le
   dépôt, l'exécuter toi-même manuellement et documenter le résultat.
3. Conclure explicitement : pin complet, partiel, ou toujours absent sur certains artefacts.

## 2. Vérification obligatoire n°2 — provenance du second commit cité par M30

M30 a rapporté un commit `15722989704315a5b023a952a54c79f2d1052022` en plus du commit de
correctifs `8ffc8aa5...`, sans que ce second hash apparaisse dans les documents versionnés
disponibles au moment de la revue. Vérifier avec `git cat-file -t` / `git log` ce que ce commit
contient réellement, et si PALLAS-M31 en a confirmé ou infirmé la provenance.

## 3. Vérification obligatoire n°3 — rejeu complet de la suite sur le commit figé

- `npm test`, `cargo test --all-targets`, `cargo clippy --all-targets --all-features -- -D
  warnings` sur le commit exact du tag de gel — chiffres exacts, pas recopiés.
- Si un écart apparaît par rapport aux 304/0/4 et 65/0 annoncés par M30, le documenter précisément
  (c'est le troisième audit consécutif où un tel écart a été trouvé — considérer cela comme un
  signal sur la fiabilité de la chaîne de reporting elle-même, pas seulement sur le code).

## 4. Reprendre les axes habituels, mais avec le cadrage du §0

Grille inchangée : **Fidélité d'exécution / Gestion des risques / Viabilité opérationnelle.**
Reprendre le format des audits précédents (méthode, résultats d'exécution, score comparatif avec
toutes les versions précédentes, risques financiers restants, constats résiduels).

Pour chaque axe, distingue explicitement ce qui bloque un GO **capital réel** de ce qui bloque un
GO **paper trading supervisé** — ce ne sont pas les mêmes barres. Par exemple, l'attribution
heuristique des fills (v0.5 R-02) et la re-signature manuelle du ledger (v0.5 R-03) sont des
réserves acceptables pour du paper trading, mais pas pour du capital réel — dis-le explicitement
plutôt que de les traiter comme des blocages uniformes.

## 5. Statut de F-11

F-11 (observation ≥72h) reste la seule contrainte structurelle de calendrier. Confirmer qu'aucune
campagne réelle n'a encore eu lieu, et — point important pour le cadrage §0 — évaluer si F-11 est
une condition du GO **paper trading** ou seulement du GO **capital réel**. Si le paper trading peut
raisonnablement démarrer avant la fin d'une observation de 72h (puisque le paper trading n'engage
pas de capital), le dire explicitement plutôt que de bloquer par défaut sur ce point.

## 6. Décision attendue

Verdict à trois niveaux, comme v0.4/v0.5/v0.5.2, avec la question explicite : **le seuil de 4/5 et
un GO paper trading supervisé sont-ils atteints sur ce commit figé ?** Si oui, le dire clairement
sans minimiser par une comparaison implicite à un seuil de 5/5 qui n'a jamais été l'objectif. Si
non, lister précisément et de façon actionnable ce qui manque pour l'atteindre — pas une liste
générique de réserves déjà connues et acceptées.

## 7. Interdictions

- Ne pas calibrer le verdict sur un objectif de 5/5 implicite — le seuil demandé est 4/5 + GO
  paper trading.
- Ne pas créditer une correction sur la seule base d'un journal de mission non rejoué.
- Ne pas fusionner les réserves « capital réel » et « paper trading » dans un même NO-GO global
  sans les distinguer.

## 8. Format attendu

Livrable : `AUDIT-PALLAS-v0.6.md`, même structure que v0.5.2, avec une section explicite
« Seuil paper trading : atteint / non atteint » en tête de conclusion, avant la décision détaillée
par niveau.
