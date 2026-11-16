import { hash, verify } from '@node-rs/argon2';
import type { DB } from '../db.js';
import type { Uhr } from '../uhr.js';
import { DorfFehler } from '../fehler.js';

export const MIN_PASSWORT_LAENGE = 14;

// Argon2id mit OWASP-Empfehlung (m=19 MiB, t=2, p=1). Algorithm 2 = Argon2id.
const OPTIONEN = { memoryCost: 19456, timeCost: 2, parallelism: 1, algorithm: 2 as const };

export function passwortPruefenStaerke(pw: string): string | null {
  if (pw.length < MIN_PASSWORT_LAENGE) return `Mindestens ${MIN_PASSWORT_LAENGE} Zeichen.`;
  if (new Set(pw).size < 6) return 'Zu wenig unterschiedliche Zeichen.';
  return null;
}

export async function passwortHashen(pw: string) {
  return hash(pw, OPTIONEN);
}

export async function passwortSetzen(db: DB, uhr: Uhr, pw: string) {
  const problem = passwortPruefenStaerke(pw);
  if (problem) throw new DorfFehler(400, `Passwort zu schwach: ${problem}`);
  const h = await passwortHashen(pw);
  db.prepare(
    `INSERT INTO nutzer (id, passwort_hash, geaendert) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET passwort_hash = excluded.passwort_hash, geaendert = excluded.geaendert`,
  ).run(h, uhr.jetzt());
}

export interface NutzerZeile {
  passwort_hash: string;
  totp_geheimnis: string | null;
  totp_aktiv: number;
  totp_letzter_zaehler: number | null;
}

export function nutzerLaden(db: DB): NutzerZeile | undefined {
  return db.prepare('SELECT passwort_hash, totp_geheimnis, totp_aktiv, totp_letzter_zaehler FROM nutzer WHERE id = 1').get() as
    | NutzerZeile
    | undefined;
}

export async function passwortVergleichen(hashWert: string, pw: string) {
  try {
    return await verify(hashWert, pw);
  } catch {
    return false;
  }
}
