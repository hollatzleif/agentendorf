#!/usr/bin/env bash
# Test für "dorf coding-einrichten" / "coding-aus" (E191): läuft wie auf dem Server als eigener Prozess, docker und
# curl (GitHub) sind Attrappen. Prüft: coding.env enthält NUR die sechs Codehaus-Zeilen (nichts aus .env), Rechte 600,
# Geheimnisse werden nicht ausgegeben, Ablehnungen ändern nichts, das Compose-Profil „coding“ folgt dem Schalter.
set -euo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
fehler() { echo "FEHLER: $*" >&2; exit 1; }
BASIS=$(mktemp -d)/srv/dorf
mkdir -p "$BASIS/app/current/deploy"
ABO="sk-ant-oat01-$(printf 'a%.0s' $(seq 1 90))"
ABO2="sk-ant-oat01-$(printf 'b%.0s' $(seq 1 90))"
GH_GUT=github_pat_gutgutgutgutgutgutgutgut_1234567890
printf 'DORF_DOMAIN=test.local\nANTHROPIC_API_KEY=sk-ant-api03-streng-geheim\nTELEGRAM_BOT_TOKEN=123:geheim\nGMAIL_REFRESH_TOKEN=gmail-geheim\nWERKSTATT_GEHEIMNIS=werkstatt-geheimnis-werkstatt-geheimnis-12\n' > "$BASIS/.env"
printf 'WERKSTATT_GEHEIMNIS=werkstatt-geheimnis-werkstatt-geheimnis-12\nCLAUDE_CODE_OAUTH_TOKEN=%s\n' "$ABO" > "$BASIS/werkstatt.env"
ATTRAPPEN=$(mktemp -d)
AUFRUFE="$ATTRAPPEN/aufrufe"
cat > "$ATTRAPPEN/docker" <<DOCKER
#!/usr/bin/env bash
echo "PROFIL=\${COMPOSE_PROFILES:-} CV=\${CODING_VERSION:-} \$*" >> "$AUFRUFE"
exit 0
DOCKER
# GitHub-Attrappe: Token mit „gut“ → Konto, mit „schlecht“ → 401, sonst Netzfehler
cat > "$ATTRAPPEN/curl" <<'CURL'
#!/usr/bin/env bash
case "$*" in
  *api.github.com/user*)
    case "$*" in
      *gutgut*) printf '{"login":"leif-gh","id":4711,"name":"Leif Beispiel"}\n200' ;;
      *schlecht*) printf '{"message":"Bad credentials"}\n401' ;;
      *) printf '\n000' ;;
    esac ;;
esac
exit 0
CURL
chmod +x "$ATTRAPPEN/docker" "$ATTRAPPEN/curl"
dorf() { PATH="$ATTRAPPEN:$PATH" DORF_TEST=1 DORF_BASIS="$BASIS" bash "$HIER/../dorf" "$@"; }

# Ohne Codehaus-Image in dieser Version: klare Meldung, nichts geändert
if printf '\n%s\n\n\n' "$GH_GUT" | dorf coding-einrichten > "$ATTRAPPEN/aus" 2>&1; then fehler "ohne CODING_VERSION angenommen"; fi
grep -q 'noch kein Codehaus-Image' "$ATTRAPPEN/aus" || fehler "Meldung zum fehlenden Image fehlt"
[ ! -f "$BASIS/coding.env" ] || fehler "coding.env ohne Image angelegt"
echo "Ohne Image: bestanden"

echo 1234567890abcdef > "$BASIS/app/current/CODING_VERSION"
echo v1 > "$BASIS/app/current/VERSION"
cp "$HIER/../compose.yml" "$BASIS/app/current/deploy/compose.yml"

# Abgelehnt: falsches GitHub-Token, von GitHub abgelehntes Token, kaputtes Abo-Token, Name mit Sonderzeichen
# (der erste Aufruf ergänzt wie jeder Deploy die übrigen Dorf-Geheimnisse in .env – erst danach vergleichen)
printf '\nkein-token\n' | dorf coding-einrichten > /dev/null 2>&1 || true
cp "$BASIS/.env" "$BASIS/env.vorher"
abgelehnt() { # beschreibung, eingabe
  if printf '%b' "$2" | dorf coding-einrichten > "$ATTRAPPEN/aus" 2>&1; then fehler "$1 angenommen"; fi
  cmp -s "$BASIS/.env" "$BASIS/env.vorher" || fehler ".env nach '$1' verändert"
  ! grep -qE '^(GH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN)=' "$BASIS/coding.env" 2>/dev/null || fehler "coding.env nach '$1' beschrieben"
}
abgelehnt "kein GitHub-Token-Format" '\nirgendwas-anderes\n\n\n'
abgelehnt "von GitHub abgelehntes Token" '\ngithub_pat_schlechtschlechtschlecht_1234\n\n\n'
abgelehnt "API-Schlüssel statt Abo-Token" 'sk-ant-api03-das-ist-kein-abo-token\n'
abgelehnt "abgeschnittenes Abo-Token" 'sk-ant-oat01-kurz\n'
abgelehnt "Name mit Anführungszeichen" "\\n$GH_GUT\\nLeif \"x\"\\n\\n"
abgelehnt "Name mit Dollar" "\\n$GH_GUT\\nLeif \$HOME\\n\\n"
abgelehnt "kaputte E-Mail" "\\n$GH_GUT\\n\\nkeine-mail\\n"
echo "Ablehnungen ändern nichts: bestanden"

