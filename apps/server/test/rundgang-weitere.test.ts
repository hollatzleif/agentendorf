import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { budgetWahl, faelligeAktivitaeten, KATALOG, kostenVon, RUNDGANG_PFAD, rundgangEinstellungen, type RundgangQuellen } from '../src/rundgang.js';
import { fachZuFrist, mailFristTag, tagBeginn, vormonat, WEITERE_AKTIVITAETEN } from '../src/rundgang-aktivitaeten.js';
import { BUERGERMEISTER_WERKZEUGE, RECHENRAUM_WERKZEUGE, werkzeugprofil } from '../src/agenten/leine.js';
import { WERKZEUG_DEFINITIONEN } from '../src/agenten/werkzeuge.js';
import type { KalenderEintrag } from '../src/agenten/werkzeuge.js';
import { testDorf } from './hilfen.js';

/**
 * E200: die übrigen Aktivitäten des Rundgangs. Je Aktivität: Fakten-Sammler ohne KI mit und ohne Anlass (und ohne
 * Wiederholung desselben Anlasses), dazu Auswahl, Kosten-Einstellung, Leine und ein Rundgang mit der Attrappe.
 * TestUhr: Mo, 16.11.2026 12:00 UTC = 13:00 in Wien.
 */
const STUNDE = 3_600_000;
const TAG = 24 * STUNDE;
const JETZT = Date.UTC(2026, 10, 16, 12);
const w = (n: string, e: unknown) => `<<werkzeug ${n} ${JSON.stringify(e)}>>`;

async function aufbau() {
  const d = await testDorf();
  const rg = d.aufwachen.rundgang;
  /** die echten Quellen des Rundgangs (so, wie dorf.ts sie verdrahtet) */
  const q = (rg as unknown as { q: RundgangQuellen }).q;
  const fakten = (id: string, seit = 0) => KATALOG.find((a) => a.id === id)!.fakten!(q, seit);
  const frist = (id: string, f: { titel: string; art: string; frist: number; kurs?: string; pfad?: string; abgegeben?: boolean }) =>
    d.db
      .prepare("INSERT INTO moodle_fristen (id, kurs_id, kurs, titel, art, frist, url, pfad, abgegeben, gesehen) VALUES (?, NULL, ?, ?, ?, ?, '', ?, ?, ?)")
      .run(`x:${id}`, f.kurs ?? '', f.titel, f.art, f.frist, f.pfad ?? null, f.abgegeben ? 1 : 0, JETZT);
  const mail = (id: string, von: string, betreff: string, o: { datum?: number; wichtig?: boolean; frist?: string; eingeordnet?: number; rechnung?: string; kategorie?: string } = {}) =>
    d.db
      .prepare('INSERT INTO post_mails (id, thread_id, von, betreff, datum, kategorie, wichtig, antwort_noetig, zusammenfassung, frist, eingeordnet, rechnung_todo) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)')
      .run(id, `t-${id}`, von, betreff, o.datum ?? d.uhr.jetzt(), o.kategorie ?? 'Uni', o.wichtig ? 1 : 0, 'Zusammenfassung', o.frist ?? null, o.eingeordnet ?? d.uhr.jetzt(), o.rechnung ?? null);
  /** Kalender für den Rundgang nachstellen */
  const kalender = (t: KalenderEintrag[]) => rg.ergaenzen({ kalender: async (von, bis) => t.filter((x) => x.start < bis && (x.ende ?? x.start) >= von) });
  /** Datei im Vault alt machen (Änderungszeit) */
  const alt = (rel: string, ms: number) => fs.utimesSync(path.join(d.konfig.vaultDir, rel), new Date(ms), new Date(ms));
  const rundgangMd = async (kopf: string) => {
    const a = await d.vault.lesen(RUNDGANG_PFAD);
    await d.vault.schreiben(RUNDGANG_PFAD, `---\n${kopf}\n---\n\nText\n`, { basisVersion: a.version });
  };
  /** alle Aktivitäten aus, außer den genannten */
  const nur = (...ids: string[]) => rundgangMd(`aktivitaeten:\n${KATALOG.filter((a) => !ids.includes(a.id)).map((a) => `  ${a.id}: aus`).join('\n')}`);
  return { d, q, rg, fakten, frist, mail, kalender, alt, rundgangMd, nur };
}

