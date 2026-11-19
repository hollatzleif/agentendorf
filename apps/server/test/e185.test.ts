import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { KalenderKlient } from '../src/kalender-google.js';
import { rohNachricht, type EntwurfEingabe, type GmailKlient, type Mail } from '../src/post/gmail.js';
import { apiMotor, type ModellKlient } from '../src/agenten/motor-api.js';
import { attrappe } from '../src/agenten/motor-attrappe.js';
import { adresseZerlegen } from '../src/kontakte.js';
import { passwortSetzen } from '../src/auth/passwort.js';
import type { TelegramSchnittstelle } from '../src/telegram/api.js';
import { cookieAus, ORIGIN, testDorf } from './hilfen.js';

/**
 * E185: Der Bürgermeister erledigt Kurzes selbst (Mail in EINEM Lauf), Termine direkt mit „Rückgängig“, Adressbuch,
 * Rückfragen, Entwürfe mit Anhang/ändern, Nachschub in den laufenden api-Lauf.
 * TestUhr: Mo, 16.11.2026 12:00 UTC = 13:00 in Wien.
 */
const w = (n: string, e: unknown) => `<<werkzeug ${n} ${JSON.stringify(e)}>>`;

function gmailAttrappe() {
  const entwuerfe: EntwurfEingabe[] = [];
  const geaendert: { id: string; e: EntwurfEingabe }[] = [];
  const suchen: string[] = [];
  const mail = (id: string, an: string): Mail => ({ id, threadId: `t${id}`, von: 'Leif <leif@example.com>', an, betreff: 'x', datum: 0, labels: ['SENT'], schnipsel: '', text: 'GEHEIMER MAILTEXT', messageId: `<${id}@x>`, referenzen: '' });
  const gmail: GmailKlient = {
    profil: async () => ({ emailAddress: 'leif@example.com', historyId: '1' }),
    liste: async (suche) => {
      suchen.push(suche);
      return /mustermann/.test(suche) ? ['s1'] : [];
    },
    seit: async () => null,
    nachricht: async (id) => (id === 's1' ? mail('s1', 'Max Mustermann <max.mustermann@jku.at>, Andere Person <andere@example.org>') : mail(id, 'leif@example.com')),
    entwurf: async (e) => {
      entwuerfe.push(e);
      return { id: `d${entwuerfe.length}` };
    },
    entwurfAendern: async (id, e) => {
      geaendert.push({ id, e });
      return { id };
    },
  };
  return { gmail, entwuerfe, geaendert, suchen };
}

function kalenderAttrappe() {
  type Ev = { id: string; summary?: string; start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string }; attendees?: unknown[] };
  const termine: Ev[] = [
    { id: 'e1', summary: 'VO Statistik', start: { dateTime: '2026-12-02T08:30:00+01:00' }, end: { dateTime: '2026-12-02T10:00:00+01:00' } },
    { id: 'e2', summary: 'UE Leemhuis', start: { dateTime: '2026-12-02T09:00:00+01:00' }, end: { dateTime: '2026-12-02T10:30:00+01:00' } },
    { id: 'e3', summary: 'Projekttreffen mit Gästen', start: { dateTime: '2026-12-02T14:00:00+01:00' }, end: { dateTime: '2026-12-02T15:00:00+01:00' }, attendees: [{ email: 'a@b.at' }, { email: 'c@d.at' }] },
  ];
  const aufrufe: string[] = [];
  const klient: KalenderKlient = {
    kalender: async () => [{ id: 'leif@gmail.com', name: 'Leif', farbe: '#9fe1e7', primaer: true, schreibbar: true }],
    termine: async (_k, von, bis) => termine.filter((e) => e.start?.dateTime && Date.parse(e.start.dateTime) >= von && Date.parse(e.start.dateTime) < bis) as never,
    holen: async (_k, id) => termine.find((e) => e.id === id) as never,
    anlegen: async (_k, body) => {
      const e = { id: `neu${termine.length + 1}`, ...(body as object) } as Ev;
      termine.push(e);
      aufrufe.push(`anlegen ${e.summary}`);
      return e as never;
    },
    aendern: async (_k, id, body) => {
      const e = termine.find((x) => x.id === id)!;
      Object.assign(e, body);
      aufrufe.push(`aendern ${id} ${JSON.stringify((body as Ev).start)}`);
      return e as never;
    },
    loeschen: async (_k, id) => {
      termine.splice(termine.findIndex((x) => x.id === id), 1);
      aufrufe.push(`loeschen ${id}`);
    },
    verschieben: async () => {
      throw new Error('nicht gebraucht');
    },
  };
  return { klient, termine, aufrufe };
}

