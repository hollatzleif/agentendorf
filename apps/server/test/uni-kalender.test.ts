import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { icsLesen, ortszeitZuUtc, terminArt } from '../src/uni/ical.js';
import { ablageOrdner } from '../src/agenten/rechenraum.js';
import { passwortSetzen } from '../src/auth/passwort.js';
import type { TelegramSchnittstelle } from '../src/telegram/api.js';
import { cookieAus, ORIGIN, testDorf } from './hilfen.js';

const ics = (termine: string[]) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Moodle//NONSGML//EN\r\n${termine.join('')}END:VCALENDAR\r\n`;
const termin = (uid: string, titel: string, start: string, kurs = 'CDA') =>
  `BEGIN:VEVENT\r\nUID:${uid}@moodle.jku.at\r\nSUMMARY:${titel}\r\nDESCRIPTION:Beschreibung\\nzweite Zeile\r\nCATEGORIES:${kurs}\r\nDTSTART:${start}\r\nDTEND:${start}\r\nEND:VEVENT\r\n`;

describe('iCal-Leser', () => {
  it('Faltung, Escapes, UTC, Zeitzone, ganztägig, Kategorie', () => {
    const t = icsLesen(
      'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:1\r\nSUMMARY:Übungsblatt 3 ist fäl\r\n lig\r\nDESCRIPTION:a\\, b\; c\\nd\r\nCATEGORIES:CDA,Andere\r\nDTSTART:20261121T225900Z\r\nEND:VEVENT\r\n' +
        'BEGIN:VEVENT\r\nUID:2\r\nSUMMARY:Sommer\r\nDTSTART;TZID=Europe/Vienna:20260715T120000\r\nEND:VEVENT\r\n' +
        'BEGIN:VEVENT\r\nUID:3\r\nSUMMARY:Ganztags\r\nDTSTART;VALUE=DATE:20261224\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
    );
    expect(t.map((x) => [x.uid, x.titel, new Date(x.start!).toISOString(), x.kategorie])).toEqual([
      ['1', 'Übungsblatt 3 ist fällig', '2026-11-21T22:59:00.000Z', 'CDA'],
      ['2', 'Sommer', '2026-07-15T10:00:00.000Z', ''],
      ['3', 'Ganztags', '2026-12-24T22:59:00.000Z', ''],
    ]);
    expect(t[0]!.beschreibung).toBe('a, b; c\nd');
    expect(ortszeitZuUtc(2026, 3, 29, 3, 0, 0, 'Europe/Vienna')).toBe(Date.UTC(2026, 2, 29, 1, 0, 0)); // Tag der Zeitumstellung
    expect(() => icsLesen('<html>Login</html>')).toThrow(/keine Kalenderdatei/);
  });
  it('Art aus dem Titel', () => {
    expect(terminArt('Übung 1 ist fällig')).toBe('abgabe');
    expect(terminArt('Assignment 2 is due')).toBe('abgabe');
    expect(terminArt('Zwischentest schließt')).toBe('test');
    expect(terminArt('Quiz 3 closes')).toBe('test');
    expect(terminArt('Vorlesung entfällt')).toBe('termin');
  });
});

