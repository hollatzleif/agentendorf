import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { KalenderKlient } from '../src/kalender-google.js';
import type { GmailKlient } from '../src/post/gmail.js';
import { WerkzeugKiste } from '../src/agenten/werkzeuge.js';
import { ALLTAG_WERKZEUGE, werkzeugprofil } from '../src/agenten/leine.js';
import { testDorf } from './hilfen.js';

/**
 * E183: Agenten (Bürgermeister und Helfer, beide Motoren – die Werkstatt bekommt die Liste über intern.ts) dürfen
 * Timer/Wecker/Pomodoro stellen, Notizen anlegen und neue Mail-Entwürfe schreiben; Termine nur als Vorschlag (Freigabe).
 * TestUhr: Mo, 16.11.2026 12:00 UTC = 13:00 in Wien.
 */
const w = (n: string, e: unknown) => `<<werkzeug ${n} ${JSON.stringify(e)}>>`;

function kalenderAttrappe() {
  const angelegt: { kalenderId: string; body: Record<string, unknown> }[] = [];
  const klient: KalenderKlient = {
    kalender: async () => [{ id: 'leif@gmail.com', name: 'Leif', farbe: '#9fe1e7', primaer: true, schreibbar: true }],
    termine: async () => [],
    holen: async () => {
      throw new Error('nicht gebraucht');
    },
    anlegen: async (kalenderId, body) => {
      angelegt.push({ kalenderId, body: body as Record<string, unknown> });
      return { id: `neu${angelegt.length}`, ...(body as object) } as never;
    },
    aendern: async () => {
      throw new Error('nicht gebraucht');
    },
    loeschen: async () => undefined,
    verschieben: async () => {
      throw new Error('nicht gebraucht');
    },
  };
  return { klient, angelegt };
}

function gmailAttrappe() {
  const entwuerfe: Parameters<GmailKlient['entwurf']>[0][] = [];
  const gmail = {
    profil: async () => ({ emailAddress: 'leif@example.com', historyId: '1' }),
    liste: async () => [],
    seit: async () => null,
    nachricht: async () => {
      throw new Error('nicht gebraucht');
    },
    entwurf: async (e: Parameters<GmailKlient['entwurf']>[0]) => {
      entwuerfe.push(e);
      return { id: `d${entwuerfe.length}` };
    },
  } as GmailKlient;
  return { gmail, entwuerfe };
}

async function aufbau() {
  const kal = kalenderAttrappe();
  const post = gmailAttrappe();
  const d = await testDorf({ kalenderKlient: kal.klient, gmail: post.gmail });
  const texte = (chatId: string) => d.agenten.chatDetail(chatId).nachrichten.filter((n) => n.rolle === 'werkzeug').map((n) => n.text);
  const aktion = (name: string, kopf: string, rumpf: string) => {
    fs.writeFileSync(path.join(d.vault.wurzel, `Bibliothek/aktionen/${name}.md`), `---\nname: ${name}\n${kopf}\n---\n${rumpf}\n`);
    return `Bibliothek/${name}`;
  };
  const laufen = async (id: string) => {
    const r = await d.agenten.aktionStarten(id, {});
    await d.agenten.leerlauf();
    return { chatId: r.chatId, t: texte(r.chatId) };
  };
  return { d, kal, post, texte, aktion, laufen };
}

