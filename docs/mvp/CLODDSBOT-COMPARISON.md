# Pallas et CloddsBot : comparaison ciblée des choix de sécurité

Cette comparaison n'est ni un nouvel audit de CloddsBot, ni un classement général. Elle reprend
exclusivement les constats datés du 2026-09-09 dans
[`ANALYSE-CLODDSBOT.md`](../../ANALYSE-CLODDSBOT.md) et les principes de
[`FICHE-LECONS.md`](../../FICHE-LECONS.md). Aucun dépôt public n'a été relu pour ce document.

CloddsBot y est décrit comme un projet vaste et substantiel, construit rapidement puis maintenu :
nombreux marchés, exchanges, canaux et skills. Pallas assume le compromis opposé : **un seul marché
(Polymarket), une seule boucle de référence non prédictive, dry-run/paper et davantage de preuves
fail-closed**. Cette concentration ne démontre aucune supériorité générale ; elle réduit ce qui doit
être prouvé avant d'élargir le périmètre.

## Matrice de correspondance

Les statuts portent sur Pallas : **traité** signifie qu'un audit confirme la fermeture au niveau
indiqué ; **partiel** conserve une limite explicite ; **absence** signifie que Pallas n'offre pas la
capacité correspondante et ne prétend donc pas avoir résolu le sujet.