describe('E200: Katalog, Leine und Vorlage', () => {
  it('22 neue Aktivitäten, nach Nutzen sortiert; jede mit Fakten-Sammler – Web nur groß und nur tagsüber', () => {
    expect(WEITERE_AKTIVITAETEN).toHaveLength(22);
    expect(KATALOG.slice(18).map((a) => a.id)).toEqual(WEITERE_AKTIVITAETEN.map((a) => a.id));
    expect(WEITERE_AKTIVITAETEN.slice(0, 4).map((a) => a.id)).toEqual(['wartet-nachfassen', 'mail-fristen', 'abgaben-nachlese', 'pruefungs-countdown']);
    for (const a of WEITERE_AKTIVITAETEN) {
      // kein Anlass → kein KI-Lauf: jede neue Aktivität prüft vorher ohne KI
      expect(a.fakten, a.id).toBeTypeOf('function');
      if (/im Web|Recherchiere/.test(a.auftrag)) expect(a, a.id).toMatchObject({ gewicht: 'gross', nachts: false });
      else expect(a.nachts, a.id).toBe(true);
    }
    // die Kosten-Gewichte (E192): höchstens eine große je Monat (JKU) – die meisten klein
    expect(WEITERE_AKTIVITAETEN.filter((a) => a.gewicht === 'gross').map((a) => a.id)).toEqual(['jku-fristen']);
    expect(WEITERE_AKTIVITAETEN.filter((a) => a.gewicht === 'klein').length).toBeGreaterThanOrEqual(17);
  });

  it('Leine: jede Aktivität nennt nur Werkzeuge, die der Bürgermeister hat – nie Senden, Termine, Wecker oder Rückfragen', () => {
    const profil = werkzeugprofil({ werkzeuge: ['vault_lesen', 'vault_suchen', 'vault_schreiben'], fremdinhalte: false });
    const erlaubt = new Set<string>([...profil.dorf, ...BUERGERMEISTER_WERKZEUGE, ...RECHENRAUM_WERKZEUGE]);
    const bekannt = new Set(Object.keys(WERKZEUG_DEFINITIONEN));
    const verboten = /\b(termin_anlegen|termin_aendern|termin_loeschen|kirchturm_timer|kirchturm_wecker|pomodoro|rueckfrage|plan_vorlegen|persoenlichkeit_vorschlagen|freigabe_beantragen)\b/;
    for (const a of KATALOG) {
      for (const m of a.auftrag.matchAll(/\b([a-z]+_[a-z_]+)\b/g)) {
        if (!bekannt.has(m[1]!)) continue; // z. B. „wieder_am“ ist ein Feld, kein Werkzeug
        expect(erlaubt.has(m[1]!), `${a.id}: ${m[1]}`).toBe(true);
      }
      expect(a.auftrag, a.id).not.toMatch(verboten);
      expect(a.auftrag, a.id).not.toMatch(/\b(sende|abschicken|bezahle|überweise|reiche .* ein)\b/i);
    }
    // gelöscht wird nur beim Zusammenführen von Dubletten (Papierkorb)
    expect(KATALOG.filter((a) => /todo_loeschen/.test(a.auftrag)).map((a) => a.id)).toEqual(['todos-doppelt']);
    // Helfer nur, wo die Aktivität es ausdrücklich vorsieht
    expect(KATALOG.filter((a) => /helfer_starten|EINEN Helfer/.test(a.auftrag)).map((a) => a.id).sort()).toEqual(['helfer-gegenlesen', 'karteikarten-luecken', 'moodle-neues']);
  });

  it('Leine im echten Lauf: Rathaus-Ablage und Steckbriefe gehen direkt (mit „Rückgängig“), außerhalb des Rathauses nicht; Dauer nur als Feld', async () => {
    const x = await aufbau();
    const { d } = x;
    await d.vault.schreiben('Rathaus/vorbereitung/2026-09-01_1200_alt.md', '# alt\n');
    await d.vault.schreiben('Uni/moodle/folie.md', '# Folie\n');
    const t = await d.todos.anlegen({ titel: 'Referat vorbereiten', faellig: '2026-11-18' }, 'Leif');
    const text = [
      w('vault_verschieben', { von: 'Rathaus/vorbereitung/2026-09-01_1200_alt.md', nach: 'Rathaus/ablage/2026-09/2026-09-01_1200_alt.md' }),
      w('vault_verschieben', { von: 'Uni/moodle/folie.md', nach: 'Uni/faecher/folie.md' }),
      w('vault_schreiben', { pfad: 'Rathaus/wissen/faecher.md', inhalt: '| Fach |' }),
      w('vault_schreiben', { pfad: 'Rathaus/wissen/2026-11-16_1300_faecher.md', inhalt: '| Fach | Lehrende |\n|---|---|\n| Statistik | unbekannt |' }),
      w('todo_bearbeiten', { pfad: t.pfad, dauer: 45 }),
      w('kontakt_merken', { name: 'Anna Leemhuis', adresse: 'anna.leemhuis@jku.at', rolle: 'Lehrende CDA, JKU' }),
    ].join('\n');
    const a = await d.schreibtisch.anlegen({ text: `Rundgang-Test\n${text}`, quelle: 'aufwachen' });
    const r = await d.buergermeister.starten(a.id, 'zeitplan');
    await d.agenten.leerlauf();
    const ergebnisse = d.agenten
      .chatDetail(r.chatId)
      .nachrichten.filter((n) => n.rolle === 'werkzeug')
      .map((n) => n.text);
    expect(ergebnisse[0]).not.toMatch(/verweigert/i);
    expect(await d.vault.existiert('Rathaus/ablage/2026-09/2026-09-01_1200_alt.md')).toBe(true);
    expect(ergebnisse[1]).toMatch(/nur im eigenen Gebäude/);
    expect(await d.vault.existiert('Uni/moodle/folie.md')).toBe(true);
    expect(ergebnisse[2]).toMatch(/Schema/);
    expect(await d.vault.existiert('Rathaus/wissen/2026-11-16_1300_faecher.md')).toBe(true);
    expect((await d.todos.holen(t.pfad)).dauer).toBe(45);
    expect((await d.vault.lesen('Rathaus/kontakte.md')).inhalt).toContain('anna.leemhuis@jku.at');
    // die Verschiebung im Rathaus kann Leif zurücknehmen
    expect((d.db.prepare("SELECT COUNT(*) AS n FROM rueckgaengig WHERE chat_id = ? AND status = 'offen'").get(r.chatId) as { n: number }).n).toBeGreaterThanOrEqual(1);
    await d.app.close();
  });

  it('Vorlage: nennt alle 40 mit Standard-Häufigkeit und die Kosten je Gewicht; die ausgelieferte Fassung (E192) wird ersetzt, Leifs eigene nicht', async () => {
    const x = await aufbau();
    const { e, fehler } = await rundgangEinstellungen(x.d.vault);
    expect(fehler).toBeNull();
    expect(e.kosten_usd).toEqual({ klein: 0.08, mittel: 0.25, gross: 0.8 });
    for (const a of WEITERE_AKTIVITAETEN) expect(e.aktivitaeten[a.id], a.id).toBe(a.haeufigkeit);
    const vorlage = fs.readFileSync(path.join(x.d.konfig.vorlageDir, RUNDGANG_PFAD), 'utf8');
    for (const a of KATALOG) expect(vorlage, a.id).toContain(`| \`${a.id}\` |`);
    // dorf.ts kennt den Hash der Fassung aus E192 (alter Stand aus git) – nur die wird beim Start ersetzt
    const quelle = fs.readFileSync(path.join(import.meta.dirname, '../src/dorf.ts'), 'utf8');
    expect(quelle).toMatch(/'00_Stadtordnung\/rundgang\.md': \['60d05e9a34a9e8acce98164fed4eceea9ce8378ec38696613546e08c94697fb8'\]/);
    await x.d.app.close();
  });
});