describe('Alltags-Werkzeuge der Agenten (E183)', () => {
  it('Helfer ohne Fremdinhalte: Timer, Wecker, Pomodoro (mit To-do), Einstellungen, Kirchturm lesen, Notiz', async () => {
    const x = await aufbau();
    const { d } = x;
    const todo = await d.todos.anlegen({ titel: 'Statistik Blatt 4', gruppe: 'Statistik' }, 'Leif');
    const id = x.aktion(
      'alltag',
      'werkzeuge: [vault_lesen]',
      [
        w('kirchturm_timer', { aktion: 'start', minuten: 10, name: 'Tee' }),
        w('kirchturm_wecker', { aktion: 'stellen', zeit: '7:30', name: 'Aufstehen', tage: 'werktags' }),
        w('pomodoro', { aktion: 'start', todo_pfad: todo.pfad }),
        w('pomodoro_einstellen', { arbeit_min: 50, auto_weiter: true }),
        w('notiz_anlegen', { text: 'Idee: Lerngruppe fragen' }),
        w('kirchturm_lesen', {}),
        // Fehler gehen als Text zurück, nichts passiert
        w('kirchturm_timer', { aktion: 'start' }),
        w('kirchturm_wecker', { aktion: 'loeschen', id: 'gibtsnicht' }),
        w('pomodoro_einstellen', { arbeit_min: 500 }),
        w('notiz_anlegen', { text: ' ' }),
      ].join('\n'),
    );
    const { t } = await x.laufen(id);
    expect(t[0]).toMatch(/^kirchturm_timer: ⏳ Timer „Tee“ läuft \(10 min, id [0-9a-f-]+\)\./);
    expect(t[1]).toMatch(/^kirchturm_wecker: ⏰ Wecker 07:30 gestellt – klingelt Di\., 17\.11\. 07:30/);
    expect(t[2]).toMatch(/^pomodoro: 🍅 Fokusrunde für „Statistik Blatt 4“ gestartet\./);
    expect(t[3]).toMatch(/^pomodoro_einstellen: 🍅 Pomodoro-Einstellungen geändert\./);
    expect(t[4]).toMatch(/^notiz_anlegen: Notiz angehängt an Rathaus\/notizen\/2026-11-16\.md: - 13:00 Idee: Lerngruppe fragen _\(Agent Bibliothek\)_/);
    expect(t[5]).toContain('🍅 Pomodoro: Fokus, Runde 1 von 4, noch 25 min (läuft) – „Statistik Blatt 4“');
    expect(t[5]).toContain('Arbeit 50 min');
    expect(t[5]).toMatch(/⏳ Timer „Tee“: noch 10 min · id /);
    expect(t[5]).toMatch(/⏰ Wecker 07:30 „Aufstehen“ \(Mo, Di, Mi, Do, Fr\)/);
    expect(t[6]).toMatch(/^kirchturm_timer: \(verweigert\) minuten fehlt/);
    expect(t[7]).toMatch(/^kirchturm_wecker: \(verweigert\) Diesen Wecker gibt es nicht/);
    expect(t[8]).toMatch(/^pomodoro_einstellen: \(verweigert\) Ungültige Eingabe/);
    expect(t[9]).toMatch(/^notiz_anlegen: \(verweigert\)/);
    const k = d.kirchturm.zustand();
    expect(k.timer).toMatchObject([{ name: 'Tee', status: 'laeuft' }]);
    expect(k.wecker).toMatchObject([{ name: 'Aufstehen', zeit: '07:30', tage: [1, 2, 3, 4, 5], aktiv: true }]);
    expect(k.pomodoro).toMatchObject({ phase: 'arbeit', status: 'laeuft', einstellungen: { thema: 'Statistik Blatt 4', gruppe: 'Statistik', todoPfad: todo.pfad, arbeitMin: 50, autoWeiter: true, kurzMin: 5 } });
    expect((await d.notizen.heute()).zeilen).toEqual(['- 13:00 Idee: Lerngruppe fragen _(Agent Bibliothek)_']);
    // Timer per id anhalten und löschen, Pomodoro stoppen
    const timerId = k.timer[0]!.id;
    const id2 = x.aktion('alltag2', 'werkzeuge: [vault_lesen]', [w('kirchturm_timer', { aktion: 'pause', id: timerId }), w('kirchturm_timer', { aktion: 'loeschen', id: timerId }), w('pomodoro', { aktion: 'stopp' })].join('\n'));
    const r2 = await x.laufen(id2);
    expect(r2.t[0]).toMatch(/angehalten/);
    expect(d.kirchturm.zustand().timer).toEqual([]);
    expect(d.kirchturm.zustand().pomodoro.phase).toBe('aus');
  });

  it('E185: termin_anlegen trägt direkt ein (ohne Einladungen) und meldet es mit „Rückgängig“; Vergangenes und Unsinn nicht', async () => {
    const x = await aufbau();
    const { d } = x;
    const id = x.aktion(
      'termine',
      'werkzeuge: [vault_lesen]',
      [
        w('termin_anlegen', { titel: 'Lernen Statistik', datum: '2026-11-17', zeit: '10:00', dauer_min: 90 }),
        w('termin_anlegen', { titel: 'Lesetag', datum: '2026-11-18' }),
        w('termin_anlegen', { titel: 'Gestern', datum: '2026-11-15' }),
        w('termin_anlegen', { titel: 'Kaputt', datum: '2026-11-17', zeit: '25:00' }),
      ].join('\n'),
    );
    const { t } = await x.laufen(id);
    expect(t[0]).toBe('termin_anlegen: Eingetragen in Leifs Kalender: Lernen Statistik, Di., 17.11.2026 · 10:00–11:30 (90 min) – ohne Einladungen. Leif hat eine Meldung bekommen und kann es zurücknehmen.');
    expect(t[2]).toMatch(/\(verweigert\) Der 2026-11-15 liegt in der Vergangenheit/);
    expect(t[3]).toMatch(/\(verweigert\) Ungültige Eingabe/);
    // direkt im Hauptkalender, ohne Teilnehmer – und keine Freigabe
    expect(x.kal.angelegt).toEqual([
      { kalenderId: 'leif@gmail.com', body: { summary: 'Lernen Statistik', start: { dateTime: '2026-11-17T10:00:00', timeZone: 'Europe/Vienna' }, end: { dateTime: '2026-11-17T11:30:00', timeZone: 'Europe/Vienna' } } },
      { kalenderId: 'leif@gmail.com', body: { summary: 'Lesetag', start: { date: '2026-11-18' }, end: { date: '2026-11-19' } } },
    ]);
    expect(d.agenten.freigaben.liste('offen')).toEqual([]);
    const getan = d.agenten.rueckgaengig.liste();
    expect(getan.map((g) => g.titel).sort()).toEqual(['Termin eingetragen: Lernen Statistik – Di., 17.11.2026 · 10:00–11:30 (90 min)', 'Termin eingetragen: Lesetag – Mi., 18.11.2026 · ganztägig']);
    // die alte Freigabe-Art kann ein Agent weiterhin nicht selbst beantragen
    const id2 = x.aktion('schmuggel', 'werkzeuge: [vault_lesen]', w('freigabe_beantragen', { art: 'termin_anlegen', titel: 'x', begruendung: 'x', inhalt: { titel: 'x', ganztags: true, start: '2026-11-20', ende: '2026-11-21', beschreibung: 'x' } }));
    expect((await x.laufen(id2)).t[0]).toMatch(/\(verweigert\) Ungültige Eingabe/);
  });

  it('E185: auch Läufe mit Fremdinhalten haben den Alltag (Leifs Entscheidung) – Mail-Entwürfe nur mit werkzeuge: [post], senden gibt es nie', async () => {
    const x = await aufbau();
    const { d } = x;
    expect(werkzeugprofil({ werkzeuge: ['post'], fremdinhalte: true }).dorf).toContain('post_entwurf_neu');
    expect(werkzeugprofil({ werkzeuge: ['vault_lesen'], fremdinhalte: false }).dorf).not.toContain('post_entwurf_neu');
    fs.writeFileSync(
      path.join(d.vault.wurzel, 'Post/aktionen/mail-test.md'),
      `---\nname: Mail-Test\nwerkzeuge: [vault_lesen, post, web]\nfremdinhalte: ja\n---\n${[
        w('notiz_anlegen', { text: 'Aus der Mail: Treffen am Freitag' }),
        w('kirchturm_timer', { aktion: 'start', minuten: 5, name: 'Tee' }),
        w('post_entwurf_neu', { an: 'prof@jku.at', betreff: 'Frage', text: 'Guten Tag' }),
        w('post_senden', { an: 'prof@jku.at', betreff: 'Frage', text: 'Guten Tag' }),
      ].join('\n')}\n`,
    );
    const r = await d.agenten.aktionStarten('Post/mail-test', {});
    await d.agenten.leerlauf();
    const t = x.texte(r.chatId);
    expect(t[0]).toMatch(/^notiz_anlegen: Notiz angehängt/);
    expect(t[1]).toMatch(/^kirchturm_timer: ⏳ Timer „Tee“ läuft/);
    expect(t[2]).toMatch(/^post_entwurf_neu: Neuer Entwurf in Gmail angelegt .* Gesendet wurde nichts\. Entwurf-ID: d1$/);
    expect(t[3]).toMatch(/\(verweigert\) Werkzeug „post_senden“ ist für diese Aktion nicht erlaubt/);
    expect(x.post.entwuerfe).toEqual([{ an: 'prof@jku.at', betreff: 'Frage', text: 'Guten Tag' }]);
  });

  it('Bürgermeister hat alles (inkl. neuer Mail-Entwurf, nie senden); freie Helfer bekommen den Alltag', async () => {
    const x = await aufbau();
    const { d } = x;
    const a = await d.schreibtisch.anlegen({
      text: `Bitte erledigen ${w('post_entwurf_neu', { an: 'Prof <prof@jku.at>', betreff: 'Sprechstunde', text: 'Guten Tag, …' })} ${w('post_entwurf_neu', { an: 'a@b.at, c@d.at', betreff: 'x', text: 'x' })} ${w('notiz_anlegen', { text: 'Vom Bürgermeister' })} ${w('pomodoro', { aktion: 'start', titel: 'Bachelorarbeit' })} [helfer Bibliothek|Übersicht]`,
      quelle: 'app',
    });
    await d.buergermeister.starten(a.id);
    await d.agenten.leerlauf();
    const chatId = d.schreibtisch.holen(a.id).chatId!;
    const werkzeuge = JSON.parse((d.db.prepare('SELECT werkzeuge_json FROM chats WHERE id = ?').get(chatId) as { werkzeuge_json: string }).werkzeuge_json) as string[];
    for (const n of [...ALLTAG_WERKZEUGE, 'post_entwurf_neu', 'todo_anlegen']) expect(werkzeuge).toContain(n);
    expect(new Set(werkzeuge).size).toBe(werkzeuge.length);
    const t = x.texte(chatId);
    expect(t.find((z) => z.startsWith('post_entwurf_neu: Neuer Entwurf'))).toBe('post_entwurf_neu: Neuer Entwurf in Gmail angelegt (Ordner „Entwürfe“): „Sprechstunde“ an prof@jku.at. Gesendet wurde nichts. Entwurf-ID: d1');
    expect(t.find((z) => z.startsWith('post_entwurf_neu: (verweigert)'))).toMatch(/Genau eine gültige Adresse/);
    expect(x.post.entwuerfe).toEqual([{ an: 'prof@jku.at', betreff: 'Sprechstunde', text: 'Guten Tag, …' }]);
    expect((await d.notizen.heute()).zeilen).toEqual(['- 13:00 Vom Bürgermeister _(Bürgermeister)_']);
    expect(d.kirchturm.zustand().pomodoro.einstellungen.thema).toBe('Bachelorarbeit');
    // E185: der Bürgermeister hat Post, Kalender und Web direkt
    for (const n of ['post_suchen', 'post_lesen', 'kalender_lesen', 'kontakt_suchen', 'rueckfrage', 'web']) expect(werkzeuge).toContain(n);
    // freier Helfer des Bürgermeisters: To-dos + Alltag; Post/Web nur mit faehigkeiten
    const helfer = d.agenten.chatListe().find((c) => c.elternChatId === chatId)!;
    const hw = JSON.parse((d.db.prepare('SELECT werkzeuge_json FROM chats WHERE id = ?').get(helfer.id) as { werkzeuge_json: string }).werkzeuge_json) as string[];
    for (const n of [...ALLTAG_WERKZEUGE, 'todo_liste']) expect(hw).toContain(n);
    expect(hw).not.toContain('post_entwurf_neu');
    expect(hw).not.toContain('web');
  });

  it('Systemkontext: Bürgermeister erledigt Kurzes selbst – Termine direkt, Mail in einem Lauf, bestätigt wird nur ein gewünschter Plan', async () => {
    const { systemPromptBauen } = await import('../src/agenten/kontext.js');
    const d = await testDorf();
    const profil = werkzeugprofil({ werkzeuge: ['vault_lesen', 'post', 'kalender', 'web'], fremdinhalte: false });
    const s = await systemPromptBauen(d.vault, { gebaeude: 'Rathaus', aktionName: 'Bürgermeister', profil, jetzt: d.uhr.jetzt(), motor: 'api', stufe: 'mittel', wissen: { persoenlichkeit: '', gedaechtnis: '', gedaechtnisVersion: null } });
    for (const n of ['termin_anlegen', 'notiz_anlegen', 'kirchturm_timer', 'kontakt_suchen', 'post_entwurf_neu', 'rueckfrage']) expect(s).toContain(n);
    expect(s).not.toContain('termin_vorschlagen');
    expect(s).toMatch(/Kurzes erledigst du SELBST, in einem Lauf/);
    expect(s).toMatch(/kontakt_suchen → sonst Websuche .* → post_entwurf_neu → kontakt_merken/);
    expect(s).toMatch(/Leif bestätigt nur, wenn er selbst einen Plan will/);
    expect(s).toContain('Websuche und Webseiten abrufen sind erlaubt');
    // die ausgelieferte Stadtordnung sagt dasselbe
    expect(s).toMatch(/\*\*Nie:\*\* senden, abgeben, bezahlen/);
  });
});
