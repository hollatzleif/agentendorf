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
      api: TelegramSchnittstelle;
      chatId: string;
      geheimnis: string;
      appUrl: string;
      db: DB;
      vault: VaultDienst;
      agenten: AgentenDienst;
      schreibtisch: Schreibtisch;
      buergermeister: Buergermeister;
      log?: (t: string) => void;
    },
  ) {
    this.signaturSchluessel = crypto.createHmac('sha256', o.geheimnis).update('telegram-knoepfe').digest();
    // Meldungen – nie blockierend: Fehler beim Senden landen nur im Log.
    o.agenten.freigaben.beiNeu.push((f) => void this.freigabeMelden(f).catch((e) => this.fehler(e)));
    o.agenten.freigaben.beiEntscheidung.push((f) => void this.freigabeAktualisieren(f).catch((e) => this.fehler(e)));
    o.agenten.beiLaufEnde.push((e) => void this.laufMelden(e).catch((x) => this.fehler(x)));
    o.buergermeister.beiAbschluss.push((a) => void this.abschlussMelden(a).catch((x) => this.fehler(x)));
  }

  private fehler(e: unknown) {
    this.letzterFehler = (e as Error).message;
    this.o.log?.(`Telegram: ${this.letzterFehler}`);
  }

  status(einstellungen: TelegramStatus['einstellungen']): TelegramStatus {
    return { tokenGesetzt: true, chatGekoppelt: true, laeuft: this.laeuft, letzterFehler: this.letzterFehler, einstellungen };
  }

  // ---- Polling --------------------------------------------------------------------------------

  starten() {
    if (this.laeuft) return;
    this.laeuft = true;
    void this.schleife();
  }

  stoppen() {
    this.laeuft = false;
    this.abbruch?.abort();
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
    const text = (m.text ?? m.caption ?? '').trim();
    if (text.startsWith('/')) return this.befehl(text.split(/\s/)[0]!.split('@')[0]!.toLowerCase());
    if (m.voice || m.audio || m.video_note) return this.senden('🎙️ Sprachnachrichten kann das Dorf noch nicht verarbeiten. Schreib mir die Aufgabe bitte als Text.');

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
      const a = await this.o.schreibtisch.anlegen({ text, quelle: 'telegram', fremd, anhaenge });
      const r = await this.o.buergermeister.starten(a.id, 'klick');
      await this.senden(
        `📥 Auf dem Schreibtisch: <b>${h(a.titel)}</b>${fremd ? '\n(weitergeleitet – wird als Fremdinhalt behandelt)' : ''}\nDer Bürgermeister kümmert sich. <a href="${this.link(`/chats/${r.chatId}`)}">Chat öffnen</a>`,
      );
    } catch (e) {
      await this.senden(`⚠️ Konnte die Aufgabe nicht anlegen: ${h((e as Error).message)}`);
    }
  }

  private async befehl(b: string) {
    if (b === '/start' || b === '/hilfe' || b === '/help')
      return this.senden(
        '🏡 <b>Agentendorf</b>\nSchick mir eine Aufgabe als Text (oder Foto/Datei mit Beschreibung) – sie landet auf dem Schreibtisch des Bürgermeisters.\n\n/status – was läuft gerade\n/freigaben – offene Freigaben\n/hilfe – diese Hilfe',
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

  async senden(text: string, extra: Record<string, unknown> = {}) {
    return this.o.api.aufruf<{ message_id: number }>('sendMessage', {
      chat_id: this.o.chatId,
      text: text.slice(0, 4000),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...extra,
    });
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
    const r = await this.senden(`${this.freigabeText(f)}\n\n<a href="${this.link('/gebaeude/Rathaus?reiter=freigaben')}">In der App ansehen</a>`, {
      reply_markup: this.knoepfe(f.id),
    });
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
      if (k.fehler) await this.senden(`❌ <b>Fehler</b>: ${h(c.titel)}\n${h((e.fehler ?? '').slice(0, 500))}\n${link}`);
      return;
    }
    // Wartet ein Plan auf Freigabe, kommt die Plan-Nachricht mit Knöpfen – keine zweite Meldung.
    if (c.rolle === 'buergermeister' && this.o.db.prepare("SELECT 1 FROM plaene WHERE chat_id = ? AND status = 'wartet'").get(c.id)) return;
    if (e.geschrieben.length && k.entwuerfe) {
      const dateien = e.geschrieben.slice(0, 5).map((p) => `• <code>${h(p)}</code>`).join('\n');
      await this.senden(`📝 <b>Fertig mit Entwurf</b>: ${h(c.titel)}\n${dateien}\n${link}`);
      return;
    }
    if (k.beendet) {
      const antwort = (this.o.db.prepare("SELECT text FROM nachrichten WHERE lauf_id = ? AND rolle = 'agent' ORDER BY id DESC LIMIT 1").get(e.laufId) as { text: string } | undefined)?.text ?? '';
      const kurz = antwort.split(/^##\s*Zusammenfassung/m)[0]!.trim().slice(0, 600);
      await this.senden(`✅ <b>Fertig</b>: ${h(c.titel)}${kurz ? `\n\n${h(kurz)}${antwort.length > 600 ? ' …' : ''}` : ''}\n${link}`);
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
    await this.senden(`🏁 <b>Aufgabe erledigt</b>: ${h(a.titel)}\n${zeilen}\n<a href="${this.link(`/chats/${a.chatId}`)}">Chat öffnen</a>`);
  }
}
