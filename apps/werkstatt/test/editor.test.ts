import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Editor } from '../src/editor.js';

/**
 * E197 – Editor im Codehaus: Endpunkte des Runners für Dateien, Suche, Git und Terminal.
 * Echter Runner (aus dem Quelltext) im Profil coding; zum Vergleich einer im Werkstatt-Profil (dort gibt es nichts davon).
 */
const HIER = path.resolve(import.meta.dirname, '..');
const GEHEIMNIS = 'editor-geheimnis-editor-geheimnis-editor-12';
const PORT = 4631;
const PORT_W = 4632;
const arbeit = fs.mkdtempSync(path.join(os.tmpdir(), 'dorf-test-editor-'));
const draussen = fs.mkdtempSync(path.join(os.tmpdir(), 'dorf-test-draussen-'));
const nebenher = [fs.mkdtempSync(path.join(os.tmpdir(), 'dorf-test-heim-')), fs.mkdtempSync(path.join(os.tmpdir(), 'dorf-test-lauf-')), fs.mkdtempSync(path.join(os.tmpdir(), 'dorf-test-warbeit-'))];
const P = 'mein-repo';
let runner: ChildProcess;
let werkstatt: ChildProcess;

const url = (p: string, port = PORT) => `http://127.0.0.1:${port}${p}`;
const kopf = { 'x-werkstatt-geheimnis': GEHEIMNIS, 'content-type': 'application/json' };
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
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
const lesen = (pfad: string, projekt = P) => hole(`/editor/datei?${q({ projekt, pfad })}`);
const schreiben = (pfad: string, text: string, mehr: Record<string, unknown> = {}) => hole('/editor/datei', { method: 'PUT', body: JSON.stringify({ projekt: P, pfad, text, ...mehr }) });
const git = (befehl: string, mehr: Record<string, unknown> = {}) => post('/editor/git', { projekt: P, befehl, ...mehr });

