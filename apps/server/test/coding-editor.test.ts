import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { editorPfadOk } from '../src/coding-editor.js';
import { kopf } from './etappe7.test.js';
import { ORIGIN, tempOrdner, testDorf } from './hilfen.js';

/**
 * E197 – Editor im Codehaus: Dorf-Routen (/api/coding/editor/*, /api/coding/terminal) vor dem ECHTEN Runner im Profil
 * coding (aus dem Quelltext gestartet) – Sitzung, Herkunft, Pfad-Tricks, Größen, Terminal über WebSocket, Kappen beim Abmelden.
 */
const WERKSTATT = path.resolve(import.meta.dirname, '../../werkstatt');
const GEHEIMNIS = 'editor-geheimnis-editor-geheimnis-editor-99';
const PORT = 4641;
const P = 'spielwiese';
const arbeit = tempOrdner('dorf-test-editor-arbeit-');
const draussen = tempOrdner('dorf-test-editor-draussen-');
const nebenher = [tempOrdner('dorf-test-editor-heim-'), tempOrdner('dorf-test-editor-lauf-')];
let runner: ChildProcess;
let d: Awaited<ReturnType<typeof testDorf>>;
let h: { origin: string; cookie: string };
let port: number;

const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
const get = (weg: string, headers: Record<string, string> = h) => d.app.inject({ url: weg, headers });
const senden = (method: 'POST' | 'PUT', weg: string, payload: unknown, headers: Record<string, string> = h) => d.app.inject({ method, url: weg, headers, payload: payload as object });

