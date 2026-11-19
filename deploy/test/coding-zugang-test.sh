#!/usr/bin/env bash
# Test für den Zugang zu VS Code (E191): der ECHTE deploy/Caddyfile (nur Adressen und Ports ersetzt) vor einem echten
# Dorf-Server und einem nachgebauten VS Code. Prüft die Kette Dorf-Anmeldung → Einmal-Karte → Code-Cookie → forward_auth:
# ohne Anmeldung nichts, das Sitzungs-Cookie des Dorfs erreicht den Coding-Container nie, WebSockets gehen nur mit Cookie,
# Abmelden sperrt, und über die Code-Adresse ist die Dorf-API nicht erreichbar.
# Braucht caddy (CADDY_BIN) und curl. Ohne caddy wird übersprungen – außer CADDY_PFLICHT=1 (CI).
# Mit OPENVSCODE_BIN=/pfad/zu/openvscode-server läuft derselbe Test gegen das echte VS Code.
set -euo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
WURZEL=$(cd "$HIER/../.." && pwd)
CADDY=${CADDY_BIN:-caddy}
if ! command -v "$CADDY" >/dev/null 2>&1; then
  if [ -n "${CADDY_PFLICHT:-}" ]; then echo "FEHLER: caddy fehlt (CADDY_BIN)." >&2; exit 1; fi
  echo "caddy nicht gefunden – Zugangstest übersprungen (CADDY_BIN setzen)."; exit 0
fi
TMP=$(mktemp -d)
PIDS=()
# Jeder Dienst läuft in einer eigenen Prozessgruppe (setsid) – am Ende geht die ganze Gruppe (tsx und VS Code starten Kindprozesse)
aufraeumen() { for p in "${PIDS[@]:-}"; do [ -z "$p" ] || kill -- "-$p" 2>/dev/null || kill "$p" 2>/dev/null || true; done; rm -rf "$TMP"; }
trap aufraeumen EXIT
ok() { printf '  ✓ %s\n' "$*"; }
fehler() { printf '  ✗ %s\n' "$*" >&2; for f in caddy.log dorf.log vscode.log; do [ ! -f "$TMP/$f" ] || { echo "--- $f" >&2; tail -20 "$TMP/$f" >&2; }; done; exit 1; }

P=$((18000 + RANDOM % 1500))
PC=$P; PD=$((P + 1)); PI=$((P + 2)); PV=$((P + 3)); PVI=$((P + 4)); PR=$((P + 5))
GEHEIMNIS=zugangstest-geheimnis-zugangstest-geheimnis
RUNNER="$WURZEL/apps/werkstatt/dist/runner.js"
[ -f "$RUNNER" ] || { echo "Erst bauen: pnpm --filter @dorf/werkstatt build" >&2; exit 1; }
DORF="http://dorf.test:$PC"; CODE="http://code.dorf.test:$PC"
PW='zugangstest-Passwort-lang-1'
TOKEN=vscode-token-vscode-token-vscode-token-12
AUF=(--resolve "dorf.test:$PC:127.0.0.1" --resolve "code.dorf.test:$PC:127.0.0.1")
NAV=(-H 'Sec-Fetch-Mode: navigate' -H 'Sec-Fetch-Dest: document')
WS=(-H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H "Origin: $CODE")
status() { curl -s -o /dev/null -m 10 -w '%{http_code}' "${AUF[@]}" "$@" || true; }

# --- VS Code (Attrappe oder echt) – wie im Container nur lokal; nach außen führt das Tor im Runner (E195) ---
printf '%s' "$TOKEN" > "$TMP/tkn"; chmod 600 "$TMP/tkn"
setsid "${OPENVSCODE_BIN:-$WURZEL/apps/coding/test/vscode-attrappe.mjs}" --host 127.0.0.1 --port "$PVI" --connection-token-file "$TMP/tkn" \
  --server-data-dir "$TMP/vscode" --telemetry-level off > "$TMP/vscode.log" 2>&1 &
