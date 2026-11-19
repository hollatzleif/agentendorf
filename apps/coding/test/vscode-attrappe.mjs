#!/usr/bin/env node
// Nachgebautes openvscode-server für Tests: nimmt dieselben Argumente und verhält sich beim Token wie das Original
// (geprüft gegen openvscode-server 1.109.5): /version offen; ?tkn=<token> → Cookie vscode-tkn + Weiterleitung ohne tkn;
// ohne gültiges Cookie 403 „Forbidden.“; WebSocket nur mit Cookie. /_kopf zeigt, welche Kopfzeilen zuletzt ankamen.
import fs from 'node:fs';
import http from 'node:http';
const a = process.argv.slice(2);
const wert = (f) => a[a.indexOf(f) + 1];
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
  res.writeHead(200, { 'content-type': 'text/html' }).end(`<title>VS Code Attrappe</title>Ordner: ${u.searchParams.get('folder') ?? '-'}`);
});
server.on('upgrade', (req, socket) => {
  if (!hatToken(req)) return socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  socket.end('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
});
server.listen(Number(wert('--port')), host === '0.0.0.0' ? '127.0.0.1' : host);
