#!/usr/bin/env bash
# Baut release/agentendorf-cardputer-<Version>.bin (Bootloader + Partitionen + Programm, an 0x0 zu schreiben),
# release/agentendorf-cardputer-<Version>-nur-programm.bin (nur das Programm, an 0x10000) und
# release/SHA256.txt - genau so, wie es ausgeliefert wird.
#
# Voraussetzung (einmalig, siehe tools/werkzeug.sh): arduino-cli mit esp32:esp32@2.0.17 und den Bibliotheken
# M5Unified 0.2.29, M5GFX 0.2.36, M5Cardputer 1.2.0 (Git-Tag), NimBLE-Arduino 2.5.2, dazu esptool.
#
#   W=/pfad/zum/werkzeug          (der Ordner, den tools/werkzeug.sh angelegt hat)
#   PATH="$W/venv/bin:$PATH" ARDUINO_CLI=$W/bin/arduino-cli ARDUINO_CONFIG=$W/arduino-cli.yaml tools/build.sh
# (Das python3 im PATH braucht esptool und pyserial - auch der Arduino-Core ruft es beim Bauen auf.)
#
# Übersetzt wird mit allen Warnungen; eine Warnung im eigenen Code bricht den Bau ab.
set -euo pipefail
cd "$(dirname "$0")/.."
F="$PWD"
VERSION="1.1"
NAME="agentendorf-cardputer-$VERSION"
CLI=("${ARDUINO_CLI:-arduino-cli}")
if [ -n "${ARDUINO_CONFIG:-}" ]; then CLI+=(--config-file "$ARDUINO_CONFIG"); fi
read -r -a ESPTOOL_CMD <<< "${ESPTOOL:-python3 -m esptool}"

# Fester Arbeitsordner: gleiche Pfade -> gleiche Datei (Pfade landen über __FILE__ im Programm)
WORK="${CARDPUTER_BUILD_DIR:-/tmp/agentendorf-cardputer-build}"
SK="$WORK/agentendorf_cardputer"
rm -rf "$SK" "$WORK/out"
mkdir -p "$SK" "$WORK/out" release
echo "// Arduino-Hülle: der Code steht in main.cpp und core/*.cpp" > "$SK/agentendorf_cardputer.ino"
cp src/main.cpp src/core/{app,dorf,dorf_ansichten,json,gfx,cardo_data,fonts_data,remote_core}.cpp "$SK/"

LOG="$WORK/build.log"
"${CLI[@]}" compile --no-color --warnings all \
  --fqbn esp32:esp32:esp32s3:FlashSize=8M,FlashMode=dio,PartitionScheme=default_8MB,CDCOnBoot=cdc,USBMode=hwcdc \
  --build-property "compiler.cpp.extra_flags=-I$F/src -I$F/src/core -I$F/include -std=gnu++17" \
  --build-path "$WORK/out" "$SK" 2>&1 | tee "$LOG"

# Warnungen aus unserem Code (Sketch-Ordner oder apps/cardputer) sind Fehler
if grep -E "warning:" "$LOG" | grep -E "$SK/|$F/" ; then
  echo "FEHLER: Warnungen im eigenen Code (siehe oben)." >&2
  exit 1
fi

B="$WORK/out"
DATA="$("${CLI[@]}" config get directories.data 2>/dev/null || echo ~/.arduino15)"
BOOT_APP0="$(find "$DATA" -path '*esp32*/tools/partitions/boot_app0.bin' 2>/dev/null | head -1)"
[ -n "$BOOT_APP0" ] || { echo "boot_app0.bin nicht gefunden (Arduino-Core esp32 installiert?)" >&2; exit 1; }
"${ESPTOOL_CMD[@]}" --chip esp32s3 merge_bin -o "release/$NAME.bin" \
  --flash_mode dio --flash_freq 80m --flash_size 8MB \
  0x0 "$B/agentendorf_cardputer.ino.bootloader.bin" 0x8000 "$B/agentendorf_cardputer.ino.partitions.bin" \
  0xe000 "$BOOT_APP0" 0x10000 "$B/agentendorf_cardputer.ino.bin"
# Nur das Programm (für 0x10000): zum Aktualisieren, ohne die Einstellungen im NVS zu löschen
cp "$B/agentendorf_cardputer.ino.bin" "release/$NAME-nur-programm.bin"
(cd release && sha256sum "$NAME.bin" "$NAME-nur-programm.bin" > SHA256.txt && cat SHA256.txt)
grep -E "Sketch uses|Global variables|Der Sketch|Globale Variablen" "$LOG" || true
