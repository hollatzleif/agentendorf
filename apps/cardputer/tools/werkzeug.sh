#!/usr/bin/env bash
# Richtet die Werkzeuge zum Bauen der Firmware in einem eigenen Ordner ein (nichts davon gehört ins Repo):
# arduino-cli, Arduino-Core esp32:esp32@2.0.17, die Bibliotheken in genau den Versionen der Auslieferung
# und esptool. Mehrfach aufrufbar; was schon da ist, bleibt.
#
#   tools/werkzeug.sh /pfad/zum/werkzeug
#
# Braucht curl, tar, git, python3 und Internet (downloads.arduino.cc, espressif.github.io, github.com, PyPI).
# Hinter einem Proxy: HTTPS_PROXY setzen - das Skript trägt ihn für arduino-cli ein.
set -euo pipefail
W="${1:?Zielordner angeben, z. B. tools/werkzeug.sh ~/cardputer-werkzeug}"
mkdir -p "$W/bin" "$W/dl"
W="$(cd "$W" && pwd)"

if [ ! -x "$W/bin/arduino-cli" ]; then
  curl -fsSL -o "$W/dl/arduino-cli.tgz" https://downloads.arduino.cc/arduino-cli/arduino-cli_1.1.1_Linux_64bit.tar.gz
  tar xzf "$W/dl/arduino-cli.tgz" -C "$W/bin" arduino-cli
fi
if [ ! -f "$W/arduino-cli.yaml" ]; then
  cat > "$W/arduino-cli.yaml" <<YAML
board_manager:
  additional_urls:
    - https://espressif.github.io/arduino-esp32/package_esp32_index.json
directories:
  data: $W/data
  downloads: $W/staging
  user: $W/user
network:
  connection_timeout: 600s
YAML
  if [ -n "${HTTPS_PROXY:-}" ]; then echo "  proxy: $HTTPS_PROXY" >> "$W/arduino-cli.yaml"; fi
fi
CLI=("$W/bin/arduino-cli" --config-file "$W/arduino-cli.yaml")

"${CLI[@]}" core update-index
"${CLI[@]}" core install esp32:esp32@2.0.17
"${CLI[@]}" lib install --no-deps M5Unified@0.2.29 M5GFX@0.2.36 NimBLE-Arduino@2.5.2

# M5Cardputer 1.2.0 (mit der Tastatur des Cardputer Adv) steht nicht im Arduino-Verzeichnis, nur als Git-Tag
if [ ! -f "$W/user/libraries/M5Cardputer/library.properties" ]; then
  rm -rf "$W/dl/m5cardputer-git"
  GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 --branch 1.2.0 https://github.com/m5stack/M5Cardputer.git "$W/dl/m5cardputer-git"
  mkdir -p "$W/user/libraries/M5Cardputer"
  cp -r "$W/dl/m5cardputer-git/src" "$W/dl/m5cardputer-git/library.properties" "$W/user/libraries/M5Cardputer/"
  git -C "$W/dl/m5cardputer-git" rev-parse HEAD > "$W/user/libraries/M5Cardputer/GIT-STAND.txt"
fi

if [ ! -x "$W/venv/bin/python" ]; then python3 -m venv "$W/venv"; fi
"$W/venv/bin/pip" install --quiet esptool==4.8.1

"${CLI[@]}" lib list
echo
echo "Fertig. Bauen:"
echo "  PATH=\"$W/venv/bin:\$PATH\" ARDUINO_CLI=$W/bin/arduino-cli ARDUINO_CONFIG=$W/arduino-cli.yaml tools/build.sh"
