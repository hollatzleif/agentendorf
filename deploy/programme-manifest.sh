#!/usr/bin/env bash
# Baut aus den CI-Artefakten (programme-Mac/, programme-Windows/) den Programme-Ordner fürs Bündel:
# Installer, Update-Dateien und programme.json (Version, Dateinamen, Signaturen für den Tauri-Updater).
set -euo pipefail
quelle=$1
ziel=$2
mkdir -p "$ziel"
version=""
eintrag() { # $1 = Ordner, $2 = Installer-Muster, $3 = Update-Muster → JSON-Objekt oder null
  local o=$1 inst upd sig=""
  inst=$(cd "$o" 2>/dev/null && ls $2 2>/dev/null | head -1 || true)
  [ -n "$inst" ] || { echo null; return; }
  upd=$(cd "$o" && ls $3 2>/dev/null | head -1 || true)
  cp "$o/$inst" "$ziel/"
  if [ -n "$upd" ] && [ -f "$o/$upd.sig" ]; then
    [ "$upd" = "$inst" ] || cp "$o/$upd" "$ziel/"
    sig=$(cat "$o/$upd.sig")
  else
    upd=""
  fi
  jq -n --arg i "$inst" --arg u "$upd" --arg s "$sig" '{installer: $i, update: $u, signatur: $s}'
}
[ -f "$quelle/programme-Mac/VERSION" ] && version=$(cat "$quelle/programme-Mac/VERSION")
[ -n "$version" ] || { [ -f "$quelle/programme-Windows/VERSION" ] && version=$(cat "$quelle/programme-Windows/VERSION"); }
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Keine gültige Programmversion" >&2; exit 1; }
mac=$(eintrag "$quelle/programme-Mac" '*.dmg' '*.app.tar.gz')
win=$(eintrag "$quelle/programme-Windows" '*-setup.exe' '*-setup.exe')
jq -n --arg v "$version" --arg e "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson m "$mac" --argjson w "$win" \
  '{version: $v, erstellt: $e} + (if $m == null then {} else {mac: $m} end) + (if $w == null then {} else {windows: $w} end)' > "$ziel/programme.json"
cat "$ziel/programme.json"
