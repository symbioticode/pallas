#!/usr/bin/env bash
set -euo pipefail
REPO=/home/andrei/Projects/80_PALLAS/pallas
CT_VERIFY_PUB_KEY=/home/andrei/.pallas-signing/ledger-signing.pub.pem \
  bash "$REPO/scripts/ct/m30-m27-72h/verify.sh"
