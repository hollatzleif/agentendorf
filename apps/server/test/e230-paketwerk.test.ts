import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WERKZEUG_DEFINITIONEN } from '../src/agenten/werkzeuge.js';
import { kopf } from './etappe7.test.js';
import { ORIGIN, tempOrdner, testDorf } from './hilfen.js';

/**
 * E230 – Paketwerk: Dorf-Routen (/api/paketwerk*) vor dem ECHTEN Runner im Modus paketwerk (apps/rechenraum/runner.py).
 * Kein Netz nötig: die Befehle hier installieren nichts.
 */
const RUNNER = path.resolve(import.meta.dirname, '../../rechenraum/runner.py');
const GEHEIMNIS = 'paketwerk-geheimnis-paketwerk-geheimnis-1';
const PORT = 4671;
const pakete = tempOrdner('dorf-test-paketwerk-');
let runner: ChildProcess;
let d: Awaited<ReturnType<typeof testDorf>>;
let h: { origin: string; cookie: string };

const get = (weg: string, headers: Record<string, string> = h) => d.app.inject({ url: weg, headers });
const post = (weg: string, payload: unknown, headers: Record<string, string> = h) => d.app.inject({ method: 'POST', url: weg, headers, payload: payload as object });

async function warten(id: string) {
  let aus = '';
  let ab = 0;
  for (let i = 0; i < 200; i++) {
    const r = await get(`/api/paketwerk/stand?id=${id}&ab=${ab}`);
    expect(r.statusCode, r.body).toBe(200);
    const s = r.json<{ ausgabe: string; bis: number; fertig: boolean; code: number | null; sekunden: number }>();
    aus += s.ausgabe;
    ab = s.bis;
    if (s.fertig) return { aus, code: s.code };
    await new Promise((x) => setTimeout(x, 50));
  }
  throw new Error('nicht fertig');
}

beforeAll(async () => {
  runner = spawn('python3', [RUNNER], {
    env: { PATH: process.env.PATH ?? '', PORT: String(PORT), RECHENRAUM_GEHEIMNIS: GEHEIMNIS, RECHENRAUM_MODUS: 'paketwerk', RECHENRAUM_PAKETE: pakete },
    stdio: 'inherit',
  });
  d = await testDorf({ env: { RECHENRAUM_GEHEIMNIS: GEHEIMNIS, PAKETWERK_URL: `http://127.0.0.1:${PORT}` } });
  h = await kopf(d);
  for (let i = 0; i < 100; i++) {
    if (await fetch(`http://127.0.0.1:${PORT}/gesundheit`).then((r) => r.ok).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Paketwerk startet nicht');
}, 30_000);

afterAll(async () => {
  runner?.kill();
  await d.app.close();
  for (const o of [pakete, d.daten]) fs.rmSync(o, { recursive: true, force: true });
});

describe('E230 Paketwerk', () => {
  it('ohne Sitzung 401 (auch kodiert), Schreibendes von fremder Herkunft 403 – und nichts läuft', async () => {
    const ohne = { origin: ORIGIN };
    for (const weg of ['/api/paketwerk', '/%61pi/paketwerk', '/api/paketwerk/stand?id=0123456789abcdef'])
      expect((await get(weg, ohne)).statusCode, weg).toBe(401);
    for (const weg of ['/api/paketwerk/start', '/%61pi/paketwerk/start', '/api/paketwerk/abbrechen'])
      expect((await post(weg, { befehl: `touch ${pakete}/boese`, id: '0123456789abcdef' }, ohne)).statusCode, weg).toBe(401);
    expect((await post('/api/paketwerk/start', { befehl: `touch ${pakete}/boese` }, { ...h, origin: 'https://boese.example' })).statusCode).toBe(403);
    expect((await post('/api/paketwerk/start', { befehl: `touch ${pakete}/boese` }, { cookie: h.cookie })).statusCode).toBe(403);
    await new Promise((x) => setTimeout(x, 200));
    expect(fs.existsSync(path.join(pakete, 'boese'))).toBe(false);
  });

  it('Befehl ausführen, Ausgabe stückweise, Code; pip schreibt nur in den Paketordner', async () => {
    const r = await post('/api/paketwerk/start', { befehl: 'echo hallo; echo "$PYTHONUSERBASE"; exit 2' });
    expect(r.statusCode, r.body).toBe(200);
    const { aus, code } = await warten(r.json<{ id: string }>().id);
    expect(aus.split('\n').slice(0, 2)).toEqual(['hallo', pakete]);
    expect(code).toBe(2);
  });

  it('einer zur Zeit (409), abbrechen, unbekannte Kennung', async () => {
    const r = await post('/api/paketwerk/start', { befehl: 'sleep 30' });
    const id = r.json<{ id: string }>().id;
    const zweit = await post('/api/paketwerk/start', { befehl: 'true' });
    expect(zweit.statusCode).toBe(409);
    expect(zweit.json<{ fehler: string }>().fehler).toMatch(/läuft schon/);
    expect((await post('/api/paketwerk/abbrechen', { id })).json()).toEqual({ ok: true });
    expect((await warten(id)).code).not.toBe(0);
    expect((await get('/api/paketwerk/stand?id=../../etc&ab=0')).statusCode).toBe(400);
    expect((await get('/api/paketwerk/stand?id=0123456789abcdef&ab=0')).statusCode).toBe(404);
    expect((await post('/api/paketwerk/start', { befehl: '   ' })).statusCode).toBe(400);
    expect((await post('/api/paketwerk/start', { befehl: 'x'.repeat(4001) })).statusCode).toBe(400);
  });

  it('Übersicht: eingerichtet + Paketliste', async () => {
    const r = await get('/api/paketwerk');
    expect(r.statusCode).toBe(200);
    const j = r.json<{ eingerichtet: boolean; pakete: unknown[] }>();
    expect(j.eingerichtet).toBe(true);
    expect(Array.isArray(j.pakete)).toBe(true);
  });

  it('Agenten haben KEIN Werkzeug dafür (nur Vorschläge)', () => {
    expect(Object.keys(WERKZEUG_DEFINITIONEN).filter((n) => /paket|konsole|pip/i.test(n))).toEqual([]);
  });
});

describe('E230 Paketwerk nicht eingerichtet', () => {
  it('ohne Geheimnis: Übersicht sagt es, Ausführen 503', async () => {
    const d2 = await testDorf();
    const h2 = await kopf(d2);
    const r = await d2.app.inject({ url: '/api/paketwerk', headers: h2 });
    expect(r.json()).toMatchObject({ eingerichtet: false, pakete: [] });
    expect((await d2.app.inject({ method: 'POST', url: '/api/paketwerk/start', headers: h2, payload: { befehl: 'true' } })).statusCode).toBe(503);
    await d2.app.close();
    fs.rmSync(d2.daten, { recursive: true, force: true });
  });

  it('Paketwerk nicht erreichbar: Übersicht mit Fehler statt Absturz', async () => {
    const d3 = await testDorf({ env: { RECHENRAUM_GEHEIMNIS: GEHEIMNIS, PAKETWERK_URL: 'http://127.0.0.1:1' } });
    const h3 = await kopf(d3);
    const j = (await d3.app.inject({ url: '/api/paketwerk', headers: h3 })).json<{ eingerichtet: boolean; fehler: string }>();
    expect(j.eingerichtet).toBe(false);
    expect(j.fehler).toMatch(/nicht erreichbar/);
    await d3.app.close();
    fs.rmSync(d3.daten, { recursive: true, force: true });
  });
});
