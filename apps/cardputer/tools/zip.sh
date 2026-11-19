#!/usr/bin/env bash
# Packt release/agentendorf-cardputer-<Version>.zip für Leif: ANLEITUNG.md, die zwei .bin, SHA256.txt und
# die Bilder im Ordner bilder/ (in der Anleitung wird docs/bilder/ dafür zu bilder/). Ohne Oberordner –
# die Anleitung entpackt direkt nach $HOME\Agentendorf-Cardputer. Vorher tools/build.sh und den Host-Test laufen lassen.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="$(sed -n 's/^VERSION="\(.*\)"$/\1/p' tools/build.sh)"
NAME="agentendorf-cardputer-$VERSION"
(cd release && sha256sum -c SHA256.txt)
python3 - "$NAME" <<'PY'
import sys, zipfile
from pathlib import Path

name = sys.argv[1]
ziel = Path("release") / (name + ".zip")
fest = (2026, 1, 1, 0, 0, 0)      # feste Zeitstempel: gleiche Dateien -> gleiche ZIP


def dazu(z: zipfile.ZipFile, pfad: str, daten: bytes) -> None:
    info = zipfile.ZipInfo(pfad, fest)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    z.writestr(info, daten)


with zipfile.ZipFile(ziel, "w") as z:
    anleitung = Path("ANLEITUNG.md").read_text(encoding="utf-8").replace("docs/bilder/", "bilder/")
    dazu(z, "ANLEITUNG.md", anleitung.encode("utf-8"))
    for datei in (name + ".bin", name + "-nur-programm.bin", "SHA256.txt"):
        dazu(z, datei, (Path("release") / datei).read_bytes())
    for bild in sorted(Path("docs/bilder").glob("*.png")):
        dazu(z, "bilder/" + bild.name, bild.read_bytes())
    print(f"{ziel}: {len(z.namelist())} Dateien")
PY
sha256sum "release/$NAME.zip"
