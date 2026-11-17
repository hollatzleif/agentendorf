import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import matter from 'gray-matter';
import { formFelder, moodleKlient, ohneToken, tokenAusLaunch } from '../src/uni/moodle.js';
import { htmlZuMarkdown } from '../src/uni/text.js';
import { passwortSetzen } from '../src/auth/passwort.js';
import { cookieAus, ORIGIN, testDorf } from './hilfen.js';
import { moodleAttrappe, TOKEN } from './moodle-attrappe.js';
import type { TelegramSchnittstelle } from '../src/telegram/api.js';

const WWWROOT = 'https://moodle.jku.at';
const launch = (signatur: string, token: string, privat = '') =>
  `moodlemobile://token=${Buffer.from(`${signatur}:::${token}${privat ? `:::${privat}` : ''}`).toString('base64')}`;
const md5 = (t: string) => crypto.createHash('md5').update(t).digest('hex');

describe('Moodle-Token aus der Anmelde-Adresse', () => {
  const passport = '83746592';
  it('nimmt die richtige Signatur an (mit und ohne privates Token)', () => {
    expect(tokenAusLaunch(launch(md5(WWWROOT + passport), TOKEN), WWWROOT, passport)).toEqual({ token: TOKEN });
    expect(tokenAusLaunch(`  ${launch(md5(WWWROOT + passport), TOKEN, 'privat123')}\n`, `${WWWROOT}/`, passport)).toEqual({ token: TOKEN });
  });
  it('lehnt falsche Signatur, falschen Prüfwert und Müll ab', () => {
    expect(() => tokenAusLaunch(launch(md5('https://boese.example' + passport), TOKEN), WWWROOT, passport)).toThrow(/Signatur/);
    expect(() => tokenAusLaunch(launch(md5(WWWROOT + passport), TOKEN), WWWROOT, '11111111')).toThrow(/Signatur/);
    expect(() => tokenAusLaunch('https://moodle.jku.at/', WWWROOT, passport)).toThrow(/token=/);
    expect(() => tokenAusLaunch('moodlemobile://token=bnVy', WWWROOT, passport)).toThrow(/kein gültiges Token/);
    expect(() => tokenAusLaunch(launch(md5(WWWROOT + passport), 'x;rm -rf'), WWWROOT, passport)).toThrow(/Format/);
  });
});

describe('Moodle-Hilfen', () => {
  it('verschachtelte Parameter wie Moodle sie erwartet', () => {
    expect(formFelder({ courseids: [3, 4], options: [{ name: 'a', value: true }] }).toString()).toBe(
      'courseids%5B0%5D=3&courseids%5B1%5D=4&options%5B0%5D%5Bname%5D=a&options%5B0%5D%5Bvalue%5D=1',
    );
  });
  it('entfernt Tokens aus Adressen', () => {
    expect(ohneToken(`${WWWROOT}/webservice/pluginfile.php/1/a.pdf?token=${TOKEN}&forcedownload=1`)).toBe(`${WWWROOT}/webservice/pluginfile.php/1/a.pdf?forcedownload=1`);
  });
  it('macht aus Aufgaben-HTML schlichtes Markdown', () => {
    const md = htmlZuMarkdown(
      `<p>Lösen Sie <strong>alle</strong> Aufgaben.</p><script>alert(1)</script><ul><li>Teil&nbsp;a</li><li>Teil b</li></ul><p><a href="${WWWROOT}/x.pdf?token=geheim">Blatt</a><br><img src="x.png" alt="Skizze"></p>`,
    );
    expect(md).toBe(`Lösen Sie **alle** Aufgaben.\n\n- Teil a\n- Teil b\n\n[Blatt](${WWWROOT}/x.pdf)\n[Bild: Skizze]`);
  });
  it('lädt Dateien nur von der eigenen Moodle-Adresse (das Token geht nirgendwo anders hin)', async () => {
    const k = moodleKlient(WWWROOT, TOKEN);
    await expect(k.dateiLaden('https://boese.example/webservice/pluginfile.php/1/a.pdf', 1000)).rejects.toThrow(/nicht geladen/);
  });
});

