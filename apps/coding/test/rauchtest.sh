#!/usr/bin/env bash
# Rauchtest des Codehaus-Images (braucht Docker):  bash apps/coding/test/rauchtest.sh <image>
# Startet den Container so, wie compose.yml es tut (nur lesbar, nicht root, keine Rechte), und prüft: VS Code und Runner
# laufen, VS Code nur mit Token, Werkzeuge vorhanden (claude in der festgelegten Version, git, gh, node, python …),
# /arbeit und /vault beschreibbar, Abbild nicht, Token nicht im Protokoll, ohne Geheimnisse kein Start.
# E205: Erweiterungen – `--list-extensions` und Installation einer lokalen Test-VSIX (test-vsix.py, kein Netz nötig).
set -euo pipefail
BILD=${1:?Aufruf: rauchtest.sh <image>}
HIER=$(cd "$(dirname "$0")" && pwd)
NAME="codehaus-rauch-$$"
TMP=$(mktemp -d)
aufraeumen() { docker rm -f "$NAME" >/dev/null 2>&1 || true; docker run --rm -v "$TMP:/t" --entrypoint sh "$BILD" -c 'rm -rf /t/* /t/.[!.]* 2>/dev/null; true' >/dev/null 2>&1 || true; rm -rf "$TMP" 2>/dev/null || true; }
trap aufraeumen EXIT
ok() { printf '  ✓ %s\n' "$*"; }
fehler() { printf '  ✗ %s\n' "$*" >&2; docker logs "$NAME" 2>&1 | tail -30 >&2 || true; exit 1; }
GEHEIMNIS=rauchtest-geheimnis-rauchtest-geheimnis-12
TOKEN=rauchtest-vscode-token-rauchtest-vscode-12
mkdir -p "$TMP/arbeit" "$TMP/vault" "$TMP/claude"
chmod 777 "$TMP/arbeit" "$TMP/vault" "$TMP/claude"
# shellcheck disable=SC2054
LAUF=(--read-only --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 1024 --memory 2g
  --mount type=tmpfs,destination=/tmp,tmpfs-mode=1777 -v "$TMP/arbeit:/arbeit" -v "$TMP/vault:/vault" -v "$TMP/claude:/claude-konfig")
drin() { docker exec "$NAME" "$@"; }

echo "Rauchtest $BILD"
# ohne Geheimnisse startet nichts – und nie ohne Verbindungs-Token
if docker run --rm "${LAUF[@]}" "$BILD" > "$TMP/ohne.log" 2>&1; then fehler "Container startet ohne Geheimnisse"; fi
grep -q 'CODING_GEHEIMNIS' "$TMP/ohne.log" || fehler "Meldung zum fehlenden Geheimnis fehlt: $(cat "$TMP/ohne.log")"
if docker run --rm "${LAUF[@]}" -e CODING_GEHEIMNIS="$GEHEIMNIS" "$BILD" > "$TMP/ohne.log" 2>&1; then fehler "Container startet ohne VSCODE_TOKEN"; fi
ok "ohne Runner-Geheimnis und ohne Verbindungs-Token kein Start"

docker run -d --name "$NAME" "${LAUF[@]}" -e CODING_GEHEIMNIS="$GEHEIMNIS" -e VSCODE_TOKEN="$TOKEN" -e GH_TOKEN=ghp_rauchtest \
  -e GIT_NAME="Rauch Test" -e GIT_EMAIL=rauch@example.org -e DORF_INTERN_URL=http://127.0.0.1:1 "$BILD" >/dev/null
for _ in $(seq 1 60); do drin /app/gesund.sh 2>/dev/null && break; sleep 1; done
drin /app/gesund.sh || fehler "Container meldet sich nicht gesund"
ok "VS Code (3000) und Runner (4000) laufen, gesund.sh zufrieden"

[ "$(drin id -u)" = 1000 ] || fehler "läuft nicht als Benutzer 1000"
drin sh -c '! touch /app/x 2>/dev/null && ! touch /usr/local/x 2>/dev/null' || fehler "Abbild ist beschreibbar"
drin sh -c 'touch /arbeit/probe /vault/probe && rm /arbeit/probe /vault/probe' || fehler "/arbeit oder /vault nicht beschreibbar"
ok "nicht root, Abbild nur lesbar, /arbeit und /vault beschreibbar"

