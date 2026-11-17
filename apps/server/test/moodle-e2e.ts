// Nachgebautes Moodle für die Browser-Tests (gestartet von apps/web/e2e/server-starten.sh).
import { moodleAttrappe } from './moodle-attrappe.js';

const m = await moodleAttrappe(Number(process.env.MOODLE_PORT ?? 3998));
const jetzt = Math.floor(Date.now() / 1000);
m.s.abschnitte[11] = [
  {
    id: 1,
    name: 'Woche 1',
    section: 1,
    modules: [{ id: 101, name: 'Folien 1', modname: 'resource', contents: [m.datei('/1/mod_resource/content/1/VO01.pdf', { inhalt: Buffer.from('%PDF-1.1\n%%EOF'), geaendert: 100 })] }],
  },
];
m.s.aufgaben[11] = [
  { id: 501, cmid: 106, course: 11, name: 'Übung 1', intro: '<p>Rechnen Sie <b>alles</b>.</p>', duedate: jetzt + 86_400 },
  { id: 502, cmid: 107, course: 11, name: 'Übung 2', intro: '<p>Später.</p>', duedate: jetzt + 10 * 86_400 },
];
m.s.aufgaben[12] = [{ id: 601, cmid: 201, course: 12, name: 'Projekt', intro: '', duedate: 0 }];
m.s.ereignisse = [{ id: 77, name: 'Zwischentest', modulename: 'quiz', timesort: jetzt + 3 * 86_400, course: { id: 12 }, url: `${m.basis}/mod/quiz/view.php?id=9` }];
// Kalender-Export: so sieht der JKU-Weg aus (App-Zugang ist dort gesperrt)
const z = (sek: number) => new Date(sek * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const ev = (uid: string, titel: string, sek: number, kurs: string) =>
  `BEGIN:VEVENT\r\nUID:${uid}@127.0.0.1\r\nSUMMARY:${titel}\r\nCATEGORIES:${kurs}\r\nDTSTART:${z(sek)}\r\nDTEND:${z(sek)}\r\nEND:VEVENT\r\n`;
m.s.ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${ev('1', 'Übung 1 ist fällig', jetzt + 86_400, 'CDA')}${ev('2', 'Übung 2 ist fällig', jetzt + 10 * 86_400, 'CDA')}${ev('3', 'Zwischentest schließt', jetzt + 3 * 86_400, 'STAT')}END:VCALENDAR\r\n`;
// Google-Kalender wie aus Leifs Skript: „⏰ Kurs: …“ endet zur Frist, „📝“ = Prüfung; Pflicht-Kalender mit Privatem
const block = (uid: string, titel: string, sek: number) => `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${titel}\r\nDTSTART:${z(sek - 1800)}\r\nDTEND:${z(sek)}\r\nEND:VEVENT\r\n`;
const dauer = (uid: string, titel: string, von: number, bis: number) => `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${titel}\r\nDTSTART:${z(von)}\r\nDTEND:${z(bis)}\r\nEND:VEVENT\r\n`;
m.s.google.fristen = `BEGIN:VCALENDAR\r\n${block('g1', '⏰ CDA: Übung 1 ist fällig', jetzt + 86_400)}${block('g2', '⏰ CDA: Übung 2 ist fällig', jetzt + 10 * 86_400)}${block('g0', '⏰ CDA: Übung 0 ist fällig', jetzt - 86_400)}${dauer('g3', '📝 STAT: Zwischentest', jetzt + 3 * 86_400, jetzt + 3 * 86_400 + 3600)}END:VCALENDAR\r\n`;
m.s.google.pflicht = `BEGIN:VCALENDAR\r\n${dauer('p1', 'Pflicht: Mathe III UE', jetzt - 1800, jetzt + 3600)}${dauer('p2', 'Zahnarzt', jetzt + 7200, jetzt + 9000)}END:VCALENDAR\r\n`;
console.log(`Moodle-Attrappe auf ${m.basis}`);
