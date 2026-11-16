import type { DB } from '../db.js';
import type { Uhr } from '../uhr.js';

/**
 * Login-Drosselung.
 * - Pro IP: ab 5 Fehlversuchen (seit dem letzten Erfolg, innerhalb von 15 min) wächst die Wartezeit:
 *   30 s, 60 s, 2 min, … höchstens 15 min nach dem letzten Fehlversuch.
 * - Global: ab 30 Fehlversuchen aller IPs in 15 min wartet jeder 60 s nach dem letzten Fehlversuch.
 */
export const FENSTER_MS = 15 * 60 * 1000;
export const FREI_VERSUCHE = 5;
export const BASIS_MS = 30 * 1000;
export const MAX_MS = 15 * 60 * 1000;
export const GLOBAL_GRENZE = 30;
export const GLOBAL_WARTE_MS = 60 * 1000;

export interface DrosselErgebnis {
  erlaubt: boolean;
  warteSek: number;
}

export class Drossel {
  constructor(
    private db: DB,
    private uhr: Uhr,
  ) {}

  pruefen(ip: string): DrosselErgebnis {
    const jetzt = this.uhr.jetzt();
    const seit = jetzt - FENSTER_MS;
    const letzterErfolg = (this.db
      .prepare('SELECT MAX(zeit) AS t FROM login_versuche WHERE ip = ? AND erfolg = 1')
      .get(ip) as { t: number | null }).t ?? 0;
    const ipFehler = this.db
      .prepare('SELECT COUNT(*) AS n, MAX(zeit) AS t FROM login_versuche WHERE ip = ? AND erfolg = 0 AND zeit > ? AND zeit > ?')
      .get(ip, seit, letzterErfolg) as { n: number; t: number | null };

    let bis = 0;
    if (ipFehler.n >= FREI_VERSUCHE && ipFehler.t) {
      const warte = Math.min(BASIS_MS * 2 ** (ipFehler.n - FREI_VERSUCHE), MAX_MS);
      bis = Math.max(bis, ipFehler.t + warte);
    }
    const global = this.db
      .prepare('SELECT COUNT(*) AS n, MAX(zeit) AS t FROM login_versuche WHERE erfolg = 0 AND zeit > ?')
      .get(seit) as { n: number; t: number | null };
    if (global.n >= GLOBAL_GRENZE && global.t) bis = Math.max(bis, global.t + GLOBAL_WARTE_MS);

    if (bis > jetzt) return { erlaubt: false, warteSek: Math.ceil((bis - jetzt) / 1000) };
    return { erlaubt: true, warteSek: 0 };
  }

  merken(ip: string, erfolg: boolean) {
    const jetzt = this.uhr.jetzt();
    this.db.prepare('INSERT INTO login_versuche (ip, zeit, erfolg) VALUES (?, ?, ?)').run(ip, jetzt, erfolg ? 1 : 0);
    this.db.prepare('DELETE FROM login_versuche WHERE zeit < ?').run(jetzt - 24 * 60 * 60 * 1000);
  }
}
