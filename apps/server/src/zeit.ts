/**
 * Kalendertage in Wien (Review der Nacht 18./19.11.): „morgen“ ist der nächste Kalendertag, nicht „jetzt + 24 h“ –
 * sonst springt man an den Sommerzeit-Tagen um einen Tag daneben (23-/25-Stunden-Tage).
 */
export const ZONE_WIEN = 'Europe/Vienna';

/** Kalendertag (JJJJ-MM-TT) in Wien */
export const tagIn = (ms: number) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: ZONE_WIEN });

/** Kalendertag + n Tage (reines Datumsrechnen, ohne Uhrzeit) */
export const tagPlus = (tag: string, n: number) => {
  const d = new Date(`${tag}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Tag in Wien von jetzt aus um n Kalendertage verschoben */
export const tagVonJetzt = (jetzt: number, n = 0) => tagPlus(tagIn(jetzt), n);
