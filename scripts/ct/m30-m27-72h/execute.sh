#!/usr/bin/env bash
# CT-2026-020 - PALLAS-M27 : EXECUTE réel.
# 1) neutralise tout lanceur/processus résiduel de campagne (précision par PID)
# 2) installe les artefacts figés du bundle (hash-pinned)
# 3) lance le wrapper de campagne (72h, dry-run STRICT) en session détachée
# 4) attend la preuve seed signé + laisse la campagne tourner, puis rend la main
# Ce script ne contient AUCUN émission réelle de marché (dry-run STRICT reste gardé).
set -euo pipefail

if [[ "${CT_DRY_RUN:-1}" != "0" ]]; then
  echo "CT_DRY_RUN doit être 0 en mode EXECUTE"; exit 2
fi

REPO=/home/andrei/Projects/80_PALLAS/pallas
LAUNCHER=scripts/m27-72h-run.mjs
SUPERVISOR=scripts/observation-campaign.mjs
RUNLOG=$REPO/.pallas/m27-72h-wrapper.log
PIDFILE=$REPO/.pallas/m27-72h-run.pid
CURRENT=$REPO/.pallas/m27-72h-current
TOKENS="30630994248667897740988010928640156931882346081873066002335460180076741328029,109876868437950584369987384406356259939519193117253465815665152916226511121427,113287701564209339913693347405685749986285999146352375265161592243948562084773,40081275558852222228080198821361202017557872256707631666334039001378518619916"
EXPECTED_LAUNCHER_SHA=c3f606a0b7f9bef0edb065e697e108a6dfeb25ea3422577764f6914996c8e7aa
EXPECTED_SUPERVISOR_SHA=6eeae8fd5071341977376ca9571af203bb3212bd941a710251d795f88b209b1b

mkdir -p "$REPO/.pallas"
cd "$REPO"
echo "CT_START real_mutation=true token_targets=4"