PIDS+=("$!")
mkdir -p "$TMP/arbeit"
RUNNER_PROFIL=coding PORT="$PR" VSCODE_PORT="$PV" VSCODE_INTERN_PORT="$PVI" CODING_GEHEIMNIS="$GEHEIMNIS" ARBEIT_DIR="$TMP/arbeit" LAUF_DIR="$TMP/laeufe" \
  setsid node "$RUNNER" > "$TMP/runner.log" 2>&1 &
PIDS+=("$!")

# --- Dorf (echter Server, leerer Vault) ---
(
  cd "$WURZEL/apps/server"
  export DATEN_DIR="$TMP/daten" VAULT_DIR="$TMP/daten/vault" LOG_LEVEL=warn HOST=127.0.0.1 PORT="$PD" INTERN_PORT="$PI" \
    ORIGIN="$DORF" COOKIE_SICHER=false HINTER_PROXY=true VERTRAUTER_PROXY=127.0.0.1 DORF_MOTOR_ATTRAPPE=1 WEB_DIR="$TMP/kein-web" DORF_VERSION=zugangstest \
    CODING_URL="http://127.0.0.1:$PR" CODING_GEHEIMNIS="$GEHEIMNIS" CODING_ADRESSE="$CODE" CODING_VSCODE_TOKEN="$TOKEN"
  echo -n "$PW" | npx tsx src/cli.ts passwort --stdin > /dev/null
  exec setsid npx tsx src/start.ts
) > "$TMP/dorf.log" 2>&1 &
PIDS+=("$!")

# --- Caddy mit dem echten Caddyfile: nur Dienstnamen → lokale Ports, kein HTTPS ---
{ printf '{\n\tadmin off\n\tauto_https off\n}\n'; sed -e "s/dorf:3000/127.0.0.1:$PD/g; s/dorf:3001/127.0.0.1:$PI/g; s/coding:3000/127.0.0.1:$PV/g" "$WURZEL/deploy/Caddyfile"; } > "$TMP/Caddyfile"
grep -q "127.0.0.1:$PI" "$TMP/Caddyfile" && grep -q "127.0.0.1:$PV" "$TMP/Caddyfile" || fehler "Caddyfile: forward_auth oder VS-Code-Ziel nicht gefunden"
DORF_DOMAIN="$DORF" CODING_DOMAIN="$CODE" XDG_DATA_HOME="$TMP/caddy-daten" XDG_CONFIG_HOME="$TMP/caddy-konfig" \
  setsid "$CADDY" run --config "$TMP/Caddyfile" --adapter caddyfile > "$TMP/caddy.log" 2>&1 &
PIDS+=("$!")

