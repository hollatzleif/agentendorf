#!/usr/bin/env bash
# Test des Deploy-Empfangs: Bündel annehmen, Version umschalten, alte Versionen aufräumen, Rollback bei Fehler.
set -euo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
export DORF_TEST=1
DORF_BASIS=$(mktemp -d)/srv/dorf
export DORF_BASIS
mkdir -p "$DORF_BASIS/app/releases"
echo "DORF_DOMAIN=test.local" > "$DORF_BASIS/.env"
# shellcheck source=../dorf
source "$HIER/../dorf"
# docker-Attrappe: merkt sich geladene Rechenraum-Images als Dateien (Inhalt des Bündels „rr:<kennung>“)
BILDER=$(mktemp -d)
docker() {
  case "$1" in
    load) local inhalt; inhalt=$(cat); case "$inhalt" in rr:*) touch "$BILDER/${inhalt#rr:}" ;; bb:*) touch "$BILDER/b-${inhalt#bb:}" ;; cc:*) touch "$BILDER/c-${inhalt#cc:}" ;; esac ;;
    image)
      case "$2" in
        inspect) case "$3" in agentendorf-browser:*) [ -e "$BILDER/b-${3#agentendorf-browser:}" ] ;; agentendorf-coding:*) [ -e "$BILDER/c-${3#agentendorf-coding:}" ] ;; *) [ -e "$BILDER/${3#agentendorf-rechenraum:}" ] ;; esac ;;
        rm) shift 2; local b; for b in "$@"; do case "$b" in agentendorf-browser:*) rm -f "$BILDER/b-${b#agentendorf-browser:}" ;; agentendorf-coding:*) rm -f "$BILDER/c-${b#agentendorf-coding:}" ;; *) rm -f "$BILDER/${b#agentendorf-rechenraum:}" ;; esac; done ;;
      esac ;;
    images) if [ "$2" = agentendorf-browser ]; then find "$BILDER" -name 'b-*' -printf '%f\n' | sed 's/^b-//'; elif [ "$2" = agentendorf-coding ]; then find "$BILDER" -name 'c-*' -printf '%f\n' | sed 's/^c-//'; else find "$BILDER" -type f ! -name 'b-*' ! -name 'c-*' -printf '%f\n'; fi ;;
    *) : ;;
  esac
}
compose() { :; }
GESUND=ja
gesund_warten() { [ "$GESUND" = ja ]; }
fehler() { echo "FEHLER: $*" >&2; exit 1; }

buendel() { # version [rechenraum-kennung [mit-image]]   (BROWSER=kennung[:mit] in der Umgebung → Browser-Image)
  local d dateien=(VERSION deploy image.tar.gz); d=$(mktemp -d)
  if [ -n "${BROWSER:-}" ]; then
    echo "${BROWSER%%:*}" > "$d/BROWSER_VERSION"; dateien+=(BROWSER_VERSION)
    if [ "${BROWSER#*:}" = mit ]; then printf 'bb:%s' "${BROWSER%%:*}" | gzip > "$d/browser.tar.gz"; dateien+=(browser.tar.gz); fi
  fi
  if [ -n "${CODING:-}" ]; then
    echo "${CODING%%:*}" > "$d/CODING_VERSION"; dateien+=(CODING_VERSION)
    if [ "${CODING#*:}" = mit ]; then printf 'cc:%s' "${CODING%%:*}" | gzip > "$d/coding.tar.gz"; dateien+=(coding.tar.gz); fi
  fi
  echo "$1" > "$d/VERSION"; cp -r "$HIER/.." "$d/deploy"
  echo "image" | gzip > "$d/image.tar.gz"
  if [ -n "${PROGRAMME:-}" ]; then
    mkdir -p "$d/programme"
    if [ -n "${NUR_WINDOWS:-}" ]; then
      echo '{"version":"0.2.0","windows":{"installer":"Agentendorf_0.2.0_x64-setup.exe","update":"Agentendorf_0.2.0_x64-setup.exe","signatur":"s"}}' > "$d/programme/programme.json"
      echo EXE > "$d/programme/Agentendorf_0.2.0_x64-setup.exe"
    else
      echo '{"version":"0.1.9","mac":{"installer":"Agentendorf_0.1.9_aarch64.dmg","update":"","signatur":""}}' > "$d/programme/programme.json"; echo DMG > "$d/programme/Agentendorf_0.1.9_aarch64.dmg"
    fi
    echo "$PROGRAMME" > "$d/PROGRAMME_KENNUNG"; dateien+=(programme PROGRAMME_KENNUNG)
  fi
  if [ -n "${2:-}" ]; then
    echo "$2" > "$d/RECHENRAUM_VERSION"; dateien+=(RECHENRAUM_VERSION)
    if [ -n "${3:-}" ]; then printf 'rr:%s' "$2" | gzip > "$d/rechenraum.tar.gz"; dateien+=(rechenraum.tar.gz); fi
  fi
  tar -czf "$d.tar.gz" -C "$d" "${dateien[@]}"
  # wie der Empfänger auf dem Server: nur deploy/dorf vorab auspacken muss gehen
  tar -xzf "$d.tar.gz" -C "$d" deploy/dorf
  echo "$d.tar.gz"
}

