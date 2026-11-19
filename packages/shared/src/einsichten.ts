import type { Statistik } from './index.js';

/**
 * E162: „Was gute Tage ausmacht“ – Stimmung (1–5) an Tagen mit/ohne X. Nur, wenn es auf beiden Seiten mindestens
 * 3 Tage mit Stimmung gibt und der Unterschied mindestens 0,5 beträgt; sonst wäre es Zufall. Keine KI, keine Deutung –
 * nur der Vergleich, ehrlich als „hängt zusammen“, nicht als „verursacht“.
 */
export interface Einsicht {
  text: string;
  mit: number;
  ohne: number;
  tageMit: number;
  tageOhne: number;
}

type Tag = Statistik['tage'][number];

/** heute: der laufende Tag zählt nicht – morgens gesetzte Stimmung bei noch 0 min Fokus verzerrt sonst (Review) */
export function guteTage(tage: Tag[], heute?: string): Einsicht[] {
  const mitStimmung = tage.filter((t) => t.stimmung != null && (!heute || t.tag < heute));
  const schnitt = (l: Tag[]) => Math.round((l.reduce((s, t) => s + t.stimmung!, 0) / l.length) * 10) / 10;
  const vergleiche: [string, (t: Tag) => boolean | null][] = [
    ['mindestens 1 h Fokus', (t) => t.fokusMin >= 60],
    ['allen Gewohnheiten erledigt', (t) => (t.gewohnheitenFaellig ? t.gewohnheitenErledigt >= t.gewohnheitenFaellig : null)],
    ['3 oder mehr erledigten To-dos', (t) => t.erledigt >= 3],
  ];
  const aus: Einsicht[] = [];
  for (const [was, f] of vergleiche) {
    const mit = mitStimmung.filter((t) => f(t) === true);
    const ohne = mitStimmung.filter((t) => f(t) === false);
    if (mit.length < 3 || ohne.length < 3) continue;
    const a = schnitt(mit);
    const b = schnitt(ohne);
    if (Math.abs(a - b) < 0.5) continue;
    const z = (x: number) => String(x).replace('.', ',');
    aus.push({ text: `An Tagen mit ${was}: Stimmung ⌀ ${z(a)} – sonst ${z(b)}`, mit: a, ohne: b, tageMit: mit.length, tageOhne: ohne.length });
  }
  // größter Unterschied zuerst
  return aus.sort((x, y) => Math.abs(y.mit - y.ohne) - Math.abs(x.mit - x.ohne));
}
