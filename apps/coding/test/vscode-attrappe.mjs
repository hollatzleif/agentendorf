#!/usr/bin/env node
// Nachgebautes openvscode-server für Tests: nimmt dieselben Argumente und verhält sich beim Token wie das Original
// (geprüft gegen openvscode-server 1.109.5): /version offen; ?tkn=<token> → Cookie vscode-tkn + Weiterleitung ohne tkn;
// ohne gültiges Cookie 403 „Forbidden.“; WebSocket nur mit Cookie. /_kopf zeigt, welche Kopfzeilen zuletzt ankamen.
import fs from 'node:fs';
import http from 'node:http';
const a = process.argv.slice(2);
const wert = (f) => a[a.indexOf(f) + 1];
// E205: Aufruf als Befehl (so ruft der Runner die Erweiterungen ab) – kein Server; die Argumente stehen in der Antwort,
// damit der Start-Test sieht, dass der Runner denselben Datenordner nennt wie start.sh beim Start von VS Code
if (a.includes('--list-extensions')) {
  console.log(`attrappe.ordner-${Buffer.from(wert('--server-data-dir') ?? '').toString('hex')}@1.0.0`);
  process.exit(0);
}
const token = fs.readFileSync(wert('--connection-token-file'), 'utf8');
const host = a.includes('--host') ? wert('--host') : '127.0.0.1';
console.log(`Web UI available at http://localhost:${wert('--port')}?tkn=${token}`);
const hatToken = (req) => (req.headers.cookie ?? '').split(';').some((c) => c.trim() === `vscode-tkn=${token}`);
let letzte = {};
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/version') return res.end('attrappe');
  if (u.searchParams.get('tkn') === token) {
    u.searchParams.delete('tkn');
    res.writeHead(302, { 'Set-Cookie': `vscode-tkn=${token}; Max-Age=604800; SameSite=Lax`, Location: `${u.pathname}${u.search}` });
    return res.end();
  }
  if (!hatToken(req)) return res.writeHead(403).end('Forbidden.');
  if (u.pathname === '/_kopf') return res.end(JSON.stringify(letzte));
  if (u.pathname === '/umgebung')
    return res.end(JSON.stringify({ args: a, umgebung: Object.keys(process.env).filter((k) => /GEHEIMNIS|TOKEN|^GIT_|PROFIL/.test(k)).sort() }));
  letzte = { url: req.url, cookie: req.headers.cookie ?? '', host: req.headers.host ?? '' };
  // wie das Original: eigene Content-Security-Policy ohne frame-ancestors (die ergänzt Caddy, E205)
  res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "default-src 'self'; frame-src 'self' https://*.vscode-cdn.net data:; connect-src 'self' ws: wss: https:;" }).end(`<title>VS Code Attrappe</title>Ordner: ${u.searchParams.get('folder') ?? '-'}`);
});
server.on('upgrade', (req, socket) => {
  if (!hatToken(req)) return socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  const kopf = 'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n';
  // /offen: Verbindung bleibt bestehen (wie Editor und Terminal im echten VS Code) – für den Test „Abmelden kappt sie“
  if ((req.url ?? '').startsWith('/offen')) {
    socket.on('error', () => {});
    return void socket.write(kopf);
  }
  socket.end(kopf);
});
server.listen(Number(wert('--port')), host === '0.0.0.0' ? '127.0.0.1' : host);
