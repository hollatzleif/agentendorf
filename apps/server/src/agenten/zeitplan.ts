import { ortszeitZuUtc } from '../uni/ical.js';

/**
 * Zeitpläne für Aktionen in einfacher Sprache (Frontmatter `zeitplan:`):
 *   täglich 06:00 · werktags 07:00, 18:00 · wochenende 09:30 · mo, mi, fr 08:00 · sonntags 20:00
 * Uhrzeiten gelten in mitteleuropäischer Zeit (Europe/Vienna = Konstanz/Linz), Sommerzeit inklusive.
 */
export interface Zeitplan {
  tage: Set<number>; // 0 = Sonntag … 6 = Samstag
  zeiten: { h: number; m: number }[];
}

const ZONE = 'Europe/Vienna';
const FUELL = new Set(['um', 'und', 'uhr', 'am', 'jeden', 'jede']);
const TAGE: Record<string, number> = {
  so: 0, sonntag: 0, sonntags: 0,
  mo: 1, montag: 1, montags: 1,
  di: 2, dienstag: 2, dienstags: 2,
  mi: 3, mittwoch: 3, mittwochs: 3,
  do: 4, donnerstag: 4, donnerstags: 4,
  fr: 5, freitag: 5, freitags: 5,
  sa: 6, samstag: 6, samstags: 6,
};

/** Liest den Zeitplan; wirft mit verständlicher Meldung, wenn er nicht passt. */
export function zeitplanLesen(text: string): Zeitplan {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ');
  const zeiten = [...t.matchAll(/\b(\d{1,2}):(\d{2})\b/g)].map((m) => ({ h: Number(m[1]), m: Number(m[2]) }));
  if (!zeiten.length) throw new Error(`Zeitplan „${text}“: Uhrzeit fehlt (z. B. „täglich 06:00“).`);
  for (const z of zeiten) if (z.h > 23 || z.m > 59) throw new Error(`Zeitplan „${text}“: ${z.h}:${String(z.m).padStart(2, '0')} ist keine Uhrzeit.`);
  const worte = t.replace(/\b\d{1,2}:\d{2}\b/g, ' ').split(/[\s,;]+/).filter((w) => w && !FUELL.has(w));
  const tage = new Set<number>();
  for (const w of worte) {
    if (w === 'täglich' || w === 'taeglich') [0, 1, 2, 3, 4, 5, 6].forEach((d) => tage.add(d));
    else if (w === 'werktags') [1, 2, 3, 4, 5].forEach((d) => tage.add(d));
    else if (w === 'wochenende') [0, 6].forEach((d) => tage.add(d));
    else if (w in TAGE) tage.add(TAGE[w]!);
    else throw new Error(`Zeitplan „${text}“: „${w}“ verstehe ich nicht (erlaubt: täglich, werktags, wochenende, mo–so).`);
  }
  if (!tage.size) throw new Error(`Zeitplan „${text}“: Tage fehlen (z. B. „täglich“, „werktags“, „mo, mi“).`);
  zeiten.sort((a, b) => a.h * 60 + a.m - (b.h * 60 + b.m));
  return { tage, zeiten };
}

const tagFormat = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
const WOCHENTAG: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function ortsTag(ms: number) {
  const teile = Object.fromEntries(tagFormat.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { j: Number(teile.year), mo: Number(teile.month), t: Number(teile.day), wt: WOCHENTAG[teile.weekday!]! };
}

/** Alle Termine im Zeitraum (von, bis] in UTC-Millisekunden, aufsteigend */
export function termineZwischen(z: Zeitplan, von: number, bis: number): number[] {
  const aus: number[] = [];
  for (let tag = von - 86_400_000; tag <= bis + 86_400_000; tag += 86_400_000) {
    const d = ortsTag(tag);
    if (!z.tage.has(d.wt)) continue;
    for (const zt of z.zeiten) {
      const ms = ortszeitZuUtc(d.j, d.mo, d.t, zt.h, zt.m, 0, ZONE);
      if (ms > von && ms <= bis && !aus.includes(ms)) aus.push(ms);
    }
  }
  return aus.sort((a, b) => a - b);
}

/** Nächster Termin nach `ab` (höchstens 8 Tage voraus) */
export function naechsterTermin(z: Zeitplan, ab: number): number | null {
  return termineZwischen(z, ab, ab + 8 * 86_400_000)[0] ?? null;
}
