# Fiche de réutilisation — Leçons CloddsBot

Extraction des idées du rapport d'analyse, triées par ce qui est réutilisable tel quel, ce qui doit être refait correctement, et ce qu'il faut éviter.

---

## À réutiliser tel quel

### 1. Risk engine centralisé en un seul point de passage obligé

Principe : aucun ordre ne peut contourner le pipeline de validation, quel que soit l'exchange d'origine.

```
validateTrade() → kill switch → circuit breaker → taille max →
exposition → perte journalière → drawdown → concentration →
VaR → régime de volatilité → Kelly sizing
```

Ce qui manque ici (à ajouter) : tests du pipeline en isolation avec des cas limites. 400+ lignes de code, 0 tests.

### 2. Sanitizer d'entrée contre le prompt injection

Nettoyer les caractères invisibles et homoglyphes avant de laisser un agent LLM traiter une commande utilisateur. Réutilisable dans n'importe quel agent qui accepte du texte libre en entrée d'un système à privilèges.

### 3. Trade ledger avec hash d'intégrité et ancrage on-chain

Journaliser chaque décision (trade, raison, niveau de confiance) avec un hash SHA-256 optionnel ancré sur chaîne. Audit trail infalsifiable, transférable à toute décision automatisée critique (finance, modération, etc.).

### 4. Calibration confiance vs précision

Suivre la corrélation entre le niveau de confiance affiché par l'IA et son taux de réussite réel. Méta-évaluation transférable à tout agent qui prend des décisions avec un score de confiance.

### 5. Lazy-loading des skills/plugins

Charger les skills à la demande pour qu'une dépendance manquante ne fasse pas planter toute l'app. Bon pattern d'isolation de pannes pour un système à plugins nombreux.

---

## À refaire correctement

### 6. Dry-run par défaut

**L'intention :** mode simulation par défaut, argent réel en opt-in explicite.

**L'erreur ici :** `false` par défaut sur la plupart des exchanges. Un `?? false` disséminé dans chaque module.

**La bonne version :** dry-run vrai par défaut partout, un seul flag global (`DRY_RUN`), désactivation explicite obligatoire et bruyante (log + confirmation).

### 7. Chiffrement des credentials

**L'intention :** AES-256-GCM pour les clés API en stockage.

**L'erreur ici :** clé de chiffrement = une variable d'environnement, warning silencieux si absente. Clé privée Solana en clair en mémoire sans zeroing.

**La bonne version :** fail-closed (crash si clé absente) + secret manager plutôt qu'une env var brute + zeroing mémoire après usage.

### 8. Sandboxing de l'exécution shell/Python

**L'intention :** approval gating avant exécution de commandes par l'agent.

**L'erreur ici :** `execSync(command, {shell: '/bin/bash'})` après le gating — le shell interprète toujours tout.

**La bonne version :** sandbox réel (conteneur éphémère, pas de shell interprété, allowlist de binaires) plutôt qu'un simple gate d'approbation en amont d'un `execSync` non contraint.

### 9. Architecture multi-agents spécialisés

**L'intention :** séparer Main/Trading/Research/Alerts pour limiter le blast radius d'une erreur de raisonnement.

**L'erreur ici :** surtout déclarative, permissions non vraiment cloisonnées.

**La bonne version :** permissions strictes par agent, chaque agent ne peut accéder qu'aux outils de son périmètre.

---

## Ne pas reprendre

- **Badges marketing déconnectés du code** ("118+ strategies" quand le module `strategies/` contient 2 dossiers). Mine la confiance dès qu'on ouvre le repo.
- **Audits jamais mis à jour** (`SECURITY_AUDIT.md` affichant "0 vulnerabilities" alors qu'il y en a 68). Pire qu'aucun audit — donne une fausse assurance.
