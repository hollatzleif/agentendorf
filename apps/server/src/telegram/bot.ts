import { LISTEN, type ListenName, type TodoDienst } from '../todos.js';

/** Telegram-Darstellung der Listen; Kurzzeichen für Knöpfe (64 Byte Grenze) */
const LISTEN_KURZ: Record<ListenName, string> = { todo: 't', einkauf: 'e', wunsch: 'w', corps: 'c' };
const LISTEN_ANZEIGE: Record<ListenName, { symbol: string; titel: string; befehl: string }> = {
  todo: { symbol: '🧺', titel: 'To-do-Liste', befehl: '/todo' },
  einkauf: { symbol: '🛒', titel: 'Einkaufsliste', befehl: '/einkauf' },
  wunsch: { symbol: '🎁', titel: 'Wunschliste', befehl: '/einkauf' },
  corps: { symbol: '🛡️', titel: 'Corps-Aufgaben', befehl: '/todo' },
};
import { aufwachEinstellungen, istNacht } from '../aufwachen.js';
import type { Rueckblick } from '../wochenrueckblick.js';
import { terminAusText, type TerminAusText } from '@dorf/shared';
import type { Karteikasten } from '../karten.js';
import type { FokusStatistik, TodoInfo } from '@dorf/shared';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import type { FreigabeInfo, PlanInhalt, TelegramStatus } from '@dorf/shared';
import type { DB } from '../db.js';
import type { VaultDienst } from '../vault/dienst.js';
import type { AgentenDienst, LaufEnde } from '../agenten/dienst.js';
import type { Buergermeister } from '../agenten/buergermeister.js';
import type { Schreibtisch } from '../schreibtisch.js';
import { DorfFehler } from '../fehler.js';
import { MAX_DATEI, type TelegramSchnittstelle } from './api.js';
import { einstellungenLaden } from './einstellungen.js';
import type { AbgleichErgebnis, FaelligeErinnerung, Uni } from '../uni/abgleich.js';
import type { Postbote } from '../post/postbote.js';
import type { Morgenzeitung, Zeitung } from '../morgenzeitung.js';
import type { PostMail } from '@dorf/shared';
import { fristText } from '../uni/text.js';
import { aktionenListe } from '../agenten/aktionen.js';
import type { Uhr } from '../uhr.js';
import { fremdinhaltHuelle } from '../agenten/leine.js';

/** So lange nach dem letzten Austausch gilt eine neue Nachricht als Fortsetzung des Gesprächs */
export const GESPRAECH_MINUTEN = 60;

/** HTML-sicher für Telegram (parse_mode HTML) */
export const h = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface TgNachricht {
  message_id: number;
  chat: { id: number | string; type?: string; first_name?: string; username?: string };
  from?: { id: number; first_name?: string };
  text?: string;
  caption?: string;
  photo?: { file_id: string; file_size?: number }[];
  document?: { file_id: string; file_name?: string; file_size?: number };
  voice?: unknown;
  audio?: unknown;
  video_note?: unknown;
  forward_origin?: unknown;
  forward_from?: unknown;
  forward_from_chat?: unknown;
  forward_date?: number;
  reply_to_message?: { message_id: number; text?: string; caption?: string };
}
interface TgUpdate {
  update_id: number;
  message?: TgNachricht;
  callback_query?: { id: string; data?: string; from: { id: number }; message?: TgNachricht };
}

/** So lange gilt die nächste Textnachricht nach ❌ als Grund (ohne direkte Antwort auf die Frage) */
const GRUND_MINUTEN = 10;

const ARTEN: Record<string, string> = {
  datei_loeschen: 'Datei löschen',
  datei_ueberschreiben: 'Datei überschreiben',
  sonstiges: 'Sonstiges',
  lauf_starten: 'Aktion starten',
  plan_ausfuehren: 'Plan ausführen',
  aktion_anlegen: '🧩 Neuer Skill',
  persoenlichkeit_aendern: '🎭 Persönlichkeit',
};

/**
 * Telegram-Bot des Dorfs: nur EIN gekoppelter Chat, Long Polling (kein offener Port).
 * - Freigaben mit signierten Ja/Nein-Knöpfen (wirken genau einmal über freigaben.entscheiden)
 * - Meldungen: Freigaben, Entwürfe, Fehler, beendete Aufgaben (schaltbar in 00_Stadtordnung/telegram.md)
 * - Eingang: Text/Dateien werden zur Aufgabe auf dem Schreibtisch; Weitergeleitetes ist Fremdinhalt.
 */
export class TelegramBot {
  private offset = 0;
  private laeuft = false;
  private abbruch?: AbortController;
  letzterFehler?: string;
  private readonly signaturSchluessel: Buffer;

  constructor(
    private o: {
      uhr: Uhr;
      api: TelegramSchnittstelle;
      chatId: string;
      geheimnis: string;
      appUrl: string;
      db: DB;
      vault: VaultDienst;
      agenten: AgentenDienst;
      schreibtisch: Schreibtisch;
      buergermeister: Buergermeister;
      uni?: Uni;
      postbote?: Postbote;
      morgenzeitung?: Morgenzeitung;
      listen?: Record<ListenName, TodoDienst>;
      /** Nacht 18./19.11.: /karten – Karteikarten wiederholen */
      karten?: Karteikasten;
      /** Nacht 18./19.11.: /fokus – Pomodoro starten */
      kirchturm?: { ausfuehren(b: unknown): unknown; fokusStatistik?(): FokusStatistik };
      /** Nacht 18./19.11.: /termin – Termin aus Text, eingetragen erst nach Leifs Knopfdruck */
      kalender?: { verbunden: boolean; inHauptkalender(t: TerminAusText): Promise<{ titel: string }> };
      log?: (t: string) => void;
    },
  ) {
    this.signaturSchluessel = crypto.createHmac('sha256', o.geheimnis).update('telegram-knoepfe').digest();
    // Meldungen – nie blockierend: Fehler beim Senden landen nur im Log.
    o.agenten.freigaben.beiNeu.push((f) => void this.freigabeMelden(f).catch((e) => this.fehler(e)));
    o.agenten.freigaben.beiEntscheidung.push((f) => void this.freigabeAktualisieren(f).catch((e) => this.fehler(e)));
    o.agenten.beiLaufEnde.push((e) => void this.laufMelden(e).catch((x) => this.fehler(x)));
    o.buergermeister.beiAbschluss.push((a) => void this.abschlussMelden(a).catch((x) => this.fehler(x)));
    o.uni?.beiAbgleich.push((e) => this.moodleMelden(e).catch((x) => this.fehler(x)));
    o.postbote?.beiNeu.push((m) => this.mailsMelden(m).catch((x) => this.fehler(x)));
    o.morgenzeitung?.beiNeu.push((z) => this.zeitungSenden(z).catch((x) => this.fehler(x)));
  }

  private letzterMoodleFehler: string | null = null;

