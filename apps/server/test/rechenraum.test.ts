import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ablageName, ablageOrdner, kurzname } from '../src/agenten/rechenraum.js';
import { werkzeugprofil } from '../src/agenten/leine.js';
import { tempOrdner, testDorf } from './hilfen.js';

const GEHEIM = 'rechenraum-test-geheimnis';
// Minimales gültiges PDF (eine leere Seite) – reines ASCII, passt durch rechenraum_schreiben
const PDF = '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF';

let runner: ChildProcess;
let url = '';
let arbeit = '';

beforeAll(async () => {
  const port = await new Promise<number>((r) => {
    const s = net.createServer().listen(0, () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => r(p));
    });
  });
  arbeit = tempOrdner('rechenraum-');
  runner = spawn('python3', [path.resolve(import.meta.dirname, '../../rechenraum/runner.py')], {
    env: { ...process.env, ARBEIT_DIR: arbeit, PORT: String(port), RECHENRAUM_GEHEIMNIS: GEHEIM, ZEITLIMIT_S: '5' },
    stdio: 'inherit',
  });
  url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${url}/gesundheit`).then((r) => r.ok, () => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Runner startet nicht');
});
afterAll(() => runner?.kill());

const AKTION = `---
name: Abgabe testen
motor: api
stufe: klein
fremdinhalte: ja
werkzeuge: [vault_lesen, rechenraum]
eingaben:
  - name: abgabe