for _ in $(seq 1 120); do
  [ "$(status "$DORF/api/gesundheit")" = 200 ] && [ "$(curl -s -o /dev/null -m 3 -w '%{http_code}' "http://127.0.0.1:$PV/version" || true)" = 200 ] && break
  sleep 0.5
done
[ "$(status "$DORF/api/gesundheit")" = 200 ] || fehler "Dorf hinter Caddy startet nicht"

echo "Zugang zu VS Code (Caddyfile + Dorf)"
# 1. Ohne Anmeldung
[ "$(status "$CODE/")" = 401 ] || fehler "VS Code ohne Anmeldung erreichbar: $(status "$CODE/")"
[ "$(status "$CODE/?tkn=$TOKEN")" = 401 ] || fehler "das VS-Code-Token allein öffnet die Tür"
[ "$(status "${WS[@]}" "$CODE/")" = 401 ] || fehler "WebSocket ohne Anmeldung: $(status "${WS[@]}" "$CODE/")"
ziel=$(curl -s -o /dev/null -m 10 -w '%{redirect_url}' "${AUF[@]}" "${NAV[@]}" "$CODE/")
[ "$ziel" = "$DORF/api/coding/oeffnen" ] || fehler "Seitenaufruf ohne Cookie führt nicht zum Dorf, sondern: $ziel"
[ "$(status "$DORF/api/coding/oeffnen")" = 401 ] || fehler "Karte ohne Dorf-Sitzung"
ok "ohne Anmeldung: 401 (auch mit VS-Code-Token, auch WebSocket); Seitenaufruf → Dorf, dort ohne Sitzung 401"

# 2. Über die Code-Adresse ist vom Dorf nur der Eintritt erreichbar
[ "$(status "$CODE/_dorf/eintritt")" = 401 ] || fehler "Eintritt ohne Karte"
[ "$(status "$CODE/_dorf/eintritt?karte=erfunden")" = 401 ] || fehler "Eintritt mit erfundener Karte"
[ "$(status "$CODE/_dorf/anmeldung")" = 404 ] || fehler "/_dorf/* außer eintritt muss 404 sein"
for pfad in /api/gesundheit /api/anmeldung/info /api/ich /intern/coding/zugang /intern/werkzeuge; do
  [ "$(status "$CODE$pfad")" = 401 ] || fehler "Dorf-Pfad $pfad über die Code-Adresse: $(status "$CODE$pfad")"
done
[ "$(status -X POST -H "Origin: $DORF" -H 'content-type: application/json' -d "{\"passwort\":\"$PW\"}" "$CODE/api/anmeldung")" = 401 ] || fehler "Anmeldung über die Code-Adresse möglich"
# … und die interne Prüfung nicht über die Dorf-Adresse
[ "$(curl -s -m 10 "${AUF[@]}" "$DORF/intern/coding/zugang")" != ok ] || fehler "interne Prüfung öffentlich erreichbar"
ok "über die Code-Adresse ist die Dorf-API nicht erreichbar (nur der Eintritt mit Karte)"

# 3. Anmelden im Dorf, VS Code öffnen (curl hält die Cookies je Host auseinander wie ein Browser)
JAR="$TMP/cookies"
[ "$(status -c "$JAR" -X POST -H "Origin: $DORF" -H 'content-type: application/json' -d "{\"passwort\":\"$PW\"}" "$DORF/api/anmeldung")" = 200 ] || fehler "Anmeldung im Dorf"
seite=$(curl -s -m 15 -L -b "$JAR" -c "$JAR" "${AUF[@]}" -w '\n%{http_code} %{url_effective}' "$DORF/api/coding/oeffnen?projekt=mein-repo")
[[ "$(tail -1 <<<"$seite")" == 200\ "$CODE/"* ]] || fehler "Eintritt endet nicht in VS Code: $(tail -1 <<<"$seite")"
[[ "$(tail -1 <<<"$seite")" != *tkn=* ]] || fehler "VS-Code-Token bleibt in der Adresse stehen"
[[ "$(tail -1 <<<"$seite")" == *folder=* ]] || fehler "Projektordner fehlt in der Adresse: $(tail -1 <<<"$seite")"
grep -q $'\tdorf_coding\t' "$JAR" || fehler "Code-Cookie nicht gesetzt"
awk -F'\t' '$6 == "dorf_coding" && $1 !~ /code\.dorf\.test$/ { exit 1 }' "$JAR" || fehler "Code-Cookie gilt nicht nur für den Code-Host"
awk -F'\t' '$6 == "dorf_coding" && $2 != "FALSE" { exit 1 }' "$JAR" || fehler "Code-Cookie gilt für Unterdomänen"
awk -F'\t' '$6 == "dorf_sitzung" && $2 != "FALSE" { exit 1 }' "$JAR" || fehler "Sitzungs-Cookie gilt für Unterdomänen"
[ "$(status -b "$JAR" "$CODE/")" = 200 ] || fehler "VS Code nach dem Eintritt nicht erreichbar"
ok "angemeldet: Dorf → Karte → Code-Cookie (nur Code-Host) → VS Code im Projektordner, Token nicht mehr in der Adresse"

# 4. Was beim Coding-Container ankommt: nie das Sitzungs-Cookie des Dorfs
if [ -z "${OPENVSCODE_BIN:-}" ]; then
  kopf=$(curl -s -m 10 -b "$JAR" "${AUF[@]}" "$CODE/_kopf")
  [[ "$kopf" == *vscode-tkn=* ]] || fehler "VS Code bekam sein Token-Cookie nicht: $kopf"
  [[ "$kopf" != *dorf_sitzung* ]] || fehler "Das Sitzungs-Cookie des Dorfs erreicht den Coding-Container: $kopf"
  # selbst wenn ein Browser es fälschlich mitschickte (gleiches Cookie von Hand): die Prüfung nimmt es nicht als Zugang
  sitzung=$(awk -F'\t' '$6 == "dorf_sitzung" { print $7 }' "$JAR")
  [ "$(status -H "Cookie: dorf_sitzung=$sitzung" "$CODE/")" = 401 ] || fehler "Sitzungs-Cookie des Dorfs öffnet VS Code"
  [ "$(status -H "Cookie: dorf_coding=$sitzung" "$CODE/")" = 401 ] || fehler "Sitzungs-Token als Code-Cookie angenommen"
  ok "das Sitzungs-Cookie des Dorfs kommt im Coding-Container nicht an und öffnet dort nichts"
fi

# 5. WebSocket (so verbindet sich VS Code mit seinem Server) – nur mit Cookie
[ "$(status -b "$JAR" "${WS[@]}" "$CODE/")" = 101 ] || fehler "WebSocket mit Cookie: $(status -b "$JAR" "${WS[@]}" "$CODE/") statt 101"
ok "WebSocket zu VS Code: mit Cookie 101, ohne 401"

# 6. Das Code-Cookie ist kein Dorf-Zugang
code_cookie=$(awk -F'\t' '$6 == "dorf_coding" { print $7 }' "$JAR")
[ "$(status -H "Cookie: dorf_coding=$code_cookie" "$DORF/api/ich")" = 401 ] || fehler "Code-Cookie öffnet das Dorf"
[ "$(status -H "Cookie: dorf_sitzung=$code_cookie" "$DORF/api/ich")" = 401 ] || fehler "Code-Token als Sitzung angenommen"
[ "$(status -b "$JAR" "$DORF/api/ich")" = 200 ] || fehler "Dorf-Sitzung kaputt"
# Schreiben im Dorf mit der Herkunft des Code-Hosts (so sähe eine Anfrage aus VS Code heraus aus): abgelehnt
[ "$(status -b "$JAR" -X POST -H "Origin: $CODE" -H 'content-type: application/json' -d '{}' "$DORF/api/abmeldung")" = 403 ] || fehler "Dorf nimmt Schreibendes vom Code-Host an"
ok "Code-Cookie öffnet das Dorf nicht; das Dorf lehnt Schreibendes mit der Herkunft des Code-Hosts ab"

# 7. Abmelden im Dorf sperrt VS Code sofort – auch eine schon OFFENE Verbindung (Editor/Terminal) wird gekappt (E195)
curl -s -o /dev/null -m 25 "${AUF[@]}" -b "$JAR" "${WS[@]}" "$CODE/offen" &
OFFEN=$!
sleep 1.5
OFFEN_DA=nein; kill -0 "$OFFEN" 2>/dev/null && OFFEN_DA=ja
# (die Attrappe hält /offen sicher offen; ein echtes VS Code kann eine Verbindung ohne sein Protokoll von selbst schließen)
[ "$OFFEN_DA" = ja ] || [ -n "${OPENVSCODE_BIN:-}" ] || fehler "die offene WebSocket-Verbindung hält nicht"
[ "$(status -b "$JAR" -X POST -H "Origin: $DORF" -H 'content-type: application/json' -d '{}' "$DORF/api/abmeldung")" = 200 ] || fehler "Abmelden"
if [ "$OFFEN_DA" = ja ]; then
  for _ in $(seq 1 40); do kill -0 "$OFFEN" 2>/dev/null || break; sleep 0.1; done
  if kill -0 "$OFFEN" 2>/dev/null; then kill "$OFFEN" 2>/dev/null || true; fehler "offene WebSocket-Verbindung zu VS Code besteht nach dem Abmelden weiter"; fi
  ok "Abmelden kappt auch schon offene Verbindungen zu VS Code (Tor im Runner)"
fi
[ "$(status -b "$JAR" "$CODE/")" = 401 ] || fehler "VS Code nach dem Abmelden noch erreichbar"
[ "$(status -b "$JAR" "${WS[@]}" "$CODE/")" = 401 ] || fehler "WebSocket nach dem Abmelden noch möglich"
ok "Abmelden im Dorf sperrt VS Code (Seiten und neue WebSockets)"
echo "Alle Prüfungen bestanden."
