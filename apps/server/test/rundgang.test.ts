import { describe, expect, it } from 'vitest';
import type { TelegramSchnittstelle } from '../src/telegram/api.js';
import type { Motor } from '../src/agenten/motor.js';
import { attrappe } from '../src/agenten/motor-attrappe.js';
import { AUFWACHEN_PFAD } from '../src/aufwachen.js';
import { abstandMs, budgetWahl, faelligeAktivitaeten, fuerLeif, KATALOG, KOSTEN_USD, RUNDGANG_PFAD, rundgangEinstellungen, vaultBefund, type Aktivitaet, type RundgangEinstellungen } from '../src/rundgang.js';
import { MEINE_TODOS_ORDNER, MAX_VORGELEGT, offenePunkte } from '../src/agenten/meine-todos.js';
import { BUERGERMEISTER_WERKZEUGE, HELFER_FAEHIGKEITEN, MEINE_TODOS_WERKZEUGE, pflegePruefen, schreibenPruefen, werkzeugprofil } from '../src/agenten/leine.js';
import { MAX_GEDAECHTNIS, textPruefen } from '../src/agenten/gedaechtnis.js';
import { WERKZEUG_DEFINITIONEN } from '../src/agenten/werkzeuge.js';
import { testDorf } from './hilfen.js';

/**
 * E192: Der Bürgermeister arbeitet von selbst – eigene To-do-Liste, Aktivitäten-Katalog, Rundgang.
 * TestUhr: Mo, 16.11.2026 12:00 UTC = 13:00 in Wien.
 */
const STUNDE = 3_600_000;
const TAG = 24 * STUNDE;
const JETZT = Date.UTC(2026, 10, 16, 12);
const w = (n: string, e: unknown) => `<<werkzeug ${n} ${JSON.stringify(e)}>>`;
const kal = (...ev: string[]) => `BEGIN:VCALENDAR\r\n${ev.join('')}END:VCALENDAR\r\n`;
const ev = (uid: string, titel: string, ende: string) => `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${titel}\r\nDTSTART:${ende}\r\nDTEND:${ende}\r\nEND:VEVENT\r\n`;

const akt = (id: string, a: Partial<Aktivitaet> = {}): Aktivitaet => ({ id, titel: id, gruppe: 'Test', haeufigkeit: 'täglich', gewicht: 'klein', nachts: true, auftrag: 'x', ergebnis: 'x', ...a });
const standard = (aktivitaeten: Record<string, string> = {}): RundgangEinstellungen => ({ aktivitaeten_je_rundgang: 2, meldung: true, aktivitaeten });

/** Attrappe, deren letzte Antwort sich umschreiben lässt (z. B. „Offen“-Abschnitt, „Für Leif“) */
const mitAntwort = (f: (text: string) => string): Motor => {
  const m = attrappe('api');
  return {
    name: 'api',
    async *starten(a) {
      for await (const e of m.starten(a)) {
        if (e.typ === 'nachricht' && e.rolle === 'agent') {
          const text = f(e.text);
          yield { ...e, text, roh: { role: 'assistant', content: [{ type: 'text', text }] } };
        } else yield e;
      }
    },
  };
};

async function aufbau(opt: { fristen?: string; api?: Motor; aufwachen?: [string, string] } = {}) {
  const texte: string[] = [];
  const telegram: TelegramSchnittstelle = {
    async aufruf<T>(m: string, p: Record<string, unknown> = {}) {
      if (m === 'sendMessage') texte.push(String(p.text));
      return { message_id: texte.length } as T;
    },
    async dateiLaden() {
      return { name: 'x', inhalt: Buffer.from('') };
    },
  };
  const d = await testDorf({
    telegram,
    env: { TELEGRAM_CHAT_ID: '1' },
    google: { fristen: { laden: async () => opt.fristen ?? kal() } },
    ...(opt.api ? { motoren: { api: opt.api, 'claude-code': attrappe('claude-code') } } : {}),
  });
  if (opt.aufwachen) {
    const alt = await d.vault.lesen(AUFWACHEN_PFAD);
    await d.vault.schreiben(AUFWACHEN_PFAD, alt.inhalt.replace(opt.aufwachen[0], opt.aufwachen[1]), { basisVersion: alt.version });
  }
  await d.uni.abgleichen();
  const mt = d.aufwachen.meineTodos;
  const werkzeugTexte = (chatId: string) => d.agenten.chatDetail(chatId).nachrichten.filter((n) => n.rolle === 'werkzeug').map((n) => n.text);
  /** Bürgermeister-Lauf für eine Aufgabe von Leif */
  const auftrag = async (text: string) => {
    const a = await d.schreibtisch.anlegen({ text, quelle: 'app' });
    const r = await d.buergermeister.starten(a.id, 'klick');
    await d.agenten.leerlauf();
    return { ...r, aufgabe: d.schreibtisch.holen(a.id) };
  };
  const rundgangMd = async (kopf: string) => {
    const alt = await d.vault.lesen(RUNDGANG_PFAD);
    await d.vault.schreiben(RUNDGANG_PFAD, `---\n${kopf}\n---\n\nText\n`, { basisVersion: alt.version });
  };
  return { d, texte, mt, werkzeugTexte, auftrag, rundgangMd };
}

