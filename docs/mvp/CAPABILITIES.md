# Capacités du MVP Pallas

État documentaire : 2026-09-14. Cette cartographie décrit la baseline
`pallas-mvp-freeze-1` (`e69d7542f79ff3e6a24df60773147a6a2f400986`). Elle ne vaut ni
autorisation de capital réel, ni clôture de F-11.

## Discipline de preuve

- Une mission explique l'intention et l'implémentation ; elle ne prouve pas seule une fermeture.
- Une capacité n'est dite **fermée** que lorsqu'un audit indépendant la confirme. **Partielle**
  signifie que la propriété auditée existe, avec une limite nommée. **Résiduelle** signifie que
  l'outillage ou l'intention existe, mais que le critère principal reste ouvert.
- Chaque entrée ci-dessous cite au moins un journal de mission **et** un audit. Le taux de
  couverture est donc de **19/19 = 100 % mission + audit**.
- `AUDIT-PALLAS-v0.6.md` n'est pas présent dans ce checkout, mais son blob Git local est
  vérifiable au commit `6605d0fe5165d59a4279969286b98400c85ee03c` avec
  `git show 6605d0f:docs/AUDIT-PALLAS-v0.6.md`. Les mentions « audit v0.6 » ci-dessous désignent
  cette preuve versionnée, pas un fichier local supposé présent.

## Cartographie

### CAP-01 — Dry-run sûr par défaut

**État : fermé pour le chemin standard ; capital réel NO-GO.** L'absence de configuration maintient
le dry-run. La bascule normale exige la confirmation exacte `LIVE`. Depuis M17, l'injection
`isDryRun` est refusée hors `PALLAS_TEST_MODE=1` et `enableDryRun` n'est plus exporté publiquement.
La variable de mode test reste une autorité volontaire faible ; la baseline n'est pas qualifiée
pour du capital réel.

