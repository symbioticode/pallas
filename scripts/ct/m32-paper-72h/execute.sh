#!/usr/bin/env bash
set -euo pipefail
REPO=/home/andrei/Projects/80_PALLAS/pallas
TAG=e69d7542f79ff3e6a24df60773147a6a2f400986
[[ "$(git -C "$REPO" rev-parse HEAD)" == "$TAG" ]] || { echo 'CT_START_ERROR HEAD hors tag'; exit 1; }
[[ -z "$(git -C "$REPO" status --porcelain --untracked-files=no)" ]] || { echo 'CT_START_ERROR arbre suivi modifie'; exit 1; }
FIX=$(mktemp -d /tmp/ct-020-pallas-exec.XXXXXX)
trap 'rm -rf "$FIX"' EXIT
bash "$CT_BUNDLE_DIR/artifacts/materialize-runtime.sh" "$FIX"
node "$FIX/verify-artifact-pins.mjs" --manifest "$FIX/bundle-manifest.json" --root "$FIX/artifacts"
CT_DRY_RUN=0 CT_BUNDLE_DIR="$FIX" bash "$REPO/scripts/ct/m30-m27-72h/execute.sh"
