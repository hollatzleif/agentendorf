#!/usr/bin/env bash
# Gesund ist das Codehaus, wenn Runner UND VS Code antworten (beide Wege ohne Geheimnis und ohne Inhalt).
set -euo pipefail
node -e "
const p = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + ' ' + r.status); });
Promise.all([p('http://127.0.0.1:${PORT:-4000}/gesundheit'), p('http://127.0.0.1:${VSCODE_PORT:-3000}/version')]).then(() => process.exit(0), () => process.exit(1));
"
