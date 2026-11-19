import { describe, expect, it } from 'vitest';
import { testDorf } from './hilfen.js';

const kal = (...ev: string[][]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...ev.flat(), 'END:VCALENDAR'].join('\r\n');
const ev = (...z: string[]) => ['BEGIN:VEVENT', ...z, 'END:VEVENT'];

// TestUhr: Mo, 16.11.2026 12:00 UTC
const FRISTEN = kal(
  ev('UID:a1', 'SUMMARY:⏰ Mathe III: Übungsblatt 5 ist fällig', 'DTSTART:20261117T222900Z', 'DTEND:20261117T225900Z'),
  ev('UID:a2', 'SUMMARY:✅ ⏰ AD2: Blatt 3 ist fällig', 'DTSTART:20261118T222900Z', 'DTEND:20261118T225900Z'),
  ev('UID:p1', 'SUMMARY:📝 NLP: Short Exam 2', 'DTSTART:20261120T090000Z', 'DTEND:20261120T100000Z'),
  ev('UID:alt', 'SUMMARY:⏰ NLP: Alte Abgabe ist fällig', 'DTSTART:20261115T222900Z', 'DTEND:20261115T225900Z'),
);
const PFLICHT = kal(ev('UID:v1', 'SUMMARY:Pflicht: Mathe III UE', 'DTSTART;TZID=Europe/Vienna:20261117T121500', 'DTEND;TZID=Europe/Vienna:20261117T134500'));

async function aufbau() {
  const texte = { fristen: FRISTEN, pflicht: PFLICHT };
  const d = await testDorf({ google: { fristen: { laden: async () => texte.fristen }, pflicht: { laden: async () => texte.pflicht } } });
  const offen = async () => (await d.todos.liste()).filter((t) => !t.erledigt);
  return { d, texte, offen };
}

describe('Uni-Fristen → To-dos (E71)', () => {
  it('künftige offene Abgaben und Prüfungen werden genau einmal To-dos – mit Datum in Linzer Zeit, Kurs als Gruppe, fremd', async () => {
    const { d, offen } = await aufbau();
    await d.uni.abgleichen();
    const t = await offen();
    expect(t.map((x) => [x.titel, x.faellig, x.gruppe, x.gebaeude, x.quelle, x.fremd])).toEqual([
      // 22:59 UTC am 17.11. = 23:59 in Linz → 17.11.
      ['Abgabe: Übungsblatt 5 ist fällig', '2026-11-17', 'Mathe III', 'Uni', 'Uni', true],
      ['Prüfung: Short Exam 2', '2026-11-20', 'NLP', 'Uni', 'Uni', true],
    ]);
    // nicht: erledigte (✅), vergangene, Pflichtvorlesungen
    expect(t[0]!.notiz).toMatch(/Abgabe bis Di\.?, 17\.11\.?,? 23:59/);
    // zweiter Abgleich legt nichts doppelt an
    await d.uni.abgleichen();
    await d.uniTodos.abgleichen();
    expect(await offen()).toHaveLength(2);
  });

  it('To-do abhaken hakt die Frist ab – und umgekehrt; gelöschte To-dos kommen nicht wieder', async () => {
    const { d, offen } = await aufbau();
    await d.uni.abgleichen();
    const [blatt, pruefung] = await offen();
    const fristBlatt = d.uni.fristen().find((f) => f.titel === 'Übungsblatt 5 ist fällig')!;
    const fristPruefung = d.uni.fristen().find((f) => f.titel === 'Short Exam 2')!;

    // Marktplatz → Uni
    await d.todos.aendern(blatt!.pfad, { erledigt: true });
    await d.uniTodos.abgleichen();
    expect(d.uni.frist(fristBlatt.id)!.abgegeben).toBe(true);

    // Uni → Marktplatz
    d.uni.erledigtSetzen(fristPruefung.id, true);
    await d.uniTodos.abgleichen();
    expect((await d.todos.holen(pruefung!.pfad)).erledigt).toBe(true);

    // wieder öffnen (Uni-Seite) → To-do wieder offen
    d.uni.erledigtSetzen(fristPruefung.id, false);
    await d.uniTodos.abgleichen();
    expect((await d.todos.holen(pruefung!.pfad)).erledigt).toBe(false);

    // gelöscht → bleibt weg, auch nach dem nächsten Abgleich
    await d.todos.loeschen(pruefung!.pfad);
    await d.uni.abgleichen();
    expect((await offen()).map((x) => x.titel)).toEqual([]);
  });

  it('verschobene Frist zieht das Fälligkeitsdatum nach; neue Frist kommt dazu', async () => {
    const { d, texte, offen } = await aufbau();
    await d.uni.abgleichen();
    texte.fristen = texte.fristen
      .replace('DTSTART:20261117T222900Z', 'DTSTART:20261124T222900Z')
      .replace('DTEND:20261117T225900Z', 'DTEND:20261124T225900Z')
      .replace('END:VCALENDAR', ['BEGIN:VEVENT', 'UID:a3', 'SUMMARY:⏰ AD2: Blatt 4 ist fällig', 'DTSTART:20261125T222900Z', 'DTEND:20261125T225900Z', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'));
    await d.uni.abgleichen();
    expect((await offen()).map((x) => [x.titel, x.faellig])).toEqual([
      ['Prüfung: Short Exam 2', '2026-11-20'],
      ['Abgabe: Übungsblatt 5 ist fällig', '2026-11-24'],
      ['Abgabe: Blatt 4 ist fällig', '2026-11-25'],
    ]);
  });

  it('E130: neue Abgabe/Prüfung bekommt Standard-Teilschritte; eigene Vorlage im Vault gewinnt, leere schaltet ab', async () => {
    const { d, offen } = await aufbau();
    await d.vault.schreiben('Uni/vorlagen/schritte-pruefung.md', '# Meine Prüfungsschritte\n\n- [ ] Zusammenfassung schreiben\n- [x] Altklausur 1\n', { nurNeu: true });
    await d.uni.abgleichen();
    const [blatt, pruefung] = await offen();
    expect(blatt!.schritte?.map((x) => x.text)).toEqual(['Angabe lesen, Fragen notieren', 'Aufgaben lösen', 'Lösung sauber aufschreiben', 'In Moodle hochladen und Abgabe prüfen']);
    expect(blatt!.schritte?.every((x) => !x.erledigt)).toBe(true);
    // Vorlage übernimmt nur den Text, nicht das Häkchen
    expect(pruefung!.schritte).toEqual([{ text: 'Zusammenfassung schreiben', erledigt: false }, { text: 'Altklausur 1', erledigt: false }]);
    expect(pruefung!.notiz).toMatch(/^Prüfung am/);
  });
});
