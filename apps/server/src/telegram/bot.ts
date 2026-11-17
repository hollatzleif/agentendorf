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

const ARTEN: Record<string, string> = {
  datei_loeschen: 'Datei löschen',
  datei_ueberschreiben: 'Datei überschreiben',
  sonstiges: 'Sonstiges',
  lauf_starten: 'Aktion starten',
  plan_ausfuehren: 'Plan ausführen',
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

  /** Wichtige neue Mails – nur mit Schalter „mails“ (standardmäßig aus: Leifs Mail-Assistent meldet schon) */
  async mailsMelden(m: PostMail[]) {
    if (!(await einstellungenLaden(this.o.vault)).mails) return;
    const zeilen = m.slice(0, 8).map((x) => `• ${h(x.von)}: <b>${h(x.betreff)}</b>${x.zusammenfassung ? `\n  ${h(x.zusammenfassung)}` : ''}`);
    await this.senden(`📬 <b>${m.length === 1 ? 'Wichtige Mail' : `${m.length} wichtige Mails`}</b>\n${zeilen.join('\n')}\n<a href="${this.link('/gebaeude/Post')}">Zur Post</a>`);
  }

  /** Neues aus Moodle (Schalter „moodle“); ein Abgleich-Fehler wird nur gemeldet, wenn er neu ist (nicht alle 3 Stunden derselbe). */
  async moodleMelden(e: AbgleichErgebnis) {
    const k = await einstellungenLaden(this.o.vault);
    if (!e.ok) {
      if (k.fehler && e.fehler !== this.letzterMoodleFehler) await this.senden(`❌ <b>Moodle-Abgleich fehlgeschlagen</b>\n${h((e.fehler ?? '').slice(0, 500))}`);
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
    await this.senden(`🎓 <b>Neu in Moodle:</b> ${teile.join(', ')}${abgaben ? `\n${abgaben}` : ''}\n<a href="${this.link('/gebaeude/Uni')}">Zur Uni</a>`);
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

  starten() {
    if (this.laeuft) return;
    this.laeuft = true;
    void this.schleife();
    // Erinnerungen an Fristen: alle 10 Minuten nachsehen (nur Datenbank, kein Netz außer Telegram)
    this.erinnerungsTakt = setInterval(() => void this.erinnerungenSenden().catch((e) => this.fehler(e)), 10 * 60_000);
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
    for (const e of this.o.uni.faelligeErinnerungen()) {
      await this.senden(`${this.erinnerungsText(e)}\n<a href="${this.link('/gebaeude/Uni')}">Zur Uni</a>`, {
        reply_markup: { inline_keyboard: [[{ text: '✅ Erledigt', callback_data: `e:${e.id}:${this.erledigtSignatur(e.id)}` }]] },
      });
      this.o.uni.erinnerungGesendet(e);
      n++;
    }
    return n;
  }

  private async erledigtKnopf(q: NonNullable<TgUpdate['callback_query']>, antworten: (t: string) => Promise<unknown>) {
    const m = /^e:((?:ical:[0-9a-f]{32})|(?:assign|event):\d{1,12}):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
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
      const b = text.split(/\s/)[0]!.split('@')[0]!.toLowerCase();
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
        `🏡 <b>Agentendorf</b>\nSchick mir eine Aufgabe als Text (oder Foto/Datei mit Beschreibung) – sie landet auf dem Schreibtisch des Bürgermeisters.\n\nWeiterschreiben setzt das Gespräch fort (bis ${GESPRAECH_MINUTEN} Minuten nach dem letzten Austausch). Antwortest du auf eine bestimmte Nachricht, geht es in genau diesem Chat weiter.\n\n/neu – nächste Nachricht wird eine neue Aufgabe (oder /neu &lt;Aufgabe&gt;)\n/status – was läuft gerade\n/freigaben – offene Freigaben\n/hilfe – diese Hilfe`,
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
    if (b === '/freigaben') {
      const offen = this.o.agenten.freigaben.liste('offen');
      if (!offen.length) return this.senden('✉️ Keine offenen Freigaben.');
      for (const f of offen.slice(0, 10)) await this.freigabeMelden(f, true);
      return;
    }
    return this.senden('Unbekannter Befehl. /hilfe zeigt, was geht.');
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
    const m = /^f:([0-9a-f-]{36}):([jn]):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    if (!m || !crypto.timingSafeEqual(Buffer.from(m[3]!), Buffer.from(this.signatur(m[1]!, m[2] as 'j' | 'n')))) {
      this.o.log?.('Telegram: Knopf mit ungültiger Signatur abgelehnt.');
      return antworten('Ungültiger Knopf.');
    }
    try {
      const f = await this.o.agenten.freigaben.entscheiden(m[1]!, m[2] === 'j');
      await antworten(f.status === 'abgelehnt' ? 'Abgelehnt.' : f.status === 'fehlgeschlagen' ? 'Ausführung fehlgeschlagen.' : 'Erledigt.');
    } catch (e) {
      if (e instanceof DorfFehler && e.status === 409) {
        await antworten('Diese Freigabe wurde schon entschieden.');
        await this.freigabeAktualisieren(this.o.agenten.freigaben.holen(m[1]!));
      } else await antworten(`Fehler: ${(e as Error).message}`.slice(0, 190));
    }
  }

  // ---- Meldungen ------------------------------------------------------------------------------

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
    const i = f.inhalt as { pfad?: string; beschreibung?: string };
    return `✉️ <b>Freigabe: ${h(f.titel)}</b>\n${ARTEN[f.art] ?? h(f.art)} · ${h(f.gebaeude)}${i.pfad ? `\nDatei: <code>${h(i.pfad)}</code>` : ''}${i.beschreibung ? `\n${h(i.beschreibung)}` : ''}${f.begruendung ? `\n\n<i>${h(f.begruendung.slice(0, 600))}</i>` : ''}`;
  }

  private async freigabeMelden(f: FreigabeInfo, immer = false) {
    if (!immer && !(await einstellungenLaden(this.o.vault)).freigaben) return;
    if (f.status !== 'offen') return;
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
      f.status === 'abgelehnt' ? '❌ Abgelehnt' : f.status === 'fehlgeschlagen' ? `⚠️ Fehlgeschlagen: ${h(f.ergebnis ?? '')}` : `✅ Angenommen${f.ergebnis ? ` – ${h(f.ergebnis)}` : ''}`;
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
      if (k.fehler) await this.senden(`❌ <b>Fehler</b>: ${h(c.titel)}\n${h((e.fehler ?? '').slice(0, 500))}\n${link}`, {}, c.id);
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
      await this.senden(`📝 <b>Fertig mit Entwurf</b>: ${h(c.titel)}\n${dateien}\n${link}`, {}, c.id);
      return;
    }
    if (k.beendet) {
      const antwort = (this.o.db.prepare("SELECT text FROM nachrichten WHERE lauf_id = ? AND rolle = 'agent' ORDER BY id DESC LIMIT 1").get(e.laufId) as { text: string } | undefined)?.text ?? '';
      const kurz = antwort.split(/^##\s*Zusammenfassung/m)[0]!.trim().slice(0, 600);
      await this.senden(`✅ <b>Fertig</b>: ${h(c.titel)}${kurz ? `\n\n${h(kurz)}${antwort.length > 600 ? ' …' : ''}` : ''}\n${link}`, {}, c.id);
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
    await this.senden(`🏁 <b>Aufgabe erledigt</b>: ${h(a.titel)}\n${zeilen}\n<a href="${this.link(`/chats/${a.chatId}`)}">Chat öffnen</a>`, {}, a.chatId);
  }
}
