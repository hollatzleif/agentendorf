import type { Verbrauch, VerbrauchZeile } from '@dorf/shared';
import type { DB } from '../db.js';

/** Token und geschätzte Kosten je Tag (14), Woche (8) und Monat (6), getrennt nach Motor. Zeiten lokal. */
export function verbrauchAuswerten(db: DB, jetzt: number): Verbrauch {
  const abfrage = (format: string, seitMs: number): VerbrauchZeile[] =>
    (
      db
        .prepare(
          `SELECT strftime('${format}', start / 1000, 'unixepoch', 'localtime') AS zeitraum, motor,
                  SUM(ein_token) AS einToken, SUM(aus_token) AS ausToken, SUM(cache_lesen) AS cacheLesen,
                  SUM(cache_schreiben) AS cacheSchreiben, SUM(kosten_usd) AS kostenUsd, COUNT(*) AS laeufe
           FROM laeufe WHERE start IS NOT NULL AND start >= ? GROUP BY zeitraum, motor ORDER BY zeitraum DESC, motor`,
        )
        .all(seitMs) as VerbrauchZeile[]
    ).map((z) => ({ ...z, kostenUsd: Math.round(z.kostenUsd * 10000) / 10000 }));
  const tag = 24 * 60 * 60 * 1000;
  return {
    tage: abfrage('%Y-%m-%d', jetzt - 14 * tag),
    wochen: abfrage('%Y-W%W', jetzt - 8 * 7 * tag),
    monate: abfrage('%Y-%m', jetzt - 186 * tag),
  };
}
