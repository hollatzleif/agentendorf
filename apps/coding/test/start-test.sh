#!/usr/bin/env bash
# Start-Test des Codehaus-Containers ohne Docker: start.sh mit dem echten Runner (apps/werkstatt/dist, vorher `pnpm build`)
# und einem nachgebauten openvscode-server. Prüft: kein Start ohne Geheimnisse, Git/GitHub-Einrichtung, Token nicht im
# Protokoll und nicht in der Umgebung von VS Code, Gesundheit, Projektliste nur mit Geheimnis, Ende wenn ein Dienst endet.
set -euo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
WURZEL=$(cd "$HIER/../../.." && pwd)
RUNNER="$WURZEL/apps/werkstatt/dist/runner.js"
[ -f "$RUNNER" ] || { echo "Erst bauen: pnpm --filter @dorf/werkstatt build" >&2; exit 1; }
TMP=$(mktemp -d)
PIDS=()
aufraeumen() { for p in "${PIDS[@]:-}"; do [ -z "$p" ] || kill "$p" 2>/dev/null || true; done; rm -rf "$TMP"; }
trap aufraeumen EXIT
ok() { printf '  ✓ %s\n' "$*"; }
fehler() { printf '  ✗ %s\n' "$*" >&2; [ ! -f "$TMP/log" ] || cat "$TMP/log" >&2; exit 1; }

GEHEIMNIS=test-geheimnis-test-geheimnis-test-geheimnis
TOKEN=vscode-token-vscode-token-vscode-token-12
PORT_R=$((4700 + RANDOM % 200))
PORT_V=$((PORT_R + 300))
mkdir -p "$TMP/arbeit/mein-repo/.git" "$TMP/arbeit/zweites" "$TMP/arbeit/.heim" "$TMP/claude"

starten() { # zusätzliche Variablen als NAME=wert
  env -i PATH="$PATH" HOME="$TMP/arbeit/.heim" ARBEIT_DIR="$TMP/arbeit" TMPDIR="$TMP/arbeit/.tmp" CLAUDE_CONFIG_DIR="$TMP/claude" \
    NPM_CONFIG_PREFIX="$TMP/arbeit/.heim/.npm-global" RUNNER_PROFIL=coding PORT="$PORT_R" VSCODE_PORT="$PORT_V" \
    OPENVSCODE_BIN="$HIER/vscode-attrappe.mjs" RUNNER_JS="$RUNNER" LAUF_DIR="$TMP/laeufe" "$@" bash "$HIER/../start.sh"
}

echo "Codehaus-Start"
if starten VSCODE_TOKEN="$TOKEN" > "$TMP/log" 2>&1; then fehler "startet ohne CODING_GEHEIMNIS"; fi
grep -q 'CODING_GEHEIMNIS' "$TMP/log" || fehler "Meldung zu CODING_GEHEIMNIS fehlt"
ok "ohne Runner-Geheimnis kein Start"
if starten CODING_GEHEIMNIS="$GEHEIMNIS" > "$TMP/log" 2>&1; then fehler "startet ohne VSCODE_TOKEN"; fi
if starten CODING_GEHEIMNIS="$GEHEIMNIS" VSCODE_TOKEN=kurz > "$TMP/log" 2>&1; then fehler "startet mit zu kurzem VSCODE_TOKEN"; fi
grep -q 'VSCODE_TOKEN' "$TMP/log" || fehler "Meldung zu VSCODE_TOKEN fehlt"
ok "ohne (gültiges) Verbindungs-Token kein Start – nie ohne Token"

starten CODING_GEHEIMNIS="$GEHEIMNIS" VSCODE_TOKEN="$TOKEN" GH_TOKEN=ghp_testtoken GIT_NAME="Leif Test" GIT_EMAIL=leif@example.org \
  CLAUDE_CODE_OAUTH_TOKEN=abo > "$TMP/log" 2>&1 &
HAUPT=$!
PIDS+=("$HAUPT")
for _ in $(seq 1 50); do
  if PORT="$PORT_R" VSCODE_PORT="$PORT_V" bash "$HIER/../gesund.sh" 2>/dev/null; then break; fi
  sleep 0.2
