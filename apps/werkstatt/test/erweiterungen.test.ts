import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EditorFehler } from '../src/editor.js';
import { ERWEITERUNG_ID, Erweiterungen, erweiterungIdPruefen, listeLesen } from '../src/erweiterungen.js';

/**
 * E205 – Erweiterungen für VS Code im Codehaus: Endpunkte des Runners (/erweiterungen*).
 * Echter Runner (aus dem Quelltext) im Profil coding mit einem nachgebauten openvscode-server (OPENVSCODE_BIN), das jeden
 * Aufruf mit seinen Argumenten vermerkt; zum Vergleich ein Runner im Werkstatt-Profil (dort gibt es nichts davon).
 */
const HIER = path.resolve(import.meta.dirname, '..');
const FAKE = path.join(HIER, 'test/fake-openvscode.mjs');
const GEHEIMNIS = 'erweiterung-geheimnis-erweiterung-geheimnis-1';
const PORT = 4651;
const PORT_W = 4652;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dorf-test-erw-'));
const heim = path.join(tmp, 'heim');
const daten = path.join(heim, '.openvscode-server');
const logDatei = path.join(tmp, 'aufrufe.log');
let runner: ChildProcess;
let werkstatt: ChildProcess;

const url = (p: string, port = PORT) => `http://127.0.0.1:${port}${p}`;
const kopf = { 'x-werkstatt-geheimnis': GEHEIMNIS, 'content-type': 'application/json' };
async function hole(weg: string, init: RequestInit = {}, port = PORT) {
  const r = await fetch(url(weg, port), { ...init, headers: { ...kopf, ...(init.headers as Record<string, string> | undefined) } });
  const t = await r.text();
  let j: Record<string, unknown> = {};
  try {
    j = JSON.parse(t) as Record<string, unknown>;
  } catch {
    /* roh */
  }
  return { status: r.status, j, t };
}
const post = (weg: string, body: unknown, port = PORT) => hole(weg, { method: 'POST', body: JSON.stringify(body) }, port);
const vsix = (daten: Buffer, port = PORT) => hole('/erweiterungen/vsix', { method: 'POST', body: new Uint8Array(daten), headers: { 'content-type': 'application/octet-stream' } }, port);
const aufrufe = () =>
  fs.existsSync(logDatei)
    ? fs
        .readFileSync(logDatei, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((z) => JSON.parse(z) as { args: string[]; umgebung: string[] })
    : [];

beforeAll(async () => {
  fs.mkdirSync(heim, { recursive: true });
  fs.mkdirSync(path.join(tmp, 'arbeit'));
  fs.mkdirSync(path.join(tmp, 'warbeit'));
  fs.chmodSync(FAKE, 0o755);
  const basis = { PATH: process.env.PATH ?? '', HOME: heim, GH_TOKEN: 'ghp_test', OPENVSCODE_BIN: FAKE, FAKE_LOG: logDatei };
  const start = (env: Record<string, string>) => spawn(process.execPath, ['--import', 'tsx', 'src/runner.ts'], { cwd: HIER, env: { ...basis, ...env }, stdio: 'inherit' });
  runner = start({ PORT: String(PORT), RUNNER_PROFIL: 'coding', CODING_GEHEIMNIS: GEHEIMNIS, VSCODE_TOKEN: 'vscode-token-darf-nicht-zur-erweiterung-12345', ARBEIT_DIR: path.join(tmp, 'arbeit'), LAUF_DIR: path.join(tmp, 'lauf') });
  werkstatt = start({ PORT: String(PORT_W), WERKSTATT_GEHEIMNIS: GEHEIMNIS, ARBEIT_DIR: path.join(tmp, 'warbeit') });
  for (let i = 0; i < 100; i++) {
    const ok = await Promise.all([PORT, PORT_W].map((p) => fetch(url('/gesundheit', p)).then((r) => r.ok).catch(() => false)));
    if (ok.every(Boolean)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Runner startet nicht');
}, 30_000);

afterAll(() => {
  runner?.kill();
  werkstatt?.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('Erweiterungs-Endpunkte: nur Profil coding, nur mit Geheimnis', () => {
  it('ohne Geheimnis 401 – nichts wird aufgerufen', async () => {
    expect((await fetch(url('/erweiterungen'))).status).toBe(401);
    for (const weg of ['installieren', 'entfernen', 'vsix']) expect((await fetch(url(`/erweiterungen/${weg}`), { method: 'POST', body: '{"id":"a.b"}' })).status, weg).toBe(401);
    expect((await fetch(url('/erweiterungen/installieren'), { method: 'POST', headers: { 'x-werkstatt-geheimnis': 'falsch'.repeat(8) }, body: '{"id":"a.b"}' })).status).toBe(401);
    expect(aufrufe()).toEqual([]);
  });

  it('Werkstatt-Profil kennt die Endpunkte nicht (404) – dort wird nie etwas installiert', async () => {
    expect((await hole('/erweiterungen', {}, PORT_W)).status).toBe(404);
    expect((await post('/erweiterungen/installieren', { id: 'esbenp.prettier-vscode' }, PORT_W)).status).toBe(404);
    expect((await post('/erweiterungen/entfernen', { id: 'esbenp.prettier-vscode' }, PORT_W)).status).toBe(404);
    expect((await vsix(Buffer.from('PK\u0003\u0004rest'), PORT_W)).status).toBe(404);
    expect(aufrufe()).toEqual([]);
  });
});

describe('Auflisten, installieren, entfernen – feste Argumente', () => {
  it('leere Liste; installieren ruft genau „--install-extension <id> --force“ im Datenordner von VS Code; Liste zeigt sie', async () => {
    expect((await hole('/erweiterungen')).j).toEqual({ erweiterungen: [] });
    const r = await post('/erweiterungen/installieren', { id: 'esbenp.prettier-vscode' });
    expect(r.status).toBe(200);
    expect(r.j.ok).toBe(true);
    expect(r.j.erweiterungen).toEqual([{ id: 'esbenp.prettier-vscode', version: '9.9.9' }]);
    // Farbcodes des Programms sind entfernt
    expect(r.j.ausgabe).toContain("Extension 'esbenp.prettier-vscode' v9.9.9 was successfully installed.");
    // eslint-disable-next-line no-control-regex
    expect(r.j.ausgabe).not.toMatch(/\u001b/);
    const a = aufrufe();
    expect(a.map((x) => x.args)).toEqual([
      ['--server-data-dir', daten, '--list-extensions', '--show-versions'],
      ['--server-data-dir', daten, '--install-extension', 'esbenp.prettier-vscode', '--force'],
      ['--server-data-dir', daten, '--list-extensions', '--show-versions'],
    ]);
    // Umgebung wie beim Agenten: GitHub-Token ja, Runner-Geheimnis und VS-Code-Token nie
    for (const x of a) {
      expect(x.umgebung).toContain('GH_TOKEN');
      expect(x.umgebung).not.toContain('CODING_GEHEIMNIS');
      expect(x.umgebung).not.toContain('VSCODE_TOKEN');
      expect(x.umgebung).not.toContain('RUNNER_PROFIL');
    }
    expect((await hole('/erweiterungen')).j).toEqual({ erweiterungen: [{ id: 'esbenp.prettier-vscode', version: '9.9.9' }] });
  });

  it('bestimmte Version (@1.2.3); entfernen nur ohne Version', async () => {
    const r = await post('/erweiterungen/installieren', { id: 'redhat.vscode-yaml@1.2.3-beta.1+x' });
    expect(r.status).toBe(200);
    expect(r.j.erweiterungen).toContainEqual({ id: 'redhat.vscode-yaml', version: '1.2.3-beta.1+x' });
    expect(aufrufe().at(-2)!.args).toEqual(['--server-data-dir', daten, '--install-extension', 'redhat.vscode-yaml@1.2.3-beta.1+x', '--force']);
    const vorher = aufrufe().length;
    expect((await post('/erweiterungen/entfernen', { id: 'redhat.vscode-yaml@1.2.3' })).status).toBe(400);
    expect(aufrufe().length).toBe(vorher);
    const e = await post('/erweiterungen/entfernen', { id: 'redhat.vscode-yaml' });
    expect(e.status).toBe(200);
    expect(e.j.erweiterungen).toEqual([{ id: 'esbenp.prettier-vscode', version: '9.9.9' }]);
    expect(aufrufe().at(-2)!.args).toEqual(['--server-data-dir', daten, '--uninstall-extension', 'redhat.vscode-yaml']);
  });

  it('Fehler von VS Code (unbekannte Erweiterung, nicht installiert) → 422 mit seiner Meldung', async () => {
    const r = await post('/erweiterungen/installieren', { id: 'gibts.nicht' });
    expect(r.status).toBe(422);
    expect(r.j.fehler).toContain("Extension 'gibts.nicht' not found.");
    const e = await post('/erweiterungen/entfernen', { id: 'nie.installiert' });
    expect(e.status).toBe(422);
    expect(e.j.fehler).toContain('is not installed');
  });

  it('Injektionsversuche: Optionen, Shell-Zeichen, Pfade, Adressen, falsche Typen → 400, das Programm wird NIE aufgerufen', async () => {
    const boese: unknown[] = [
      '--foo',
      '--install-extension',
      '-a.b',
      'a.b;rm',
      'a.b; rm -rf /',
      'a.b && id',
      'a.b|id',
      'a.b`id`',
      'a.b$(id)',
      '../x',
      '../../etc/passwd',
      '/etc/passwd',
      '/arbeit/.heim/vsix/x.vsix',
      'a/b.c',
      'a.b/c',
      'https://marketplace.visualstudio.com/x.vsix',
      'https://open-vsx.org/api/a/b/file/a.b.vsix',
      'file:///etc/passwd',
      'a.b --force',
      'a.b\n--extensions-dir=/tmp',
      'a.b\u0000',
      ' a.b',
      'a.b ',
      'a',
      'a.',
      '.b',
      'a..b',
      'a.b.c',
      'a.b@',
      'a.b@latest',
      'a.b@1.0 --x',
      'a.b@1/../2',
      'A.b',
      'ms-python.Python',
      'a_b.c',
      'ä.b',
      '',
      `a.${'b'.repeat(300)}`,
      null,
      undefined,
      42,
      true,
      ['a.b'],
      { id: 'a.b' },
    ];
    const vorher = aufrufe().length;
    for (const id of boese) {
      expect(ERWEITERUNG_ID.test(String(id)) && String(id).length <= 200 && typeof id === 'string', JSON.stringify(id)).toBe(false);
      expect((await post('/erweiterungen/installieren', { id })).status, `installieren ${JSON.stringify(id)}`).toBe(400);
      expect((await post('/erweiterungen/entfernen', { id })).status, `entfernen ${JSON.stringify(id)}`).toBe(400);
    }
    expect((await hole('/erweiterungen/installieren', { method: 'POST', body: 'kein json' })).status).toBe(400);
    expect((await hole('/erweiterungen/installieren', { method: 'POST', body: '"a.b"' })).status).toBe(400);
    expect(aufrufe().length).toBe(vorher);
    // Gegenprobe: gültige Kennungen
    for (const id of ['a.b', 'ms-python.python', '4ops.terraform', 'a-b.c-d@0.1.0', 'esbenp.prettier-vscode@12.4.0']) expect(() => erweiterungIdPruefen(id), id).not.toThrow();
  });

  it('zwei Aufrufe gleichzeitig laufen nacheinander (VS Code schreibt je Aufruf seine Liste neu)', async () => {
    const [a, b, c] = await Promise.all([post('/erweiterungen/installieren', { id: 'eins.a' }), post('/erweiterungen/installieren', { id: 'zwei.b' }), hole('/erweiterungen')]);
    expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
    expect(fs.existsSync(path.join(daten, 'fake-ueberlappt'))).toBe(false);
    const ids = ((await hole('/erweiterungen')).j.erweiterungen as { id: string }[]).map((e) => e.id);
    expect(ids).toEqual(['eins.a', 'esbenp.prettier-vscode', 'zwei.b']);
  });
});

describe('VSIX hochladen', () => {
  it('kein ZIP → 400, nichts bleibt liegen, VS Code wird nicht aufgerufen', async () => {
    const vorher = aufrufe().length;
    const r = await vsix(Buffer.from('#!/bin/sh\nrm -rf /\n'));
    expect(r.status).toBe(400);
    expect(r.j.fehler).toContain('keine VSIX-Datei');
    expect((await vsix(Buffer.alloc(0))).status).toBe(400);
    expect(aufrufe().length).toBe(vorher);
    expect(fs.readdirSync(path.join(heim, 'vsix'))).toEqual([]);
  });

  it('ZIP → „--install-extension <heim>/vsix/<uuid>.vsix --force“; die Datei ist danach weg, ihr Pfad steht nicht in der Ausgabe', async () => {
    const r = await vsix(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(2000, 7)]));
    expect(r.status).toBe(200);
    expect(r.j.erweiterungen).toContainEqual({ id: 'lokal.aus-vsix', version: '0.0.1' });
    const args = aufrufe().at(-2)!.args;
    expect(args.slice(0, 3)).toEqual(['--server-data-dir', daten, '--install-extension']);
    expect(args[3]).toMatch(new RegExp(`^${path.join(heim, 'vsix').replace(/[.\\/]/g, '\\$&')}/[0-9a-f-]{36}\\.vsix$`));
    expect(args[4]).toBe('--force');
    expect(r.j.ausgabe).not.toContain(path.join(heim, 'vsix'));
    expect(fs.readdirSync(path.join(heim, 'vsix'))).toEqual([]);
    // der Dateiname kommt vom Runner – Anfrage-Parameter spielen keine Rolle
    const z = await hole('/erweiterungen/vsix?name=../../x&pfad=/etc/passwd', { method: 'POST', body: new Uint8Array(Buffer.from('PK\u0003\u0004x')), headers: { 'content-type': 'application/octet-stream' } });
    expect(z.status).toBe(200);
    expect(aufrufe().at(-2)!.args[3]).toMatch(/\/vsix\/[0-9a-f-]{36}\.vsix$/);
  });

  it('über 50 MB → 413, nichts bleibt liegen', async () => {
    const vorher = aufrufe().length;
    const gross = Buffer.alloc(50 * 1024 * 1024 + 10, 1);
    gross.set([0x50, 0x4b, 0x03, 0x04]);
    const r = await vsix(gross).catch(() => ({ status: 413 }));
    expect(r.status).toBe(413);
    await new Promise((x) => setTimeout(x, 200));
    expect(aufrufe().length).toBe(vorher);
    expect(fs.readdirSync(path.join(heim, 'vsix'))).toEqual([]);
  }, 30_000);
});

describe('Erweiterungen (Klasse)', () => {
  it('Zeitlimit: hängt VS Code, wird die ganze Prozessgruppe beendet → 504; danach geht es weiter', async () => {
    const d = path.join(tmp, 'daten-zeit');
    const e = new Erweiterungen(FAKE, d, path.join(tmp, 'vsix-zeit'), () => ({ PATH: process.env.PATH }), 600);
    const fehler = await e.installieren('haengt.fuer-immer').catch((x: unknown) => x);
    expect(fehler).toBeInstanceOf(EditorFehler);
    expect((fehler as EditorFehler).status).toBe(504);
    expect((await e.installieren('danach.geht-es')).erweiterungen).toEqual([{ id: 'danach.geht-es', version: '9.9.9' }]);
  });

  it('fehlt das Programm → 501 mit klarer Meldung', async () => {
    const e = new Erweiterungen(path.join(tmp, 'gibt-es-nicht'), path.join(tmp, 'd2'), path.join(tmp, 'v2'), () => ({}));
    const fehler = (await e.liste().catch((x: unknown) => x)) as EditorFehler;
    expect(fehler.status).toBe(501);
  });

  it('Liste lesen: nur Zeilen „herausgeber.name@version“, klein geschrieben, sortiert', () => {
    expect(listeLesen('Hinweis: irgendwas\nPKief.material-icon-theme@5.40.0\nesbenp.prettier-vscode@12.4.0\n\n--foo@1\nkaputt\na.b@x\n')).toEqual([
      { id: 'esbenp.prettier-vscode', version: '12.4.0' },
      { id: 'pkief.material-icon-theme', version: '5.40.0' },
    ]);
  });
});