Sources : [M17](../mission/archives/mission-PALLAS-M17-journal.md),
[audit v0.4 §4.3](../AUDIT-PALLAS-v0.4.md#43-m16-m17-et-m18), audit v0.6 §§1, 10.

### CAP-02 — Signature Polymarket EIP-712 V2 et authentification L1/L2

**État : partiel.** Domaine EIP-712, mots ABI, sens maker/taker BUY/SELL, vecteurs externes,
ClobAuth L1 et HMAC L2 sont établis. Le wire V2 a été confronté aux clients officiels et Pallas
reste volontairement **EOA seulement**. Aucun ordre, ack ou fill live/testnet n'a toutefois été
audité ; Proxy/Safe/POLY_1271 ne sont pas supportés.

Sources : [M02](../mission/archives/mission-PALLAS-M02-journal.md),
[M08](../mission/archives/mission-PALLAS-M08-journal.md),
[audit v0.3 §§2, 4.3](../AUDIT-PALLAS-v0.3.md#43-signatures-et-modes-de-wallet), audit v0.6 §5.

### CAP-03 — Cross-check intention/payload et rounding officiel

**État : fermé au niveau code/tests, avec limite de représentation.** Avant tout réseau,
`marketId === tokenId === signed.order.tokenId`, le côté et les montants recalculés par tick sont
comparés ; une divergence lève `OrderMismatchError`. Prix et taille bruts ne sont pas eux-mêmes
des champs signés : la preuve porte sur l'identité de l'actif, le côté et les flux monétaires
arrondis.

Sources : [M10](../mission/archives/mission-PALLAS-M10-journal.md),
[M17](../mission/archives/mission-PALLAS-M17-journal.md),
[audit v0.4 §4.3](../AUDIT-PALLAS-v0.4.md#43-m16-m17-et-m18).

### CAP-04 — Frontières runtime fail-closed et placement ambigu sans retry

**État : fermé pour le comportement documenté.** Les sorties du moteur Rust et les réponses CLOB
sont validées à l'exécution. Un timeout ou un HTTP 5xx après un unique POST `/order` produit
`AmbiguousOrderError` ; Pallas ne retente pas aveuglément un placement dont le résultat est
inconnu. La résolution dépend ensuite de la réconciliation CAP-10.

Sources : [M04](../mission/archives/mission-PALLAS-M04-journal.md),
[M10](../mission/archives/mission-PALLAS-M10-journal.md),
[audit v0.2.1 §1](../AUDIT-PALLAS-v0.2.1.md#1-fidélité-dexécution-et-intégrité-fonctionnelle--275),
[audit v0.3 §4.4](../AUDIT-PALLAS-v0.3.md#44-échecs-de-placeorder).

### CAP-05 — Risk engine déterministe, borné et à état transporté

**État : fermé pour les invariants locaux.** Les entrées invalides sont rejetées, le kill switch
court-circuite, l'état du circuit breaker et de volatilité traverse les appels CLI, NaN ne provoque
plus de panic, la cohérence notionnelle est vérifiée et Kelly borne effectivement l'ordre.

Sources : [M01](../mission/archives/mission-PALLAS-M01-journal.md),
[M09](../mission/archives/mission-PALLAS-M09-journal.md),
[audit v0.2 §§2.1, 4.1](../AUDIT-PALLAS-v0.2.md#21-dry-run--défaut-sûr-api-interne-encore-contournable),
[audit v0.4 §5](../AUDIT-PALLAS-v0.4.md#5-axe-2--gestion-des-risques).

### CAP-06 — Limites de portefeuille, concentration, HalfOpen et données insuffisantes

**État : partiel.** Les limites appartiennent à une `RiskConfig` opérateur, non à l'intention de la
stratégie. Le moteur additionne positions locales et ordres ouverts, borne la concentration par
marché, restreint HalfOpen à une sonde, distingue `INSUFFICIENT_DATA` de risque nul et refuse les
données trop anciennes. L'audit v0.6 maintient F-04 : balances, collateral et positions exchange
ne sont pas une source autoritative ; la concentration réelle par événement n'est pas acquise.

Sources : [M15](../mission/archives/mission-PALLAS-M15-journal.md),
[audit v0.4 §5](../AUDIT-PALLAS-v0.4.md#5-axe-2--gestion-des-risques), audit v0.6 §§5, 8.

### CAP-07 — Sandbox bwrap sans shell interprété

**État : partiel et dépendant de l'hôte.** Allowlist de binaires, `spawn` sans `shell:true`,
namespaces et détection de l'échec d'initialisation donnent un comportement fail-closed. La preuve
réseau positive n'existe que sur un hôte capable de créer le netns ; ailleurs quatre tests sont
explicitement skippés. Le montage `/` en lecture seule protège l'écriture, pas la confidentialité
des fichiers lisibles par l'utilisateur.

Sources : [M03](../mission/archives/mission-PALLAS-M03-journal.md),
[M07](../mission/archives/mission-PALLAS-M07-journal.md),
[audit v0.2 §2.2](../AUDIT-PALLAS-v0.2.md#22-sandbox-bwrap--fail-closed-amélioré-disponibilité-et-preuve-hôte-non-acquises),
[audit v0.3 §3](../AUDIT-PALLAS-v0.3.md#3-environnement-et-reproductibilité).

### CAP-08 — Sanitisation du texte externe

**État : partiel.** Le sanitizer retire caractères invisibles/homoglyphes et marque des motifs de
prompt injection ; le chemin de référence journalise la menace et le texte transformé. Pallas ne
possède pas encore d'agent ou de gateway privilégié à protéger : cette capacité n'est donc pas une
preuve de cloisonnement d'un système multi-agent.

Sources : [M12](../mission/archives/mission-PALLAS-M12-journal.md),
[audit v0.3 §§2, 4.1](../AUDIT-PALLAS-v0.3.md#41-flux-reconstitué).

### CAP-09 — État durable et cycle de vie d'ordre

**État : partiel.** L'état local est versionné, strict, checksummé, écrit par temp+fsync+rename sous
verrou, et fail-stop si un fichier présent est corrompu. Les transitions `DECIDED`, `SUBMITTING`,
`AMBIGUOUS`, `ACKED`, `RECONCILING` et `TERMINAL` rendent les fenêtres de crash observables. État
et ledger restent deux fichiers, sans transaction ACID commune ; le rattrapage est idempotent.

Sources : [M13](../mission/archives/mission-PALLAS-M13-journal.md),
[M23](../mission/archives/mission-PALLAS-M23-journal.md),
[audit v0.4 §4.1](../AUDIT-PALLAS-v0.4.md#41-m13--durabilité-et-fenêtres-de-crash),
[audit v0.5 §4.2](../AUDIT-PALLAS-v0.5.md#42-f-01--fenêtre-d-m23--réparation-idempotente-mais-rattrapage-paresseux).

### CAP-10 — Réconciliation par ordres et fills, indépendante du signal

**État : partiel.** Les ordres non réglés sont rapprochés même sur un cycle `no_signal`. La
conclusion utilise ordres ouverts et trades/fills ; une source en erreur ou une fenêtre de grâce
non écoulée laisse le scope bloqué. M30 partage le scan global et single-flight les appels dans un
processus. L'attribution sans client order id reste heuristique et peut dupliquer un fill entre
ordres jumeaux ; le single-flight n'est pas interprocessus et aucune vérité consolidée de positions
ou collateral n'est ingérée.

Sources : [M22](../mission/archives/mission-PALLAS-M22-journal.md),
[M29](../mission/archives/mission-PALLAS-M29-journal.md),
[M30](../mission/archives/mission-PALLAS-M30-journal.md),
[audit v0.5 §4.1](../AUDIT-PALLAS-v0.5.md#41-f-03f-04-m22--la-preuve-positive-par-trades-est-réelle),
[audit v0.5.2 §§4.1, 9](../AUDIT-PALLAS-v0.5.2.md#41-r-01--réconciliation-indépendante-du-signal),
audit v0.6 §§4.5, 5, 8.

### CAP-11 — Kill switch externe, cancel-all et réarmement

**État : fermé au niveau code/tests ; limite opérationnelle nommée.** Le setter n'est plus dans
l'API publique ; la présence de `.pallas/KILL` est autoritaire face à la mémoire. Le cycle actif
déclenche un cancel-all une fois par engagement, efface le marqueur après désengagement et permet
un second cancel-all lors d'un nouvel engagement. La garantie dépend du polling, d'une boucle
active, des credentials et de la disponibilité de l'exchange ; un retrait/redépôt entièrement
entre deux polls est invisible.

Sources : [M25](../mission/archives/mission-PALLAS-M25-journal.md),
[M29](../mission/archives/mission-PALLAS-M29-journal.md),
[M30](../mission/archives/mission-PALLAS-M30-journal.md),
[audit v0.5.2 §4.2](../AUDIT-PALLAS-v0.5.2.md#42-r-02--fichier-kill-vers-cancel-all),
audit v0.6 §§4.4, 8.

### CAP-12 — Ledger chaîné, signé et obligatoire en mode supervisé

**État : fermé pour la garantie par défaut ; limites opérationnelles ouvertes.** Le chargement
vérifie la chaîne et fail-stop sur corruption. Les checkpoints Ed25519 sont produits hors du
process écrivain ; le mode `supervised`, par défaut, exige la clé publique, tandis que `dev` est
explicitement non probant. La re-signature reste manuelle, le checkpoint est périodique et local,
et il n'existe pas d'ancrage distant/WORM.

Sources : [M16](../mission/archives/mission-PALLAS-M16-journal.md),
[M24](../mission/archives/mission-PALLAS-M24-journal.md),
[audit v0.5 §4.4](../AUDIT-PALLAS-v0.5.md#44-f-05-m24--signature-par-défaut-plus-une-option),
audit v0.6 §§5, 8.

### CAP-13 — Chiffrement et garde des secrets

**État : partiel.** Le vault utilise AES-256-GCM/scrypt et rejette le format legacy ; les copies
`Buffer` de clés privées sont effacées. Les fichiers doivent être `0600` sur Linux/NixOS, et un
test de convention interdit qu'un futur chemin de production contourne la garde. Les chaînes JS
restent en clair dans le heap, aucun KMS/HSM ni process de signature séparé n'existe, et la
rotation/révocation CLOB réelle n'a pas été démontrée faute de testnet.

Sources : [M05](../mission/archives/mission-PALLAS-M05-journal.md),
[M19](../mission/archives/mission-PALLAS-M19-journal.md),
[M28](../mission/archives/mission-PALLAS-M28-journal.md),
[audit v0.5 §§6, 8](../AUDIT-PALLAS-v0.5.md#6-axe-3--viabilité-opérationnelle), audit v0.6 §8.

### CAP-14 — Alertes structurées et corruption signalée au point de détection

**État : partiel.** Les anomalies critiques sont persistées en JSONL ; `STATE_CORRUPT` et
`LEDGER_CORRUPT` sont émises là où la lecture échoue. Le webhook a des retries bornés et son échec
final laisse `ALERT_DELIVERY_FAILED`. Il n'existe ni queue durable de relivraison, ni accusé de
réception distant, ni service d'astreinte garanti.

Sources : [M20](../mission/archives/mission-PALLAS-M20-journal.md),
[M26](../mission/archives/mission-PALLAS-M26-journal.md),
[audit v0.5 §4.6](../AUDIT-PALLAS-v0.5.md#46-f-10-m26--alerte-state_corrupt-au-point-de-lecture),
audit v0.6 §5.

### CAP-15 — CI, couverture et chaîne d'audits versionnée

**État : fermé pour la baseline gelée.** Les audits sont versionnés, les actions CI sont épinglées,
les seuils de couverture sont explicites et les probes de concurrence ont des diagnostics
actionnables. L'audit v0.6 a rejoué indépendamment sur le tag : 308 tests TS, 65 Rust et Clippy
vert. Les chiffres sandbox restent dépendants de la capacité netns de l'hôte ; un journal n'est
jamais crédité comme preuve de rejeu.

Sources : [M11](../mission/archives/mission-PALLAS-M11-journal.md),
[M20](../mission/archives/mission-PALLAS-M20-journal.md),
[M21](../mission/archives/mission-PALLAS-M21-journal.md),
[audit v0.5.2 §§1, 3](../AUDIT-PALLAS-v0.5.2.md#3-résultats-dexécution), audit v0.6 §§1–3.

### CAP-16 — Provenance d'audit, pins d'artefacts et tag de gel

**État : fermé pour l'identité et les 8 pins ; matérialisation externe requise.** Une garde refuse
les déclarations de commit mal formées. Le tag annoté résout un commit exact ; huit SHA-256 sont
vérifiés avant et après installation, et l'altération d'un octet est rejetée. Au moment de v0.6,
le dossier de payload `artifacts/` n'était pas inclus dans le tag : le bundle n'était pas
auto-suffisant. Le journal M32, disponible uniquement dans Git, rapporte sa matérialisation
ultérieure sans modifier la baseline.

Sources : [M29](../mission/archives/mission-PALLAS-M29-journal.md),
[M31](../mission/archives/mission-PALLAS-M31-journal.md),
[audit v0.5.2 §4.3](../AUDIT-PALLAS-v0.5.2.md#43-r-03--provenance-du-hash), audit v0.6 §§3–4.3, 9.

### CAP-17 — Boucle de référence dry-run de bout en bout

**État : partiel et non prédictif.** Le chemin lecture Polymarket → sanitizer → risk → tentative
d'exécution bloquée par dry-run → état/ledger a été exercé. La taille transmise est plafonnée par
la décision risk. La règle de référence et ses paramètres Kelly sont explicitement illustratifs :
il n'existe ni edge, ni backtest, ni walk-forward, ni modèle démontré de frais/slippage.

Sources : [M12](../mission/archives/mission-PALLAS-M12-journal.md),
[M18](../mission/archives/mission-PALLAS-M18-journal.md),
[audit v0.3 §§1, 4.1](../AUDIT-PALLAS-v0.3.md#41-flux-reconstitué),
[audit v0.4 §§4.3, 8](../AUDIT-PALLAS-v0.4.md#43-m16-m17-et-m18).

### CAP-18 — Observatory de supervision en lecture seule

**État : partiel.** La surface existante expose état durable, ledger, alertes et statut sans faire
autorité sur l'exécution. La frontière « le moniteur manifeste, l'écrivain fail-stop » a été
auditée. Le journal M33 rapporte une baseline dynamique, un panneau de campagne, la source du kill
switch, la redaction et une frontière ramenée à deux routes. Aucun audit indépendant post-M33 ne
confirme encore ces ajouts : ils sont documentés, mais pas crédités comme fermés.

Sources : [M16](../mission/archives/mission-PALLAS-M16-journal.md),
[M20](../mission/archives/mission-PALLAS-M20-journal.md),
[M33](../mission/mission-PALLAS-M33-journal.md),
[audit v0.4 §6](../AUDIT-PALLAS-v0.4.md#6-axe-3--viabilité-opérationnelle),
[mission M33 active](../mission/mission-PALLAS-M33-observatory-ui.md).

### CAP-19 — Harnais de campagne paper supervisée

**État : résiduel — F-11 ouvert.** Le superviseur vérifie le dry-run, collecte métriques et preuves,
injecte un incident contrôlé et relance. M31 a gelé le runtime ; v0.6 autorise une campagne paper
supervisée, conditionnée à la matérialisation du bundle. Aucune observation d'au moins 72 h n'était
auditée : stabilité longue, marché actif, rate limits et comportement incident restent inconnus.

Sources : [M27](../mission/archives/mission-PALLAS-M27-journal.md),
[M31](../mission/archives/mission-PALLAS-M31-journal.md),
[audit v0.5 §§1, 6, 8](../AUDIT-PALLAS-v0.5.md#8-risques-financiers-restants), audit v0.6 §§6, 8–10.

## Limites transverses à ne pas perdre

- **F-11 reste ouverte** : aucune campagne ≥ 72 h n'est créditée dans la chaîne d'audit disponible.
- **Capital réel : NO-GO** dans v0.6 : portefeuille exchange non autoritatif, attribution des
  fills heuristique, aucun ack/fill live et custody incomplète.
- **Périmètre** : Polymarket seulement, boucle de référence paper/dry-run. Pas de gateway, pas
  d'agent LLM privilégié, pas de multi-marchés, pas de stratégie rentable démontrée.
- **Réconciliation** : REST/polling, pas de WebSocket utilisateur ; matching des fills non
  cryptographique ; lectures potentiellement dupliquées entre processus.
- **Durabilité** : fichiers locaux, état et ledger distincts, pas de transaction ACID commune,
  pas d'ancrage distant/WORM ni de sauvegarde distante automatisée.
- **Kill switch** : nécessite une boucle active et un exchange joignable pour le cancel-all ; le
  polling ne voit pas une transition entièrement située entre deux cycles.
- **Secrets** : strings JS non effaçables, pas de KMS/HSM, rotation plateforme non prouvée.
- **Sandbox** : disponibilité et preuve réseau dépendantes de l'hôte ; lecture du filesystem
  accessible à l'utilisateur non confidentielle.
- **Exécution/stratégie** : EOA seulement, schéma non validé par ordre live/testnet, Kelly
  illustratif, pas de backtest ou calibration économique.

## Documents disponibles et absents

- Présents dans le checkout : audits v0.1, v0.2, v0.2.1, v0.3, v0.4, v0.5, v0.5.1 et v0.5.2 ;
  journaux M01–M31 dans `docs/mission/archives/`.
- Disponibles seulement dans l'historique Git local : audit v0.6 (`6605d0f`) et journal M32
  (`c40deed`, commande `git show c40deed:docs/mission/mission-PALLAS-M32-journal.md`).
- Présent : journal M33 ajouté pendant l'exécution de M34. Ses résultats ont été lus, mais aucun
  audit post-M33 n'est disponible ; les nouvelles capacités UI ne sont donc pas dites fermées.
