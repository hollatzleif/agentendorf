import crypto from 'node:crypto';
import type { DB } from '../db.js';
import type { Uhr } from '../uhr.js';

export const SITZUNG_DAUER_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage, gleitend
const BERUEHREN_ALLE_MS = 60 * 1000;

export interface Sitzung {
  id: string;
  erstellt: number;
  zuletzt: number;
  ablauf: number;
  geraet: string;
  ip: string;
}

export function tokenHash(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export class Sitzungen {
  constructor(
    private db: DB,
    private uhr: Uhr,
  ) {}

  /** Legt eine Sitzung an und gibt das Cookie-Token zurück (nur hier im Klartext). */
  anlegen(geraet: string, ip: string): { token: string; sitzung: Sitzung } {
    const token = crypto.randomBytes(32).toString('base64url');
    const jetzt = this.uhr.jetzt();
    const s: Sitzung = { id: tokenHash(token), erstellt: jetzt, zuletzt: jetzt, ablauf: jetzt + SITZUNG_DAUER_MS, geraet: geraet.slice(0, 200), ip };
    this.db
      .prepare('INSERT INTO sitzungen (id, erstellt, zuletzt, ablauf, geraet, ip) VALUES (@id, @erstellt, @zuletzt, @ablauf, @geraet, @ip)')
      .run(s);
    return { token, sitzung: s };
  }

  /** Prüft ein Cookie-Token. Verlängert die Sitzung höchstens einmal pro Minute. */
  pruefen(token: string | undefined, ip?: string): Sitzung | null {
    if (!token) return null;
    const id = tokenHash(token);
    const s = this.db.prepare('SELECT * FROM sitzungen WHERE id = ?').get(id) as Sitzung | undefined;
    if (!s) return null;
    const jetzt = this.uhr.jetzt();
    if (s.ablauf <= jetzt) {
      this.beenden(id);
      return null;
    }
    if (jetzt - s.zuletzt > BERUEHREN_ALLE_MS) {
      s.zuletzt = jetzt;
      s.ablauf = jetzt + SITZUNG_DAUER_MS;
      if (ip) s.ip = ip;
      this.db.prepare('UPDATE sitzungen SET zuletzt = ?, ablauf = ?, ip = ? WHERE id = ?').run(s.zuletzt, s.ablauf, s.ip, id);
    }
    return s;
  }

  liste(): Sitzung[] {
    this.db.prepare('DELETE FROM sitzungen WHERE ablauf <= ?').run(this.uhr.jetzt());
    return this.db.prepare('SELECT * FROM sitzungen ORDER BY zuletzt DESC').all() as Sitzung[];
  }

  /** E195: Zuhörer für beendete Sitzungen (Abmelden, „Gerät abmelden“, „alle abmelden“) – z. B. VS-Code-Verbindungen kappen */
  beiEnde: ((ids: string[]) => void)[] = [];

  /**
   * E204: Wer offene Verbindungen im Namen einer Sitzung hält (Terminals, VS-Code-Zugänge, Live-Verbindungen), meldet hier
   * deren Sitzungs-IDs. `abgleichen` findet so auch Sitzungen, die NICHT über diesen Prozess endeten.
   */
  halter: (() => Iterable<string>)[] = [];

  /**
   * E204: alle 30 s (app.ts) – Sitzungen, die abgelaufen sind oder in der Datenbank fehlen (`dorf sitzungen-beenden` und
   * `dorf passwort` laufen als eigener Prozess, dort greift `beiEnde` nicht), als beendet melden: Die Zuhörer kappen dann
   * Terminals und VS Code wie beim Abmelden. Gibt die gemeldeten IDs zurück.
   */
  abgleichen(): string[] {
    const jetzt = this.uhr.jetzt();
    const ids = new Set((this.db.prepare('SELECT id FROM sitzungen WHERE ablauf <= ?').all(jetzt) as { id: string }[]).map((r) => r.id));
    if (ids.size) this.db.prepare('DELETE FROM sitzungen WHERE ablauf <= ?').run(jetzt);
    const besteht = this.db.prepare('SELECT 1 FROM sitzungen WHERE id = ?');
    for (const halter of this.halter) {
      try {
        for (const id of halter()) if (!ids.has(id) && !besteht.get(id)) ids.add(id);
      } catch (e) {
        console.error('Halter beim Sitzungsabgleich fehlgeschlagen', e);
      }
    }
    this.endeMelden([...ids]);
    return [...ids];
  }

  private endeMelden(ids: string[]) {
    if (!ids.length) return;
    for (const fn of this.beiEnde) {
      try {
        fn(ids);
      } catch (e) {
        console.error('Zuhörer für Sitzungsende fehlgeschlagen', e);
      }
    }
  }

  beenden(id: string) {
    const weg = this.db.prepare('DELETE FROM sitzungen WHERE id = ?').run(id).changes > 0;
    if (weg) this.endeMelden([id]);
    return weg;
  }

  alleAusserBeenden(behalten: string | null): string[] {
    const ids = (this.db.prepare('SELECT id FROM sitzungen WHERE id != ?').all(behalten ?? '') as { id: string }[]).map((r) => r.id);
    this.db.prepare('DELETE FROM sitzungen WHERE id != ?').run(behalten ?? '');
    this.endeMelden(ids);
    return ids;
  }
}
