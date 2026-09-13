# Gel de baseline MVP — PALLAS-M31

La référence de gel est le tag annoté `pallas-mvp-freeze-1`. Le hash exact de l'objet commit est
obtenu sans ambiguïté avec :

```bash
git rev-parse 'pallas-mvp-freeze-1^{commit}'
```

Le message du tag consigne le hash complet ciblé, les résultats rejoués et le contrôle SHA-256
complet des huit artefacts. Cette indirection évite de placer dans un commit une auto-référence à
son propre hash, construction impossible par définition.

## Portée

- code et tests de la baseline ;
- scripts CT-2026-020 avec vérification bloquante 8/8 avant et après installation ;
- squelette documentaire MVP ;
- journal M31 et provenance M30.

## Candidat et résultats observés avant pose du tag

- commit candidat fonctionnel et documentaire : `09e2eed85819961b98fdbf5cc09b40eebafea7f4` ;
- TypeScript : 308 passés, 0 échec, 0 ignoré ; les quatre tests d'isolation disponibles dans cet
  environnement ont été exécutés, contrairement au rejeu M30 à 304/0/4 ;
- Rust : 65 passés, 0 échec ;
- Clippy : vert avec avertissements traités comme erreurs ;
- test pins : positif accepté, altération d'un octet rejetée ;
- `verify-test.sh` : positif accepté et signature altérée rejetée.

Le commit de clôture documentaire est testé une seconde fois avant création du tag. Le tag et son
message annoté constituent l'identité exacte et la preuve finale du gel.
