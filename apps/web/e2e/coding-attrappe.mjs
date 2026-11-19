#!/usr/bin/env node
// Nachgebauter Coding-Container für die Browser-Tests (E191): Projektliste wie der Runner (nur mit Geheimnis) und eine
// Seite unter /_dorf/eintritt, auf der „VS Code öffnen“ landet (auf dem Server sitzt dort Caddy vor dem Dorf).
// POST /_test/projekte setzt die Liste.
import http from 'node:http';
const PORT = Number(process.env.CODING_PORT ?? 3996);
const GEHEIMNIS = process.env.CODING_GEHEIMNIS ?? '';
let projekte = [];
http
  .createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
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
