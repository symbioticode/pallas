# MISSION — PALLAS-M03 — Sandbox bwrap : fix opérationnel + suppression du faux positif réseau

## 0. Métadonnées
Mission ID : PALLAS-M03
Date de création : 2026-09-09
Auteur / Agent : Claude (planification) — exécution par agent de code au choix
Projet : Pallas
Statut : ACTIF
Source de vérité : `AUDIT-PALLAS-v0.1.md` (section 2, "Sandbox bwrap") + `packages/execution/src/sandbox.ts`
+ `packages/execution/src/sandbox.test.ts`

## 1. Contexte

**Système :** `sandbox.ts::runSandboxed` exécute des binaires allowlistés sous `bwrap`
(`--unshare-net`, `--unshare-pid`, `--unshare-uts`, `--die-with-parent`, racine `/` montée en
lecture seule).

**Constat de l'audit — critique de crédibilité, pas seulement technique :**
Sur l'hôte testé, **toutes** les invocations `bwrap` échouent avant même de démarrer le programme
protégé : `bwrap: loopback: Failed to create NETLINK_ROUTE socket: Operation not permitted`. Deux
tests sur 7 échouent en conséquence (`sandbox.test.ts:24-47`, exécution réelle et stdin).

**Le vrai problème n'est pas seulement que ça échoue — c'est que le test réseau
(`reseau isole : impossible de joindre l'exterieur`) passe quand même**, parce qu'il vérifie
seulement `exitCode !== 0`, qui est vrai que l'isolation ait fonctionné ou que bwrap n'ait jamais pu
démarrer le processus. **C'est un faux positif de sécurité** : le test donne une fausse assurance
que l'isolation réseau fonctionne, alors qu'il ne prouve rien du tout dans cet état.

**Cause probable (à confirmer, pas supposer) :** `--unshare-net` avec la création d'une interface
loopback nécessite généralement soit `CAP_NET_ADMIN` dans le user namespace, soit que
`kernel.unprivileged_userns_clone` (ou équivalent NixOS) soit activé, soit une version de bwrap qui
gère différemment le netns non privilégié. Cela dépend de l'hôte — la mission doit distinguer
clairement "bug de code" de "contrainte d'hôte à documenter".

## 2. Objectif général

Rendre l'isolation réseau bwrap réellement vérifiable — soit en la faisant fonctionner sur l'hôte
cible, soit en documentant explicitement la limite d'hôte ET en réécrivant le test pour qu'il ne
puisse plus jamais donner un faux positif, quel que soit l'hôte.

## 3. Objectifs détaillés

- Diagnostiquer la cause exacte de l'échec bwrap sur l'hôte (permissions user namespace, sysctl
  NixOS, version bwrap) — documenter avec preuve (commande + sortie), pas par supposition.
- Si corrigeable (ex. sysctl, capacité, option bwrap manquante) : corriger et faire passer les 2
  tests actuellement rouges avec une vraie exécution sandboxée.
- Si non corrigeable sur cet hôte pour une raison structurelle documentée : le sandbox doit **échouer
  explicitement et bruyamment** (fail-closed) plutôt que silencieusement, et le test doit distinguer
  "bwrap a échoué à s'initialiser" de "le programme protégé n'a pas pu joindre le réseau" — ces deux
  cas ne doivent plus jamais être confondus par un test qui vérifie juste `exitCode !== 0`.
- Réécrire le test réseau pour qu'il fasse une distinction stricte : capturer stderr, vérifier que
  l'échec provient bien d'une tentative réseau bloquée (message applicatif du programme testé,
  ex. `URLError`/`ConnectionRefused` explicite côté Python) et non d'un échec de démarrage de bwrap
  lui-même (message `bwrap:` dans stderr → doit faire échouer le test, pas le faire passer).
- Durcir `resolveBinary` : vérifier que la cible résolue via PATH est un fichier régulier exécutable
  (pas seulement `existsSync`), pour éviter qu'un chemin détourné (lien symbolique vers un script
  arbitraire, par exemple) passe la vérification actuelle.