done
PORT="$PORT_R" VSCODE_PORT="$PORT_V" bash "$HIER/../gesund.sh" || fehler "meldet sich nicht gesund"
ok "Runner und VS Code laufen, gesund.sh ist zufrieden"

curl -fs "http://127.0.0.1:$PORT_R/gesundheit" | jq -e '.profil == "coding" and .abo == true' >/dev/null || fehler "Runner läuft nicht im Profil coding"
ok "Runner im Profil coding"

if grep -q "$TOKEN" "$TMP/log"; then fehler "Verbindungs-Token steht im Protokoll"; fi
grep -q 'tkn=(verborgen)' "$TMP/log" || fehler "Startmeldung von VS Code fehlt im Protokoll"
ok "Verbindungs-Token steht nicht im Protokoll"

[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT_V/")" = 403 ] || fehler "VS Code antwortet ohne Token"
U=$(curl -fs -H "Cookie: vscode-tkn=$TOKEN" "http://127.0.0.1:$PORT_V/umgebung")
jq -e '.umgebung | index("CODING_GEHEIMNIS") == null and index("VSCODE_TOKEN") == null and index("RUNNER_PROFIL") == null' <<<"$U" >/dev/null || fehler "VS Code kennt Runner-Geheimnis oder Token: $U"
jq -e '.umgebung | index("GH_TOKEN") != null and index("CLAUDE_CODE_OAUTH_TOKEN") != null' <<<"$U" >/dev/null || fehler "VS Code-Terminal hätte kein GitHub-/Abo-Token: $U"
jq -e '.args | index("--without-connection-token") == null and index("--connection-token-file") != null' <<<"$U" >/dev/null || fehler "VS Code ohne Token-Datei gestartet"
ok "VS Code: nur mit Token; Terminal hat GitHub- und Abo-Token, aber nicht Runner-Geheimnis/Verbindungs-Token"

G="$TMP/arbeit/.heim/.gitconfig"
[ "$(git config --file "$G" user.name)" = "Leif Test" ] && [ "$(git config --file "$G" user.email)" = leif@example.org ] || fehler "Git-Name/E-Mail nicht gesetzt"
[ "$(git config --file "$G" --get-all credential.https://github.com.helper | tail -1)" = '!gh auth git-credential' ] || fehler "GitHub-Anmeldung für git fehlt"
if grep -q ghp_testtoken "$G"; then fehler "GitHub-Token liegt in der gitconfig"; fi
ok "Git-Name, E-Mail und GitHub-Anmeldung über gh eingerichtet (Token in keiner Datei)"

[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT_R/projekte")" = 401 ] || fehler "Projektliste ohne Geheimnis"
P=$(curl -fs -H "x-werkstatt-geheimnis: $GEHEIMNIS" "http://127.0.0.1:$PORT_R/projekte")
jq -e '[.projekte[].name] | sort == ["mein-repo","zweites"]' <<<"$P" >/dev/null || fehler "Projektliste falsch (versteckte Ordner dürfen nicht erscheinen): $P"
jq -e '.projekte[] | select(.name == "mein-repo") | .git == true' <<<"$P" >/dev/null || fehler "Git-Kennzeichen fehlt"
ok "Projektliste: nur mit Geheimnis, ohne versteckte Ordner (.heim, .tmp)"

# Endet VS Code, endet der Container (Docker startet ihn dann neu)
pkill -f "vscode-attrappe.mjs --host 0.0.0.0 --port $PORT_V" || fehler "VS-Code-Attrappe nicht gefunden"
for _ in $(seq 1 50); do kill -0 "$HAUPT" 2>/dev/null || break; sleep 0.2; done
if kill -0 "$HAUPT" 2>/dev/null; then fehler "start.sh läuft weiter, obwohl VS Code beendet ist"; fi
if curl -fs "http://127.0.0.1:$PORT_R/gesundheit" >/dev/null 2>&1; then fehler "Runner läuft nach dem Ende weiter"; fi
ok "endet VS Code, endet alles (Neustart durch Docker)"
echo "Alle Prüfungen bestanden."
