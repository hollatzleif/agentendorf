import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { ARBEIT, Auftrag, claudeArgumente, claudeUmgebung, codingOrdner, codingUmgebung, profilLesen } from './auftrag.js';
import { Editor, EditorFehler, HOCHLADEN_MAX, TEXT_MAX, projektPruefen } from './editor.js';
import { TERMINAL_MAX, Terminals } from './terminal.js';

/**
 * Runner der Werkstatt: nimmt Aufträge vom Dorf an (nur im internen Netz, mit gemeinsamem Geheimnis),
 * startet das claude-CLI und streamt dessen stream-json-Zeilen als NDJSON zurück.
 * Abbrechen: DELETE /laeufe/<id> → SIGINT (beendet den Zug sauber).
 *
 * Derselbe Runner läuft im Codehaus-Container mit RUNNER_PROFIL=coding (E191): dort darf claude schreiben und Befehle
 * ausführen, arbeitet in /arbeit/<projekt> und es gibt GET /projekte. Das Profil bestimmt der Container, nie der Auftrag.
 * Nur dort gibt es auch die Endpunkte für den Editor in der Dorf-App (E197): /editor/* (Dateien, Suche, Git – editor.ts)
 * und /terminal (Shell am PTY – terminal.ts). Im Werkstatt-Profil antworten sie mit 404.
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
// Programm im Terminal (E197): bash; TERMINAL_BEFEHL nur für Tests
const TERMINAL_BEFEHL = process.env.TERMINAL_BEFEHL ? process.env.TERMINAL_BEFEHL.split(' ') : undefined;
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
// Editor und Terminal (E197) – nur Codehaus. Befehle (git, rg, Shell) bekommen dieselbe Umgebung wie der Agent:
// GitHub-Token und Git-Name ja, Runner-Geheimnis und VS-Code-Token nie.
const editor = new Editor(arbeit, () => codingUmgebung(process.env));
const terminals = new Terminals();

function berechtigt(req: http.IncomingMessage) {
  const h = String(req.headers['x-werkstatt-geheimnis'] ?? '');
  return h.length === GEHEIMNIS.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(GEHEIMNIS));
}

async function rohKoerper(req: http.IncomingMessage, max: number) {
  const teile: Buffer[] = [];
  let n = 0;
  for await (const t of req) {
    n += (t as Buffer).length;
    if (n > max) throw new EditorFehler(413, 'Zu groß.');
    teile.push(t as Buffer);
  }
  return Buffer.concat(teile);
}

async function koerper(req: http.IncomingMessage) {
  return JSON.parse((await rohKoerper(req, 5_000_000)).toString('utf8'));
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

  // Coding (E195): alle offenen Verbindungen zu VS Code kappen – das Dorf ruft das, wenn eine Sitzung endet (Abmelden).
  // VS Code im Browser verbindet sich von selbst neu; wer noch angemeldet ist, merkt kaum etwas (Terminals laufen weiter),
  // wer abgemeldet ist, scheitert an der Prüfung in Caddy.
  if (CODING && req.method === 'POST' && req.url === '/vscode/trennen') return ende(200, { getrennt: torTrennen() });

  // Coding: Projektliste für das Codehaus (nur Ordnernamen direkt unter /arbeit, keine Inhalte)
  if (CODING && req.method === 'GET' && req.url === '/projekte') return ende(200, { projekte: projekteListe() });

  if (CODING && (req.url?.startsWith('/editor/') || req.url?.startsWith('/terminal'))) {
    try {
      return await editorBehandeln(req, res, ende);
    } catch (e) {
      if (e instanceof EditorFehler) return res.headersSent ? res.end() : ende(e.status, { fehler: e.message, ...e.extra });
      if (e instanceof SyntaxError) return ende(400, { fehler: 'Ungültige Anfrage.' });
      throw e;
    }
  }

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

/** Editor und Terminal der Dorf-App (E197) – nur Profil coding, nur mit Geheimnis (oben geprüft). */
async function editorBehandeln(req: http.IncomingMessage, res: http.ServerResponse, ende: (status: number, daten: unknown) => void) {
  const u = new URL(req.url ?? '/', 'http://runner');
  const q = (n: string) => u.searchParams.get(n) ?? '';
  const weg = `${req.method} ${u.pathname}`;
  const text = (w: unknown) => {
    if (typeof w !== 'string') throw new EditorFehler(400, 'Ungültige Anfrage.');
    return w;
  };
  switch (weg) {
    case 'GET /editor/baum':
      return ende(200, editor.baum(q('projekt'), q('pfad')));
    case 'GET /editor/datei':
      return ende(200, editor.lesen(q('projekt'), q('pfad')));
    case 'GET /editor/roh': {
      const r = editor.roh(q('projekt'), q('pfad'));
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': r.groesse });
      r.strom.on('error', () => res.destroy());
      r.strom.pipe(res);
      return;
    }
    case 'GET /editor/dateien':
      return ende(200, await editor.dateien(q('projekt')));
    case 'PUT /editor/datei': {
      // E204: JSON maskiert Steuerzeichen als \u00XX (1 Byte → 6) – jede Datei bis 2 MB muss passen; die Text-Grenze prüft schreiben()
      const b = JSON.parse((await rohKoerper(req, TEXT_MAX * 6 + 10_000)).toString('utf8')) as Record<string, unknown>;
      const basis = b.basisVersion === undefined ? undefined : text(b.basisVersion);
      return ende(200, editor.schreiben(text(b.projekt), text(b.pfad), Buffer.from(text(b.text), 'utf8'), { basisVersion: basis, neu: b.neu === true }));
    }
    case 'POST /editor/hochladen': {
      const daten = await rohKoerper(req, HOCHLADEN_MAX);
      return ende(200, editor.schreiben(q('projekt'), q('pfad'), daten, { neu: q('ersetzen') !== '1', max: HOCHLADEN_MAX }));
    }
    case 'POST /editor/neu': {
      const b = await koerper(req);
      return ende(200, editor.neu(text(b.projekt), text(b.pfad), b.art === 'ordner' ? 'ordner' : 'datei'));
    }
    case 'POST /editor/umbenennen': {
      const b = await koerper(req);
      return ende(200, editor.umbenennen(text(b.projekt), text(b.von), text(b.nach)));
    }
    case 'POST /editor/loeschen': {
      const b = await koerper(req);
      return ende(200, editor.loeschen(text(b.projekt), text(b.pfad)));
    }
    case 'POST /editor/projekt': {
      const b = await koerper(req);
      return ende(200, editor.projektAnlegen(text(b.projekt)));
    }
    case 'POST /editor/suche': {
      const b = await koerper(req);
      return ende(200, await editor.suche(text(b.projekt), { text: text(b.text), regex: b.regex === true, gross: b.gross === true, wort: b.wort === true }));
    }
    case 'POST /editor/git': {
      const b = await koerper(req);
      return ende(200, await editor.git(text(b.projekt), b));
    }
    // Terminal: die Antwort ist der Ausgabestrom der Shell (roh); schließt das Dorf die Verbindung, endet die Shell.
    case 'POST /terminal': {
      const b = await koerper(req);
      const id = text(b.id);
      if (!/^[0-9a-f-]{36}$/.test(id)) throw new EditorFehler(400, 'Ungültige Terminal-ID.');
      if (terminals.hat(id)) throw new EditorFehler(409, 'Dieses Terminal läuft schon.');
      if (terminals.anzahl >= TERMINAL_MAX) throw new EditorFehler(429, `Es sind schon ${TERMINAL_MAX} Terminals offen – schließ eins.`);
      const cwd = b.projekt ? editor.projektOrdner(projektPruefen(b.projekt)) : arbeit;
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
      res.flushHeaders();
      // E204: Gegendruck – kommt das Dorf mit dem Lesen nicht nach (res.write → false), hält das Terminal die Shell an
      // (stdout pausiert → der PTY-Helfer blockiert → die Shell blockiert), bis die Verbindung wieder leer ist ('drain').
      terminals.starten(
        { id, cwd, umgebung: codingUmgebung(process.env), spalten: b.spalten, zeilen: b.zeilen, befehl: TERMINAL_BEFEHL },
        (d) => res.write(d),
        () => res.end(),
      );
      res.on('drain', () => terminals.fortsetzen(id));
      res.on('close', () => terminals.schliessen(id));
      return;
    }
  }
  const t = /^\/terminal\/([0-9a-f-]{36})\/(eingabe|groesse)$/.exec(u.pathname);
  if (t && req.method === 'POST') {
    if (t[2] === 'eingabe') return terminals.eingabe(t[1]!, await rohKoerper(req, 1_000_000)) ? ende(200, { ok: true }) : ende(404, { fehler: 'Terminal läuft nicht (mehr).' });
    const b = await koerper(req);
    return terminals.groesse(t[1]!, b.spalten, b.zeilen) ? ende(200, { ok: true }) : ende(404, { fehler: 'Terminal läuft nicht (mehr).' });
  }
  const zu = /^\/terminal\/([0-9a-f-]{36})$/.exec(u.pathname);
  if (zu && req.method === 'DELETE') return ende(terminals.schliessen(zu[1]!) ? 200 : 404, { ok: true });
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

// ---- Tor vor VS Code (nur Codehaus, E195) ----------------------------------------------------------
// VS Code lauscht nur auf 127.0.0.1 (VSCODE_INTERN_PORT); nach außen (Caddy) geht alles durch dieses Tor: reine
// Durchleitung der Bytes, aber der Runner kennt so jede offene Verbindung und kann sie auf Zuruf des Dorfs schließen.
// Ohne das blieben offene WebSockets (Editor, Terminal) nach dem Abmelden bestehen, bis sie von selbst neu verbinden.
const torOffen = new Set<net.Socket>();
function torTrennen() {
  const n = torOffen.size;
  for (const s of torOffen) s.destroy();
  return n;
}
const TOR_INTERN = Number(process.env.VSCODE_INTERN_PORT ?? 0);
const tor =
  CODING && TOR_INTERN
    ? net
        .createServer((aussen) => {
          const innen = net.connect(TOR_INTERN, '127.0.0.1');
          for (const s of [aussen, innen]) {
            torOffen.add(s);
            s.on('error', () => {});
            s.on('close', () => torOffen.delete(s));
          }
          aussen.on('close', () => innen.destroy());
          innen.on('close', () => aussen.destroy());
          aussen.pipe(innen);
          innen.pipe(aussen);
        })
        .listen(Number(process.env.VSCODE_PORT ?? 3000), '0.0.0.0')
    : null;

server.listen(PORT, '0.0.0.0', () => console.log(`${CODING ? 'Codehaus-Runner' : 'Werkstatt'} bereit auf Port ${PORT}`));
for (const sig of ['SIGTERM', 'SIGINT'] as const)
  process.on(sig, () => {
    for (const p of laufend.values()) p.kill('SIGINT');
    terminals.alleSchliessen();
    tor?.close();
    torTrennen();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 15_000).unref();
  });
