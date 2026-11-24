import crypto from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import type { Stufe } from '@dorf/shared';
import type { DB } from '../db.js';
import type { Uhr } from '../uhr.js';
import type { VaultDienst } from '../vault/dienst.js';
import type { LiveHub } from '../live.js';
import { kostenSchaetzen, stufenLaden } from './modelle.js';
import type { ModellKlient } from './motor-api.js';

const BETAS = ['server-side-fallback-2026-07-01'];

/** E218: Das Tagesbudget für API-Aufrufe ohne Leifs Klick ist aufgebraucht – kein Aufruf, morgen wieder. */
export class BudgetErreicht extends Error {
  constructor(grenze: number) {
    super(`Tagesbudget von ${grenze} $ für automatische KI-Aufrufe erreicht – ab Mitternacht wieder.`);
  }
}

/** Haiku 5.5 hat keinen serverseitigen Fallback: das Feld nicht senden (Anthropic-Doku zur Migration auf Haiku 5.5) */
const OHNE_FALLBACK = /^claude-haiku-/;

/**
 * Ein einzelner KI-Aufruf für Arbeiten, die der Code anstößt (Mail-Einordnung, Morgenzeitung):
 * Motor api, OHNE Werkzeuge, Antwort im festen JSON-Schema (output_config.format). Was zurückkommt, sind Daten –
 * das Modell kann nichts tun, außer zu antworten.
 * Jeder Aufruf wird als Lauf in einem System-Chat pro Gebäude und Monat verbucht (Verbrauch, Nachvollziehbarkeit) –
 * im Chat steht nur eine Kurzfassung, nie der Inhalt (z. B. Mailtexte).
 */
export class SystemAufrufe {
  constructor(
    private o: {
      db: DB;
      uhr: Uhr;
      vault: VaultDienst;
      hub: LiveHub;
      klient?: () => ModellKlient;
      /** E218: Tagesbudget (aufwachen.md) – liefert die Grenze, wenn sie erreicht ist, sonst null */
      budgetErreicht?: () => Promise<number | null>;
    },
  ) {}

  get verfuegbar() {
    return !!this.o.klient;
  }

