#!/usr/bin/env bash
# Test der Sicherung: 10 Tage simulieren → genau 7 Stände bleiben, Wiederherstellung (Test und echt) funktioniert.
# Braucht restic und sqlite3. Läuft in CI und lokal, ohne Docker.
set -euo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
export DORF_TEST=1
DORF_BASIS=$(mktemp -d)/srv/dorf
export DORF_BASIS
mkdir -p "$DORF_BASIS"/{vault/Uni,daten,syncthing/config,backup,app/current}
echo "DORF_DOMAIN=test.local" > "$DORF_BASIS/.env"
echo "test-passwort" > "$DORF_BASIS/backup/restic-passwort"
echo "<configuration/>" > "$DORF_BASIS/syncthing/config/config.xml"
sqlite3 "$DORF_BASIS/daten/dorf.db" "CREATE TABLE t(x); INSERT INTO t VALUES (42);"

# shellcheck source=../dorf
source "$HIER/../dorf"
# Docker-Aufrufe ersetzen
compose() {
  case "$*" in
    *db-sichern*) sqlite3 "$BASIS/daten/dorf.db" ".backup '$BASIS/daten/sicherung/dorf.db'" ;;
    *) : ;;
  esac
}
gesund_warten() { return 0; }

fehler() { echo "FEHLER: $*" >&2; exit 1; }

for tag in $(seq 10 -1 1); do
  echo "Stand vor $tag Tagen" > "$DORF_BASIS/vault/Uni/notiz.md"
  echo "Datei $tag" > "$DORF_BASIS/vault/Uni/tag-$tag.md"
  DORF_BACKUP_ZEIT=$(date -d "-$tag days 03:30" '+%Y-%m-%d %H:%M:%S') cmd_backup >/dev/null
done
echo "heute" > "$DORF_BASIS/vault/Uni/notiz.md"
cmd_backup >/dev/null

anzahl=$(restic snapshots --json | jq length)
echo "Stände nach 11 Sicherungen: $anzahl"
[ "$anzahl" -eq 7 ] || fehler "erwartet 7 Stände, gefunden $anzahl"
aeltester=$(restic snapshots --json | jq -r 'map(.time) | sort | first')
echo "Ältester Stand: $aeltester"
[ "$(date -d "$aeltester" +%s)" -ge "$(date -d '-7 days' +%s)" ] || fehler "Stand älter als 7 Tage übrig"

cmd_restore_test >/dev/null || fehler "restore-test fehlgeschlagen"
echo "restore-test: bestanden"

# Echte Wiederherstellung auf den Stand von gestern
gestern=$(restic snapshots --json | jq -r 'sort_by(.time) | .[-2].short_id')
echo "versehentlich gelöscht" > "$DORF_BASIS/vault/Uni/notiz.md"
rm "$DORF_BASIS/vault/Uni/tag-1.md"
echo ja | cmd_wiederherstellen "$gestern" >/dev/null
[ "$(cat "$DORF_BASIS/vault/Uni/notiz.md")" = "Stand vor 1 Tagen" ] || fehler "Inhalt nicht wiederhergestellt"
[ -f "$DORF_BASIS/vault/Uni/tag-1.md" ] || fehler "gelöschte Datei nicht zurück"
ls -d "$DORF_BASIS"/vault.vor-wiederherstellung-* >/dev/null || fehler "alter Stand nicht beiseitegelegt"
[ "$(cat "$DORF_BASIS"/vault.vor-wiederherstellung-*/Uni/notiz.md)" = "versehentlich gelöscht" ] || fehler "alter Stand verändert"
echo "Wiederherstellung: bestanden"
echo "ALLE BACKUP-TESTS BESTANDEN"
