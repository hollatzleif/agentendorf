#!/usr/bin/env bash
# Startet das Programm (Debug) unter Linux mit virtuellem Bildschirm gegen den e2e-Testserver und prüft die Freigaben:
# Die Dorf-Seite darf zaehler_setzen aufrufen, aber nicht adresse_speichern, neu_verbinden oder Plugin-Befehle.
# Braucht: Xvfb, dbus-run-session, laufenden Testserver auf $DORF (Standard http://127.0.0.1:3999).
set -euo pipefail
cd "$(dirname "$0")/../src-tauri"
DORF=${DORF:-http://127.0.0.1:3999}
KONF=$(mktemp -d)
mkdir -p "$KONF/app.agentendorf.dorf"
printf '{"adresse":"%s/","autostart_eingerichtet":true}\n' "$DORF" > "$KONF/app.agentendorf.dorf/einstellungen.json"
cargo build -q
AUS=$(XDG_CONFIG_HOME="$KONF" DORF_PROGRAMM_SELBSTTEST=1 timeout 60 xvfb-run -a dbus-run-session -- ./target/debug/agentendorf 2>&1 || true)
echo "$AUS" | grep SELBSTTEST || true
echo "$AUS" | grep -q 'SELBSTTEST zaehler 3' || { echo "FEHLER: erlaubter Befehl kam nicht an"; echo "$AUS" | tail -30; exit 1; }
echo "$AUS" | grep -q 'SELBSTTEST zaehler 777' || { echo "FEHLER: ein verbotener Befehl war erlaubt (666) oder der Test lief nicht"; echo "$AUS" | tail -30; exit 1; }
echo "Selbsttest bestanden: erlaubt nur, was freigegeben ist."
