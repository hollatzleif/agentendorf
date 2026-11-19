import { describe, expect, it } from 'vitest';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';

const kal = (...ev: string[][]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...ev.flat(), 'END:VCALENDAR'].join('\r\n');
const ev = (...z: string[]) => ['BEGIN:VEVENT', ...z, 'END:VEVENT'];

describe('Prüfungs-Cockpit (E140)', () => {
  it('je anstehende Prüfung: Tage, Schritte des Uni-To-dos, Fokus 14 Tage, Karteikarten, Lernziel', async () => {
    // TestUhr: Mo 16.11.2026 13:00 Wien
    const fristen = kal(
      ev('UID:p1', 'SUMMARY:📝 NLP: Short Exam 2', 'DTSTART:20261120T090000Z', 'DTEND:20261120T100000Z'),
      ev('UID:p0', 'SUMMARY:📝 NLP: Alte Prüfung', 'DTSTART:20261101T090000Z', 'DTEND:20261101T100000Z'),
      ev('UID:a1', 'SUMMARY:⏰ NLP: Blatt 3 ist fällig', 'DTSTART:20261118T222900Z', 'DTEND:20261118T225900Z'),
    );
    const d = await testDorf({ google: { fristen: { laden: async () => fristen } } });
    await d.uni.fachAnlegen('NLP');
    await d.vault.schreiben('Uni/faecher/NLP/karten.md', 'Was ist ein Token? :: Ein Stück Text\nWas ist BPE? :: Byte-Pair-Encoding\n');
    await d.uni.abgleichen();
    await d.lernziele.setzen('NLP', 3);
    d.db.prepare('INSERT INTO fokus_sitzungen (start, ende, minuten, thema, gruppe, todo, vollstaendig) VALUES (?, ?, ?, NULL, ?, NULL, 1)').run(d.uhr.jetzt() - 7200_000, d.uhr.jetzt() - 3600_000, 50, 'NLP');
    const t = (await d.todos.liste()).find((x) => x.titel.startsWith('Prüfung:'))!;
    await d.todos.schrittHaken(t.pfad, 0, true);
    const r = (await d.app.inject({ url: '/api/uni/pruefungen', headers: await kopf(d) })).json();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      titel: 'Short Exam 2',
      fach: 'NLP',
      tage: 4,
      todo: { pfad: t.pfad, schritteFertig: 1, schritte: 5, naechster: 'Lernplan anlegen (Prüfungs-Wächter)' },
      fokus14Tage: 50,
      karten: { gesamt: 2, gelernt: 0 },
      lernzielMin: 180,
    });
  });
});
