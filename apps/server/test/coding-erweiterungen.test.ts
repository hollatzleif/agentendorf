import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WERKZEUG_DEFINITIONEN } from '../src/agenten/werkzeuge.js';
import { codingEinbettbar } from '../src/coding.js';
import { erweiterungEntfernbar } from '@dorf/shared';
import { ERWEITERUNG_ID, OPENVSX_ANTWORT_MAX, ZEIT_ENTFERNEN_MS, ZEIT_INSTALLIEREN_MS, ZEIT_VSIX_MS, erweiterungIdOk } from '../src/coding-erweiterungen.js';
import type { Konfig } from '../src/konfig.js';
import { kopf } from './etappe7.test.js';
import { ORIGIN, tempOrdner, testDorf } from './hilfen.js';

/**
 * E205 – Erweiterungen für VS Code im Codehaus: Dorf-Routen (/api/coding/erweiterungen*) vor dem ECHTEN Runner im Profil
 * coding (mit nachgebautem openvscode-server) und einem nachgebauten Open VSX, das ECHTE Antworten ausliefert
 * (test/fixtures/openvsx, am 20.11.2026 von open-vsx.org geholt) – kein Netz im Test.
 */
const WERKSTATT = path.resolve(import.meta.dirname, '../../werkstatt');
const FIX = path.resolve(import.meta.dirname, 'fixtures/openvsx');
const GEHEIMNIS = 'erweiterung-geheimnis-erweiterung-geheimnis-9';
const PORT = 4661;
const tmp = tempOrdner('dorf-test-erw-');
const logDatei = path.join(tmp, 'aufrufe.log');
let runner: ChildProcess;
let openvsx: http.Server;
let openvsxUrl = '';
/** was das nachgebaute Open VSX gefragt wurde */
const fragen: string[] = [];
/** Sonderfälle je Test */
let sonder: ((u: URL, res: http.ServerResponse) => boolean) | null = null;
let d: Awaited<ReturnType<typeof testDorf>>;
let h: { origin: string; cookie: string };

