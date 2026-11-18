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
});
