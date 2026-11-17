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

# Unerwartete Fehler werden benannt statt still zu enden (rollback ohne Versionen: ls schlägt fehl)
if aus=$(dorf rollback 2>&1 </dev/null); then fehler "rollback ohne Versionen gelang"; fi
[ -n "$aus" ] || fehler "Fehler endete still"
grep -q 'Abbruch in deploy/dorf, Zeile\|Keine ältere Version' <<<"$aus" || fehler "unklare Meldung: $aus"
echo "Unerwartete Fehler werden benannt: bestanden"
echo "ALLE MOODLE-ANMELDE-TESTS BESTANDEN"
