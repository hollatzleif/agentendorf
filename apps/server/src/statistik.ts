import type { Statistik } from '@dorf/shared';
import type { DB } from './db.js';
import type { Uhr } from './uhr.js';
import type { TodoDienst } from './todos.js';
import type { Gewohnheiten } from './gewohnheiten.js';
import { tagVonJetzt } from './zeit.js';

/**
 * Statistik (E93): die letzten N Tage auf einen Blick – erledigte To-dos, Fokusminuten, Gewohnheiten.
 * Nur Zählen aus vorhandenen Daten, keine KI, nichts Neues gespeichert.
 */
const tagVon = (ms: number) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });

export async function statistik(o: { db: DB; uhr: Uhr; todos: TodoDienst; gewohnheiten?: Gewohnheiten }, anzahl = 28): Promise<Statistik> {
  const jetzt = o.uhr.jetzt();
  const tage: string[] = [];
  for (let i = anzahl - 1; i >= 0; i--) tage.push(tagVonJetzt(jetzt, -i));
  const erst = tage[0]!;

  const erledigt = new Map<string, number>();
  for (const t of await o.todos.liste({ alleErledigten: true }))
    if (t.erledigt && t.erledigtAm) {
      const tag = tagVon(Date.parse(t.erledigtAm));
      if (tag >= erst) erledigt.set(tag, (erledigt.get(tag) ?? 0) + 1);
    }

  const fokus = new Map<string, number>();
  for (const x of o.db.prepare('SELECT ende, minuten FROM fokus_sitzungen WHERE ende > ?').all(jetzt - (anzahl + 1) * 86_400_000) as { ende: number; minuten: number }[]) {
    const tag = tagVon(x.ende);
    fokus.set(tag, (fokus.get(tag) ?? 0) + x.minuten);
  }

  const stimmung = new Map((o.db.prepare('SELECT tag, wert FROM stimmung WHERE tag >= ?').all(erst) as { tag: string; wert: number }[]).map((x) => [x.tag, x.wert]));
  const gw = o.gewohnheiten ? await o.gewohnheiten.jeTag(tage) : tage.map(() => ({ faellig: 0, erledigt: 0 }));
  const zeilen = tage.map((tag, i) => ({
    tag,
    erledigt: erledigt.get(tag) ?? 0,
    fokusMin: Math.round(fokus.get(tag) ?? 0),
    gewohnheitenFaellig: gw[i]!.faellig,
    gewohnheitenErledigt: gw[i]!.erledigt,
    stimmung: stimmung.get(tag) ?? null,
  }));
  const summe = (f: (z: (typeof zeilen)[number]) => number, von = 0) => zeilen.slice(von).reduce((s, z) => s + f(z), 0);
  const gwF = summe((z) => z.gewohnheitenFaellig);
  const { fokusJeStunde, besteZeit } = fokusNachTageszeit(o.db, jetzt, anzahl);
  return {
    tage: zeilen,
    fokusJeStunde,
    besteZeit,
    summen: {
      erledigt: summe((z) => z.erledigt),
      erledigtWoche: summe((z) => z.erledigt, anzahl - 7),
      fokusMin: summe((z) => z.fokusMin),
      fokusMinWoche: summe((z) => z.fokusMin, anzahl - 7),
      gewohnheitenQuote: gwF ? Math.round((summe((z) => z.gewohnheitenErledigt) / gwF) * 100) : null,
      stimmungSchnitt: stimmung.size ? Math.round(([...stimmung.values()].reduce((a, b) => a + b, 0) / stimmung.size) * 10) / 10 : null,
      aktiveTage: zeilen.filter((z) => z.erledigt || z.fokusMin || z.gewohnheitenErledigt).length,
    },
  };
}

export const STIMMUNGEN = ['😞', '😕', '😐', '🙂', '😄'] as const;

/** E107: Stimmung des Tages setzen (1–5); ein zweites Mal überschreibt */
export function stimmungSetzen(db: DB, tag: string, wert: number, jetzt: number) {
  if (!Number.isInteger(wert) || wert < 1 || wert > 5) throw new Error('Stimmung 1–5');
  db.prepare('INSERT INTO stimmung (tag, wert, zeit) VALUES (?, ?, ?) ON CONFLICT(tag) DO UPDATE SET wert = excluded.wert, zeit = excluded.zeit').run(tag, wert, jetzt);
}

/** E144: Fokusminuten je Stunde (Wien) der letzten N Tage und die beste 2-Stunden-Spanne (ab 2 h Fokus insgesamt) */
export function fokusNachTageszeit(db: DB, jetzt: number, anzahl: number) {
  // E144: Fokus nach Tageszeit – Minuten je Stunde (Wien), verteilt über die Stunden, die eine Sitzung berührt
  const jeStunde = Array.from({ length: 24 }, () => 0);
  const stundeVon = (ms: number) => Number(new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/Vienna', hour: '2-digit', hour12: false })) % 24;
  for (const x of db.prepare('SELECT start, ende, minuten FROM fokus_sitzungen WHERE ende > ?').all(jetzt - anzahl * 86_400_000) as { start: number; ende: number; minuten: number }[]) {
    const dauer = Math.max(1, x.ende - x.start);
    // in 5-Minuten-Schritten aufteilen (genug genau, auch über eine Stundengrenze hinweg)
    for (let t = x.start; t < x.ende; t += 5 * 60_000) jeStunde[stundeVon(t)]! += (x.minuten * Math.min(5 * 60_000, x.ende - t)) / dauer;
  }
  const fokusJeStunde = jeStunde.map((m) => Math.round(m));
  // beste zusammenhängende 2-Stunden-Spanne (nur wenn es genug Daten gibt)
  let beste: { von: number; bis: number; min: number } | null = null;
  for (let h = 0; h < 23; h++) {
    const m = fokusJeStunde[h]! + fokusJeStunde[h + 1]!;
    if (m > 0 && (!beste || m > beste.min)) beste = { von: h, bis: h + 2, min: m };
  }
  return { fokusJeStunde, besteZeit: beste && fokusJeStunde.reduce((a, b) => a + b, 0) >= 120 ? beste : null };
}

/** E122/E166: Fokuszeit und letzte Fokussitzung je To-do (fokus_sitzungen.todo) an die To-dos hängen */
export function mitFokus<T extends { pfad: string }>(db: DB, todos: T[]): (T & { fokusMin?: number; fokusZuletzt?: string })[] {
  const zeilen = db.prepare('SELECT todo, SUM(minuten) AS m, MAX(ende) AS e FROM fokus_sitzungen WHERE todo IS NOT NULL GROUP BY todo').all() as { todo: string; m: number; e: number }[];
  const je = new Map(zeilen.map((x) => [x.todo, x]));
  return todos.map((t) => {
    const f = je.get(t.pfad);
    return f ? { ...t, ...(Math.round(f.m) ? { fokusMin: Math.round(f.m) } : {}), fokusZuletzt: new Date(f.e).toISOString() } : t;
  });
}
