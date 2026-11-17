#!/usr/bin/env bash
# Test für "dorf moodle-anmelden": läuft wie auf dem Server als eigener Prozess (set -euo pipefail),
# docker ist eine Attrappe. Fand den stillen Abbruch vom 17.11.2026 (tr </dev/urandom | head mit pipefail).
set -euo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
fehler() { echo "FEHLER: $*" >&2; exit 1; }
BASIS=$(mktemp -d)/srv/dorf
mkdir -p "$BASIS/app/current/deploy"
printf 'DORF_DOMAIN=test.local\nMOODLE_TOKEN=altes-token\n' > "$BASIS/.env"
ATTRAPPEN=$(mktemp -d)
# docker-Attrappe: "compose exec … moodle-token <url> <prüfwert>" prüft den Prüfwert und gibt ein Token aus
cat > "$ATTRAPPEN/docker" <<'DOCKER'
#!/usr/bin/env bash
if [[ " $* " == *" gmail-anmelden-start "* ]]; then
  printf 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x\nVERIFIER123\nSTATE456\n'
  exit 0
fi
if [[ " $* " == *" gmail-anmelden-tauschen "* ]]; then
  e=$(cat)
  [ "$(jq -r .verifier <<<"$e")" = VERIFIER123 ] && [ "$(jq -r .state <<<"$e")" = STATE456 ] || { echo "state/verifier falsch" >&2; exit 1; }
  [[ "$(jq -r .adresse <<<"$e")" == *code=gut* ]] || { echo "Google meldet: access_denied" >&2; exit 1; }
  echo "Verbunden mit leif@example.com." >&2
  printf '1//0gREFRESHtoken-abc_123'
  exit 0
fi
if [[ " $* " == *" google-kalender-pruefen "* ]]; then
  url=$(cat)
  [[ "$url" == *private-aaaa* ]] || { echo "Kalender antwortet mit HTTP 404" >&2; exit 1; }
  echo "Kalender gelesen: 5 kommende Einträge" >&2
  exit 0
fi
if [[ " $* " == *" moodle-kalender-pruefen "* ]]; then
  url=$(cat)
  [[ "$url" == *authtoken=GUT* ]] || { echo "Kalender-Export antwortet mit HTTP 403" >&2; exit 1; }
  echo "Kalender gelesen: 3 Termine" >&2
  exit 0
fi
if [[ " $* " == *" moodle-token "* ]]; then
  adresse=$(cat)
  passport=${*: -1}
  [[ "$passport" =~ ^[0-9]{12}$ ]] || { echo "Prüfwert ungültig: $passport" >&2; exit 1; }
  [ "$adresse" = "moodlemobile://token=GUELTIG" ] || { echo "Signatur passt nicht" >&2; exit 1; }
  printf 'abcdef0123456789abcdef0123456789'
fi
exit 0
DOCKER
chmod +x "$ATTRAPPEN/docker"
dorf() { PATH="$ATTRAPPEN:$PATH" DORF_TEST=1 DORF_BASIS="$BASIS" bash "$HIER/../dorf" "$@"; }

aus=$(printf 'moodlemobile://token=GUELTIG\n' | dorf moodle-anmelden 2>&1) || fehler "moodle-anmelden endet mit Fehler: $aus"
grep -q 'launch.php?service=moodle_mobile_app&passport=[0-9]\{12\}&urlscheme=moodlemobile' <<<"$aus" || fehler "keine Anmelde-Adresse ausgegeben: $aus"
grep -qx 'MOODLE_URL=https://moodle.jku.at' "$BASIS/.env" || fehler "MOODLE_URL fehlt"
grep -qx 'MOODLE_TOKEN=abcdef0123456789abcdef0123456789' "$BASIS/.env" || fehler "MOODLE_TOKEN fehlt"
[ "$(grep -c '^MOODLE_TOKEN=' "$BASIS/.env")" -eq 1 ] || fehler "altes Token nicht ersetzt"
echo "Anmelden mit gültiger Adresse: bestanden"

cp "$BASIS/.env" "$BASIS/env.vorher"
if printf 'moodlemobile://token=FALSCH\n' | dorf moodle-anmelden >/dev/null 2>&1; then fehler "falsche Adresse angenommen"; fi
cmp -s "$BASIS/.env" "$BASIS/env.vorher" || fehler ".env nach Ablehnung verändert"
if printf '\n' | dorf moodle-anmelden >/dev/null 2>&1; then fehler "leere Eingabe angenommen"; fi
if dorf moodle-anmelden 'http://moodle.example' </dev/null >/dev/null 2>&1; then fehler "http-Adresse angenommen"; fi
echo "Ablehnungen ändern nichts: bestanden"

# Kalender-Adresse
K='https://moodle.jku.at/calendar/export_execute.php?userid=4711&authtoken=GUT123&preset_what=all&preset_time=recentupcoming'
aus=$(printf '%s\n' "$K" | dorf moodle-kalender 2>&1) || fehler "moodle-kalender endet mit Fehler: $aus"
grep -qxF "MOODLE_KALENDER_URL=$K" "$BASIS/.env" || fehler "MOODLE_KALENDER_URL nicht gespeichert"
grep -qF 'GUT123' <<<"$aus" && fehler "Kalender-Adresse wurde ausgegeben"
cp "$BASIS/.env" "$BASIS/env.vorher"
for falsch in 'https://moodle.jku.at/calendar/export_execute.php?userid=1&authtoken=SCHLECHT' \
              'http://moodle.jku.at/calendar/export_execute.php?userid=1&authtoken=GUT1' \
              'https://moodle.jku.at/calendar/export.php?authtoken=GUT1' \
              'https://moodle.jku.at/calendar/export_execute.php?userid=1' \
              'https://moodle.jku.at/calendar/export_execute.php?userid=1&authtoken=GUT1;rm -rf /'; do
  if printf '%s\n' "$falsch" | dorf moodle-kalender >/dev/null 2>&1; then fehler "falsche Kalender-Adresse angenommen: $falsch"; fi