describe('Auswahl der Aktivitäten (E192)', () => {
  it('Abstände: täglich etwas unter einem Tag, „alle N tage“, aus = nie', () => {
    expect(abstandMs('jedes')).toBe(0);
    expect(abstandMs('täglich')).toBe(20 * STUNDE);
    expect(abstandMs('wöchentlich')).toBe(6.5 * TAG);
    expect(abstandMs('monatlich')).toBe(28 * TAG);
    expect(abstandMs('alle 3 tage')).toBe(3 * TAG - 4 * STUNDE);
    expect(abstandMs('aus')).toBeNull();
  });

  it('Fälligkeit: noch nie gemacht zuerst, dann am längsten über der Zeit; nicht Fälliges und Abgeschaltetes fehlt', () => {
    const katalog = [akt('a'), akt('b'), akt('c', { haeufigkeit: 'wöchentlich' }), akt('d'), akt('e', { haeufigkeit: 'wöchentlich' })];
    const ids = (zuletzt: Record<string, number>, e = standard(), nacht = false) => faelligeAktivitaeten({ katalog, e, zuletzt, jetzt: JETZT, nacht }).map((x) => x.id);
    // nie gemacht → Rang im Katalog
    expect(ids({})).toEqual(['a', 'b', 'c', 'd', 'e']);
    // a vor 5 h (täglich: noch nicht), b vor 3 Tagen (3,6× über der Zeit), c vor 8 Tagen (1,2×), d nie, e vor 2 Tagen (wöchentlich: noch nicht)
    expect(ids({ a: JETZT - 5 * STUNDE, b: JETZT - 3 * TAG, c: JETZT - 8 * TAG, e: JETZT - 2 * TAG })).toEqual(['d', 'b', 'c']);
    // Leif schaltet d ab, macht e täglich und a „jedes Mal“
    expect(ids({ a: JETZT - 5 * STUNDE, e: JETZT - 2 * TAG }, standard({ d: 'aus', e: 'täglich', a: 'jedes' }))).toEqual(['b', 'c', 'e', 'a']);
  });

  it('Nacht: nur stille Pflege', () => {
    const katalog = [akt('laut', { nachts: false }), akt('still')];
    const f = (nacht: boolean) => faelligeAktivitaeten({ katalog, e: standard(), zuletzt: {}, jetzt: JETZT, nacht }).map((x) => x.id);
    expect(f(false)).toEqual(['laut', 'still']);
    expect(f(true)).toEqual(['still']);
    // im echten Katalog: Recherche (Web, teuer) nie nachts
    expect(KATALOG.find((a) => a.id === 'recherche-auf-vorrat')).toMatchObject({ nachts: false, gewicht: 'gross' });
  });

  it('Budget: Reserve, teure nur mit halbem Tagesbudget, höchstens eine nicht-kleine, höchstens max', () => {
    const k1 = akt('k1');
    const k2 = akt('k2');
    const k3 = akt('k3');
    const m1 = akt('m1', { gewicht: 'mittel' });
    const m2 = akt('m2', { gewicht: 'mittel' });
    const g = akt('g', { gewicht: 'gross' });
    const ids = (liste: Aktivitaet[], restbudget: number, max = 2, tagesbudget = 5) => budgetWahl(liste, { restbudget, tagesbudget, max }).map((x) => x.id);
    // volles Budget: die ersten zwei – aber nur EINE nicht-kleine
    expect(ids([g, m1, k1, k2], 5)).toEqual(['g', 'k1']);
    expect(ids([m1, m2, k1], 5, 3)).toEqual(['m1', 'k1']);
    expect(ids([k1, k2, k3], 5, 3)).toEqual(['k1', 'k2', 'k3']);
    expect(ids([k1, k2, k3], 5, 1)).toEqual(['k1']);
    // unter der Hälfte: keine große; unter einem Viertel: auch keine mittlere
    expect(ids([g, m1, k1], 2.4)).toEqual(['m1', 'k1']);
    expect(ids([g, m1, k1], 1.2)).toEqual(['k1']);
    // 10 % Reserve (0,50 $): mit 0,55 $ Rest passt keine kleine (0,08 $) mehr … mit 0,60 $ genau eine
    expect(ids([k1, k2], 0.55)).toEqual([]);
    expect(ids([k1, k2], 0.6)).toEqual(['k1']);
    expect(KOSTEN_USD.klein).toBeLessThan(KOSTEN_USD.mittel);
    expect(KOSTEN_USD.mittel).toBeLessThan(KOSTEN_USD.gross);
  });

  it('Katalog: 18 Aktivitäten, eindeutige IDs, jede mit Auftrag und Ergebnis-Ort; die Vorlage nennt genau diese', async () => {
    expect(KATALOG).toHaveLength(18);
    expect(new Set(KATALOG.map((a) => a.id)).size).toBe(KATALOG.length);
    for (const a of KATALOG) {
      expect(a.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(a.auftrag.length).toBeGreaterThan(80);
      expect(a.ergebnis.length).toBeGreaterThan(5);
    }
    const { d } = await aufbau();
    const { e, fehler } = await rundgangEinstellungen(d.vault);
    expect(fehler).toBeNull();
    expect(Object.keys(e.aktivitaeten).sort()).toEqual(KATALOG.map((a) => a.id).sort());
    for (const a of KATALOG) expect(e.aktivitaeten[a.id]).toBe(a.haeufigkeit);
  });
});

describe('00_Stadtordnung/rundgang.md (E192)', () => {
  it('gültig: an/ab, Häufigkeiten, Schreibweisen; fehlt die Datei, gelten die Standardwerte ohne Fehler', async () => {
    const x = await aufbau();
    await x.rundgangMd('aktivitaeten_je_rundgang: 3\nmeldung: nein\naktivitaeten:\n  vault-pflegen: aus\n  leif-kennenlernen: Täglich\n  todos-doppelt: nein\n  uni-lernstand: alle 3 Tage\n  notizen-sichten: woechentlich\n  dorf-gesundheit: false');
    const r = await rundgangEinstellungen(x.d.vault);
    expect(r.fehler).toBeNull();
    expect(r.e).toEqual({
      aktivitaeten_je_rundgang: 3,
      meldung: false,
      aktivitaeten: { 'vault-pflegen': 'aus', 'leif-kennenlernen': 'täglich', 'todos-doppelt': 'aus', 'uni-lernstand': 'alle 3 tage', 'notizen-sichten': 'wöchentlich', 'dorf-gesundheit': 'aus' },
    });
    const stand = await x.d.aufwachen.rundgang.uebersicht();
    expect(stand.jeRundgang).toBe(3);
    expect(stand.aktivitaeten.find((a) => a.id === 'vault-pflegen')).toMatchObject({ aktiv: false, haeufigkeit: 'aus' });
    // nicht genannt → Standard des Katalogs
    expect(stand.aktivitaeten.find((a) => a.id === 'gedaechtnis-verdichten')).toMatchObject({ aktiv: true, haeufigkeit: 'monatlich', zuletzt: null });
    await x.d.vault.loeschen(RUNDGANG_PFAD);
    expect(await rundgangEinstellungen(x.d.vault)).toMatchObject({ fehler: null, e: { aktivitaeten_je_rundgang: 2, meldung: true, aktivitaeten: {} } });
  });

  it('Fehler werden angezeigt, und bis dahin gelten die Standardwerte', async () => {
    const x = await aufbau();
    const pruefen = async (kopf: string, muster: RegExp) => {
      await x.rundgangMd(kopf);
      const r = await rundgangEinstellungen(x.d.vault);
      expect(r.fehler).toMatch(muster);
      expect(r.fehler).toContain('gelten die Standardwerte');
      expect(r.e).toEqual({ aktivitaeten_je_rundgang: 2, meldung: true, aktivitaeten: {} });
    };
    await pruefen('aktivitaeten:\n  vault-pflegn: wöchentlich', /aktivitaeten\.vault-pflegn: unbekannte Aktivität – bekannt sind: .*vault-pflegen/);
    await pruefen('aktivitaeten:\n  vault-pflegen: stündlich', /aktivitaeten\.vault-pflegen: erlaubt sind: aus, jedes, täglich/);
    await pruefen('aktivitaeten_je_rundgang: 9', /aktivitaeten_je_rundgang/);
    await pruefen('aktivitäten:\n  vault-pflegen: aus', /Kopf: /);
    await pruefen('aktivitaeten: [vault-pflegen', /Kopf nicht lesbar/);
    // sichtbar in der App (Rathaus) – und als Punkt der Aktivität „Dorf-Gesundheit“
    expect((await x.d.aufwachen.rundgang.uebersicht()).fehler).toContain('Kopf nicht lesbar');
  });
});

describe('Eigene To-do-Liste des Bürgermeisters (E192)', () => {
  it('„Offen“ aus der Zusammenfassung: Aufzählung, Fließtext, „Offen: …“; „Nichts“ zählt nicht', () => {
    expect(offenePunkte('### Auftrag\nx\n### Getan\ny\n### Offen\n- Leif muss die Mail abschicken\n- Antwort vom Prüfungsamt\n  abwarten (bis Freitag)\n### Auffälligkeiten\n–')).toEqual([
      'Leif muss die Mail abschicken',
      'Antwort vom Prüfungsamt abwarten (bis Freitag)',
    ]);
    expect(offenePunkte('**Offen:** Helfer „Moodle durchsehen“ läuft noch.\n**Auffälligkeiten:** keine')).toEqual(['Helfer „Moodle durchsehen“ läuft noch.']);
    expect(offenePunkte('### Offen\nDer Entwurf liegt in Gmail,\nLeif schickt ihn selbst ab.\n\n### Auffälligkeiten\n–')).toEqual(['Der Entwurf liegt in Gmail, Leif schickt ihn selbst ab.']);
    for (const nichts of ['Nichts.', '–', '-', 'Keine offenen Punkte.', '(nichts)', 'nichts offen', '- –', '- Nichts'])
      expect(offenePunkte(`### Getan\nx\n### Offen\n${nichts}\n### Auffälligkeiten\n–`)).toEqual([]);
    expect(offenePunkte('### Getan\nAlles offen gelassen')).toEqual([]);
    expect(offenePunkte(null)).toEqual([]);
  });

  it('anlegen, lesen (fällige zuerst), erledigen, verschieben – nur über seine Werkzeuge, mit Bezug zur Aufgabe', async () => {
    const x = await aufbau();
    const { werkzeug } = { werkzeug: w };
    const r = await x.auftrag(
      [
        'Schreib der Professorin',
        werkzeug('meine_todos_anlegen', { titel: 'Nachsehen, ob Leif die Mail abgeschickt hat', wieder_am: '2026-11-19', notiz: 'Entwurf liegt in Gmail' }),
        werkzeug('meine_todos_anlegen', { titel: 'Antwort der Professorin einarbeiten' }),
        werkzeug('meine_todos_anlegen', { titel: 'Antwort der  Professorin einarbeiten!' }), // dasselbe noch einmal
        werkzeug('meine_todos_anlegen', { titel: 'x' }),
        werkzeug('meine_todos_lesen', {}),
      ].join('\n'),
    );
    const t = x.werkzeugTexte(r.chatId);
    expect(t[0]).toMatch(/^meine_todos_anlegen: Auf deiner Liste: \[ \] Nachsehen, ob Leif die Mail abgeschickt hat \(wieder ansehen am 2026-11-19\) · Bezug: Schreibtisch: „Schreib der Professorin“ \(\[\[Rathaus\/schreibtisch\/.+\]\]\) – Rathaus\/buergermeister-todos\/2026-11-16_\d{4}_nachsehen-ob-leif-die-mail-abgeschickt-h\.md$/);
    expect(t[1]).toMatch(/^meine_todos_anlegen: Auf deiner Liste: \[ \] Antwort der Professorin einarbeiten \(FÄLLIG\)/);
    expect(t[2]).toMatch(/^meine_todos_anlegen: \(verweigert\) Das steht schon auf deiner Liste/);
    expect(t[3]).toMatch(/^meine_todos_anlegen: \(verweigert\) Ungültige Eingabe: titel: Titel fehlt/);
    // lesen: das Fällige steht vor dem, das erst am 19. wieder dran ist
    expect(t[4]).toMatch(/Deine To-do-Liste \(2 offen, davon 1 fällig\)/);
    expect(t[4]!.indexOf('Antwort der Professorin')).toBeLessThan(t[4]!.indexOf('Nachsehen, ob Leif'));
    expect(t[4]).toContain('Entwurf liegt in Gmail');

    const liste = await x.mt.liste();
    expect(liste.map((e) => [e.titel, e.faellig, e.quelle, e.chatId])).toEqual([
      ['Antwort der Professorin einarbeiten', true, 'Bürgermeister', r.chatId],
      ['Nachsehen, ob Leif die Mail abgeschickt hat', false, 'Bürgermeister', r.chatId],
    ]);
    // Obsidian-tauglich: eine Datei je Eintrag mit Frontmatter
    const datei = (await x.d.vault.lesen(liste[1]!.pfad)).inhalt;
    expect(datei).toMatch(/^---\ntitel: 'Nachsehen, ob Leif die Mail abgeschickt hat'\nstatus: offen\nwieder_am: '2026-11-19'\nbezug: /);
    expect(datei).toContain('Entwurf liegt in Gmail');

    // nächster Lauf im selben Chat: eines verschieben, eines erledigen
    x.d.agenten.nachrichtSenden(r.chatId, [w('meine_todos_erledigen', { pfad: liste[0]!.pfad, wieder_am: '2026-11-20', ergebnis: 'noch keine Antwort' }), w('meine_todos_erledigen', { pfad: liste[1]!.pfad, ergebnis: 'Mail ist raus' }), w('meine_todos_erledigen', { pfad: 'Rathaus/memory.md' })].join('\n'));
    await x.d.agenten.leerlauf();
    const t2 = x.werkzeugTexte(r.chatId).slice(5);
    expect(t2[0]).toMatch(/^meine_todos_erledigen: Verschoben: \[ \] Antwort der Professorin einarbeiten \(wieder ansehen am 2026-11-20\)/);
    expect(t2[1]).toMatch(/^meine_todos_erledigen: Erledigt: \[x\] Nachsehen, ob Leif die Mail abgeschickt hat/);
    expect(t2[2]).toMatch(/^meine_todos_erledigen: \(verweigert\) Kein Eintrag deiner Liste/);
    const danach = await x.mt.liste();
    expect(danach.map((e) => [e.titel, e.erledigt, e.faellig])).toEqual([
      ['Antwort der Professorin einarbeiten', false, false],
      ['Nachsehen, ob Leif die Mail abgeschickt hat', true, false],
    ]);
    expect((await x.d.vault.lesen(danach[1]!.pfad)).inhalt).toContain('**Ergebnis (2026-11-16):** Mail ist raus');
    expect((await x.d.vault.lesen(danach[0]!.pfad)).inhalt).toContain('**Stand (2026-11-16):** noch keine Antwort');
    // am 20. ist das verschobene wieder fällig
    x.d.uhr.vor(4 * TAG);
    expect((await x.mt.faellige()).map((e) => e.titel)).toEqual(['Antwort der Professorin einarbeiten']);
    // Leif hakt in der App ab bzw. öffnet wieder; Löschen = Papierkorb
    await x.mt.erledigen(danach[0]!.pfad, { erledigt: true });
    expect(await x.mt.faellige()).toEqual([]);
    await x.mt.erledigen(danach[0]!.pfad, { erledigt: false });
    expect(await x.mt.loeschen(danach[0]!.pfad)).toMatch(/^\.papierkorb\//);
    // im Systemprompt jedes Bürgermeister-Laufs steht die Liste samt Regel
    const noch = await x.mt.anlegen({ titel: 'Prüfungsamt nachfassen' }, 'Leif');
    const { wissenLaden } = await import('../src/agenten/gedaechtnis.js');
    const wissen = await wissenLaden(x.d.vault, x.mt);
    expect(wissen.eigeneTodos).toContain(`<meine_todos ordner="${MEINE_TODOS_ORDNER}" offen="1" faellig="1">`);
    expect(wissen.eigeneTodos).toContain(`[ ] Prüfungsamt nachfassen (FÄLLIG) · von: Leif – ${noch.pfad}`);
    expect(wissen.eigeneTodos).toContain('Am Ende JEDES Laufs');
  });

  it('automatische Übernahme aus „Offen“, wenn er es nicht selbst einträgt – ohne Dubletten', async () => {
    let offen = '- Leif muss den Entwurf abschicken\n- In drei Tagen nachfassen, ob das Prüfungsamt geantwortet hat';
    const x = await aufbau({ api: mitAntwort((t) => t.replace('### Offen\nNichts.', `### Offen\n${offen}`)) });
    // Bürgermeister über api (wie beim Aufwachen): die Attrappe „api“ liefert hier den Offen-Abschnitt
    const a = await x.d.schreibtisch.anlegen({ text: 'Frag beim Prüfungsamt nach der Anrechnung', quelle: 'app' });
    const r = await x.d.buergermeister.starten(a.id, 'zeitplan');
    await x.d.agenten.leerlauf();
    let liste = (await x.mt.liste()).sort((p, q) => q.titel.localeCompare(p.titel));
    expect(liste.map((e) => [e.titel, e.wiederAm, e.quelle, e.chatId])).toEqual([
      ['Leif muss den Entwurf abschicken', '2026-11-17', 'Dorf (aus „Offen“ übernommen)', r.chatId],
      ['In drei Tagen nachfassen, ob das Prüfungsamt geantwortet hat', '2026-11-17', 'Dorf (aus „Offen“ übernommen)', r.chatId],
    ]);
    expect(liste[0]!.bezug).toMatch(/^Schreibtisch: „Frag beim Prüfungsamt nach der Anrechnung“ \(\[\[Rathaus\/schreibtisch\//);
    // zweiter Lauf im selben Chat nennt dieselben Punkte noch einmal → nichts doppelt
    x.d.agenten.nachrichtSenden(r.chatId, 'Und?', 'zeitplan');
    await x.d.agenten.leerlauf();
    expect(await x.mt.liste()).toHaveLength(2);
    // auch nicht, nachdem einer erledigt ist (derselbe Punkt aus demselben Chat entsteht nie zweimal)
    await x.mt.erledigen(liste[0]!.pfad);
    x.d.agenten.nachrichtSenden(r.chatId, 'Noch etwas?', 'zeitplan');
    await x.d.agenten.leerlauf();
    liste = await x.mt.liste();
    expect(liste.filter((e) => !e.erledigt).map((e) => e.titel)).toEqual(['In drei Tagen nachfassen, ob das Prüfungsamt geantwortet hat']);
    expect(liste).toHaveLength(2);
    // trägt er in dem Lauf selbst etwas ein, übernimmt der Code nichts zusätzlich
    offen = '- Ein ganz anderer Punkt';
    x.d.agenten.nachrichtSenden(r.chatId, w('meine_todos_anlegen', { titel: 'Selbst notiert' }), 'zeitplan');
    await x.d.agenten.leerlauf();
    expect((await x.mt.liste()).filter((e) => !e.erledigt).map((e) => e.titel).sort()).toEqual(['In drei Tagen nachfassen, ob das Prüfungsamt geantwortet hat', 'Selbst notiert']);
    // Helfer und andere Agenten: ihr „Offen“ wird nicht übernommen
    const h = await x.d.agenten.helferStarten({ gebaeude: 'Bibliothek', titel: 'Helfer', auftrag: 'x', stufe: 'klein', ausloeser: 'zeitplan', herkunft: { elternChatId: r.chatId } });
    await x.d.agenten.leerlauf();
    expect(x.d.agenten.chatDetail(h.chatId).laeufe[0]).toMatchObject({ motor: 'api', status: 'fertig' });
    // (danach weckt das Dorf den Bürgermeister mit dem Helfer-Ergebnis – dessen eigener Lauf darf den Punkt übernehmen, aber genau einmal)
    const amEnde = await x.mt.liste();
    expect(amEnde.every((e) => e.chatId === r.chatId)).toBe(true);
    expect(amEnde.filter((e) => e.titel === 'Ein ganz anderer Punkt').length).toBeLessThanOrEqual(1);
  });

  it('Leine: nur der Bürgermeister hat meine_todos_* – kein Profil, kein Helfer, kein Umweg über vault_schreiben', async () => {
    // kein Werkzeugprofil einer Aktion enthält sie, egal welche Werkzeuge sie nennt
    const alle = ['vault_lesen', 'vault_suchen', 'vault_schreiben', 'web', 'rechenraum', 'post', 'moodle', 'kalender'] as const;
    const profil = werkzeugprofil({ werkzeuge: [...alle], fremdinhalte: true });
    for (const n of MEINE_TODOS_WERKZEUGE) {
      expect(profil.dorf).not.toContain(n);
      expect(BUERGERMEISTER_WERKZEUGE).toContain(n);
      expect(WERKZEUG_DEFINITIONEN[n].description).toMatch(/^Nur für den Bürgermeister/);
    }
    expect(HELFER_FAEHIGKEITEN as readonly string[]).not.toContain('meine_todos');
    // der Ordner ist für vault_schreiben/vault_aendern/vault_verschieben gesperrt – auch für Agenten im Rathaus
    const p = 'Rathaus/buergermeister-todos/2026-11-16_1300_test.md';
    expect(schreibenPruefen({ gebaeude: 'Rathaus', pfad: p, existiert: false, vonDiesemChat: false })).toMatch(/führt nur er selbst/);
    expect(pflegePruefen('Rathaus', p)).toMatch(/führt nur er selbst/);

    const x = await aufbau();
    // Bürgermeister: erlaubt
    const bm = await x.auftrag(w('meine_todos_anlegen', { titel: 'Vom Bürgermeister' }));
    expect(x.werkzeugTexte(bm.chatId)[0]).toMatch(/^meine_todos_anlegen: Auf deiner Liste/);
    // freier Helfer im Rathaus (alle Fähigkeiten) und eine Aktion: verweigert, nichts entsteht
    const befehle = [w('meine_todos_anlegen', { titel: 'Vom Helfer untergeschoben' }), w('meine_todos_lesen', {}), w('meine_todos_erledigen', { pfad: (await x.mt.liste())[0]!.pfad }), `[schreibe ${p}]`].join('\n');
    const h = await x.d.agenten.helferStarten({ gebaeude: 'Rathaus', titel: 'Helfer', auftrag: befehle, stufe: 'klein', ausloeser: 'buergermeister', herkunft: { elternChatId: bm.chatId }, faehigkeiten: [...HELFER_FAEHIGKEITEN] });
    await x.d.agenten.leerlauf();
    const t = x.werkzeugTexte(h.chatId);
    expect(t.filter((z) => /^meine_todos_\w+: \(verweigert\) Werkzeug „meine_todos_\w+“ ist für diese Aktion nicht erlaubt\./.test(z))).toHaveLength(3);
    expect(t.find((z) => z.startsWith('vault_schreiben'))).toMatch(/Verweigert: Die To-do-Liste des Bürgermeisters führt nur er selbst/);
    expect((await x.mt.liste()).map((e) => [e.titel, e.erledigt])).toEqual([['Vom Bürgermeister', false]]);
    expect(await x.d.vault.existiert(p)).toBe(false);
    // selbst mit dem Namen in der Erlaubt-Liste: ohne die Rolle (LaufKontext.meineTodos) lehnt die Kiste ab
    const { WerkzeugKiste } = await import('../src/agenten/werkzeuge.js');
    const kiste = new WerkzeugKiste(x.d.db, x.d.uhr, x.d.vault, x.d.suche, x.d.agenten.freigaben, { laufId: x.d.agenten.chatDetail(h.chatId).laeufe[0]!.id, chatId: h.chatId, gebaeude: 'Rathaus', erlaubt: [...MEINE_TODOS_WERKZEUGE] });
    expect(await kiste.aufrufen('meine_todos_anlegen', { titel: 'Ohne Rolle' })).toEqual({ ok: false, text: 'Dieses Werkzeug hat nur der Bürgermeister.' });
    expect(await x.mt.liste()).toHaveLength(1);
  });

  it('Gedächtnis: Kontonummern und Kontostände werden abgelehnt, Muster nicht', () => {
    const basis = '# Gedächtnis\n\n## Leifs Vorlieben und Arbeitsweise\n- Mails an Lehrende: kurz, Sie-Form, ohne Floskeln (3×).\n- Will einen fertigen Vorschlag statt Rückfragen.\n';
    expect(textPruefen(basis, MAX_GEDAECHTNIS)).toBeNull();
    expect(textPruefen(`${basis}- Budget für Lebensmittel reicht meist nicht – früh im Monat warnen.\n`, MAX_GEDAECHTNIS)).toBeNull();
    expect(textPruefen(`${basis}- Miete geht von AT61 1904 3002 3457 3201 ab.\n`, MAX_GEDAECHTNIS)).toMatch(/IBAN/);
    expect(textPruefen(`${basis}- Konto DE89370400440532013000\n`, MAX_GEDAECHTNIS)).toMatch(/IBAN/);
    expect(textPruefen(`${basis}- Kontostand Ende Oktober: 1.234,56 €\n`, MAX_GEDAECHTNIS)).toMatch(/Kontostände/);
  });
});

describe('Aufwachen: eigene To-dos, Lagebericht, Katalog (E192)', () => {
  it('fällige eigene To-dos zuerst – auch ohne Rundgang-Erlaubnis; nicht fällige wecken ihn nicht; nach 3× Vorlegen ruht der Eintrag', async () => {
    const x = await aufbau({ aufwachen: ['eigene_aufgaben: ja', 'eigene_aufgaben: nein'] });
    await x.mt.anlegen({ titel: 'Erst nächste Woche', wieder_am: '2026-11-23' }, 'Bürgermeister');
    expect(await x.d.aufwachen.aufwachen()).toMatchObject({ rundgang: null, eigeneTodos: 0 });
    expect(x.d.db.prepare('SELECT COUNT(*) AS n FROM laeufe').get()).toEqual({ n: 0 });

    const t = await x.mt.anlegen({ titel: 'Nachsehen, ob der Helfer fertig ist', notiz: 'Chat Moodle durchsehen' }, 'Bürgermeister');
    for (let i = 1; i <= MAX_VORGELEGT; i++) {
      const r = await x.d.aufwachen.aufwachen();
      expect(r).toMatchObject({ eigeneTodos: 1, aktivitaeten: [], lagebericht: null });
      await x.d.agenten.leerlauf();
      const a = x.d.schreibtisch.holen(r.rundgang!);
      const notiz = (await x.d.vault.lesen(a.pfad)).inhalt;
      expect(notiz).toContain('## Zuerst: deine fälligen eigenen To-dos');
      expect(notiz).toContain(`[ ] Nachsehen, ob der Helfer fertig ist (FÄLLIG) – ${t.pfad}`);
      expect(notiz).toContain('Chat Moodle durchsehen');
      expect(notiz).not.toContain('Erst nächste Woche');
      expect(notiz).toContain('Diesmal keine');
      expect(x.d.agenten.chatDetail(a.chatId!).laeufe[0]).toMatchObject({ motor: 'api', ausloeser: 'zeitplan' });
      expect((await x.mt.holen(t.pfad)).vorgelegt).toBe(i);
      x.d.uhr.vor(4 * STUNDE);
    }
    // die Attrappe hat nie erledigt oder verschoben → jetzt legt das Dorf den Eintrag eine Woche weg, kein weiterer Lauf
    const laeufe = (x.d.db.prepare('SELECT COUNT(*) AS n FROM laeufe').get() as { n: number }).n;
    expect(await x.d.aufwachen.aufwachen()).toMatchObject({ rundgang: null, eigeneTodos: 0 });
    expect((x.d.db.prepare('SELECT COUNT(*) AS n FROM laeufe').get() as { n: number }).n).toBe(laeufe);
    const geruht = await x.mt.holen(t.pfad);
    expect(geruht).toMatchObject({ faellig: false, wiederAm: '2026-11-24' });
    expect(geruht.notiz).toContain('3× beim Aufwachen vorgelegt');
    expect(x.texte).toHaveLength(0); // kein Telegram
  });

  it('neuer Anlass → Lagebericht mit den eigenen To-dos obenan, ohne Katalog; Budget erreicht → gar nichts', async () => {
    const x = await aufbau({ fristen: kal(ev('a', '⏰ CDA: Übung 3 ist fällig', '20261117T225900Z')) });
    await x.mt.anlegen({ titel: 'Entwurf an Frau Leemhuis prüfen' }, 'Bürgermeister');
    await x.d.todos.anlegen({ titel: 'Steuererklärung', faellig: '2026-11-05' }, 'Leif'); // wäre ein Anlass für den Katalog
    const r = await x.d.aufwachen.aufwachen();
    expect(r).toMatchObject({ neu: 1, rundgang: null, eigeneTodos: 1, aktivitaeten: [] });
    await x.d.agenten.leerlauf();
    const notiz = (await x.d.vault.lesen(x.d.schreibtisch.holen(r.lagebericht!).pfad)).inhalt;
    expect(notiz.indexOf('## Zuerst: deine fälligen eigenen To-dos')).toBeGreaterThan(0);
    expect(notiz.indexOf('## Zuerst: deine fälligen eigenen To-dos')).toBeLessThan(notiz.indexOf('<fremdinhalt quelle="lagebericht">'));
    expect(notiz).toContain('Entwurf an Frau Leemhuis prüfen');
    expect(notiz).not.toContain('Aktivitäten dieses Rundgangs');
    // Tagesbudget aufgebraucht → weder eigene To-dos noch Katalog
    const jetzt = x.d.uhr.jetzt();
    x.d.db.prepare("INSERT INTO chats (id, gebaeude, titel, motor, stufe, modell, erstellt, geaendert, rolle) VALUES ('sys', 'Post', 'Post: Einordnung', 'api', 'klein', 'm', ?, ?, 'system')").run(jetzt, jetzt);
    x.d.db
      .prepare("INSERT INTO laeufe (id, chat_id, nummer, motor, modell, stufe, aufwand, status, ausloeser, auftrag, erstellt, kosten_usd) VALUES ('teuer', 'sys', 1, 'api', 'm', 'klein', 'low', 'fertig', 'zeitplan', 'x', ?, 5.2)")
      .run(jetzt);
    x.d.uhr.vor(4 * STUNDE);
    expect(await x.d.aufwachen.aufwachen()).toMatchObject({ budgetErreicht: true, rundgang: null, eigeneTodos: 0, aktivitaeten: [] });
  });

  it('E195: scheitert die Prüfung einer Aktivität (Fehler im Code/Netz), ist das kein Anlass – nur geprüft und gemeldet', async () => {
    const { d } = await aufbau();
    await d.todos.anlegen({ titel: 'Steuererklärung', faellig: '2026-11-05' }, 'Leif'); // echter Anlass für „todos-ueberfaellig“
    const meldungen: string[] = [];
    d.aufwachen.rundgang.ergaenzen({ log: (t) => meldungen.push(t) });
    const original = KATALOG.map((a) => a.fakten);
    try {
      for (const a of KATALOG)
        a.fakten = async () => {
          throw new Error('Kalender nicht erreichbar');
        };
      const wahl = await d.aufwachen.rundgang.waehlen({ restbudget: 10, tagesbudget: 10, nacht: false });
      // früher: jede gescheiterte Prüfung galt als Anlass (leere Fakten) – die KI lief ohne Grund los
      expect(wahl).toEqual([]);
      expect(meldungen.length).toBeGreaterThan(0);
      expect(meldungen[0]).toMatch(/Rundgang: Prüfung „.+“ fehlgeschlagen: Kalender nicht erreichbar/);
      expect(d.aufwachen.rundgang.zuletzt()).toEqual({});
    } finally {
      KATALOG.forEach((a, i) => (a.fakten = original[i]));
    }
    // als geprüft gemerkt: gleich danach wird nicht noch einmal geprüft, nach der Frist (20 h) wieder – jetzt mit Anlass
    expect(await d.aufwachen.rundgang.waehlen({ restbudget: 10, tagesbudget: 10, nacht: false })).toEqual([]);
    d.uhr.vor(21 * STUNDE);
    expect((await d.aufwachen.rundgang.waehlen({ restbudget: 10, tagesbudget: 10, nacht: false })).map((x) => x.aktivitaet.id)).toContain('todos-ueberfaellig');
    await d.app.close();
  });

  it('Rundgang mit der Attrappe: Katalog nach Fälligkeit, Budget und Nacht; abgeschaltet = nie; Protokoll, Sammelmeldung, kein Telegram', async () => {
    const x = await aufbau({ api: mitAntwort((t) => t.replace('## Zusammenfassung', 'Für Leif: Zwei überfällige To-dos in kleine Schritte zerlegt.\n\n## Zusammenfassung')) });
    const { d } = x;
    // Anlässe: überfälliges To-do (klein, täglich), zwei gleiche To-dos (klein, wöchentlich), Recherche-To-do (groß, nur tagsüber)
    await d.todos.anlegen({ titel: 'Steuererklärung', faellig: '2026-11-05' }, 'Leif');
    await d.todos.anlegen({ titel: 'Milch kaufen' }, 'Leif');
    d.uhr.vor(60_000);
    await d.todos.anlegen({ titel: 'milch kaufen!' }, 'Leif');
    await d.todos.anlegen({ titel: 'Recherchieren: Auslandssemester Fristen' }, 'Leif');
    // sein eigenes fälliges To-do führt in der Attrappe ein Werkzeug aus (Datei schreiben = „Tat“, die früher eine Telegram-Meldung auslöste)
    await x.mt.anlegen({ titel: 'Aufräum-Notiz schreiben [schreibe Rathaus/aufraeumen/2026-11-16_1300_test.md]' }, 'Bürgermeister');
    // 23:00 in Wien: nur stille Pflege – die Recherche (groß, nicht nachts) fehlt, es bleibt bei zwei kleinen
    d.uhr.vor(10 * STUNDE - 60_000);
    const r = await d.aufwachen.aufwachen();
    expect(r).toMatchObject({ lagebericht: null, eigeneTodos: 1, aktivitaeten: ['todos-ueberfaellig', 'todos-doppelt'] });
    await d.agenten.leerlauf();
    const a = d.schreibtisch.holen(r.rundgang!);
    const notiz = (await d.vault.lesen(a.pfad)).inhalt;
    // Reihenfolge im Auftrag: eigene To-dos, dann die Aktivitäten, dann die Regeln
    const stellen = ['## Zuerst: deine fälligen eigenen To-dos', '## Danach: die Aktivitäten dieses Rundgangs', '### A – Überfällige To-dos zerlegen', '### B – Doppelte To-dos zusammenführen', '## Regeln für den Rundgang'].map((s) => notiz.indexOf(s));
    expect(stellen.every((s) => s > 0)).toBe(true);
    expect([...stellen].sort((p, q) => p - q)).toEqual(stellen);
    expect(notiz).toContain('<fremdinhalt quelle="rundgang-todos-doppelt">');
    expect(notiz).toMatch(/„milch kaufen!“ – Marktplatz\/todos\/.+ {2}== {2}„Milch kaufen“ – Marktplatz\/todos\//);
    expect(notiz).toContain('Es ist Nacht');
    expect(notiz).not.toContain('Recherche auf Vorrat');
    // die Attrappe hat geschrieben – trotzdem KEINE einzelne Telegram-Meldung für den Rundgang
    expect(await d.vault.existiert('Rathaus/aufraeumen/2026-11-16_1300_test.md')).toBe(true);
    expect(x.texte).toHaveLength(0);
    // Rundgang-Protokoll vom Code: Uhrzeit, Aktivitäten, Getan, Für Leif
    const protokoll = (await d.vault.lesen('Rathaus/rundgang/2026-11-16.md')).inhalt;
    expect(protokoll).toMatch(/- \*\*23:00\*\* Rundgang · eigene To-dos fällig: 1 · Aktivitäten: Überfällige To-dos zerlegen, Doppelte To-dos zusammenführen · Getan: Test-Lauf\. · Für Leif: Zwei überfällige To-dos in kleine Schritte zerlegt\. · \[Chat\]\(\/chats\/[0-9a-f-]+\)/);
    // gemerkt, wann was dran war (App zeigt es)
    const stand = await d.aufwachen.rundgang.uebersicht();
    expect(stand.aktivitaeten.find((s) => s.id === 'todos-doppelt')!.zuletzt).toBe(new Date(d.uhr.jetzt()).toISOString());
    expect(stand.aktivitaeten.find((s) => s.id === 'recherche-auf-vorrat')!.zuletzt).toBeNull();

    // Sammelmeldung: einmal, in der Morgenzeitung (nicht einzeln, nicht nachts)
    const bm = async () => (await d.morgenzeitung.fakten()).abschnitte.find((s) => s.titel === 'Der Bürgermeister seit gestern')?.zeilen ?? [];
    expect(await bm()).toEqual(['🧭 23:00 – Zwei überfällige To-dos in kleine Schritte zerlegt.']);
    // … und abschaltbar
    await x.rundgangMd('meldung: nein\naktivitaeten:\n  recherche-auf-vorrat: aus\n  todos-doppelt: täglich');
    expect((await bm()).join(' ')).not.toContain('🧭');

    // 03:00: zu früh für die täglichen (20 h) – und sein To-do bekam er schon vorgelegt, also wieder ein Lauf nur dafür
    d.uhr.vor(4 * STUNDE);
    expect(await d.aufwachen.aufwachen()).toMatchObject({ eigeneTodos: 1, aktivitaeten: [] });
    await d.agenten.leerlauf();
    await x.mt.erledigen((await x.mt.faellige())[0]!.pfad);
    // nächster Tag 20:00: beide wieder fällig (todos-doppelt jetzt täglich), Recherche ist abgeschaltet → trotz Tag nicht dabei
    d.uhr.vor(17 * STUNDE);
    expect(await d.aufwachen.aufwachen()).toMatchObject({ eigeneTodos: 0, aktivitaeten: ['todos-ueberfaellig', 'todos-doppelt'] });
    await d.agenten.leerlauf();
    // wieder angeschaltet, am Tag, volles Budget am übernächsten Tag: die Recherche kommt als Erste (noch nie gemacht), dazu eine kleine
    await x.rundgangMd('aktivitaeten:\n  todos-doppelt: aus');
    d.uhr.vor(21 * STUNDE); // Mi 17:00
    const r3 = await d.aufwachen.aufwachen();
    expect(r3.aktivitaeten).toEqual(['recherche-auf-vorrat', 'todos-ueberfaellig']);
    await d.agenten.leerlauf();
    expect((await d.vault.lesen(d.schreibtisch.holen(r3.rundgang!).pfad)).inhalt).toContain('To-do: „Recherchieren: Auslandssemester Fristen“');
    // knappes Restbudget (unter der Hälfte): die teure Recherche bliebe weg – hier über einen teuren Lauf heute nachgestellt
    const jetzt = d.uhr.jetzt();
    d.db.prepare("INSERT INTO chats (id, gebaeude, titel, motor, stufe, modell, erstellt, geaendert, rolle) VALUES ('sys', 'Post', 'Post: Einordnung', 'api', 'klein', 'm', ?, ?, 'system')").run(jetzt, jetzt);
    d.db
      .prepare("INSERT INTO laeufe (id, chat_id, nummer, motor, modell, stufe, aufwand, status, ausloeser, auftrag, erstellt, kosten_usd) VALUES ('teuer', 'sys', 1, 'api', 'm', 'klein', 'low', 'fertig', 'zeitplan', 'x', ?, 3)")
      .run(jetzt + TAG);
    await x.rundgangMd('aktivitaeten:\n  recherche-auf-vorrat: täglich\n  todos-doppelt: aus');
    d.uhr.vor(26 * STUNDE); // Do 19:00, heute schon 3 $ von 5 $ weg
    expect(d.aufwachen.verbrauchHeute()).toBeGreaterThanOrEqual(3);
    expect((await d.aufwachen.aufwachen()).aktivitaeten).toEqual(['todos-ueberfaellig']);
    await d.agenten.leerlauf();
  });

  it('Leif kennenlernen: Ablehnungen mit Grund, „Rückgängig“ und Korrekturen als Fakten; ohne Neues kein Lauf', async () => {
    const x = await aufbau();
    const { d } = x;
    await x.rundgangMd(`aktivitaeten_je_rundgang: 1\naktivitaeten:\n${KATALOG.filter((a) => a.id !== 'leif-kennenlernen').map((a) => `  ${a.id}: aus`).join('\n')}`);
    // nichts gesammelt → der Code wählt die Aktivität nicht, kein KI-Lauf
    expect(await d.aufwachen.aufwachen()).toMatchObject({ rundgang: null, aktivitaeten: [] });
    // Leif lehnt einen Plan mit Grund ab und korrigiert im Chat
    const r = await x.auftrag('Plane meine Woche [plan Bibliothek|Teil A]');
    const f = d.agenten.freigaben.liste('offen')[0]!;
    await d.agenten.freigaben.entscheiden(f.id, false, 'leif', 'Zu viele Helfer für so etwas Kleines – mach es selbst.');
    await d.agenten.leerlauf();
    d.agenten.nachrichtSenden(r.chatId, 'Bitte kürzer und ohne Floskeln.');
    await d.agenten.leerlauf();
    d.uhr.vor(21 * STUNDE); // der Code sieht frühestens nach 20 h wieder nach
    const auf = await d.aufwachen.aufwachen();
    expect(auf.aktivitaeten).toEqual(['leif-kennenlernen']);
    await d.agenten.leerlauf();
    const notiz = (await d.vault.lesen(d.schreibtisch.holen(auf.rundgang!).pfad)).inhalt;
    expect(notiz).toContain('### A – Leif kennenlernen');
    expect(notiz).toContain('## Leifs Vorlieben und Arbeitsweise');
    expect(notiz).toContain('NIE hinein: Mailtexte');
    expect(notiz).toContain('<fremdinhalt quelle="rundgang-leif-kennenlernen">');
    expect(notiz).toMatch(/Abgelehnt \(plan_ausfuehren\): „Plan: Testplan“ – Leifs Grund: „Zu viele Helfer für so etwas Kleines – mach es selbst\.“/);
    expect(notiz).toMatch(/Leifs Nachtrag\/Korrektur im Chat „.+“ \(Rathaus\): „Bitte kürzer und ohne Floskeln\.“/);
    expect(notiz).toContain('Protokolle deiner letzten Läufe');
    // die Vorlage des Gedächtnisses hat den Abschnitt schon
    expect((await d.vault.lesen('Rathaus/memory.md')).inhalt).toContain('## Leifs Vorlieben und Arbeitsweise');
  });

  it('Vault-Befund ohne KI: Konfliktkopien, inhaltsgleiche Notizen, tote Links (nicht in Anleitungen und Code), leere Notizen', async () => {
    const x = await aufbau();
    const lang = 'Lineare Algebra, Kapitel 3: Eigenwerte und Eigenvektoren. '.repeat(6);
    await x.d.vault.schreiben('Bibliothek/a.md', `---\ntitel: A\n---\n${lang}`);
    await x.d.vault.schreiben('Uni/kopie-von-a.md', lang);
    await x.d.vault.schreiben('Bibliothek/links.md', 'Siehe [[a]], [[Bibliothek/a|so]], [[Uni]], [[gibt-es-nicht]] und `[[im-code]]`.');
    await x.d.vault.schreiben('Bibliothek/leer.md', '---\ntitel: Leer\n---\n');
    await x.d.vault.schreiben('Bibliothek/a.konflikt-2026-11-16-1200.md', 'alt');
    const b = await vaultBefund(x.d.vault);
    expect(b.konflikte).toEqual(['Bibliothek/a.konflikt-2026-11-16-1200.md']);
    expect(b.doppelt).toEqual([['Bibliothek/a.md', 'Uni/kopie-von-a.md']]);
    expect(b.toteLinks).toEqual([{ datei: 'Bibliothek/links.md', ziel: 'gibt-es-nicht' }]);
    expect(b.leer).toEqual(['Bibliothek/leer.md']);
  });

  it('„Für Leif“: ein Satz für die Sammelmeldung, „–“ und „nichts“ zählen nicht', () => {
    expect(fuerLeif('Erledigt.\n\nFür Leif: Vorbereitung für CDA Übung 3 liegt in Rathaus/vorbereitung/.\n\n## Zusammenfassung\n…')).toBe('Vorbereitung für CDA Übung 3 liegt in Rathaus/vorbereitung/.');
    expect(fuerLeif('**Für Leif:** Zwei Dubletten zusammengeführt.')).toBe('Zwei Dubletten zusammengeführt.');
    for (const t of ['Für Leif: –', 'Für Leif: -', 'Für Leif: nichts Neues', 'Für Leif: Nichts.', 'Nichts zu tun – ich lege mich wieder hin.']) expect(fuerLeif(t)).toBeNull();
  });
});