for v in v1 v2 v3 v4; do cmd_empfangen < "$(buendel $v)" >/dev/null; done
[ "$(cat "$AKTUELL/VERSION")" = v4 ] || fehler "aktuelle Version sollte v4 sein"
[ "$(find "$APP/releases" -mindepth 1 -maxdepth 1 | wc -l)" -eq 3 ] || fehler "es sollten 3 Versionen bleiben"
[ ! -e "$APP/releases/v1" ] || fehler "v1 hätte aufgeräumt werden müssen"
echo "Umschalten und Aufräumen: bestanden"

GESUND=nein
if cmd_empfangen < "$(buendel v5)" >/dev/null 2>&1; then fehler "kaputter Deploy wurde als Erfolg gemeldet"; fi
[ "$(cat "$AKTUELL/VERSION")" = v4 ] || fehler "Rollback auf v4 hat nicht geklappt"
echo "Rollback bei Fehler: bestanden"

GESUND=ja
( SSH_ORIGINAL_COMMAND="rm -rf /" cmd_ci ) >/dev/null 2>&1 && fehler "fremder Befehl über CI-Schlüssel erlaubt"
echo "CI-Schlüssel nur für 'empfangen': bestanden"
# Wie auf dem Server: Skript als eigener Prozess (nicht eingebunden), docker durch eine Attrappe ersetzt
ATTRAPPEN=$(mktemp -d)
cat > "$ATTRAPPEN/docker" <<'DOCKER'
#!/usr/bin/env bash
[ "${1:-}" = load ] && cat > /dev/null
exit 0
DOCKER
chmod +x "$ATTRAPPEN/docker"
PATH="$ATTRAPPEN:$PATH" bash "$HIER/../dorf" empfangen < "$(buendel v6)" > /dev/null 2>&1 || fehler "dorf empfangen als Prozess endet mit Fehler (Exit $?)"
[ "$(cat "$AKTUELL/VERSION")" = v6 ] || fehler "v6 nicht aktiv"
echo "Empfang als eigener Prozess (Exit-Code 0): bestanden"
# Rechenraum-Image: nur mitschicken, wenn der Server es nicht hat; fehlt es, wird nicht umgeschaltet
RA=aaaaaaaaaaaaaaaa; RB=bbbbbbbbbbbbbbbb; RC=cccccccccccccccc
cmd_empfangen < "$(buendel v7 $RA mit)" >/dev/null || fehler "v7 mit Rechenraum-Image"
[ "$(cat "$AKTUELL/RECHENRAUM_VERSION")" = $RA ] || fehler "RECHENRAUM_VERSION nicht übernommen"
cmd_empfangen < "$(buendel v8 $RA)" >/dev/null || fehler "v8 ohne Image, aber Server hat es"
if cmd_empfangen < "$(buendel v9 $RB)" >/dev/null 2>&1; then fehler "v9 ohne vorhandenes Rechenraum-Image angenommen"; fi
[ "$(cat "$AKTUELL/VERSION")" = v8 ] || fehler "nach fehlendem Rechenraum-Image sollte v8 aktiv bleiben"
[ ! -e "$APP/releases/v9" ] || fehler "v9 hätte gar nicht angelegt werden dürfen"
echo "Rechenraum-Image nur bei Bedarf, fehlendes Image stoppt: bestanden"

[ "$(SSH_ORIGINAL_COMMAND="hat-image $RA" cmd_ci)" = ja ] || fehler "hat-image $RA sollte ja sein"
[ "$(SSH_ORIGINAL_COMMAND="hat-image $RB" cmd_ci)" = nein ] || fehler "hat-image $RB sollte nein sein"
( SSH_ORIGINAL_COMMAND="hat-image $RA; rm -rf /" cmd_ci ) >/dev/null 2>&1 && fehler "hat-image mit Anhang erlaubt"
( SSH_ORIGINAL_COMMAND="hat-image ../x" cmd_ci ) >/dev/null 2>&1 && fehler "hat-image mit Pfad erlaubt"
echo "CI-Befehl hat-image (nur 16 Hex-Zeichen): bestanden"