  async json<T>(a: {
    gebaeude: string;
    chatTitel: string; // z. B. „Post: Einordnung“
    kurzAuftrag: string; // steht im Chat, ohne Inhalte
    stufe: Stufe;
    system: string;
    nachricht: string;
    schema: Record<string, unknown>;
    pruefen: (roh: unknown) => T; // z. B. Zod-parse
    kurzErgebnis: (e: T) => string;
    maxTokens?: number;
    /** Leif hat geklickt (z. B. „Schritte vorschlagen“) – zählt nicht gegen das Tagesbudget */
    vonLeif?: boolean;
    /** E227: eigene Abrechnung (z. B. 'krypto') – zählt nicht gegen das Tagesbudget, die Grenze prüft der Aufrufer */
    ausloeser?: string;
  }): Promise<T> {
    if (!this.o.klient) throw new Error('Kein API-Schlüssel: ANTHROPIC_API_KEY in /srv/dorf/.env eintragen (dorf api-schluessel).');
    if (!a.vonLeif && !a.ausloeser && this.o.budgetErreicht) {
      const grenze = await this.o.budgetErreicht();
      if (grenze !== null) throw new BudgetErreicht(grenze);
    }
    const { db, uhr } = this.o;
    const stufen = await stufenLaden(this.o.vault);
    // E218: automatische Aufrufe laufen mit dem System-Modell (Standard Haiku 5.5); Leifs Klicks mit der Stufe
    const { modell, aufwand } = a.vonLeif ? stufen.stufen[a.stufe] : stufen.system;
    const start = uhr.jetzt();
    let ergebnis: T | undefined;
    let fehler: string | null = null;
    let t = { ein: 0, aus: 0, cacheLesen: 0, cacheSchreiben: 0 };
    let tatsaechlichesModell = modell;
    try {
      const antwort = await this.o.klient().streamen(
        {
          model: modell,
          max_tokens: a.maxTokens ?? 16000,
          system: a.system,
          messages: [{ role: 'user', content: a.nachricht }],
          output_config: { effort: aufwand, format: { type: 'json_schema', schema: a.schema } },
          ...(OHNE_FALLBACK.test(modell) ? {} : { betas: BETAS, fallbacks: 'default' }),
        } as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
        AbortSignal.timeout(10 * 60_000),
        () => undefined,
      );
      const u = antwort.usage;
      t = { ein: u.input_tokens ?? 0, aus: u.output_tokens ?? 0, cacheLesen: u.cache_read_input_tokens ?? 0, cacheSchreiben: u.cache_creation_input_tokens ?? 0 };
      tatsaechlichesModell = antwort.model || modell;
      if (antwort.stop_reason === 'refusal') throw new Error('Das Modell hat die Anfrage abgelehnt.');
      if (antwort.stop_reason === 'max_tokens') throw new Error('Antwort abgeschnitten (max_tokens).');
      const text = antwort.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      ergebnis = a.pruefen(JSON.parse(text));
    } catch (e) {
      fehler = (e as Error).message;
    }

    // Verbuchen: System-Chat pro Gebäude und Monat
    const monat = new Date(start).toISOString().slice(0, 7);
    const titel = `${a.chatTitel} · ${monat}`;
    let chat = db.prepare("SELECT id FROM chats WHERE gebaeude = ? AND titel = ? AND rolle = 'system'").get(a.gebaeude, titel) as { id: string } | undefined;
    if (!chat) {
      chat = { id: crypto.randomUUID() };
      db.prepare(
        `INSERT INTO chats (id, gebaeude, aktion, titel, motor, stufe, modell, eingaben_json, anhaenge_json, werkzeuge_json, fremdinhalte, rolle, erstellt, geaendert)
         VALUES (?, ?, NULL, ?, 'api', ?, ?, '{}', '[]', '[]', 1, 'system', ?, ?)`,
      ).run(chat.id, a.gebaeude, titel, a.stufe, modell, start, start);
    }
    const laufId = crypto.randomUUID();
    const nummer = ((db.prepare('SELECT MAX(nummer) AS n FROM laeufe WHERE chat_id = ?').get(chat.id) as { n: number | null }).n ?? 0) + 1;
    const ende = uhr.jetzt();
    const kurz = ergebnis !== undefined ? a.kurzErgebnis(ergebnis) : `Fehler: ${fehler}`;
    db.prepare(
      `INSERT INTO laeufe (id, chat_id, nummer, motor, modell, stufe, aufwand, status, ausloeser, auftrag, erstellt, start, ende,
                           ein_token, aus_token, cache_lesen, cache_schreiben, kosten_usd, fehler, zusammenfassung)
       VALUES (?, ?, ?, 'api', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      laufId, chat.id, nummer, tatsaechlichesModell, a.stufe, aufwand, fehler ? 'fehler' : 'fertig', a.ausloeser ?? (a.vonLeif ? 'klick' : 'zeitplan'), a.kurzAuftrag, start, start, ende,
      t.ein, t.aus, t.cacheLesen, t.cacheSchreiben, kostenSchaetzen(stufen.preise, tatsaechlichesModell, t), fehler, kurz,
    );
    const nachricht = db.prepare('INSERT INTO nachrichten (chat_id, lauf_id, rolle, text, motor, erstellt) VALUES (?, ?, ?, ?, ?, ?)');
    nachricht.run(chat.id, laufId, 'nutzer', a.kurzAuftrag, 'api', start);
    nachricht.run(chat.id, laufId, 'agent', kurz, 'api', ende);
    db.prepare('UPDATE chats SET geaendert = ? WHERE id = ?').run(ende, chat.id);
    this.o.hub.senden({ typ: 'chat.geaendert', chatId: chat.id, gebaeude: a.gebaeude });
    this.o.hub.senden({ typ: 'verbrauch.geaendert' });
    if (ergebnis === undefined) throw new Error(fehler ?? 'Unbekannter Fehler');
    return ergebnis;
  }
}