- Documenter dans le code et dans `docs/SECURITY.md` (voir PALLAS-M06) la portée réelle de la
  protection filesystem : root montée en lecture seule protège l'écriture, pas la confidentialité
  des fichiers lisibles par le processus sandboxé.

## 4. Protocole de validation

**Setup** : `npm test -- sandbox.test.ts` avant et après chaque changement.

**Métriques à capter :**
1. Sortie exacte de `bwrap --unshare-net --unshare-pid --unshare-uts /bin/true` en isolation, pour
   diagnostiquer la cause précise.
2. Nombre de tests sandbox verts (baseline : 5/7).
3. Preuve que le nouveau test réseau échoue bien si on le fait tourner contre un bwrap volontairement
   cassé (test négatif : simuler l'échec d'init pour vérifier que le test le détecte comme tel).

## 5. Procédure / Étapes

### Partie A — Préparation
- Lire `sandbox.ts` et `sandbox.test.ts` en entier, et la section correspondante de l'audit.
- Reproduire l'échec bwrap en isolation (hors du test vitest) pour capturer le message d'erreur exact.

### Partie B — Vérifications préalables
- Chercher la cause connue de `NETLINK_ROUTE socket: Operation not permitted` avec bwrap sur NixOS
  (recherche web si besoin — c'est un problème documenté dans l'écosystème bubblewrap/user
  namespaces, à vérifier plutôt que supposer).
- Vérifier `sysctl kernel.unprivileged_userns_clone` et les capacités du process courant.

### Partie C — Exécution
- Appliquer le correctif identifié en Partie B si possible.
- Réécrire le test réseau pour la distinction stricte décrite en section 3.
- Durcir `resolveBinary`.

## 6. Ce que l'agent doit faire
1. Diagnostiquer avant de corriger — ne pas appliquer un correctif générique trouvé en ligne sans
   avoir confirmé qu'il correspond à la cause réelle observée sur cet hôte.
2. Si la cause est une limite structurelle de l'hôte (pas corrigible sans droits root/sysadmin),
   le documenter explicitement plutôt que de contourner le test pour le faire passer artificiellement.
3. Réécrire le test réseau en priorité, même si le fix bwrap n'aboutit pas — c'est le point le plus
   important de cette mission (supprimer le faux positif est plus critique que faire passer bwrap).

## 7. Critères de succès
- [ ] La cause exacte de l'échec bwrap est diagnostiquée et documentée avec preuve (pas supposée).
- [ ] Soit : les 7 tests sandbox passent avec une isolation réseau réellement vérifiée ; soit :
      la limite d'hôte est documentée ET le sandbox échoue de façon fail-closed explicite (le
      process protégé ne démarre jamais si bwrap ne peut pas s'initialiser correctement).
- [ ] Le test réseau ne peut plus passer sur un simple échec d'initialisation de bwrap — vérifié par
      un test négatif qui simule cet échec et confirme que le test le détecte.
- [ ] `resolveBinary` vérifie que la cible est un fichier régulier exécutable, pas seulement
      `existsSync`.
- [ ] La portée réelle de la protection filesystem (lecture seule ≠ confidentialité) est documentée.

## 8. Interdictions
- Ne pas modifier le test réseau pour le faire passer sans avoir réglé la confusion
  "échec bwrap" vs "réseau bloqué" — ce serait reproduire le faux positif sous une autre forme.
- Ne pas cocher "Isolation reseau verifiee par test" dans `PLAN.md` sans le critère 3 ci-dessus vérifié.
- Ne pas assouplir l'allowlist de binaires dans le cadre de cette mission (hors périmètre).

## 9. Format attendu
Rapport de mission : `mission-PALLAS-M03-journal.md`, avec la sortie brute des commandes de
diagnostic.
Livrables : diffs `sandbox.ts`/`sandbox.test.ts`, section "Phase 1.3" de `PLAN.md` mise à jour.
