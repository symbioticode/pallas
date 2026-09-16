# MISSION — PALLAS-M36 (relance) — Revue externe Jules, avec garde-fou de ref obligatoire

## 0. Métadonnées
Mission ID : PALLAS-M36 (relance — la tentative précédente est invalidée, voir §1)
Date de création : 2026-09-16
Auteur / Agent : Claude — exécution par Jules (Google)
Projet : Pallas
Statut : ACTIF
Réf. confirmée : tag `pallas-mvp-freeze-1` → commit `e69d7542f79ff3e6a24df60773147a6a2f400986`
(déréférencement vérifié par `git ls-remote origin 'refs/tags/pallas-mvp-freeze-1^{}'`)

## 1. Contexte

La première tentative (`mission-PALLAS-M36-jules-review-1.md`) est **invalidée en totalité**, pas
corrigée. Preuve : Jules a lui-même fourni `git rev-parse HEAD` = `22e2c53075ba8e3bb6a89c59db773f5521360087`
— le commit M20, celui d'`origin/main` — jamais le tag `pallas-mvp-freeze-1`. Tout ce que le
rapport affirmait avoir observé sur l'Observatory v0.2.0, `docs/mvp/`, ou les correctifs M21-M34
a donc été produit sans lecture réelle du contenu correspondant, puisque rien de tout cela
n'existe sur `main`. La cause n'était pas une négligence de Jules mais une ambiguïté du prompt
précédent : donner une URL de dépôt ne garantit pas quel ref est checkouté par défaut.

**Cette relance corrige uniquement ce point.** Le mandat de fond (§3 de la version originale)
reste inchangé.

## 2. Objectif général

Obtenir le même rapport de revue externe que la tentative précédente visait, mais avec une
vérification de ref **imposée en préalable et bloquante** — aucune observation de contenu avant
confirmation du bon commit.

## 3. Prompt à donner à Jules (remplace intégralement le précédent)

> Tu es un relecteur externe découvrant ce dépôt pour la première fois, sans connaissance
> préalable du projet.
>
> **Étape 0 — obligatoire, avant toute autre action :**
> ```
> git clone <URL_DU_DEPOT> pallas-review
> cd pallas-review
> git checkout pallas-mvp-freeze-1
> git rev-parse HEAD
> ```
> Colle la sortie exacte de `git rev-parse HEAD` dans ton rapport, en tout premier point, avant
> toute autre phrase. Le résultat attendu est `e69d7542f79ff3e6a24df60773147a6a2f400986`.
>
> **Si le SHA ne correspond pas exactement** : arrête-toi immédiatement, signale l'écart dans ton
> rapport, et ne produis aucune observation de contenu — un rapport basé sur le mauvais commit n'a
> aucune valeur, mieux vaut le dire clairement que de continuer.
>
> **Si le SHA correspond** : poursuis avec le mandat suivant, en te basant exclusivement sur le
> contenu de `pallas-review` tel que checkouté à l'étape 0 :
>
> 1. **Lisibilité** : en lisant le README et la documentation de premier niveau, comprends-tu en
>    quelques minutes ce que fait ce projet, ce qu'il ne fait pas, et à qui il s'adresse ? Qu'est-ce
>    qui aide, qu'est-ce qui manque ou qui prête à confusion ?
> 2. **Compréhension architecturale** : l'organisation du code et sa documentation permettent-elles
>    de se faire une idée correcte de l'architecture (composants, flux de données, frontières) sans
>    devoir lire tout le code source ?
> 3. **UI (Pallas Observatory)** : les instructions de lancement sont-elles suffisantes pour
>    démarrer l'interface et comprendre ce qu'elle affiche ? Si tu peux l'exécuter, fais-le et
>    commente ce que tu observes ; sinon, évalue la clarté des instructions et des descriptions
>    fournies. Précise explicitement si tu as réellement exécuté quelque chose ou si tu évalues
>    seulement la documentation.
> 4. **Exécutabilité** : en suivant strictement les instructions du dépôt (installation, build,
>    tests), arrives-tu à un état fonctionnel ? Colle les commandes exactes que tu as lancées et
>    leur sortie brute — pas un résumé. Note toute étape manquante, ambiguë, ou qui échoue.
> 5. **Rigueur perçue** : indépendamment de toute comparaison externe, qu'est-ce qui, dans ce que tu
>    observes (tests, CI, documentation d'audit, structure des garanties de sécurité), te donne
>    confiance ou au contraire t'interroge sur la rigueur du projet ? Réponds à partir de ce que tu
>    vois réellement dans ce checkout, sans présupposer de comparaison avec un autre projet.
> 6. **Autres critères pertinents** que tu jugerais utile de signaler, à ta discrétion.
>
> Pour chaque affirmation factuelle sur le contenu du dépôt (« le fichier X existe », « la version
> affichée est Y »), cite le chemin exact du fichier ou la commande qui te l'a montré. Une
> affirmation non sourcée à une commande ou un chemin de fichier ne sera pas retenue.
>
> Termine par une liste **nécessaire et suffisante** de ce qui manque pour qu'un nouvel arrivant
> (développeur ou évaluateur technique) comprenne et puisse faire tourner ce projet sans
> assistance — pas une liste exhaustive d'améliorations possibles. Distingue explicitement ce qui
> bloque la compréhension/l'exécution de ce qui serait simplement un plus cosmétique.

## 4. Protocole de validation

**Avant d'accepter le rapport** :
1. Vérifier que la toute première ligne du rapport contient `git rev-parse HEAD` et sa sortie,
   et que cette sortie est exactement `e69d7542f79ff3e6a24df60773147a6a2f400986`.
2. Si absent ou incorrect : rejeter le rapport sans lecture du reste, redemander l'étape 0 seule.
3. Si présent et correct : vérifier que chaque affirmation factuelle cite un chemin de fichier ou
   une commande — rejeter/faire corriger toute section qui n'en cite pas.

## 5. Ce que l'agent doit faire
1. Ne pas lire au-delà du premier paragraphe si le SHA n'y figure pas ou ne correspond pas — pas
   de bénéfice du doute cette fois.
2. Exiger des citations (chemin de fichier ou commande) pour chaque affirmation, pas des
   généralités plausibles.
3. Consigner le rapport final tel quel dans `docs/mission/mission-PALLAS-M36-jules-review-2.md`,
   avec mention explicite que la tentative 1 est invalidée et pourquoi (lien vers ce document).

## 6. Critères de succès
- [ ] Le rapport ouvre sur `git rev-parse HEAD` = `e69d7542f79ff3e6a24df60773147a6a2f400986`,
      collé littéralement.
- [ ] Chaque affirmation factuelle sur le contenu du dépôt est sourcée à un chemin ou une commande.
- [ ] Les 6 axes sont couverts, avec la liste finale nécessaire/suffisant séparée du cosmétique.

## 7. Interdictions
- Ne pas accepter un rapport qui ne prouve pas son point de départ en premier lieu.
- Ne pas donner à Jules le narratif interne CloddsBot ou les journaux de mission comme grille de
  lecture — toujours un regard neuf, cf. mission originale §1.2.
- Ne pas transformer cette mission en rédaction de documentation — diagnostic seulement.

## 8. Format attendu
`docs/mission/mission-PALLAS-M36-jules-review-2.md`, précédé d'une note indiquant que la version 1
est invalidée (mauvais commit, jamais checkouté sur le tag) et n'a pas été utilisée comme source.
