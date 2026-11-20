#!/usr/bin/env node
// Nachgebauter Coding-Container für die Browser-Tests (E191): Projektliste wie der Runner (nur mit Geheimnis) und eine
// Seite unter /_dorf/eintritt, auf der „VS Code öffnen“ landet (auf dem Server sitzt dort Caddy vor dem Dorf).
// POST /_test/projekte setzt die Liste.
// E197 (Editor): /editor/* und /terminal* reicht die Attrappe unverändert an den ECHTEN Runner weiter (RUNNER_PORT,
// von server-starten.sh im Profil coding mit einem Wegwerf-Arbeitsordner gestartet) – so prüfen die Browser-Tests den
// ganzen Weg bis zur Datei, zu git und zur Shell am PTY.
import http from 'node:http';
const PORT = Number(process.env.CODING_PORT ?? 3996);
const RUNNER_PORT = Number(process.env.RUNNER_PORT ?? 0);
const GEHEIMNIS = process.env.CODING_GEHEIMNIS ?? '';
let projekte = [];
http
  .createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (RUNNER_PORT && (u.pathname.startsWith('/editor/') || u.pathname.startsWith('/terminal'))) {
      const weiter = http.request({ host: '127.0.0.1', port: RUNNER_PORT, path: req.url, method: req.method, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        res.flushHeaders();
        r.pipe(res);
      });
      weiter.on('error', () => (res.headersSent ? res.destroy() : res.writeHead(502).end('{}')));
      // schließt das Dorf die Verbindung (Terminal zu, Abmelden), endet auch die zum Runner – der beendet dann die Shell
      res.on('close', () => weiter.destroy());
      req.pipe(weiter);
      return;
    }
    if (u.pathname === '/_test/projekte' && req.method === 'POST') {
      let t = '';
      for await (const s of req) t += s;
      projekte = JSON.parse(t);
      return res.end('ok');
    }
    if (u.pathname === '/projekte') {
      if (req.headers['x-werkstatt-geheimnis'] !== GEHEIMNIS) return res.writeHead(401).end('{}');
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ projekte }));
    }
    if (u.pathname === '/_dorf/eintritt')
      return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<title>VS Code (Attrappe)</title><h1>VS Code (Attrappe)</h1><p id="projekt">${(u.searchParams.get('projekt') ?? '').replace(/[^A-Za-z0-9._-]/g, '')}</p>`);
    res.writeHead(404).end();
  })
  .listen(PORT, '127.0.0.1');
