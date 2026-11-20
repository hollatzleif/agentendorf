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
# Editor im Codehaus (E197): der ECHTE Runner im Profil coding mit einem Wegwerf-Arbeitsordner; die Attrappe reicht
# /editor/* und /terminal* an ihn weiter. Ein Projekt „spielwiese“ (Git-Repository mit einem Commit) liegt bereit.
RUNNER_PORT=${E2E_RUNNER_PORT:-$((MOODLE_PORT - 3))}
ARBEIT="$DATEN/arbeit"
mkdir -p "$ARBEIT/spielwiese/src" "$DATEN/heim" "$DATEN/lauf"
printf '# Spielwiese\n\nEin Projekt zum Ausprobieren. Suchwort: Apfelstrudel.\n' > "$ARBEIT/spielwiese/README.md"
printf 'export function gruss(name: string) {\n  return `Hallo ${name}`;\n}\n' > "$ARBEIT/spielwiese/src/haupt.ts"
export GIT_AUTHOR_NAME=E2E GIT_AUTHOR_EMAIL=e2e@dorf.test GIT_COMMITTER_NAME=E2E GIT_COMMITTER_EMAIL=e2e@dorf.test
(
  cd "$ARBEIT/spielwiese"
  HOME="$DATEN/heim" git init -q -b main
  HOME="$DATEN/heim" git add -A
  HOME="$DATEN/heim" git commit -q -m 'Anfang'
)
(
  cd ../werkstatt
  HOME="$DATEN/heim" PORT=$RUNNER_PORT RUNNER_PROFIL=coding ARBEIT_DIR="$ARBEIT" LAUF_DIR="$DATEN/lauf" exec node --import tsx src/runner.ts
) &
RUNNER_PID=$!
CODING_PORT=$CODING_PORT RUNNER_PORT=$RUNNER_PORT node ../web/e2e/coding-attrappe.mjs &
CODING_PID=$!
trap 'kill $MOODLE_PID $CODING_PID $RUNNER_PID 2>/dev/null || true' EXIT
echo -n 'e2e-Passwort-sehr-lang-1' | npx tsx src/cli.ts passwort --stdin
npx tsx src/start.ts
