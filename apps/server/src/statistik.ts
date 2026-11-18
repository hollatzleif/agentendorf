import type { Statistik } from '@dorf/shared';
import type { DB } from './db.js';
import type { Uhr } from './uhr.js';
import type { TodoDienst } from './todos.js';
import type { Gewohnheiten } from './gewohnheiten.js';

/**
 * Statistik (E93): die letzten N Tage auf einen Blick – erledigte To-dos, Fokusminuten, Gewohnheiten.
 * Nur Zählen aus vorhandenen Daten, keine KI, nichts Neues gespeichert.
 */
const tagVon = (ms: number) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });

export async function statistik(o: { db: DB; uhr: Uhr; todos: TodoDienst; gewohnheiten?: Gewohnheiten }, anzahl = 28): Promise<Statistik> {
  const jetzt = o.uhr.jetzt();
  const tage: string[] = [];
  for (let i = anzahl - 1; i >= 0; i--) tage.push(tagVon(jetzt - i * 86_400_000));
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
  return {
    tage: zeilen,
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
