#!/usr/bin/env bash
# Startet einen frischen Testserver mit leerem Vault und gesetztem Passwort (für Playwright).
set -euo pipefail
cd "$(dirname "$0")/../../server"
DATEN=$(mktemp -d)
WEB=$(pwd)/../web/dist
export DATEN_DIR="$DATEN" VAULT_DIR="$DATEN/vault" COOKIE_SICHER=false LOG_LEVEL=warn \
  ORIGIN="http://127.0.0.1:${E2E_PORT:-3999}" PORT="${E2E_PORT:-3999}" HOST=127.0.0.1 \
  WEB_DIR="$WEB" DORF_VERSION=e2e DORF_MOTOR_ATTRAPPE=1 INTERN_PORT="${E2E_INTERN_PORT:-3001}"
# Nachgebautes Moodle (für die Uni-Tests); endet mit diesem Skript
MOODLE_PORT=${E2E_MOODLE_PORT:-3998}
MOODLE_PORT=$MOODLE_PORT npx tsx test/moodle-e2e.ts &
MOODLE_PID=$!
trap 'kill $MOODLE_PID 2>/dev/null || true' EXIT
# wie bei Leif: Google-Kalender (Fristen aus seinem Skript + JKU Pflicht); der Moodle-App-Zugang ist an der JKU gesperrt
export GOOGLE_FRISTEN_ICS="http://127.0.0.1:$MOODLE_PORT/calendar/ical/fristen/private-e2e/basic.ics"
export GOOGLE_PFLICHT_ICS="http://127.0.0.1:$MOODLE_PORT/calendar/ical/pflicht/private-e2e/basic.ics"
# Nachgebauter Coding-Container (Codehaus, E191): Projektliste + Zielseite für „VS Code öffnen“
CODING_PORT=${E2E_CODING_PORT:-$((MOODLE_PORT - 2))}
export CODING_URL="http://127.0.0.1:$CODING_PORT" CODING_ADRESSE="http://127.0.0.1:$CODING_PORT" \
  CODING_GEHEIMNIS=e2e-coding-geheimnis-e2e-coding-geheimnis-12 CODING_VSCODE_TOKEN=e2e-vscode-token-e2e-vscode-token-123456
CODING_PORT=$CODING_PORT node ../web/e2e/coding-attrappe.mjs &
CODING_PID=$!
trap 'kill $MOODLE_PID $CODING_PID 2>/dev/null || true' EXIT
echo -n 'e2e-Passwort-sehr-lang-1' | npx tsx src/cli.ts passwort --stdin
npx tsx src/start.ts