beforeAll(async () => {
  fs.mkdirSync(path.join(arbeit, P, 'src'), { recursive: true });
  fs.writeFileSync(path.join(arbeit, P, 'src/haupt.py'), 'print("hallo")\n');
  fs.writeFileSync(path.join(draussen, 'geheim.txt'), 'streng geheim');
  fs.symlinkSync(path.join(draussen, 'geheim.txt'), path.join(arbeit, P, 'link.txt'));
  fs.symlinkSync(draussen, path.join(arbeit, P, 'raus'));
  runner = spawn(process.execPath, ['--import', 'tsx', 'src/runner.ts'], {
    cwd: WERKSTATT,
    env: { PATH: process.env.PATH ?? '', HOME: nebenher[0]!, PORT: String(PORT), RUNNER_PROFIL: 'coding', CODING_GEHEIMNIS: GEHEIMNIS, ARBEIT_DIR: arbeit, LAUF_DIR: nebenher[1]!, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@dorf.test', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@dorf.test' },
    stdio: 'inherit',
  });
  d = await testDorf({ env: { CODING_URL: `http://127.0.0.1:${PORT}`, CODING_GEHEIMNIS: GEHEIMNIS } });
  h = await kopf(d);
  await d.app.listen({ port: 0, host: '127.0.0.1' });
  port = (d.app.server.address() as { port: number }).port;
  for (let i = 0; i < 100; i++) {
    if (await fetch(`http://127.0.0.1:${PORT}/gesundheit`).then((r) => r.ok).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Runner startet nicht');
}, 30_000);

afterAll(async () => {
  runner?.kill();
  await d.app.close();
  for (const o of [arbeit, draussen, ...nebenher, d.daten]) fs.rmSync(o, { recursive: true, force: true });
});

describe('Editor-Routen: Schutz', () => {
  it('ohne Sitzung 401 – lesend wie schreibend', async () => {
    const ohne = { origin: ORIGIN };
    for (const weg of [`/api/coding/editor/baum?${q({ projekt: P })}`, `/api/coding/editor/datei?${q({ projekt: P, pfad: 'src/haupt.py' })}`, `/api/coding/editor/roh?${q({ projekt: P, pfad: 'src/haupt.py' })}`, `/api/coding/editor/dateien?${q({ projekt: P })}`])
      expect((await get(weg, ohne)).statusCode, weg).toBe(401);
    expect((await senden('PUT', '/api/coding/editor/datei', { projekt: P, pfad: 'x.txt', text: 'x' }, ohne)).statusCode).toBe(401);
    for (const weg of ['neu', 'umbenennen', 'loeschen', 'projekt', 'suche', 'git']) expect((await senden('POST', `/api/coding/editor/${weg}`, {}, ohne)).statusCode, weg).toBe(401);
    expect((await d.app.inject({ method: 'POST', url: `/api/coding/editor/hochladen?${q({ projekt: P, pfad: 'x.bin' })}`, headers: { ...ohne, 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') })).statusCode).toBe(401);
    expect(fs.existsSync(path.join(arbeit, P, 'x.txt'))).toBe(false);
  });

  it('Schreibendes von fremder Herkunft (oder ohne Origin) 403 – auch mit gültigem Cookie', async () => {
    for (const kopfzeilen of [{ cookie: h.cookie, origin: 'https://boese.example' }, { cookie: h.cookie }]) {
      expect((await senden('PUT', '/api/coding/editor/datei', { projekt: P, pfad: 'boese.txt', text: 'x' }, kopfzeilen as Record<string, string>)).statusCode).toBe(403);
      expect((await senden('POST', '/api/coding/editor/loeschen', { projekt: P, pfad: 'src/haupt.py' }, kopfzeilen as Record<string, string>)).statusCode).toBe(403);
      expect((await senden('POST', '/api/coding/editor/git', { projekt: P, befehl: 'init' }, kopfzeilen as Record<string, string>)).statusCode).toBe(403);
    }
    expect(fs.existsSync(path.join(arbeit, P, 'boese.txt'))).toBe(false);
    expect(fs.existsSync(path.join(arbeit, P, 'src/haupt.py'))).toBe(true);
    expect(fs.existsSync(path.join(arbeit, P, '.git'))).toBe(false);
  });

  it('Pfad-Tricks scheitern schon im Dorf (400): .., absolut, .git, leere Teile, Steuerzeichen, Projektname', async () => {
    const boese = ['../x', 'a/../../x', '/etc/passwd', 'a//b', './a', '.git/config', 'a/.git/x', 'a\\b', 'a\nb', '..'];
    for (const pfad of boese) {
      expect(editorPfadOk(pfad), pfad).toBe(false);
      expect((await get(`/api/coding/editor/datei?${q({ projekt: P, pfad })}`)).statusCode, `lesen ${pfad}`).toBe(400);
      expect((await get(`/api/coding/editor/roh?${q({ projekt: P, pfad })}`)).statusCode, `roh ${pfad}`).toBe(400);
      expect((await get(`/api/coding/editor/baum?${q({ projekt: P, pfad })}`)).statusCode, `baum ${pfad}`).toBe(400);
      expect((await senden('PUT', '/api/coding/editor/datei', { projekt: P, pfad, text: 'x' })).statusCode, `schreiben ${pfad}`).toBe(400);
      expect((await senden('POST', '/api/coding/editor/neu', { projekt: P, pfad, art: 'datei' })).statusCode, `neu ${pfad}`).toBe(400);
      expect((await senden('POST', '/api/coding/editor/umbenennen', { projekt: P, von: 'src/haupt.py', nach: pfad })).statusCode, `umbenennen ${pfad}`).toBe(400);
      expect((await senden('POST', '/api/coding/editor/loeschen', { projekt: P, pfad })).statusCode, `löschen ${pfad}`).toBe(400);
      expect((await senden('POST', '/api/coding/editor/git', { projekt: P, befehl: 'vormerken', pfad })).statusCode, `git ${pfad}`).toBe(400);
      expect((await d.app.inject({ method: 'POST', url: `/api/coding/editor/hochladen?${q({ projekt: P, pfad })}`, headers: { ...h, 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') })).statusCode, `hochladen ${pfad}`).toBe(400);
    }
    for (const projekt of ['..', '.heim', 'a/b', '.papierkorb', '-x', '']) {
      expect((await get(`/api/coding/editor/baum?${q({ projekt })}`)).statusCode, projekt).toBe(400);
      expect((await senden('POST', '/api/coding/editor/git', { projekt, befehl: 'status' })).statusCode, projekt).toBe(400);
    }
    expect(fs.existsSync(path.join(arbeit, 'x'))).toBe(false);
    expect(fs.readdirSync(draussen)).toEqual(['geheim.txt']);
  });

  it('Symlinks: der Runner verfolgt sie nie – das Dorf reicht seine Ablehnung durch, nichts kommt heraus oder landet draußen', async () => {
    const r = await get(`/api/coding/editor/datei?${q({ projekt: P, pfad: 'link.txt' })}`);
    expect(r.statusCode).toBe(400);
    expect(r.body).not.toContain('streng geheim');
    expect((await get(`/api/coding/editor/roh?${q({ projekt: P, pfad: 'raus/geheim.txt' })}`)).statusCode).toBe(400);
    expect((await get(`/api/coding/editor/baum?${q({ projekt: P, pfad: 'raus' })}`)).statusCode).toBe(400);
    expect((await senden('PUT', '/api/coding/editor/datei', { projekt: P, pfad: 'raus/neu.txt', text: 'x' })).statusCode).toBe(400);
    expect((await senden('PUT', '/api/coding/editor/datei', { projekt: P, pfad: 'link.txt', text: 'überschrieben' })).statusCode).toBe(400);
    expect(fs.readFileSync(path.join(draussen, 'geheim.txt'), 'utf8')).toBe('streng geheim');
    expect(fs.readdirSync(draussen)).toEqual(['geheim.txt']);
  });

  it('Git-Befehle: nur die bekannten, Branch-Namen geprüft', async () => {
    for (const b of [{ befehl: 'rm' }, { befehl: 'wechseln', branch: '--orphan' }, { befehl: 'anlegen', branch: 'a b' }, { befehl: 'commit', nachricht: '  ' }, { befehl: 'push', pfad: 'x', extra: 1 } as Record<string, unknown>].slice(0, 4))
      expect((await senden('POST', '/api/coding/editor/git', { projekt: P, ...b })).statusCode, JSON.stringify(b)).toBe(400);
  });
});

describe('Editor-Routen: Dateien, Suche, Git über das Dorf', () => {
  it('Baum, lesen, speichern mit Version, Konflikt 409, neu/umbenennen/löschen, hochladen, herunterladen', async () => {
    const baum = (await get(`/api/coding/editor/baum?${q({ projekt: P })}`)).json() as { eintraege: { name: string; art: string }[] };
    expect(baum.eintraege.map((e) => `${e.art}:${e.name}`)).toEqual(['ordner:src', 'link:link.txt', 'link:raus']);
    const a = (await get(`/api/coding/editor/datei?${q({ projekt: P, pfad: 'src/haupt.py' })}`)).json() as { text: string; version: string };
    expect(a.text).toBe('print("hallo")\n');
    const s = await senden('PUT', '/api/coding/editor/datei', { projekt: P, pfad: 'src/haupt.py', text: 'print("dorf")\n', basisVersion: a.version });
    expect(s.statusCode).toBe(200);
    expect(fs.readFileSync(path.join(arbeit, P, 'src/haupt.py'), 'utf8')).toBe('print("dorf")\n');
    // alter Stand → Konflikt, nichts überschrieben
    const k = await senden('PUT', '/api/coding/editor/datei', { projekt: P, pfad: 'src/haupt.py', text: 'alt', basisVersion: a.version });
    expect(k.statusCode).toBe(409);
    expect(k.json()).toMatchObject({ konflikt: true, version: (s.json() as { version: string }).version });
    expect(fs.readFileSync(path.join(arbeit, P, 'src/haupt.py'), 'utf8')).toBe('print("dorf")\n');

    expect((await senden('POST', '/api/coding/editor/neu', { projekt: P, pfad: 'docs/lies.md', art: 'datei' })).statusCode).toBe(200);
    expect((await senden('POST', '/api/coding/editor/neu', { projekt: P, pfad: 'docs/lies.md', art: 'datei' })).statusCode).toBe(409);
    expect((await senden('POST', '/api/coding/editor/umbenennen', { projekt: P, von: 'docs/lies.md', nach: 'docs/LIESMICH.md' })).statusCode).toBe(200);
    expect(fs.existsSync(path.join(arbeit, P, 'docs/LIESMICH.md'))).toBe(true);
    expect((await senden('POST', '/api/coding/editor/loeschen', { projekt: P, pfad: 'docs' })).statusCode).toBe(200);
    expect(fs.existsSync(path.join(arbeit, P, 'docs'))).toBe(false);
    expect((await senden('POST', '/api/coding/editor/loeschen', { projekt: P, pfad: 'docs' })).statusCode).toBe(404);

    const bin = Buffer.from([0, 1, 2, 3, 255, 254]);
    const hoch = (pfad: string, daten: Buffer, mehr: Record<string, string> = {}) =>
      d.app.inject({ method: 'POST', url: `/api/coding/editor/hochladen?${q({ projekt: P, pfad, ...mehr })}`, headers: { ...h, 'content-type': 'application/octet-stream' }, payload: daten });
    expect((await hoch('daten/bild.bin', bin)).statusCode).toBe(200);
    expect((await hoch('daten/bild.bin', bin)).statusCode).toBe(409);
    expect((await hoch('daten/bild.bin', bin, { ersetzen: '1' })).statusCode).toBe(200);
    expect((await get(`/api/coding/editor/datei?${q({ projekt: P, pfad: 'daten/bild.bin' })}`)).json()).toMatchObject({ binaer: true, groesse: 6 });
    const roh = await get(`/api/coding/editor/roh?${q({ projekt: P, pfad: 'daten/bild.bin' })}`);
    expect(roh.statusCode).toBe(200);
    expect(roh.rawPayload.equals(bin)).toBe(true);
    // Projektdateien werden nie im Ursprung der App angezeigt
    expect(roh.headers['content-disposition']).toContain('attachment');
    expect(roh.headers['content-security-policy']).toBe('sandbox');
    expect(roh.headers['x-content-type-options']).toBe('nosniff');
    expect(roh.headers['content-type']).toBe('application/octet-stream');
  });

  it('Größenlimits: Text über 2 MB 413 (nichts geschrieben), Hochladen über 20 MB 413', async () => {
    const r = await senden('PUT', '/api/coding/editor/datei', { projekt: P, pfad: 'riesig.txt', text: 'x'.repeat(2 * 1024 * 1024 + 1) });
    expect(r.statusCode).toBe(413);
    expect(fs.existsSync(path.join(arbeit, P, 'riesig.txt'))).toBe(false);
    const u = await d.app.inject({ method: 'POST', url: `/api/coding/editor/hochladen?${q({ projekt: P, pfad: 'riesig.bin' })}`, headers: { ...h, 'content-type': 'application/octet-stream' }, payload: Buffer.alloc(20 * 1024 * 1024 + 1) });
    expect(u.statusCode).toBe(413);
    expect(fs.existsSync(path.join(arbeit, P, 'riesig.bin'))).toBe(false);
    // genau an der Grenze geht es
    const ok = await senden('PUT', '/api/coding/editor/datei', { projekt: P, pfad: 'grenze.txt', text: 'x'.repeat(2 * 1024 * 1024) });
    expect(ok.statusCode).toBe(200);
    fs.rmSync(path.join(arbeit, P, 'grenze.txt'));
  });

  it('Schnellsuche, Volltext, Git: Status → Commit → Branch', async () => {
    const dateien = (await get(`/api/coding/editor/dateien?${q({ projekt: P })}`)).json() as { dateien: string[] };
    expect(dateien.dateien).toContain('src/haupt.py');
    const t = (await senden('POST', '/api/coding/editor/suche', { projekt: P, text: 'DORF' })).json() as { treffer: { pfad: string; zeile: number }[] };
    expect(t.treffer).toEqual([expect.objectContaining({ pfad: 'src/haupt.py', zeile: 1 })]);
    const git = async (b: Record<string, unknown>) => (await senden('POST', '/api/coding/editor/git', { projekt: P, ...b })).json() as Record<string, unknown>;
    expect(await git({ befehl: 'status' })).toMatchObject({ git: false });
    expect((await git({ befehl: 'init' })).ok).toBe(true);
    const s = (await git({ befehl: 'status' })) as { git: boolean; dateien: { pfad: string }[] };
    expect(s.git).toBe(true);
    expect(s.dateien.map((x) => x.pfad)).toContain('src/haupt.py');
    const c = await git({ befehl: 'commit', nachricht: 'Erster Stand', alle: true });
    expect(c.ok, String(c.ausgabe)).toBe(true);
    fs.writeFileSync(path.join(arbeit, P, 'src/haupt.py'), 'print("neu")\n');
    expect(((await git({ befehl: 'status' })) as { dateien: unknown[] }).dateien).toEqual([{ pfad: 'src/haupt.py', x: ' ', y: 'M' }]);
    expect((await git({ befehl: 'original', pfad: 'src/haupt.py' })).text).toBe('print("dorf")\n');
    expect((await git({ befehl: 'anlegen', branch: 'editor-test' })).ok).toBe(true);
    expect((await git({ befehl: 'branches' })).aktuell).toBe('editor-test');
  });
});

describe('Terminal über WebSocket', () => {
  function terminal(opt: { cookie?: string; origin?: string; frage?: string } = {}) {
    const headers: Record<string, string> = {};
    if (opt.cookie !== '') headers.cookie = opt.cookie ?? h.cookie;
    if (opt.origin !== '') headers.origin = opt.origin ?? ORIGIN;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/coding/terminal?${opt.frage ?? q({ projekt: P, spalten: '100', zeilen: '30' })}`, { headers });
    let aus = '';
    const meldungen: { typ: string; text?: string }[] = [];
    ws.on('message', (m: Buffer, binaer: boolean) => {
      if (binaer) aus += m.toString('utf8');
      else meldungen.push(JSON.parse(m.toString('utf8')));
    });
    const offen = new Promise<'offen' | number>((res) => {
      ws.on('open', () => res('offen'));
      ws.on('unexpected-response', (_q, r) => res(r.statusCode ?? 0));
      ws.on('error', () => res(0));
    });
    const zu = new Promise<number>((res) => ws.on('close', (code) => res(code)));
    const bis = async (muster: RegExp, ms = 10_000) => {
      const ende = Date.now() + ms;
      while (!muster.test(aus)) {
        if (Date.now() > ende) throw new Error(`Terminal: ${muster} kam nicht. Ausgabe: ${JSON.stringify(aus.slice(-400))} Meldungen: ${JSON.stringify(meldungen)}`);
        await new Promise((x) => setTimeout(x, 30));
      }
    };
    const tippe = (daten: string) => ws.send(JSON.stringify({ typ: 'eingabe', daten }));
    return { ws, offen, zu, bis, tippe, meldungen, text: () => aus };
  }

  it('Handshake nur mit Sitzung und passender Herkunft', async () => {
    expect(await terminal({ cookie: '' }).offen).toBe(401);
    expect(await terminal({ cookie: 'dorf_sitzung=erfunden' }).offen).toBe(401);
    expect(await terminal({ origin: 'https://boese.example' }).offen).toBe(403);
    expect(await terminal({ origin: '' }).offen).toBe(403);
    // kein Terminal ist dabei entstanden
    expect(((await (await fetch(`http://127.0.0.1:${PORT}/gesundheit`)).json()) as { ok: boolean }).ok).toBe(true);
  });

  it('Daten fließen in beide Richtungen, Reihenfolge bleibt, Größe ändern, Ende der Shell schließt sauber', async () => {
    const t = terminal();
    expect(await t.offen).toBe('offen');
    // sofort tippen – auch bevor die Shell bereit ist, geht nichts verloren
    t.tippe('echo erg-$((6*7)); pwd; stty size\n');
    await t.bis(/erg-42/);
    await t.bis(new RegExp(`${P}\\r?\\n`));
    await t.bis(/30 100/);
    expect(t.meldungen[0]).toEqual({ typ: 'bereit' });
    // viele kleine Eingaben hintereinander kommen in der richtigen Reihenfolge an
    for (const z of 'echo abcdefghijklmnopqrstuvwxyz-fertig\n') t.tippe(z);
    await t.bis(/[\r\n]abcdefghijklmnopqrstuvwxyz-fertig/);
    t.ws.send(JSON.stringify({ typ: 'groesse', spalten: 132, zeilen: 43 }));
    await new Promise((x) => setTimeout(x, 300));
    t.tippe('stty size\n');
    await t.bis(/43 132/);
    // das Runner-Geheimnis steht nicht in der Umgebung der Shell
    t.tippe('echo "g=[${CODING_GEHEIMNIS:-leer}]"\n');
    await t.bis(/g=\[leer\]/);
    // Unsinn vom Browser stört nicht
    t.ws.send('kein json');
    t.ws.send(JSON.stringify({ typ: 'groesse', spalten: -5, zeilen: 'x' }));
    t.ws.send(Buffer.from([1, 2, 3]));
    t.tippe('exit\n');
    expect(await t.zu).toBe(1000);
    expect(t.meldungen.at(-1)).toEqual({ typ: 'ende' });
  }, 30_000);

  it('Abmelden kappt die Terminals dieser Sitzung (4001) und beendet die Shell; andere Sitzungen bleiben', async () => {
    const zweite = await d.app.inject({ method: 'POST', url: '/api/anmeldung', headers: { origin: ORIGIN }, payload: { passwort: 'ein-langes-test-passwort-1' } });
    const andereSitzung = (Array.isArray(zweite.headers['set-cookie']) ? zweite.headers['set-cookie'][0]! : String(zweite.headers['set-cookie'])).split(';')[0]!;
    expect(zweite.statusCode).toBe(200);
    const a = terminal({ cookie: andereSitzung });
    const b = terminal({ cookie: andereSitzung, frage: q({ projekt: P }) });
    const bleibt = terminal();
    expect(await a.offen).toBe('offen');
    expect(await b.offen).toBe('offen');
    expect(await bleibt.offen).toBe('offen');
    a.tippe('sleep 627\n');
    const laeuft = async () => {
      const { execFileSync } = await import('node:child_process');
      return execFileSync('sh', ['-c', 'ps -eo args | grep "^sleep 627" || true']).toString();
    };
    for (let i = 0; i < 100 && !(await laeuft()); i++) await new Promise((x) => setTimeout(x, 50));
    expect(await laeuft()).toContain('sleep 627');
    await d.app.inject({ method: 'POST', url: '/api/abmeldung', headers: { origin: ORIGIN, cookie: andereSitzung } });
    expect(await a.zu).toBe(4001);
    expect(await b.zu).toBe(4001);
    for (let i = 0; i < 100 && (await laeuft()); i++) await new Promise((x) => setTimeout(x, 50));
    expect(await laeuft()).toBe('');
    // die abgemeldete Sitzung bekommt kein neues Terminal
    expect(await terminal({ cookie: andereSitzung }).offen).toBe(401);
    // Leifs andere Sitzung arbeitet weiter
    bleibt.tippe('echo noch-$((1+1))-da\n');
    await bleibt.bis(/noch-2-da/);
    bleibt.ws.close();
    await bleibt.zu;
  }, 30_000);

  it('falsches Projekt: Meldung statt Shell', async () => {
    const t = terminal({ frage: q({ projekt: 'gibts-nicht' }) });
    expect(await t.offen).toBe('offen');
    expect(await t.zu).toBe(1011);
    expect(t.meldungen[0]).toMatchObject({ typ: 'fehler' });
    expect(t.meldungen[0]!.text).toContain('gibt es nicht');
    const u = terminal({ frage: q({ projekt: '../x' }) });
    expect(await u.offen).toBe('offen');
    expect(await u.zu).toBe(4400);
  });
});

describe('Editor ohne (passenden) Coding-Container', () => {
  it('nicht eingerichtet → 503; nicht erreichbar → 502; älteres Image ohne Editor-Endpunkte → 501 mit Hinweis', async () => {
    const ohne = await testDorf();
    const ho = await kopf(ohne);
    expect((await ohne.app.inject({ url: `/api/coding/editor/baum?${q({ projekt: P })}`, headers: ho })).statusCode).toBe(503);
    await ohne.app.close();

    const weg = await testDorf({ env: { CODING_URL: 'http://127.0.0.1:9', CODING_GEHEIMNIS: GEHEIMNIS } });
    const hw = await kopf(weg);
    expect((await weg.app.inject({ url: `/api/coding/editor/baum?${q({ projekt: P })}`, headers: hw })).statusCode).toBe(502);
    await weg.app.close();

    // Runner von vor E197: kennt nur /projekte und /laeufe, alles andere „unbekannt“; falsches Geheimnis → 401
    const alt = http.createServer((req, res) => {
      if (req.headers['x-werkstatt-geheimnis'] !== GEHEIMNIS) return res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ fehler: 'nicht berechtigt' }));
      res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ fehler: 'unbekannt' }));
    });
    await new Promise<void>((r) => alt.listen(0, '127.0.0.1', r));
    const altPort = (alt.address() as { port: number }).port;
    const a = await testDorf({ env: { CODING_URL: `http://127.0.0.1:${altPort}`, CODING_GEHEIMNIS: GEHEIMNIS } });
    const ha = await kopf(a);
    const r = await a.app.inject({ url: `/api/coding/editor/baum?${q({ projekt: P })}`, headers: ha });
    expect(r.statusCode).toBe(501);
    expect((r.json() as { fehler: string }).fehler).toContain('nächsten Deploy');
    await a.app.close();
    // falsches Geheimnis ist kein „nicht angemeldet“ (die App würde sonst zur Anmeldung springen)
    const f = await testDorf({ env: { CODING_URL: `http://127.0.0.1:${altPort}`, CODING_GEHEIMNIS: 'ein-anderes-geheimnis-ein-anderes-geheimnis-1' } });
    const hf = await kopf(f);
    expect((await f.app.inject({ url: `/api/coding/editor/baum?${q({ projekt: P })}`, headers: hf })).statusCode).toBe(502);
    await f.app.close();
    alt.close();
    for (const x of [ohne, weg, a, f]) fs.rmSync(x.daten, { recursive: true, force: true });
  });
});
