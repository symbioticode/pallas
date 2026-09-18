#!/usr/bin/env bash
# CT-2026-020 - PALLAS-M27 : ROLLBACK.
# Arrête par PID précis le lanceur de campagne et sa descendance (superviseur,
# boucle), consigne un marqueur ROLLBACK dans le dossier de campagne.
# RTO < 5 min ; aucune donnée externes supprimée (campagne à rejouer ensuite).
set -euo pipefail

if [[ "${CT_DRY_RUN:-0}" == "1" ]]; then
  echo "rollback interdit en mode DRY"; exit 2
fi

REPO=/home/andrei/Projects/80_PALLAS/pallas
PIDFILE=$REPO/.pallas/m27-72h-run.pid
CURRENT=$REPO/.pallas/m27-72h-current
cd "$REPO"

pids=()
if [[ -f "$PIDFILE" ]]; then
  pid=$(cat "$PIDFILE" 2>/dev/null || echo 0)
  [[ "$pid" =~ ^[0-9]+$ && "$pid" -gt 1 ]] && pids+=("$pid")
fi
launcher_pids() {
  pgrep -af "m27-72h-run.mjs" 2>/dev/null | awk '$2=="node" || $2 ~ /\/node$/ {print $1}'
}
while IFS= read -r p; do [[ "$p" =~ ^[0-9]+$ ]] && pids+=("$p"); done < <(launcher_pids || true)

for pid in $(printf '%s\n' "${pids[@]}" 2>/dev/null | sort -u); do
  kill -0 "$pid" 2>/dev/null || continue
  echo "rollback: TERM $pid"
  for pp in $(pgrep -P "$pid" 2>/dev/null || true); do
    for gp in $(pgrep -P "$pp" 2>/dev/null || true); do kill -TERM "$gp" 2>/dev/null || true; done
    kill -TERM "$pp" 2>/dev/null || true
  done
  kill -TERM "$pid" 2>/dev/null || true
done

sleep 4
for pid in $(printf '%s\n' "${pids[@]}" 2>/dev/null | sort -u); do
  if kill -0 "$pid" 2>/dev/null; then
    echo "rollback: KILL $pid"
    kill -KILL "$pid" 2>/dev/null || true
  fi
done
rm -f "$PIDFILE"

dir=""
[[ -s "$CURRENT" ]] && dir=$(cat "$CURRENT")
if [[ -n "$dir" && -d "$dir" ]]; then
  printf '{"event":"rollback","at":"%s","reason":"ct-2026-019-rollback","pids":[%s]}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(printf '%s,' "${pids[@]}" | sed 's/,$//')" > "$dir/ROLLBACK"
fi
echo "rollback_ok cibles=${#pids[@]} campagne=$dir"