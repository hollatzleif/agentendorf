import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WerkzeugKiste } from '../src/agenten/werkzeuge.js';
import { rechenraumKlient } from '../src/agenten/rechenraum.js';
import { EXTRA_RECHENRAUM } from '../src/agenten/leine-extra.js';
import { passwortSetzen } from '../src/auth/passwort.js';
import { cookieAus, ORIGIN, tempOrdner, testDorf } from './hilfen.js';

/**
 * E199: Rechenraum-Werkzeuge gegen den echten Runner (apps/rechenraum/runner.py + dorfwerk.py). Was ein Python-Paket
 * braucht, das lokal fehlt (pypdf, pandas/duckdb, segno, genanki), wird übersprungen – im Image läuft alles (rauchtest.py).
 */
const GEHEIM = 'rechenraum-e199';
const hat = (modul: string) => spawnSync('python3', ['-c', `import ${modul}`], { env: process.env }).status === 0;
const PYPDF = hat('pypdf');
const DATEN = hat('duckdb') || hat('pandas');
const SEGNO = hat('segno');
const GENANKI = hat('genanki');
const NUMPY = hat('numpy');
/** E212: winziges Zufallsmodell im torch.save-Format (das echte Modell liegt nur im Image) */
const HANDSCHRIFT_MODELL = tempOrdner('handschrift-modell-');
if (NUMPY)
  spawnSync('python3', ['-c', 'import sys; sys.path.insert(0, sys.argv[1]); import test_handschrift as t; t.kleines_modell(sys.argv[2])', path.resolve(import.meta.dirname, '../../rechenraum/test'), HANDSCHRIFT_MODELL], { stdio: 'inherit' });
const ABLAGE = 'Rathaus/dateien/2026-11-16_1300_test';

