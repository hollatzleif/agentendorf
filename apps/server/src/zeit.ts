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

/** Ortszeit Wien in Teilen (für Uhrzeit, Versatz und ISO mit Versatz) */
function teileIn(ms: number) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: ZONE_WIEN, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  return p;
}

/** Uhrzeit HH:MM in Wien */
export const uhrzeitIn = (ms: number) => {
  const p = teileIn(ms);
  return `${p.hour}:${p.minute}`;
};

/** Versatz Wien gegen UTC in Minuten (60 im Winter, 120 im Sommer) – E182, stellt die Uhr des Cardputers */
export const versatzMinuten = (ms: number) => {
  const p = teileIn(ms);
  const lokal = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((lokal - Math.floor(ms / 1000) * 1000) / 60_000);
};

/** ISO-Zeitpunkt in Wiener Ortszeit mit Versatz, z. B. 2026-11-20T23:59:00+01:00 */
export const ortIso = (ms: number) => {
  const p = teileIn(ms);
  const v = versatzMinuten(ms);
  const zwei = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${v < 0 ? '-' : '+'}${zwei(Math.floor(Math.abs(v) / 60))}:${zwei(Math.abs(v) % 60)}`;
};
