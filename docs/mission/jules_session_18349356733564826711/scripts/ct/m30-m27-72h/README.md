# CT-2026-020 — bundle M27 régénéré après M30

Ce bundle remplace CT-2026-019, invalidé. Il est **préparé mais non lancé**.

Le manifeste épingle le commit de code M30, les résultats réellement rejoués et les SHA-256 des
artefacts runtime. Lors de la matérialisation dans le CT runner, le dossier `artifacts/` doit
reproduire les chemins relatifs du manifeste. `execute.sh` vérifie les huit fichiers avant toute
mutation, les installe, puis revérifie les huit copies installées. `dry-run.sh` contrôle également
les huit artefacts du dépôt. `verify-test.sh` rejoue les cas positif et négatif du contrôle de pins.

Une nouvelle approbation indépendante reste obligatoire avant toute campagne. La présente mission
ne vaut ni approbation ni lancement de M27.
