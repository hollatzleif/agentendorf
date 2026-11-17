#!/usr/bin/env bash
# Startet einen frischen Testserver mit leerem Vault und gesetztem Passwort (für Playwright).
set -euo pipefail
cd "$(dirname "$0")/../../server"
DATEN=$(mktemp -d)
WEB=$(pwd)/../web/dist
export DATEN_DIR="$DATEN" VAULT_DIR="$DATEN/vault" COOKIE_SICHER=false LOG_LEVEL=warn \
  ORIGIN="http://127.0.0.1:${E2E_PORT:-3999}" PORT="${E2E_PORT:-3999}" HOST=127.0.0.1 \
  WEB_DIR="$WEB" DORF_VERSION=e2e DORF_MOTOR_ATTRAPPE=1
# Nachgebautes Moodle (für die Uni-Tests); endet mit diesem Skript
MOODLE_PORT=${E2E_MOODLE_PORT:-3998}
MOODLE_PORT=$MOODLE_PORT npx tsx test/moodle-e2e.ts &
MOODLE_PID=$!
trap 'kill $MOODLE_PID 2>/dev/null || true' EXIT
export MOODLE_URL="http://127.0.0.1:$MOODLE_PORT" MOODLE_TOKEN=abcdef0123456789abcdef0123456789
echo -n 'e2e-Passwort-sehr-lang-1' | npx tsx src/cli.ts passwort --stdin
npx tsx src/start.ts