function telegramAttrappe() {
  const aufrufe: { m: string; p: Record<string, unknown> }[] = [];
  let id = 100;
  const api: TelegramSchnittstelle = {
    async aufruf<T>(m: string, p: Record<string, unknown> = {}, signal?: AbortSignal) {
      aufrufe.push({ m, p });
      if (m === 'sendMessage') return { message_id: ++id } as T;
      if (m === 'getUpdates') await new Promise((_, rej) => signal?.addEventListener('abort', () => rej(new Error('abort'))));
      return true as T;
    },
    async dateiLaden() {
      return { name: 'x.txt', inhalt: Buffer.from('x') };
    },
  };
  return { api, aufrufe, gesendet: () => aufrufe.filter((a) => a.m === 'sendMessage') };
}

async function aufbau() {
  const post = gmailAttrappe();
  const kal = kalenderAttrappe();
  const tg = telegramAttrappe();
  const d = await testDorf({ gmail: post.gmail, kalenderKlient: kal.klient, telegram: tg.api, env: { TELEGRAM_CHAT_ID: '4242' } });
  const texte = (chatId: string) => d.agenten.chatDetail(chatId).nachrichten.filter((n) => n.rolle === 'werkzeug').map((n) => n.text);
  const buergermeister = async (text: string) => {
    const a = await d.schreibtisch.anlegen({ text, quelle: 'app' });
    await d.buergermeister.starten(a.id);
    await d.agenten.leerlauf();
    await new Promise((r) => setTimeout(r, 30));
    const chatId = d.schreibtisch.holen(a.id).chatId!;
    return { a: d.schreibtisch.holen(a.id), chatId, t: texte(chatId) };
  };
  let u = 1;
  const knopf = (data: string) => d.telegram!.verarbeiten({ update_id: u++, callback_query: { id: `cb${u}`, data, from: { id: 4242 }, message: { message_id: 7, text: 'alt', chat: { id: 4242 } } } });
  return { d, post, kal, tg, texte, buergermeister, knopf };
}