for v in v10 v11 v12; do cmd_empfangen < "$(buendel $v $RC "$([ $v = v10 ] && echo mit)")" >/dev/null || fehler "$v"; done
[ ! -e "$BILDER/$RA" ] || fehler "nicht mehr gebrauchtes Rechenraum-Image $RA wurde nicht entfernt"
[ -e "$BILDER/$RC" ] || fehler "gebrauchtes Rechenraum-Image $RC wurde entfernt"
echo "Alte Rechenraum-Images aufräumen: bestanden"

# Moodle-Browser: Image nur bei Bedarf, fehlendes Image stoppt, Kennung landet in BROWSER_VERSION (→ Compose-Profil)
BA=1111111111111111; BB=2222222222222222
[ ! -f "$AKTUELL/BROWSER_VERSION" ] || fehler "ohne Browser-Image darf es keine BROWSER_VERSION geben"
BROWSER="$BA:mit" cmd_empfangen < "$(BROWSER="$BA:mit" buendel v13 $RC)" >/dev/null || fehler "v13 mit Browser-Image"
[ "$(cat "$AKTUELL/BROWSER_VERSION")" = $BA ] || fehler "BROWSER_VERSION nicht übernommen"
BROWSER="$BA" cmd_empfangen < "$(BROWSER="$BA" buendel v14 $RC)" >/dev/null || fehler "v14 ohne Image, aber Server hat es"
if cmd_empfangen < "$(BROWSER="$BB" buendel v15 $RC)" >/dev/null 2>&1; then fehler "v15 ohne vorhandenes Browser-Image angenommen"; fi
[ "$(cat "$AKTUELL/VERSION")" = v14 ] || fehler "nach fehlendem Browser-Image sollte v14 aktiv bleiben"
[ "$(SSH_ORIGINAL_COMMAND="hat-browser $BA" cmd_ci)" = ja ] || fehler "hat-browser $BA sollte ja sein"
[ "$(SSH_ORIGINAL_COMMAND="hat-browser $BB" cmd_ci)" = nein ] || fehler "hat-browser $BB sollte nein sein"
( SSH_ORIGINAL_COMMAND="hat-browser $BA; rm -rf /" cmd_ci ) >/dev/null 2>&1 && fehler "hat-browser mit Anhang erlaubt"
echo "Browser-Image nur bei Bedarf, hat-browser: bestanden"
# Programme (Etappe 6): nur wenn im Bündel, landen in daten/programme mit KENNUNG; hat-programme fragt sie ab
PK=3333333333333333
mkdir -p "$DORF_BASIS/daten"
[ "$(SSH_ORIGINAL_COMMAND="hat-programme $PK" cmd_ci)" = nein ] || fehler "hat-programme ohne Programme sollte nein sein"
PROGRAMME=$PK cmd_empfangen < "$(PROGRAMME=$PK BROWSER="$BA" buendel v16 $RC)" >/dev/null || fehler "v16 mit Programmen"
[ -f "$DORF_BASIS/daten/programme/Agentendorf_0.1.9_aarch64.dmg" ] || fehler "Programme nicht übernommen"
[ "$(SSH_ORIGINAL_COMMAND="hat-programme $PK" cmd_ci)" = ja ] || fehler "hat-programme $PK sollte ja sein"
BROWSER="$BA" cmd_empfangen < "$(BROWSER="$BA" buendel v17 $RC)" >/dev/null || fehler "v17 ohne Programme"
[ -f "$DORF_BASIS/daten/programme/programme.json" ] || fehler "Programme dürfen ohne neues Bündel nicht verschwinden"
( SSH_ORIGINAL_COMMAND="hat-programme $PK; rm -rf /" cmd_ci ) >/dev/null 2>&1 && fehler "hat-programme mit Anhang erlaubt"
# Nur Windows gebaut (Mac-Bau fiel aus): die alte Mac-Fassung bleibt, mit ihrer alten Version
NUR_WINDOWS=1 PROGRAMME=0000000000000000 BROWSER="$BA" cmd_empfangen < "$(NUR_WINDOWS=1 PROGRAMME=0000000000000000 BROWSER="$BA" buendel v18 $RC)" >/dev/null || fehler "v18 nur Windows"
P="$DORF_BASIS/daten/programme"
[ -f "$P/Agentendorf_0.2.0_x64-setup.exe" ] || fehler "Windows-Programm nicht übernommen"
[ -f "$P/Agentendorf_0.1.9_aarch64.dmg" ] || fehler "alte Mac-Fassung verschwunden"
[ "$(jq -r '.version + " " + .mac.version + " " + .windows.installer' "$P/programme.json")" = "0.2.0 0.1.9 Agentendorf_0.2.0_x64-setup.exe" ] || fehler "programme.json nicht zusammengeführt: $(cat "$P/programme.json")"
[ "$(SSH_ORIGINAL_COMMAND="hat-programme $PK" cmd_ci)" = nein ] || fehler "unvollständige Programme dürfen nicht als fertig gelten"
echo "Programme mitliefern, hat-programme, Teil-Bau: bestanden"
# Codehaus (E191): Image nur bei Bedarf, fehlendes Image stoppt, alte Images werden aufgeräumt, hat-coding
CA=4444444444444444; CB=5555555555555555; CC=6666666666666666
[ ! -f "$AKTUELL/CODING_VERSION" ] || fehler "ohne Codehaus-Image darf es keine CODING_VERSION geben"
# E195: Codehaus nicht eingerichtet (kein CODING_AN=ja) → „aus“: die CI baut und schickt das Image nicht. Kommt doch eines
# (ältere CI), wird es weder geladen noch übernommen.
[ "$(SSH_ORIGINAL_COMMAND="hat-coding $CA" cmd_ci)" = aus ] || fehler "hat-coding ohne Einrichtung sollte aus sein: $(SSH_ORIGINAL_COMMAND="hat-coding $CA" cmd_ci)"
BROWSER="$BA" CODING="$CA:mit" cmd_empfangen < "$(BROWSER="$BA" CODING="$CA:mit" buendel v18c $RC)" >/dev/null || fehler "v18c (Codehaus-Image, aber nicht eingerichtet)"
[ ! -e "$BILDER/c-$CA" ] || fehler "Codehaus-Image geladen, obwohl das Codehaus nicht eingerichtet ist"
[ ! -f "$AKTUELL/CODING_VERSION" ] || fehler "CODING_VERSION übernommen, obwohl das Codehaus nicht eingerichtet ist"
[ "$(cat "$AKTUELL/VERSION")" = v18c ] || fehler "v18c nicht aktiv"
echo "CODING_AN=ja" >> "$DORF_BASIS/.env"
[ "$(SSH_ORIGINAL_COMMAND="hat-coding $CA" cmd_ci)" = nein ] || fehler "hat-coding $CA sollte nein sein"
BROWSER="$BA" CODING="$CA:mit" cmd_empfangen < "$(BROWSER="$BA" CODING="$CA:mit" buendel v19 $RC)" >/dev/null || fehler "v19 mit Codehaus-Image"
[ "$(cat "$AKTUELL/CODING_VERSION")" = $CA ] || fehler "CODING_VERSION nicht übernommen"
[ "$(cat "$AKTUELL/BROWSER_VERSION")" = $BA ] || fehler "BROWSER_VERSION ging mit dem Codehaus verloren"
BROWSER="$BA" CODING="$CA" cmd_empfangen < "$(BROWSER="$BA" CODING="$CA" buendel v20 $RC)" >/dev/null || fehler "v20 ohne Image, aber Server hat es"
if cmd_empfangen < "$(BROWSER="$BA" CODING="$CB" buendel v21 $RC)" >/dev/null 2>&1; then fehler "v21 ohne vorhandenes Codehaus-Image angenommen"; fi
[ "$(cat "$AKTUELL/VERSION")" = v20 ] || fehler "nach fehlendem Codehaus-Image sollte v20 aktiv bleiben"
if cmd_empfangen < "$(BROWSER="$BA" CODING="../../etc:mit" buendel v21 $RC)" >/dev/null 2>&1; then fehler "ungültige CODING_VERSION angenommen"; fi
[ "$(SSH_ORIGINAL_COMMAND="hat-coding $CA" cmd_ci)" = ja ] || fehler "hat-coding $CA sollte ja sein"
[ "$(SSH_ORIGINAL_COMMAND="hat-coding $CB" cmd_ci)" = nein ] || fehler "hat-coding $CB sollte nein sein"
( SSH_ORIGINAL_COMMAND="hat-coding $CA; rm -rf /" cmd_ci ) >/dev/null 2>&1 && fehler "hat-coding mit Anhang erlaubt"
( SSH_ORIGINAL_COMMAND="hat-coding ../x" cmd_ci ) >/dev/null 2>&1 && fehler "hat-coding mit Pfad erlaubt"
for v in v22 v23 v24; do BROWSER="$BA" CODING="$CC$([ $v = v22 ] && echo :mit)" cmd_empfangen < "$(BROWSER="$BA" CODING="$CC$([ $v = v22 ] && echo :mit)" buendel $v $RC)" >/dev/null || fehler "$v"; done
[ ! -e "$BILDER/c-$CA" ] || fehler "nicht mehr gebrauchtes Codehaus-Image $CA wurde nicht entfernt"
[ -e "$BILDER/c-$CC" ] || fehler "gebrauchtes Codehaus-Image $CC wurde entfernt"
[ -e "$BILDER/b-$BA" ] && [ -e "$BILDER/$RC" ] || fehler "Aufräumen der Codehaus-Images hat Browser-/Rechenraum-Image entfernt"
echo "Codehaus-Image nur bei Bedarf, hat-coding, Aufräumen: bestanden"
# Compose bekommt das Profil „browser“ genau dann, wenn die Version eine BROWSER_VERSION hat
# echte compose()-Funktion aus dem Skript wiederherstellen (oben durch eine Attrappe ersetzt)
# shellcheck disable=SC1090
source <(sed -n '/^compose() {/,/^}/p' "$HIER/../dorf")
# shellcheck disable=SC1090
source <(sed -n '/^coding_an() {/p' "$HIER/../dorf")
docker() { [ "$1" = compose ] && echo "BV=$BROWSER_VERSION PROFIL=$COMPOSE_PROFILES"; }
# Codehaus-Image da, aber nicht eingerichtet (kein CODING_AN) → kein Profil coding, und hat-coding meldet „aus“
sed -i '/^CODING_AN=/d' "$DORF_BASIS/.env"
[ "$(SSH_ORIGINAL_COMMAND="hat-coding $CC" cmd_ci)" = aus ] || fehler "hat-coding nach dem Ausschalten sollte aus sein"
[ "$(compose ps)" = "BV=$BA PROFIL=browser" ] || fehler "Compose-Profil fehlt: $(compose ps)"
echo "CODING_AN=ja" >> "$DORF_BASIS/.env"
[ "$(compose ps)" = "BV=$BA PROFIL=browser,coding" ] || fehler "Profil coding fehlt trotz Schalter: $(compose ps)"
rm "$AKTUELL/CODING_VERSION"
[ "$(compose ps)" = "BV=$BA PROFIL=browser" ] || fehler "Profil coding ohne Image: $(compose ps)"
rm "$AKTUELL/BROWSER_VERSION"
[ "$(compose ps)" = "BV=fehlt PROFIL=" ] || fehler "ohne BROWSER_VERSION darf kein Profil gesetzt sein: $(compose ps)"
echo "Compose-Profil für den Browser: bestanden"

