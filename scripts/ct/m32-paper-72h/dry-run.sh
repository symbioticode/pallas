#!/usr/bin/env bash
set -euo pipefail
REPO=/home/andrei/Projects/80_PALLAS/pallas
TAG=e69d7542f79ff3e6a24df60773147a6a2f400986
[[ "$(git -C "$REPO" rev-parse HEAD)" == "$TAG" ]] || { echo 'DRY_FAIL HEAD hors tag'; exit 1; }
[[ -z "$(git -C "$REPO" status --porcelain --untracked-files=no)" ]] || { echo 'DRY_FAIL arbre suivi modifie'; exit 1; }
FIX=$(mktemp -d /tmp/ct-020-pallas-dry.XXXXXX)
trap 'rm -rf "$FIX"' EXIT
bash "$CT_BUNDLE_DIR/artifacts/materialize-runtime.sh" "$FIX"
node "$FIX/verify-artifact-pins.mjs" --manifest "$FIX/bundle-manifest.json" --root "$FIX/artifacts"
CT_DRY_RUN=1 CT_BUNDLE_DIR="$FIX" PALLAS_SIGNING_DIR=/home/andrei/.pallas-signing \
  bash "$REPO/scripts/ct/m30-m27-72h/dry-run.sh"