describe('E185: „Schreib eine Mail an X“ ist EIN Lauf des Bürgermeisters', () => {
  it('Adresse selbst finden (Adressbuch → Posteingang → Gesendet), Entwurf mit Anhang anlegen, ändern, Adresse merken – ohne Helfer, ohne Freigabe', async () => {
    const x = await aufbau();
    const { d } = x;
    d.db.prepare("INSERT INTO post_mails (id, thread_id, von, betreff, datum) VALUES ('m1', 't1', ?, 'Übung 4', ?)").run('"Leemhuis, Anna" <anna.leemhuis@jku.at>', d.uhr.jetzt());
    await d.vault.schreiben('Rathaus/2026-11-16_1200_attest.md', 'Attest');
    const r = await x.buergermeister(
      [
        'Schreib der Leemhuis, dass ich am 2. Dez nicht kann.',
        w('kontakt_suchen', { name: 'Leemhuis' }),
        w('post_entwurf_neu', { an: 'anna.leemhuis@jku.at', cc: 'Sekretariat <sek@jku.at>', betreff: 'Entschuldigung 2.12.', text: 'Sehr geehrte Frau Leemhuis, …', anhaenge: ['Rathaus/2026-11-16_1200_attest.md'] }),
        w('post_entwurf_aendern', { entwurf_id: 'd1', text: 'Kürzer.' }),
        w('kontakt_merken', { name: 'Anna Leemhuis', adresse: 'Anna.Leemhuis@jku.at', rolle: 'UE-Leiterin' }),
        w('kontakt_suchen', { name: 'anna leemhuis' }),
        w('kontakt_suchen', { name: 'Mustermann' }),
        w('kontakt_suchen', { name: 'Niemand Unbekannt' }),
        w('post_entwurf_aendern', { entwurf_id: 'fremd-9', text: 'x' }),
        w('post_entwurf_neu', { an: 'a@b.at', betreff: 'x', text: 'x', anhaenge: ['Rathaus/gibts-nicht.pdf'] }),
      ].join(' '),
    );
    expect(r.t[0]).toBe('kontakt_suchen: <fremdinhalt quelle="kontakte">\nLeemhuis, Anna <anna.leemhuis@jku.at> (Posteingang)\n</fremdinhalt>');
    expect(r.t[1]).toBe('post_entwurf_neu: Neuer Entwurf in Gmail angelegt (Ordner „Entwürfe“): „Entschuldigung 2.12.“ an anna.leemhuis@jku.at mit 1 Anhang/Anhängen. Gesendet wurde nichts. Entwurf-ID: d1');
    expect(r.t[2]).toBe('post_entwurf_aendern: Entwurf geändert: „Entschuldigung 2.12.“ an anna.leemhuis@jku.at. Gesendet wurde nichts. Entwurf-ID: d1');
    expect(r.t[3]).toBe('kontakt_merken: Ins Adressbuch eingetragen: Anna Leemhuis <anna.leemhuis@jku.at> · UE-Leiterin (Adressbuch)');
    // jetzt zuerst aus dem Adressbuch, jede Adresse nur einmal
    expect(r.t[4]).toContain('Anna Leemhuis <anna.leemhuis@jku.at> · UE-Leiterin (Adressbuch)');
    expect(r.t[4]).not.toContain('(Posteingang)');
    // gesendete Mails: nur die passende Adresse, kein Mailtext
    expect(r.t[5]).toContain('Max Mustermann <max.mustermann@jku.at> (Gesendet)');
    expect(r.t[5]).not.toMatch(/andere@example\.org|GEHEIMER MAILTEXT/);
    expect(x.post.suchen).toContain('in:sent to:(mustermann)');
    expect(r.t[6]).toMatch(/Kein Treffer für „Niemand Unbekannt“.*Such die Adresse im Web/);
    expect(r.t[7]).toMatch(/\(verweigert\) Diesen Entwurf hat dieser Chat nicht angelegt/);
    expect(r.t[8]).toMatch(/\(verweigert\) Anhang gibt es nicht/);
    // Gmail: ein Entwurf mit Anhang und Kopie, eine Änderung mit denselben Empfängern und Anhängen
    expect(x.post.entwuerfe).toHaveLength(1);
    expect(x.post.entwuerfe[0]).toMatchObject({ an: 'anna.leemhuis@jku.at', cc: 'sek@jku.at', betreff: 'Entschuldigung 2.12.', anhaenge: [{ name: '2026-11-16_1200_attest.md', mime: 'text/markdown' }] });
    expect(x.post.geaendert).toMatchObject([{ id: 'd1', e: { an: 'anna.leemhuis@jku.at', cc: 'sek@jku.at', text: 'Kürzer.', anhaenge: [{ name: '2026-11-16_1200_attest.md' }] } }]);
    expect((await d.vault.lesen('Rathaus/kontakte.md')).inhalt).toMatch(/# Kontakte[\s\S]*\n- Anna Leemhuis <anna\.leemhuis@jku\.at> · UE-Leiterin\n$/);
    // EIN Lauf: kein Helfer, keine Freigabe, Aufgabe beantwortet
    expect(d.agenten.chatListe().filter((c) => c.elternChatId)).toEqual([]);
    expect(d.agenten.freigaben.liste()).toEqual([]);
    expect(d.agenten.chatDetail(r.chatId).laeufe).toHaveLength(1);
    expect(r.a.status).toBe('beantwortet');
    // doppelt merken, ungültige Adresse
    const r2 = await x.buergermeister(`${w('kontakt_merken', { name: 'A. Leemhuis', adresse: 'anna.leemhuis@jku.at' })} ${w('kontakt_merken', { name: 'Böse', adresse: 'a@b.at\nBcc: x@y.at' })}`);
    expect(r2.t[0]).toBe('kontakt_merken: Steht schon im Adressbuch: anna.leemhuis@jku.at');
    expect(r2.t[1]).toMatch(/\(verweigert\) Das ist keine gültige Mail-Adresse/);
  });

  it('Adressen zerlegen und Rohnachricht mit Anhang (multipart, keine Kopfzeilen einschleusbar)', () => {
    expect(adresseZerlegen('"Leemhuis, Anna" <Anna.Leemhuis@JKU.at>')).toEqual({ name: 'Leemhuis, Anna', adresse: 'anna.leemhuis@jku.at' });
    expect(adresseZerlegen('a@b.at')).toEqual({ name: '', adresse: 'a@b.at' });
    expect(adresseZerlegen('a@b.at, c@d.at')).toBeNull();
    expect(adresseZerlegen('Kein Name')).toBeNull();
    const roh = Buffer.from(rohNachricht({ an: 'a@b.at', cc: 'c@d.at', betreff: 'Übung', text: 'Hallo', anhaenge: [{ name: 'blatt 1".pdf', mime: 'application/pdf', daten: Buffer.from('PDF') }] }), 'base64url').toString('utf8');
    expect(roh).toMatch(/^To: a@b\.at\r\nCc: c@d\.at\r\nSubject: =\?UTF-8\?B\?.+\?=\r\nMIME-Version: 1\.0\r\nContent-Type: multipart\/mixed; boundary="(dorf-[0-9a-f]+-teil)"\r\n\r\n--\1\r\nContent-Type: text\/plain; charset=UTF-8/);
    expect(roh).toContain('Content-Disposition: attachment; filename="blatt_1_.pdf"');
    expect(roh).toContain(Buffer.from('PDF').toString('base64'));
    expect(roh.trimEnd().endsWith('-teil--')).toBe(true);
    expect(() => rohNachricht({ an: 'a@b.at', cc: 'c@d.at\r\nBcc: x@y.at', betreff: 'x', text: 'y' })).toThrow(/Zeilenumbrüche/);
    expect(() => rohNachricht({ an: 'a@b.at', betreff: 'x', text: 'y', anhaenge: [{ name: 'a', mime: 'text/plain\r\nX: y', daten: Buffer.from('') }] })).toThrow(/Dateityp/);
    // ohne Anhang wie bisher eine einfache Textnachricht
    expect(Buffer.from(rohNachricht({ an: 'a@b.at', betreff: 'x', text: 'y' }), 'base64url').toString('utf8')).toContain('Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n');
  });
});

describe('E185: Termine in Leifs eigenem Kalender – direkt, mit „Rückgängig“; mit Gästen nur per Freigabe', () => {
  it('verschieben, löschen, freie Zeiten; Rückgängig stellt genau einmal wieder her; Telegram meldet mit Knopf', async () => {
    const x = await aufbau();
    const { d } = x;
    const r = await x.buergermeister(
      [
        w('termin_aendern', { datum: '2026-12-02', titel: 'leemhuis', neue_zeit: '11:00' }),
        w('termin_aendern', { datum: '2026-12-02', titel: 'gibt es nicht', neue_zeit: '11:00' }),
        w('termin_aendern', { datum: '2026-12-02', titel: 'e', neue_zeit: '11:00' }),
        w('termin_loeschen', { datum: '2026-12-02', titel: 'VO Statistik' }),
        w('termin_aendern', { datum: '2026-12-02', titel: 'Projekttreffen', neues_datum: '2026-12-03' }),
        w('termin_loeschen', { datum: '2026-12-02', titel: 'Projekttreffen mit Gästen' }),
        w('freie_zeiten', { dauer_min: 60, bis: '2026-11-17' }),
      ].join(' '),
    );
    expect(r.t[0]).toBe('termin_aendern: Geändert in Leifs Kalender: UE Leemhuis, jetzt Mi., 02.12.2026 · 11:00–12:30 (90 min) (bisher Mi., 02.12.2026 · 09:00–10:30 (90 min)). Leif kann es zurücknehmen.');
    expect(r.t[1]).toMatch(/\(verweigert\) Am 2026-12-02 gibt es keinen Termin „gibt es nicht“\. Termine an dem Tag:\n<fremdinhalt quelle="kalender">\n- VO Statistik/);
    expect(r.t[2]).toMatch(/\(verweigert\) „e“ passt am 2026-12-02 auf 2 Termine/);
    expect(r.t[3]).toBe('termin_loeschen: Gelöscht aus Leifs Kalender: VO Statistik, Mi., 02.12.2026 · 08:30–10:00 (90 min). Leif kann es zurücknehmen.');
    // Termine mit Gästen: nichts passiert, Leif entscheidet
    expect(r.t[4]).toMatch(/^termin_aendern: Der Termin hat Gäste – die Änderung liegt als Freigabe/);
    expect(r.t[5]).toMatch(/^termin_loeschen: Der Termin hat Gäste – als Freigabe/);
    expect(r.t[6]).toMatch(/^freie_zeiten: - Mo\.?,? 16\.11\. \d\d:\d\d–\d\d:\d\d/);
    expect(x.kal.aufrufe).toEqual(['aendern e2 {"dateTime":"2026-12-02T11:00:00","timeZone":"Europe/Vienna","date":null}', 'loeschen e1']);
    expect(x.kal.termine.find((e) => e.id === 'e3')!.start!.dateTime).toBe('2026-12-02T14:00:00+01:00');
    const offen = d.agenten.freigaben.liste('offen');
    expect(offen.map((f) => f.art)).toEqual(['termin_aendern', 'termin_loeschen']);
    expect(offen[0]!.titel).toBe('Termin mit Gästen ändern: Projekttreffen mit Gästen – Do., 03.12.2026 · 14:00–15:00 (60 min)');
    // Telegram: je direkter Tat eine Meldung mit signiertem Rückgängig-Knopf
    const getan = x.tg.gesendet().filter((g) => String(g.p.text).startsWith('✅ <b>Ohne Rückfrage erledigt</b>'));
    expect(getan).toHaveLength(2);
    const daten = (getan.find((g) => String(g.p.text).includes('Termin geändert'))!.p.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard[0]![0]!;
    expect(daten.text).toBe('↩️ Rückgängig');
    // gefälschte Signatur → nichts
    await x.knopf(daten.callback_data.replace(/:[^:]+$/, ':AAAAAAAAAAAAAAAA'));
    expect(x.kal.aufrufe).toHaveLength(2);
    // echter Knopf: der verschobene Termin steht wieder wie vorher – genau einmal
    await x.knopf(daten.callback_data);
    expect(x.kal.aufrufe[2]).toBe('aendern e2 {"dateTime":"2026-12-02T09:00:00","timeZone":"Europe/Vienna","date":null}');
    await x.knopf(daten.callback_data);
    expect(x.kal.aufrufe).toHaveLength(3);
    expect(x.tg.aufrufe.filter((a) => a.m === 'answerCallbackQuery').map((a) => a.p.text)).toEqual(['Ungültiger Knopf.', '↩️ Zurückgenommen: Termin steht wieder wie vorher im Kalender.', 'Das wurde schon zurückgenommen.']);
    // App: Liste + Rückgängig über die Route (gelöschter Termin wird wieder eingetragen)
    await passwortSetzen(d.db, d.uhr, 'ein-sehr-langes-Passwort-42');
    const an = await d.app.inject({ method: 'POST', url: '/api/anmeldung', headers: { origin: ORIGIN }, payload: { passwort: 'ein-sehr-langes-Passwort-42' } });
    const h = { origin: ORIGIN, cookie: cookieAus(an.headers['set-cookie']) };
    const liste = (await d.app.inject({ url: '/api/rueckgaengig', headers: h })).json() as { id: string; titel: string; status: string }[];
    expect(liste.map((l) => [l.titel.split(':')[0], l.status])).toEqual([
      ['Termin gelöscht', 'offen'],
      ['Termin geändert', 'zurueckgenommen'],
    ]);
    expect((await d.app.inject({ method: 'POST', url: `/api/rueckgaengig/${liste[0]!.id}`, headers: h, payload: {} })).json()).toMatchObject({ status: 'zurueckgenommen', ergebnis: 'Termin wieder eingetragen.' });
    expect(x.kal.aufrufe[3]).toBe('anlegen VO Statistik');
    expect((await d.app.inject({ method: 'POST', url: `/api/rueckgaengig/${liste[0]!.id}`, headers: h, payload: {} })).statusCode).toBe(409);
    expect((await d.app.inject({ url: '/api/rueckgaengig' })).statusCode).toBe(401);
    // Freigabe für den Termin mit Gästen: erst nach Leifs Ja
    await d.agenten.freigaben.entscheiden(offen[0]!.id, true);
    expect(x.kal.aufrufe[4]).toBe('aendern e3 {"dateTime":"2026-12-03T14:00:00","timeZone":"Europe/Vienna","date":null}');
  });
});

describe('E185: Rückfrage und Warteschlange', () => {
  it('rueckfrage: höchstens eine je Lauf, Hinweis im Chat, Telegram-Knöpfe; die Antwort setzt das Gespräch genau einmal fort', async () => {
    const x = await aufbau();
    const { d } = x;
    const r = await x.buergermeister(`${w('rueckfrage', { frage: 'Welche Leemhuis meinst du?', optionen: ['Anna (UE)', 'Peter (VO)'] })} ${w('rueckfrage', { frage: 'Und noch eine?' })}`);
    expect(r.t[0]).toMatch(/^rueckfrage: Frage an Leif gestellt/);
    expect(r.t[1]).toMatch(/\(verweigert\) Höchstens eine Rückfrage je Lauf/);
    expect(d.agenten.chatDetail(r.chatId).nachrichten.find((n) => n.rolle === 'hinweis')!.text).toContain('❓ **Rückfrage:** Welche Leemhuis meinst du?');
    const frage = x.tg.gesendet().find((g) => String(g.p.text).startsWith('❓ <b>Rückfrage</b>'))!;
    const knoepfe = (frage.p.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard.map((z) => z[0]!);
    expect(knoepfe.map((k) => k.text)).toEqual(['Anna (UE)', 'Peter (VO)']);
    await x.knopf(knoepfe[1]!.callback_data.replace(/:[^:]+$/, ':AAAAAAAAAAAAAAAA'));
    expect(d.agenten.chatDetail(r.chatId).laeufe).toHaveLength(1);
    await x.knopf(knoepfe[1]!.callback_data);
    await x.knopf(knoepfe[0]!.callback_data); // zweite Antwort zählt nicht mehr
    await d.agenten.leerlauf();
    const l = d.agenten.chatDetail(r.chatId).laeufe;
    expect(l.map((y) => y.auftrag).slice(1)).toEqual(['Peter (VO)']);
  });

  it('App-Routen: Nachricht während eines Laufs wartet (wartend im Chat), lässt sich löschen und kommt sonst danach dran', async () => {
    const { d } = await aufbau();
    await passwortSetzen(d.db, d.uhr, 'ein-sehr-langes-Passwort-42');
    const an = await d.app.inject({ method: 'POST', url: '/api/anmeldung', headers: { origin: ORIGIN }, payload: { passwort: 'ein-sehr-langes-Passwort-42' } });
    const h = { origin: ORIGIN, cookie: cookieAus(an.headers['set-cookie']) };
    fs.writeFileSync(path.join(d.vault.wurzel, 'Uni/aktionen/test.md'), '---\nname: Test\neingaben:\n  - name: auftrag\n---\n{auftrag}');
    const { chatId } = await d.agenten.aktionStarten('Uni/test', { auftrag: '[warte 300]' });
    const senden = (text: string) => d.app.inject({ method: 'POST', url: `/api/chats/${chatId}/nachricht`, headers: h, payload: { text } });
    expect((await senden('eins')).json()).toEqual({ wartend: 1 });
    expect((await senden('zwei')).json()).toEqual({ wartend: 2 });
    const chat = (await d.app.inject({ url: `/api/chats/${chatId}`, headers: h })).json() as { wartend: { id: number; text: string }[] };
    expect(chat.wartend.map((x) => x.text)).toEqual(['eins', 'zwei']);
    expect((await d.app.inject({ method: 'DELETE', url: `/api/chats/${chatId}/wartend/${chat.wartend[0]!.id}`, headers: h })).json()).toEqual({ ok: true });
    expect((await d.app.inject({ method: 'DELETE', url: `/api/chats/${chatId}/wartend/${chat.wartend[0]!.id}`, headers: h })).statusCode).toBe(404);
    await d.agenten.leerlauf();
    const danach = (await d.app.inject({ url: `/api/chats/${chatId}`, headers: h })).json() as { wartend: unknown[]; laeufe: { auftrag: string }[] };
    expect(danach.wartend).toEqual([]);
    expect(danach.laeufe.map((l) => l.auftrag)).toEqual(['[warte 300]', 'zwei']);
  });

  it('api-Motor: Nachschub kommt zwischen zwei Werkzeug-Runden als Textblock hinter die tool_results – Verlauf bleibt nur angehängt', async () => {
    const anfragen: Record<string, unknown>[] = [];
    let dorf: Awaited<ReturnType<typeof testDorf>> | undefined;
    let chat = '';
    const antworten: Partial<BetaMessage>[] = [
      { content: [{ type: 'tool_use', id: 't1', name: 'vault_liste', input: { pfad: '' }, caller: { type: 'direct' } }] as BetaMessage['content'], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'Fertig, mit deinem Nachtrag.', citations: null }], stop_reason: 'end_turn' },
    ];
    const klient: ModellKlient = {
      async streamen(params) {
        anfragen.push(structuredClone(params) as Record<string, unknown>);
        // während das Modell „denkt“, schiebt Leif etwas nach
        if (anfragen.length === 1) expect(dorf!.agenten.nachrichtSenden(chat, 'Ach ja: bitte auf Englisch')).toEqual({ wartend: 1 });
        return { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 1 }, ...antworten.shift()! } as BetaMessage;
      },
    };
    dorf = await testDorf({ motoren: { api: apiMotor(() => klient), 'claude-code': attrappe('claude-code') } });
    fs.writeFileSync(path.join(dorf.vault.wurzel, 'Uni/aktionen/a.md'), '---\nname: A\nmotor: api\n---\nTu was.');
    chat = (await dorf.agenten.aktionStarten('Uni/a', {})).chatId;
    await dorf.agenten.leerlauf();
    const c = dorf.agenten.chatDetail(chat);
    // kein zweiter Lauf: die Nachricht ging in den laufenden
    expect(c.laeufe).toHaveLength(1);
    expect(c.wartend).toEqual([]);
    const zweite = anfragen[1]!.messages as { role: string; content: { type: string; text?: string }[] }[];
    expect(zweite.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(zweite[2]!.content.map((b) => b.type)).toEqual(['tool_result', 'text']);
    expect(zweite[2]!.content[1]!.text).toBe('Neu eingetroffen, während du arbeitest (berücksichtige es ab jetzt):\n\nAch ja: bitte auf Englisch');
    expect(c.nachrichten.filter((n) => n.rolle === 'nutzer').map((n) => n.text)).toEqual(['Tu was.', 'Ach ja: bitte auf Englisch']);
    // Fortsetzen: der gespeicherte Verlauf ist gültig (user/assistant im Wechsel, Nachtrag steckt in der Werkzeug-Nachricht)
    antworten.push({ content: [{ type: 'text', text: 'Gern.', citations: null }], stop_reason: 'end_turn' });
    dorf.agenten.nachrichtSenden(chat, 'Danke');
    await dorf.agenten.leerlauf();
    expect((anfragen[2]!.messages as { role: string }[]).map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(JSON.stringify((anfragen[2]!.messages as unknown[]).slice(0, 3))).toBe(JSON.stringify(zweite));
  });
});