---
Bearbeite {abgabe}.
`;

const befehl = (name: string, e: unknown) => `<<werkzeug ${name} ${JSON.stringify(e)}>>`;

describe('Rechenraum: Leine', () => {
  it('Werkzeuge nur mit werkzeuge: [rechenraum] – und auch mit Fremdinhalten (kein Netz, kein Vault)', () => {
    expect(werkzeugprofil({ werkzeuge: ['vault_lesen'], fremdinhalte: false }).dorf).not.toContain('rechenraum_befehl');
    const p = werkzeugprofil({ werkzeuge: ['vault_lesen', 'rechenraum'], fremdinhalte: true });
    expect(p.dorf).toEqual(expect.arrayContaining(['rechenraum_befehl', 'rechenraum_schreiben', 'rechenraum_vault_kopieren', 'rechenraum_seite_ansehen', 'rechenraum_ablegen']));
    expect(p.dorf).not.toContain('vault_schreiben');
    expect(p.web).toBe(false);
  });

  it('Zielordner bestimmt der Code; nur .pdf/.tex verlassen den Raum', () => {
    const erstellt = Date.UTC(2026, 10, 17, 13, 5); // 14:05 in Linz
    expect(ablageOrdner({ gebaeude: 'Uni', titel: 'x', erstellt, eingaben: { abgabe: 'Computational Data Analytics/aufgaben/Übung 3 (Teil a)' } })).toBe(
      'Uni/faecher/Computational Data Analytics/entwuerfe/2026-11-17_1405_uebung-3-teil-a',
    );
    expect(ablageOrdner({ gebaeude: 'Uni', titel: 'Freier Auftrag', erstellt, eingaben: { abgabe: '../Rathaus/aufgaben/x' } })).toBe('Uni/entwuerfe/2026-11-17_1405_freier-auftrag');
    expect(ablageOrdner({ gebaeude: 'Bibliothek', titel: 'Notizen: Statistik', erstellt, eingaben: {} })).toBe('Bibliothek/entwuerfe/2026-11-17_1405_notizen-statistik');
    expect(ablageName('out/Blatt 3_Loesung.pdf')).toBe('Blatt_3_Loesung.pdf');
    expect(ablageName('blatt.tex')).toBe('blatt.tex');
    expect(() => ablageName('rechnung.py')).toThrow(/nur \.pdf und \.tex/);
    expect(() => ablageName('a.pdf.sh')).toThrow();
    expect(kurzname('ÄÖÜ ß!!')).toBe('aeoeue-ss');
  });
});

describe('Rechenraum: Ende zu Ende (echter Runner, Attrappe als Motor)', () => {
  it('Übungsblatt hinein, rechnen, Seite als Bild ansehen, PDF ablegen – nur in den festen Ordner', async () => {
    const d = await testDorf({ env: { RECHENRAUM_URL: url, RECHENRAUM_GEHEIMNIS: GEHEIM } });
    await d.vault.schreiben('Uni/aktionen/abgabe-testen.md', AKTION);
    await d.vault.schreiben('Uni/faecher/CDA/aufgaben/Blatt 3/Blatt3.pdf', PDF);
    const bilder: unknown[] = [];
    const auftrag = [
      befehl('rechenraum_vault_kopieren', { vault_pfad: 'Uni/faecher/CDA/aufgaben/Blatt 3/Blatt3.pdf', ziel: 'angabe.pdf' }),
      befehl('rechenraum_schreiben', { pfad: 'rechne.py', inhalt: 'import shutil\nprint(sum(range(10)))\nshutil.copy("angabe.pdf", "Blatt3_Loesung.pdf")\n' }),
      befehl('rechenraum_befehl', { befehl: 'python3 rechne.py && ls' }),
      befehl('rechenraum_seite_ansehen', { pdf: 'Blatt3_Loesung.pdf', seite: 1 }),
      befehl('rechenraum_ablegen', { datei: 'Blatt3_Loesung.pdf' }),
      befehl('rechenraum_ablegen', { datei: 'rechne.py' }),
      befehl('rechenraum_schreiben', { pfad: '../raus.txt', inhalt: 'x' }),
      befehl('rechenraum_befehl', { befehl: 'cat /vault/Uni/gebaeude.md; ls /vault; echo ende' }),
    ].join('\n');
    const { chatId } = await d.agenten.aktionStarten('Uni/abgabe-testen', { abgabe: `CDA/aufgaben/Blatt 3\n${auftrag}` });
    await d.agenten.leerlauf();

    const log = d.db.prepare('SELECT werkzeug, erlaubt, ergebnis, pfad FROM werkzeug_log WHERE chat_id = ? ORDER BY id').all(chatId) as {
      werkzeug: string;
      erlaubt: number;
      ergebnis: string;
      pfad: string | null;
    }[];
    const nach = (w: string) => log.filter((l) => l.werkzeug === w);
    expect(nach('rechenraum_befehl')[0]!.ergebnis).toMatch(/^Exit-Code 0/);
    expect(nach('rechenraum_seite_ansehen')[0]).toMatchObject({ erlaubt: 1, ergebnis: 'Seite 1 von 1' });
    // Ablage: Ordner vom Code (Freitext-Eingabe mit Zeilenumbruch passt nicht → Standardordner des Gebäudes)
    const abgelegt = nach('rechenraum_ablegen');
    expect(abgelegt[0]!.erlaubt).toBe(1);
    expect(abgelegt[0]!.pfad).toMatch(/^Uni\/entwuerfe\/2026-11-16_1300_abgabe-testen-cda-aufgaben-blatt-3[a-z-]*\/Blatt3_Loesung\.pdf$/);
    expect(fs.readFileSync(d.vault.abs(abgelegt[0]!.pfad!), 'utf8')).toBe(PDF);
    expect(abgelegt[1]).toMatchObject({ erlaubt: 0 });
    expect(abgelegt[1]!.ergebnis).toMatch(/nur \.pdf und \.tex/);
    expect(nach('rechenraum_schreiben')[1]).toMatchObject({ erlaubt: 0 });
    // Kein Vault im Rechenraum
    const c = d.agenten.chatDetail(chatId);
    const werkzeugText = c.nachrichten.filter((n) => n.rolle === 'werkzeug').map((n) => n.text).join('\n');
    expect(werkzeugText).toContain('rechenraum_befehl: Exit-Code 0');
    expect(werkzeugText).toMatch(/No such file or directory[\s\S]*ende/);
    expect(werkzeugText).not.toContain('Arbeitsanweisung');
    void bilder;
  });

  it('ohne eingerichteten Rechenraum: klare Meldung statt Absturz', async () => {
    const d = await testDorf();
    await d.vault.schreiben('Uni/aktionen/abgabe-testen.md', AKTION);
    const { chatId } = await d.agenten.aktionStarten('Uni/abgabe-testen', { abgabe: `x\n${befehl('rechenraum_befehl', { befehl: 'true' })}` });
    await d.agenten.leerlauf();
    const l = d.db.prepare("SELECT erlaubt, ergebnis FROM werkzeug_log WHERE chat_id = ? AND werkzeug = 'rechenraum_befehl'").get(chatId) as { erlaubt: number; ergebnis: string };
    expect(l).toMatchObject({ erlaubt: 0 });
    expect(l.ergebnis).toMatch(/nicht eingerichtet/);
  });

  it('der Raum gehört dem Chat: ein anderer Chat sieht die Dateien nicht', async () => {
    const d = await testDorf({ env: { RECHENRAUM_URL: url, RECHENRAUM_GEHEIMNIS: GEHEIM } });
    await d.vault.schreiben('Uni/aktionen/abgabe-testen.md', AKTION);
    const a = await d.agenten.aktionStarten('Uni/abgabe-testen', { abgabe: `a\n${befehl('rechenraum_schreiben', { pfad: 'geheim.txt', inhalt: 'nur A' })}` });
    const b = await d.agenten.aktionStarten('Uni/abgabe-testen', { abgabe: `b\n${befehl('rechenraum_befehl', { befehl: 'cat geheim.txt; ls ..' })}` });
    await d.agenten.leerlauf();
    expect(fs.existsSync(path.join(arbeit, a.chatId, 'geheim.txt'))).toBe(true);
    const t = d.agenten.chatDetail(b.chatId).nachrichten.map((n) => n.text).join('\n');
    expect(t).not.toContain('nur A');
    expect(t).toContain('No such file');
  });
});