/** PDF mit n Seiten („Seite i“), reines ASCII */
function pdf(n: number) {
  const objekte: string[] = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kinder: number[] = [];
  for (let i = 1; i <= n; i++) {
    const inhalt = `BT /F1 24 Tf 72 700 Td (Seite ${i}) Tj ET`;
    objekte.push(`<< /Length ${inhalt.length} >>\nstream\n${inhalt}\nendstream`);
    objekte.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objekte.length} 0 R >>`);
    kinder.push(objekte.length);
  }
  objekte[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objekte[1] = `<< /Type /Pages /Kids [${kinder.map((k) => `${k} 0 R`).join(' ')}] /Count ${n} >>`;
  let aus = '%PDF-1.4\n';
  const stellen: number[] = [];
  objekte.forEach((o, i) => {
    stellen.push(aus.length);
    aus += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = aus.length;
  aus += `xref\n0 ${objekte.length + 1}\n0000000000 65535 f \n${stellen.map((s) => `${String(s).padStart(10, '0')} 00000 n \n`).join('')}`;
  aus += `trailer\n<< /Size ${objekte.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(aus, 'latin1');
}

let runner: ChildProcess;
let url = '';

beforeAll(async () => {
  const port = await new Promise<number>((r) => {
    const s = net.createServer().listen(0, () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => r(p));
    });
  });
  runner = spawn('python3', [path.resolve(import.meta.dirname, '../../rechenraum/runner.py')], {
    env: { ...process.env, ARBEIT_DIR: tempOrdner('rechenraum-e199-'), PORT: String(port), RECHENRAUM_GEHEIMNIS: GEHEIM, ZEITLIMIT_S: '60', HANDSCHRIFT_MODELL },
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

async function aufbau(chatId = 'c1') {
  const d = await testDorf();
  const klient = rechenraumKlient(url, GEHEIM);
  const k = new WerkzeugKiste(d.db, d.uhr, d.vault, d.suche, d.agenten.freigaben, {
    laufId: 'l1',
    chatId,
    gebaeude: 'Rathaus',
    erlaubt: [...EXTRA_RECHENRAUM, 'vault_lesen'],
    rechenraum: { klient, ablage: ABLAGE },
  });
  return { d, k, klient };
}

describe('E199 – Rechenraum-Werkzeuge (echter Runner)', () => {
  it.skipIf(!PYPDF)('pdf_bearbeiten: zusammenfügen aus Vault und Arbeitsordner, Ablage im Chat-Ordner, nie Fremdes überschreiben', async () => {
    const { d, k, klient } = await aufbau();
    await d.vault.schreiben('Uni/deckblatt.pdf', pdf(1));
    await klient.schreiben('c1', 'loesung.pdf', pdf(3));
    // eine fremde Datei gleichen Namens liegt schon im Ablage-Ordner → neuer Name
    await d.vault.schreiben(`${ABLAGE}/Abgabe.pdf`, 'von Leif');
    const r = await k.aufrufen('pdf_bearbeiten', { aktion: 'zusammenfuegen', dateien: ['Uni/deckblatt.pdf', 'rechenraum:loesung.pdf'], name: 'Abgabe' });
    expect(r.ok).toBe(true);
    expect(r.text).toContain('2 PDFs zusammengefügt: 4 Seiten.');
    expect(r.text).toContain(`- ${ABLAGE}/Abgabe_2.pdf`);
    expect(r.text).toContain('Im Arbeitsordner: rechenraum:Abgabe.pdf');
    expect((await d.vault.lesen(`${ABLAGE}/Abgabe.pdf`)).inhalt).toBe('von Leif');
    expect((await d.vault.puffer(`${ABLAGE}/Abgabe_2.pdf`, { max: 1e6 }))!.inhalt.subarray(0, 5).toString()).toBe('%PDF-');
    // Arbeitsordner-Datei = Fremdes möglich → Hülle; Leif sieht die Datei im Chat (geschrieben + erlaubt)
    expect(r.text).toContain('<fremdinhalt quelle="pdf_bearbeiten">');
    const log = d.db.prepare("SELECT werkzeug, pfad FROM werkzeug_log WHERE art = 'geschrieben'").all();
    expect(log).toEqual([{ werkzeug: 'pdf_bearbeiten', pfad: `${ABLAGE}/Abgabe_2.pdf` }]);
    // gleicher Chat, gleicher Name: die eigene Datei wird ersetzt, kein _3
    const r2 = await k.aufrufen('pdf_bearbeiten', { aktion: 'seiten_loeschen', dateien: [`${ABLAGE}/Abgabe_2.pdf`], seiten: '1', name: 'Abgabe_2' });
    expect(r2.text).toContain(`- ${ABLAGE}/Abgabe_2.pdf`);
    // Review E199: ein PDF ist immer Daten von außen (Metadaten, Formularfelder …) → Hülle, auch aus dem eigenen Ordner
    expect(r2.text).toContain('<fremdinhalt quelle="pdf_bearbeiten">');
    // Fehler kommen ehrlich zurück
    const f = await k.aufrufen('pdf_bearbeiten', { aktion: 'teilen', dateien: ['Uni/deckblatt.pdf'], seiten: '5' });
    expect(f.ok).toBe(false);
    expect(f.text).toMatch(/Seite 5 gibt es nicht/);
    expect((await k.aufrufen('pdf_bearbeiten', { aktion: 'info', dateien: ['Uni/gibtsnicht.pdf'] })).text).toMatch(/Gibt es nicht/);
    expect((await k.aufrufen('pdf_bearbeiten', { aktion: 'info', dateien: ['rechenraum:../../etc/passwd'] })).ok).toBe(false);
  });

  it.skipIf(!PYPDF)('hochgeladene PDFs: Formularfelder kommen in der Hülle und stempeln den Lauf', async () => {
    const { d, k } = await aufbau('c2');
    await d.vault.schreiben('Rathaus/schreibtisch/anhaenge/2026-11-16/antrag.pdf', pdf(1));
    const r = await k.aufrufen('pdf_bearbeiten', { aktion: 'formular_lesen', dateien: ['Rathaus/schreibtisch/anhaenge/2026-11-16/antrag.pdf'] });
    expect(r.ok).toBe(true);
    expect(r.text).toContain('<fremdinhalt quelle="pdf_bearbeiten">');
    expect(r.text).toContain('Keine ausfüllbaren Formularfelder');
    expect(k.hatFremdesGelesen).toBe(true);
  });

  it.skipIf(!DATEN)('daten_abfragen: Übersicht, SQL, CSV-Ablage', async () => {
    const { d, k } = await aufbau('c3');
    await d.vault.schreiben('Bank/auszuege/2026-10.csv', 'Datum;Betrag;Kategorie\n01.10.2026;-1.234,50;Miete\n02.10.2026;-20,00;Essen\n03.10.2026;-7,50;Essen\n');
    const u = await k.aufrufen('daten_abfragen', { dateien: ['Bank/auszuege/2026-10.csv'] });
    expect(u.ok).toBe(true);
    expect(u.text).toContain('Tabelle t_2026_10');
    const r = await k.aufrufen('daten_abfragen', {
      dateien: ['Bank/auszuege/2026-10.csv'],
      sql: 'SELECT Kategorie, SUM(Betrag) AS summe FROM t_2026_10 GROUP BY Kategorie ORDER BY summe',
      als_csv: true,
      name: 'oktober',
    });
    expect(r.ok).toBe(true);
    expect(r.text).toContain('| Miete | -1234.5 |');
    expect(r.text).toContain('| Essen | -27.5 |');
    expect((await d.vault.lesen(`${ABLAGE}/oktober.csv`)).inhalt.split('\n')[0]).toBe('Kategorie,summe');
    const f = await k.aufrufen('daten_abfragen', { dateien: ['Bank/auszuege/2026-10.csv'], sql: 'SELECT nichts FROM t_2026_10' });
    expect(f.ok).toBe(false);
    expect(f.text).toMatch(/SQL-Fehler/);
  });

  it.skipIf(!SEGNO)('qr_code: PNG im Ablage-Ordner, Inhalt nicht im Protokoll', async () => {
    const { d, k } = await aufbau('c4');
    const r = await k.aufrufen('qr_code', { inhalt: 'WIFI:T:WPA;S:Dorf;P:geheim123;;', name: 'wlan' });
    expect(r.ok).toBe(true);
    expect((await d.vault.puffer(`${ABLAGE}/wlan.png`, { max: 1e6 }))!.inhalt.subarray(1, 4).toString()).toBe('PNG');
    const log = JSON.stringify(d.db.prepare('SELECT eingabe_json, ergebnis FROM werkzeug_log').all());
    expect(log).not.toContain('geheim123');
  });

  it.skipIf(!GENANKI)('karten_anki und der Knopf der App: .apkg aus karten.md', async () => {
    const { d, k } = await aufbau('c5');
    await d.vault.schreiben('Uni/faecher/Statistik/karten.md', '# Statistik\n\nWas ist der Median? :: Der mittlere Wert\n\n### Varianz\nMittlere quadratische Abweichung $\\sigma^2$\n');
    const r = await k.aufrufen('karten_anki', { fach: 'Statistik' });
    expect(r.ok).toBe(true);
    expect(r.text).toContain('Anki-Paket mit 2 Karte(n)');
    expect((await d.vault.puffer(`${ABLAGE}/Statistik.apkg`, { max: 1e7 }))!.inhalt.subarray(0, 2).toString()).toBe('PK');
    expect((await k.aufrufen('karten_anki', { fach: '../Rathaus' })).ok).toBe(false);
    // App: GET /api/karten/anki (angemeldet)
    d.agenten.rechenraum = rechenraumKlient(url, GEHEIM);
    await passwortSetzen(d.db, d.uhr, 'ein-langes-test-passwort-1');
    const an = await d.app.inject({ method: 'POST', url: '/api/anmeldung', payload: { passwort: 'ein-langes-test-passwort-1' }, headers: { origin: ORIGIN } });
    const cookie = cookieAus(an.headers['set-cookie']);
    const a = await d.app.inject({ method: 'GET', url: '/api/karten/anki?fach=Statistik', headers: { cookie } });
    expect(a.statusCode).toBe(200);
    expect(a.headers['content-disposition']).toBe("attachment; filename*=UTF-8''Statistik.apkg");
    expect(a.rawPayload.subarray(0, 2).toString()).toBe('PK');
    const leer = await d.app.inject({ method: 'GET', url: '/api/karten/anki?fach=Gibtsnicht', headers: { cookie } });
    expect(leer.statusCode).toBe(404);
  });

  it.skipIf(!NUMPY)('handschrift_schreiben (E212): SVG im Ablage-Ordner, Text nicht im Protokoll, Grenzen geprüft', async () => {
    const { d, k } = await aufbau();
    const r = await k.aufrufen('handschrift_schreiben', { text: 'Liebe Grüße, Leif!', papier: 'liniert', unordnung: 0.8, format: 'svg', seed: 1, name: 'gruss' });
    expect(r.ok, r.text).toBe(true);
    expect(r.text).toContain('Handschrift geschrieben');
    expect(r.text).toContain(`- ${ABLAGE}/gruss.svg`);
    expect((await d.vault.lesen(`${ABLAGE}/gruss.svg`)).inhalt).toMatch(/^<svg /);
    const log = d.db.prepare("SELECT eingabe_json FROM werkzeug_log WHERE werkzeug = 'handschrift_schreiben'").all() as { eingabe_json: string }[];
    expect(log.length).toBeGreaterThan(0);
    expect(log.map((l) => l.eingabe_json).join('')).not.toContain('Liebe Grüße');
    // was das Werkzeug nicht kann, kommt ehrlich zurück
    expect((await k.aufrufen('handschrift_schreiben', { text: 'x', unordnung: 3 })).ok).toBe(false);
    expect((await k.aufrufen('handschrift_schreiben', { text: 'x'.repeat(1501) })).ok).toBe(false);
  });

  it('App-Knopf ohne Rechenraum: 503 mit Grund; ohne Anmeldung: 401', async () => {
    const d = await testDorf();
    expect((await d.app.inject({ method: 'GET', url: '/api/karten/anki?fach=Statistik' })).statusCode).toBe(401);
    await passwortSetzen(d.db, d.uhr, 'ein-langes-test-passwort-1');
    const an = await d.app.inject({ method: 'POST', url: '/api/anmeldung', payload: { passwort: 'ein-langes-test-passwort-1' }, headers: { origin: ORIGIN } });
    const r = await d.app.inject({ method: 'GET', url: '/api/karten/anki?fach=Statistik', headers: { cookie: cookieAus(an.headers['set-cookie']) } });
    expect(r.statusCode).toBe(503);
    expect(r.json().fehler).toMatch(/Rechenraum/);
  });
});

// Für die Übersicht in der Ausgabe: was lokal übersprungen wurde
if (!PYPDF || !DATEN || !SEGNO || !GENANKI || !NUMPY)
  console.warn(`E199-Rechenraum: übersprungen ohne ${[!PYPDF && 'pypdf', !DATEN && 'pandas/duckdb', !SEGNO && 'segno', !GENANKI && 'genanki', !NUMPY && 'numpy'].filter(Boolean).join(', ')}`);