# E205: Caddy bekommt einen geänderten Caddyfile – der Container wird nur dann neu erstellt, wenn seine Datei von der der
# aktuellen Version abweicht; läuft Caddy nicht (oder antwortet nicht), passiert nichts
CADDY_LOG=$(mktemp)
CADDY_DRIN=$(mktemp)
mkdir -p "$AKTUELL/deploy"
printf 'neu {\n\theader x\n}\n' > "$AKTUELL/deploy/Caddyfile"
docker() {
  [ "$1" = compose ] || return 0
  case "$*" in
    *"exec -T caddy cat /etc/caddy/Caddyfile"*) [ -s "$CADDY_DRIN" ] || return 1; cat "$CADDY_DRIN" ;;
    *"up -d --force-recreate caddy"*) echo neu >> "$CADDY_LOG"; cp "$AKTUELL/deploy/Caddyfile" "$CADDY_DRIN" ;;
  esac
}
caddy_abgleichen > /dev/null
[ ! -s "$CADDY_LOG" ] || fehler "Caddy neu erstellt, obwohl er nicht läuft"
printf 'alt {\n}\n' > "$CADDY_DRIN"
caddy_abgleichen > /dev/null
[ "$(wc -l < "$CADDY_LOG")" = 1 ] || fehler "Caddy bei geändertem Caddyfile nicht (genau einmal) neu erstellt"
caddy_abgleichen > /dev/null
[ "$(wc -l < "$CADDY_LOG")" = 1 ] || fehler "Caddy neu erstellt, obwohl der Caddyfile gleich ist"
rm -f "$CADDY_LOG" "$CADDY_DRIN"
echo "Caddy bei geändertem Caddyfile neu erstellen: bestanden"
echo "ALLE EMPFANGS-TESTS BESTANDEN"
