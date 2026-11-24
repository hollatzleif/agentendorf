import crypto from 'node:crypto';
import type { RueckgaengigInfo } from '@dorf/shared';
import type { DB } from '../db.js';
import type { Uhr } from '../uhr.js';
import { DorfFehler } from '../fehler.js';

/**
 * „Rückgängig“ statt Freigabe (E185): Was sich zurückholen lässt (Termin im eigenen Kalender, neuer/geänderter Skill,
 * geänderte oder verschobene Datei), tun Agenten direkt. Jede solche Tat wird hier gemerkt; Leif bekommt eine Meldung
 * (App + Telegram) mit einem Knopf, der sie genau einmal zurücknimmt – ausgeführt vom Dorf, nie vom Agenten.
 */
export type RueckgaengigArt = 'termin_angelegt' | 'termin_geaendert' | 'termin_geloescht' | 'skill_angelegt' | 'datei_geaendert' | 'datei_verschoben' | 'hafen_bot_angelegt' | 'hafen_bot_geaendert' | 'hafen_notaus';

interface Zeile {
  id: string;
  chat_id: string | null;
  lauf_id: string | null;
  gebaeude: string;
  art: string;
  titel: string;
  daten_json: string;
  status: RueckgaengigInfo['status'];
  erstellt: number;
  ergebnis: string | null;
}

const info = (z: Zeile): RueckgaengigInfo => ({
  id: z.id,
  chatId: z.chat_id ?? undefined,
  gebaeude: z.gebaeude,
  art: z.art,
  titel: z.titel,
  status: z.status,
  erstellt: new Date(z.erstellt).toISOString(),
  ergebnis: z.ergebnis ?? undefined,
});

export class Rueckgaengig {
  private zuruecknehmer = new Map<string, (daten: never) => Promise<string>>();
  /** Zuhörer für neue Einträge (Telegram) und jede Änderung (App) */
  readonly beiNeu: ((r: RueckgaengigInfo) => void | Promise<void>)[] = [];
  beiAenderung: () => void = () => {};

  constructor(
    private db: DB,
    private uhr: Uhr,
  ) {}

  registrieren<D>(art: RueckgaengigArt, fn: (daten: D) => Promise<string>) {
    this.zuruecknehmer.set(art, fn as (daten: never) => Promise<string>);
  }

  async merken(e: { art: RueckgaengigArt; titel: string; daten: unknown; gebaeude: string; chatId?: string; laufId?: string; leise?: boolean }): Promise<RueckgaengigInfo> {
    const id = crypto.randomUUID();
    this.db
      .prepare("INSERT INTO rueckgaengig (id, chat_id, lauf_id, gebaeude, art, titel, daten_json, status, erstellt) VALUES (?, ?, ?, ?, ?, ?, ?, 'offen', ?)")
      .run(id, e.chatId ?? null, e.laufId ?? null, e.gebaeude, e.art, e.titel.slice(0, 300), JSON.stringify(e.daten), this.uhr.jetzt());
    this.beiAenderung();
    const r = this.holen(id);
    // leise (Datei geändert/verschoben): nur in der App-Liste, keine Telegram-Meldung je Änderung
    for (const fn of e.leise ? [] : this.beiNeu) {
      try {
        await fn(r);
      } catch (x) {
        console.error('Rückgängig-Zuhörer fehlgeschlagen', x);
      }
    }
    return r;
  }

  holen(id: string): RueckgaengigInfo {
    const z = this.db.prepare('SELECT * FROM rueckgaengig WHERE id = ?').get(id) as Zeile | undefined;
    if (!z) throw new DorfFehler(404, 'Diesen Eintrag gibt es nicht.');
    return info(z);
  }

  /** Die letzten Taten ohne Rückfrage (neueste zuerst) */
  liste(tage = 7): RueckgaengigInfo[] {
    return (this.db.prepare('SELECT * FROM rueckgaengig WHERE erstellt >= ? ORDER BY erstellt DESC LIMIT 50').all(this.uhr.jetzt() - tage * 86_400_000) as Zeile[]).map(info);
  }

  /** Genau einmal: der Statuswechsel ist atomar; ein zweiter Klick bekommt 409. Scheitert das Zurücknehmen, bleibt es versuchbar. */
  async zuruecknehmen(id: string): Promise<RueckgaengigInfo> {
    const r = this.db.prepare("UPDATE rueckgaengig SET status = 'zurueckgenommen' WHERE id = ? AND status = 'offen'").run(id);
    if (r.changes !== 1) {
      this.holen(id);
      throw new DorfFehler(409, 'Das wurde schon zurückgenommen.');
    }
    const z = this.db.prepare('SELECT * FROM rueckgaengig WHERE id = ?').get(id) as Zeile;
    let status: RueckgaengigInfo['status'] = 'zurueckgenommen';
    let ergebnis: string;
    try {
      const fn = this.zuruecknehmer.get(z.art);
      if (!fn) throw new Error(`„${z.art}“ lässt sich nicht zurücknehmen.`);
      ergebnis = await fn(JSON.parse(z.daten_json) as never);
    } catch (e) {
      status = 'fehlgeschlagen';
      ergebnis = (e as Error).message;
    }
    // Gescheitert (Kalender gerade nicht erreichbar, Datei inzwischen geändert …): der Eintrag bleibt offen, damit Leif es
    // später noch einmal versuchen kann – der Grund steht dabei. Die Antwort nennt trotzdem „fehlgeschlagen“.
    this.db.prepare('UPDATE rueckgaengig SET status = ?, ergebnis = ? WHERE id = ?').run(status === 'fehlgeschlagen' ? 'offen' : status, ergebnis.slice(0, 1000), id);
    this.beiAenderung();
    return { ...this.holen(id), status };
  }
}