  /** Morgenzeitung als Telegram-Nachricht (Schalter „morgenzeitung“) */
  async zeitungSenden(z: Zeitung) {
    if (!(await einstellungenLaden(this.o.vault)).morgenzeitung) return;
    const fett = (t: string) => h(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    const teile = [`☀️ <b>Morgenzeitung</b>`];
    if (z.einleitung) teile.push(`<i>${h(z.einleitung)}</i>`);
    for (const a of z.abschnitte) if (a.zeilen.length) teile.push(`<b>${h(a.titel)}</b>\n${a.zeilen.slice(0, 8).map((x) => `• ${fett(x)}`).join('\n')}`);
    let text = teile.join('\n\n');
    if (text.length > 3700) text = `${text.slice(0, 3700)} …`;
    await this.senden(`${text}\n\n<a href="${this.link('/gebaeude/Rathaus?reiter=morgenzeitung')}">Ganze Zeitung</a>`);
  }

  /** Wochenrückblick (sonntags) – Schalter wie die Morgenzeitung */
  async rueckblickSenden(r: Rueckblick) {
    if (!(await einstellungenLaden(this.o.vault)).morgenzeitung) return;
    const fett = (t: string) => h(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    const teile = [`🗓️ <b>Wochenrückblick</b> (${h(r.woche.replace('-KW', ' · KW '))})`];
    if (r.einleitung) teile.push(`<i>${h(r.einleitung)}</i>`);
    if (r.vorschlaege.length) teile.push(`<b>Für nächste Woche</b>\n${r.vorschlaege.map((v) => `• ${h(v)}`).join('\n')}`);
    for (const a of r.abschnitte) if (a.zeilen.length) teile.push(`<b>${h(a.titel)}</b>\n${a.zeilen.slice(0, 8).map((x) => `• ${fett(x)}`).join('\n')}`);
    let text = teile.join('\n\n');
    if (text.length > 3700) text = `${text.slice(0, 3700)} …`;
    await this.proaktiv(`${text}\n<a href="${this.link('/gebaeude/Rathaus?reiter=woche')}">Ganzer Rückblick</a>`);
  }

  /** Wichtige neue Mails – nur mit Schalter „mails“ (standardmäßig aus: Leifs Mail-Assistent meldet schon) */
  async mailsMelden(m: PostMail[]) {
    if (!(await einstellungenLaden(this.o.vault)).mails) return;
    const zeilen = m.slice(0, 8).map((x) => `• ${h(x.von)}: <b>${h(x.betreff)}</b>${x.zusammenfassung ? `\n  ${h(x.zusammenfassung)}` : ''}`);
    await this.proaktiv(`📬 <b>${m.length === 1 ? 'Wichtige Mail' : `${m.length} wichtige Mails`}</b>\n${zeilen.join('\n')}\n<a href="${this.link('/gebaeude/Post')}">Zur Post</a>`);
  }

  /** Neues aus Moodle (Schalter „moodle“); ein Abgleich-Fehler wird nur gemeldet, wenn er neu ist (nicht alle 3 Stunden derselbe). */
  async moodleMelden(e: AbgleichErgebnis) {
    const k = await einstellungenLaden(this.o.vault);
    if (!e.ok) {
      if (k.fehler && e.fehler !== this.letzterMoodleFehler) await this.proaktiv(`❌ <b>Moodle-Abgleich fehlgeschlagen</b>\n${h((e.fehler ?? '').slice(0, 500))}`);
      this.letzterMoodleFehler = e.fehler;
      return;
    }
    this.letzterMoodleFehler = null;
    if (!k.moodle || (!e.neueDateien && !e.neueFristen.length)) return;
    const teile = [
      e.neueDateien ? `${e.neueDateien} ${e.neueDateien === 1 ? 'Datei' : 'Dateien'}` : '',
      e.neueFristen.length ? `${e.neueFristen.length} ${e.neueFristen.length === 1 ? 'Frist' : 'Fristen'}` : '',
    ].filter(Boolean);
    const abgaben = e.neueFristen
      .slice(0, 8)
      .map((a) => `• ${h(a.titel)}${a.kurs ? ` (${h(a.kurs)})` : ''} – ${a.frist == null ? 'ohne Frist' : h(fristText(a.frist))}`)
      .join('\n');
    await this.proaktiv(`🎓 <b>Neu in Moodle:</b> ${teile.join(', ')}${abgaben ? `\n${abgaben}` : ''}\n<a href="${this.link('/gebaeude/Uni')}">Zur Uni</a>`);
  }

  private fehler(e: unknown) {
    this.letzterFehler = (e as Error).message;
    this.o.log?.(`Telegram: ${this.letzterFehler}`);
  }

  status(einstellungen: TelegramStatus['einstellungen']): TelegramStatus {
    return { tokenGesetzt: true, chatGekoppelt: true, laeuft: this.laeuft, letzterFehler: this.letzterFehler, einstellungen };
  }

  // ---- Polling --------------------------------------------------------------------------------

  private erinnerungsTakt?: NodeJS.Timeout;

  /** Befehlsmenü („/“ in Telegram) – reine Anzeige, Fehler sind egal */
  static readonly BEFEHLE = [
    { command: 'status', description: 'Was läuft gerade' },
    { command: 'heute', description: 'Dein Tag: Wetter, Termine, Fristen' },
    { command: 'fristen', description: 'Abgaben und Prüfungen der nächsten 7 Tage' },
    { command: 'freigaben', description: 'Offene Freigaben' },
    { command: 'moodle', description: 'In Moodle nachschauen lassen: /moodle <Fach> [Frage]' },
    { command: 'aktion', description: 'Skill starten: /aktion <Name> (ohne Name: Liste)' },
    { command: 'todo', description: 'To-do-Liste (abhaken per Knopf) – /todo <Text> legt eins an' },
    { command: 'einkauf', description: 'Einkaufsliste (abhaken im Laden) – /einkauf <Text> setzt etwas drauf' },
    { command: 'neu', description: 'Nächste Nachricht wird eine neue Aufgabe' },
    { command: 'hilfe', description: 'Was der Bot kann' },
  ];

  starten() {
    if (this.laeuft) return;
    this.laeuft = true;
    void this.o.api.aufruf('setMyCommands', { commands: TelegramBot.BEFEHLE }).catch(() => undefined);
    void this.schleife();
    // Erinnerungen an Fristen: alle 10 Minuten nachsehen (nur Datenbank, kein Netz außer Telegram)
    this.erinnerungsTakt = setInterval(() => {
      void this.erinnerungenSenden().catch((e) => this.fehler(e));
      void this.nachtNachholen().catch((e) => this.fehler(e));
      void this.abendSenden().catch((e) => this.fehler(e));
    }, 10 * 60_000);
    this.erinnerungsTakt.unref();
  }

  stoppen() {
    this.laeuft = false;
    this.abbruch?.abort();
    if (this.erinnerungsTakt) clearInterval(this.erinnerungsTakt);
  }

  // ---- Erinnerungen an Fristen ------------------------------------------------------------------

  erledigtSignatur(fristId: string) {
    return crypto.createHmac('sha256', this.signaturSchluessel).update(`erledigt:${fristId}`).digest('base64url').slice(0, 16);
  }

  private erinnerungsText(e: Pick<FaelligeErinnerung, 'titel' | 'kurs' | 'art' | 'frist' | 'stufe'>) {
    const was = e.art === 'test' ? 'Test' : 'Abgabe';
    const kopf =
      e.stufe === 'danach'
        ? `❓ <b>Frist vorbei – erledigt?</b>`
        : `⏰ <b>${was} in ${e.stufe === '3t' ? '3 Tagen' : e.stufe === '1t' ? '1 Tag' : 'wenigen Stunden'}</b>`;
    return `${kopf}\n${h(e.titel)}${e.kurs ? ` (${h(e.kurs)})` : ''}\nFrist: ${h(fristText(e.frist))}`;
  }

  /** Schickt fällige Erinnerungen – jede genau einmal (erst nach erfolgreichem Senden vermerkt). */
  async erinnerungenSenden() {
    if (!this.o.uni || !(await einstellungenLaden(this.o.vault)).erinnerungen) return 0;
    let n = 0;
    const nacht = await this.nachtruhe();
    for (const e of this.o.uni.faelligeErinnerungen()) {
      // nachts nur, was in wenigen Stunden fällig ist – der Rest kommt (als dringendste Stufe) nach 7 Uhr
      if (nacht && e.stufe !== '3h') continue;
      // E64 Frist-Wächter: kurz vor der Frist (1 Tag / wenige Stunden) kann der Bürgermeister vorbereiten – abgeben tut Leif
      const knoepfe = [{ text: '✅ Erledigt', callback_data: `e:${e.id}:${this.erledigtSignatur(e.id)}` }];
      if (e.stufe === '1t' || e.stufe === '3h') knoepfe.push({ text: '🧑‍💼 Vorbereiten lassen', callback_data: `v:${e.id}:${this.vorbereitenSignatur(e.id)}` });
      await this.senden(`${this.erinnerungsText(e)}\n<a href="${this.link('/gebaeude/Uni')}">Zur Uni</a>`, {
        reply_markup: { inline_keyboard: [knoepfe] },
      });
      this.o.uni.erinnerungGesendet(e);
      n++;
    }
    return n;
  }

  vorbereitenSignatur(fristId: string) {
    return crypto.createHmac('sha256', this.signaturSchluessel).update(`vorbereiten:${fristId}`).digest('base64url').slice(0, 16);
  }

  /** Frist-Wächter: Schreibtisch-Aufgabe für den Bürgermeister – vorbereiten, was geht; abgeben nie (E64) */
  private async vorbereitenKnopf(q: NonNullable<TgUpdate['callback_query']>, antworten: (t: string) => Promise<unknown>) {
    const m = /^v:((?:(?:ical|gfrist|gpfl):[0-9a-f]{32})|(?:assign|event):\d{1,12}):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    if (!m || !this.o.uni || !crypto.timingSafeEqual(Buffer.from(m[2]!), Buffer.from(this.vorbereitenSignatur(m[1]!)))) {
      this.o.log?.('Telegram: Vorbereiten-Knopf mit ungültiger Signatur abgelehnt.');
      return antworten('Ungültiger Knopf.');
    }
    const f = this.o.uni.fristen().find((x) => x.id === m[1]);
    if (!f) return antworten('Diese Frist gibt es nicht mehr.');
    if (f.abgegeben) return antworten('Schon erledigt.');
    const was = f.art === 'test' ? 'Prüfung/Test' : 'Abgabe';
    const text = `Frist-Wächter: ${was} bald fällig – bitte vorbereiten, was sinnvoll ist.

${fremdinhaltHuelle('frist', `${was}: ${f.titel}${f.kurs ? ` (${f.kurs})` : ''}\nFrist: ${f.frist ? fristText(Date.parse(f.frist)) : 'unbekannt'}${f.pfad ? `\nOrdner: ${f.pfad}` : ''}`)}

Schau, was es dafür im Vault gibt (Uni/faecher/…, aufgaben/, entwuerfe/). Bei einer Abgabe mit Angabe im Kursordner: Helfer mit „Abgabe bearbeiten“; bei einer Prüfung: „Lernen“ für das Fach. Fehlt die Angabe, lass sie mit „Moodle durchsehen“ holen. Abgeben tut Leif immer selbst.`;
    try {
      const a = await this.o.schreibtisch.anlegen({ text, quelle: 'telegram' });
      const r = await this.o.buergermeister.starten(a.id, 'klick');
      await antworten('Der Bürgermeister kümmert sich.');
      await this.senden(`🧑‍💼 Der Bürgermeister bereitet „${h(f.titel)}“ vor. <a href="${this.link(`/chats/${r.chatId}`)}">Chat öffnen</a>`, {}, r.chatId);
    } catch (e) {
      await antworten(`Fehler: ${(e as Error).message}`.slice(0, 190));
    }
  }

  private async erledigtKnopf(q: NonNullable<TgUpdate['callback_query']>, antworten: (t: string) => Promise<unknown>) {
    const m = /^e:((?:(?:ical|gfrist|gpfl):[0-9a-f]{32})|(?:assign|event):\d{1,12}):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    if (!m || !this.o.uni || !crypto.timingSafeEqual(Buffer.from(m[2]!), Buffer.from(this.erledigtSignatur(m[1]!)))) {
      this.o.log?.('Telegram: Erledigt-Knopf mit ungültiger Signatur abgelehnt.');
      return antworten('Ungültiger Knopf.');
    }
    try {
      this.o.uni.erledigtSetzen(m[1]!, true);
    } catch {
      return antworten('Diese Frist gibt es nicht mehr.');
    }
    await antworten('Abgehakt.');
    if (q.message)
      await this.o.api
        .aufruf('editMessageText', {
          chat_id: q.message.chat.id,
          message_id: q.message.message_id,
          text: `${(q.message.text ?? '').split('\nZur Uni')[0]}\n\n✅ Erledigt`.slice(0, 4000),
          link_preview_options: { is_disabled: true },
        })
        .catch(() => undefined);
  }

  private async schleife() {
    let warte = 2000;
    while (this.laeuft) {
      this.abbruch = new AbortController();
      try {
        const updates = await this.o.api.aufruf<TgUpdate[]>(
          'getUpdates',
          { offset: this.offset, timeout: 50, allowed_updates: ['message', 'callback_query'] },
          AbortSignal.any([this.abbruch.signal, AbortSignal.timeout(70_000)]),
        );
        warte = 2000;
        for (const u of updates) {
          this.offset = Math.max(this.offset, u.update_id + 1);
          await this.verarbeiten(u).catch((e) => this.fehler(e));
        }
      } catch (e) {
        if (!this.laeuft) break;
        this.fehler(e);
        await new Promise((r) => setTimeout(r, warte));
        warte = Math.min(warte * 2, 60_000);
      }
    }
  }

  // ---- Eingang --------------------------------------------------------------------------------

  private istLeif(chatId: number | string | undefined) {
    return chatId !== undefined && String(chatId) === this.o.chatId;
  }

  async verarbeiten(u: TgUpdate) {
    if (u.callback_query) return this.knopf(u.callback_query);
    const m = u.message;
    if (!m) return;
    if (!this.istLeif(m.chat.id)) {
      this.o.log?.(`Telegram: Nachricht aus fremdem Chat ${m.chat.id} ignoriert.`);
      return;
    }
    let text = (m.text ?? m.caption ?? '').trim();
    if (text.startsWith('/')) {
      this.grundFrageSetzen(null); // ein Befehl beendet die Frage nach dem Grund
      const b = text.split(/\s/)[0]!.split('@')[0]!.toLowerCase();
      if (b === '/moodle') return this.moodleBefehl(text.slice(text.split(/\s/)[0]!.length).trim());
      if (b === '/aktion') return this.aktionBefehl(text.slice(text.split(/\s/)[0]!.length).trim());
      if (b === '/todo') return this.todoBefehl(text.slice(text.split(/\s/)[0]!.length).trim());
      if (b === '/einkauf') return this.todoBefehl(text.slice(text.split(/\s/)[0]!.length).trim(), 'einkauf');
      if (b === '/termin') return this.terminBefehl(text.slice(text.split(/\s/)[0]!.length).trim());
      if (b === '/karten') return this.kartenBefehl(text.slice(text.split(/\s/)[0]!.length).trim());
      if (b === '/fokus') return this.fokusBefehl(text.slice(text.split(/\s/)[0]!.length).trim());
      if (b !== '/neu') return this.befehl(b);
      // „/neu“ beendet das laufende Gespräch; „/neu <Text>“ legt gleich eine neue Aufgabe an
      this.verlaufMerken(m.message_id, '');
      text = text.slice(text.split(/\s/)[0]!.length).trim();
      if (!text && !m.document && !m.photo?.length) return this.senden('🆕 Okay – deine nächste Nachricht wird eine neue Aufgabe.');
      return this.neueAufgabe(m, text);
    }
    if (m.voice || m.audio || m.video_note) return this.senden('🎙️ Sprachnachrichten kann das Dorf noch nicht verarbeiten. Schreib mir die Aufgabe bitte als Text.');

    // Reiner Text (nicht weitergeleitet, keine Datei) kann ein laufendes Gespräch fortsetzen.
    // Weitergeleitetes und Dateien werden immer neue Aufgaben – Fremdinhalt kommt nie direkt in einen Auftrag.
    const fremd = !!(m.forward_origin || m.forward_from || m.forward_from_chat || m.forward_date);
    // E64: Antwort auf „Warum abgelehnt?“ → Grund an die Freigabe (und damit an den Bürgermeister)
    if (text && !fremd && !m.document && !m.photo?.length) {
      const frage = this.grundFrage();
      const passt = frage && (m.reply_to_message ? m.reply_to_message.message_id === frage.messageId : this.o.uhr.jetzt() - frage.zeit < GRUND_MINUTEN * 60_000);
      if (frage && passt) return this.grundAnnehmen(frage.freigabeId, text);
    }
    if (text && !fremd && !m.document && !m.photo?.length) {
      const chatId = this.gespraechFinden(m);
      if (chatId) return this.fortsetzen(m, chatId, text);
    }
    return this.neueAufgabe(m, text);
  }

  private async fortsetzen(m: TgNachricht, chatId: string, text: string) {
    let c: ReturnType<AgentenDienst['chatZeile']>;
    try {
      c = this.o.agenten.chatZeile(chatId);
    } catch {
      return this.neueAufgabe(m, text);
    }
    try {
      this.o.agenten.nachrichtSenden(chatId, text, 'klick');
    } catch (e) {
      if (e instanceof DorfFehler && e.status === 409)
        return this.senden(`⏳ Im Gespräch „${h(c.titel)}“ wird gerade noch gearbeitet. Schick deine Nachricht gleich nochmal – oder <code>/neu …</code> für eine neue Aufgabe.`);
      return this.senden(`⚠️ Konnte die Nachricht nicht weitergeben: ${h((e as Error).message)}`);
    }
    this.verlaufMerken(m.message_id, chatId);
    await this.senden(`↪️ Weiter im Gespräch: <b>${h(c.titel)}</b> · <a href="${this.link(`/chats/${chatId}`)}">Chat öffnen</a>\n<i>/neu startet eine neue Aufgabe</i>`, {}, chatId);
  }

  private async neueAufgabe(m: TgNachricht, textRoh: string) {
    let text = textRoh;
    const anhaenge: string[] = [];
    try {
      const datei = m.document ?? (m.photo?.length ? { ...m.photo[m.photo.length - 1]!, file_name: `foto-${m.message_id}.jpg` } : undefined);
      if (datei) {
        if ((datei.file_size ?? 0) > MAX_DATEI) return this.senden('📎 Die Datei ist größer als 20 MB – so große Dateien kann ein Bot nicht laden. Lade sie bitte in der App hoch.');
        const d = await this.o.api.dateiLaden(datei.file_id);
        anhaenge.push(await this.o.schreibtisch.anhangSpeichern(datei.file_name ?? d.name, Readable.from(d.inhalt)));
      }
      if (!text && !anhaenge.length) return;
      const fremd = !!(m.forward_origin || m.forward_from || m.forward_from_chat || m.forward_date);
      // Antwort auf eine Dorf-Nachricht ohne zugehörigen Chat (z. B. Erinnerung): deren Text als Bezug mitgeben – als Daten
      const bezug = !fremd && m.reply_to_message ? (m.reply_to_message.text ?? m.reply_to_message.caption ?? '').trim() : '';
      if (bezug) text = `${text}\n\n---\nBezug – die Nachricht des Dorfs, auf die Leif antwortet:\n${fremdinhaltHuelle('telegram-bezug', bezug.slice(0, 2000))}`;
      const a = await this.o.schreibtisch.anlegen({ text, quelle: 'telegram', fremd, anhaenge });
      const r = await this.o.buergermeister.starten(a.id, 'klick');
      this.verlaufMerken(m.message_id, r.chatId);
      await this.senden(
        `📥 Neue Aufgabe auf dem Schreibtisch: <b>${h(a.titel)}</b>${fremd ? '\n(weitergeleitet – wird als Fremdinhalt behandelt)' : ''}\nDer Bürgermeister kümmert sich. <a href="${this.link(`/chats/${r.chatId}`)}">Chat öffnen</a>\n<i>Antworte einfach – das Gespräch läuft ${GESPRAECH_MINUTEN} Minuten weiter.</i>`,
        {},
        r.chatId,
      );
    } catch (e) {
      await this.senden(`⚠️ Konnte die Aufgabe nicht anlegen: ${h((e as Error).message)}`);
    }
  }

  private async befehl(b: string) {
    if (b === '/start' || b === '/hilfe' || b === '/help')
      return this.senden(
        `🏡 <b>Agentendorf</b>\nSchick mir eine Aufgabe als Text (oder Foto/Datei mit Beschreibung) – sie landet auf dem Schreibtisch des Bürgermeisters.\n\nWeiterschreiben setzt das Gespräch fort (bis ${GESPRAECH_MINUTEN} Minuten nach dem letzten Austausch). Antwortest du auf eine bestimmte Nachricht, geht es in genau diesem Chat weiter.\n\n/neu – nächste Nachricht wird eine neue Aufgabe (oder /neu &lt;Aufgabe&gt;)\n/status – was läuft gerade\n/freigaben – offene Freigaben\n/heute – dein Tag: Wetter, Termine, Fristen\n/fristen – Abgaben und Prüfungen der nächsten 7 Tage (mit Erledigt-Knöpfen)\n/moodle &lt;Fach&gt; [Frage] – in Moodle nachschauen lassen\n/aktion [Name] – Skill starten (ohne Name: Liste)\n/todo – To-do-Liste mit Abhak-Knöpfen (/todo &lt;Text&gt; legt eins an)\n/einkauf – Einkaufsliste (/einkauf &lt;Text&gt; setzt etwas drauf)\n/termin &lt;wann&gt; &lt;was&gt; – Termin in den Kalender (mit Bestätigung)\n/karten [Fach] – Karteikarten wiederholen\n/fokus [Thema] – Pomodoro starten\n/hilfe – diese Hilfe`,
      );
    if (b === '/status') {
      const aktiv = this.o.agenten.aktiveLaeufe();
      const offen = this.o.agenten.freigaben.anzahlOffen();
      const zeilen = aktiv.slice(0, 10).map((l) => {
        const c = this.o.agenten.chatZeile(l.chatId);
        return `• ${h(c.titel)} – ${l.status === 'laeuft' ? 'läuft' : l.status === 'wartend' ? 'wartet' : 'wartet auf Freigabe'}`;
      });
      return this.senden(`📊 <b>Status</b>\n${zeilen.length ? zeilen.join('\n') : 'Gerade arbeitet niemand.'}\n\n✉️ Offene Freigaben: ${offen}`);
    }
    if (b === '/heute') {
      // Tagesüberblick wie in der Morgenzeitung (Wetter, Termine, Fristen) – jederzeit, ohne KI und ohne Speichern
      if (!this.o.morgenzeitung) return this.senden('Der Tagesüberblick ist gerade nicht verfügbar.');
      const z = await this.o.morgenzeitung.fakten();
      const fett = (t: string) => h(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
      const teile = z.abschnitte
        .filter((a) => a.titel === 'Heute' || a.titel === 'Fristen (7 Tage)' || a.titel === 'Wartet auf dich')
        .map((a) => `<b>${h(a.titel)}</b>\n${a.zeilen.length ? a.zeilen.slice(0, 10).map((x) => `• ${fett(x)}`).join('\n') : '–'}`);
      return this.senden(`📅 <b>Dein Tag</b>\n\n${teile.join('\n\n')}\n\n<a href="${this.link('/gebaeude/Rathaus?reiter=morgenzeitung')}">Morgenzeitung</a>`);
    }
    if (b === '/fristen') {
      const jetzt = this.o.uhr.jetzt();
      const liste = (this.o.uni?.fristen() ?? [])
        .filter((f) => (f.art === 'abgabe' || f.art === 'test') && !f.abgegeben && f.frist && Date.parse(f.frist) < jetzt + 7 * 86_400_000)
        .slice(0, 10);
      if (!liste.length) return this.senden('🎉 Keine offenen Abgaben oder Prüfungen in den nächsten 7 Tagen.');
      const zeilen = liste.map((f) => `• <b>${h(fristText(Date.parse(f.frist!)))}</b> · ${f.art === 'test' ? 'Prüfung' : 'Abgabe'} · ${h(f.titel)}${f.kurs ? ` (${h(f.kurs)})` : ''}`);
      return this.senden(`⏰ <b>Fristen (7 Tage)</b>\n${zeilen.join('\n')}\n<a href="${this.link('/gebaeude/Uni')}">Zur Uni</a>`, {
        reply_markup: {
          inline_keyboard: liste.map((f) => [{ text: `✅ ${Array.from(f.titel).slice(0, 40).join('')}`, callback_data: `e:${f.id}:${this.erledigtSignatur(f.id)}` }]),
        },
      });
    }
    if (b === '/freigaben') {
      const offen = this.o.agenten.freigaben.liste('offen');
      if (!offen.length) return this.senden('✉️ Keine offenen Freigaben.');
      for (const f of offen.slice(0, 10)) await this.freigabeMelden(f, true);
      return;
    }
    return this.senden('Unbekannter Befehl. /hilfe zeigt, was geht.');
  }

  /** /moodle <Fach> [Frage] – „Moodle durchsehen“ direkt vom Handy starten (Leifs Auftrag → über sein Abo) */
  /** /aktion [Name] – Skills, die ohne Eingaben (oder mit Standardwerten) laufen, vom Handy starten */
  private async aktionBefehl(rest: string) {
    const startbar = (await aktionenListe(this.o.vault)).filter((a) => !a.fehler && a.rolle !== 'buergermeister' && a.eingaben.every((e) => !e.pflicht || e.standard));
    if (!rest) {
      if (!startbar.length) return this.senden('Keine Aktion lässt sich ohne Eingaben starten.');
      const zeilen = startbar.slice(0, 30).map((a) => `• <code>/aktion ${h(a.name)}</code> – ${h(a.gebaeude)}${a.zeitplan ? ` · ⏰ ${h(a.zeitplan)}` : ''}`);
      return this.senden(`🧩 <b>Aktionen zum Starten</b>\n${zeilen.join('\n')}`);
    }
    const klein = rest.toLowerCase();
    const treffer = startbar.filter((a) => a.name.toLowerCase() === klein || a.id.toLowerCase() === klein);
    const a = treffer[0] ?? (startbar.filter((x) => x.name.toLowerCase().includes(klein)).length === 1 ? startbar.find((x) => x.name.toLowerCase().includes(klein)) : undefined);
    if (!a) return this.senden(`Keine eindeutige Aktion „${h(rest)}“. /aktion zeigt die Liste.`);
    const r = await this.o.agenten.aktionStarten(a.id, {}, 'klick');
    return this.senden(`▶️ Gestartet: <b>${h(a.name)}</b> (${h(a.gebaeude)})\n<a href="${this.link(`/chats/${r.chatId}`)}">Chat öffnen</a>`, {}, r.chatId);
  }

  private async moodleBefehl(rest: string) {
    if (!this.o.agenten.moodleBrowser) return this.senden('🌐 Der Moodle-Browser ist noch nicht eingerichtet. Auf dem Server: <code>dorf moodle-browser-zugang</code>');
    const faecher = this.o.uni?.faecher() ?? [];
    if (!faecher.length) return this.senden('🎓 Noch keine Fächer – leg in der App unter Uni → Studium eins an.');
    const klein = rest.toLowerCase();
    // längster passender Fachname/-titel am Anfang, sonst eindeutiger Treffer des ersten Worts
    const kandidaten = faecher.flatMap((f) => [f.name, f.titel].map((n) => ({ f, n: n.toLowerCase() })));
    let treffer = kandidaten.filter((k) => klein === k.n || klein.startsWith(`${k.n} `)).sort((a, b) => b.n.length - a.n.length)[0];
    let frage = treffer ? rest.slice(treffer.n.length).trim() : '';
    if (!treffer && rest) {
      const wort = klein.split(/\s+/)[0]!;
      const passend = [...new Set(kandidaten.filter((k) => k.n.includes(wort)).map((k) => k.f))];
      if (passend.length === 1) {
        treffer = { f: passend[0]!, n: wort };
        frage = rest.slice(wort.length).trim();
      }
    }
    if (!treffer)
      return this.senden(`🌐 Welches Fach? Zum Beispiel:\n${faecher.slice(0, 12).map((f) => `<code>/moodle ${h(f.name)}</code>`).join('\n')}\n\nDanach optional deine Frage, z. B. „was muss ich bis Donnerstag vorbereiten?“`);
    try {
      const r = await this.o.agenten.aktionStarten('Uni/moodle-durchsehen', { fach: treffer.f.name, frage }, 'klick');
      return this.senden(`🌐 Ich schaue in Moodle nach: <b>${h(treffer.f.titel)}</b>${frage ? `\n<i>${h(frage.slice(0, 300))}</i>` : ''}\n<a href="${this.link(`/chats/${r.chatId}`)}">Chat öffnen</a>`, {}, r.chatId);
    } catch (e) {
      return this.senden(`⚠️ Konnte nicht starten: ${h((e as Error).message)}`);
    }
  }

  // ---- Knöpfe ---------------------------------------------------------------------------------

  signatur(id: string, antwort: 'j' | 'n') {
    return crypto.createHmac('sha256', this.signaturSchluessel).update(`${id}:${antwort}`).digest('base64url').slice(0, 16);
  }

  private knoepfe(id: string) {
    return {
      inline_keyboard: [
        [
          { text: '✅ Ja', callback_data: `f:${id}:j:${this.signatur(id, 'j')}` },
          { text: '❌ Nein', callback_data: `f:${id}:n:${this.signatur(id, 'n')}` },
        ],
      ],
    };
  }

  private async knopf(q: NonNullable<TgUpdate['callback_query']>) {
    const antworten = (text: string) => this.o.api.aufruf('answerCallbackQuery', { callback_query_id: q.id, text }).catch(() => undefined);
    if (!this.istLeif(q.from.id) && !this.istLeif(q.message?.chat.id)) return antworten('Nicht erlaubt.');
    if (q.data?.startsWith('e:')) return this.erledigtKnopf(q, antworten);
    if (q.data?.startsWith('v:')) return this.vorbereitenKnopf(q, antworten);
    if (q.data?.startsWith('t:') || q.data?.startsWith('l:')) return this.todoKnopf(q, antworten);
    if (q.data?.startsWith('k:')) return this.terminKnopf(q, antworten);
    if (q.data?.startsWith('kk:')) return this.karteKnopf(q, antworten);
    if (q.data?.startsWith('st:')) return this.sternKnopf(q, antworten);
    const m = /^f:([0-9a-f-]{36}):([jn]):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    if (!m || !crypto.timingSafeEqual(Buffer.from(m[3]!), Buffer.from(this.signatur(m[1]!, m[2] as 'j' | 'n')))) {
      this.o.log?.('Telegram: Knopf mit ungültiger Signatur abgelehnt.');
      return antworten('Ungültiger Knopf.');
    }
    try {
      const f = await this.o.agenten.freigaben.entscheiden(m[1]!, m[2] === 'j');
      await antworten(f.status === 'abgelehnt' ? 'Abgelehnt.' : f.status === 'fehlgeschlagen' ? 'Ausführung fehlgeschlagen.' : 'Erledigt.');
      if (f.status === 'abgelehnt') await this.grundErfragen(f);
    } catch (e) {
      if (e instanceof DorfFehler && e.status === 409) {
        await antworten('Diese Freigabe wurde schon entschieden.');
        await this.freigabeAktualisieren(this.o.agenten.freigaben.holen(m[1]!));
      } else await antworten(`Fehler: ${(e as Error).message}`.slice(0, 190));
    }
  }

  // ---- To-do-Brett (E65) und weitere Listen (Etappe 7) ------------------------------------------

  private todoKennung(pfad: string) {
    return crypto.createHash('sha256').update(pfad).digest('hex').slice(0, 12);
  }
  /** Signatur eines Abhak-Knopfs; die To-do-Liste behält ihr altes Format (ältere Nachrichten bleiben gültig) */
  todoSignatur(kennung: string, liste: ListenName = 'todo') {
    return crypto
      .createHmac('sha256', this.signaturSchluessel)
      .update(liste === 'todo' ? `todo:${kennung}` : `liste:${liste}:${kennung}`)
      .digest('base64url')
      .slice(0, 16);
  }
  private knopfDaten(liste: ListenName, kennung: string) {
    return liste === 'todo' ? `t:${kennung}:${this.todoSignatur(kennung)}` : `l:${LISTEN_KURZ[liste]}:${kennung}:${this.todoSignatur(kennung, liste)}`;
  }

  private async todoListeText(liste: ListenName) {
    const a = LISTEN_ANZEIGE[liste];
    const offen = (await this.o.listen![liste].liste()).filter((t) => !t.erledigt);
    if (!offen.length) return { text: `${a.symbol} <b>${a.titel}</b>\nNichts offen. 🎉\n<i>${a.befehl} &lt;Text&gt; legt einen Eintrag an.</i>`, knoepfe: [] as { text: string; callback_data: string }[][] };
    const zeilen = offen.slice(0, 25).map((t) => `• ${t.wichtig ? '⭐ ' : ''}${h(t.titel)}${t.gruppe ? ` <i>[${h(t.gruppe)}]</i>` : ''}${t.faellig ? ` <i>(bis ${h(t.faellig)})</i>` : ''}`);
    const knoepfe = offen.slice(0, 12).map((t) => [{ text: `✅ ${t.titel}`.slice(0, 60), callback_data: this.knopfDaten(liste, this.todoKennung(t.pfad)) }]);
    return {
      text: `${a.symbol} <b>${a.titel}</b> (${offen.length} offen)\n${zeilen.join('\n')}${offen.length > 25 ? '\n…' : ''}\n<a href="${this.link(`/?g=${encodeURIComponent(LISTEN[liste].gebaeude)}`)}">Öffnen</a>`,
      knoepfe,
    };
  }

  private async todoBefehl(rest: string, liste: ListenName = 'todo') {
    if (!this.o.listen) return this.senden('Die Listen sind nicht eingerichtet.');
    if (rest) {
      try {
        const t = await this.o.listen[liste].anlegen({ titel: rest.slice(0, 200) }, 'Telegram');
        return this.senden(`${LISTEN_ANZEIGE[liste].symbol} Auf die ${LISTEN[liste].titel}: <b>${h(t.titel)}</b>`);
      } catch (e) {
        return this.senden(`⚠️ ${h((e as Error).message)}`);
      }
    }
    const l = await this.todoListeText(liste);
    return this.senden(l.text, l.knoepfe.length ? { reply_markup: { inline_keyboard: l.knoepfe } } : {});
  }

  private async todoKnopf(q: NonNullable<TgUpdate['callback_query']>, antworten: (t: string) => Promise<unknown>) {
    const alt = /^t:([0-9a-f]{12}):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    const neu = /^l:([a-z]):([0-9a-f]{12}):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    const liste: ListenName | undefined = alt ? 'todo' : neu ? (Object.entries(LISTEN_KURZ).find(([, k]) => k === neu[1])?.[0] as ListenName | undefined) : undefined;
    const kennung = alt?.[1] ?? neu?.[2];
    const sig = alt?.[2] ?? neu?.[3];
    if (!liste || !kennung || !sig || !this.o.listen || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(this.todoSignatur(kennung, liste)))) {
      this.o.log?.('Telegram: Listen-Knopf mit ungültiger Signatur abgelehnt.');
      return antworten('Ungültiger Knopf.');
    }
    const dienst = this.o.listen[liste];
    const t = (await dienst.liste()).find((x) => this.todoKennung(x.pfad) === kennung);
    if (!t) return antworten('Diesen Eintrag gibt es nicht mehr.');
    if (!t.erledigt) await dienst.aendern(t.pfad, { erledigt: true });
    await antworten(`Erledigt: ${t.titel}`.slice(0, 190));
    if (q.message) {
      const l = await this.todoListeText(liste);
      await this.o.api
        .aufruf('editMessageText', {
          chat_id: q.message.chat.id,
          message_id: q.message.message_id,
          text: l.text,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          ...(l.knoepfe.length ? { reply_markup: { inline_keyboard: l.knoepfe } } : {}),
        })
        .catch(() => undefined);
    }
  }

  // ---- /termin (Nacht 18./19.11.) ---------------------------------------------------------------

  private terminSignatur(id: string) {
    return crypto.createHmac('sha256', this.signaturSchluessel).update(`termin:${id}`).digest('base64url').slice(0, 16);
  }
  private terminWartend(): Record<string, { termin: TerminAusText; zeit: number }> {
    const w = (this.o.db.prepare("SELECT wert FROM dorf_stand WHERE schluessel = 'telegram_termine'").get() as { wert: string } | undefined)?.wert;
    return w ? JSON.parse(w) : {};
  }
  private terminWartendSetzen(x: Record<string, { termin: TerminAusText; zeit: number }>) {
    // höchstens 20, älter als ein Tag fällt weg
    const jetzt = this.o.uhr.jetzt();
    const rest = Object.entries(x)
      .filter(([, v]) => jetzt - v.zeit < 86_400_000)
      .slice(-20);
    this.o.db.prepare("INSERT OR REPLACE INTO dorf_stand (schluessel, wert) VALUES ('telegram_termine', ?)").run(JSON.stringify(Object.fromEntries(rest)));
  }
  static terminText(t: TerminAusText) {
    const tag = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
    const wann = t.ganztags ? `${tag(t.start)} (ganztags)` : `${tag(t.start)}, ${t.start.slice(11)}–${t.ende.slice(11)}`;
    return `<b>${h(t.titel)}</b>\n${wann}${t.ort ? `\n📍 ${h(t.ort)}` : ''}`;
  }

  private async terminBefehl(rest: string) {
    if (!rest)
      return this.senden('📅 <b>/termin</b> &lt;wann&gt; &lt;was&gt;\nz. B. <i>/termin morgen 14 Uhr Zahnarzt</i>, <i>/termin Fr 9-11 Lernen Mathe</i>, <i>/termin 20.11. 18:30 Kneipe @Corpshaus</i>');
    if (!this.o.kalender?.verbunden) return this.senden('📅 Der Google-Kalender ist noch nicht verbunden (auf dem Server: dorf gmail-anmelden, mit Kalender).');
    const t = terminAusText(rest, this.o.uhr.jetzt());
    if (!t) return this.senden('📅 Das habe ich nicht verstanden – z. B. <i>/termin morgen 14 Uhr Zahnarzt</i>.');
    const id = crypto.randomBytes(6).toString('hex');
    this.terminWartendSetzen({ ...this.terminWartend(), [id]: { termin: t, zeit: this.o.uhr.jetzt() } });
    return this.senden(`📅 So eintragen?\n${TelegramBot.terminText(t)}`, {
      reply_markup: { inline_keyboard: [[{ text: '✅ Eintragen', callback_data: `k:${id}:${this.terminSignatur(id)}` }]] },
    });
  }

  private async terminKnopf(q: NonNullable<TgUpdate['callback_query']>, antworten: (t: string) => Promise<unknown>) {
    const m = /^k:([0-9a-f]{12}):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    if (!m || !crypto.timingSafeEqual(Buffer.from(m[2]!), Buffer.from(this.terminSignatur(m[1]!)))) {
      this.o.log?.('Telegram: Termin-Knopf mit ungültiger Signatur abgelehnt.');
      return antworten('Ungültiger Knopf.');
    }
    const alle = this.terminWartend();
    const w = alle[m[1]!];
    if (!w || !this.o.kalender) return antworten('Schon eingetragen oder abgelaufen.');
    delete alle[m[1]!];
    this.terminWartendSetzen(alle);
    try {
      await this.o.kalender.inHauptkalender(w.termin);
    } catch (e) {
      return antworten(`Fehler: ${(e as Error).message}`.slice(0, 190));
    }
    await antworten('Eingetragen.');
    if (q.message)
      await this.o.api
        .aufruf('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: `📅 Eingetragen:\n${TelegramBot.terminText(w.termin)}`, parse_mode: 'HTML' })
        .catch(() => undefined);
  }

  // ---- /karten und /fokus (Nacht 18./19.11.) -----------------------------------------------------

  private karteSignatur(teil: string) {
    return crypto.createHmac('sha256', this.signaturSchluessel).update(`karte:${teil}`).digest('base64url').slice(0, 16);
  }
  /** Knopf: kk:<Fach-Nr>:<Karten-Id>:<a|n|s|g|l>:<Signatur> – a = Antwort zeigen */
  private karteDaten(nr: number, id: string, b: string) {
    const teil = `${nr}:${id}:${b}`;
    return `kk:${teil}:${this.karteSignatur(teil)}`;
  }
  private async kartenFaecher() {
    return (await this.o.karten!.uebersicht()).map((f) => f.fach);
  }

  private async karteZeigen(nr: number, fach: string, ziel?: { chat: number | string; message: number }) {
    const k = (await this.o.karten!.faellig(fach, 1))[0];
    const text = k ? `🃏 <b>${h(fach)}</b>${k.neu ? ' · neu' : ''}\n\n${h(k.frage)}` : `🃏 <b>${h(fach)}</b>\nFertig für heute. 🎉`;
    const extra = k ? { reply_markup: { inline_keyboard: [[{ text: 'Antwort zeigen', callback_data: this.karteDaten(nr, k.id, 'a') }]] } } : {};
    if (ziel) return this.o.api.aufruf('editMessageText', { chat_id: ziel.chat, message_id: ziel.message, text, parse_mode: 'HTML', ...extra }).catch(() => undefined);
    return this.senden(text, extra);
  }

  private async kartenBefehl(rest: string) {
    if (!this.o.karten) return this.senden('Karteikarten sind nicht eingerichtet.');
    const ueb = await this.o.karten.uebersicht();
    if (!ueb.length) return this.senden('🃏 Noch keine Karteikarten. In der App: Uni → Aktionen → „Karteikarten erstellen“.');
    const f = rest ? ueb.find((x) => x.fach.toLowerCase().includes(rest.toLowerCase())) : ueb.filter((x) => x.faellig).sort((a, b) => b.faellig - a.faellig)[0];
    if (!f) {
      const zeilen = ueb.map((x) => `• ${h(x.fach)}: <b>${x.faellig}</b> dran`);
      return this.senden(`🃏 <b>Karteikarten</b>\n${zeilen.join('\n')}\n\n<i>/karten &lt;Fach&gt; zum Lernen</i>`);
    }
    return this.karteZeigen(ueb.findIndex((x) => x.fach === f.fach), f.fach);
  }

  private async karteKnopf(q: NonNullable<TgUpdate['callback_query']>, antworten: (t: string) => Promise<unknown>) {
    const m = /^kk:(\d{1,3}):([0-9a-f]{20}):([ansgl]):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    if (!m || !this.o.karten || !crypto.timingSafeEqual(Buffer.from(m[4]!), Buffer.from(this.karteSignatur(`${m[1]}:${m[2]}:${m[3]}`)))) {
      this.o.log?.('Telegram: Karten-Knopf mit ungültiger Signatur abgelehnt.');
      return antworten('Ungültiger Knopf.');
    }
    const nr = Number(m[1]);
    const fach = (await this.kartenFaecher())[nr];
    const karte = fach ? (await this.o.karten.karten(fach)).find((x) => x.id === m[2]) : undefined;
    if (!fach || !karte) return antworten('Diese Karte gibt es nicht mehr.');
    const ziel = q.message ? { chat: q.message.chat.id, message: q.message.message_id } : undefined;
    if (m[3] === 'a') {
      await antworten('');
      const knopf = (t: string, b: string) => ({ text: t, callback_data: this.karteDaten(nr, karte.id, b) });
      if (ziel)
        await this.o.api
          .aufruf('editMessageText', {
            chat_id: ziel.chat,
            message_id: ziel.message,
            text: `🃏 <b>${h(fach)}</b>\n\n${h(karte.frage)}\n\n<b>Antwort:</b>\n${h(karte.antwort)}`,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[knopf('Nochmal', 'n'), knopf('Schwer', 's'), knopf('Gut', 'g'), knopf('Leicht', 'l')]] },
          })
          .catch(() => undefined);
      return;
    }
    const b = ({ n: 'nochmal', s: 'schwer', g: 'gut', l: 'leicht' } as const)[m[3] as 'n' | 's' | 'g' | 'l'];
    await this.o.karten.antworten(fach, karte.id, b);
    await antworten(b === 'nochmal' ? 'Kommt gleich wieder.' : 'Weiter!');
    await this.karteZeigen(nr, fach, ziel);
  }

  // ---- Tagesabschluss 21:00 (Nacht 18./19.11.) ----------------------------------------------------

  /** 21:00–21:59 Linz, einmal am Tag (Schalter „abend“) – wird vom 10-min-Takt aufgerufen */
  async abendSenden(erzwingen = false) {
    if (!this.o.listen || !(await einstellungenLaden(this.o.vault)).abend) return false;
    const jetzt = this.o.uhr.jetzt();
    const tag = new Date(jetzt).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
    const stunde = Number(new Date(jetzt).toLocaleString('en-GB', { timeZone: 'Europe/Vienna', hour: '2-digit', hour12: false }));
    const schon = (this.o.db.prepare("SELECT wert FROM dorf_stand WHERE schluessel = 'telegram_abend'").get() as { wert: string } | undefined)?.wert;
    if (!erzwingen && (stunde !== 21 || schon === tag)) return false;
    this.o.db.prepare("INSERT OR REPLACE INTO dorf_stand (schluessel, wert) VALUES ('telegram_abend', ?)").run(tag);
    const alle = await this.o.listen.todo.liste();
    const erledigt = alle.filter((t) => t.erledigt && t.erledigtAm && new Date(t.erledigtAm).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' }) === tag);
    const fokus = this.o.kirchturm?.fokusStatistik?.();
    const karten = this.o.karten ? (await this.o.karten.uebersicht()).reduce((s2, f) => s2 + f.faellig, 0) : 0;
    const morgen = new Date(jetzt + 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
    const fristen = (this.o.uni?.fristen() ?? []).filter((f) => (f.art === 'abgabe' || f.art === 'test') && !f.abgegeben && f.frist && new Date(f.frist).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' }) === morgen);
    const z = [`🌙 <b>Tagesabschluss</b>`];
    z.push(erledigt.length ? `✓ <b>${erledigt.length}</b> erledigt: ${erledigt.slice(0, 6).map((t) => h(t.titel)).join(', ')}` : '✓ Heute nichts abgehakt – morgen ist ein neuer Tag.');
    if (fokus?.heuteMin) z.push(`🍅 ${fokus.heuteMin} min Fokus${fokus.serie > 1 ? ` · ${fokus.serie} Tage in Folge 🔥` : ''}`);
    if (karten) z.push(`🃏 ${karten} Karteikarten noch dran – /karten`);
    if (fristen.length) z.push(`⏰ Morgen fällig: ${fristen.map((f) => h(f.titel)).join(', ')}`);
    z.push('\n⭐ <b>Was ist morgen wichtig?</b> Tipp an, was oben auf deiner Liste stehen soll:');
    const t = this.sternAuswahl(alle, morgen);
    return !!(await this.senden(z.join('\n'), { reply_markup: { inline_keyboard: t } }));
  }

  private sternSignatur(k: string) {
    return crypto.createHmac('sha256', this.signaturSchluessel).update(`stern:${k}`).digest('base64url').slice(0, 16);
  }
  private sternAuswahl(alle: TodoInfo[], morgen: string) {
    const offen = alle.filter((t) => !t.erledigt).sort((a, b) => Number(!!b.wichtig) - Number(!!a.wichtig) || (a.faellig ?? '9999').localeCompare(b.faellig ?? '9999'));
    return offen.slice(0, 8).map((t) => {
      const k = this.todoKennung(t.pfad);
      return [{ text: `${t.wichtig ? '⭐' : '☆'} ${t.titel}${t.faellig && t.faellig <= morgen ? ` (${t.faellig === morgen ? 'morgen' : 'fällig'})` : ''}`.slice(0, 60), callback_data: `st:${k}:${this.sternSignatur(k)}` }];
    });
  }

  private async sternKnopf(q: NonNullable<TgUpdate['callback_query']>, antworten: (t: string) => Promise<unknown>) {
    const m = /^st:([0-9a-f]{12}):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    if (!m || !this.o.listen || !crypto.timingSafeEqual(Buffer.from(m[2]!), Buffer.from(this.sternSignatur(m[1]!)))) {
      this.o.log?.('Telegram: Stern-Knopf mit ungültiger Signatur abgelehnt.');
      return antworten('Ungültiger Knopf.');
    }
    const alle = await this.o.listen.todo.liste();
    const t = alle.find((x) => this.todoKennung(x.pfad) === m[1]);
    if (!t) return antworten('Dieses To-do gibt es nicht mehr.');
    await this.o.listen.todo.aendern(t.pfad, { wichtig: !t.wichtig });
    await antworten(t.wichtig ? 'Nicht mehr wichtig.' : '⭐ Wichtig für morgen.');
    if (q.message) {
      const neu = await this.o.listen.todo.liste();
      const morgen = new Date(this.o.uhr.jetzt() + 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
      await this.o.api
        .aufruf('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: this.sternAuswahl(neu, morgen) } })
        .catch(() => undefined);
    }
  }

  private async fokusBefehl(rest: string) {
    if (!this.o.kirchturm) return this.senden('Der Kirchturm ist nicht eingerichtet.');
    try {
      this.o.kirchturm.ausfuehren(rest ? { befehl: 'pomodoro_fuer', titel: rest.slice(0, 200) } : { befehl: 'pomodoro', aktion: 'start' });
    } catch (e) {
      return this.senden(`⚠️ ${h((e as Error).message)}`);
    }
    return this.senden(`🍅 Fokus läuft${rest ? `: <b>${h(rest)}</b>` : ''}. Bis die Runde um ist, halte ich Meldungen zurück (Nicht stören).`);
  }

  // ---- Bank (Etappe 7) --------------------------------------------------------------------------

  /** Budget-Warnung (schaltbar: bank); nachts gesammelt */
  async bankMelden(text: string) {
    if (!(await einstellungenLaden(this.o.vault)).bank) return;
    await this.proaktiv(`${h(text)}\n<a href="${this.link('/?g=Bank')}">Zur Bank</a>`);
  }

  /** E73: Saxo-Sitzung beendet → neu verbinden (Schalter wie Bank: Geld) */
  async saxoMelden(text: string) {
    if (!(await einstellungenLaden(this.o.vault)).bank) return;
    await this.proaktiv(`${h(text)}\n<a href="${this.link('/?g=Boerse')}">Zur Börse</a>`);
  }

  // ---- Ablehnen mit Begründung (E64) ----------------------------------------------------------

  private grundFrage() {
    const w = (this.o.db.prepare("SELECT wert FROM dorf_stand WHERE schluessel = 'telegram_grund_frage'").get() as { wert: string } | undefined)?.wert;
    return w ? (JSON.parse(w) as { messageId: number; freigabeId: string; zeit: number }) : null;
  }
  private grundFrageSetzen(f: { messageId: number; freigabeId: string; zeit: number } | null) {
    if (!f) this.o.db.prepare("DELETE FROM dorf_stand WHERE schluessel = 'telegram_grund_frage'").run();
    else
      this.o.db
        .prepare("INSERT INTO dorf_stand (schluessel, wert) VALUES ('telegram_grund_frage', ?) ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert")
        .run(JSON.stringify(f));
  }

  private async grundErfragen(f: FreigabeInfo) {
    const r = await this.senden(
      `❌ <b>Abgelehnt:</b> ${h(f.titel)}
Magst du kurz sagen, warum? Antworte einfach mit einem Satz – ${f.chatId ? 'der Bürgermeister macht dann einen besseren Vorschlag und merkt es sich' : 'ich vermerke es an der Freigabe'}.
<i>(Keine Lust? Einfach ignorieren.)</i>`,
    );
    if (typeof r?.message_id === 'number') this.grundFrageSetzen({ messageId: r.message_id, freigabeId: f.id, zeit: this.o.uhr.jetzt() });
  }

  private async grundAnnehmen(freigabeId: string, grund: string) {
    this.grundFrageSetzen(null);
    try {
      const f = await this.o.agenten.freigaben.grundNachreichen(freigabeId, grund);
      await this.senden(`📝 Danke – ${f.chatId ? 'der Bürgermeister bekommt deinen Grund und überlegt neu.' : 'vermerkt.'}`, {}, f.chatId ?? undefined);
    } catch (e) {
      await this.senden(`⚠️ ${h((e as Error).message)}`);
    }
  }

  // ---- Meldungen ------------------------------------------------------------------------------

  // ---- Nachtruhe (22–7 Uhr Linz): nur Dringendes sofort, der Rest gesammelt um 7 Uhr (E56) -------------

  /** Nacht ODER Fokus (Pomodoro-Arbeitsphase mit „Nicht stören“): nur Dringendes sofort, der Rest gesammelt */
  fokusAktiv: () => boolean = () => false;
  private async nachtruhe() {
    if (this.fokusAktiv()) return true;
    return istNacht(this.o.uhr.jetzt()) && (await aufwachEinstellungen(this.o.vault)).nachtruhe;
  }
  private nachtListe(): { text: string; freigabe?: string; fokus?: boolean }[] {
    const w = (this.o.db.prepare("SELECT wert FROM dorf_stand WHERE schluessel = 'telegram_nacht'").get() as { wert: string } | undefined)?.wert;
    return w ? (JSON.parse(w) as { text: string; freigabe?: string; fokus?: boolean }[]) : [];
  }
  private nachtListeSetzen(l: { text: string; freigabe?: string; fokus?: boolean }[]) {
    this.o.db
      .prepare("INSERT INTO dorf_stand (schluessel, wert) VALUES ('telegram_nacht', ?) ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert")
      .run(JSON.stringify(l.slice(-50)));
  }

  /** Meldung, die Leif nicht selbst angestoßen hat: nachts gesammelt statt gesendet */
  private async proaktiv(text: string, extra: Record<string, unknown> = {}, gehoertZuChat?: string) {
    if (await this.nachtruhe()) {
      this.nachtListeSetzen([...this.nachtListe(), { text, ...(this.fokusAktiv() && !istNacht(this.o.uhr.jetzt()) ? { fokus: true } : {}) }]);
      return null;
    }
    return this.senden(text, extra, gehoertZuChat);
  }

  /** Nach der Nachtruhe: Gesammeltes in einer Nachricht, wartende Freigaben mit Knöpfen */
  async nachtNachholen() {
    const l = this.nachtListe();
    if (!l.length || (await this.nachtruhe())) return 0;
    // der Link am Ende (Chat öffnen, Zur Uni …) bleibt als kurzes „· öffnen“ – so kommt Leif direkt hin
    const texte = l
      .filter((x) => !x.freigabe)
      .map((x) => {
        const link = /\n(<a href="[^"]*">)[^<]*<\/a>$/.exec(x.text);
        const rumpf = kuerzen(link ? x.text.slice(0, link.index) : x.text, 1100);
        return link ? `${rumpf} · ${link[1]}öffnen</a>` : rumpf;
      });
    if (texte.length) {
      // ganze Meldungen, nie mitten in einem HTML-Tag abschneiden (sonst lehnt Telegram die Nachricht ab)
      const kopf = l.every((x) => x.fokus) ? `🍅 <b>Während deiner Fokuszeit</b> (${texte.length})` : `🌙 <b>Über Nacht</b> (${texte.length})`;
      const teile: string[] = [];
      let laenge = kopf.length;
      for (const t of texte) {
        if (laenge + t.length + 2 > 3600) break;
        teile.push(t);
        laenge += t.length + 2;
      }
      const rest = texte.length - teile.length;
      await this.senden(
        `${kopf}\n\n${teile.join('\n\n')}${rest ? `\n\n… und ${rest} weitere – <a href="${this.link('/gebaeude/Rathaus?reiter=alle-chats')}">Alle Chats</a>` : ''}`,
      );
    }
    // erst NACH dem Senden austragen – schlägt es fehl, bleibt alles für den nächsten Versuch; neu Dazugekommenes bleibt
    this.nachtListeSetzen(this.nachtListe().slice(l.length));
    for (const x of l.filter((y) => y.freigabe)) {
      const f = this.o.agenten.freigaben.liste('offen').find((y) => y.id === x.freigabe);
      if (f) await this.freigabeMelden(f, true);
    }
    return l.length;
  }

  private link(pfad: string) {
    return `${this.o.appUrl}${pfad}`;
  }

  async senden(text: string, extra: Record<string, unknown> = {}, gehoertZuChat?: string) {
    const r = await this.o.api.aufruf<{ message_id: number }>('sendMessage', {
      chat_id: this.o.chatId,
      text: text.slice(0, 4000),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...extra,
    });
    // Merken, zu welchem Dorf-Chat die Nachricht gehört – eine Antwort darauf setzt genau diesen Chat fort
    if (gehoertZuChat && typeof r?.message_id === 'number') this.verlaufMerken(r.message_id, gehoertZuChat);
    return r;
  }

  private verlaufMerken(messageId: number, chatId: string) {
    this.o.db
      .prepare(
        `INSERT INTO telegram_verlauf (message_id, chat_id, zeit, nr) VALUES (?, ?, ?, (SELECT COALESCE(MAX(nr), 0) + 1 FROM telegram_verlauf))
         ON CONFLICT(message_id) DO UPDATE SET chat_id = excluded.chat_id, zeit = excluded.zeit, nr = excluded.nr`,
      )
      .run(messageId, chatId, this.o.uhr.jetzt());
  }

  /**
   * Wohin gehört eine neue Textnachricht?
   * 1. Antwort auf eine Bot-Nachricht → deren Chat.
   * 2. Sonst: das laufende Gespräch mit dem Bürgermeister, wenn der letzte Austausch < GESPRAECH_MINUTEN her ist
   *    und danach kein /neu kam.
   * 3. Sonst: neue Aufgabe.
   */
  private gespraechFinden(m: TgNachricht): string | null {
    const db = this.o.db;
    if (m.reply_to_message) {
      const z = db.prepare('SELECT chat_id FROM telegram_verlauf WHERE message_id = ?').get(m.reply_to_message.message_id) as { chat_id: string } | undefined;
      return z?.chat_id || null;
    }
    const letzte = db.prepare('SELECT chat_id, zeit FROM telegram_verlauf ORDER BY nr DESC LIMIT 1').get() as { chat_id: string; zeit: number } | undefined;
    if (!letzte?.chat_id || this.o.uhr.jetzt() - letzte.zeit > GESPRAECH_MINUTEN * 60_000) return null;
    // fortgesetzt wird das Gespräch mit dem Bürgermeister (nicht ein Helfer-Chat, zu dem zuletzt eine Meldung kam)
    const c = db.prepare('SELECT id, rolle, eltern_chat_id FROM chats WHERE id = ?').get(letzte.chat_id) as { id: string; rolle: string | null; eltern_chat_id: string | null } | undefined;
    if (!c) return null;
    const ziel = c.rolle === 'buergermeister' ? c.id : c.eltern_chat_id;
    return ziel ?? null;
  }

  private freigabeText(f: FreigabeInfo) {
    if (f.art === 'plan_ausfuehren') {
      const p = f.inhalt as PlanInhalt;
      const teile = p.teilaufgaben.map((t, i) => `${i + 1}. ${h(t.titel)} – ${h(t.gebaeude)} (${t.aktion ? h(t.aktion) : 'freier Helfer'}, ${t.stufe})`);
      return `📋 <b>Plan des Bürgermeisters</b>\n${h(p.zusammenfassung)}\n\n${teile.join('\n')}\n\n${h(p.hinweis)}${p.begruendung ? `\n\n<i>${h(p.begruendung.slice(0, 600))}</i>` : ''}`;
    }
    const i = f.inhalt as { pfad?: string; beschreibung?: string; inhalt?: string };
    return `✉️ <b>Freigabe: ${h(f.titel)}</b>\n${ARTEN[f.art] ?? h(f.art)} · ${h(f.gebaeude)}${i.pfad ? `\nDatei: <code>${h(i.pfad)}</code>` : ''}${i.beschreibung ? `\n${h(i.beschreibung)}` : ''}${f.begruendung ? `\n\n<i>${h(f.begruendung.slice(0, 600))}</i>` : ''}${f.art === 'persoenlichkeit_aendern' && i.inhalt ? `\n\n<pre>${h(i.inhalt.replace(/^---[\s\S]*?---\s*/, '').slice(0, 1500))}</pre>` : ''}`;
  }

  private async freigabeMelden(f: FreigabeInfo, immer = false) {
    if (!immer && !(await einstellungenLaden(this.o.vault)).freigaben) return;
    if (f.status !== 'offen') return;
    if (!immer && (await this.nachtruhe())) {
      this.nachtListeSetzen([...this.nachtListe(), { text: '', freigabe: f.id }]);
      return;
    }
    const r = await this.senden(
      `${this.freigabeText(f)}\n\n<a href="${this.link('/gebaeude/Rathaus?reiter=freigaben')}">In der App ansehen</a>`,
      { reply_markup: this.knoepfe(f.id) },
      f.chatId ?? undefined,
    );
    this.o.db
      .prepare('INSERT INTO telegram_nachrichten (freigabe_id, chat_id, message_id) VALUES (?, ?, ?) ON CONFLICT(freigabe_id) DO UPDATE SET message_id = excluded.message_id')
      .run(f.id, this.o.chatId, r.message_id);
  }

  /** Nach der Entscheidung (in App oder Telegram): Knöpfe weg, Ergebnis rein. */
  private async freigabeAktualisieren(f: FreigabeInfo) {
    const n = this.o.db.prepare('SELECT chat_id, message_id FROM telegram_nachrichten WHERE freigabe_id = ?').get(f.id) as { chat_id: string; message_id: number } | undefined;
    if (!n) return;
    const ergebnis =
      f.status === 'abgelehnt' ? '❌ Abgelehnt' : f.status === 'fehlgeschlagen' ? `⚠️ Fehlgeschlagen: ${h(f.ergebnis ?? '')}` : `✅ Angenommen${f.automatisch ? ' (automatisch – keine Antwort)' : ''}${f.ergebnis ? ` – ${h(f.ergebnis)}` : ''}`;
    await this.o.api
      .aufruf('editMessageText', {
        chat_id: n.chat_id,
        message_id: n.message_id,
        text: `${this.freigabeText(f)}\n\n<b>${ergebnis}</b>`.slice(0, 4000),
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      })
      .catch(() => undefined); // z. B. „message is not modified“
  }

  private async laufMelden(e: LaufEnde) {
    if (e.status === 'abgebrochen') return;
    const k = await einstellungenLaden(this.o.vault);
    const c = this.o.agenten.chatZeile(e.chatId);
    const link = `<a href="${this.link(`/chats/${c.id}`)}">Chat öffnen</a>`;
    if (e.status === 'fehler') {
      if (k.fehler) await this.proaktiv(`❌ <b>Fehler</b>: ${h(c.titel)}\n${h((e.fehler ?? '').slice(0, 500))}\n${link}`, {}, c.id);
      return;
    }
    // Von selbst aufgewacht und nichts getan → keine Meldung (Leif will nur hören, wenn etwas passiert ist)
    if (c.rolle === 'buergermeister' && c.schreibtisch_id) {
      const quelle = (this.o.db.prepare('SELECT quelle FROM schreibtisch WHERE id = ?').get(c.schreibtisch_id) as { quelle: string } | undefined)?.quelle;
      const getan = this.o.db
        .prepare("SELECT 1 FROM werkzeug_log WHERE lauf_id = ? AND erlaubt = 1 AND werkzeug IN ('helfer_starten', 'plan_vorlegen', 'vault_schreiben', 'freigabe_beantragen') LIMIT 1")
        .get(e.laufId);
      if (quelle === 'aufwachen' && !getan) return;
    }
    // Wartet ein Plan auf Freigabe, kommt die Plan-Nachricht mit Knöpfen – keine zweite Meldung.
    if (c.rolle === 'buergermeister' && this.o.db.prepare("SELECT 1 FROM plaene WHERE chat_id = ? AND status = 'wartet'").get(c.id)) return;
    if (e.geschrieben.length && k.entwuerfe) {
      const dateien = e.geschrieben.slice(0, 5).map((p) => `• <code>${h(p)}</code>`).join('\n');
      await this.proaktiv(`📝 <b>Fertig mit Entwurf</b>: ${h(c.titel)}\n${dateien}\n${link}`, {}, c.id);
      return;
    }
    if (k.beendet) {
      const antwort = (this.o.db.prepare("SELECT text FROM nachrichten WHERE lauf_id = ? AND rolle = 'agent' ORDER BY id DESC LIMIT 1").get(e.laufId) as { text: string } | undefined)?.text ?? '';
      const kurz = antwort.split(/^##\s*Zusammenfassung/m)[0]!.trim().slice(0, 600);
      await this.proaktiv(`✅ <b>Fertig</b>: ${h(c.titel)}${kurz ? `\n\n${h(kurz)}${antwort.length > 600 ? ' …' : ''}` : ''}\n${link}`, {}, c.id);
    }
  }

  private async abschlussMelden(a: { chatId: string; titel: string; text: string }) {
    const k = await einstellungenLaden(this.o.vault);
    if (!k.beendet) return;
    const zeilen = a.text
      .split('\n')
      .filter((z) => z.startsWith('- '))
      .map((z) => h(z.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/ · \[\[[^\]]*\]\]/g, '')))
      .join('\n');
    await this.proaktiv(`🏁 <b>Aufgabe erledigt</b>: ${h(a.titel)}\n${zeilen}\n<a href="${this.link(`/chats/${a.chatId}`)}">Chat öffnen</a>`, {}, a.chatId);
  }
}

/** Lange HTML-Meldung als Klartext kürzen – ohne halbe Tags oder Entities */
function kuerzen(t: string, max: number) {
  if (t.length <= max) return t;
  return `${t
    .replace(/<[^>]+>/g, '')
    .slice(0, max - 2)
    .replace(/&[^;\s]*$/, '')} …`;
}
