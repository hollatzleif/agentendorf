import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { ARBEIT, Auftrag, claudeArgumente, claudeUmgebung, codingOrdner, codingUmgebung, profilLesen } from './auftrag.js';

/**
 * Runner der Werkstatt: nimmt Aufträge vom Dorf an (nur im internen Netz, mit gemeinsamem Geheimnis),
 * startet das claude-CLI und streamt dessen stream-json-Zeilen als NDJSON zurück.
 * Abbrechen: DELETE /laeufe/<id> → SIGINT (beendet den Zug sauber).
 *
 * Derselbe Runner läuft im Codehaus-Container mit RUNNER_PROFIL=coding (E191): dort darf claude schreiben und Befehle
 * ausführen, arbeitet in /arbeit/<projekt> und es gibt GET /projekte. Das Profil bestimmt der Container, nie der Auftrag.
 */
const PORT = Number(process.env.PORT ?? 4000);
const PROFIL = profilLesen(process.env.RUNNER_PROFIL);
const CODING = PROFIL === 'coding';
const GEHEIMNIS_NAME = CODING ? 'CODING_GEHEIMNIS' : 'WERKSTATT_GEHEIMNIS';
const GEHEIMNIS = process.env[GEHEIMNIS_NAME] ?? '';
const CLAUDE = process.env.CLAUDE_BIN ?? 'claude';
const INTERN_URL = process.env.DORF_INTERN_URL ?? 'http://dorf:3001';
const MCP_BEFEHL = (process.env.MCP_BEFEHL ?? `node ${path.join(import.meta.dirname, 'mcp.js')}`).split(' ');
const arbeit = process.env.ARBEIT_DIR ?? ARBEIT;
// Coding: Projekte liegen dauerhaft in /arbeit – die Lauf-Dateien (Systemprompt) gehören nicht dorthin
const laufOrdner = CODING ? path.join(process.env.LAUF_DIR ?? os.tmpdir(), 'dorf-laeufe') : arbeit;

if (GEHEIMNIS.length < 32) {
  console.error(`${GEHEIMNIS_NAME} fehlt oder ist zu kurz.`);
  process.exit(1);
}
// Ohne beschreibbaren Arbeitsordner kann kein Lauf starten – lieber gleich laut scheitern.
try {
  fs.mkdirSync(arbeit, { recursive: true });
  const probe = path.join(arbeit, `.probe-${process.pid}`);
  fs.mkdirSync(probe);
  fs.rmdirSync(probe);
} catch (e) {
  console.error(
    `Arbeitsordner ${arbeit} ist nicht beschreibbar (${(e as Error).message}). ` +
      (CODING ? 'Der Ordner /srv/dorf/coding muss dem Dorf-Benutzer (DORF_UID) gehören.' : 'In compose.yml muss er als tmpfs mit mode 01777 eingehängt sein.'),
  );
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

const server = http.createServer((req, res) => {
  behandeln(req, res).catch((e: Error) => {
    console.error('Fehler im Runner:', e);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ fehler: `Werkstatt-Fehler: ${e.message}` }));
  });
});

async function behandeln(req: http.IncomingMessage, res: http.ServerResponse) {
  const ende = (status: number, daten: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(daten));
  };
  if (req.url === '/gesundheit') return ende(200, { ok: true, profil: PROFIL, laufend: laufend.size, abo: !!process.env.CLAUDE_CODE_OAUTH_TOKEN });
  if (!berechtigt(req)) return ende(401, { fehler: 'nicht berechtigt' });

  const abbruch = /^\/laeufe\/([0-9a-f-]{36})$/.exec(req.url ?? '');
  if (req.method === 'DELETE' && abbruch) {
    const p = laufend.get(abbruch[1]!);
    if (!p) return ende(404, { fehler: 'läuft nicht' });
    p.kill('SIGINT');
    setTimeout(() => !p.killed && p.exitCode === null && p.kill('SIGTERM'), 20_000).unref();
    return ende(200, { ok: true });
  }

  // Coding: Projektliste für das Codehaus (nur Ordnernamen direkt unter /arbeit, keine Inhalte)
  if (CODING && req.method === 'GET' && req.url === '/projekte') return ende(200, { projekte: projekteListe() });

  if (req.method === 'POST' && req.url === '/laeufe') {
    let a;
    try {
      a = Auftrag.parse(await koerper(req));
    } catch (e) {
      return ende(400, { fehler: `Ungültiger Auftrag: ${(e as Error).message.slice(0, 500)}` });
    }
    if (laufend.has(a.laufId)) return ende(409, { fehler: 'läuft schon' });
    if (!CODING && a.projekt !== undefined) return ende(400, { fehler: 'Ungültiger Auftrag: „projekt“ gibt es nur im Codehaus.' });
    const dir = path.join(laufOrdner, a.laufId);
    const systemDatei = path.join(dir, 'system.md');
    // Werkstatt: leerer Wegwerf-Ordner je Lauf. Coding: der Projektordner (bleibt bestehen).
    const cwd = CODING ? codingOrdner(arbeit, a.projekt) : dir;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(systemDatei, a.system);
      if (CODING) fs.mkdirSync(cwd, { recursive: true });
    } catch (e) {
      return ende(500, { fehler: `Werkstatt kann ihren Arbeitsordner nicht anlegen: ${(e as Error).message}` });
    }
    const args = claudeArgumente(a, { systemDatei, mcpBefehl: MCP_BEFEHL, internUrl: INTERN_URL }, PROFIL);
    // Coding: eigene Prozessgruppe – was der Agent im Hintergrund gestartet hat (Dev-Server, Tests), endet mit dem Lauf
    const p = spawn(CLAUDE, args, {
      cwd,
      env: CODING ? codingUmgebung(process.env) : claudeUmgebung(process.env),
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: CODING,
    });
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
      if (CODING && p.pid) {
        try {
          process.kill(-p.pid, 'SIGTERM');
        } catch {
          // Gruppe schon leer
        }
      }
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
}

function projekteListe() {
  const aus: { name: string; git: boolean; geaendert: number }[] = [];
  for (const e of fs.readdirSync(arbeit, { withFileTypes: true })) {
    if (!e.isDirectory() || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(e.name)) continue;
    const voll = path.join(arbeit, e.name);
    aus.push({ name: e.name, git: fs.existsSync(path.join(voll, '.git')), geaendert: fs.statSync(voll).mtimeMs });
  }
  return aus.sort((a, b) => b.geaendert - a.geaendert).slice(0, 200);
}

server.listen(PORT, '0.0.0.0', () => console.log(`${CODING ? 'Codehaus-Runner' : 'Werkstatt'} bereit auf Port ${PORT}`));
for (const sig of ['SIGTERM', 'SIGINT'] as const)
  process.on(sig, () => {
    for (const p of laufend.values()) p.kill('SIGINT');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 15_000).unref();
  });
