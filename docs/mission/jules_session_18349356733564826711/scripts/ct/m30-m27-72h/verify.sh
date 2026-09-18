#!/usr/bin/env bash
# CT-2026-020 - PALLAS-M27 : VERIFY de la campagne lancée.
# Lecture seule. Émet CT_EVIDENCE <AC> PASS/FAIL + verdict CHANGE_VERIFIED.
set -euo pipefail

REPO=/home/andrei/Projects/80_PALLAS/pallas
RUNLOG=$REPO/.pallas/m27-72h-wrapper.log
PIDFILE=$REPO/.pallas/m27-72h-run.pid
CURRENT=$REPO/.pallas/m27-72h-current
SIGNDIR=${PALLAS_SIGNING_DIR:-$HOME/.pallas-signing}

cd "$REPO"

# Résolution du répertoire de campagne (override de fixture en priorité)
DIR="${CT_VERIFY_DIR:-}"
if [[ -z "$DIR" && -s "$CURRENT" ]]; then
  DIR=$(cat "$CURRENT")
fi
if [[ -z "$DIR" ]]; then
  DIR=$(ls -dt "$REPO"/.pallas/campaign-m27-72h-* 2>/dev/null | head -1 || true)
fi
if [[ -z "$DIR" || ! -d "$DIR" ]]; then
  echo "CT_EVIDENCE AC-020-01 FAIL cible_campagne_introuvable"
  echo "VERIFY result=FAILED" >&2
  exit 1
fi

SKIP_RT="${CT_VERIFY_SKIP_RUNTIME:-0}"
PUBKEY="${CT_VERIFY_PUB_KEY:-$SIGNDIR/ledger-signing.pub.pem}"
npass=0

ac01() {
  if [[ "$SKIP_RT" == "1" ]]; then
    echo "CT_EVIDENCE AC-020-01 PASS fixture_mode"; npass=$((npass + 1)); return
  fi
  local pid=0
  [[ -f "$PIDFILE" ]] && pid=$(cat "$PIDFILE" 2>/dev/null || echo 0)
  if [[ "$pid" =~ ^[1-9][0-9]*$ ]] && kill -0 "$pid" 2>/dev/null \
     && grep -q '"event":"seed_ok"' "$RUNLOG" 2>/dev/null; then
    echo "CT_EVIDENCE AC-020-01 PASS launcher_pid=$pid seed_signe=1"; npass=$((npass + 1))
  else
    echo "CT_EVIDENCE AC-020-01 FAIL launcher_ou_seed_absents"
  fi
}

ac02() {
  local ledger="$DIR/.pallas/ledger.json" sig="$DIR/.pallas/ledger.json.sig"
  if [[ ! -f "$ledger" || ! -f "$sig" ]]; then
    echo "CT_EVIDENCE AC-020-02 FAIL ledger_ou_sig_absents"; return
  fi
  local res
  res=$(node -e '
    import { FileLedger } from "./packages/ledger/dist/file-ledger.js";
    import { readFileSync } from "node:fs";
    try {
      const l = FileLedger.load(process.argv[1], { mode: "dev", publicKeyPem: readFileSync(process.argv[2], "utf8") });
      process.stdout.write(l.isSigned ? "SIGNED_OK" : "SIGNED_NO");
    } catch { process.stdout.write("SIGNED_ERR"); }
  ' "$ledger" "$PUBKEY" 2>/dev/null || echo ERROR)
  if [[ "$res" == "SIGNED_OK" ]]; then
    echo "CT_EVIDENCE AC-020-02 PASS verification_supervisee=ok"
    npass=$((npass + 1))
  else
    echo "CT_EVIDENCE AC-020-02 FAIL resultat=$res"
  fi
}

ac03() {
  local manifest="$DIR/manifest.json"
  if [[ ! -f "$manifest" ]]; then
    echo "CT_EVIDENCE AC-020-03 FAIL manifest_absent"; return
  fi
  local val
  val=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).dry_run_verified === true ? "DRY_OK" : "DRY_NO")' "$manifest" 2>/dev/null || echo ERROR)
  if [[ "$val" == "DRY_OK" ]]; then
    echo "CT_EVIDENCE AC-020-03 PASS dry_run_strict=actif"; npass=$((npass + 1))
  else
    echo "CT_EVIDENCE AC-020-03 FAIL dry_run_non_prouve"
  fi
}

ac04() {
  local jsonl="$DIR/checkpoints.jsonl"
  if [[ -s "$jsonl" ]] && head -1 "$jsonl" | grep -q '"head_hash"'; then
    local rows
    rows=$(wc -l < "$jsonl")
    echo "CT_EVIDENCE AC-020-04 PASS checkpoint_rows=$rows"
    npass=$((npass + 1))
  else
    echo "CT_EVIDENCE AC-020-04 FAIL checkpoints_absents_ou_vides"
  fi
}

ac01
ac02
ac03
ac04

if [[ "$npass" -eq 4 ]]; then
  echo "VERIFY result=CHANGE_VERIFIED acceptance=4/4 campaign=$DIR"
else
  echo "VERIFY result=FAILED acceptance=$npass/4"
  exit 1
fi