done
cmp -s "$BASIS/.env" "$BASIS/env.vorher" || fehler ".env nach abgelehnter Kalender-Adresse verändert"
echo "Kalender-Adresse eintragen und prüfen: bestanden"

# Google-Kalender: beide Adressen, Moodle-Kalender wird danach nicht mehr gebraucht
G1='https://calendar.google.com/calendar/ical/abc123%40group.calendar.google.com/private-aaaa1111bbbb2222cccc3333dddd4444/basic.ics'
G2='https://calendar.google.com/calendar/ical/leif%40gmail.com/private-aaaa5555bbbb6666cccc7777dddd8888/basic.ics'
aus=$(printf '%s\n%s\n' "$G1" "$G2" | dorf google-kalender 2>&1) || fehler "google-kalender endet mit Fehler: $aus"
grep -qxF "GOOGLE_FRISTEN_ICS=$G1" "$BASIS/.env" || fehler "GOOGLE_FRISTEN_ICS fehlt"
grep -qxF "GOOGLE_PFLICHT_ICS=$G2" "$BASIS/.env" || fehler "GOOGLE_PFLICHT_ICS fehlt"
grep -q '^MOODLE_KALENDER_URL=' "$BASIS/.env" && fehler "MOODLE_KALENDER_URL hätte entfernt werden müssen"
grep -qF 'private-aaaa' <<<"$aus" && fehler "geheime Adresse wurde ausgegeben"
# nur die zweite ändern (erste leer lassen)
G3='https://calendar.google.com/calendar/ical/leif%40gmail.com/private-aaaa9999bbbb0000cccc1111dddd2222/basic.ics'
printf '\n%s\n' "$G3" | dorf google-kalender >/dev/null 2>&1 || fehler "nur Pflicht ändern"
grep -qxF "GOOGLE_FRISTEN_ICS=$G1" "$BASIS/.env" || fehler "Fristen-Adresse ging verloren"
grep -qxF "GOOGLE_PFLICHT_ICS=$G3" "$BASIS/.env" || fehler "Pflicht-Adresse nicht ersetzt"
cp "$BASIS/.env" "$BASIS/env.vorher"
for falsch in 'https://calendar.google.com/calendar/ical/x%40gmail.com/public/basic.ics' \
              'https://evil.example/calendar/ical/x/private-aaaa1111bbbb2222/basic.ics' \
              'https://calendar.google.com/calendar/ical/x%40gmail.com/private-bbbb1111cccc2222dddd/basic.ics' \
              'https://calendar.google.com/calendar/ical/x;rm/private-aaaa1111bbbb2222/basic.ics'; do
  if printf '%s\n\n' "$falsch" | dorf google-kalender >/dev/null 2>&1; then fehler "falsche Google-Adresse angenommen: $falsch"; fi
done
cmp -s "$BASIS/.env" "$BASIS/env.vorher" || fehler ".env nach abgelehnter Google-Adresse verändert"
echo "Google-Kalender eintragen, prüfen, Moodle-Kalender ablösen: bestanden"

# Gmail: Client-ID/-Schlüssel prüfen, Adresse tauschen, Token speichern
ID='123456789-abcdef.apps.googleusercontent.com'
aus=$(printf '%s\nGOCSPX-geheim123\nhttp://127.0.0.1:8765/?state=STATE456&code=gut&scope=x\n' "$ID" | dorf gmail-anmelden 2>&1) || fehler "gmail-anmelden endet mit Fehler: $aus"
grep -q 'accounts.google.com' <<<"$aus" || fehler "keine Anmelde-Adresse gezeigt"
grep -qxF "GMAIL_CLIENT_ID=$ID" "$BASIS/.env" || fehler "GMAIL_CLIENT_ID fehlt"
grep -qx 'GMAIL_CLIENT_SECRET=GOCSPX-geheim123' "$BASIS/.env" || fehler "GMAIL_CLIENT_SECRET fehlt"
grep -qx 'GMAIL_REFRESH_TOKEN=1//0gREFRESHtoken-abc_123' "$BASIS/.env" || fehler "GMAIL_REFRESH_TOKEN fehlt"
grep -qF 'GOCSPX-geheim123' <<<"$aus" && fehler "Clientschlüssel wurde ausgegeben"
cp "$BASIS/.env" "$BASIS/env.vorher"
printf '%s\nGOCSPX-geheim123\nhttp://127.0.0.1:8765/?error=access_denied&state=STATE456\n' "$ID" | dorf gmail-anmelden >/dev/null 2>&1 && fehler "abgelehnte Anmeldung gespeichert"
printf 'keine-id\nGOCSPX-x\nx\n' | dorf gmail-anmelden >/dev/null 2>&1 && fehler "falsche Client-ID angenommen"
cmp -s "$BASIS/.env" "$BASIS/env.vorher" || fehler ".env nach abgelehnter Gmail-Anmeldung verändert"
echo "Gmail anmelden: bestanden"

# Unerwartete Fehler werden benannt statt still zu enden (rollback ohne Versionen: ls schlägt fehl)
if aus=$(dorf rollback 2>&1 </dev/null); then fehler "rollback ohne Versionen gelang"; fi
[ -n "$aus" ] || fehler "Fehler endete still"
grep -q 'Abbruch in deploy/dorf, Zeile\|Keine ältere Version' <<<"$aus" || fehler "unklare Meldung: $aus"
echo "Unerwartete Fehler werden benannt: bestanden"
echo "ALLE MOODLE-ANMELDE-TESTS BESTANDEN"
