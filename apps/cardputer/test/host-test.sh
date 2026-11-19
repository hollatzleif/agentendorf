#!/usr/bin/env bash
# Baut die Agentendorf-App des Cardputers für den PC (derselbe Code wie auf dem Gerät) und prüft sie
# gegen den nachgebauten Server (test/testserver.py). Schreibt die Bildschirmfotos nach docs/bilder/.
# Braucht nur g++ und python3.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
CXX="${CXX:-g++}"
"$CXX" -std=c++17 -O2 -Wall -Wextra -Werror -Iinclude -Isrc/core \
  src/core/{app,dorf,dorf_ansichten,json,gfx,cardo_data,fonts_data,remote_core}.cpp \
  host/dorf_host.cpp -o build/dorf-host
# Fernbedienungs-Kern (unverändert aus HaloOS) muss weiter für den Simulator übersetzen
"$CXX" -std=c++17 -O2 -Wall -Wextra -Werror -Iinclude -Isrc/core src/core/remote_core.cpp host/fernbedienung_host.cpp -o build/fb-sim
cd test
python3 host_test.py ../build/dorf-host
