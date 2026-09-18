#!/usr/bin/env bash
# CT-2026-020 - PALLAS-M27 : validation DRY (lecture seule, aucune mutation).
# Exécuté par ct_workflow avant approbation GPG (CT_DRY_RUN=1).
set -u

REPO=/home/andrei/Projects/80_PALLAS/pallas
BUNDLE=${CT_BUNDLE_DIR:-$REPO/scripts/ct/m30-m27-72h}
LAUNCHER=scripts/m27-72h-run.mjs
SUPERVISOR=scripts/observation-campaign.mjs
RUNLOG=$REPO/.pallas/m27-72h-wrapper.log
PIDFILE=$REPO/.pallas/m27-72h-run.pid
SIGNDIR=${PALLAS_SIGNING_DIR:-$HOME/.pallas-signing}
TOKENS="30630994248667897740988010928640156931882346081873066002335460180076741328029,109876868437950584369987384406356259939519193117253465815665152916226511121427,113287701564209339913693347405685749986285999146352375265161592243948562084773,40081275558852222228080198821361202017557872256707631666334039001378518619916"

if [[ "${CT_DRY_RUN:-1}" != "1" ]]; then
  echo "CT_DRY_RUN=1 requis en mode DRY"; exit 2
fi

fail=0
ok()  { echo "DRY_OK   $*"; }
bad() { echo "DRY_FAIL $*"; fail=1; }

# 1. Référentiel et artefacts figés
[[ -d "$REPO" ]] && ok "repo=$REPO" || bad "repo absent: $REPO"
declare -a REQUIRED=(
  "scripts/m27-72h-run.mjs:launcher"
  "scripts/observation-campaign.mjs:superviseur"
  "packages/ledger/dist/file-ledger.js:ledger dist"
  "packages/ledger/dist/ledger-signing.js:signing dist"
  "packages/execution/dist/dryRun.js:dry-run dist"
  "packages/execution/dist/polymarketClient.js:client dist"
  "packages/strategy/dist/run-reference-loop.js:loop dist"
  "crates/risk-engine/target/debug/risk-engine:binaire risk-engine"
)
for entry in "${REQUIRED[@]}"; do
  path=${entry%%:*}; label=${entry#*:}
  if [[ -f "$REPO/$path" ]]; then ok "artefact $label: $path"; else bad "artefact manquant $label: $path"; fi
done
if node "$BUNDLE/verify-artifact-pins.mjs" --manifest "$BUNDLE/bundle-manifest.json" --root "$REPO"; then
  ok "8/8 artefacts conformes au manifeste"
else
  bad "controle SHA-256 des 8 artefacts rejete"
fi

# 2. Syntaxe des scripts orchestrés
for f in "scripts/m27-72h-run.mjs" "scripts/observation-campaign.mjs"; do
  if node --check "$REPO/$f" >/dev/null 2>&1; then ok "syntaxe node: $f"; else bad "syntaxe node: $f"; fi
done

# 3. Clés opérateur hors process (non simulables en DRY, existence + droits)
if [[ -f "$SIGNDIR/ledger-signing.pem" && -f "$SIGNDIR/ledger-signing.pub.pem" ]]; then
  ok "clés présentes: $SIGNDIR"
  perm_priv=$(stat -c %a "$SIGNDIR/ledger-signing.pem" 2>/dev/null || echo "?")
  perm_pub=$(stat -c %a "$SIGNDIR/ledger-signing.pub.pem" 2>/dev/null || echo "?")
  if [[ "$perm_priv" == "600" ]]; then ok "cle privee 0600"; else bad "cle privee $perm_priv (attendu 600)"; fi
  if [[ "$perm_pub" == "644" || "$perm_pub" == "664" ]]; then ok "cle publique $perm_pub"; else bad "cle publique $perm_pub"; fi
else
  bad "clés absentes: $SIGNDIR"
fi

# 4. Dry-run STRICT (fail-closed) : DRY_RUN != false au niveau du process
if [[ "${DRY_RUN:-true}" != "false" ]]; then
  ok "dry-run global actif (defaut fail-closed, DRY_RUN=${DRY_RUN:-non defini})"
else
  bad "DRY_RUN=false : emission reelle autorisee - INACCEPTABLE pour ce CT"
fi

# 5. Token(s) cible (bande moyenne, carnets confirmés)
IFS=',' read -r -a tids <<< "$TOKENS"
idx=0
for t in "${tids[@]}"; do
  idx=$((idx + 1))
  if [[ "${#t}" -gt 40 ]]; then ok "token $idx: longueur ${#t}"; else bad "token $idx: longueur invalide"; fi
done

# 6. Aucun lanceur concurrent (double campagne interdit)
launcher_pids() {
  pgrep -af "m27-72h-run.mjs" 2>/dev/null | awk '$2=="node" || $2 ~ /\/node$/ {print $1}'
}
launchers=$(launcher_pids)
if [[ -z "$launchers" ]]; then ok "aucun lanceur m27-72h en cours"; else bad "lanceur m27-72h déjà actif: $launchers"; fi
if [[ -f "$PIDFILE" ]]; then
  pid=$(cat "$PIDFILE" 2>/dev/null || echo 0)
  if kill -0 "$pid" 2>/dev/null; then bad "PID_FILE vivant: $pid"; else ok "PID_FILE stale (process $pid absent)"; fi
else
  ok "PID_FILE absent"
fi

# 7. Réseau CLOB : sonde lecture seule non bloquante (limite résiduelle documentée)
if curl -s --max-time 4 -o /dev/null -w '%{http_code}' https://gamma-api.polymarket.com/ping 2>/dev/null | grep -q '^2'; then
  ok "CLOB gamma-api joignable"
else
  echo "DRY_WARN  CLOB gamma-api injoignable (sonde lecture seule, non bloquant) - limite résiduelle documentée dans le CT"
fi

if [[ "$fail" -eq 0 ]]; then
  echo "CT_DRY_RUN=PASS real_mutation=false"
  exit 0
else
  echo "CT_DRY_RUN=FAIL real_mutation=false"
  exit 1
fi
