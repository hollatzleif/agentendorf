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
    load) local inhalt; inhalt=$(cat); case "$inhalt" in rr:*) touch "$BILDER/${inhalt#rr:}" ;; esac ;;
    image)
      case "$2" in
        inspect) [ -e "$BILDER/${3#agentendorf-rechenraum:}" ] ;;
        rm) shift 2; local b; for b in "$@"; do rm -f "$BILDER/${b#agentendorf-rechenraum:}"; done ;;
      esac ;;
    images) ls -1 "$BILDER" ;;
    *) : ;;
  esac
}
compose() { :; }
GESUND=ja
gesund_warten() { [ "$GESUND" = ja ]; }
fehler() { echo "FEHLER: $*" >&2; exit 1; }

buendel() { # version [rechenraum-kennung [mit-image]]
  local d dateien=(VERSION deploy image.tar.gz); d=$(mktemp -d)
  echo "$1" > "$d/VERSION"; cp -r "$HIER/.." "$d/deploy"
  echo "image" | gzip > "$d/image.tar.gz"
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
echo "ALLE EMPFANGS-TESTS BESTANDEN"
