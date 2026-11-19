#!/usr/bin/env bash
# Codehaus (E191): startet VS Code im Browser (openvscode-server) und den Runner für die Coding-Agenten.
# Endet einer von beiden, endet der Container (Docker startet ihn neu).
# Geheimnisse kommen nur aus /srv/dorf/coding.env: CODING_GEHEIMNIS, VSCODE_TOKEN, CLAUDE_CODE_OAUTH_TOKEN, GH_TOKEN,
# GIT_NAME, GIT_EMAIL. Nichts aus /srv/dorf/.env.
set -euo pipefail

ARBEIT=${ARBEIT_DIR:-/arbeit}
VSCODE=${OPENVSCODE_BIN:-/opt/openvscode-server/bin/openvscode-server}
RUNNER=${RUNNER_JS:-/app/runner.js}

fehler() { echo "Codehaus: $*" >&2; exit 1; }

# Geheimnisse aus der eingehängten Datei (CODING_KONFIG, im Server /geheim/coding.env = /srv/dorf/coding.env) – nur die
# sechs bekannten Namen, der Wert unverändert bis zum Zeilenende (nichts wird als Shell ausgewertet).
if [ -n "${CODING_KONFIG:-}" ]; then
  [ -r "$CODING_KONFIG" ] || fehler "$CODING_KONFIG ist nicht lesbar – auf dem Server: dorf coding-einrichten"
  while IFS= read -r zeile || [ -n "$zeile" ]; do
    zeile=${zeile%$'\r'}
    case "${zeile%%=*}" in
      CODING_GEHEIMNIS|VSCODE_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|GH_TOKEN|GIT_NAME|GIT_EMAIL)
        [ "$zeile" != "${zeile%%=*}" ] && export "${zeile%%=*}=${zeile#*=}" ;;
    esac
  done < "$CODING_KONFIG"
fi

geheimnis=${CODING_GEHEIMNIS:-}
[ "${#geheimnis}" -ge 32 ] || fehler "CODING_GEHEIMNIS fehlt oder ist zu kurz – auf dem Server: dorf coding-einrichten"
# Ohne Verbindungs-Token startet VS Code nie (kein --without-connection-token): auch im Docker-Netz geht ohne Token nichts.
[[ "${VSCODE_TOKEN:-}" =~ ^[A-Za-z0-9_-]{32,128}$ ]] || fehler "VSCODE_TOKEN fehlt oder ist ungültig – auf dem Server: dorf coding-einrichten"
[ -w "$ARBEIT" ] || fehler "$ARBEIT ist nicht beschreibbar – /srv/dorf/coding muss dem Dorf-Benutzer (DORF_UID) gehören."

mkdir -p "$HOME" "$HOME/.local/bin" "${NPM_CONFIG_PREFIX:-$HOME/.npm-global}/bin" "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
# Zwischendateien auf der Platte (das tmpfs /tmp zählt zum Arbeitsspeicher und erlaubt kein Ausführen); bei jedem Start leer
if [ -n "${TMPDIR:-}" ]; then rm -rf "${TMPDIR:?}" && mkdir -p "$TMPDIR"; fi

# Git: Name/E-Mail aus coding.env; GitHub-Zugang über gh (liest GH_TOKEN aus der Umgebung, nichts liegt in einer Datei)
[ -z "${GIT_NAME:-}" ] || git config --global user.name "$GIT_NAME"
[ -z "${GIT_EMAIL:-}" ] || git config --global user.email "$GIT_EMAIL"
git config --global --get init.defaultBranch >/dev/null || git config --global init.defaultBranch main
if [ -n "${GH_TOKEN:-}" ]; then
  for host in https://github.com https://gist.github.com; do
    git config --global --replace-all "credential.$host.helper" ''
    git config --global --add "credential.$host.helper" '!gh auth git-credential'
  done
fi

TOKEN_DATEI=$(mktemp /tmp/vscode-token.XXXXXX)
chmod 600 "$TOKEN_DATEI"
printf '%s' "$VSCODE_TOKEN" > "$TOKEN_DATEI"

# VS Code und sein Terminal kennen weder das Runner-Geheimnis noch das Verbindungs-Token als Variable.
# Die Startmeldung nennt das Token („…?tkn=“) – das gehört nicht ins Protokoll.
# E195: VS Code lauscht nur im Container selbst; nach außen (Caddy) führt das Tor im Runner auf VSCODE_PORT – so kann
# das Dorf beim Abmelden alle offenen Verbindungen kappen (POST /vscode/trennen).
export VSCODE_INTERN_PORT=${VSCODE_INTERN_PORT:-3100}
env -u CODING_GEHEIMNIS -u VSCODE_TOKEN -u RUNNER_PROFIL -u PORT -u VSCODE_INTERN_PORT -u CODING_KONFIG \
  "$VSCODE" --host 127.0.0.1 --port "$VSCODE_INTERN_PORT" --connection-token-file "$TOKEN_DATEI" \
  --server-data-dir "$HOME/.openvscode-server" --telemetry-level off --default-folder "$ARBEIT" \
  > >(sed -u 's/tkn=[A-Za-z0-9_-]*/tkn=(verborgen)/g') 2>&1 &
VSCODE_PID=$!

env -u VSCODE_TOKEN node "$RUNNER" &
RUNNER_PID=$!

beenden() {
  kill -TERM "$VSCODE_PID" "$RUNNER_PID" 2>/dev/null || true
  wait "$VSCODE_PID" "$RUNNER_PID" 2>/dev/null || true
  rm -f "$TOKEN_DATEI"
}
trap 'beenden; exit 0' TERM INT

# wartet, bis der erste der beiden endet
set +e
wait -n "$VSCODE_PID" "$RUNNER_PID"
code=$?
set -e
echo "Codehaus: ein Dienst hat sich beendet (Code $code) – Container wird neu gestartet." >&2
beenden
exit 1
