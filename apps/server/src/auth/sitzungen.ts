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

  beenden(id: string) {
    return this.db.prepare('DELETE FROM sitzungen WHERE id = ?').run(id).changes > 0;
  }

  alleAusserBeenden(behalten: string | null): string[] {
    const ids = (this.db.prepare('SELECT id FROM sitzungen WHERE id != ?').all(behalten ?? '') as { id: string }[]).map((r) => r.id);
    this.db.prepare('DELETE FROM sitzungen WHERE id != ?').run(behalten ?? '');
    return ids;
  }
}
