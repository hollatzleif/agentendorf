import { describe, expect, it } from 'vitest';
import { icsTermine } from '../src/uni/ical.js';
import { testDorf } from './hilfen.js';

const kal = (...ev: string[][]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Google Inc//Google Calendar 70.9054//EN', ...ev.flat(), 'END:VCALENDAR'].join('\r\n');
const ev = (...z: string[]) => ['BEGIN:VEVENT', ...z, 'END:VEVENT'];
const iso = (ms: number | null) => new Date(ms!).toISOString();
const STUNDE = 3_600_000;

describe('Serientermine (RRULE)', () => {
  it('wöchentlich über die Zeitumstellung, Ausnahme, verschoben, abgesagt, UNTIL', () => {
    const t = icsTermine(
      kal(
        ev(
          'DTSTART;TZID=Europe/Vienna:20261013T101500',
          'DTEND;TZID=Europe/Vienna:20261013T114500',
          'RRULE:FREQ=WEEKLY;WKST=MO;UNTIL=20261124T225959Z;BYDAY=TU',
          'EXDATE;TZID=Europe/Vienna:20261103T101500',
          'UID:abc@google.com',
          'SUMMARY:Pflicht: Mathe III UE',
          'BEGIN:VALARM',
          'DESCRIPTION:Erinnerung',
          'SUMMARY:Alarm',
          'END:VALARM',
        ),
        ev('DTSTART;TZID=Europe/Vienna:20261111T080000', 'DTEND;TZID=Europe/Vienna:20261111T093000', 'RECURRENCE-ID;TZID=Europe/Vienna:20261110T101500', 'UID:abc@google.com', 'SUMMARY:Pflicht: Mathe III UE (verschoben)'),
        ev('DTSTART;TZID=Europe/Vienna:20261117T101500', 'RECURRENCE-ID;TZID=Europe/Vienna:20261117T101500', 'STATUS:CANCELLED', 'UID:abc@google.com', 'SUMMARY:Pflicht: Mathe III UE'),
      ),
      Date.UTC(2026, 9, 1),
      Date.UTC(2027, 0, 1),
    );
    expect(t.map((x) => [iso(x.start), iso(x.ende), x.titel])).toEqual([
      ['2026-10-13T08:15:00.000Z', '2026-10-13T09:45:00.000Z', 'Pflicht: Mathe III UE'],
      ['2026-10-20T08:15:00.000Z', '2026-10-20T09:45:00.000Z', 'Pflicht: Mathe III UE'],
      ['2026-10-27T09:15:00.000Z', '2026-10-27T10:45:00.000Z', 'Pflicht: Mathe III UE'], // Winterzeit: 10:15 bleibt 10:15
      ['2026-11-11T07:00:00.000Z', '2026-11-11T08:30:00.000Z', 'Pflicht: Mathe III UE (verschoben)'],
      ['2026-11-24T09:15:00.000Z', '2026-11-24T10:45:00.000Z', 'Pflicht: Mathe III UE'],
    ]);
    expect(new Set(t.map((x) => x.uid)).size).toBe(5); // jede Instanz eigene ID
  });

  it('mehrere Wochentage, COUNT, INTERVAL, täglich, monatlich, Fenster, nicht unterstützt → Hinweis', () => {
    const h: string[] = [];
    const t = icsTermine(
      kal(
        ev('DTSTART;TZID=Europe/Vienna:20261102T083000', 'DTEND;TZID=Europe/Vienna:20261102T100000', 'RRULE:FREQ=WEEKLY;COUNT=4;BYDAY=MO,TH', 'UID:w', 'SUMMARY:W'),
        ev('DTSTART:20261101T120000Z', 'DTEND:20261101T130000Z', 'RRULE:FREQ=DAILY;INTERVAL=10;COUNT=3', 'UID:d', 'SUMMARY:D'),
        ev('DTSTART;TZID=Europe/Vienna:20261031T090000', 'RRULE:FREQ=MONTHLY;COUNT=3', 'UID:m', 'SUMMARY:M'),
        ev('DTSTART;TZID=Europe/Vienna:20261105T090000', 'RRULE:FREQ=MONTHLY;BYDAY=1TH', 'UID:x', 'SUMMARY:X'),
        ev('DTSTART;VALUE=DATE:20261120', 'DTEND;VALUE=DATE:20261121', 'UID:g', 'SUMMARY:Ganztags'),
      ),
      Date.UTC(2026, 10, 1),
      Date.UTC(2027, 1, 1),
      h,
    );
    const von = (titel: string) => t.filter((x) => x.titel === titel).map((x) => iso(x.start));
    expect(von('W')).toEqual(['2026-11-02T07:30:00.000Z', '2026-11-05T07:30:00.000Z', '2026-11-09T07:30:00.000Z', '2026-11-12T07:30:00.000Z']);
    expect(von('D')).toEqual(['2026-11-01T12:00:00.000Z', '2026-11-11T12:00:00.000Z', '2026-11-21T12:00:00.000Z']);
    // COUNT=3: 31.10. (vor dem Fenster), 31.11. gibt es nicht (zählt nicht), 31.12., 31.01.
    expect(von('M')).toEqual(['2026-12-31T08:00:00.000Z', '2027-01-31T08:00:00.000Z']);
    expect(von('X')).toEqual(['2026-11-05T08:00:00.000Z']);
    expect(h.join()).toMatch(/BYDAY=1TH wird nicht unterstützt/);
    expect(t.find((x) => x.titel === 'Ganztags')).toMatchObject({ ganztags: true });
  });
});

describe('Google-Kalender als Quelle für „Studium“', () => {
  // TestUhr: Mo, 16.11.2026 12:00 UTC (13:00 in Linz)
  const fristen = kal(
    // Abgabe: Block 23:29–23:59, Frist = Ende
    ev('UID:a1', 'SUMMARY:⏰ Mathe III: Übungsblatt 5 ist fällig', 'DTSTART:20261117T222900Z', 'DTEND:20261117T225900Z'),
    ev('UID:a2', 'SUMMARY:✅ ⏰ AD2: Blatt 3 ist fällig', 'DTSTART:20261118T222900Z', 'DTEND:20261118T225900Z'),
    ev('UID:p1', 'SUMMARY:📝 NLP: Short Exam 2', 'DTSTART:20261120T090000Z', 'DTEND:20261120T100000Z'),
    ev('UID:alt', 'SUMMARY:⏰ NLP: Alte Abgabe ist fällig', 'DTSTART:20261110T222900Z', 'DTEND:20261110T225900Z'),
  );
  const pflicht = kal(
    // läuft gerade (12:15–13:45 Linz = 11:15–12:45 UTC)
    ev('UID:v1', 'SUMMARY:Pflicht: Mathe III UE', 'DTSTART;TZID=Europe/Vienna:20261109T121500', 'DTEND;TZID=Europe/Vienna:20261109T134500', 'RRULE:FREQ=WEEKLY;BYDAY=MO'),
    ev('UID:v2', 'SUMMARY:Prüfung: Stat. ML Klausur', 'DTSTART;TZID=Europe/Vienna:20261204T090000', 'DTEND;TZID=Europe/Vienna:20261204T110000'),
    ev('UID:priv', 'SUMMARY:Zahnarzt', 'DTSTART;TZID=Europe/Vienna:20261117T090000', 'DTEND;TZID=Europe/Vienna:20261117T100000'),
  );

  async function aufbau() {
    const texte = { fristen, pflicht };
    const d = await testDorf({ google: { fristen: { laden: async () => texte.fristen }, pflicht: { laden: async () => texte.pflicht } } });
    return { d, texte };
  }

  it('Abgaben (⏰), Prüfungen (📝, Prüfung:), erledigt (✅), Pflichtvorlesungen – nur Laufendes und Kommendes', async () => {
    const { d } = await aufbau();
    const e = await d.uni.abgleichen();
    expect(e.ok).toBe(true);
    const f = d.uni.fristen();
    expect(f.map((x) => [x.art, x.kurs, x.titel, x.abgegeben])).toEqual([
      ['pflicht', '', 'Mathe III UE', false], // heute, läuft gerade
      ['abgabe', 'Mathe III', 'Übungsblatt 5 ist fällig', false],
      ['abgabe', 'AD2', 'Blatt 3 ist fällig', true],
      ['test', 'NLP', 'Short Exam 2', false],
      ['pflicht', '', 'Mathe III UE', false], // nächster Montag (innerhalb 7 Tage)
      ['test', '', 'Stat. ML Klausur', false], // Prüfungen auch weiter als 7 Tage
    ]);
    expect(f[0]).toMatchObject({ frist: '2026-11-16T11:15:00.000Z', ende: '2026-11-16T12:45:00.000Z' });
    expect(f[1]).toMatchObject({ frist: '2026-11-17T22:59:00.000Z', ende: null }); // Frist = Ende des Blocks
    expect(f[3]).toMatchObject({ frist: '2026-11-20T09:00:00.000Z', ende: '2026-11-20T10:00:00.000Z' });
    // Privates aus dem Pflicht-Kalender landet nirgends
    expect(d.db.prepare("SELECT COUNT(*) AS n FROM moodle_fristen WHERE titel LIKE '%Zahnarzt%'").get()).toEqual({ n: 0 });
    // Gemeldet: neue offene Abgaben/Prüfungen, nicht jede Vorlesung, nicht Erledigtes
    expect(e.neueFristen.map((x) => x.titel)).toEqual(['Übungsblatt 5 ist fällig', 'Short Exam 2', 'Stat. ML Klausur']);
    expect(d.uni.uebersicht()).toMatchObject({ verbunden: true, google: { fristen: true, pflicht: true } });
  });

  it('✅ aus Google zählt, das Abhaken im Dorf bleibt; Erinnerungen für Abgaben und Prüfungen, nicht für Vorlesungen', async () => {
    const { d, texte } = await aufbau();
    await d.uni.abgleichen();
    const blatt5 = d.uni.fristen().find((x) => x.titel === 'Übungsblatt 5 ist fällig')!;
    d.uni.erledigtSetzen(blatt5.id, true);
    await d.uni.abgleichen(); // Google hat (noch) kein ✅ – das Dorf behält den Haken
    expect(d.uni.frist(blatt5.id)!.abgegeben).toBe(true);
    texte.fristen = texte.fristen.replace('SUMMARY:📝 NLP: Short Exam 2', 'SUMMARY:✅ 📝 NLP: Short Exam 2');
    await d.uni.abgleichen();
    expect(d.uni.fristen().find((x) => x.titel === 'Short Exam 2')!.abgegeben).toBe(true);

    d.uhr.vor(80 * STUNDE); // Do 20:00 – Stat.-ML-Klausur in ~2 Wochen, Vorlesung Mo nächste Woche
    const arten = d.uni.faelligeErinnerungen().map((x) => x.art);
    expect(arten).not.toContain('pflicht');
  });

  it('Kalender entfernt → seine Einträge verschwinden; alte Einträge aus dem direkten Moodle-Kalender werden aufgeräumt', async () => {
    const { d, texte } = await aufbau();
    d.db.prepare("INSERT INTO moodle_fristen (id, kurs, titel, art, frist, gesehen) VALUES ('ical:alt', 'X', 'Alt', 'abgabe', ?, 0)").run(d.uhr.jetzt() + 86_400_000);
    await d.uni.abgleichen();
    expect(d.uni.fristen().some((x) => x.id === 'ical:alt')).toBe(false);
    texte.pflicht = kal();
    await d.uni.abgleichen();
    expect(d.uni.fristen().some((x) => x.art === 'pflicht')).toBe(false);
  });
});
