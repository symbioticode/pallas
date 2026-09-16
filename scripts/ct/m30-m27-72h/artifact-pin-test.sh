#!/usr/bin/env bash
set -euo pipefail

REPO=/home/andrei/Projects/80_PALLAS/pallas
BUNDLE=$REPO/scripts/ct/m30-m27-72h
FIX=$(mktemp -d /tmp/m31-artifact-pins.XXXXXX)
trap 'rm -rf "$FIX"' EXIT

while IFS= read -r path; do
  mkdir -p "$FIX/$(dirname "$path")"
  cp "$REPO/$path" "$FIX/$path"
done < <(node -e 'const m=require(process.argv[1]); for (const p of Object.keys(m.artifacts)) console.log(p)' "$BUNDLE/bundle-manifest.json")

node "$BUNDLE/verify-artifact-pins.mjs" --manifest "$BUNDLE/bundle-manifest.json" --root "$FIX"
echo "ARTIFACT_PIN_TEST positive=PASS"

printf '\nM31-byte-alteration\n' >> "$FIX/packages/execution/dist/dryRun.js"
rc=0
out=$(node "$BUNDLE/verify-artifact-pins.mjs" --manifest "$BUNDLE/bundle-manifest.json" --root "$FIX" 2>&1) || rc=$?
if [[ "$rc" -ne 0 ]] \
  && grep -q 'ARTIFACT_PIN FAIL path=packages/execution/dist/dryRun.js' <<< "$out" \
  && grep -q 'ARTIFACT_PIN RESULT=REJECTED' <<< "$out"; then
  echo "ARTIFACT_PIN_TEST negative=REJECTED path=packages/execution/dist/dryRun.js"
else
  printf '%s\n' "$out"
  echo "ARTIFACT_PIN_TEST negative=NOT_REJECTED"
  exit 1
fi