const get = (weg: string, headers: Record<string, string> = h) => d.app.inject({ url: weg, headers });
const post = (weg: string, payload: unknown, headers: Record<string, string> = h) => d.app.inject({ method: 'POST', url: weg, headers, payload: payload as object });
const vsix = (daten: Buffer, headers: Record<string, string> = h) => d.app.inject({ method: 'POST', url: '/api/coding/erweiterungen/vsix', headers: { ...headers, 'content-type': 'application/octet-stream' }, payload: daten });
const aufrufe = () =>
  fs.existsSync(logDatei)
    ? fs
        .readFileSync(logDatei, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((z) => (JSON.parse(z) as { args: string[] }).args)
    : [];

beforeAll(async () => {
  for (const o of ['heim', 'arbeit', 'lauf']) fs.mkdirSync(path.join(tmp, o));
  fs.chmodSync(path.join(WERKSTATT, 'test/fake-openvscode.mjs'), 0o755);
  runner = spawn(process.execPath, ['--import', 'tsx', 'src/runner.ts'], {
    cwd: WERKSTATT,
    env: { PATH: process.env.PATH ?? '', HOME: path.join(tmp, 'heim'), PORT: String(PORT), RUNNER_PROFIL: 'coding', CODING_GEHEIMNIS: GEHEIMNIS, ARBEIT_DIR: path.join(tmp, 'arbeit'), LAUF_DIR: path.join(tmp, 'lauf'), OPENVSCODE_BIN: path.join(WERKSTATT, 'test/fake-openvscode.mjs'), FAKE_LOG: logDatei },
    stdio: 'inherit',
  });
  openvsx = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    fragen.push(`${u.pathname}${u.search}`);
    if (sonder?.(u, res)) return;
    const json = (status: number, datei: string) => res.writeHead(status, { 'content-type': 'application/json' }).end(fs.readFileSync(path.join(FIX, datei)));
    if (u.pathname === '/api/-/search') return json(200, 'suche-prettier.json');
    const m = /^\/api\/([^/]+)\/([^/]+)$/.exec(u.pathname);
    if (m && fs.existsSync(path.join(FIX, `detail-${m[1]}.${m[2]}.json`))) return json(200, `detail-${m[1]}.${m[2]}.json`);
    return json(404, 'detail-nicht-gefunden.json');
  });
  await new Promise<void>((r) => openvsx.listen(0, '127.0.0.1', r));
  openvsxUrl = `http://127.0.0.1:${(openvsx.address() as { port: number }).port}`;
  d = await testDorf({ env: { CODING_URL: `http://127.0.0.1:${PORT}`, CODING_GEHEIMNIS: GEHEIMNIS, OPENVSX_URL: openvsxUrl } });
  h = await kopf(d);
  for (let i = 0; i < 100; i++) {
    if (await fetch(`http://127.0.0.1:${PORT}/gesundheit`).then((r) => r.ok).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Runner startet nicht');
}, 30_000);

afterAll(async () => {
  runner?.kill();
  openvsx?.close();
  await d.app.close();
  for (const o of [tmp, d.daten]) fs.rmSync(o, { recursive: true, force: true });
});

describe('Erweiterungs-Routen: Schutz', () => {
  it('ohne Sitzung 401 – lesen, suchen, installieren, entfernen, hochladen; auch über kodierte Pfade (E203)', async () => {
    const ohne = { origin: ORIGIN };
    for (const weg of ['/api/coding/erweiterungen', '/api/coding/erweiterungen/suche?q=prettier', '/%61pi/coding/erweiterungen', '/api/%63oding/erweiterungen/suche?q=x', '/api/coding/%65rweiterungen', '/%2561pi/coding/erweiterungen'])
      expect([401, 404], weg).toContain((await get(weg, ohne)).statusCode);
    for (const weg of ['/api/coding/erweiterungen', '/api/coding/erweiterungen/suche?q=prettier', '/%61pi/coding/erweiterungen', '/api/%63oding/erweiterungen/suche?q=x', '/api/coding/%65rweiterungen'])
      expect((await get(weg, ohne)).statusCode, weg).toBe(401);
    for (const weg of ['/api/coding/erweiterungen/installieren', '/api/coding/erweiterungen/entfernen', '/%61pi/coding/erweiterungen/installieren', '/api/coding/%65rweiterungen/installieren'])
      expect((await post(weg, { id: 'esbenp.prettier-vscode' }, ohne)).statusCode, weg).toBe(401);
    expect((await vsix(Buffer.from('PK\u0003\u0004x'), ohne)).statusCode).toBe(401);
    expect((await d.app.inject({ method: 'POST', url: '/%61pi/coding/erweiterungen/vsix', headers: { ...ohne, 'content-type': 'application/octet-stream' }, payload: Buffer.from('PK\u0003\u0004x') })).statusCode).toBe(401);
    // ein erfundenes Cookie hilft nicht
    expect((await post('/api/coding/erweiterungen/installieren', { id: 'a.b' }, { origin: ORIGIN, cookie: 'dorf_sitzung=erfunden' })).statusCode).toBe(401);
    expect(aufrufe()).toEqual([]);
    expect(fragen).toEqual([]);
  });

  it('Schreibendes von fremder Herkunft (oder ohne Origin, oder vom Code-Host) 403 – auch mit gültigem Cookie', async () => {
    for (const kopfzeilen of [{ cookie: h.cookie, origin: 'https://boese.example' }, { cookie: h.cookie }, { cookie: h.cookie, origin: 'https://code.dorf.test' }] as Record<string, string>[]) {
      expect((await post('/api/coding/erweiterungen/installieren', { id: 'esbenp.prettier-vscode' }, kopfzeilen)).statusCode).toBe(403);
      expect((await post('/api/coding/erweiterungen/entfernen', { id: 'esbenp.prettier-vscode' }, kopfzeilen)).statusCode).toBe(403);
      expect((await vsix(Buffer.from('PK\u0003\u0004x'), kopfzeilen)).statusCode).toBe(403);
    }
    expect(aufrufe()).toEqual([]);
  });

  it('Kennung: Optionen, Shell-Zeichen, Pfade, Adressen scheitern schon im Dorf (400) – der Runner wird nicht gefragt', async () => {
    const boese: unknown[] = ['--foo', '-a.b', 'a.b;rm', 'a.b && id', '../x', '/etc/passwd', 'a/b.c', 'https://marketplace.visualstudio.com/_apis/public/gallery/x.vsix', 'https://open-vsx.org/x.vsix', 'a.b --force', 'a.b\n--x', 'A.b', 'a', 'a.b.c', 'a.b@', 'a.b@latest', '', `a.${'b'.repeat(300)}`, 42, null, ['a.b'], 'a.vsix', 'boese.vsix', 'a.b@1.vsix', 'a.b@1.0.VSIX'];
    // Review E205: die Regel allein ließe „a.vsix“ durch – VS Code läse das als Datei im Arbeitsordner
    expect(ERWEITERUNG_ID.test('a.vsix')).toBe(true);
    for (const id of boese) {
      expect(typeof id === 'string' && erweiterungIdOk(id), JSON.stringify(id)).toBe(false);
      expect((await post('/api/coding/erweiterungen/installieren', { id })).statusCode, `installieren ${JSON.stringify(id)}`).toBe(400);
      expect((await post('/api/coding/erweiterungen/entfernen', { id })).statusCode, `entfernen ${JSON.stringify(id)}`).toBe(400);
    }
    // keine zusätzlichen Felder (z. B. ein Pfad oder eine Adresse am Dorf vorbei)
    expect((await post('/api/coding/erweiterungen/installieren', { id: 'a.b', datei: '/etc/passwd' })).statusCode).toBe(400);
    expect((await post('/api/coding/erweiterungen/installieren', { id: 'a.b', url: 'https://marketplace.visualstudio.com/x.vsix' })).statusCode).toBe(400);
    expect((await post('/api/coding/erweiterungen/entfernen', { id: 'a.b@1.0.0' })).statusCode).toBe(400);
    expect(aufrufe()).toEqual([]);
  });

  it('es gibt kein Agenten-Werkzeug für Erweiterungen (installiert wird nur auf Leifs Klick)', () => {
    const namen = Object.keys(WERKZEUG_DEFINITIONEN);
    expect(namen.length).toBeGreaterThan(20);
    expect(namen.filter((n) => /erweiterung|extension|vsix/i.test(n))).toEqual([]);
    expect(JSON.stringify(WERKZEUG_DEFINITIONEN)).not.toMatch(/install-extension|open-vsx|\/api\/coding\/erweiterungen/i);
  });
});

describe('Suche in Open VSX (nachgebaut, echte Antworten)', () => {
  it('Treffer mit Name, Herausgeber, Beschreibung, Downloads, Lizenz, verifiziert – nur geprüfte Felder, Adresse vom Dorf gebaut', async () => {
    fragen.length = 0;
    const r = await get('/api/coding/erweiterungen/suche?q=prettier');
    expect(r.statusCode).toBe(200);
    const j = r.json() as { treffer: Record<string, unknown>[]; gesamt: number; versatz: number };
    expect(j.gesamt).toBe(63);
    expect(j.versatz).toBe(0);
    expect(j.treffer).toHaveLength(10);
    expect(j.treffer[0]).toEqual({
      id: 'esbenp.prettier-vscode',
      name: 'Prettier - Code formatter',
      herausgeber: 'esbenp',
      beschreibung: 'Code formatter using prettier',
      version: expect.stringMatching(/^\d+\.\d+\.\d+/) as unknown,
      downloads: 10010051,
      bewertung: expect.any(Number) as unknown,
      verifiziert: true,
      veraltet: false,
      lizenz: 'MIT',
      seite: 'https://open-vsx.org/extension/esbenp/prettier-vscode',
      installierbar: true,
    });
    // Großbuchstaben im Namensraum: die Kennung zum Installieren ist klein geschrieben (VS Code unterscheidet nicht)
    const gross = j.treffer.find((t) => t.herausgeber === 'Harlem512')!;
    expect(gross).toMatchObject({ id: 'harlem512.h512-prettier-catspeak', installierbar: true, lizenz: null, seite: 'https://open-vsx.org/extension/Harlem512/h512-prettier-catspeak' });
    // nichts aus der Antwort wird durchgereicht, was das Dorf nicht kennt (Datei-Adressen, Symbole …)
    for (const t of j.treffer) expect(Object.keys(t).sort()).toEqual(['beschreibung', 'bewertung', 'downloads', 'herausgeber', 'id', 'installierbar', 'lizenz', 'name', 'seite', 'veraltet', 'verifiziert', 'version']);
    expect(r.body).not.toContain('.vsix');
    expect(r.body).not.toContain('"files"');
    // gefragt wurde die feste Adresse: Suche + je Treffer die Einzelheiten (Lizenz)
    expect(fragen[0]).toBe('/api/-/search?query=prettier&size=10&offset=0&sortBy=relevance&sortOrder=desc');
    expect(fragen).toHaveLength(11);
    expect(fragen).toContain('/api/esbenp/prettier-vscode');
  });

  it('Lizenzen werden gemerkt (zweite Suche fragt nur noch die Suche); ohne Suchwort die meistgeladenen; Versatz', async () => {
    fragen.length = 0;
    expect((await get('/api/coding/erweiterungen/suche?q=prettier&versatz=10')).json()).toMatchObject({ versatz: 10 });
    // nur die Erweiterung ohne Lizenz-Angabe wird erneut gefragt? Nein: auch „keine Angabe“ ist gemerkt
    expect(fragen).toEqual(['/api/-/search?query=prettier&size=10&offset=10&sortBy=relevance&sortOrder=desc']);
    fragen.length = 0;
    expect((await get('/api/coding/erweiterungen/suche')).statusCode).toBe(200);
    expect(fragen).toEqual(['/api/-/search?query=&size=10&offset=0&sortBy=downloadCount&sortOrder=desc']);
  });

  it('das Suchwort geht nur als Wert in die feste Adresse (kein anderer Pfad, kein anderer Rechner); zu lang → 400', async () => {
    fragen.length = 0;
    expect((await get(`/api/coding/erweiterungen/suche?q=${encodeURIComponent('../../x?size=999&a=b#c')}`)).statusCode).toBe(200);
    expect(fragen[0]).toBe(`/api/-/search?query=${encodeURIComponent('../../x?size=999&a=b#c').replace(/%20/g, '+')}&size=10&offset=0&sortBy=relevance&sortOrder=desc`);
    expect((await get(`/api/coding/erweiterungen/suche?q=${'x'.repeat(101)}`)).statusCode).toBe(400);
    expect((await get('/api/coding/erweiterungen/suche?q=x&versatz=-1')).statusCode).toBe(400);
    expect((await get('/api/coding/erweiterungen/suche?q=x&versatz=abc')).statusCode).toBe(400);
  });

  it('untergeschobene Antworten: fremde Felder, HTML, Steuerzeichen, kaputte Namen, riesige Texte – es kommt nur Geprüftes an', async () => {
    sonder = (u, res) => {
      if (u.pathname !== '/api/-/search') return false;
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          offset: 0,
          totalSize: 'viele',
          extensions: [
            { namespace: 'gut', name: 'eins', displayName: '<img src=x onerror=alert(1)>', description: `a\u0000b\u001b[31m\n${'x'.repeat(5000)}`, version: { boese: true }, downloadCount: -5, averageRating: 'fünf', verified: 'true', deprecated: 1, url: 'javascript:alert(1)', files: { download: 'https://boese.example/x.vsix' } },
            { namespace: '../..', name: 'weg' },
            { namespace: 'a/b', name: 'c' },
            { namespace: 'ok', name: 'x?y=1' },
            { namespace: 'mit_unterstrich', name: 'name' },
            { namespace: '--foo', name: 'bar' },
          ],
        }),
      );
      return true;
    };
    const r = await get('/api/coding/erweiterungen/suche?q=boese');
    sonder = null;
    expect(r.statusCode).toBe(200);
    const j = r.json() as { treffer: Record<string, unknown>[]; gesamt: number };
    expect(j.gesamt).toBe(0);
    expect(j.treffer.map((t) => t.id)).toEqual(['gut.eins', 'mit_unterstrich.name']);
    const t = j.treffer[0]!;
    // Text bleibt Text (die App zeigt ihn nur als Text an), ohne Steuerzeichen, gekürzt; Zahlen und Wahrheitswerte streng
    expect(t.name).toBe('<img src=x onerror=alert(1)>');
    // eslint-disable-next-line no-control-regex
    expect(t.beschreibung).not.toMatch(/[\u0000-\u001f]/);
    expect((t.beschreibung as string).length).toBeLessThanOrEqual(400);
    expect(t).toMatchObject({ version: '', downloads: 0, bewertung: null, verifiziert: false, veraltet: false, lizenz: null, seite: 'https://open-vsx.org/extension/gut/eins', installierbar: true });
    // Unterstrich: bei Open VSX erlaubt, nach den Regeln des Dorfs nicht installierbar – wird angezeigt, aber ohne Knopf
    expect(j.treffer[1]).toMatchObject({ installierbar: false });
    expect(r.body).not.toContain('boese.example');
    expect(r.body).not.toContain('javascript:');
  });

  it('Größen- und Zeitgrenze, Fehler von Open VSX → klare Meldung, nie ein Absturz', async () => {
    sonder = (u, res) => {
      if (u.pathname !== '/api/-/search') return false;
      res.writeHead(200, { 'content-type': 'application/json' });
      const stueck = Buffer.alloc(64 * 1024, 0x20);
      let n = 0;
      const mehr = () => {
        while (n < OPENVSX_ANTWORT_MAX * 3 && res.write(stueck)) n += stueck.length;
        if (n < OPENVSX_ANTWORT_MAX * 3) res.once('drain', mehr);
        else res.end('{}');
      };
      res.on('error', () => undefined);
      mehr();
      return true;
    };
    const gross = await get('/api/coding/erweiterungen/suche?q=gross');
    expect(gross.statusCode).toBe(502);
    expect(gross.json().fehler).toContain('zu groß');
    for (const [antwort, status, text] of [
      [(res: http.ServerResponse) => res.writeHead(500).end('kaputt'), 502, 'HTTP 500'],
      [(res: http.ServerResponse) => res.writeHead(429).end(), 429, 'zu viele Anfragen'],
      [(res: http.ServerResponse) => res.writeHead(200, { 'content-type': 'text/html' }).end('<html>Wartung</html>'), 502, 'nicht lesbar'],
      [(res: http.ServerResponse) => res.writeHead(200).end('{"extensions":"nein"}'), 502, 'unerwartete Form'],
      [(res: http.ServerResponse) => res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' }).end(), 502, 'nicht erreichbar'],
    ] as const) {
      sonder = (u, res) => {
        if (u.pathname !== '/api/-/search') return false;
        antwort(res);
        return true;
      };
      const r = await get('/api/coding/erweiterungen/suche?q=x');
      expect(r.statusCode, text).toBe(status);
      expect(r.json().fehler, text).toContain(text);
    }
    sonder = null;
    // Einzelheiten nicht abrufbar: die Suche gelingt trotzdem, Lizenz bleibt offen (und wird nicht gemerkt)
    const ohne = await testDorf({ env: { OPENVSX_URL: openvsxUrl } });
    const h2 = await kopf(ohne);
    sonder = (u, res) => {
      if (u.pathname === '/api/-/search') return false;
      res.writeHead(503).end();
      return true;
    };
    const r = await ohne.app.inject({ url: '/api/coding/erweiterungen/suche?q=prettier', headers: h2 });
    sonder = null;
    expect(r.statusCode).toBe(200);
    expect((r.json() as { treffer: { lizenz: string | null }[] }).treffer.every((t) => t.lizenz === null)).toBe(true);
    expect(((await ohne.app.inject({ url: '/api/coding/erweiterungen/suche?q=prettier', headers: h2 })).json() as { treffer: { lizenz: string | null }[] }).treffer[0]!.lizenz).toBe('MIT');
    await ohne.app.close();
    fs.rmSync(ohne.daten, { recursive: true, force: true });
  });

  it('Open VSX nicht erreichbar → 502', async () => {
    const ohne = await testDorf({ env: { OPENVSX_URL: 'http://127.0.0.1:9' } });
    const h2 = await kopf(ohne);
    const r = await ohne.app.inject({ url: '/api/coding/erweiterungen/suche?q=x', headers: h2 });
    expect(r.statusCode).toBe(502);
    expect(r.json().fehler).toContain('Open VSX ist nicht erreichbar');
    await ohne.app.close();
    fs.rmSync(ohne.daten, { recursive: true, force: true });
  });
});