# Gültig: Abo der Werkstatt übernehmen (Enter), GitHub-Token, Name/E-Mail aus dem GitHub-Konto (Enter, Enter)
: > "$AUFRUFE"
aus=$(printf '\n%s\n\n\n' "$GH_GUT" | dorf coding-einrichten 2>&1) || fehler "coding-einrichten endet mit Fehler: $aus"
C="$BASIS/coding.env"
grep -q 'angemeldet als leif-gh' <<<"$aus" || fehler "GitHub-Konto nicht gezeigt: $aus"
for geheim in "$GH_GUT" "$ABO" sk-ant-api03 "$(grep '^CODING_GEHEIMNIS=' "$BASIS/.env" | cut -d= -f2)" "$(grep '^CODING_VSCODE_TOKEN=' "$BASIS/.env" | cut -d= -f2)"; do
  ! grep -qF "$geheim" <<<"$aus" || fehler "Geheimnis wurde ausgegeben: ${geheim:0:12}…"
done
[ "$(stat -c %a "$C")" = 600 ] || fehler "coding.env hat Rechte $(stat -c %a "$C") statt 600"
grep -qxF "CLAUDE_CODE_OAUTH_TOKEN=$ABO" "$C" || fehler "Abo-Token der Werkstatt nicht übernommen"
grep -qxF "GH_TOKEN=$GH_GUT" "$C" || fehler "GH_TOKEN fehlt"
grep -qx 'GIT_NAME=Leif Beispiel' "$C" || fehler "GIT_NAME nicht aus dem GitHub-Konto: $(grep GIT_NAME "$C")"
grep -qx 'GIT_EMAIL=4711+leif-gh@users.noreply.github.com' "$C" || fehler "GIT_EMAIL nicht die noreply-Adresse: $(grep GIT_EMAIL "$C")"
G=$(grep -E '^CODING_GEHEIMNIS=' "$BASIS/.env" | cut -d= -f2); V=$(grep -E '^CODING_VSCODE_TOKEN=' "$BASIS/.env" | cut -d= -f2)
[ "${#G}" -ge 32 ] && [ "${#V}" -ge 32 ] && [ "$G" != "$V" ] || fehler "Runner-Geheimnis/VS-Code-Token nicht erzeugt"
grep -qxF "CODING_GEHEIMNIS=$G" "$C" && grep -qxF "VSCODE_TOKEN=$V" "$C" || fehler "Geheimnis/Token in coding.env passen nicht zu .env"
grep -qx 'CODING_AN=ja' "$BASIS/.env" || fehler "Schalter CODING_AN fehlt"
# Das Wichtigste: in coding.env steht NICHTS anderes – kein API-Schlüssel, kein Telegram-, Gmail-, Werkstatt-Geheimnis
[ "$(grep -vcE '^(#.*|CODING_GEHEIMNIS=.*|VSCODE_TOKEN=.*|CLAUDE_CODE_OAUTH_TOKEN=.*|GH_TOKEN=.*|GIT_NAME=.*|GIT_EMAIL=.*)$' "$C")" -eq 0 ] || fehler "coding.env enthält fremde Zeilen: $(grep -vE '^#' "$C" | cut -d= -f1 | tr '\n' ' ')"
for fremd in ANTHROPIC_API_KEY TELEGRAM GMAIL WERKSTATT_GEHEIMNIS sk-ant-api03 gmail-geheim; do ! grep -q "$fremd" "$C" || fehler "coding.env enthält $fremd"; done
[ -d "$BASIS/coding" ] && [ -d "$BASIS/claude-coding" ] || fehler "Ordner coding/claude-coding fehlen"
grep -q 'PROFIL=coding CV=1234567890abcdef compose .* up -d --force-recreate coding dorf' "$AUFRUFE" || fehler "Dienst nicht mit Profil coding gestartet: $(cat "$AUFRUFE")"
grep -q 'exec -T coding /app/gesund.sh' "$AUFRUFE" || fehler "Gesundheit des Codehauses nicht geprüft"
echo "Einrichten (Abo übernommen, GitHub geprüft, nur Codehaus-Geheimnisse in coding.env): bestanden"

