import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { passwortSetzen } from '../src/auth/passwort.js';
import { anhaengeLaden, auftragMitAnhaengen } from '../src/agenten/kontext.js';
import { DateiVerstehen, textDekodieren } from '../src/agenten/anhaenge.js';
import { rechenraumKlient, type RechenraumKlient } from '../src/agenten/rechenraum.js';
import { cookieAus, ORIGIN, tempOrdner, testDorf } from './hilfen.js';

/**
 * E190: Anhänge in allen Formaten – Upload in Chat und Schreibtisch, Umwandlung im (echten) Rechenraum-Runner,
 * Fremdinhalt-Hülle, Grenzen, Zwischenspeicher. Formate, deren Werkzeug lokal fehlt (Pillow, ffmpeg, heif-convert …),
 * werden übersprungen – im Rechenraum-Image laufen sie (apps/rechenraum/test).
 */

const GEHEIM = 'anhang-test-geheimnis';
const BEISPIELE = path.join(import.meta.dirname, 'fixtures/anhaenge');
let runner: ChildProcess;
let url = '';

const hat = (befehl: string[]) => {
  try {
    execFileSync(befehl[0]!, befehl.slice(1), { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const MIT_PIL = hat(['python3', '-c', 'import PIL']);
const MIT_FFMPEG = hat(['ffprobe', '-version']);

beforeAll(async () => {
  const port = await new Promise<number>((r) => {
    const s = net.createServer().listen(0, () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => r(p));
    });
  });
  runner = spawn('python3', [path.resolve(import.meta.dirname, '../../rechenraum/runner.py')], {
    env: { ...process.env, ARBEIT_DIR: tempOrdner('rechenraum-anhang-'), PORT: String(port), RECHENRAUM_GEHEIMNIS: GEHEIM, UMWANDELN_ZEITLIMIT_S: '60' },
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

/** Rechenraum-Klient, der mitzählt (für den Zwischenspeicher) */
function zaehlend(k: RechenraumKlient) {
  const z = { umwandeln: 0 };
  return { z, k: { ...k, umwandeln: (n: string, b: Buffer) => (z.umwandeln++, k.umwandeln(n, b)) } as RechenraumKlient };
}

async function mitBeispielen() {
  const d = await testDorf({ env: { RECHENRAUM_URL: url, RECHENRAUM_GEHEIMNIS: GEHEIM } });
  for (const n of fs.readdirSync(BEISPIELE)) if (n !== 'erzeugen.py') await d.vault.schreiben(`Rathaus/schreibtisch/anhaenge/2026-11-19_1200/${n}`, fs.readFileSync(path.join(BEISPIELE, n)));
  return d;
}
const A = (n: string) => `Rathaus/schreibtisch/anhaenge/2026-11-19_1200/${n}`;

describe('Formate verstehen (Dorf + echter Rechenraum-Runner)', () => {
  it('Text und Quelltext liest das Dorf selbst; Hochgeladenes kommt in die Fremdinhalt-Hülle', async () => {
    const d = await mitBeispielen();
    const { anhaenge } = await anhaengeLaden(d.vault, [A('notiz.txt'), A('rechnung.py'), A('konto.csv')], false, d.agenten.dateien);
    expect(anhaenge.map((a) => a.art)).toEqual(['text', 'text', 'text']);
    expect(anhaenge[0]!.text).toMatch(/^<fremdinhalt quelle="Rathaus\/schreibtisch\/anhaenge\/2026-11-19_1200\/notiz\.txt">\n[\s\S]*Rübezahl/);
    expect(anhaenge[1]!.text).toContain('def summe(a, b):');
    // Windows-1252 wird erkannt, NUL-Bytes sind kein Text
    expect(textDekodieren(Buffer.from([0x47, 0x72, 0xfc, 0xdf, 0x65]))).toBe('Grüße');
    expect(textDekodieren(Buffer.from([0x50, 0x4b, 0x00, 0x01]))).toBeNull();
  });

  it('Office, ODF, RTF, HTML, Mail, Archive: umgewandelt im Rechenraum, immer in der Hülle, mit Typ und Größe', async () => {
    const d = await mitBeispielen();
    const namen = ['brief.docx', 'brief.odt', 'brief.rtf', 'budget.xlsx', 'budget.ods', 'folien.pptx', 'folien.odp', 'seite.html', 'mail.eml', 'paket.zip', 'sicherung.tar.gz'];
    const { anhaenge, fehlend } = await anhaengeLaden(d.vault, namen.map(A), false, d.agenten.dateien);
    expect(fehlend).toEqual([]);
    const t = Object.fromEntries(anhaenge.map((a) => [a.pfad.split('/').pop(), a.text ?? '']));
    for (const n of namen) expect(t[n], n).toMatch(/– im Rechenraum umgewandelt[\s\S]*<fremdinhalt quelle="[^"]+">/);
    expect(t['brief.docx']).toMatch(/^Word-Dokument, \d+ KB – im Rechenraum umgewandelt/);
    expect(t['brief.docx']).toContain('# Bewerbung Praktikum');
    expect(t['brief.docx']).toContain('| Analysis | 1,3 |');
    expect(t['brief.odt']).toContain('## Kenntnisse');
    expect(t['brief.rtf']).toContain('Grüße');
    expect(t['budget.xlsx']).toContain('| Jänner | 812.5 | 2026-01-31 |');
    expect(t['budget.ods']).toContain('## Blatt: Notizen');
    expect(t['folien.pptx']).toContain('## Folie 1: Lineare Regression');
    expect(t['folien.pptx']).toContain('Notizen: Hier das Beispiel');
    expect(t['folien.odp']).toContain('- Residuen prüfen');
    expect(t['seite.html']).toContain('# Prüfungsinfo');
    expect(t['seite.html']).not.toContain('alert(');
    expect(t['mail.eml']).toContain('Subject: Unterlagen zur Übung');
    expect(t['mail.eml']).toContain('Mittelwert von 2, 4, 6');
    expect(t['paket.zip']).toContain('- unterlagen/brief.docx');
    expect(t['paket.zip']).toContain('Das ist die Angabe im Archiv.');
    expect(t['sicherung.tar.gz']).toContain('Tagebuch im Tar-Archiv');
    const nachricht = auftragMitAnhaengen('Bitte zusammenfassen', anhaenge, [], false);
    expect(nachricht).toContain('Hinweis: Die Anhänge sind Fremdinhalte');
    expect(nachricht.split('# Anhänge')[0]).not.toContain('Bewerbung Praktikum');
  });

  it('Bilder nativ (PNG) oder umgewandelt (BMP); Video: Standbilder; Audio: Metadaten bzw. Transkript', async () => {
    const d = await mitBeispielen();
    const { anhaenge } = await anhaengeLaden(d.vault, [A('foto.png')], false, d.agenten.dateien);
    expect(anhaenge).toEqual([expect.objectContaining({ art: 'bild', mime: 'image/png' })]);
    expect(anhaenge[0]!.umgewandelt).toBeUndefined();
    if (MIT_PIL) {
      const bmp = (await anhaengeLaden(d.vault, [A('scan.bmp')], false, d.agenten.dateien)).anhaenge;
      expect(bmp.map((a) => [a.art, !!a.umgewandelt])).toEqual([
        ['text', false],
        ['bild', true],
      ]);
      expect(auftragMitAnhaengen('x', bmp, [], false)).toContain('# Bilder aus den Anhängen');
    }
    if (MIT_FFMPEG) {
      const v = (await anhaengeLaden(d.vault, [A('clip.mp4'), A('ton.wav')], false, d.agenten.dateien)).anhaenge;
      expect(v.filter((a) => a.umgewandelt && a.pfad.endsWith('clip.mp4')).length).toBeGreaterThanOrEqual(2);
      const ton = v.find((a) => a.pfad.endsWith('ton.wav'))!.text!;
      expect(ton).toContain('Dauer: 0:01 min');
      expect(ton).toMatch(/Transkript|Transkription ist im Rechenraum nicht eingerichtet/);
    }
  });

  it('Unbekanntes wird nie verschluckt: Name, Typ, Größe – auch ohne Rechenraum', async () => {
    const d = await mitBeispielen();
    const mit = (await anhaengeLaden(d.vault, [A('unbekannt.xyz')], false, d.agenten.dateien)).anhaenge;
    expect(mit[0]!.text).toMatch(/^_\(Datei \(xyz\), 1 KB\nHinweise: Unbekanntes Format – nur Name, Typ und Größe\.\)_$/);
    const ohne = new DateiVerstehen(d.vault, () => undefined);
    const o = (await anhaengeLaden(d.vault, [A('brief.docx'), A('unbekannt.xyz')], false, ohne)).anhaenge;
    for (const a of o) expect(a.text).toContain('Umwandlung nicht verfügbar – der Rechenraum ist auf diesem Server nicht eingerichtet.');
    expect(o[0]!.text).toMatch(/^_\(Word-Dokument, \d+ KB/);
  });

  it('Grenzen: über 25 MB wird nicht umgewandelt; Zip-Bombe bleibt eine Zeile; kaputte Datei ehrlich gemeldet', async () => {
    const d = await mitBeispielen();
    await d.vault.schreiben('Rathaus/gross.docx', Buffer.alloc(25 * 1024 * 1024 + 1));
    const g = (await anhaengeLaden(d.vault, ['Rathaus/gross.docx'], false, d.agenten.dateien)).anhaenge;
    expect(g[0]!.text).toMatch(/Zu groß zum Umwandeln \(25,0 MB, höchstens 25,0 MB\)/);
    // 30 MB Nullen, gepackt ein paar KB: wird nicht entpackt
    const nullen = zlib.deflateRawSync(Buffer.alloc(30 * 1024 * 1024));
    await d.vault.schreiben('Rathaus/bombe.zip', zipMitEinemEintrag('nullen.txt', nullen, 30 * 1024 * 1024));
    const b = (await anhaengeLaden(d.vault, ['Rathaus/bombe.zip'], false, d.agenten.dateien)).anhaenge;
    expect(b[0]!.text).toContain('verdächtig stark gepackt');
    expect(b[0]!.text!.length).toBeLessThan(2000);
    await d.vault.schreiben('Rathaus/kaputt.xlsx', 'PK\x03\x04 das ist kein Excel');
    const k = (await anhaengeLaden(d.vault, ['Rathaus/kaputt.xlsx'], false, d.agenten.dateien)).anhaenge;
    expect(k[0]!.text).toMatch(/Nicht lesbar/);
  });

  it('Zwischenspeicher: dieselbe Datei wird nur einmal umgewandelt (auch unter anderem Pfad)', async () => {
    const d = await mitBeispielen();
    const { z, k } = zaehlend(rechenraumKlient(url, GEHEIM));
    const v = new DateiVerstehen(d.vault, () => k);
    v.cacheOrdner = tempOrdner('umwandlung-');
    await v.verstehen(A('brief.docx'), { pdfNativ: true, bildNativ: true });
    await d.vault.schreiben('Rathaus/kopie.docx', fs.readFileSync(path.join(BEISPIELE, 'brief.docx')));
    const zweit = await v.verstehen('Rathaus/kopie.docx', { pdfNativ: true, bildNativ: true });
    expect(z.umwandeln).toBe(1);
    expect(zweit.text).toContain('# Bewerbung Praktikum');
    expect(fs.readdirSync(v.cacheOrdner)).toHaveLength(1);
    // dorf.ts legt den Zwischenspeicher in den Daten-Ordner, nie in den Vault
    expect(d.agenten.dateien.cacheOrdner).toBe(path.join(d.daten, 'umwandlung'));
  });

  it('vault_lesen versteht jedes Format: docx als Text in der Hülle, PNG als Bild', async () => {
    const d = await mitBeispielen();
    await d.vault.schreiben(
      'Uni/aktionen/lesen.md',
      '---\nname: Lesen\nmotor: api\nwerkzeuge: [vault_lesen]\neingaben:\n  - name: auftrag\n---\n{auftrag}',
    );
    const befehl = (p: string) => `<<werkzeug vault_lesen {"pfad": "${p}"}>>`;
    const { chatId } = await d.agenten.aktionStarten('Uni/lesen', { auftrag: `${befehl(A('brief.docx'))} ${befehl(A('foto.png'))}` });
    await d.agenten.leerlauf();
    const w = d.agenten.chatDetail(chatId).nachrichten.filter((n) => n.rolle === 'werkzeug').map((n) => n.text);
    expect(w[0]).toMatch(/^vault_lesen: Rathaus\/schreibtisch\/anhaenge\/2026-11-19_1200\/brief\.docx – Word-Dokument, \d+ KB – im Rechenraum umgewandelt\n\n<fremdinhalt quelle=/);
    expect(w[0]).toContain('# Bewerbung Praktikum');
    expect(w[1]).toMatch(/foto\.png – Bild \(PNG\), 1 KB/);
    const log = d.db.prepare("SELECT ergebnis FROM werkzeug_log WHERE chat_id = ? AND werkzeug = 'vault_lesen' ORDER BY id").all(chatId) as { ergebnis: string }[];
    expect(log.map((l) => l.ergebnis)).toEqual([expect.stringMatching(/^Word-Dokument, umgewandelt$/), 'Bild (PNG), bild, 1 Bild(er)']);
  });
});

/** ZIP mit einem deflate-Eintrag (für die Zip-Bombe; ohne Bibliothek) */
function zipMitEinemEintrag(name: string, gepackt: Buffer, groesse: number) {
  const n = Buffer.from(name);
  const kopf = Buffer.alloc(30);
  kopf.writeUInt32LE(0x04034b50, 0);
  kopf.writeUInt16LE(20, 4);
  kopf.writeUInt16LE(8, 8);
  kopf.writeUInt32LE(crc32(Buffer.alloc(groesse)), 14);
  kopf.writeUInt32LE(gepackt.length, 18);
  kopf.writeUInt32LE(groesse, 22);
  kopf.writeUInt16LE(n.length, 26);
  const zentral = Buffer.alloc(46);
  zentral.writeUInt32LE(0x02014b50, 0);
  zentral.writeUInt16LE(20, 4);
  zentral.writeUInt16LE(20, 6);
  zentral.writeUInt16LE(8, 10);
  kopf.copy(zentral, 16, 14, 26);
  zentral.writeUInt16LE(n.length, 28);
  const ende = Buffer.alloc(22);
  ende.writeUInt32LE(0x06054b50, 0);
  ende.writeUInt16LE(1, 8);
  ende.writeUInt16LE(1, 10);
  ende.writeUInt32LE(46 + n.length, 12);
  ende.writeUInt32LE(30 + n.length + gepackt.length, 16);
  return Buffer.concat([kopf, n, gepackt, zentral, n, ende]);
}
function crc32(b: Buffer) {
  let c = ~0;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

describe('Anhängen in Chat und Schreibtisch (App-Routen)', () => {
  async function angemeldet(env: Record<string, string> = {}) {
    const d = await testDorf({ env });
    await passwortSetzen(d.db, d.uhr, 'ein-sehr-langes-Passwort-42');
    const an = await d.app.inject({ method: 'POST', url: '/api/anmeldung', headers: { origin: ORIGIN }, payload: { passwort: 'ein-sehr-langes-Passwort-42' } });
    const h = { origin: ORIGIN, cookie: cookieAus(an.headers['set-cookie']) };
    return { d, h };
  }
  const multipart = (text: string, dateien: { name: string; inhalt: Buffer | string }[]) => {
    const grenze = '----dorf-test';
    const teile = [
      Buffer.from(`--${grenze}\r\nContent-Disposition: form-data; name="text"\r\n\r\n${text}\r\n`),
      ...dateien.flatMap((x) => [
        Buffer.from(`--${grenze}\r\nContent-Disposition: form-data; name="datei"; filename="${x.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
        Buffer.isBuffer(x.inhalt) ? x.inhalt : Buffer.from(x.inhalt),
        Buffer.from('\r\n'),
      ]),
      Buffer.from(`--${grenze}--\r\n`),
    ];
    return { payload: Buffer.concat(teile), headers: { 'content-type': `multipart/form-data; boundary=${grenze}` } };
  };

  it('Datei im Chat während eines Laufs: wartet mit Kärtchen, kommt danach als Anhang des nächsten Laufs dran', async () => {
    const { d, h } = await angemeldet();
    fs.writeFileSync(path.join(d.vault.wurzel, 'Uni/aktionen/test.md'), '---\nname: Test\neingaben:\n  - name: auftrag\n---\n{auftrag}');
    const { chatId } = await d.agenten.aktionStarten('Uni/test', { auftrag: '[warte 300]' });
    const m = multipart('Hier noch die Angabe', [
      { name: 'Übung 3.txt', inhalt: 'Aufgabe: 6 * 7' },
      { name: 'skizze.png', inhalt: fs.readFileSync(path.join(BEISPIELE, 'foto.png')) },
    ]);
    const r = await d.app.inject({ method: 'POST', url: `/api/chats/${chatId}/nachricht`, headers: { ...h, ...m.headers }, payload: m.payload });
    expect(r.json()).toEqual({ wartend: 1 });
    const chat = (await d.app.inject({ url: `/api/chats/${chatId}`, headers: h })).json() as { wartend: { text: string; anhaenge: { pfad: string; name: string; groesse: number }[] }[] };
    expect(chat.wartend[0]!.text).toBe('Hier noch die Angabe');
    expect(chat.wartend[0]!.anhaenge).toEqual([
      { pfad: expect.stringMatching(/^Uni\/chats\/anhaenge\/\d{4}-\d\d-\d\d_\d{4}\/Uebung 3\.txt$/), name: 'Uebung 3.txt', groesse: 14 },
      { pfad: expect.stringMatching(/^Uni\/chats\/anhaenge\/[^/]+\/skizze\.png$/), name: 'skizze.png', groesse: expect.any(Number) },
    ]);
    await d.agenten.leerlauf();
    const danach = d.agenten.chatDetail(chatId);
    expect(danach.wartend).toEqual([]);
    const zweiter = danach.laeufe[1]!;
    expect(zweiter.auftrag).toBe('Hier noch die Angabe');
    expect(zweiter.anhaenge!.map((a) => a.name)).toEqual(['Uebung 3.txt', 'skizze.png']);
    const nutzer = danach.nachrichten.filter((n) => n.rolle === 'nutzer' && n.laufId === zweiter.id)[0]!.text;
    expect(nutzer).toMatch(/<fremdinhalt quelle="Uni\/chats\/anhaenge\/[^"]+Uebung 3\.txt">\nAufgabe: 6 \* 7/);
    expect(nutzer).toContain('# Weitere Anhänge (PDF/Bilder)');
    // die Attrappe hat beide Anhänge bekommen (Text + Bild)
    expect(danach.nachrichten.filter((n) => n.rolle === 'agent').at(-1)!.text).toContain('2 Anhänge');
  });

  it('nur Dateien ohne Text; ohne laufenden Lauf sofort; zu große Datei: 413 mit Namen, nichts bleibt liegen', async () => {
    const { d, h } = await angemeldet();
    fs.writeFileSync(path.join(d.vault.wurzel, 'Uni/aktionen/test.md'), '---\nname: Test\neingaben:\n  - name: auftrag\n---\n{auftrag}');
    const { chatId } = await d.agenten.aktionStarten('Uni/test', { auftrag: 'los' });
    await d.agenten.leerlauf();
    const m = multipart('', [{ name: 'notiz.md', inhalt: '# Hallo' }]);
    const r = await d.app.inject({ method: 'POST', url: `/api/chats/${chatId}/nachricht`, headers: { ...h, ...m.headers }, payload: m.payload });
    expect(r.json()).toEqual({ laufId: expect.any(String) });
    await d.agenten.leerlauf();
    expect(d.agenten.chatDetail(chatId).laeufe[1]!.auftrag).toBe('Ich habe dir eine Datei angehängt – schau sie dir an.');
    const gross = multipart('zu groß', [
      { name: 'klein.txt', inhalt: 'ok' },
      { name: 'riesig.bin', inhalt: Buffer.alloc(25 * 1024 * 1024 + 10) },
    ]);
    const r2 = await d.app.inject({ method: 'POST', url: `/api/chats/${chatId}/nachricht`, headers: { ...h, ...gross.headers }, payload: gross.payload });
    expect(r2.statusCode).toBe(413);
    expect(r2.json().fehler).toMatch(/„riesig\.bin“ ist größer als 25 MB/);
    expect(d.agenten.chatDetail(chatId).laeufe).toHaveLength(2);
    const ordner = path.join(d.vault.wurzel, 'Uni/chats/anhaenge');
    const liegt = fs.readdirSync(ordner, { recursive: true }).map(String);
    expect(liegt.filter((n) => n.endsWith('klein.txt') || n.endsWith('riesig.bin'))).toEqual([]);
  });

  it('Schreibtisch mit mehreren Dateien: Notiz verlinkt sie, der Bürgermeister bekommt sie als Anhänge', async () => {
    const { d, h } = await angemeldet();
    const m = multipart('Fass die Mail zusammen', [
      { name: 'mail.eml', inhalt: fs.readFileSync(path.join(BEISPIELE, 'mail.eml')) },
      { name: 'konto.csv', inhalt: fs.readFileSync(path.join(BEISPIELE, 'konto.csv')) },
    ]);
    const r = await d.app.inject({ method: 'POST', url: '/api/schreibtisch', headers: { ...h, ...m.headers }, payload: m.payload });
    expect(r.statusCode).toBe(200);
    await d.agenten.leerlauf();
    const a = r.json() as { chatId: string; pfad: string };
    const notiz = (await d.vault.lesen(a.pfad)).inhalt;
    expect(notiz).toMatch(/\[\[Rathaus\/schreibtisch\/anhaenge\/[^\]]+\/mail\.eml\]\]/);
    const text = d.agenten.chatDetail(a.chatId).nachrichten[0]!.text;
    expect(text).toMatch(/## Rathaus\/schreibtisch\/anhaenge\/[^\n]+konto\.csv\n<fremdinhalt/);
    // ohne Rechenraum (Testdorf): die Mail wird ehrlich als nicht umwandelbar gemeldet
    expect(text).toMatch(/mail\.eml\n_\(E-Mail, 1 KB\nHinweise: Umwandlung nicht verfügbar/);
  });

  it('Bürgermeister: Rechenraum standardmäßig, Ablage in Rathaus/dateien/, erzeugte Datei als Kärtchen im Chat', async () => {
    const { d } = await angemeldet({ RECHENRAUM_URL: url, RECHENRAUM_GEHEIMNIS: GEHEIM });
    const befehle = [
      `<<werkzeug rechenraum_schreiben {"pfad": "tabelle.csv", "inhalt": "a;b\\n1;2\\n"}>>`,
      `<<werkzeug rechenraum_ablegen {"datei": "tabelle.csv"}>>`,
      `<<werkzeug rechenraum_ablegen {"datei": "skript.sh"}>>`,
    ].join(' ');
    const aufgabe = await d.schreibtisch.anlegen({ text: `Mach mir eine Tabelle ${befehle}`, quelle: 'app' });
    const { chatId } = await d.buergermeister.starten(aufgabe.id);
    await d.agenten.leerlauf();
    const c = d.agenten.chatDetail(chatId);
    const werkzeuge = (JSON.parse((d.db.prepare('SELECT werkzeuge_json FROM chats WHERE id = ?').get(chatId) as { werkzeuge_json: string }).werkzeuge_json) as string[]);
    expect(werkzeuge).toEqual(expect.arrayContaining(['rechenraum_befehl', 'rechenraum_ablegen', 'rechenraum_vault_kopieren']));
    expect(c.laeufe[0]!.dateien).toEqual([{ pfad: expect.stringMatching(/^Rathaus\/dateien\/\d{4}-\d\d-\d\d_\d{4}_mach-mir-eine-tabelle[a-z-]*\/tabelle\.csv$/), name: 'tabelle.csv', groesse: 8 }]);
    const log = d.db.prepare("SELECT erlaubt, ergebnis FROM werkzeug_log WHERE chat_id = ? AND werkzeug = 'rechenraum_ablegen' ORDER BY id").all(chatId) as { erlaubt: number; ergebnis: string }[];
    expect(log[1]).toMatchObject({ erlaubt: 0 });
    // ohne eingerichteten Rechenraum bekommt er keine Rechenraum-Werkzeuge (statt ständiger Fehler)
    const ohne = await testDorf();
    const a2 = await ohne.schreibtisch.anlegen({ text: 'Hallo', quelle: 'app' });
    const r2 = await ohne.buergermeister.starten(a2.id);
    await ohne.agenten.leerlauf();
    expect((ohne.db.prepare('SELECT werkzeuge_json FROM chats WHERE id = ?').get(r2.chatId) as { werkzeuge_json: string }).werkzeuge_json).not.toContain('rechenraum');
  });
});
