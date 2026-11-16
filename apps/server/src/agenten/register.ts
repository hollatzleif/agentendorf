import crypto from 'node:crypto';
import type { WerkzeugKiste } from './werkzeuge.js';

/** Werkzeug-Kisten laufender claude-code-Läufe, erreichbar über ein zufälliges Token (nur solange der Lauf läuft). */
export class WerkzeugRegister {
  private kisten = new Map<string, WerkzeugKiste>();

  anmelden(k: WerkzeugKiste) {
    const token = crypto.randomBytes(32).toString('base64url');
    this.kisten.set(token, k);
    return { token, abmelden: () => this.kisten.delete(token) };
  }

  finden(token: string | undefined) {
    return token ? this.kisten.get(token) : undefined;
  }
}