describe('E200: Auswahl und Kosten', () => {
  it('Kosten je Gewicht aus rundgang.md: steuern die Auswahl nach Restbudget; die App zeigt sie', async () => {
    const a = (id: string, gewicht: 'klein' | 'mittel' | 'gross') => ({ ...WEITERE_AKTIVITAETEN[0]!, id, gewicht });
    const liste = [a('k1', 'klein'), a('k2', 'klein'), a('k3', 'klein')];
    expect(budgetWahl(liste, { restbudget: 2, tagesbudget: 5, max: 3 }).length).toBe(3);
    // klein kostet laut Leif 1 $: von 2 $ Rest bleiben nach 10 % Reserve 1,50 $ → nur eine
    expect(budgetWahl(liste, { restbudget: 2, tagesbudget: 5, max: 3, kosten: kostenVon({ kosten_usd: { klein: 1 } }) }).map((x) => x.id)).toEqual(['k1']);
    expect(kostenVon({ kosten_usd: { gross: 1.5 } })).toEqual({ klein: 0.08, mittel: 0.25, gross: 1.5 });
    const x = await aufbau();
    await x.rundgangMd('kosten_usd:\n  klein: 0.12\n  gross: 1.2');
    expect((await x.rg.uebersicht()).kosten).toEqual({ klein: 0.12, mittel: 0.25, gross: 1.2 });
    await x.d.app.close();
  });

  it('waehlen: Rang nach Nutzen, Nacht ohne Web, Budget (mittel ab einem Viertel, groß ab der Hälfte), „aus“ = nie', async () => {
    const x = await aufbau();
    const { d } = x;
    await x.nur('wartet-nachfassen', 'dauer-schaetzen', 'jku-fristen');
    await d.todos.anlegen({ titel: 'Antwort Prüfungsamt', faellig: '2026-11-16', wartet: 'Prüfungsamt' }, 'Leif');
    await d.todos.anlegen({ titel: 'Referat', faellig: '2026-11-18' }, 'Leif');
    await d.todos.anlegen({ titel: 'Hausübung', faellig: '2026-11-19' }, 'Leif');
    const ids = async (restbudget: number, nacht = false) => {
      d.db.prepare("DELETE FROM dorf_stand WHERE schluessel IN ('rundgang_zuletzt', 'rundgang_geprueft')").run();
      return (await x.rg.waehlen({ restbudget, tagesbudget: 5, nacht })).map((w) => w.aktivitaet.id);
    };
    expect(await ids(5)).toEqual(['wartet-nachfassen', 'dauer-schaetzen']);
    expect(await ids(1)).toEqual(['dauer-schaetzen']); // unter einem Viertel: keine mittlere
    await x.nur('dauer-schaetzen', 'jku-fristen');
    expect(await ids(5)).toEqual(['dauer-schaetzen', 'jku-fristen']);
    expect(await ids(5, true)).toEqual(['dauer-schaetzen']); // nachts kein Web
    expect(await ids(2.4)).toEqual(['dauer-schaetzen']); // unter der Hälfte: keine große
    // gewählt = gemacht: die JKU-Recherche kommt erst nach einem Monat wieder
    const zuletzt = { 'jku-fristen': d.uhr.jetzt() - 20 * TAG };
    const e = (await rundgangEinstellungen(d.vault)).e;
    expect(faelligeAktivitaeten({ katalog: KATALOG, e, zuletzt, jetzt: d.uhr.jetzt(), nacht: false }).map((a) => a.id)).toEqual(['dauer-schaetzen']);
    await d.app.close();
  });

  it('Rundgang mit der Attrappe: neue Aktivitäten im Auftrag (Fakten in der Hülle), Protokoll mit echten Kosten, kein Telegram', async () => {
    const x = await aufbau();
    const { d } = x;
    await x.nur('wartet-nachfassen', 'dauer-schaetzen');
    await d.todos.anlegen({ titel: 'Antwort Prüfungsamt', faellig: '2026-11-16', wartet: 'Prüfungsamt' }, 'Leif');
    await d.todos.anlegen({ titel: 'Referat', faellig: '2026-11-18' }, 'Leif');
    await d.todos.anlegen({ titel: 'Hausübung', faellig: '2026-11-19' }, 'Leif');
    const r = await d.aufwachen.aufwachen();
    expect(r).toMatchObject({ lagebericht: null, aktivitaeten: ['wartet-nachfassen', 'dauer-schaetzen'] });
    await d.agenten.leerlauf();
    const notiz = (await d.vault.lesen(d.schreibtisch.holen(r.rundgang!).pfad)).inhalt;
    expect(notiz).toContain('### A – „Wartet auf …“ nachfassen');
    expect(notiz).toContain('### B – Dauer schätzen');
    expect(notiz).toContain('<fremdinhalt quelle="rundgang-wartet-nachfassen">');
    expect(notiz).toMatch(/„Antwort Prüfungsamt“ – wartet auf Prüfungsamt seit 2026-11-16 – Nachfass-Tag 2026-11-16 – Marktplatz\/todos\//);
    expect(notiz).toContain('NUR das Feld dauer');
    const lauf = d.db.prepare("SELECT kosten_usd FROM laeufe WHERE ausloeser = 'zeitplan' ORDER BY erstellt DESC LIMIT 1").get() as { kosten_usd: number };
    const protokoll = (await d.vault.lesen('Rathaus/rundgang/2026-11-16.md')).inhalt;
    expect(protokoll).toContain(`Aktivitäten: „Wartet auf …“ nachfassen, Dauer schätzen · Kosten: ${lauf.kosten_usd.toFixed(2).replace('.', ',')} $ · Getan:`);
    // ein zweiter Rundgang gleich danach: nichts Fälliges mehr, kein Lauf
    d.uhr.vor(4 * STUNDE);
    expect((await d.aufwachen.aufwachen()).rundgang).toBeNull();
    await d.app.close();
  });
});

describe('E200: Fakten-Sammler (ohne KI) – mit und ohne Anlass', () => {
  it('Hilfen: Frist-Tag aus Mails, Vormonat, Tagesbeginn in Wien, Fach zu einer Frist', () => {
    expect(mailFristTag('3.12.2026 14:00')).toBe('2026-12-03');
    expect(mailFristTag('bald')).toBeNull();
    expect(vormonat('2026-01-05')).toBe('2025-12');
    expect(vormonat('2026-11-16')).toBe('2026-10');
    expect(tagBeginn('2026-11-16')).toBe(Date.UTC(2026, 10, 15, 23));
    expect(tagBeginn('2026-07-01')).toBe(Date.UTC(2026, 5, 30, 22));
    const faecher = [
      { name: 'Statistik', titel: 'Statistik 1 (VL)', ordner: 'Uni/faecher/Statistik', moodleUrl: null },
      { name: 'CDA', titel: 'Computational Data Analytics', ordner: 'Uni/faecher/CDA', moodleUrl: null },
    ];
    expect(fachZuFrist(faecher, { pfad: 'Uni/faecher/CDA/aufgaben/u3', kurs: '', titel: 'x' })?.name).toBe('CDA');
    expect(fachZuFrist(faecher, { pfad: null, kurs: 'Statistik 1 (VL)', titel: 'Klausur' })?.name).toBe('Statistik');
    expect(fachZuFrist(faecher, { pfad: null, kurs: '', titel: 'CDA: Übung 3 ist fällig' })?.name).toBe('CDA');
    expect(fachZuFrist(faecher, { pfad: null, kurs: '', titel: 'Mensa' })).toBeNull();
  });

  it('wartet-nachfassen: nur am Nachfass-Tag; nach einem Entwurf erst nach einer Woche wieder', async () => {
    const x = await aufbau();
    expect(await x.fakten('wartet-nachfassen')).toBeNull();
    await x.d.todos.anlegen({ titel: 'Später', faellig: '2026-11-20', wartet: 'Tutorin' }, 'Leif');
    await x.d.todos.anlegen({ titel: 'Ohne Warten', faellig: '2026-11-10' }, 'Leif');
    expect(await x.fakten('wartet-nachfassen')).toBeNull();
    const t = await x.d.todos.anlegen({ titel: 'Zusage Praktikum', faellig: '2026-11-15', wartet: 'Firma Huber' }, 'Leif');
    expect(await x.fakten('wartet-nachfassen')).toEqual([`„Zusage Praktikum“ – wartet auf Firma Huber seit 2026-11-16 – Nachfass-Tag 2026-11-15 – ${t.pfad}`]);
    await x.d.todos.aendern(t.pfad, { notiz: 'Nachfass-Entwurf 2026-11-16 liegt in Gmail bereit (an huber@example.com)' });
    expect(await x.fakten('wartet-nachfassen')).toBeNull();
    x.d.uhr.vor(8 * TAG);
    expect(await x.fakten('wartet-nachfassen')).toHaveLength(2); // jetzt auch „Später“
    await x.d.app.close();
  });

  it('mail-fristen: erkannte Frist ohne To-do; vergangene, Rechnungen, schon notierte und schon gesehene zählen nicht', async () => {
    const x = await aufbau();
    expect(await x.fakten('mail-fristen')).toBeNull();
    x.mail('m-alt', 'ÖH <oeh@jku.at>', 'Frist vorbei', { frist: '01.11.2026' });
    x.mail('m-rechnung', 'Strom <rechnung@strom.at>', 'Rechnung', { frist: '30.11.2026', rechnung: 'Marktplatz/todos/x.md' });
    x.mail('m-ohne', 'Shop <shop@x.de>', 'Angebot', { frist: '' });
    expect(await x.fakten('mail-fristen')).toBeNull();
    x.mail('m1', 'Prüfungsamt <pa@jku.at>', 'Anmeldung Klausur Statistik', { frist: '24.11.2026 23:59', wichtig: true });
    expect(await x.fakten('mail-fristen')).toEqual(['Frist 24.11.2026 23:59 · Prüfungsamt ‹pa@jku.at› – „Anmeldung Klausur Statistik“ (mail_id m1)']);
    // schon ein To-do mit dem Betreff → kein Anlass
    await x.d.todos.anlegen({ titel: 'Zur Klausur anmelden', notiz: 'Anmeldung Klausur Statistik (mail_id m1)' }, 'Bürgermeister');
    expect(await x.fakten('mail-fristen')).toBeNull();
    // seit dem letzten Lauf nichts Neues eingeordnet → kein Anlass
    x.mail('m2', 'Corps <senior@corps.at>', 'Anmeldung Stiftungsfest', { frist: '05.12.2026' });
    expect(await x.fakten('mail-fristen', JETZT + 1)).toBeNull();
    expect(await x.fakten('mail-fristen')).toHaveLength(1);
    await x.d.app.close();
  });

  it('abgaben-nachlese: 1,5–7 Tage nach der Frist und To-do offen; abgegeben, abgehakt oder schon nachgelesen zählt nicht', async () => {
    const x = await aufbau();
    expect(await x.fakten('abgaben-nachlese')).toBeNull();
    const uniTodo = async (id: string, titel: string, frist: number, o: { abgegeben?: boolean; art?: string } = {}) => {
      x.frist(id, { titel, art: o.art ?? 'abgabe', frist, kurs: 'CDA', abgegeben: o.abgegeben });
      const t = await x.d.todos.anlegen({ titel, faellig: '2026-11-13' }, 'Uni');
      x.d.db.prepare('INSERT INTO uni_todos (frist_id, pfad, frist, erledigt) VALUES (?, ?, ?, 0)').run(`x:${id}`, t.pfad, frist);
      return t;
    };
    const t = await uniTodo('u3', 'Übung 3', JETZT - 3 * TAG);
    await uniTodo('u4', 'Übung 4', JETZT - 1 * TAG); // zu frisch
    await uniTodo('u1', 'Übung 1', JETZT - 9 * TAG); // zu alt
    await uniTodo('u2', 'Übung 2', JETZT - 4 * TAG, { abgegeben: true });
    expect(await x.fakten('abgaben-nachlese')).toEqual([`Abgabe „Übung 3“ (CDA) – Frist war Fr., 13.11.2026, 13:00 – To-do noch offen: ${t.pfad}`]);
    await x.d.todos.aendern(t.pfad, { notiz: 'Nachlese 2026-11-16: keine Abgabe gefunden' });
    expect(await x.fakten('abgaben-nachlese')).toBeNull();
    const p = await uniTodo('k1', 'Klausur Statistik', JETZT - 2 * TAG, { art: 'test' });
    expect((await x.fakten('abgaben-nachlese'))![0]).toMatch(/^Prüfung „Klausur Statistik“/);
    await x.d.todos.aendern(p.pfad, { erledigt: true });
    expect(await x.fakten('abgaben-nachlese')).toBeNull();
    await x.d.app.close();
  });

  it('pruefungs-countdown: Stufen 14, 7 und 3 Tage – jede nur einmal; Abgaben und der letzte Tag nicht', async () => {
    const x = await aufbau();
    expect(await x.fakten('pruefungs-countdown')).toBeNull();
    x.frist('a', { titel: 'Abgabe Projekt', art: 'abgabe', frist: JETZT + 13 * TAG });
    x.frist('morgen', { titel: 'Quiz', art: 'test', frist: JETZT + 12 * STUNDE });
    expect(await x.fakten('pruefungs-countdown')).toBeNull();
    x.frist('k', { titel: 'Klausur Statistik', art: 'test', frist: JETZT + 13.5 * TAG, kurs: 'Statistik' });
    expect((await x.fakten('pruefungs-countdown'))![0]).toMatch(/^Prüfung „Klausur Statistik“ \(Statistik\) – .+ · Stufe: 14 Tage vorher$/);
    // der letzte Lauf war schon in dieser Stufe → nichts
    expect(await x.fakten('pruefungs-countdown', JETZT - 6 * STUNDE)).toBeNull();
    expect(await x.fakten('pruefungs-countdown', JETZT - 1 * TAG)).toHaveLength(1);
    // eine Woche später: Stufe 7, obwohl Stufe 14 gemacht wurde
    x.d.uhr.vor(7 * TAG);
    expect((await x.fakten('pruefungs-countdown', JETZT))![0]).toContain('Stufe: 7 Tage vorher');
    x.d.uhr.vor(4 * TAG);
    expect((await x.fakten('pruefungs-countdown', JETZT + 7 * TAG))![0]).toContain('Stufe: 3 Tage vorher');
    await x.d.app.close();
  });

  it('helfer-gegenlesen: fertiger Helfer ohne Datei oder mit fast leerer Datei; brauchbare, alte und reine Antwort-Helfer nicht', async () => {
    const x = await aufbau();
    const { d } = x;
    expect(await x.fakten('helfer-gegenlesen')).toBeNull();
    const chat = d.db.prepare(
      "INSERT INTO chats (id, gebaeude, aktion, titel, motor, stufe, modell, werkzeuge_json, erstellt, geaendert, eltern_chat_id) VALUES (?, 'Uni', ?, ?, 'claude-code', 'mittel', 'm', ?, ?, ?, ?)",
    );
    const lauf = d.db.prepare("INSERT INTO laeufe (id, chat_id, nummer, motor, modell, stufe, aufwand, status, ausloeser, auftrag, erstellt, ende) VALUES (?, ?, 1, 'claude-code', 'm', 'mittel', 'low', 'fertig', 'buergermeister', 'x', ?, ?)");
    const datei = d.db.prepare("INSERT INTO werkzeug_log (lauf_id, chat_id, werkzeug, eingabe_json, ergebnis, erlaubt, pfad, art, zeit) VALUES (?, ?, 'vault_schreiben', '{}', 'ok', 1, ?, 'geschrieben', ?)");
    const helfer = (id: string, titel: string, w: string[], ende: number) => {
      chat.run(id, 'Uni/karten-erstellen', titel, JSON.stringify(w), ende - STUNDE, ende, 'eltern');
      lauf.run(`l-${id}`, id, ende - STUNDE, ende);
    };
    helfer('h1', 'Karten Statistik', ['vault_lesen', 'vault_schreiben'], JETZT - STUNDE);
    helfer('h2', 'Nur eine Auskunft', ['vault_lesen'], JETZT - STUNDE);
    helfer('h3', 'Alter Helfer', ['vault_schreiben'], JETZT - 3 * TAG);
    helfer('h4', 'Lernzettel CDA', ['vault_schreiben'], JETZT - STUNDE);
    helfer('h5', 'Gute Zusammenfassung', ['vault_schreiben'], JETZT - STUNDE);
    await d.vault.schreiben('Uni/2026-11-16_1200_lernzettel.md', '---\ntitel: Lernzettel\n---\n# Lernzettel\n');
    await d.vault.schreiben('Uni/2026-11-16_1200_gut.md', `# Gut\n\n${'Inhalt mit Substanz. '.repeat(20)}`);
    datei.run('l-h4', 'h4', 'Uni/2026-11-16_1200_lernzettel.md', JETZT - STUNDE);
    datei.run('l-h5', 'h5', 'Uni/2026-11-16_1200_gut.md', JETZT - STUNDE);
    expect(await x.fakten('helfer-gegenlesen')).toEqual([
      '„Karten Statistik“ (Uni, Uni/karten-erstellen) – fertig, aber keine Datei abgelegt',
      '„Lernzettel CDA“ (Uni, Uni/karten-erstellen) – Datei fast leer (12 Zeichen): Uni/2026-11-16_1200_lernzettel.md',
    ]);
    // schon beim letzten Rundgang gesehen → nicht noch einmal
    expect(await x.fakten('helfer-gegenlesen', JETZT)).toBeNull();
    await d.app.close();
  });

  it('volle-tage: über 6 Stunden Termine und fällige To-dos an morgen/übermorgen; schon angesehene Tage nicht noch einmal', async () => {
    const x = await aufbau();
    const morgen = tagBeginn('2026-11-17');
    const um = (h: number) => morgen + h * STUNDE;
    x.kalender([
      { start: um(8), ende: um(12), ganztags: false, titel: 'Vorlesung', quelle: 'Kalender' },
      { start: um(11), ende: um(13), ganztags: false, titel: 'Übung', quelle: 'Kalender' }, // überschneidet sich – zählt nur einmal
      { start: um(0), ende: um(24), ganztags: true, titel: 'Geburtstag Oma', quelle: 'Kalender' },
    ]);
    expect(await x.fakten('volle-tage')).toBeNull(); // 5 h
    await x.d.todos.anlegen({ titel: 'Lernen', faellig: '2026-11-17', dauer: 45 }, 'Leif');
    expect(await x.fakten('volle-tage')).toBeNull(); // 5:45 h
    await x.d.todos.anlegen({ titel: 'Wäsche', faellig: '2026-11-17' }, 'Leif'); // ohne Schätzung: 30 min
    const f = (await x.fakten('volle-tage'))!;
    expect(f[0]).toBe('Di 2026-11-17: 6:15 h – Termine 5:00 h, 2 fällige To-dos (~1:15 h)');
    expect(f.join('\n')).toContain('To-do „Wäsche“ (ohne Schätzung: 30 min)');
    // der Rundgang von heute früh hat morgen und übermorgen schon angesehen
    expect(await x.fakten('volle-tage', JETZT - 5 * STUNDE)).toBeNull();
    // ein Tag später: nur der neue Tag (übermorgen) zählt – der ist leer
    expect(await x.fakten('volle-tage', JETZT - TAG)).toBeNull();
    await x.d.app.close();
  });

  it('dauer-schaetzen: mindestens zwei To-dos der nächsten 7 Tage ohne Schätzung; Überfälliges und Geschätztes nicht', async () => {
    const x = await aufbau();
    await x.d.todos.anlegen({ titel: 'Überfällig', faellig: '2026-11-10' }, 'Leif');
    await x.d.todos.anlegen({ titel: 'Nächsten Monat', faellig: '2026-12-20' }, 'Leif');
    await x.d.todos.anlegen({ titel: 'Geschätzt', faellig: '2026-11-17', dauer: 30 }, 'Leif');
    const t = await x.d.todos.anlegen({ titel: 'Referat', faellig: '2026-11-18' }, 'Leif');
    expect(await x.fakten('dauer-schaetzen')).toBeNull(); // nur eines
    await x.d.todos.anlegen({ titel: 'Hausübung', faellig: '2026-11-16' }, 'Leif');
    expect(await x.fakten('dauer-schaetzen')).toEqual(expect.arrayContaining([`„Referat“ – fällig 2026-11-18 – ${t.pfad}`]));
    expect(await x.fakten('dauer-schaetzen')).toHaveLength(2);
    await x.d.app.close();
  });

  it('altklausuren: Prüfung in 3–45 Tagen, altklausuren/ leer, noch kein To-do', async () => {
    const x = await aufbau();
    await x.d.uni.fachAnlegen('Statistik');
    expect(await x.fakten('altklausuren')).toBeNull();
    x.frist('spaet', { titel: 'Klausur Statistik', art: 'test', frist: JETZT + 60 * TAG, kurs: 'Statistik' });
    expect(await x.fakten('altklausuren')).toBeNull();
    x.frist('k', { titel: 'Klausur Statistik', art: 'test', frist: JETZT + 20 * TAG, kurs: 'Statistik' });
    expect((await x.fakten('altklausuren'))![0]).toMatch(/^Statistik: Prüfung „Klausur Statistik“ – .+ · Uni\/faecher\/Statistik\/altklausuren\/ ist leer$/);
    const t = await x.d.todos.anlegen({ titel: 'Altklausuren besorgen: Statistik' }, 'Bürgermeister');
    expect(await x.fakten('altklausuren')).toBeNull();
    await x.d.todos.loeschen(t.pfad);
    await x.d.vault.schreiben('Uni/faecher/Statistik/altklausuren/2024.md', '# 2024\n');
    expect(await x.fakten('altklausuren')).toBeNull();
    await x.d.app.close();
  });

  it('moodle-neues: nur mit Moodle-Browser und Aktion; Fach mit der nächsten Frist, letzte Durchsicht älter als 6 Tage', async () => {
    const x = await aufbau();
    await x.d.uni.fachAnlegen('Statistik');
    x.frist('u', { titel: 'Übung 5', art: 'abgabe', frist: JETZT + 4 * TAG, kurs: 'Statistik' });
    expect(await x.fakten('moodle-neues')).toBeNull(); // kein Browser eingerichtet
    x.rg.ergaenzen({ moodleBereit: () => true });
    expect(await x.fakten('moodle-neues')).toEqual(['Fach (Ordnername): Statistik', expect.stringMatching(/^Nächste Frist: „Übung 5“ – /), 'Letzte Durchsicht: noch nie']);
    const chat = x.d.db.prepare("INSERT INTO chats (id, gebaeude, aktion, titel, motor, stufe, modell, eingaben_json, erstellt, geaendert) VALUES (?, 'Uni', 'Uni/moodle-durchsehen', 'Moodle', 'claude-code', 'mittel', 'm', ?, ?, ?)");
    chat.run('c1', JSON.stringify({ fach: 'Statistik' }), JETZT - 8 * TAG, JETZT - 8 * TAG);
    expect((await x.fakten('moodle-neues'))![2]).toBe('Letzte Durchsicht: 2026-11-08');
    chat.run('c2', JSON.stringify({ fach: 'Statistik', frage: '' }), JETZT - 2 * TAG, JETZT - 2 * TAG);
    expect(await x.fakten('moodle-neues')).toBeNull();
    await x.d.app.close();
  });

  it('wochenvorschau: nur Samstagmittag bis Montag 10 Uhr, nur wenn etwas ansteht und es noch keine gibt', async () => {
    const x = await aufbau();
    await x.d.todos.anlegen({ titel: 'Referat halten', faellig: '2026-11-24', dauer: 90 }, 'Leif');
    x.kalender([{ start: tagBeginn('2026-11-25') + 10 * STUNDE, ende: tagBeginn('2026-11-25') + 12 * STUNDE, ganztags: false, titel: 'Sprechstunde', quelle: 'Kalender' }]);
    expect(await x.fakten('wochenvorschau')).toBeNull(); // Montag 13 Uhr
    x.d.uhr.vor(5 * TAG - 2 * STUNDE); // Samstag 11 Uhr
    expect(await x.fakten('wochenvorschau')).toBeNull();
    x.d.uhr.vor(2 * STUNDE); // Samstag 13 Uhr
    const f = (await x.fakten('wochenvorschau'))!;
    expect(f[0]).toBe('Woche 2026-KW48: 2026-11-23 bis 2026-11-29 – Dateiname endet auf „_wochenvorschau-2026-kw48.md“');
    expect(f).toContain('Di 2026-11-24: 0 Termine (0:00 h), 1 To-dos (~1:30 h)');
    expect(f).toContain('Mi 2026-11-25: 1 Termine (2:00 h), 0 To-dos (~0:00 h)');
    await x.d.vault.schreiben('Rathaus/vorbereitung/2026-11-21_1300_wochenvorschau-2026-kw48.md', '# Vorschau\n');
    expect(await x.fakten('wochenvorschau')).toBeNull();
    await x.d.app.close();
  });

  it('adressbuch-pflegen: wichtige Absender mit mindestens zwei Mails, nicht im Adressbuch, keine Automaten', async () => {
    const x = await aufbau();
    expect(await x.fakten('adressbuch-pflegen')).toBeNull();
    x.mail('a1', '"Leemhuis, Anna" <Anna.Leemhuis@jku.at>', 'Übung 4', { wichtig: true, datum: JETZT - 3 * TAG });
    x.mail('n1', 'JKU <noreply@jku.at>', 'Info', { wichtig: true });
    x.mail('n2', 'JKU <noreply@jku.at>', 'Info 2', { wichtig: true });
    x.mail('e1', 'Einmal <einmal@x.at>', 'Einmal', { wichtig: true });
    x.mail('u1', 'Shop <shop@x.at>', 'Werbung');
    x.mail('u2', 'Shop <shop@x.at>', 'Werbung 2');
    expect(await x.fakten('adressbuch-pflegen')).toBeNull();
    x.mail('a2', '"Leemhuis, Anna" <anna.leemhuis@jku.at>', 'Übung 5', { wichtig: true, kategorie: 'Uni' });
    expect(await x.fakten('adressbuch-pflegen')).toEqual(['Leemhuis, Anna <anna.leemhuis@jku.at> – 2 wichtige Mails in 60 Tagen · Uni · zuletzt „Übung 5“']);
    expect(await x.fakten('adressbuch-pflegen', JETZT + 1)).toBeNull(); // nichts Neues seit dem letzten Mal
    await x.d.vault.schreiben('Rathaus/kontakte.md', '# Kontakte\n\n- Anna Leemhuis <anna.leemhuis@jku.at> · Lehrende CDA\n');
    expect(await x.fakten('adressbuch-pflegen')).toBeNull();
    await x.d.app.close();
  });

  it('gewohnheiten-reissen: unter der Hälfte in 14 Tagen – erst nach zwei Wochen Bestand, „Nx pro woche“ mit Wochenziel', async () => {
    const x = await aufbau();
    expect(await x.fakten('gewohnheiten-reissen')).toBeNull();
    await x.d.vault.schreiben(
      'Marktplatz/gewohnheiten.md',
      '---\ngewohnheiten:\n  - name: Laufen\n    symbol: "🏃"\n    tage: 3x pro woche\n  - name: Lesen\n    tage: täglich\n    uhrzeit: "21:00"\n  - name: Neu\n    tage: täglich\n---\n',
    );
    const haken = x.d.db.prepare('INSERT INTO gewohnheit_log (name, tag) VALUES (?, ?)');
    expect(await x.fakten('gewohnheiten-reissen')).toBeNull(); // noch keine zwei Wochen Bestand
    haken.run('Laufen', '2026-10-20');
    haken.run('Laufen', '2026-11-10');
    haken.run('Laufen', '2026-11-12'); // 2 von 6
    haken.run('Lesen', '2026-10-20');
    for (let t = 3; t <= 15; t++) haken.run('Lesen', `2026-11-${String(t).padStart(2, '0')}`); // 13 von 14
    expect(await x.fakten('gewohnheiten-reissen')).toEqual(['🏃 Laufen (3x pro woche): 2 von 6 in 14 Tagen']);
    await x.d.app.close();
  });

  it('fach-steckbriefe: Fächer, die in der Steckbrief-Datei fehlen', async () => {
    const x = await aufbau();
    expect(await x.fakten('fach-steckbriefe')).toBeNull();
    await x.d.uni.fachAnlegen('Statistik');
    await x.d.uni.fachAnlegen('CDA');
    expect(await x.fakten('fach-steckbriefe')).toEqual([
      'Steckbrief-Datei: noch keine – neu anlegen als Rathaus/wissen/JJJJ-MM-TT_HHMM_faecher.md',
      'Fehlt: CDA – Uni/faecher/CDA',
      'Fehlt: Statistik – Uni/faecher/Statistik',
    ]);
    await x.d.vault.schreiben('Rathaus/wissen/2026-11-16_1300_faecher.md', '| Fach | Lehrende |\n|---|---|\n| Statistik | unbekannt |\n');
    expect(await x.fakten('fach-steckbriefe')).toEqual(['Steckbrief-Datei: Rathaus/wissen/2026-11-16_1300_faecher.md (mit vault_aendern ergänzen)', 'Fehlt: CDA – Uni/faecher/CDA']);
    await x.d.vault.schreiben('Rathaus/wissen/2026-11-16_1300_faecher.md', '| Statistik | unbekannt |\n| CDA | Leemhuis |\n', { basisVersion: (await x.d.vault.lesen('Rathaus/wissen/2026-11-16_1300_faecher.md')).version });
    expect(await x.fakten('fach-steckbriefe')).toBeNull();
    await x.d.app.close();
  });

  it('moodle-einsortieren: Dateien in Uni/moodle/ (auch in Unterordnern), nur wenn seit dem letzten Mal etwas dazukam', async () => {
    const x = await aufbau();
    expect(await x.fakten('moodle-einsortieren')).toBeNull();
    await x.d.uni.fachAnlegen('Statistik');
    await x.d.vault.schreiben('Uni/moodle/blatt4.md', '# Blatt 4\n');
    await x.d.vault.schreiben('Uni/moodle/kurs-x/folien.md', '# Folien\n');
    expect(await x.fakten('moodle-einsortieren')).toEqual(['Uni/moodle/blatt4.md', 'Uni/moodle/kurs-x/folien.md', 'Fächer: Statistik']);
    expect(await x.fakten('moodle-einsortieren', Date.now() + TAG)).toBeNull();
    await x.d.app.close();
  });

  it('tagesrhythmus: erst mit genug Daten (2 h Fokus oder 15 erledigte To-dos in 4 Wochen)', async () => {
    const x = await aufbau();
    expect(await x.fakten('tagesrhythmus')).toBeNull();
    const fokus = x.d.db.prepare('INSERT INTO fokus_sitzungen (start, ende, minuten, vollstaendig) VALUES (?, ?, 60, 1)');
    for (const t of [1, 2]) fokus.run(tagBeginn(`2026-11-1${t}`) + 9 * STUNDE, tagBeginn(`2026-11-1${t}`) + 10 * STUNDE);
    expect(await x.fakten('tagesrhythmus')).toEqual([
      'Fokus in 4 Wochen: 120 min; beste 2-Stunden-Spanne: 8–10 Uhr',
      'Fokus je Tageszeit: früh (5–9) 0 min · vormittags (9–12) 120 min · mittags (12–14) 0 min · nachmittags (14–18) 0 min · abends (18–22) 0 min',
      'Erledigte To-dos (0) je Tageszeit: früh (5–9) 0 · vormittags (9–12) 0 · mittags (12–14) 0 · nachmittags (14–18) 0 · abends (18–22) 0',
      'Erledigte To-dos je Wochentag: So 0 · Mo 0 · Di 0 · Mi 0 · Do 0 · Fr 0 · Sa 0',
    ]);
    await x.d.app.close();
  });

  it('monatsrueckblick und auftraege-verdichten: nur in den ersten Tagen des Monats, nur einmal, nur mit Stoff', async () => {
    const x = await aufbau();
    const { d } = x;
    const t = await d.todos.anlegen({ titel: 'Referat' }, 'Leif');
    await d.todos.aendern(t.pfad, { erledigt: true });
    const auftrag = d.db.prepare("INSERT INTO schreibtisch (id, pfad, titel, quelle, status, erstellt, geaendert) VALUES (?, ?, ?, 'app', 'erledigt', ?, ?)");
    for (let i = 1; i <= 4; i++) auftrag.run(`s${i}`, `Rathaus/schreibtisch/s${i}.md`, `Auftrag ${i}`, JETZT, JETZT);
    expect(await x.fakten('monatsrueckblick')).toBeNull(); // 16. – zu spät im Monat
    d.uhr.vor(17 * TAG); // 3. Dezember
    const m = (await x.fakten('monatsrueckblick'))!;
    expect(m[0]).toBe('Monat 2026-11 – Dateiname endet auf „_monatsrueckblick-2026-11.md“');
    expect(m[1]).toBe('Erledigte To-dos: 1, z. B. „Referat“');
    expect(m[2]).toBe('Fokus: 0 min · Gewohnheiten abgehakt: 0× · erledigte Aufträge auf dem Schreibtisch: 4');
    expect(await x.fakten('auftraege-verdichten')).toBeNull(); // nur 4 Aufträge
    auftrag.run('s5', 'Rathaus/schreibtisch/s5.md', 'Auftrag 5', JETZT, JETZT);
    expect((await x.fakten('auftraege-verdichten'))!).toHaveLength(6);
    await d.vault.schreiben('Rathaus/rueckblick/2026-12-03_1300_monatsrueckblick-2026-11.md', '# November\n');
    await d.vault.schreiben('Rathaus/rueckblick/2026-12-03_1300_auftraege-2026-11.md', '# Aufträge\n');
    expect(await x.fakten('monatsrueckblick')).toBeNull();
    expect(await x.fakten('auftraege-verdichten')).toBeNull();
    await d.app.close();
  });

  it('rathaus-ablage: ab fünf Notizen älter als 30 Tage in vorbereitung/recherche/aufraeumen – nie andere Ordner', async () => {
    const x = await aufbau();
    const schreiben = (p: string) => x.d.vault.schreiben(p, '# x\n');
    for (const p of ['Rathaus/vorbereitung/2026-09-01_1200_a.md', 'Rathaus/recherche/2026-10-01_1200_b.md', 'Rathaus/aufraeumen/2026-10-10_0800_c.md', 'Rathaus/vorbereitung/2026-10-15_0900_d.md']) await schreiben(p);
    await schreiben('Rathaus/vorbereitung/2026-11-01_1200_frisch.md');
    await schreiben('Rathaus/notizen/2026-09-01.md');
    await schreiben('Rathaus/schreibtisch/2026-09-01_1200_auftrag.md');
    expect(await x.fakten('rathaus-ablage')).toBeNull(); // nur vier alte
    await schreiben('Rathaus/recherche/2026-08-30_1000_e.md');
    const f = (await x.fakten('rathaus-ablage'))!;
    expect(f).toHaveLength(5);
    expect(f).toContain('Rathaus/vorbereitung/2026-09-01_1200_a.md → Rathaus/ablage/2026-09/2026-09-01_1200_a.md');
    expect(f.join('\n')).not.toMatch(/frisch|notizen|schreibtisch/);
    await x.d.app.close();
  });

  it('verwaiste-notizen: ohne eingehenden Link und seit 60 Tagen unverändert; Rathaus, Listen, Skills und Verlinktes nicht', async () => {
    const x = await aufbau();
    const lange = Date.now() - 90 * TAG;
    const alle = {
      'Bibliothek/vergessen.md': '# Vergessen',
      'Bibliothek/index.md': 'Siehe [[verlinkt]] und [Mehr](Unterordner/auch%20verlinkt.md).',
      'Bibliothek/verlinkt.md': '# Verlinkt',
      'Bibliothek/Unterordner/auch verlinkt.md': '# Auch',
      'Rathaus/vorbereitung/2026-01-01_1200_x.md': '# Rathaus',
      'Marktplatz/todos/2026-01-01_1200_t.md': '# To-do',
    };
    for (const [p, t] of Object.entries(alle)) {
      await x.d.vault.schreiben(p, t);
      x.alt(p, lange);
    }
    await x.d.vault.schreiben('Bibliothek/frisch.md', '# Frisch');
    const f = (await x.fakten('verwaiste-notizen'))!;
    expect(f.map((z) => z.split(' – ')[0]).sort()).toEqual(['Bibliothek/index.md', 'Bibliothek/vergessen.md']);
    await x.d.app.close();
  });

  it('tags-vereinheitlichen: Schreibweisen-Gruppen aus Text und Kopf; Farbcodes, Code und Überschriften zählen nicht', async () => {
    const x = await aufbau();
    expect(await x.fakten('tags-vereinheitlichen')).toBeNull();
    await x.d.vault.schreiben('Bibliothek/a.md', '---\ntags: [Uni, lernen]\n---\n# Überschrift\nText #uni und #lernen, Farbe #fff, `#Code`.\n');
    await x.d.vault.schreiben('Bibliothek/b.md', 'Noch mal #uni.\n```\n#LERNEN im Code\n```\n#FFF\n');
    expect(await x.fakten('tags-vereinheitlichen')).toEqual(['#uni (2×, z. B. Bibliothek/a.md) · #Uni (1×, z. B. Bibliothek/a.md)']);
    await x.d.app.close();
  });

  it('newsletter-flut: Absender mit mindestens 8 Mails in 30 Tagen und keiner wichtigen', async () => {
    const x = await aufbau();
    for (let i = 0; i < 7; i++) x.mail(`s${i}`, 'Shop <news@shop.at>', `Angebot ${i}`, { kategorie: 'Werbung' });
    for (let i = 0; i < 9; i++) x.mail(`b${i}`, 'Bank <info@bank.at>', `Info ${i}`, { wichtig: i === 0 });
    expect(await x.fakten('newsletter-flut')).toBeNull();
    x.mail('s7', 'Shop <news@shop.at>', 'Angebot 7', { kategorie: 'Werbung' });
    x.mail('alt', 'Shop <news@shop.at>', 'Uralt', { datum: JETZT - 40 * TAG });
    expect(await x.fakten('newsletter-flut')).toEqual(['Shop <news@shop.at> – 8 Mails in 30 Tagen, keine wichtig · Werbung']);
    await x.d.app.close();
  });

  it('jku-fristen: einmal im Monat, Semester-Lage vom Code; keine privaten Daten in den Fakten', async () => {
    const x = await aufbau();
    await x.d.uni.fachAnlegen('Statistik');
    expect(await x.fakten('jku-fristen')).toEqual(['Heute: 2026-11-16 – Wintersemester 2026/27', 'Letzte Notiz dazu: keine']);
    await x.d.vault.schreiben('Rathaus/recherche/2026-11-06_1200_jku-fristen.md', '# JKU\n');
    expect(await x.fakten('jku-fristen')).toBeNull();
    x.d.uhr.vor(20 * TAG);
    expect(await x.fakten('jku-fristen')).toEqual(['Heute: 2026-12-06 – Wintersemester 2026/27', 'Letzte Notiz dazu: Rathaus/recherche/2026-11-06_1200_jku-fristen.md']);
    await x.d.app.close();
  });

  it('frisches Dorf: keine der neuen Aktivitäten (außer der monatlichen JKU-Recherche) findet einen Anlass', async () => {
    const x = await aufbau();
    x.kalender([]);
    const mitAnlass: string[] = [];
    for (const a of WEITERE_AKTIVITAETEN) if ((await a.fakten!(x.q, 0)) !== null) mitAnlass.push(a.id);
    expect(mitAnlass).toEqual(['jku-fristen']);
    await x.d.app.close();
  });
});
