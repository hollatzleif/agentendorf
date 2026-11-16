import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import { ARBEIT, Auftrag, claudeArgumente, claudeUmgebung } from './auftrag.js';

/**
 * Runner der Werkstatt: nimmt Aufträge vom Dorf an (nur im internen Netz, mit gemeinsamem Geheimnis),
 * startet das claude-CLI und streamt dessen stream-json-Zeilen als NDJSON zurück.
 * Abbrechen: DELETE /laeufe/<id> → SIGINT (beendet den Zug sauber).
 */
const PORT = Number(process.env.PORT ?? 4000);
const GEHEIMNIS = process.env.WERKSTATT_GEHEIMNIS ?? '';
const CLAUDE = process.env.CLAUDE_BIN ?? 'claude';
const INTERN_URL = process.env.DORF_INTERN_URL ?? 'http://dorf:3001';
const MCP_BEFEHL = (process.env.MCP_BEFEHL ?? `node ${path.join(import.meta.dirname, 'mcp.js')}`).split(' ');
const arbeit = process.env.ARBEIT_DIR ?? ARBEIT;

if (GEHEIMNIS.length < 32) {
  console.error('WERKSTATT_GEHEIMNIS fehlt oder ist zu kurz.');
  process.exit(1);
}
const laufend = new Map<string, ChildProcess>();

function berechtigt(req: http.IncomingMessage) {
  const h = String(req.headers['x-werkstatt-geheimnis'] ?? '');
  return h.length === GEHEIMNIS.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(GEHEIMNIS));
}

async function koerper(req: http.IncomingMessage) {
  const teile: Buffer[] = [];
  let n = 0;
  for await (const t of req) {
    n += (t as Buffer).length;
    if (n > 5_000_000) throw new Error('zu groß');
    teile.push(t as Buffer);
  }
  return JSON.parse(Buffer.concat(teile).toString('utf8'));
}

const server = http.createServer(async (req, res) => {
  const ende = (status: number, daten: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(daten));
  };
  if (req.url === '/gesundheit') return ende(200, { ok: true, laufend: laufend.size, abo: !!process.env.CLAUDE_CODE_OAUTH_TOKEN });
  if (!berechtigt(req)) return ende(401, { fehler: 'nicht berechtigt' });

  const abbruch = /^\/laeufe\/([0-9a-f-]{36})$/.exec(req.url ?? '');
  if (req.method === 'DELETE' && abbruch) {
    const p = laufend.get(abbruch[1]!);
    if (!p) return ende(404, { fehler: 'läuft nicht' });
    p.kill('SIGINT');
    setTimeout(() => !p.killed && p.exitCode === null && p.kill('SIGTERM'), 20_000).unref();
    return ende(200, { ok: true });
  }

  if (req.method === 'POST' && req.url === '/laeufe') {
    let a;
    try {
      a = Auftrag.parse(await koerper(req));
    } catch (e) {
      return ende(400, { fehler: `Ungültiger Auftrag: ${(e as Error).message.slice(0, 500)}` });
    }
    if (laufend.has(a.laufId)) return ende(409, { fehler: 'läuft schon' });
    const dir = path.join(arbeit, a.laufId);
    fs.mkdirSync(dir, { recursive: true });
    const systemDatei = path.join(dir, 'system.md');
    fs.writeFileSync(systemDatei, a.system);
    const args = claudeArgumente(a, { systemDatei, mcpBefehl: MCP_BEFEHL, internUrl: INTERN_URL });
    const p = spawn(CLAUDE, args, { cwd: dir, env: claudeUmgebung(process.env), stdio: ['pipe', 'pipe', 'pipe'] });
    laufend.set(a.laufId, p);
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    p.stdin.end(a.nachricht);
    let stderr = '';
    p.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });
    const zeilen = readline.createInterface({ input: p.stdout });
    zeilen.on('line', (z) => {
      if (z.trim()) res.write(`${z}\n`);
    });
    p.on('error', (e) => {
      stderr += `\n${e.message}`;
    });
    p.on('close', (code, signal) => {
      laufend.delete(a.laufId);
      res.end(`${JSON.stringify({ type: 'werkstatt_ende', code, signal, stderr })}\n`);
      fs.rmSync(dir, { recursive: true, force: true });
    });
    // Bricht das Dorf die Verbindung ab, wird der Lauf beendet.
    res.on('close', () => {
      if (laufend.has(a.laufId)) p.kill('SIGINT');
    });
    return;
  }
  ende(404, { fehler: 'unbekannt' });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Werkstatt bereit auf Port ${PORT}`));
for (const sig of ['SIGTERM', 'SIGINT'] as const)
  process.on(sig, () => {
    for (const p of laufend.values()) p.kill('SIGINT');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 15_000).unref();
  });