describe('Fristen aus dem Kalender-Export', () => {
  async function aufbau(telegram?: TelegramSchnittstelle) {
    let text = '';
    let fehler: Error | null = null;
    const kalender = {
      laden: async () => {
        if (fehler) throw fehler;
        return text;
      },
    };
    const d = await testDorf({ kalender, telegram, env: telegram ? { TELEGRAM_CHAT_ID: '1' } : {} });
    return { d, setzen: (t: string) => (text = t), fehlerSetzen: (f: Error | null) => (fehler = f) };
  }

  it('übernimmt Termine, hält „erledigt“, entfernt Verschwundenes, meldet nur Kommendes', async () => {
    const texte: string[] = [];
    const api: TelegramSchnittstelle = {
      async aufruf<T>(m: string, p: Record<string, unknown> = {}) {
        if (m === 'sendMessage') texte.push(String(p.text));
        return { message_id: 1 } as T;
      },
      async dateiLaden() {
        return { name: 'x', inhalt: Buffer.from('') };
      },
    };
    const { d, setzen, fehlerSetzen } = await aufbau(api);
    // TestUhr: 16.11.2026 12:00 UTC
    setzen(ics([termin('a', 'Übung 1 ist fällig', '20261118T225900Z'), termin('b', 'Zwischentest schließt', '20261120T100000Z', 'STAT'), termin('c', 'Übung 0 ist fällig', '20261110T225900Z')]));
    const e = await d.uni.abgleichen();
    expect(e.ok).toBe(true);
    expect(e.neueFristen.map((f) => f.titel)).toEqual(['Übung 1 ist fällig', 'Zwischentest schließt']); // Vergangenes nicht melden
    const f = d.uni.fristen();
    expect(f.map((x) => [x.titel, x.art, x.kurs])).toEqual([
      ['Übung 0 ist fällig', 'abgabe', 'CDA'],
      ['Übung 1 ist fällig', 'abgabe', 'CDA'],
      ['Zwischentest schließt', 'test', 'STAT'],
    ]);
    expect(texte.at(-1)).toMatch(/🎓 <b>Neu in Moodle:<\/b> 2 Fristen\n• Übung 1 ist fällig \(CDA\) – Mi\., 18\.11\.2026, 23:59/);

    // Leif hakt ab – bleibt nach dem nächsten Abgleich abgehakt
    d.uni.erledigtSetzen(f[1]!.id, true);
    await d.uni.abgleichen();
    expect(d.uni.fristen().find((x) => x.titel === 'Übung 1 ist fällig')!.abgegeben).toBe(true);
    expect(texte).toHaveLength(1); // nichts Neues

    // Termin verschwindet aus dem Export → aus der Liste
    setzen(ics([termin('a', 'Übung 1 ist fällig', '20261118T225900Z')]));
    await d.uni.abgleichen();
    expect(d.uni.fristen().map((x) => x.titel)).toEqual(['Übung 1 ist fällig']);

    // Fehler: Liste bleibt, Meldung einmal
    fehlerSetzen(new Error('Kalender-Export antwortet mit HTTP 403'));
    const e2 = await d.uni.abgleichen();
    await d.uni.abgleichen();
    expect(e2).toMatchObject({ ok: false });
    expect(e2.fehler).toMatch(/Kalender: .*403/);
    expect(d.uni.fristen()).toHaveLength(1);
    expect(texte.filter((t) => t.includes('fehlgeschlagen'))).toHaveLength(1);
  });

  it('HTTP: Übersicht, abhaken, Fach anlegen; die Kalender-Adresse taucht nirgends auf', async () => {
    const { d, setzen } = await aufbau();
    setzen(ics([termin('a', 'Übung 1 ist fällig', '20261118T225900Z')]));
    await passwortSetzen(d.db, d.uhr, 'ein-sehr-langes-Passwort-42');
    const r = await d.app.inject({ method: 'POST', url: '/api/anmeldung', headers: { origin: ORIGIN }, payload: { passwort: 'ein-sehr-langes-Passwort-42' } });
    const h = { origin: ORIGIN, cookie: cookieAus(r.headers['set-cookie']) };
    await d.uni.abgleichen();
    const u = (await d.app.inject({ url: '/api/uni', headers: h })).json();
    expect(u).toMatchObject({ verbunden: true, kalender: true, appZugang: false });
    const id = u.fristen[0].id as string;
    expect((await d.app.inject({ method: 'POST', url: '/api/uni/fristen/erledigt', headers: h, payload: { id, erledigt: true } })).statusCode).toBe(200);
    expect((await d.app.inject({ method: 'POST', url: '/api/uni/fristen/erledigt', headers: h, payload: { id: 'gibts-nicht', erledigt: true } })).statusCode).toBe(404);

    const neu = await d.app.inject({ method: 'POST', url: '/api/uni/fach', headers: h, payload: { name: 'Computational Data Analytics' } });
    expect(neu.json()).toEqual({ ordner: 'Uni/faecher/Computational Data Analytics' });
    for (const u2 of ['kurs.md', 'folien', 'altklausuren', 'aufgaben']) expect(await d.vault.existiert(`Uni/faecher/Computational Data Analytics/${u2}`)).toBe(true);
    expect((await d.app.inject({ method: 'POST', url: '/api/uni/fach', headers: h, payload: { name: 'Computational Data Analytics' } })).statusCode).toBe(409);
    expect((await d.app.inject({ method: 'POST', url: '/api/uni/fach', headers: h, payload: { name: '../Rathaus' } })).json()).toEqual({ ordner: 'Uni/faecher/Rathaus' });
    const u2 = (await d.app.inject({ url: '/api/uni', headers: h })).json();
    expect(u2.faecher.map((f: { name: string }) => f.name)).toEqual(['Computational Data Analytics', 'Rathaus']);
  });
});