# VS Code: Version offen, alles andere nur mit Token (wie das Dorf es beim Eintritt übergibt)
st() { drin curl -s -o /dev/null -w '%{http_code}' "$@"; }
[ "$(st http://127.0.0.1:3000/version)" = 200 ] || fehler "VS Code /version"
[ "$(st http://127.0.0.1:3000/)" = 403 ] || fehler "VS Code ohne Token erreichbar: $(st http://127.0.0.1:3000/)"
[ "$(st "http://127.0.0.1:3000/?tkn=falsch")" = 403 ] || fehler "VS Code mit falschem Token erreichbar"
[ "$(st "http://127.0.0.1:3000/?tkn=$TOKEN&folder=/arbeit/x")" = 302 ] || fehler "VS Code nimmt das Token nicht an"
[ "$(st -H "Cookie: vscode-tkn=$TOKEN" http://127.0.0.1:3000/)" = 200 ] || fehler "VS Code mit Token-Cookie nicht erreichbar"
drin curl -s -H "Cookie: vscode-tkn=$TOKEN" http://127.0.0.1:3000/ | grep -q 'vscode-remote' || fehler "VS-Code-Seite sieht nicht nach VS Code aus"
if docker logs "$NAME" 2>&1 | grep -q "$TOKEN"; then fehler "Verbindungs-Token steht im Protokoll"; fi
ok "VS Code: ohne/mit falschem Token 403, mit Token 302 → 200; Token nicht im Protokoll"

# Runner: Profil coding, Projektliste nur mit Geheimnis
drin curl -fs http://127.0.0.1:4000/gesundheit | grep -q '"profil":"coding"' || fehler "Runner nicht im Profil coding"
[ "$(st http://127.0.0.1:4000/projekte)" = 401 ] || fehler "Projektliste ohne Geheimnis"
drin sh -c 'mkdir -p /arbeit/rauch'
drin curl -fs -H "x-werkstatt-geheimnis: $GEHEIMNIS" http://127.0.0.1:4000/projekte | grep -q '"name":"rauch"' || fehler "Projektliste zeigt den neuen Ordner nicht"
ok "Runner im Profil coding, Projektliste nur mit Geheimnis"

# Werkzeuge – claude in genau der Version aus dem Dockerfile (dieselbe wie in der Werkstatt)
V=$(sed -n 's/^ARG CLAUDE_CODE_VERSION=//p' "$HIER/../Dockerfile")
drin claude --version | grep -q "^$V " || fehler "claude --version: $(drin claude --version) statt $V"
drin sh -c 'git --version && gh --version && node --version && npm --version && pnpm --version && python3 --version && pip --version && rg --version && jq --version && gcc --version && make --version' > "$TMP/werkzeuge.log" 2>&1 \
  || fehler "ein Werkzeug fehlt: $(tail -3 "$TMP/werkzeuge.log")"
ok "claude $V, git, gh, node/npm/pnpm, python3/pip, rg, jq, gcc, make vorhanden"

# Arbeiten wie ein Agent: git mit Namen aus coding.env, GitHub-Anmeldung über gh, venv, npm-Global im Heimordner, Ausführen in TMPDIR
drin sh -c 'cd /arbeit/rauch && git init -q && echo hallo > a.txt && git add a.txt && git commit -qm "Rauchtest" && git log -1 --format="%an <%ae>"' | grep -qx 'Rauch Test <rauch@example.org>' || fehler "git commit mit Namen/E-Mail"
printf 'protocol=https\nhost=github.com\n\n' | docker exec -i "$NAME" git credential fill 2>/dev/null | grep -qx 'password=ghp_rauchtest' || fehler "git bekommt das GitHub-Token nicht über gh"
drin sh -c '! grep -rq ghp_rauchtest /arbeit/.heim 2>/dev/null' || fehler "GitHub-Token liegt in einer Datei im Heimordner"
# Editor der Dorf-App (E197): Dateien, Suche (rg), Git und ein echtes Terminal (PTY über python3) – im Image, nicht nur im Test
K=(-H "x-werkstatt-geheimnis: $GEHEIMNIS" -H 'content-type: application/json')
[ "$(st 'http://127.0.0.1:4000/editor/baum?projekt=rauch&pfad=')" = 401 ] || fehler "Editor ohne Geheimnis erreichbar"
drin curl -fs "${K[@]}" 'http://127.0.0.1:4000/editor/baum?projekt=rauch&pfad=' | grep -q '"name":"a.txt"' || fehler "Editor: Baum zeigt a.txt nicht"
drin curl -fs "${K[@]}" -d '{"projekt":"rauch","text":"hallo"}' http://127.0.0.1:4000/editor/suche | grep -q '"pfad":"a.txt"' || fehler "Editor: Volltextsuche (rg) findet nichts"
drin curl -fs "${K[@]}" -d '{"projekt":"rauch","befehl":"status"}' http://127.0.0.1:4000/editor/git | grep -q '"git":true' || fehler "Editor: Git-Status"
TID=00000000-0000-4000-8000-000000000001
drin curl -s -m 20 "${K[@]}" -d "{\"id\":\"$TID\",\"projekt\":\"rauch\",\"spalten\":90,\"zeilen\":20}" http://127.0.0.1:4000/terminal > "$TMP/terminal.log" 2>&1 &
TERMINAL_PID=$!
sleep 2
drin curl -fs "${K[@]}" --data-binary 'test -t 0 && echo pty-$((40+2)); stty size; echo "g=[${CODING_GEHEIMNIS:-leer}]"; exit
' "http://127.0.0.1:4000/terminal/$TID/eingabe" >/dev/null || fehler "Terminal nimmt keine Eingabe an: $(cat "$TMP/terminal.log")"
wait "$TERMINAL_PID" || true
grep -q 'pty-42' "$TMP/terminal.log" || fehler "Terminal: kein echtes PTY: $(tail -c 600 "$TMP/terminal.log")"
grep -q '20 90' "$TMP/terminal.log" || fehler "Terminal: Größe stimmt nicht: $(tail -c 600 "$TMP/terminal.log")"
grep -q 'g=\[leer\]' "$TMP/terminal.log" || fehler "Terminal kennt das Runner-Geheimnis"
ok "Editor: Baum, Volltextsuche, Git-Status; Terminal am echten PTY (Größe stimmt, ohne Runner-Geheimnis)"

# Erweiterungen (E205): das echte openvscode-server des Images über den Runner – auflisten, eine lokale Test-VSIX
# installieren (kein Netz nötig), entfernen; Kennungen mit Option/Pfad/Adresse lehnt der Runner ab
[ "$(st http://127.0.0.1:4000/erweiterungen)" = 401 ] || fehler "Erweiterungen ohne Geheimnis erreichbar"
drin /opt/openvscode-server/bin/openvscode-server --server-data-dir /arbeit/.heim/.openvscode-server --list-extensions --show-versions > "$TMP/erw-direkt.log" 2>&1 || fehler "openvscode-server --list-extensions scheitert: $(tail -3 "$TMP/erw-direkt.log")"
drin curl -fs "${K[@]}" http://127.0.0.1:4000/erweiterungen | grep -q '"erweiterungen":\[\]' || fehler "Erweiterungs-Liste ist anfangs nicht leer oder nicht lesbar"
docker exec -i "$NAME" python3 - /arbeit/.tmp/rauchtest.vsix < "$HIER/test-vsix.py" || fehler "Test-VSIX ließ sich nicht bauen"
drin curl -s -m 120 -H "x-werkstatt-geheimnis: $GEHEIMNIS" -H 'content-type: application/octet-stream' --data-binary @/arbeit/.tmp/rauchtest.vsix http://127.0.0.1:4000/erweiterungen/vsix > "$TMP/erw.log" 2>&1 || true
grep -q '"id":"dorf-test.rauchtest","version":"0.0.1"' "$TMP/erw.log" || fehler "VSIX wurde nicht installiert: $(cat "$TMP/erw.log")"
drin /opt/openvscode-server/bin/openvscode-server --server-data-dir /arbeit/.heim/.openvscode-server --list-extensions --show-versions | grep -qx 'dorf-test.rauchtest@0.0.1' || fehler "VS Code selbst listet die Erweiterung nicht"
drin sh -c '[ -z "$(ls -A /arbeit/.heim/vsix)" ]' || fehler "die hochgeladene VSIX-Datei blieb liegen"
for boese in '--foo' 'a.b;rm' '../x' 'https://marketplace.visualstudio.com/x.vsix' '/arbeit/.tmp/rauchtest.vsix'; do
  [ "$(st "${K[@]}" -d "{\"id\":\"$boese\"}" http://127.0.0.1:4000/erweiterungen/installieren)" = 400 ] || fehler "Runner nimmt eine unerlaubte Kennung an: $boese"
done
drin curl -fs "${K[@]}" -d '{"id":"dorf-test.rauchtest"}' http://127.0.0.1:4000/erweiterungen/entfernen | grep -q '"erweiterungen":\[\]' || fehler "Erweiterung ließ sich nicht entfernen"
ok "Erweiterungen: Liste, lokale VSIX installiert und entfernt (echtes openvscode-server), böse Kennungen abgelehnt"

drin sh -c 'cd /arbeit/rauch && python3 -m venv .venv && .venv/bin/python -c "print(6*7)"' | grep -qx 42 || fehler "python venv"
drin sh -c 'printf "#!/bin/sh\necho läuft\n" > "$TMPDIR/probe.sh" && chmod +x "$TMPDIR/probe.sh" && "$TMPDIR/probe.sh"' | grep -qx 'läuft' || fehler "Ausführen in TMPDIR geht nicht"
[ "$(drin npm config get prefix)" = /arbeit/.heim/.npm-global ] || fehler "npm-Global-Ordner liegt nicht im Heimordner"
ok "git-Commit mit Namen, GitHub-Token nur über gh (in keiner Datei), venv, TMPDIR ausführbar, npm -g im Heimordner"

# Was im Container NICHT sein darf: Dorf-Geheimnisse (hier wird geprüft, dass die Umgebung nur das Übergebene kennt)
drin sh -c 'env | grep -E "^(ANTHROPIC_API_KEY|TELEGRAM|GMAIL|EODHD|SAXO|MOODLE|WERKSTATT_GEHEIMNIS|RECHENRAUM|BROWSER_GEHEIMNIS)" && exit 1 || exit 0' || fehler "fremde Geheimnisse in der Umgebung"
ok "keine Dorf-Geheimnisse in der Umgebung"
echo "Rauchtest bestanden."