| # | Constat interne sur CloddsBot | Traitement actuel dans Pallas | Statut et preuve Pallas |
|---:|---|---|---|
| 1 | Le dry-run est faux par défaut dans plusieurs exchanges, la gateway et l'arbitrage ([Analyse §4.1/4.3](../../ANALYSE-CLODDSBOT.md#43-dry-run--est-ce-le-défaut-partout-), [Leçon 6](../../FICHE-LECONS.md#6-dry-run-par-défaut)). | Un flag global est vrai par défaut ; la voie normale exige `LIVE`, et l'injection du client est test-only. | **Traité pour le chemin standard**, pas une autorisation live : [M17](../mission/archives/mission-PALLAS-M17-journal.md), [audit v0.4 §4.3](../AUDIT-PALLAS-v0.4.md#43-m16-m17-et-m18), audit v0.6 §§1, 10. |
| 2 | Un handler agent conserve `execSync(... shell:'/bin/bash')` et `start_bot` passe par `bash -c`; `eval` reste activable ([Analyse §2.2](../../ANALYSE-CLODDSBOT.md#22-vulnérabilités-évidentes), [Leçon 8](../../FICHE-LECONS.md#8-sandboxing-de-lexécution-shellpython)). | Le sandbox Pallas utilise une allowlist, `spawn` sans shell et bwrap ; un échec d'initialisation bloque l'exécution. Pallas n'a toutefois pas d'agent privilégié implémenté. | **Partiel** : sandbox audité, mais preuve réseau dépendante de l'hôte et `/` lisible : [M03](../mission/archives/mission-PALLAS-M03-journal.md), [M07](../mission/archives/mission-PALLAS-M07-journal.md), [audit v0.2 §2.2](../AUDIT-PALLAS-v0.2.md#22-sandbox-bwrap--fail-closed-amélioré-disponibilité-et-preuve-hôte-non-acquises). |
| 3 | Le sanitizer d'entrée est identifié comme une bonne idée réutilisable ([Analyse §5](../../ANALYSE-CLODDSBOT.md#5-conclusion), [Leçon 2](../../FICHE-LECONS.md#2-sanitizer-dentrée-contre-le-prompt-injection)). | Le chemin de référence sanitize le texte externe et journalise menace et transformation. Sans gateway/agent LLM, son efficacité dans un chemin privilégié n'est pas démontrable. | **Partiel** : [M12](../mission/archives/mission-PALLAS-M12-journal.md), [audit v0.3 §4.1](../AUDIT-PALLAS-v0.3.md#41-flux-reconstitué). |
| 4 | Le risk engine CloddsBot est substantiel mais son pipeline, VaR et circuit breakers ne sont pas couverts par des tests ciblés exécutables ([Analyse §1.3/2.4](../../ANALYSE-CLODDSBOT.md#24-risk-engine--réellement-implémenté-et-testé-), [Leçon 1](../../FICHE-LECONS.md#1-risk-engine-centralisé-en-un-seul-point-de-passage-obligé)). | Le moteur Rust est testé aux frontières et sur cas adversariaux ; état, bornes, HalfOpen, exposition cumulative et données insuffisantes ont été rejoués. | **Traité localement, partiel système** : [M01](../mission/archives/mission-PALLAS-M01-journal.md), [M15](../mission/archives/mission-PALLAS-M15-journal.md), [audit v0.4 §5](../AUDIT-PALLAS-v0.4.md#5-axe-2--gestion-des-risques). Les positions/collateral exchange restent non autoritatifs (audit v0.6 §8). |
| 5 | `strict:true` coexiste avec 376 `as any` et `skipLibCheck:true` ([Analyse §1.4](../../ANALYSE-CLODDSBOT.md#14-typage-typescript)). | Pallas valide les frontières Rust/CLOB à l'exécution par schémas stricts et les audits v0.1/v0.2 n'ont trouvé ni `as any` actif ni `skipLibCheck:true`. | **Traité dans la baseline auditée** : [M04](../mission/archives/mission-PALLAS-M04-journal.md), [audit v0.2 §2.5](../AUDIT-PALLAS-v0.2.md#25-patterns-bannis). Cela ne prouve pas l'absence future de tout contournement. |
| 6 | Le stockage AES-256-GCM existe, mais l'absence de clé ne provoque qu'un warning et un format legacy CBC reste accepté ([Analyse §2.1](../../ANALYSE-CLODDSBOT.md#21-stockage-des-clés-privées-et-api-keys), [Leçon 7](../../FICHE-LECONS.md#7-chiffrement-des-credentials)). | Le vault Pallas est AES-256-GCM/scrypt, fail-closed si la clé manque et refuse le legacy. | **Traité au repos** : [M05](../mission/archives/mission-PALLAS-M05-journal.md), [audit v0.2 §2.3](../AUDIT-PALLAS-v0.2.md#23-credentials--chiffrement-fail-closed-zeroing-partiel-et-honnêtement-documenté). |
| 7 | Les clés privées vivent comme chaînes dans le heap sans zeroing ; la clé de chiffrement est une env var ([Analyse §2.1/4.1](../../ANALYSE-CLODDSBOT.md#21-stockage-des-clés-privées-et-api-keys), [Leçon 7](../../FICHE-LECONS.md#7-chiffrement-des-credentials)). | Pallas efface les copies Buffer, impose `0600` avant lecture et protège la convention de chargement par test. Les strings JS, l'env, le heap partagé et l'absence de KMS/HSM demeurent. | **Partiel** : [M05](../mission/archives/mission-PALLAS-M05-journal.md), [M19](../mission/archives/mission-PALLAS-M19-journal.md), [M28](../mission/archives/mission-PALLAS-M28-journal.md), [audit v0.5 §6](../AUDIT-PALLAS-v0.5.md#6-axe-3--viabilité-opérationnelle). Rotation/révocation plateforme réelle non prouvée. |
| 8 | L'installation et les 28 tests échouent dans l'environnement de l'analyse ; les protections critiques ne sont donc pas rejouées ([Analyse §1.3/4.1](../../ANALYSE-CLODDSBOT.md#13-couverture-des-tests)). | Pallas explicite les préconditions, stabilise les probes et gèle un arbre rejoué indépendamment. | **Traité pour le tag** : [M21](../mission/archives/mission-PALLAS-M21-journal.md), [M30](../mission/archives/mission-PALLAS-M30-journal.md), [M31](../mission/archives/mission-PALLAS-M31-journal.md), audit v0.6 §§1–3 : 308/0/0 TS, 65/0 Rust, Clippy vert. |
| 9 | L'audit sécurité interne affichait « 0 vulnerabilities » alors que l'analyse trouvait 68 vulnérabilités npm ; la fiche déconseille les audits obsolètes ([Analyse §2.3/4.2](../../ANALYSE-CLODDSBOT.md#23-auditmd-et-security_auditmd), [Ne pas reprendre](../../FICHE-LECONS.md#ne-pas-reprendre)). | Pallas versionne la chaîne v0.1→v0.6, lie les rapports à des commits et conserve les résultats négatifs/corrections. Les audits ne promettent pas zéro vulnérabilité et distinguent dépendances dev/runtime. | **Traité comme discipline**, pas comme garantie « zéro CVE » : [M21](../mission/archives/mission-PALLAS-M21-journal.md), [M29](../mission/archives/mission-PALLAS-M29-journal.md), [audit v0.5.2 §4.3](../AUDIT-PALLAS-v0.5.2.md#43-r-03--provenance-du-hash), audit v0.6 §2. |
| 10 | Les badges et le nombre de stratégies sont jugés déconnectés de la structure réelle ([Analyse §1.2](../../ANALYSE-CLODDSBOT.md#12-cohérence-readme-vs-implémentation), [Ne pas reprendre](../../FICHE-LECONS.md#ne-pas-reprendre)). | Pallas nomme sa stratégie « référence », déclare `win_probability=price` et Kelly illustratifs, et interdit toute prétention de rentabilité sans backtest séparé. | **Traité sur le plan documentaire et audité** : [M12](../mission/archives/mission-PALLAS-M12-journal.md), [M18](../mission/archives/mission-PALLAS-M18-journal.md), [audit v0.4 §§4.3, 8](../AUDIT-PALLAS-v0.4.md#43-m16-m17-et-m18). |
| 11 | L'analyse ne trouve aucun test d'intégration d'ordre réel ([Analyse §1.3](../../ANALYSE-CLODDSBOT.md#13-couverture-des-tests)). | Pallas teste le wire/auth sur mocks, bloque les retries ambigus et réconcilie ordre+trades. Il n'a lui non plus **aucun ack/fill live ou testnet audité**. | **Partiel, lacune réelle non masquée** : [M04](../mission/archives/mission-PALLAS-M04-journal.md), [M22](../mission/archives/mission-PALLAS-M22-journal.md), [audit v0.5 §4.1](../AUDIT-PALLAS-v0.5.md#41-f-03f-04-m22--la-preuve-positive-par-trades-est-réelle), audit v0.6 §5. |
| 12 | Le rapport interne valorise un trade ledger hashé et idéalement ancré on-chain ([Leçon 3](../../FICHE-LECONS.md#3-trade-ledger-avec-hash-dintégrité-et-ancrage-on-chain)). | Pallas vérifie le chaînage au chargement et impose en mode supervisé un checkpoint Ed25519 produit hors process. Il n'a pas d'ancrage on-chain/distant/WORM ; la signature périodique est manuelle. | **Partiel** : [M16](../mission/archives/mission-PALLAS-M16-journal.md), [M24](../mission/archives/mission-PALLAS-M24-journal.md), [audit v0.5 §4.4](../AUDIT-PALLAS-v0.5.md#44-f-05-m24--signature-par-défaut-plus-une-option), audit v0.6 §8. |
| 13 | L'analyse souligne une très grande surface multi-marchés/exchanges/canaux et des intégrations cassées corrigées après le hackathon ([Analyse §1.2/3.3](../../ANALYSE-CLODDSBOT.md#33-activité-post-hackathon)). | Pallas ne tente pas d'en reproduire la couverture : Polymarket uniquement, EOA uniquement, une boucle paper/dry-run. | **Compromis assumé, pas « résolu »** : [M08](../mission/archives/mission-PALLAS-M08-journal.md), [M12](../mission/archives/mission-PALLAS-M12-journal.md), [audit v0.3 §1](../AUDIT-PALLAS-v0.3.md#1-verdict-exécutif), audit v0.6 §§1, 10. |
| 14 | L'architecture multi-agents spécialisée est surtout déclarative et les permissions ne sont pas réellement cloisonnées ([Leçon 9](../../FICHE-LECONS.md#9-architecture-multi-agents-spécialisés)). | Pallas n'implémente ni gateway ni agent LLM. Il évite donc cette surface aujourd'hui, mais n'apporte **aucune contrepartie fonctionnelle** ni preuve de permissions multi-agents. | **Absence explicite** : [M12](../mission/archives/mission-PALLAS-M12-journal.md), [audit v0.3 §2](../AUDIT-PALLAS-v0.3.md#2-périmètre-méthode-et-référentiel). |
| 15 | Le lazy-loading des skills/plugins est recommandé comme pattern d'isolation ([Leçon 5](../../FICHE-LECONS.md#5-lazy-loading-des-skillsplugins)). | Pallas ne possède pas de loader/marketplace de skills dans la baseline. | **Absence explicite**, pas une faille annoncée fermée : [M06](../mission/archives/mission-PALLAS-M06-journal.md), [audit v0.2 §3.2](../AUDIT-PALLAS-v0.2.md#32-cases-non-cochées--). |
| 16 | La calibration confiance/précision est proposée comme bonne pratique ([Leçon 4](../../FICHE-LECONS.md#4-calibration-confiance-vs-précision)); l'analyse ne permet pas de conclure à la rentabilité ([Analyse §3.2/5](../../ANALYSE-CLODDSBOT.md#32-issues-et-prs-ouvertes-20-issues-analysées)). | Pallas étiquette sa confiance et Kelly comme illustratifs ; aucun modèle calibré, backtest, walk-forward ou rentabilité ne sont revendiqués. | **Absence explicite de capacité prédictive** : [M18](../mission/archives/mission-PALLAS-M18-journal.md), [audit v0.4 §8](../AUDIT-PALLAS-v0.4.md#8-risques-financiers-restants). |
| 17 | Un placeholder Virtuals et un impact slippage simplifié illustrent les limites de fidélité de certaines intégrations ([Analyse §1.1](../../ANALYSE-CLODDSBOT.md#11-proportion-code-réel-vs-stubsplaceholders)). | Pallas valide le wire et le rounding d'un seul venue, mais n'a pas de modèle démontré de liquidité/slippage ni de vérité de portefeuille exchange consolidée. | **Partiel ; pas de contrepartie slippage résolue** : [M17](../mission/archives/mission-PALLAS-M17-journal.md), [M15](../mission/archives/mission-PALLAS-M15-journal.md), [audit v0.4 §§4.3, 5](../AUDIT-PALLAS-v0.4.md#5-axe-2--gestion-des-risques), audit v0.6 §8. |
| 18 | L'analyse note un contributeur principal et soulève implicitement le bus factor ([Analyse §3.1](../../ANALYSE-CLODDSBOT.md#31-historique-des-commits)). | La chaîne d'audit Pallas améliore la vérifiabilité technique, mais ne prouve ni équipe redondante, ni séparation des fonctions, ni astreinte. | **Absence explicite de contrepartie organisationnelle** : [M21](../mission/archives/mission-PALLAS-M21-journal.md), [audit v0.3 §8](../AUDIT-PALLAS-v0.3.md#8-viabilité-opérationnelle). |

## Ce qui distingue effectivement Pallas

Ces différences sont étroites et prouvées ; elles ne doivent pas être généralisées au-delà du MVP.

- **Fail-closed par défaut** : dry-run global et erreurs de frontières explicites
  ([M17](../mission/archives/mission-PALLAS-M17-journal.md),
  [audit v0.4 §4.3](../AUDIT-PALLAS-v0.4.md#43-m16-m17-et-m18)).
- **Ambiguïté sans retry** : un placement possiblement reçu devient `AmbiguousOrderError`, puis
  réconciliation, jamais un second POST automatique
  ([M04](../mission/archives/mission-PALLAS-M04-journal.md),
  [audit v0.3 §4.4](../AUDIT-PALLAS-v0.3.md#44-échecs-de-placeorder)).
- **Intention contre payload avant émission** : actif, token, côté et montants arrondis sont
  recroisés avant réseau ([M17](../mission/archives/mission-PALLAS-M17-journal.md),
  [audit v0.4 §4.3](../AUDIT-PALLAS-v0.4.md#43-m16-m17-et-m18)).
- **Kill switch hors de la surface publique et autorité fichier** : cycle actif, cancel-all et
  réarmement ont été rejoués ([M25](../mission/archives/mission-PALLAS-M25-journal.md),
  [M30](../mission/archives/mission-PALLAS-M30-journal.md), audit v0.6 §4.4).
- **Ledger signé obligatoire par défaut** : `supervised` échoue sans clé publique ; `dev` est
  explicitement non probant ([M24](../mission/archives/mission-PALLAS-M24-journal.md),
  [audit v0.5 §4.4](../AUDIT-PALLAS-v0.5.md#44-f-05-m24--signature-par-défaut-plus-une-option)).
- **Garde anti-contournement des secrets** : la convention de lecture 0600 est testée ; aucun
  consumer live n'est inventé ([M28](../mission/archives/mission-PALLAS-M28-journal.md),
  [audit v0.5 §6](../AUDIT-PALLAS-v0.5.md#6-axe-3--viabilité-opérationnelle)).
- **Audit et rejeu** : rapports versionnés, provenance corrigée, tag/artefacts pinnés ; v0.6
  distingue chaque chiffre rejoué d'une affirmation de journal
  ([M21](../mission/archives/mission-PALLAS-M21-journal.md),
  [M31](../mission/archives/mission-PALLAS-M31-journal.md), audit v0.6 §§2–4).

## Limites Pallas à lire avec la comparaison

- **F-11 est ouverte** : aucune observation auditée ≥ 72 h. Le dernier état audité autorise le
  démarrage d'une campagne paper supervisée ; il ne prouve pas sa réussite.
- **Capital réel reste NO-GO** : exposition exchange non autoritative, matching des fills
  heuristique, pas d'ack/fill live, custody et rotation plateforme incomplètes.
- Réconciliation REST/polling sans WebSocket, single-flight intra-processus seulement.
- État et ledger locaux séparés, pas de transaction ACID commune, pas d'ancrage distant/WORM.
- Kill switch dépendant de la boucle active, du polling, des credentials et de l'exchange.
- Sandbox dépendant de la capacité netns de l'hôte et non confidentiel en lecture.
- EOA seulement ; aucune stratégie rentable ou calibration confiance/précision démontrée.
- Pas de gateway, agent multi-outils, architecture multi-agent, skill loader ou couverture
  multi-marchés : ce sont des absences de périmètre, pas des succès de sécurité équivalents.

## Provenance documentaire incomplète dans ce checkout

L'audit v0.6 est disponible dans Git au commit `6605d0f` mais absent du checkout ; le journal M32
est disponible au commit `c40deed` mais absent du checkout. Le journal M33 est présent, mais aucun
audit indépendant post-M33 n'est disponible : ses évolutions UI ne sont donc pas créditées comme
fermées. Vérification des deux blobs historiques :

```bash
git show 6605d0f:docs/AUDIT-PALLAS-v0.6.md
git show c40deed:docs/mission/mission-PALLAS-M32-journal.md
```
