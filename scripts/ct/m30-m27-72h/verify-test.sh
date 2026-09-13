#!/usr/bin/env bash
# CT-2026-020 - PALLAS-M27 : épreuve positive + négative du script VERIFY.
# Construit un fixture hermétique dans /tmp (ledger réellement signé par une cle
# jetable), puis éprouve verify.sh : état conforme -> PASS, état altéré -> rejet.
set -euo pipefail

REPO=/home/andrei/Projects/80_PALLAS/pallas
cd "$REPO"

FIX=$(mktemp -d /tmp/m27-ct-fixture.XXXXXX)
trap 'rm -rf "$FIX"' EXIT

build_fixture() {
  rm -rf "$FIX"
  mkdir -p "$FIX"
  FIX_DIR="$FIX" node --input-type=module - <<'EOF'
import { FileLedger, ledgerCheckpointPath } from './packages/ledger/dist/file-ledger.js';
import { generateLedgerSigningKeyPair, signLedgerCheckpoint } from './packages/ledger/dist/ledger-signing.js';
import { atomicWriteFileSafe } from './packages/core/dist/index.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.env.FIX_DIR;
mkdirSync(join(dir, '.pallas'), { recursive: true });
const pair = generateLedgerSigningKeyPair();
writeFileSync(join(dir, 'pub.pem'), pair.publicKeyPem);
writeFileSync(join(dir, 'priv.pem'), pair.privateKeyPem, { mode: 0o600 });
const ledger = join(dir, '.pallas', 'ledger.json');
const boot = FileLedger.load(ledger, { mode: 'dev' });
await boot.append({ event: 'campaign_seed', timestamp: new Date().toISOString(), payload: { note: 'fixture CT-2026-020', tokens: 'fixture' } });
const chain = FileLedger.load(ledger, { mode: 'dev' }).entries;
const cp = signLedgerCheckpoint(pair.privateKeyPem, chain);
atomicWriteFileSafe(ledgerCheckpointPath(ledger), JSON.stringify(cp));
writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ event: 'campaign_manifest', started_at: new Date().toISOString(), target_minutes: 4320, dry_run_verified: true, fixture: true }));
writeFileSync(join(dir, 'checkpoints.jsonl'), JSON.stringify({ index: 1, at: new Date().toISOString(), head_index: cp.head_index, head_hash: cp.head_hash, head_event: cp.head_event, verified_load: true }) + '\n');
console.log('FIXTURE_OK');
EOF
}

run_verify() {
  CT_VERIFY_DIR="$FIX" CT_VERIFY_SKIP_RUNTIME=1 CT_VERIFY_PUB_KEY="$FIX/pub.pem" bash "$REPO/scripts/ct/m30-m27-72h/verify.sh"
}

# --- POSITIF : fixture conforme -> CHANGE_VERIFIED, 4/4 AC ---
build_fixture
out_pos=$(run_verify 2>&1) || true
if printf '%s\n' "$out_pos" | grep -q "VERIFY result=CHANGE_VERIFIED" \
   && [[ $(printf '%s\n' "$out_pos" | grep -c "CT_EVIDENCE AC-020-.* PASS" || true) -eq 4 ]]; then
  echo "VERIFY_TEST positive=PASS"
else
  printf '%s\n' "$out_pos"
  echo "VERIFY_TEST positive=FAIL"
  exit 1
fi

# --- NÉGATIF : signature altérée -> rejet (exit != 0) ---
build_fixture
truncate -s 8 "$FIX/.pallas/ledger.json.sig"
rc=0
out_neg=$(run_verify 2>&1) || rc=$?
if [[ "$rc" -ne 0 ]] && ! printf '%s\n' "$out_neg" | grep -q "CHANGE_VERIFIED" \
   && printf '%s\n' "$out_neg" | grep -q "CT_EVIDENCE AC-020-02 FAIL"; then
  echo "VERIFY_TEST negative=REJECTED"
  exit 0
else
  printf '%s\n' "$out_neg"
  echo "VERIFY_TEST negative=NOT_REJECTED"
  exit 1
fi