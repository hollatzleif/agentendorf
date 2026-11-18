import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { naechsterTermin, termineZwischen, zeitplanLesen } from '../src/agenten/zeitplan.js';
import { ORIGIN, cookieAus, testDorf } from './hilfen.js';
import { passwortSetzen } from '../src/auth/passwort.js';

const PW = 'ein-langes-test-passwort-1';

const MIN = 60_000;
const STUNDE = 3_600_000;
const aktion = (kopf: string, text = 'Mach es.') => `---\n${kopf}\n---\n${text}\n`;

describe('Zeitpläne in einfacher Sprache', () => {
  it('täglich, werktags, Wochentage, mehrere Uhrzeiten; Fehler verständlich', () => {
    expect([...zeitplanLesen('täglich 06:00').tage].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect([...zeitplanLesen('werktags 07:00, 18:30').tage].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(zeitplanLesen('werktags 07:00, 18:30').zeiten).toEqual([{ h: 7, m: 0 }, { h: 18, m: 30 }]);
    expect([...zeitplanLesen('mo, mi und fr um 8:15 Uhr').tage].sort()).toEqual([1, 3, 5]);
    expect([...zeitplanLesen('wochenende 09:00').tage].sort()).toEqual([0, 6]);
    expect(() => zeitplanLesen('täglich')).toThrow(/Uhrzeit fehlt/);
    expect(() => zeitplanLesen('manchmal 06:00')).toThrow(/„manchmal“ verstehe ich nicht/);
    expect(() => zeitplanLesen('täglich 25:00')).toThrow(/keine Uhrzeit/);
  });

  it('Termine in mitteleuropäischer Zeit, auch über die Zeitumstellung', () => {
    const z = zeitplanLesen('täglich 06:00');
    // Mi 18.11.2026 12:00 UTC → nächster Termin Do 19.11. 06:00 MEZ = 05:00 UTC
    expect(new Date(naechsterTermin(z, Date.UTC(2026, 10, 18, 12))!).toISOString()).toBe('2026-11-19T05:00:00.000Z');
    // Sommer: 06:00 MESZ = 04:00 UTC
    expect(new Date(naechsterTermin(z, Date.UTC(2026, 6, 1, 12))!).toISOString()).toBe('2026-07-02T04:00:00.000Z');
    const w = zeitplanLesen('sa 10:00');
    expect(termineZwischen(w, Date.UTC(2026, 10, 16), Date.UTC(2026, 10, 23)).map((t) => new Date(t).toISOString())).toEqual(['2026-11-21T09:00:00.000Z']);
  });
});

describe('Aktionen mit Zeitplan und Ablage', () => {
  it('Kopf: Zeitplan geprüft, Pflicht-Eingaben brauchen standard, Ablage nur im eigenen Gebäude', async () => {
    const d = await testDorf();
    const ordner = path.join(d.vault.wurzel, 'Bibliothek/aktionen');
    fs.writeFileSync(path.join(ordner, 'gut.md'), aktion('name: Gut\nzeitplan: täglich 06:00\nablage: Bibliothek/00_Gut.html'));
    fs.writeFileSync(path.join(ordner, 'falsch.md'), aktion('name: Falsch\nzeitplan: irgendwann'));
    fs.writeFileSync(path.join(ordner, 'eingabe.md'), aktion('name: Eingabe\nzeitplan: täglich 06:00\neingaben:\n  - name: thema'));
    fs.writeFileSync(path.join(ordner, 'fremd.md'), aktion('name: Fremd\nablage: Uni/00_x.html'));
    fs.writeFileSync(path.join(ordner, 'kalender.md'), aktion('name: Kal\nwerkzeuge: [kalender]'));
    const liste = (await d.app.inject({ url: '/api/aktionen?gebaeude=Bibliothek', headers: await kopf(d) })).json() as { id: string; fehler?: string; naechsterLauf?: string; zeitplan?: string }[];
    const nach = (id: string) => liste.find((a) => a.id === `Bibliothek/${id}`)!;
    expect(nach('gut')).toMatchObject({ zeitplan: 'täglich 06:00', ablage: 'Bibliothek/00_Gut.html', naechsterLauf: '2026-11-17T05:00:00.000Z' });
    expect(nach('gut').fehler).toBeUndefined();
    expect(nach('falsch').fehler).toMatch(/irgendwann/);
    expect(nach('eingabe').fehler).toMatch(/standard-Wert/);
    expect(nach('fremd').fehler).toMatch(/im eigenen Gebäude/);
    expect(nach('kalender').fehler).toMatch(/fremdinhalte/);
  });

  it('Zeitplaner: neue Zeitpläne zählen ab jetzt, jeder Termin genau einmal, über den Motor der Aktion (nicht api), nachholen bis 3 h', async () => {
    const d = await testDorf();
    fs.writeFileSync(path.join(d.vault.wurzel, 'Bibliothek/aktionen/morgens.md'), aktion('name: Morgens\nmotor: claude-code\nzeitplan: täglich 06:00\neingaben:\n  - name: thema\n    standard: Folien'));
    expect(await d.automatik.pruefen()).toEqual([]); // erst bekannt machen
    d.uhr.vor(17 * STUNDE + MIN); // Di 17.11. 06:01 Linz
    expect(await d.automatik.pruefen()).toEqual(['Bibliothek/morgens']);
    expect(await d.automatik.pruefen()).toEqual([]); // nicht doppelt
    await d.agenten.leerlauf();
    const l = d.db.prepare("SELECT l.ausloeser, l.motor, l.auftrag, c.titel FROM laeufe l JOIN chats c ON c.id = l.chat_id WHERE c.aktion = 'Bibliothek/morgens'").all() as { ausloeser: string; motor: string; titel: string }[];
    expect(l).toEqual([expect.objectContaining({ ausloeser: 'automatik', motor: 'claude-code', titel: 'Morgens: Folien' })]);
    // Server war aus: Mi 06:00 verpasst, um 08:30 nachgeholt; Do 06:00 erst 10:00 → zu spät
    d.uhr.vor(24 * STUNDE + 2.5 * STUNDE);
    expect(await d.automatik.pruefen()).toEqual(['Bibliothek/morgens']);
    await d.agenten.leerlauf();
    d.uhr.vor(24 * STUNDE + 1.5 * STUNDE);
    expect(await d.automatik.pruefen()).toEqual([]);
    // geänderter Zeitplan: wieder erst ab jetzt
    fs.writeFileSync(path.join(d.vault.wurzel, 'Bibliothek/aktionen/morgens.md'), aktion('name: Morgens\nzeitplan: täglich 09:00\neingaben:\n  - name: thema\n    standard: Folien'));
    expect(await d.automatik.pruefen()).toEqual([]);
  });

  it('läuft dieselbe Aktion noch, wird der Termin ausgelassen', async () => {
    const d = await testDorf();
    fs.writeFileSync(path.join(d.vault.wurzel, 'Bibliothek/aktionen/lang.md'), aktion('name: Lang\nzeitplan: täglich 13:30, 14:00', '[warte 3000]'));
    await d.automatik.pruefen();
    d.uhr.vor(31 * MIN); // 13:31 Linz
    expect(await d.automatik.pruefen()).toEqual(['Bibliothek/lang']);
    d.uhr.vor(30 * MIN); // 14:01 – der erste Lauf läuft noch
    expect(await d.automatik.pruefen()).toEqual([]);
    expect(d.db.prepare("SELECT hinweis FROM automatik_termine WHERE hinweis IS NOT NULL").all()).toEqual([{ hinweis: 'übersprungen: läuft noch' }]);
    await d.agenten.leerlauf();
  });

  it('Ablage: neue Fassung erst nach Erfolg; alte samt Häkchen ins Archiv; ohne Entwurf/bei Fehler bleibt alles', async () => {
    const d = await testDorf();
    fs.writeFileSync(path.join(d.vault.wurzel, 'Bibliothek/aktionen/check.md'), aktion('name: Check\nablage: Bibliothek/00_Check.html', '[warte 50]'));
    await d.vault.schreiben('Bibliothek/00_Check.html', '<p>alt</p>');
    d.db.prepare('INSERT INTO seiten_stand (pfad, inhalt_json, geaendert) VALUES (?, ?, ?)').run('Bibliothek/00_Check.html', '{"a-0":true}', 1);

    const s = await d.agenten.aktionStarten('Bibliothek/check', {});
    const { entwurf } = d.db.prepare('SELECT entwurf FROM ablage_laeufe WHERE lauf_id = ?').get(s.laufId) as { entwurf: string };
    expect(entwurf).toMatch(/^Bibliothek\/\d{4}-\d{2}-\d{2}_\d{4}_00-check\.html$/);
    const auftrag = (d.db.prepare('SELECT auftrag FROM laeufe WHERE id = ?').get(s.laufId) as { auftrag: string }).auftrag;
    expect(auftrag).toContain(`nach \`${entwurf}\``);
    expect(auftrag).toContain('"a-0":true');
    await d.vault.schreiben(entwurf, '<p>neu</p>'); // wie der Agent
    await d.agenten.leerlauf();
    expect((await d.vault.lesen('Bibliothek/00_Check.html')).inhalt).toBe('<p>neu</p>');
    const archiv = (await d.vault.baum('Bibliothek/archiv/00_Check', 1)).kinder!.map((k) => k.name).sort();
    expect(archiv).toHaveLength(2);
    expect(archiv[0]).toMatch(/_00_Check\.html$/);
    expect(archiv[1]).toMatch(/_00_Check_haekchen\.json$/);
    expect(await d.vault.existiert(entwurf)).toBe(false);
    const hinweise = d.db.prepare("SELECT text FROM nachrichten WHERE chat_id = ? AND rolle = 'hinweis'").all(s.chatId) as { text: string }[];
    expect(hinweise.map((h) => h.text).join('\n')).toMatch(/Neue Fassung liegt unter Bibliothek\/00_Check\.html/);

    // kein Entwurf geschrieben → bleibt
    const s2 = await d.agenten.aktionStarten('Bibliothek/check', {});
    await d.agenten.leerlauf();
    expect((await d.vault.lesen('Bibliothek/00_Check.html')).inhalt).toBe('<p>neu</p>');
    const h2 = d.db.prepare("SELECT text FROM nachrichten WHERE chat_id = ? AND rolle = 'hinweis'").all(s2.chatId) as { text: string }[];
    expect(h2.map((h) => h.text).join('\n')).toMatch(/keine Datei .* bleibt unverändert/);
  });

  it('Ablage mit Platzhalter: Uni/faecher/{fach}/…; unsinnige Werte werden abgelehnt', async () => {
    const d = await testDorf();
    fs.writeFileSync(
      path.join(d.vault.wurzel, 'Uni/aktionen/kurs.md'),
      aktion('name: Kurs\nablage: Uni/faecher/{fach}/00_Kursuebersicht.html\neingaben:\n  - name: fach', '[warte 50]'),
    );
    const s = await d.agenten.aktionStarten('Uni/kurs', { fach: 'Computational Data Analytics' });
    expect(d.db.prepare('SELECT ziel FROM ablage_laeufe WHERE lauf_id = ?').get(s.laufId)).toEqual({ ziel: 'Uni/faecher/Computational Data Analytics/00_Kursuebersicht.html' });
    await expect(d.agenten.aktionStarten('Uni/kurs', { fach: '../../Rathaus' })).rejects.toThrow(/Ablage/);
    await d.agenten.leerlauf();
  });
});

async function kopf(d: Awaited<ReturnType<typeof testDorf>>) {
  await passwortSetzen(d.db, d.uhr, PW);
  const r = await d.app.inject({ method: 'POST', url: '/api/anmeldung', headers: { origin: ORIGIN }, payload: { passwort: PW } });
  return { origin: ORIGIN, cookie: cookieAus(r.headers['set-cookie']) };
}

describe('Häkchen-Brücke (seiten_stand)', () => {
  it('nur für bestehende .html-Seiten, höchstens 64 KB, nur angemeldet', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    await d.vault.schreiben('Bibliothek/seite.html', '<p>x</p>');
    const put = (pfad: string, stand: unknown, headers: Record<string, string> = h) => d.app.inject({ method: 'PUT', url: '/api/vault/seitenstand', headers, payload: { pfad, stand } });
    expect((await put('Bibliothek/seite.html', { a: true })).statusCode).toBe(200);
    expect((await d.app.inject({ url: '/api/vault/seitenstand?pfad=Bibliothek/seite.html', headers: h })).json()).toEqual({ stand: { a: true } });
    expect((await put('Bibliothek/fehlt.html', {})).statusCode).toBe(404);
    expect((await put('Bibliothek/gebaeude.md', {})).statusCode).toBe(400);
    expect((await put('Bibliothek/seite.html', { x: 'y'.repeat(70_000) })).statusCode).toBe(413);
    expect((await put('Bibliothek/seite.html', {}, { origin: ORIGIN })).statusCode).toBe(401);
  });
});

describe('Werkzeug kalender_lesen', () => {
  it('Hauptkalender + Uni-Fristen (mit „erledigt“), als Fremdinhalt; nur mit werkzeuge: [kalender] und fremdinhalte', async () => {
    const ev = (uid: string, titel: string, von: string, bis: string) => `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${titel}\r\nDTSTART:${von}\r\nDTEND:${bis}\r\nEND:VEVENT\r\n`;
    const kal = (...e: string[]) => `BEGIN:VCALENDAR\r\n${e.join('')}END:VCALENDAR\r\n`;
    const d = await testDorf({
      google: {
        termine: { laden: async () => kal(ev('l', 'Liederabend', '20261117T160000Z', '20261117T180000Z'), ev('w', 'Viel später', '20261220T160000Z', '20261220T170000Z')) },
        fristen: { laden: async () => kal(ev('a', '⏰ CDA: Übung 2 ist fällig', '20261118T222900Z', '20261118T225900Z')) },
      },
    });
    await d.uni.abgleichen();
    fs.writeFileSync(
      path.join(d.vault.wurzel, 'Bibliothek/aktionen/kal.md'),
      aktion('name: Kal\nwerkzeuge: [vault_lesen, kalender]\nfremdinhalte: ja', '<<werkzeug kalender_lesen {"tage":5}>>'),
    );
    const s = await d.agenten.aktionStarten('Bibliothek/kal', {});
    await d.agenten.leerlauf();
    const t = (d.db.prepare("SELECT text FROM nachrichten WHERE chat_id = ? AND rolle = 'werkzeug'").get(s.chatId) as { text: string }).text;
    expect(t).toContain('<fremdinhalt quelle="kalender">');
    expect(t).toMatch(/Kalender · Liederabend/);
    expect(t).toMatch(/Abgabe · Übung 2 ist fällig \(CDA\)/);
    expect(t).not.toContain('Viel später');
  });
});

describe('Skills anlegen', () => {
  const entwurf = {
    gebaeude: 'Bibliothek',
    name: 'Wochenplan',
    beschreibung: 'Plant die Woche',
    anweisung: 'Lies meine Termine und schreib einen Wochenplan.',
    werkzeuge: ['vault_lesen', 'vault_schreiben', 'kalender'],
    fremdinhalte: true,
    zeitplan: 'mo 07:00',
    ablage: 'Bibliothek/00_Wochenplan.md',
  };

  it('App-Formular: geprüft wie jede Aktion, als Markdown gespeichert; Fehlerhaftes und Doppeltes nicht', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    const neu = (b: object) => d.app.inject({ method: 'POST', url: '/api/aktionen/neu', headers: h, payload: b });
    const r = await neu(entwurf);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ id: 'Bibliothek/wochenplan', pfad: 'Bibliothek/aktionen/wochenplan.md' });
    const md = (await d.vault.lesen('Bibliothek/aktionen/wochenplan.md')).inhalt;
    expect(md).toMatch(/zeitplan: '?mo 07:00'?/);
    expect(md).toContain('fremdinhalte: ja');
    expect(md).toContain('Lies meine Termine');
    const liste = (await d.app.inject({ url: '/api/aktionen?gebaeude=Bibliothek', headers: h })).json() as { id: string; fehler?: string; zeitplan?: string }[];
    expect(liste.find((a) => a.id === 'Bibliothek/wochenplan')).toMatchObject({ zeitplan: 'mo 07:00' });
    expect(liste.find((a) => a.id === 'Bibliothek/wochenplan')!.fehler).toBeUndefined();

    expect((await neu(entwurf)).statusCode).toBe(409);
    const kaputt = await neu({ ...entwurf, name: 'Moodle ohne Fremd', werkzeuge: ['moodle'], fremdinhalte: false });
    expect(kaputt.statusCode).toBe(400);
    expect(kaputt.json().fehler).toMatch(/fremdinhalte/);
    expect(await d.vault.existiert('Bibliothek/aktionen/moodle-ohne-fremd.md')).toBe(false);
    expect((await neu({ ...entwurf, name: 'X1', gebaeude: 'Gibtsnicht' })).statusCode).toBe(400);
    expect((await neu({ ...entwurf, name: 'Fremde Ablage', ablage: 'Rathaus/x.md' })).statusCode).toBe(400);
  });

  it('Bürgermeister schlägt vor (Freigabe); erst nach Leifs Ja gibt es die Datei', async () => {
    const d = await testDorf();
    const befehl = `<<werkzeug aktion_vorschlagen ${JSON.stringify({ ...entwurf, name: 'Wochenplan vom BM' })}>>`;
    await d.agenten.aktionStarten('Rathaus/buergermeister', { aufgabe: befehl });
    await d.agenten.leerlauf();
    const f = d.agenten.freigaben.liste('offen').find((x) => x.art === 'aktion_anlegen')!;
    expect(f.titel).toBe('Neuer Skill: Wochenplan vom BM (Bibliothek)');
    expect((f.inhalt as { markdown: string }).markdown).toContain('name: Wochenplan vom BM');
    expect(await d.vault.existiert('Bibliothek/aktionen/wochenplan-vom-bm.md')).toBe(false);
    await d.agenten.freigaben.entscheiden(f.id, true);
    expect(await d.vault.existiert('Bibliothek/aktionen/wochenplan-vom-bm.md')).toBe(true);
  });
});