describe('Installieren, entfernen, hochladen – über das Dorf bis zum (nachgebauten) VS Code', () => {
  it('Liste leer → installieren → Liste → entfernen; VS Code bekommt genau die festen Argumente', async () => {
    expect((await get('/api/coding/erweiterungen')).json()).toEqual({ erweiterungen: [] });
    const r = await post('/api/coding/erweiterungen/installieren', { id: 'esbenp.prettier-vscode' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, erweiterungen: [{ id: 'esbenp.prettier-vscode', version: '9.9.9' }] });
    expect(aufrufe().some((a) => a.slice(2).join(' ') === '--install-extension esbenp.prettier-vscode --force')).toBe(true);
    expect((await post('/api/coding/erweiterungen/installieren', { id: 'redhat.vscode-yaml@1.2.3' })).json()).toMatchObject({ erweiterungen: [{ id: 'esbenp.prettier-vscode' }, { id: 'redhat.vscode-yaml', version: '1.2.3' }] });
    expect((await get('/api/coding/erweiterungen')).json().erweiterungen).toHaveLength(2);
    const e = await post('/api/coding/erweiterungen/entfernen', { id: 'redhat.vscode-yaml' });
    expect(e.statusCode).toBe(200);
    expect(e.json().erweiterungen).toEqual([{ id: 'esbenp.prettier-vscode', version: '9.9.9' }]);
  });

  it('Fehler von VS Code kommt als Meldung an (422), nicht als „abgemeldet“', async () => {
    const r = await post('/api/coding/erweiterungen/installieren', { id: 'gibts.nicht' });
    expect(r.statusCode).toBe(422);
    expect(r.json().fehler).toContain("Extension 'gibts.nicht' not found.");
  });

  it('VSIX: nur ZIP, höchstens 50 MB, landet als Datei mit Runner-Namen bei VS Code und ist danach weg', async () => {
    expect((await vsix(Buffer.from('<html>'))).statusCode).toBe(400);
    expect((await vsix(Buffer.alloc(0))).statusCode).toBe(400);
    expect((await d.app.inject({ method: 'POST', url: '/api/coding/erweiterungen/vsix', headers: h, payload: { id: 'a.b' } })).statusCode).toBe(400);
    const r = await vsix(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(5000, 3)]));
    expect(r.statusCode).toBe(200);
    expect(r.json().erweiterungen).toContainEqual({ id: 'lokal.aus-vsix', version: '0.0.1' });
    expect(aufrufe().some((a) => a[2] === '--install-extension' && /\/heim\/vsix\/[0-9a-f-]{36}\.vsix$/.test(a[3]!) && a[4] === '--force')).toBe(true);
    expect(fs.readdirSync(path.join(tmp, 'heim/vsix'))).toEqual([]);
    const gross = Buffer.alloc(50 * 1024 * 1024 + 1, 1);
    gross.set([0x50, 0x4b, 0x03, 0x04]);
    expect((await vsix(gross)).statusCode).toBe(413);
  }, 30_000);

  it('Codehaus nicht eingerichtet → 503; Runner nicht erreichbar → 502; älteres Image (kennt die Endpunkte nicht) → 501', async () => {
    const leer = await testDorf({ env: { OPENVSX_URL: openvsxUrl } });
    const h1 = await kopf(leer);
    expect((await leer.app.inject({ url: '/api/coding/erweiterungen', headers: h1 })).statusCode).toBe(503);
    expect((await leer.app.inject({ method: 'POST', url: '/api/coding/erweiterungen/installieren', headers: h1, payload: { id: 'a.b' } })).statusCode).toBe(503);
    // die Suche geht auch ohne Coding-Container
    expect((await leer.app.inject({ url: '/api/coding/erweiterungen/suche?q=prettier', headers: h1 })).statusCode).toBe(200);
    await leer.app.close();
    const weg = await testDorf({ env: { CODING_URL: 'http://127.0.0.1:9', CODING_GEHEIMNIS: GEHEIMNIS } });
    const h2 = await kopf(weg);
    expect((await weg.app.inject({ url: '/api/coding/erweiterungen', headers: h2 })).statusCode).toBe(502);
    await weg.app.close();
    const alt = http.createServer((_q, res) => res.writeHead(404, { 'content-type': 'application/json' }).end('{"fehler":"unbekannt"}'));
    await new Promise<void>((r) => alt.listen(0, '127.0.0.1', r));
    const altDorf = await testDorf({ env: { CODING_URL: `http://127.0.0.1:${(alt.address() as { port: number }).port}`, CODING_GEHEIMNIS: GEHEIMNIS } });
    const h3 = await kopf(altDorf);
    const r = await altDorf.app.inject({ url: '/api/coding/erweiterungen', headers: h3 });
    expect(r.statusCode).toBe(501);
    expect(r.json().fehler).toContain('nächsten Deploy');
    await altDorf.app.close();
    alt.close();
    for (const x of [leer, weg, altDorf]) fs.rmSync(x.daten, { recursive: true, force: true });
  });
});

