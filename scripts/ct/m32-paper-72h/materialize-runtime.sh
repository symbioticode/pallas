#!/usr/bin/env bash
set -euo pipefail

SOURCE=${CT_BUNDLE_DIR:?CT_BUNDLE_DIR requis}
TARGET=${1:?repertoire cible requis}
mkdir -p "$TARGET/artifacts/scripts" \
  "$TARGET/artifacts/packages/ledger/dist" \
  "$TARGET/artifacts/packages/execution/dist" \
  "$TARGET/artifacts/packages/strategy/dist" \
  "$TARGET/artifacts/crates/risk-engine/target/debug"
cp "$SOURCE/artifacts/bundle-manifest.json" "$TARGET/bundle-manifest.json"
cp "$SOURCE/artifacts/verify-artifact-pins.mjs" "$TARGET/verify-artifact-pins.mjs"
cp "$SOURCE/artifacts/m27-72h-run.mjs" "$TARGET/artifacts/scripts/m27-72h-run.mjs"
cp "$SOURCE/artifacts/observation-campaign.mjs" "$TARGET/artifacts/scripts/observation-campaign.mjs"
cp "$SOURCE/artifacts/file-ledger.js" "$TARGET/artifacts/packages/ledger/dist/file-ledger.js"
cp "$SOURCE/artifacts/ledger-signing.js" "$TARGET/artifacts/packages/ledger/dist/ledger-signing.js"
cp "$SOURCE/artifacts/dryRun.js" "$TARGET/artifacts/packages/execution/dist/dryRun.js"
cp "$SOURCE/artifacts/polymarketClient.js" "$TARGET/artifacts/packages/execution/dist/polymarketClient.js"
cp "$SOURCE/artifacts/run-reference-loop.js" "$TARGET/artifacts/packages/strategy/dist/run-reference-loop.js"
cp "$SOURCE/artifacts/risk-engine" "$TARGET/artifacts/crates/risk-engine/target/debug/risk-engine"
chmod 0755 "$TARGET/verify-artifact-pins.mjs" \
  "$TARGET/artifacts/scripts/m27-72h-run.mjs" \
  "$TARGET/artifacts/scripts/observation-campaign.mjs" \
  "$TARGET/artifacts/crates/risk-engine/target/debug/risk-engine"
