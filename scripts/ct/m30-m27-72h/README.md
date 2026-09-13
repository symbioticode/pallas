# CT-2026-020 — bundle M27 régénéré après M30

Ce bundle remplace CT-2026-019, invalidé. Il est **préparé mais non lancé**.

Le manifeste épingle le commit de code M30, les résultats réellement rejoués et les SHA-256 des
artefacts runtime. Lors de la matérialisation dans le CT runner, le dossier `artifacts/` doit
contenir exactement ces fichiers et hashes. `execute.sh` refuse au minimum tout launcher ou
superviseur dont le hash diverge.

Une nouvelle approbation indépendante reste obligatoire avant toute campagne. La présente mission
ne vaut ni approbation ni lancement de M27.
