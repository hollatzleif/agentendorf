import { describe, expect, it } from 'vitest';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';

describe('Uni: Stand je Fach (Nacht 18./19.11.)', () => {
  it('offene Abgaben, nächste Frist (Kursname passt ungefähr), Fokuszeit 7 Tage', async () => {
    const kal = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:a1', 'SUMMARY:⏰ Mathe III: Blatt 6 ist fällig', 'DTSTART:20261119T222900Z', 'DTEND:20261119T225900Z', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const d = await testDorf({ google: { fristen: { laden: async () => kal } } });
    await d.uni.abgleichen();
    await d.uni.fachAnlegen('Mathe III');
    await d.uni.fachAnlegen('Statistisches Lernen');
    await d.vault.schreiben('Uni/faecher/Mathe III/aufgaben/Blatt 6.pdf', '%PDF-1.4');
    d.kirchturm.ausfuehren({ befehl: 'pomodoro_fuer', titel: 'Blatt 6', gruppe: 'Mathe III' });
    d.uhr.vor(25 * 60_000);
    d.kirchturm.pruefen();
    const h = await kopf(d);
    const r = (await d.app.inject({ url: '/api/uni/faecher-stand', headers: h })).json();
    expect(r).toEqual([
      expect.objectContaining({ titel: 'Mathe III', offeneAbgaben: 1, naechsteFrist: { titel: 'Blatt 6 ist fällig', frist: '2026-11-19T22:59:00.000Z', art: 'abgabe' }, fokus7Tage: 25 }),
      expect.objectContaining({ titel: 'Statistisches Lernen', offeneAbgaben: 0, naechsteFrist: null, fokus7Tage: 0 }),
    ]);
  });

  it('E137: Lernziel je Fach pro Woche – setzen (Vault), Fokus ab Montag, entfernen; eigener Text bleibt', async () => {
    const d = await testDorf();
    await d.uni.fachAnlegen('Mathe III');
    const h = await kopf(d);
    let r = await d.app.inject({ method: 'POST', url: '/api/uni/lernziel', headers: h, payload: { fach: 'Mathe III', stunden: 6 } });
    expect(r.json()).toEqual({ ziele: { 'Mathe III': 6 } });
    const v = await d.vault.lesen('Uni/lernziele.md');
    await d.vault.schreiben('Uni/lernziele.md', `${v.inhalt}Notiz von Leif\n`, { basisVersion: v.version });
    // Fokus: einer vom Sonntag (zählt nicht, TestUhr = Mo 16.11. 13:00 Wien), einer heute
    const ins = d.db.prepare('INSERT INTO fokus_sitzungen (start, ende, minuten, thema, gruppe, todo, vollstaendig) VALUES (?, ?, ?, NULL, ?, NULL, 1)');
    ins.run(d.uhr.jetzt() - 26 * 3600_000, d.uhr.jetzt() - 25 * 3600_000, 50, 'Mathe III');
    ins.run(d.uhr.jetzt() - 3600_000, d.uhr.jetzt() - 3000_000, 25, 'Mathe III');
    const s = (await d.app.inject({ url: '/api/uni/faecher-stand', headers: h })).json();
    expect(s[0]).toMatchObject({ titel: 'Mathe III', fokusWoche: 25, fokus7Tage: 75, lernzielMin: 360 });
    r = await d.app.inject({ method: 'POST', url: '/api/uni/lernziel', headers: h, payload: { fach: 'Mathe III', stunden: 0 } });
    expect(r.json()).toEqual({ ziele: {} });
    expect((await d.vault.lesen('Uni/lernziele.md')).inhalt).toContain('Notiz von Leif');
    expect((await d.app.inject({ method: 'POST', url: '/api/uni/lernziel', headers: h, payload: { fach: 'X', stunden: 99 } })).statusCode).toBe(400);
  });
});

describe('Lernziele im Wochenrückblick (E137)', () => {
  it('✓/✗ je Fach gegen die Fokuszeit der letzten 7 Tage', async () => {
    const d = await testDorf();
    await d.lernziele.setzen('Mathe III', 1);
    await d.lernziele.setzen('Statistik', 2.5);
    d.db.prepare('INSERT INTO fokus_sitzungen (start, ende, minuten, thema, gruppe, todo, vollstaendig) VALUES (?, ?, ?, NULL, ?, NULL, 1)').run(d.uhr.jetzt() - 3600_000, d.uhr.jetzt() - 3000_000, 70, 'Mathe III');
    const a = (await d.wochenrueckblick.fakten()).abschnitte.find((x) => x.titel === 'Lernziele')!;
    expect(a.zeilen).toEqual(['✓ Mathe III: 1 h 10 min von 1 h', '✗ Statistik: 0 min von 2,5 h']);
  });
});