describe('Fächer und Abgaben aus Leifs Ordnern', () => {
  it('Auswahl kommt aus Uni/faecher/<Fach>/aufgaben/ (Ordner oder PDF), Erledigtes nicht; Ablage ohne .pdf im Namen', async () => {
    const d = await testDorf();
    await d.uni.fachAnlegen('Computational Data Analytics');
    await d.uni.fachAnlegen('Statistik');
    const F = 'Uni/faecher/Computational Data Analytics/aufgaben';
    await d.vault.schreiben(`${F}/Blatt 1/Blatt1.pdf`, '%PDF');
    await d.vault.schreiben(`${F}/Blatt2.pdf`, '%PDF');
    await d.vault.schreiben(`${F}/notiz.md`, 'x');
    await d.vault.schreiben(`${F}/erledigt/Blatt0.pdf`, '%PDF');
    // neueste zuerst
    fs.utimesSync(d.vault.abs(`${F}/Blatt 1`), new Date(2026, 10, 1), new Date(2026, 10, 1));
    expect(d.uni.quelle('uni.faecher')).toEqual([
      { wert: 'Computational Data Analytics', beschriftung: 'Computational Data Analytics' },
      { wert: 'Statistik', beschriftung: 'Statistik' },
    ]);
    expect(d.uni.quelle('uni.abgaben')).toEqual([
      { wert: 'Computational Data Analytics/aufgaben/Blatt2.pdf', beschriftung: 'Blatt2 – Computational Data Analytics' },
      { wert: 'Computational Data Analytics/aufgaben/Blatt 1', beschriftung: 'Blatt 1 – Computational Data Analytics' },
    ]);
    const erstellt = Date.UTC(2026, 10, 17, 13, 5);
    expect(ablageOrdner({ gebaeude: 'Uni', titel: 'x', erstellt, eingaben: { abgabe: 'Computational Data Analytics/aufgaben/Blatt2.pdf' } })).toBe(
      'Uni/faecher/Computational Data Analytics/entwuerfe/2026-11-17_1405_blatt2',
    );

    // „Abgabe bearbeiten“ mit einem PDF direkt in aufgaben/: Anhang ist genau dieses PDF
    const { aktionLaden, eingabenAnwenden } = await import('../src/agenten/aktionen.js');
    const a = eingabenAnwenden(await aktionLaden(d.vault, 'Uni/abgabe-bearbeiten'), { abgabe: 'Computational Data Analytics/aufgaben/Blatt2.pdf' }, (q) => d.uni.quelle(q));
    expect(a.anhaenge).toEqual(['Uni/faecher/Computational Data Analytics/aufgaben/Blatt2.pdf']);
  });
});

describe('Vorlagen aktualisieren – nur wenn Leif nichts geändert hat', () => {
  it('ersetzt byte-gleiche alte Fassungen, lässt geänderte unangetastet', async () => {
    const path = await import('node:path');
    const { dorfStarten } = await import('../src/dorf.js');
    const alt = (n: string) => fs.readFileSync(path.join(import.meta.dirname, 'vorlagen-alt', n), 'utf8');
    const d = await testDorf();
    await d.vault.schreiben('Uni/gebaeude.md', alt('uni-gebaeude-2b.md'));
    await d.vault.schreiben('Uni/aktionen/lernen.md', alt('lernen-3.md'));
    await d.vault.schreiben('Uni/aktionen/abgabe-bearbeiten.md', alt('abgabe-bearbeiten-3.md') + '\nMeine Ergänzung.\n');
    await d.app.close();
    const d2 = await dorfStarten(d.konfig, { beobachten: false });
    const neu = (p: string) => fs.readFileSync(path.join(d.konfig.vorlageDir, p), 'utf8');
    expect((await d2.vault.lesen('Uni/gebaeude.md')).inhalt).toBe(neu('Uni/gebaeude.md'));
    expect((await d2.vault.lesen('Uni/aktionen/lernen.md')).inhalt).toBe(neu('Uni/aktionen/lernen.md'));
    expect((await d2.vault.lesen('Uni/aktionen/abgabe-bearbeiten.md')).inhalt).toContain('Meine Ergänzung.');
    expect((await d2.vault.konflikte()).length).toBe(0);
    await d2.app.close();
  });
});