describe('Review E205: Antworten des Runners, Zeitgrenzen, entfernbare Kennungen', () => {
  it('Runner-Antwort ohne Liste oder mit fremder Form → leere/gesäuberte Liste, nie etwas Ungeprüftes an die App', async () => {
    let antwort = '{}';
    const schief = http.createServer((_q, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(antwort));
    await new Promise<void>((r) => schief.listen(0, '127.0.0.1', r));
    const x = await testDorf({ env: { CODING_URL: `http://127.0.0.1:${(schief.address() as { port: number }).port}`, CODING_GEHEIMNIS: GEHEIMNIS } });
    const hx = await kopf(x);
    const liste = async () => (await x.app.inject({ url: '/api/coding/erweiterungen', headers: hx })).json() as unknown;
    expect(await liste()).toEqual({ erweiterungen: [] });
    for (const a of ['null', '[]', '"text"', '{"erweiterungen":null}', '{"erweiterungen":"nein"}', '{"erweiterungen":{"id":"a.b"}}']) {
      antwort = a;
      expect(await liste(), a).toEqual({ erweiterungen: [] });
    }
    antwort = JSON.stringify({ erweiterungen: [{ id: 'gut.eins', version: '1.0.0', html: '<b>x</b>' }, null, 'text', { id: 7, version: '1' }, { id: 'ohne.version' }], geheim: 'x' });
    expect(await liste()).toEqual({ erweiterungen: [{ id: 'gut.eins', version: '1.0.0' }] });
    antwort = JSON.stringify({ ausgabe: { boese: true }, zusatz: 'x' });
    const r = await x.app.inject({ method: 'POST', url: '/api/coding/erweiterungen/installieren', headers: hx, payload: { id: 'a.b' } });
    expect(r.json()).toEqual({ ok: true, ausgabe: '', erweiterungen: [] });
    await x.app.close();
    schief.close();
    fs.rmSync(x.daten, { recursive: true, force: true });
  });

  it('das Dorf wartet länger, als der Runner höchstens braucht (Warten 60 s + Aufruf + Liste 30 s)', () => {
    expect(ZEIT_INSTALLIEREN_MS).toBeGreaterThan(60_000 + 180_000 + 30_000);
    expect(ZEIT_VSIX_MS).toBeGreaterThan(60_000 + 180_000 + 30_000);
    expect(ZEIT_ENTFERNEN_MS).toBeGreaterThan(60_000 + 60_000 + 30_000);
  });

  it('die App zeigt „Entfernen“ nur für Kennungen, die Dorf und Runner auch annehmen', async () => {
    for (const id of ['esbenp.prettier-vscode', 'a.b', '4ops.terraform']) {
      expect(erweiterungEntfernbar(id), id).toBe(true);
      expect((await post('/api/coding/erweiterungen/entfernen', { id })).statusCode, id).not.toBe(400);
    }
    for (const id of ['mit_unterstrich.name', 'a.b.c', 'A.b', 'a.vsix', 'a.b@1.0.0', '', `a.${'b'.repeat(300)}`]) {
      expect(erweiterungEntfernbar(id), id).toBe(false);
      expect((await post('/api/coding/erweiterungen/entfernen', { id })).statusCode, id).toBe(400);
    }
  });
});

describe('Einbetten von VS Code (E205)', () => {
  const k = (dorf: string, code?: string) => ({ origins: [dorf], codingAdresse: code }) as unknown as Konfig;
  it('einbettbar nur bei gleichem Schema und Unteradresse des Dorfs (bzw. gleichem Rechner, anderem Port)', () => {
    expect(codingEinbettbar(k('https://leif.duckdns.org', 'https://code.leif.duckdns.org'))).toBe(true);
    expect(codingEinbettbar(k('http://127.0.0.1:3999', 'http://127.0.0.1:3996'))).toBe(true);
    expect(codingEinbettbar(k('https://leif.duckdns.org', 'https://code.anders.duckdns.org'))).toBe(false);
    expect(codingEinbettbar(k('https://leif.duckdns.org', 'https://codeleif.duckdns.org'))).toBe(false);
    expect(codingEinbettbar(k('https://leif.duckdns.org', 'https://leif.duckdns.org.boese.example'))).toBe(false);
    expect(codingEinbettbar(k('https://leif.duckdns.org', 'http://code.leif.duckdns.org'))).toBe(false);
    expect(codingEinbettbar(k('https://leif.duckdns.org', undefined))).toBe(false);
    expect(codingEinbettbar(k('https://leif.duckdns.org', 'kaputt'))).toBe(false);
  });

  it('/api/coding meldet es der App', async () => {
    const e = await testDorf({ env: { CODING_URL: `http://127.0.0.1:${PORT}`, CODING_GEHEIMNIS: GEHEIMNIS, CODING_ADRESSE: 'https://code.dorf.test', CODING_VSCODE_TOKEN: 'vscode-token-vscode-token-vscode-token-12' } });
    const h1 = await kopf(e);
    expect((await e.app.inject({ url: '/api/coding', headers: h1 })).json()).toMatchObject({ eingerichtet: true, einbettbar: true });
    await e.app.close();
    fs.rmSync(e.daten, { recursive: true, force: true });
  });
});