# --- 1. Neutralisation d'un lancement antérieur (rollback de sécurité) ---
launcher_pids() {
  pgrep -af "m27-72h-run.mjs" 2>/dev/null | awk '$2=="node" || $2 ~ /\/node$/ {print $1}'
}
cleanup_launcher() {
  local pids=() pid pp gp still=()
  if [[ -f "$PIDFILE" ]]; then
    pid=$(cat "$PIDFILE" 2>/dev/null || echo 0)
    [[ "$pid" =~ ^[0-9]+$ && "$pid" -gt 1 ]] && pids+=("$pid")
  fi
  while IFS= read -r p; do [[ "$p" =~ ^[0-9]+$ ]] && pids+=("$p"); done < <(launcher_pids || true)
  for pid in $(printf '%s\n' "${pids[@]}" 2>/dev/null | sort -u); do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    kill -0 "$pid" 2>/dev/null || continue
    echo "cleanup: arret $pid (TERM)"
    for pp in $(pgrep -P "$pid" 2>/dev/null || true); do
      for gp in $(pgrep -P "$pp" 2>/dev/null || true); do kill -TERM "$gp" 2>/dev/null || true; done
      kill -TERM "$pp" 2>/dev/null || true
    done
    kill -TERM "$pid" 2>/dev/null || true
  done
  sleep 4
  for pid in $(printf '%s\n' "${pids[@]}" 2>/dev/null | sort -u); do
    if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; still+=("$pid"); fi
  done
  rm -f "$PIDFILE"
  if [[ ${#still[@]} -gt 0 ]]; then echo "cleanup: KILL restants ${still[*]}"; fi
  echo "cleanup_ok launchers_arretes=${#pids[@]}"
}
cleanup_launcher

# --- 2. Installation des artefacts figés (hash-pinned dans le manifest) ---
if [[ ! -d "$CT_BUNDLE_DIR/artifacts" ]]; then
  echo "CT_START_ERROR bundle artifacts absents: $CT_BUNDLE_DIR/artifacts"; exit 1
fi
install -m 0755 "$CT_BUNDLE_DIR/artifacts/m27-72h-run.mjs" "$REPO/$LAUNCHER"
install -m 0755 "$CT_BUNDLE_DIR/artifacts/observation-campaign.mjs" "$REPO/$SUPERVISOR"
launcher_sha=$(sha256sum "$REPO/$LAUNCHER" | cut -d' ' -f1)
supervisor_sha=$(sha256sum "$REPO/$SUPERVISOR" | cut -d' ' -f1)
[[ "$launcher_sha" == "$EXPECTED_LAUNCHER_SHA" ]] || { echo "CT_START_ERROR launcher hash mismatch"; exit 1; }
[[ "$supervisor_sha" == "$EXPECTED_SUPERVISOR_SHA" ]] || { echo "CT_START_ERROR supervisor hash mismatch"; exit 1; }
echo "install_ok launcher_sha=$launcher_sha"
echo "install_ok supervisor_sha=$supervisor_sha"

# --- 3. Lancement détaché du wrapper (survit au runner). IMPORTANT : le service
# timer qui invoque ce script doit porter KillMode=process, sinon systemd tue la
# cgroup (wrapper inclus) à sa sortie — le wrapper ne doit jamais logguer avant.
rm -f "$PIDFILE" "$CURRENT"
LOG_OFF=0
[[ -f "$RUNLOG" ]] && LOG_OFF=$(wc -c < "$RUNLOG")
nohup setsid /usr/bin/env \
  HOME=/home/andrei \
  PALLAS_REF_TOKEN_ID="$TOKENS" \
  PALLAS_START_AT=now \
  PALLAS_CAMPAIGN_MINUTES=4320 \
  PALLAS_CAMPAIGN_INTERVAL_MS=30000 \
  PALLAS_CAMPAIGN_MONITOR_MS=30000 \
  PALLAS_CAMPAIGN_INCIDENT=1 \
  PALLAS_CHECKPOINT_EVERY_MS=21600000 \
  PALLAS_SIGNING_DIR=/home/andrei/.pallas-signing \
  node "$REPO/$LAUNCHER" >> "$RUNLOG" 2>&1 &
echo "launcher_spawned pid_wait=pidfile log_offset=$LOG_OFF"

# --- 4. Attente du seed signé (max 180 s). Le seed doit apparaître DANS LA
# SÉQUENCE DE CETTE EXÉCUTION (après LOG_OFF) — jamais sur un log historique. ---
lp=0
for i in $(seq 1 60); do
  [[ -f "$PIDFILE" ]] && lp=$(cat "$PIDFILE" 2>/dev/null || echo 0)
  if [[ -f "$PIDFILE" && "$lp" =~ ^[1-9][0-9]*$ ]] && kill -0 "$lp" 2>/dev/null \
     && tail -c +$((LOG_OFF + 1)) "$RUNLOG" 2>/dev/null | grep -q '"event":"seed_ok"'; then
    break
  fi
  if [[ -f "$RUNLOG" ]] && tail -c +$((LOG_OFF + 1)) "$RUNLOG" 2>/dev/null | grep -q '"event":"fatal"'; then
    echo "CT_START_ERROR lanceur en échec (fatal)"; tail -n 20 "$RUNLOG"; exit 1
  fi
  sleep 3
done

if [[ ! "${lp:-0}" =~ ^[1-9][0-9]*$ ]] || ! kill -0 "$lp" 2>/dev/null; then
  echo "CT_START_ERROR seed non signé dans les 180 s (lp=${lp:-0})"; tail -n 30 "$RUNLOG"; exit 1
fi
if ! tail -c +$((LOG_OFF + 1)) "$RUNLOG" 2>/dev/null | grep -q '"event":"seed_ok"'; then
  echo "CT_START_ERROR seed_ok absent"; tail -n 30 "$RUNLOG"; exit 1
fi
echo "execute_ok launcher_pid=$lp seed_signe=1 dir=$(cat "$CURRENT" 2>/dev/null || echo '?')"
