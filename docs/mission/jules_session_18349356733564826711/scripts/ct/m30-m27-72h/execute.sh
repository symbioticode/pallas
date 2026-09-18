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
BUNDLE=${CT_BUNDLE_DIR:?CT_BUNDLE_DIR doit designer le bundle CT-2026-020}
MANIFEST=$BUNDLE/bundle-manifest.json
PIN_CHECKER=$BUNDLE/verify-artifact-pins.mjs
LAUNCHER=scripts/m27-72h-run.mjs
RUNLOG=$REPO/.pallas/m27-72h-wrapper.log
PIDFILE=$REPO/.pallas/m27-72h-run.pid
CURRENT=$REPO/.pallas/m27-72h-current
TOKENS="30630994248667897740988010928640156931882346081873066002335460180076741328029,109876868437950584369987384406356259939519193117253465815665152916226511121427,113287701564209339913693347405685749986285999146352375265161592243948562084773,40081275558852222228080198821361202017557872256707631666334039001378518619916"
mkdir -p "$REPO/.pallas"
cd "$REPO"
echo "CT_START real_mutation=true token_targets=4"

# Vérifier l'intégralité du payload avant toute mutation ou neutralisation.
[[ -f "$MANIFEST" && -f "$PIN_CHECKER" && -d "$BUNDLE/artifacts" ]] || {
  echo "CT_START_ERROR bundle incomplet: $BUNDLE"; exit 1;
}
node "$PIN_CHECKER" --manifest "$MANIFEST" --root "$BUNDLE/artifacts" || {
  echo "CT_START_ERROR artifact pin verification rejected"; exit 1;
}

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
while IFS= read -r path; do
  mode=0644
  [[ "$path" == scripts/* || "$path" == crates/risk-engine/target/debug/risk-engine ]] && mode=0755
  install -D -m "$mode" "$BUNDLE/artifacts/$path" "$REPO/$path"
  echo "install_ok artifact=$path"
done < <(node -e 'const m=require(process.argv[1]); for (const p of Object.keys(m.artifacts)) console.log(p)' "$MANIFEST")
node "$PIN_CHECKER" --manifest "$MANIFEST" --root "$REPO" || {
  echo "CT_START_ERROR installed artifact verification rejected"; exit 1;
}

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
