import type { DB } from './db.js';
import type { Uhr } from './uhr.js';

/** So lange merkt sich das Dorf eine Antwort (Offline-Schlange der App, Funkloch am Cardputer) */
export const IDEMPOTENZ_TAGE = 7;

/**
 * E124/E182: Gleiche Vorgangs-ID → gespeicherte Antwort, nichts doppelt. Die App schickt `x-dorf-id`, der Cardputer
 * `X-Vorgang` – beide landen in derselben Tabelle `idempotenz`; Geräte-IDs bekommen ein Präfix (`geraet:<id>:`),
 * damit sie nie mit IDs der App (ohne Doppelpunkt) zusammenfallen.
 * Ohne ID (oder mit ungültiger) wird einfach ausgeführt. Fehler werden nicht gemerkt – die Wiederholung versucht es neu.
 */
export function einmaligBauen(db: DB, uhr: Uhr) {
  return async <T>(id: string | undefined, f: () => Promise<T>): Promise<T> => {
    if (!id) return f();
    const alt = db.prepare('SELECT antwort FROM idempotenz WHERE id = ?').get(id) as { antwort: string } | undefined;
    if (alt) return JSON.parse(alt.antwort) as T;
    const r = await f();
    db.prepare('INSERT OR REPLACE INTO idempotenz (id, antwort, zeit) VALUES (?, ?, ?)').run(id, JSON.stringify(r ?? null), uhr.jetzt());
    db.prepare('DELETE FROM idempotenz WHERE zeit < ?').run(uhr.jetzt() - IDEMPOTENZ_TAGE * 86_400_000);
    return r;
  };
}
export type Einmalig = ReturnType<typeof einmaligBauen>;
