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
GELADEN=()
docker() { case "$1" in load) cat >/dev/null; GELADEN+=(geladen) ;; *) : ;; esac; }
compose() { :; }
GESUND=ja
gesund_warten() { [ "$GESUND" = ja ]; }
fehler() { echo "FEHLER: $*" >&2; exit 1; }

buendel() { # version
  local d; d=$(mktemp -d)
  echo "$1" > "$d/VERSION"; cp -r "$HIER/.." "$d/deploy"
  echo "image" | gzip > "$d/image.tar.gz"
  tar -czf "$d.tar.gz" -C "$d" VERSION deploy image.tar.gz
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
echo "ALLE EMPFANGS-TESTS BESTANDEN"