# Erneut: Enter überall behält alles; Geheimnisse bleiben dieselben (laufende Sitzungen brechen nicht)
cp "$C" "$BASIS/coding.vorher"
printf '\n\n\n\n' | dorf coding-einrichten > /dev/null 2>&1 || fehler "erneutes Einrichten mit Enter"
cmp -s "$C" "$BASIS/coding.vorher" || fehler "coding.env nach Enter-Enter verändert: $(diff "$C" "$BASIS/coding.vorher" | cut -c1-40)"
# eigenes Abo-Token fürs Codehaus + anderer Name; die Werkstatt behält ihres
printf '%s\n\nLeif Arbeit\nleif@firma.example\n' "$ABO2" | dorf coding-einrichten > /dev/null 2>&1 || fehler "eigenes Abo-Token"
grep -qxF "CLAUDE_CODE_OAUTH_TOKEN=$ABO2" "$C" || fehler "eigenes Abo-Token nicht gespeichert"
grep -qxF "CLAUDE_CODE_OAUTH_TOKEN=$ABO" "$BASIS/werkstatt.env" || fehler "Werkstatt-Token wurde angefasst"
grep -qx 'GIT_NAME=Leif Arbeit' "$C" && grep -qx 'GIT_EMAIL=leif@firma.example' "$C" || fehler "Name/E-Mail nicht geändert"
grep -qxF "GH_TOKEN=$GH_GUT" "$C" || fehler "GitHub-Token ging beim Ändern verloren"
[ "$(grep -c '^CODING_AN=' "$BASIS/.env")" -eq 1 ] && [ "$(grep -c '^CODING_GEHEIMNIS=' "$BASIS/.env")" -eq 1 ] || fehler "doppelte Zeilen in .env"
echo "Erneut einrichten (behalten/ändern): bestanden"

# Ein normaler Deploy hält coding.env mit .env gleich und startet das Profil mit
: > "$AUFRUFE"
dorf_deploy() { PATH="$ATTRAPPEN:$PATH" DORF_TEST=1 DORF_BASIS="$BASIS" bash -c "source '$HIER/../dorf'; geheimnisse_sicherstellen; compose up -d"; }
dorf_deploy || fehler "geheimnisse_sicherstellen + compose"
grep -q 'PROFIL=coding CV=1234567890abcdef compose' "$AUFRUFE" || fehler "Profil coding fehlt beim Deploy: $(cat "$AUFRUFE")"
grep -qxF "CODING_GEHEIMNIS=$G" "$C" && grep -qxF "CLAUDE_CODE_OAUTH_TOKEN=$ABO2" "$C" && grep -qxF "GH_TOKEN=$GH_GUT" "$C" || fehler "Deploy hat coding.env beschädigt"
[ "$(stat -c %a "$C")" = 600 ] || fehler "coding.env nach Deploy nicht 600"
[ "$(grep -c . "$C")" -eq 7 ] || fehler "coding.env hat nach Deploy $(grep -c . "$C") Zeilen statt 7"
echo "Deploy lässt coding.env heil, Profil coding aktiv: bestanden"

# Ausschalten: Container weg, Schalter aus, Daten bleiben; danach kein Profil mehr
touch "$BASIS/coding/projekt-bleibt"
: > "$AUFRUFE"
dorf coding-aus > /dev/null 2>&1 || fehler "coding-aus"
! grep -q '^CODING_AN=' "$BASIS/.env" || fehler "Schalter nach coding-aus noch gesetzt"
grep -q 'PROFIL=coding .* rm -sf coding' "$AUFRUFE" || fehler "Container nicht entfernt: $(cat "$AUFRUFE")"
tail -1 "$AUFRUFE" | grep -q '^PROFIL= ' || fehler "nach coding-aus noch Profil gesetzt: $(tail -1 "$AUFRUFE")"
[ -f "$BASIS/coding/projekt-bleibt" ] && [ -f "$C" ] || fehler "coding-aus hat Daten gelöscht"
# Ohne Image-Kennung in der Version bleibt das Profil aus, auch wenn der Schalter an ist
echo "CODING_AN=ja" >> "$BASIS/.env"; rm "$BASIS/app/current/CODING_VERSION"
: > "$AUFRUFE"; dorf status > /dev/null 2>&1 || true
grep -q '^PROFIL= CV=fehlt compose' "$AUFRUFE" || fehler "Profil ohne CODING_VERSION gesetzt: $(cat "$AUFRUFE")"
echo "Ausschalten und Profil-Schalter: bestanden"
echo "ALLE CODEHAUS-EINRICHTEN-TESTS BESTANDEN"