describe('Moodle-Abgleich', () => {
  const offen: { schliessen: () => Promise<void> }[] = [];
  afterEach(async () => {
    while (offen.length) await offen.pop()!.schliessen();
  });

  async function aufbau(opt: { telegram?: TelegramSchnittstelle; env?: Record<string, string> } = {}) {
    const m = await moodleAttrappe();
    offen.push(m);
    const d = await testDorf({ moodle: moodleKlient(m.basis, TOKEN), telegram: opt.telegram, env: opt.env });
    const jetzt = Math.floor(d.uhr.jetzt() / 1000);
    m.s.abschnitte[11] = [
      {
        id: 1,
        name: 'Allgemeines',
        section: 0,
        modules: [{ id: 101, name: 'Syllabus', modname: 'resource', contents: [m.datei('/1/mod_resource/content/1/Syllabus.pdf', { inhalt: Buffer.from('%PDF syllabus'), geaendert: 100 })] }],
      },
      {
        id: 2,
        name: 'Woche 1: Einführung',
        section: 1,
        modules: [
          { id: 102, name: 'Folien 1', modname: 'resource', contents: [m.datei('/2/mod_resource/content/3/VO 01 Grundlagen.pdf', { inhalt: Buffer.from('%PDF folien1'), geaendert: 200 })] },
          {
            id: 103,
            name: 'Material',
            modname: 'folder',
            contents: [
              { ...m.datei('/3/mod_folder/content/0/daten.csv', { inhalt: Buffer.from('a,b\n1,2'), geaendert: 200 }), filepath: '/Datensaetze/' },
              m.datei('/3/mod_folder/content/0/riesig.zip', { inhalt: Buffer.from('nie geladen'), geaendert: 200, groesse: 200 * 1024 * 1024 }),
              m.datei('/3/mod_folder/content/0/kaputt.pdf', { inhalt: Buffer.from(''), geaendert: 200, kaputt: true }),
            ],
          },
          { id: 104, name: 'Versteckt', modname: 'resource', uservisible: false, contents: [m.datei('/4/x.pdf', { inhalt: Buffer.from('geheim'), geaendert: 1 })] },
          { id: 105, name: 'Forum', modname: 'forum' },
          { id: 106, name: 'Übung 1', modname: 'assign' },
        ],
      },
    ];
    m.s.aufgaben[11] = [
      {
        id: 501,
        cmid: 106,
        course: 11,
        name: 'Übung 1',
        intro: `<p>Rechnen Sie <b>alles</b>.</p><p><a href="${m.basis}/webservice/pluginfile.php/9/intro.pdf?token=${TOKEN}">Angabe</a></p>`,
        introattachments: [m.datei('/9/mod_assign/introattachment/0/Uebung1.pdf', { inhalt: Buffer.from('%PDF uebung'), geaendert: 300 })],
        duedate: jetzt + 2 * 86_400,
      },
      { id: 502, cmid: 107, course: 11, name: 'Übung 0', intro: '', duedate: jetzt - 86_400 },
    ];
    m.s.aufgaben[12] = [{ id: 601, cmid: 201, course: 12, name: 'Projekt', intro: '<p>Frei</p>', duedate: 0 }];
    m.s.abgegeben.add(502);
    m.s.ereignisse = [
      { id: 77, name: 'Zwischentest', modulename: 'quiz', timesort: jetzt + 86_400, course: { id: 12, fullname: 'Statistik / UE' }, url: `${m.basis}/mod/quiz/view.php?id=9` },
      { id: 78, name: 'Übung 1 fällig', modulename: 'assign', timesort: jetzt + 2 * 86_400, course: { id: 11 } },
      { id: 79, name: 'Altes Quiz', modulename: 'quiz', timesort: jetzt + 86_400, course: { id: 9 } },
    ];
    return { m, d };
  }

  const vaultTexte = (wurzel: string) => {
    const aus: string[] = [];
    const laufen = (p: string) => {
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        const abs = path.join(p, e.name);
        if (e.isDirectory()) laufen(abs);
        else aus.push(fs.readFileSync(abs, 'latin1'));
      }
    };
    laufen(wurzel);
    return aus;
  };

  it('holt nur das aktuelle Semester, legt Folien, Abgaben und Fristen ab – das Token landet nirgends im Vault', async () => {
    const { m, d } = await aufbau();
    const e = await d.uni.abgleichen();
    expect(e.ok).toBe(true);
    expect(m.s.aufrufe.find((a) => a.funktion === 'core_course_get_enrolled_courses_by_timeline_classification')!.params.classification).toBe('inprogress');
    const F = 'Uni/faecher/Computational Data Analytics';
    expect(fs.readFileSync(d.vault.abs(`${F}/folien/00 Allgemeines/Syllabus.pdf`), 'utf8')).toBe('%PDF syllabus');
    expect(fs.readFileSync(d.vault.abs(`${F}/folien/01 Woche 1- Einfuehrung/VO 01 Grundlagen.pdf`), 'utf8')).toBe('%PDF folien1');
    expect(fs.readFileSync(d.vault.abs(`${F}/folien/01 Woche 1- Einfuehrung/Material/Datensaetze/daten.csv`), 'utf8')).toBe('a,b\n1,2');
    expect(await d.vault.existiert('Uni/faecher/Statistik - UE/kurs.md')).toBe(true);
    expect(await d.vault.existiert('Uni/faecher/Altes Fach')).toBe(false);
    // Versteckt, zu groß, kaputt: nicht da – aber gemeldet (außer versteckt)
    expect(fs.existsSync(d.vault.abs(`${F}/folien/01 Woche 1- Einfuehrung/Material/riesig.zip`))).toBe(false);
    expect(m.s.downloads).not.toContain('/3/mod_folder/content/0/riesig.zip');
    expect(m.s.downloads).not.toContain('/4/x.pdf');
    expect(e.hinweise.join('\n')).toMatch(/riesig\.zip.*200 MB/);
    expect(e.hinweise.join('\n')).toMatch(/kaputt\.pdf.*HTTP 500/);
    expect(e.neueDateien).toBe(4); // Syllabus, Folien, CSV, Übungs-Anhang

    // Abgabe mit Frist, Fremdinhalt, Anhang
    const a = matter(fs.readFileSync(d.vault.abs(`${F}/aufgaben/Uebung 1/aufgabe.md`), 'utf8'));
    expect(a.data).toMatchObject({ titel: 'Übung 1', fremdinhalt: true, abgegeben: false, moodle_id: 501, kurs: 'Computational Data Analytics' });
    expect(a.data.frist).toBe(new Date(d.uhr.jetzt() + 2 * 86_400_000).toISOString());
    expect(a.content).toContain('Rechnen Sie **alles**.');
    expect(a.content).toContain('[[Uebung1.pdf]]');
    expect(a.content).toContain(`${m.basis}/mod/assign/view.php?id=106`);
    expect(fs.readFileSync(d.vault.abs(`${F}/aufgaben/Uebung 1/Uebung1.pdf`), 'utf8')).toBe('%PDF uebung');
    expect(e.neueAbgaben.map((x) => x.titel).sort()).toEqual(['Projekt', 'Übung 0', 'Übung 1']);

    // Fristen sortiert; Quiz aus dem Kalender, Abgaben nicht doppelt, altes Semester nicht; ohne Frist zuletzt
    const f = d.uni.fristen();
    expect(f.map((x) => [x.titel, x.art, x.abgegeben])).toEqual([
      ['Übung 0', 'abgabe', true],
      ['Zwischentest', 'test', false],
      ['Übung 1', 'abgabe', false],
      ['Projekt', 'abgabe', false],
    ]);
    expect(f[2]!.pfad).toBe(`${F}/aufgaben/Uebung 1`);

    // Token nirgends im Vault
    for (const t of vaultTexte(d.vault.wurzel)) expect(t).not.toContain(TOKEN);
    expect(d.uni.letzterAbgleich()).toMatchObject({ ok: true, neueDateien: 4, neueAbgaben: 3 });
  });

  it('lädt beim zweiten Mal nichts neu, Geändertes schon; Leifs Änderungen bleiben (Konfliktkopie)', async () => {
    const { m, d } = await aufbau();
    await d.uni.abgleichen();
    const vorher = m.s.downloads.length;
    const e2 = await d.uni.abgleichen();
    expect(m.s.downloads.length - vorher).toBe(1); // nur die kaputte Datei wird erneut versucht
    expect(e2).toMatchObject({ neueDateien: 0, neueAbgaben: [] });

    const F = 'Uni/faecher/Computational Data Analytics/folien/00 Allgemeines';
    // Moodle ändert den Syllabus, Leif hat seine Kopie bearbeitet → seine bleibt, neue als Konfliktkopie
    m.s.dateien.set('/1/mod_resource/content/1/Syllabus.pdf', { inhalt: Buffer.from('%PDF syllabus v2'), geaendert: 999 });
    (m.s.abschnitte[11] as { modules: { contents: { timemodified: number }[] }[] }[])[0]!.modules[0]!.contents[0]!.timemodified = 999;
    fs.writeFileSync(d.vault.abs(`${F}/Syllabus.pdf`), 'Leifs Notizen');
    // Folien 1 ändert sich, ohne dass Leif sie angefasst hat → wird ersetzt
    m.s.dateien.set('/2/mod_resource/content/3/VO 01 Grundlagen.pdf', { inhalt: Buffer.from('%PDF folien1 v2'), geaendert: 999 });
    (m.s.abschnitte[11] as { modules: { contents: { timemodified: number }[] }[] }[])[1]!.modules[0]!.contents[0]!.timemodified = 999;
    await d.uni.abgleichen();
    expect(fs.readFileSync(d.vault.abs(`${F}/Syllabus.pdf`), 'utf8')).toBe('Leifs Notizen');
    const konflikt = fs.readdirSync(d.vault.abs(F)).find((n) => n.includes('.konflikt-'));
    expect(fs.readFileSync(d.vault.abs(`${F}/${konflikt}`), 'utf8')).toBe('%PDF syllabus v2');
    expect(fs.readFileSync(d.vault.abs('Uni/faecher/Computational Data Analytics/folien/01 Woche 1- Einfuehrung/VO 01 Grundlagen.pdf'), 'utf8')).toBe('%PDF folien1 v2');

    // Gelöschtes kommt nicht zurück, solange Moodle es nicht ändert
    fs.rmSync(d.vault.abs('Uni/faecher/Computational Data Analytics/folien/01 Woche 1- Einfuehrung/Material/Datensaetze/daten.csv'));
    await d.uni.abgleichen();
    expect(fs.existsSync(d.vault.abs('Uni/faecher/Computational Data Analytics/folien/01 Woche 1- Einfuehrung/Material/Datensaetze/daten.csv'))).toBe(false);

    // Abgabestatus ändert sich → aufgabe.md wird aktualisiert
    m.s.abgegeben.add(501);
    await d.uni.abgleichen();
    expect(matter(fs.readFileSync(d.vault.abs('Uni/faecher/Computational Data Analytics/aufgaben/Uebung 1/aufgabe.md'), 'utf8')).data.abgegeben).toBe(true);
    expect(d.uni.fristen().find((f) => f.titel === 'Übung 1')!.abgegeben).toBe(true);
  });

  it('eigene Dateien gleichen Namens werden nie überschrieben', async () => {
    const { d } = await aufbau();
    await d.vault.schreiben('Uni/faecher/Computational Data Analytics/folien/00 Allgemeines/Syllabus.pdf', 'meins');
    await d.uni.abgleichen();
    const ordner = d.vault.abs('Uni/faecher/Computational Data Analytics/folien/00 Allgemeines');
    expect(fs.readFileSync(path.join(ordner, 'Syllabus.pdf'), 'utf8')).toBe('meins');
    expect(fs.readFileSync(path.join(ordner, 'Syllabus (2).pdf'), 'utf8')).toBe('%PDF syllabus');
  });

  it('fehlende Funktionen oder ungültiges Token: Abgleich stoppt mit klarer Meldung, nichts stürzt ab', async () => {
    const { m, d } = await aufbau();
    m.s.funktionen = m.s.funktionen.filter((f) => f !== 'core_course_get_contents');
    const e = await d.uni.abgleichen();
    expect(e.ok).toBe(false);
    expect(e.fehler).toMatch(/core_course_get_contents.*gestoppt/);
    expect(d.uni.letzterAbgleich()).toMatchObject({ ok: false });

    const d2 = await testDorf({ moodle: moodleKlient(m.basis, 'falsch0123456789falsch0123456789') });
    const e2 = await d2.uni.abgleichen();
    expect(e2.fehler).toMatch(/Invalid token/);

    // optionale Funktionen fehlen → Hinweis, Rest läuft
    m.s.funktionen = m.s.funktionen.filter((f) => f !== 'mod_assign_get_submission_status' && f !== 'core_calendar_get_action_events_by_timesort').concat('core_course_get_contents');
    const e3 = await d.uni.abgleichen();
    expect(e3.ok).toBe(true);
    expect(e3.hinweise.join('\n')).toMatch(/mod_assign_get_submission_status/);
    expect(m.s.aufrufe.filter((a) => a.funktion === 'mod_assign_get_submission_status')).toHaveLength(0);
  });

  it('gleichzeitige Abgleiche laufen nur einmal', async () => {
    const { m, d } = await aufbau();
    const [a, b] = await Promise.all([d.uni.abgleichen(), d.uni.abgleichen()]);
    expect(a).toBe(b);
    expect(m.s.aufrufe.filter((x) => x.funktion === 'core_webservice_get_site_info')).toHaveLength(1);
  });

  it('Telegram meldet Neues (schaltbar) und denselben Fehler nur einmal', async () => {
    const texte: string[] = [];
    const api: TelegramSchnittstelle = {
      async aufruf<T>(mth: string, p: Record<string, unknown> = {}) {
        if (mth === 'sendMessage') texte.push(String(p.text));
        return { message_id: 1 } as T;
      },
      async dateiLaden() {
        return { name: 'x', inhalt: Buffer.from('') };
      },
    };
    const { m, d } = await aufbau({ telegram: api, env: { TELEGRAM_CHAT_ID: '1' } });
    await d.uni.abgleichen();
    expect(texte).toHaveLength(1);
    expect(texte[0]).toMatch(/🎓 <b>Neu in Moodle:<\/b> 4 Dateien, 3 Abgaben/);
    expect(texte[0]).toContain('Übung 1 (Computational Data Analytics) – Frist');
    await d.uni.abgleichen();
    expect(texte).toHaveLength(1); // nichts Neues → keine Meldung

    m.s.funktionen = m.s.funktionen.filter((f) => f !== 'core_course_get_contents');
    await d.uni.abgleichen();
    await d.uni.abgleichen();
    expect(texte.filter((t) => t.includes('Moodle-Abgleich fehlgeschlagen'))).toHaveLength(1);
  });

  it('HTTP: Übersicht nur angemeldet, „Jetzt abgleichen“ startet den Abgleich', async () => {
    const { d } = await aufbau();
    expect((await d.app.inject({ url: '/api/uni' })).statusCode).toBe(401);
    await passwortSetzen(d.db, d.uhr, 'ein-sehr-langes-Passwort-42');
    const r = await d.app.inject({ method: 'POST', url: '/api/anmeldung', headers: { origin: ORIGIN }, payload: { passwort: 'ein-sehr-langes-Passwort-42' } });
    const h = { origin: ORIGIN, cookie: cookieAus(r.headers['set-cookie']) };
    const vor = (await d.app.inject({ url: '/api/uni', headers: h })).json();
    expect(vor).toMatchObject({ verbunden: true, letzter: null, kurse: [], fristen: [] });
    expect((await d.app.inject({ method: 'POST', url: '/api/uni/abgleichen', headers: h })).json()).toEqual({ gestartet: true });
    await d.uni.abgleichen();
    const nach = (await d.app.inject({ url: '/api/uni', headers: h })).json();
    expect(nach.kurse.map((k: { name: string }) => k.name)).toEqual(['Computational Data Analytics', 'Statistik / UE']);
    expect(nach.fristen).toHaveLength(4);
    expect(JSON.stringify(nach)).not.toContain(TOKEN);
  });
});
