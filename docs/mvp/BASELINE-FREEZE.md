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

## Résultats attendus avant pose du tag

- TypeScript : 304 passés, 0 échec, 4 ignorés ;
- Rust : 65 passés, 0 échec ;
- Clippy : vert avec avertissements traités comme erreurs ;
- test pins : positif accepté, altération d'un octet rejetée ;
- `verify-test.sh` : positif accepté et signature altérée rejetée.

Ces chiffres ne deviennent une preuve de gel qu'après rejeu sur le commit ciblé et création du tag.