beforeAll(async () => {
  fs.mkdirSync(path.join(arbeit, P, 'src'), { recursive: true });
  fs.writeFileSync(path.join(arbeit, P, 'src/a.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(arbeit, P, 'README.md'), '# Hallo\n\nSuchwort Apfelkuchen hier.\n');
  fs.writeFileSync(path.join(draussen, 'geheim.txt'), 'streng geheim');
  const basis = { PATH: process.env.PATH ?? '', HOME: nebenher[0]!, GH_TOKEN: 'ghp_test', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@dorf.test', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@dorf.test' };
  const start = (env: Record<string, string>) => spawn(process.execPath, ['--import', 'tsx', 'src/runner.ts'], { cwd: HIER, env: { ...basis, ...env }, stdio: 'inherit' });
  runner = start({ PORT: String(PORT), RUNNER_PROFIL: 'coding', CODING_GEHEIMNIS: GEHEIMNIS, VSCODE_TOKEN: 'vscode-token-darf-nicht-ins-terminal-123456', ARBEIT_DIR: arbeit, LAUF_DIR: nebenher[1]! });
  werkstatt = start({ PORT: String(PORT_W), WERKSTATT_GEHEIMNIS: GEHEIMNIS, ARBEIT_DIR: nebenher[2]! });
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
  for (const o of [arbeit, draussen, ...nebenher]) fs.rmSync(o, { recursive: true, force: true });
});

describe('Editor-Endpunkte: nur Profil coding, nur mit Geheimnis', () => {
  it('ohne Geheimnis 401', async () => {
    for (const weg of ['/editor/baum?projekt=mein-repo&pfad=', '/editor/datei?projekt=mein-repo&pfad=README.md', '/editor/dateien?projekt=mein-repo']) expect((await fetch(url(weg))).status, weg).toBe(401);
    expect((await fetch(url('/terminal'), { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await fetch(url('/editor/git'), { method: 'POST', body: '{}' })).status).toBe(401);
  });

  it('Werkstatt-Profil kennt weder Editor noch Terminal', async () => {
    expect((await hole(`/editor/baum?${q({ projekt: P, pfad: '' })}`, {}, PORT_W)).status).toBe(404);
    expect((await hole(`/editor/datei?${q({ projekt: P, pfad: 'README.md' })}`, {}, PORT_W)).status).toBe(404);
    expect((await hole('/editor/datei', { method: 'PUT', body: JSON.stringify({ projekt: P, pfad: 'x', text: 'x' }) }, PORT_W)).status).toBe(404);
    expect((await post('/editor/git', { projekt: P, befehl: 'status' }, PORT_W)).status).toBe(404);
    expect((await post('/terminal', { id: crypto.randomUUID() }, PORT_W)).status).toBe(404);
    expect((await hole(`/terminal/${crypto.randomUUID()}`, { method: 'DELETE' }, PORT_W)).status).toBe(404);
  });
});

describe('Dateien', () => {
  it('Baum: Ordner zuerst, .git versteckt, Symlinks als Link markiert', async () => {
    fs.mkdirSync(path.join(arbeit, P, '.git'), { recursive: true });
    fs.symlinkSync(draussen, path.join(arbeit, P, 'raus'));
    const r = await hole(`/editor/baum?${q({ projekt: P, pfad: '' })}`);
    expect(r.status).toBe(200);
    expect(r.j.eintraege).toEqual([
      { name: 'src', art: 'ordner' },
      { name: 'raus', art: 'link' },
      { name: 'README.md', art: 'datei', groesse: 36 },
    ]);
    fs.rmSync(path.join(arbeit, P, '.git'), { recursive: true });
    expect((await hole(`/editor/baum?${q({ projekt: P, pfad: 'src' })}`)).j.eintraege).toEqual([{ name: 'a.ts', art: 'datei', groesse: 20 }]);
    expect((await hole(`/editor/baum?${q({ projekt: 'gibts-nicht', pfad: '' })}`)).status).toBe(404);
  });

  it('lesen, ändern mit Version, Konflikt statt Überschreiben, Rechte bleiben', async () => {
    const a = await lesen('src/a.ts');
    expect(a.j).toMatchObject({ text: 'export const a = 1;\n', groesse: 20 });
    fs.chmodSync(path.join(arbeit, P, 'src/a.ts'), 0o755);
    const b = await schreiben('src/a.ts', 'export const a = 2;\n', { basisVersion: a.j.version });
    expect(b.status).toBe(200);
    expect(fs.readFileSync(path.join(arbeit, P, 'src/a.ts'), 'utf8')).toBe('export const a = 2;\n');
    expect(fs.statSync(path.join(arbeit, P, 'src/a.ts')).mode & 0o777).toBe(0o755);
    // jemand anderes (Agent, Terminal) ändert die Datei – der alte Stand überschreibt nichts
    fs.writeFileSync(path.join(arbeit, P, 'src/a.ts'), 'vom Agenten\n');
    const c = await schreiben('src/a.ts', 'meins\n', { basisVersion: b.j.version });
    expect(c.status).toBe(409);
    expect(c.j.konflikt).toBe(true);
    expect(fs.readFileSync(path.join(arbeit, P, 'src/a.ts'), 'utf8')).toBe('vom Agenten\n');
    // keine Reste von temporären Dateien
    expect(fs.readdirSync(path.join(arbeit, P, 'src'))).toEqual(['a.ts']);
    // neue Datei in neuem Ordner; „neu“ überschreibt nie
    expect((await schreiben('neu/tief/b.txt', 'hallo', { neu: true })).status).toBe(200);
    expect((await schreiben('neu/tief/b.txt', 'nochmal', { neu: true })).status).toBe(409);
    expect(fs.readFileSync(path.join(arbeit, P, 'neu/tief/b.txt'), 'utf8')).toBe('hallo');
  });

  it('Pfad-Tricks: .., absolut, .git, Steuerzeichen, falscher Projektname – alles abgelehnt, nichts entsteht draußen', async () => {
    for (const pfad of ['../x', 'src/../../x', '/etc/passwd', 'src//a.ts', './a', '.git/config', 'src/.git/hooks/pre-commit', 'a\\b', 'a\u0000b', 'a\nb']) {
      expect((await lesen(pfad)).status, `lesen ${JSON.stringify(pfad)}`).toBe(400);
      expect((await schreiben(pfad, 'böse')).status, `schreiben ${JSON.stringify(pfad)}`).toBe(400);
      expect((await post('/editor/loeschen', { projekt: P, pfad })).status, `löschen ${JSON.stringify(pfad)}`).toBe(400);
      expect((await post('/editor/umbenennen', { projekt: P, von: 'README.md', nach: pfad })).status, `umbenennen ${JSON.stringify(pfad)}`).toBe(400);
    }
    for (const projekt of ['..', '.heim', 'a/b', '', '.papierkorb', '-x']) {
      expect((await lesen('README.md', projekt)).status, projekt).toBe(400);
      expect((await post('/editor/git', { projekt, befehl: 'status' })).status, projekt).toBe(400);
      expect((await post('/editor/projekt', { projekt })).status, projekt).toBe(400);
    }
    expect(fs.existsSync(path.join(arbeit, 'x'))).toBe(false);
    expect(fs.readdirSync(draussen)).toEqual(['geheim.txt']);
  });

  it('Symlinks werden nie verfolgt: weder Datei noch Ordner, weder lesen noch schreiben, auch nicht als Projekt', async () => {
    fs.symlinkSync(path.join(draussen, 'geheim.txt'), path.join(arbeit, P, 'link.txt'));
    expect((await lesen('link.txt')).status).toBe(400);
    expect((await lesen('link.txt')).t).not.toContain('streng geheim');
    expect((await lesen('raus/geheim.txt')).status).toBe(400);
    expect((await hole(`/editor/roh?${q({ projekt: P, pfad: 'raus/geheim.txt' })}`)).status).toBe(400);
    expect((await hole(`/editor/baum?${q({ projekt: P, pfad: 'raus' })}`)).status).toBe(400);
    expect((await schreiben('link.txt', 'überschrieben')).status).toBe(400);
    expect((await schreiben('raus/neu.txt', 'draußen')).status).toBe(400);
    expect((await post('/editor/neu', { projekt: P, pfad: 'raus/ordner', art: 'ordner' })).status).toBe(400);
    expect((await hole(`/editor/hochladen?${q({ projekt: P, pfad: 'raus/hoch.bin' })}`, { method: 'POST', body: 'x' })).status).toBe(400);
    expect((await post('/editor/umbenennen', { projekt: P, von: 'README.md', nach: 'raus/README.md' })).status).toBe(400);
    expect(fs.readFileSync(path.join(draussen, 'geheim.txt'), 'utf8')).toBe('streng geheim');
    expect(fs.readdirSync(draussen)).toEqual(['geheim.txt']);
    // ein Projekt, das selbst ein Symlink ist
    fs.symlinkSync(draussen, path.join(arbeit, 'falsches-projekt'));
    expect((await lesen('geheim.txt', 'falsches-projekt')).status).toBe(400);
    expect((await post('/editor/git', { projekt: 'falsches-projekt', befehl: 'status' })).status).toBe(400);
    expect((await post('/terminal', { id: crypto.randomUUID(), projekt: 'falsches-projekt' })).status).toBe(400);
    // den Link selbst löschen geht (er wandert in den Papierkorb, das Ziel bleibt)
    expect((await post('/editor/loeschen', { projekt: P, pfad: 'link.txt' })).status).toBe(200);
    expect(fs.existsSync(path.join(draussen, 'geheim.txt'))).toBe(true);
  });

  it('Wettlauf: Datei wird pausenlos gegen einen Symlink getauscht – das Geheimnis kommt nie heraus', async () => {
    const ziel = path.join(arbeit, P, 'wechsel.txt');
    const tausch = spawn(process.execPath, ['-e', `const fs=require('fs');const z=${JSON.stringify(ziel)},g=${JSON.stringify(path.join(draussen, 'geheim.txt'))};for(;;){try{fs.rmSync(z,{force:true});fs.writeFileSync(z,'harmlos')}catch{}try{fs.rmSync(z,{force:true});fs.symlinkSync(g,z)}catch{}}`]);
    try {
      const ende = Date.now() + 1500;
      let n = 0;
      while (Date.now() < ende) {
        const r = await lesen('wechsel.txt');
        expect(r.t).not.toContain('streng geheim');
        n++;
      }
      expect(n).toBeGreaterThan(20);
    } finally {
      tausch.kill('SIGKILL');
      fs.rmSync(ziel, { force: true });
    }
  });

  it('Grenzen: Text über 2 MB wird nicht geladen und nicht gespeichert; Binärdateien nur als Download; Hochladen bis 20 MB', async () => {
    fs.writeFileSync(path.join(arbeit, P, 'gross.txt'), 'x'.repeat(2 * 1024 * 1024 + 1));
    expect((await lesen('gross.txt')).j).toMatchObject({ zuGross: true });
    expect((await lesen('gross.txt')).j.text).toBeUndefined();
    expect((await schreiben('zu-gross.txt', 'y'.repeat(2 * 1024 * 1024 + 1))).status).toBe(413);
    expect(fs.existsSync(path.join(arbeit, P, 'zu-gross.txt'))).toBe(false);
    const bin = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 0xff]);
    const h = await hole(`/editor/hochladen?${q({ projekt: P, pfad: 'bild.png' })}`, { method: 'POST', body: bin, headers: { 'content-type': 'application/octet-stream' } });
    expect(h.status).toBe(200);
    expect((await lesen('bild.png')).j).toMatchObject({ binaer: true, groesse: 9 });
    const roh = await fetch(url(`/editor/roh?${q({ projekt: P, pfad: 'bild.png' })}`), { headers: kopf });
    expect(Buffer.from(await roh.arrayBuffer()).equals(bin)).toBe(true);
    // Hochladen überschreibt nur auf Wunsch
    expect((await hole(`/editor/hochladen?${q({ projekt: P, pfad: 'bild.png' })}`, { method: 'POST', body: 'neu' })).status).toBe(409);
    expect((await hole(`/editor/hochladen?${q({ projekt: P, pfad: 'bild.png', ersetzen: '1' })}`, { method: 'POST', body: 'neu' })).status).toBe(200);
    const zuViel = await fetch(url(`/editor/hochladen?${q({ projekt: P, pfad: 'riesig.bin' })}`), { method: 'POST', headers: kopf, body: Buffer.alloc(20 * 1024 * 1024 + 1) })
      .then((r) => r.status)
      .catch(() => 413);
    expect(zuViel).toBe(413);
    expect(fs.existsSync(path.join(arbeit, P, 'riesig.bin'))).toBe(false);
    fs.rmSync(path.join(arbeit, P, 'gross.txt'));
  });

  it('neu, umbenennen, löschen (Papierkorb), Projekt anlegen', async () => {
    expect((await post('/editor/neu', { projekt: P, pfad: 'docs', art: 'ordner' })).status).toBe(200);
    expect((await post('/editor/neu', { projekt: P, pfad: 'docs', art: 'ordner' })).status).toBe(409);
    expect((await post('/editor/neu', { projekt: P, pfad: 'docs/plan.md', art: 'datei' })).status).toBe(200);
    expect((await post('/editor/neu', { projekt: P, pfad: 'docs/plan.md', art: 'datei' })).status).toBe(409);
    expect((await post('/editor/umbenennen', { projekt: P, von: 'docs/plan.md', nach: 'docs/ziel.md' })).status).toBe(200);
    expect((await post('/editor/umbenennen', { projekt: P, von: 'docs/ziel.md', nach: 'README.md' })).status).toBe(409);
    expect((await post('/editor/umbenennen', { projekt: P, von: 'docs', nach: 'docs/innen' })).status).toBe(400);
    expect((await post('/editor/umbenennen', { projekt: P, von: 'gibts-nicht', nach: 'x' })).status).toBe(404);
    const l = await post('/editor/loeschen', { projekt: P, pfad: 'docs' });
    expect(l.status).toBe(200);
    expect(fs.existsSync(path.join(arbeit, P, 'docs'))).toBe(false);
    expect(fs.existsSync(path.join(arbeit, String(l.j.papierkorb), 'ziel.md'))).toBe(true);
    expect((await post('/editor/loeschen', { projekt: P, pfad: 'docs' })).status).toBe(404);
    expect((await post('/editor/projekt', { projekt: 'frisch' })).status).toBe(200);
    expect((await post('/editor/projekt', { projekt: 'frisch' })).status).toBe(409);
    expect(fs.statSync(path.join(arbeit, 'frisch')).isDirectory()).toBe(true);
    // der Papierkorb ist kein Projekt
    const liste = (await hole('/projekte')).j.projekte as { name: string }[];
    expect(liste.map((p) => p.name)).not.toContain('.papierkorb');
  });
});

describe('Suche', () => {
  it('Dateiliste und Volltext (ripgrep) – ohne Symlinks zu folgen', async () => {
    const d = await hole(`/editor/dateien?${q({ projekt: P })}`);
    expect(d.status).toBe(200);
    expect(d.j.dateien).toEqual(expect.arrayContaining(['README.md', 'src/a.ts']));
    expect(d.j.dateien).not.toContain('raus/geheim.txt');
    const s = await post('/editor/suche', { projekt: P, text: 'apfelkuchen' });
    expect(s.j.treffer).toEqual([{ pfad: 'README.md', zeile: 3, spalte: 10, text: 'Suchwort Apfelkuchen hier.' }]);
    expect(((await post('/editor/suche', { projekt: P, text: 'apfelkuchen', gross: true })).j.treffer as unknown[]).length).toBe(0);
    expect(((await post('/editor/suche', { projekt: P, text: 'Apfel.uchen', regex: true })).j.treffer as unknown[]).length).toBe(1);
    // „streng geheim“ liegt nur hinter dem Symlink
    expect(((await post('/editor/suche', { projekt: P, text: 'streng geheim' })).j.treffer as unknown[]).length).toBe(0);
    // ein Suchtext, der wie eine Option aussieht, bleibt Suchtext
    expect((await post('/editor/suche', { projekt: P, text: '--files' })).status).toBe(200);
    expect((await post('/editor/suche', { projekt: P, text: '' })).status).toBe(400);
  });
});

describe('Git', () => {
  it('Status, Original, Commit, Branch – Werte landen nie als Option bei git', async () => {
    expect((await git('status')).j).toMatchObject({ git: false });
    expect((await git('init')).j.ok).toBe(true);
    execFileSync('git', ['-C', path.join(arbeit, P), 'checkout', '-q', '-b', 'main']);
    const s1 = (await git('status')).j as { branch: string; dateien: { pfad: string; x: string; y: string }[] };
    expect(s1.branch).toBe('main');
    expect(s1.dateien.find((d) => d.pfad === 'README.md')).toMatchObject({ x: '?', y: '?' });
    expect((await git('commit', { nachricht: '' })).status).toBe(400);
    const c = await git('commit', { nachricht: '--amend ist nur Text\n\nErster Commit', alle: true });
    expect(c.j.ok, String(c.j.ausgabe)).toBe(true);
    expect(execFileSync('git', ['-C', path.join(arbeit, P), 'log', '--format=%s']).toString().trim()).toBe('--amend ist nur Text');
    expect(((await git('status')).j.dateien as unknown[]).length).toBe(0);
    // ändern → Status „geändert“, Original = Stand im letzten Commit
    fs.writeFileSync(path.join(arbeit, P, 'README.md'), '# Neu\n');
    const s2 = (await git('status')).j as { dateien: { pfad: string; x: string; y: string }[] };
    expect(s2.dateien).toEqual([{ pfad: 'README.md', x: ' ', y: 'M' }]);
    expect((await git('original', { pfad: 'README.md' })).j.text).toBe('# Hallo\n\nSuchwort Apfelkuchen hier.\n');
    expect((await git('original', { pfad: 'gibts-noch-nicht.md' })).j).toMatchObject({ text: '', neu: true });
    expect((await git('vormerken', { pfad: 'README.md' })).j.ok).toBe(true);
    expect(((await git('status')).j.dateien as { x: string }[])[0]!.x).toBe('M');
    expect((await git('zuruecknehmen', { pfad: 'README.md' })).j.ok).toBe(true);
    expect((await git('verwerfen', { pfad: 'README.md' })).j.ok).toBe(true);
    expect(fs.readFileSync(path.join(arbeit, P, 'README.md'), 'utf8')).toContain('Apfelkuchen');
    // Branches
    expect((await git('anlegen', { branch: 'feature/editor' })).j.ok).toBe(true);
    expect((await git('branches')).j).toMatchObject({ aktuell: 'feature/editor', lokal: ['feature/editor', 'main'] });
    expect((await git('wechseln', { branch: 'main' })).j.ok).toBe(true);
    for (const branch of ['-D', '--orphan', 'a..b', 'a b', 'x;rm -rf .', '']) expect((await git('wechseln', { branch })).status, branch).toBe(400);
    expect((await git('vormerken', { pfad: '../x' })).status).toBe(400);
    expect((await git('original', { pfad: '.git/config' })).status).toBe(400);
    expect((await git('rm -rf')).status).toBe(400);
    expect(((await git('verlauf')).j.commits as { betreff: string }[])[0]!.betreff).toBe('--amend ist nur Text');
    // Push ohne Gegenstelle: Fehler von git kommt als Ausgabe zurück, nicht als Absturz
    const p = await git('push');
    expect(p.status).toBe(200);
    expect(p.j.ok).toBe(false);
    expect(String(p.j.ausgabe)).toMatch(/origin/);
  });

  it('E204: Pfade sind wörtlich, nie Muster – „*“ vormerken/zurücknehmen/verwerfen trifft nur die Datei „*“', async () => {
    const G = 'stern-repo';
    const o = path.join(arbeit, G);
    fs.mkdirSync(o);
    const inhalt = (n: string) => fs.readFileSync(path.join(o, n), 'utf8');
    for (const [n, t] of [['a.txt', 'a1\n'], ['b.txt', 'b1\n'], ['*', 'stern1\n']]) fs.writeFileSync(path.join(o, n!), t!);
    const g = (befehl: string, mehr: Record<string, unknown> = {}) => post('/editor/git', { projekt: G, befehl, ...mehr });
    expect((await g('init')).j.ok).toBe(true);
    expect((await g('commit', { nachricht: 'Start', alle: true })).j.ok).toBe(true);
    for (const [n, t] of [['a.txt', 'a2\n'], ['b.txt', 'b2\n'], ['*', 'stern2\n']]) fs.writeFileSync(path.join(o, n!), t!);
    // vormerken: nur „*“ landet im Index, nicht alles, was auf * passt
    expect((await g('vormerken', { pfad: '*' })).j.ok).toBe(true);
    const status = () => (async () => ((await g('status')).j.dateien as { pfad: string; x: string; y: string }[]).sort((a, b) => a.pfad.localeCompare(b.pfad)))();
    expect(await status()).toEqual([
      { pfad: '*', x: 'M', y: ' ' },
      { pfad: 'a.txt', x: ' ', y: 'M' },
      { pfad: 'b.txt', x: ' ', y: 'M' },
    ]);
    expect((await g('zuruecknehmen', { pfad: '*' })).j.ok).toBe(true);
    expect((await g('verwerfen', { pfad: '*' })).j.ok).toBe(true);
    expect(inhalt('*')).toBe('stern1\n');
    expect(inhalt('a.txt')).toBe('a2\n');
    expect(inhalt('b.txt')).toBe('b2\n');
    // Pathspec-Magie ist ebenfalls nur ein Name
    expect((await g('verwerfen', { pfad: ':(glob)*.txt' })).j.ok).toBe(false);
    expect(inhalt('a.txt')).toBe('a2\n');
  });

  it('E204: nach dem Zeitlimit endet die ganze Prozessgruppe – auch was ein Git-Hook gestartet hat', async () => {
    const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'dorf-test-hook-'));
    try {
      const o = path.join(wurzel, 'hook-repo');
      fs.mkdirSync(o);
      execFileSync('git', ['init', '-q'], { cwd: o });
      fs.writeFileSync(path.join(o, '.git/hooks/pre-commit'), '#!/bin/sh\nsleep 6211 &\nexec sleep 6212\n', { mode: 0o755 });
      fs.writeFileSync(path.join(o, 'x.txt'), 'x\n');
      const env = { PATH: process.env.PATH ?? '', HOME: nebenher[0]!, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@dorf.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@dorf.test' };
      const ed = new Editor(wurzel, () => env, 1500);
      const laeuft = () => execFileSync('sh', ['-c', 'ps -eo args | grep "^sleep 621[12]" || true']).toString();
      const r = await ed.git('hook-repo', { befehl: 'commit', nachricht: 'mit Hook', alle: true });
      expect(r.ok).toBe(false);
      expect(String(r.ausgabe)).toContain('Zeitlimit');
      for (let i = 0; i < 40 && laeuft(); i++) await new Promise((x) => setTimeout(x, 50));
      expect(laeuft()).toBe('');
    } finally {
      execFileSync('sh', ['-c', 'pkill -f "^sleep 621[12]" || true']);
      fs.rmSync(wurzel, { recursive: true, force: true });
    }
  }, 20_000);
});

describe('Terminal', () => {
  async function terminal(body: Record<string, unknown>) {
    const id = crypto.randomUUID();
    const r = await fetch(url('/terminal'), { method: 'POST', headers: kopf, body: JSON.stringify({ id, ...body }) });
    let aus = '';
    const dek = new TextDecoder();
    const leser = r.body!.getReader();
    const fertig = (async () => {
      for (;;) {
        const { done, value } = await leser.read().catch(() => ({ done: true, value: undefined }));
        if (done) return;
        aus += dek.decode(value, { stream: true });
      }
    })();
    const bis = async (muster: RegExp, ms = 10_000) => {
      const ende = Date.now() + ms;
      while (!muster.test(aus)) {
        if (Date.now() > ende) throw new Error(`Terminal: ${muster} kam nicht. Ausgabe: ${JSON.stringify(aus.slice(-500))}`);
        await new Promise((x) => setTimeout(x, 30));
      }
    };
    const tippe = (t: string) => fetch(url(`/terminal/${id}/eingabe`), { method: 'POST', headers: kopf, body: t }).then((x) => x.status);
    return { id, r, bis, tippe, fertig, text: () => aus, leser };
  }

  it('echtes PTY: Shell im Projektordner, Eingabe/Ausgabe, Größe ändern, Geheimnisse nicht in der Umgebung, Ende', async () => {
    const t = await terminal({ projekt: P, spalten: 91, zeilen: 17 });
    expect(t.r.status).toBe(200);
    expect(await t.tippe('test -t 0 && echo ist-ein-$((40+2))-tty; pwd; stty size\n')).toBe(200);
    await t.bis(/ist-ein-42-tty/);
    await t.bis(new RegExp(`${P}\\r?\\n`));
    await t.bis(/17 91/);
    const g = await post(`/terminal/${t.id}/groesse`, { spalten: 120, zeilen: 40 });
    expect(g.status).toBe(200);
    await t.tippe('stty size\n');
    await t.bis(/40 120/);
    await t.tippe('echo "g=[${CODING_GEHEIMNIS:-leer}] v=[${VSCODE_TOKEN:-leer}] gh=[${GH_TOKEN:-leer}] t=$TERM"\n');
    await t.bis(/g=\[leer\] v=\[leer\] gh=\[ghp_test\] t=xterm-256color/);
    await t.tippe('exit\n');
    await t.fertig;
    expect((await post(`/terminal/${t.id}/groesse`, { spalten: 80, zeilen: 24 })).status).toBe(404);
    expect(await t.tippe('x')).toBe(404);
  }, 30_000);

  it('Verbindung zu → Shell und ihre Kinder enden; höchstens 8 gleichzeitig; trennen schließt alle', async () => {
    const t = await terminal({ projekt: P });
    await t.tippe('sleep 613\n');
    const laeuft = () => execFileSync('sh', ['-c', 'ps -eo pid,args | grep "[s]leep 613" || true']).toString();
    for (let i = 0; i < 100 && !laeuft(); i++) await new Promise((x) => setTimeout(x, 50));
    expect(laeuft()).toContain('sleep 613');
    await t.leser.cancel();
    for (let i = 0; i < 100 && laeuft(); i++) await new Promise((x) => setTimeout(x, 50));
    expect(laeuft()).toBe('');

    const viele = [];
    for (let i = 0; i < 8; i++) viele.push(await terminal({}));
    for (const v of viele) expect(v.r.status).toBe(200);
    const neun = await post('/terminal', { id: crypto.randomUUID() });
    expect(neun.status).toBe(429);
    // E204: „alle trennen“ gab es nur auf dem Papier (niemand rief es) – das Dorf schließt jedes Terminal einzeln
    expect((await post('/terminal/trennen', {})).status).toBe(404);
    for (const v of viele) expect((await hole(`/terminal/${v.id}`, { method: 'DELETE' })).status).toBe(200);
    await Promise.all(viele.map((v) => v.fertig));
    expect((await hole(`/terminal/${viele[0]!.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await post('/terminal', { id: 'keine-uuid' })).status).toBe(400);
  }, 30_000);

  it('E204: Gegendruck – liest niemand die Ausgabe, steht die Shell, statt dass der Runner Speicher sammelt', async () => {
    const id = crypto.randomUUID();
    // http.request statt fetch: der Test hält das Lesen wirklich an
    const antwort = await new Promise<http.IncomingMessage>((ok, kaputt) => {
      const a = http.request(url('/terminal'), { method: 'POST', headers: kopf }, ok);
      a.on('error', kaputt);
      a.end(JSON.stringify({ id, projekt: P }));
    });
    expect(antwort.statusCode).toBe(200);
    antwort.pause();
    const tippe = (t: string) => fetch(url(`/terminal/${id}/eingabe`), { method: 'POST', headers: kopf, body: t }).then((x) => x.status);
    const rss = () => Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${runner.pid}/status`, 'utf8'))![1]) * 1024;
    const yes = () => execFileSync('sh', ['-c', 'ps -eo stat,args | grep " yes dorf-gegendruck-2$" || true']).toString().trim();
    const vorher = rss();
    expect(await tippe('yes dorf-gegendruck-$((1+1))\n')).toBe(200);
    for (let i = 0; i < 100 && !yes(); i++) await new Promise((x) => setTimeout(x, 30));
    await new Promise((x) => setTimeout(x, 2000));
    // ohne Gegendruck: > 100 MB in zwei Sekunden (gemessen 85 MB/s im Dorf); mit: ein paar Puffer
    expect(rss() - vorher).toBeLessThan(40 * 1024 * 1024);
    // yes wartet aufs PTY (S), statt zu rechnen (R)
    expect(yes()).toMatch(/^S/);
    // weiterlesen: Strg+C kommt durch, die Shell antwortet wieder
    let aus = '';
    antwort.on('data', (d: Buffer) => {
      aus = (aus + d.toString('latin1')).slice(-4000);
    });
    antwort.resume();
    expect(await tippe('\x03')).toBe(200);
    expect(await tippe('echo wieder-$((40+2))\n')).toBe(200);
    for (let i = 0; i < 300 && !/wieder-42/.test(aus); i++) await new Promise((x) => setTimeout(x, 50));
    expect(aus).toMatch(/wieder-42/);
    expect(yes()).toBe('');
    const ende = new Promise((x) => antwort.on('end', x));
    await tippe('exit\n');
    await ende;
  }, 30_000);
});
