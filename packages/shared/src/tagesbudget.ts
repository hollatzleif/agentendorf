import type { KalenderTermin, TodoInfo } from './index.js';
import { istFristBlock } from './fachname.js';

/**
 * E120: Passt der Tag? Summe der Schätzungen der heute dran stehenden To-dos (überfällig, heute fällig, ⭐ mit Datum
 * bis heute) gegen die freie Zeit ab jetzt (frühestens 8 Uhr) bis zum Feierabend (22 Uhr Ortszeit) abzüglich der restlichen Termine.
 * jetztMin: Minute des Tages in Ortszeit (Wien).
 */
export const FEIERABEND_MIN = 22 * 60;
/** Der Arbeitstag beginnt um 8 Uhr – nachts zählt nicht als „frei“ (Review: um 0:07 stand „frei ≈ 21 h“) */
export const TAGESBEGINN_MIN = 8 * 60;
/** Vor 6 Uhr schlägt „Jetzt dran“ nichts vor (Nacht) */
export const NACHT_BIS_MIN = 6 * 60;

/**
 * Belegte Zeit in [von, bis): Intervalle zusammengeführt – überlappende Termine (Block „Uni 13–18“ mit „Tutorium 14–16“
 * darin, derselbe Termin in zwei Kalendern) zählen nur einmal (Review). Zeiten in ms.
 */
export function belegtMs(intervalle: [number, number][], von: number, bis: number) {
  const teile = intervalle
    .map(([a, b]) => [Math.max(a, von), Math.min(b, bis)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let summe = 0;
  let ende = -Infinity;
  for (const [a, b] of teile) {
    if (b <= ende) continue;
    summe += b - Math.max(a, ende);
    ende = b;
  }
  return summe;
}

/** E147: wartet auf jemanden und der Nachfass-Tag ist noch nicht da (oder keiner gesetzt) – zählt nicht als „dran“ */
export const ruht = (t: { wartet?: string; faellig?: string }, heute: string) => !!t.wartet && (!t.faellig || t.faellig > heute);

export function tagesBudget(o: { todos: TodoInfo[]; termine: KalenderTermin[]; jetzt: number; jetztMin: number; heute: string }) {
  const dran = o.todos.filter((t) => !t.erledigt && t.faellig && t.faellig <= o.heute);
  const geschaetzt = dran.filter((t) => t.dauer);
  const geschaetztMin = geschaetzt.reduce((s, t) => s + t.dauer!, 0);
  const beginn = o.jetzt + Math.max(0, TAGESBEGINN_MIN - o.jetztMin) * 60_000;
  const ende = o.jetzt + Math.max(0, FEIERABEND_MIN - o.jetztMin) * 60_000;
  const belegt = belegtMs(o.termine.filter((t) => !t.ganztags && !istFristBlock(t)).map((t) => [Date.parse(t.start), Date.parse(t.ende)]), beginn, ende);
  const freiMin = Math.max(0, Math.round((ende - beginn - belegt) / 60_000));
  return { anzahl: dran.length, geschaetztMin, ohneSchaetzung: dran.length - geschaetzt.length, freiMin, zuViel: geschaetzt.length > 0 && geschaetztMin > freiMin };
}

export const minutenText = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);

/**
 * E123: „Jetzt dran“ – ein To-do, das in die Lücke bis zum nächsten Termin (sonst bis 22 Uhr) passt.
 * Reihenfolge: überfällig → heute fällig → ⭐ ohne Datum → in 3 Tagen fällig; ⭐ jeweils zuerst.
 * Passt keins ganz hinein, aber die Lücke reicht für einen Pomodoro (25 min), wird das erste vorgeschlagen
 * („ein 🍅 daran“). Läuft gerade ein Termin oder ist die Lücke unter 10 min, gibt es keinen Vorschlag.
 */
export function jetztDran(o: { todos: TodoInfo[]; termine: KalenderTermin[]; jetzt: number; jetztMin: number; heute: string; besteZeit?: { von: number; bis: number } | null }) {
  const zeitig = o.termine.filter((t) => !t.ganztags && !istFristBlock(t));
  if (zeitig.some((t) => Date.parse(t.start) <= o.jetzt && o.jetzt < Date.parse(t.ende))) return null;
  const naechster = zeitig.filter((t) => Date.parse(t.start) > o.jetzt).sort((a, b) => a.start.localeCompare(b.start))[0];
  if (o.jetztMin < NACHT_BIS_MIN) return null;
  const bisFeierabend = Math.max(0, FEIERABEND_MIN - o.jetztMin);
  const luecke = Math.min(bisFeierabend, naechster ? Math.floor((Date.parse(naechster.start) - o.jetzt) / 60_000) : Infinity);
  if (luecke < 10) return null;
  const plus3 = new Date(Date.parse(`${o.heute}T12:00:00Z`) + 3 * 86_400_000).toISOString().slice(0, 10);
  const stufe = (t: TodoInfo) => (t.faellig && t.faellig < o.heute ? 0 : t.faellig === o.heute ? 1 : !t.faellig && t.wichtig ? 2 : t.faellig && t.faellig <= plus3 ? 3 : 9);
  // E151: Energie – in der besten Zeit (E144) zuerst, was Konzentration braucht; abends ab 19 Uhr oder in kurzen
  // Lücken (< 30 min) zuerst Leichtes. Nur innerhalb derselben Dringlichkeit, Überfälliges bleibt vorn.
  const stunde = o.jetztMin / 60;
  const modus: 'hoch' | 'niedrig' | null = o.besteZeit && stunde >= o.besteZeit.von && stunde < o.besteZeit.bis ? 'hoch' : o.jetztMin >= 19 * 60 || luecke < 30 ? 'niedrig' : null;
  const vorzug = (t: TodoInfo) => (modus && t.energie === modus ? 0 : modus && t.energie && t.energie !== modus ? 2 : 1);
  const kandidaten = o.todos
    .filter((t) => !t.erledigt && !ruht(t, o.heute) && stufe(t) < 9)
    .sort((a, b) => stufe(a) - stufe(b) || Number(!!b.wichtig) - Number(!!a.wichtig) || vorzug(a) - vorzug(b) || (a.faellig ?? '9').localeCompare(b.faellig ?? '9'));
  if (!kandidaten.length) return null;
  const rest = (t: TodoInfo) => Math.max(5, (t.dauer ?? 30) - (t.fokusMin ?? 0));
  const passend = kandidaten.find((t) => rest(t) <= luecke);
  const t = passend ?? (luecke >= 25 ? kandidaten[0]! : undefined);
  if (!t) return null;
  const energie = modus && t.energie === modus ? (modus === 'hoch' ? ('beste-zeit' as const) : ('leicht' as const)) : undefined;
  return { todo: t, schritt: t.schritte?.find((s) => !s.erledigt)?.text, luecke, bis: naechster ? { titel: naechster.titel, start: naechster.start } : null, passt: !!passend, ...(energie ? { energie } : {}) };
}

/**
 * E126: „Woche verteilen“ – To-dos aus dem Eingang (ohne Datum, überfällig) auf die Tage verteilen, die noch Platz haben.
 * Platz je Tag = 70 % der freien Zeit (8–22 Uhr minus Termine) minus die schon geplanten To-dos (Schätzung, sonst 30 min).
 * Reihenfolge: ⭐ → überfällig (ältestes zuerst) → ohne Datum (ältestes zuerst); jedes To-do auf den frühesten Tag, auf
 * dem es Platz hat. Nur ein Vorschlag – geschrieben wird, was Leif übernimmt.
 */
export const PUFFER = 0.7;
export function wocheVerteilen(o: { eingang: TodoInfo[]; tage: { tag: string; freiMin: number; geplantMin: number }[]; heute: string }) {
  const platz = new Map(o.tage.filter((t) => t.tag >= o.heute).map((t) => [t.tag, Math.floor(t.freiMin * PUFFER) - t.geplantMin]));
  const reihe = o.eingang.filter((t) => !ruht(t, o.heute)).sort(
    (a, b) =>
      Number(!!b.wichtig) - Number(!!a.wichtig) ||
      Number(!!b.faellig) - Number(!!a.faellig) ||
      (a.faellig ?? '').localeCompare(b.faellig ?? '') ||
      (a.erstellt ?? '').localeCompare(b.erstellt ?? ''),
  );
  const aus: { pfad: string; titel: string; tag: string; dauer: number }[] = [];
  for (const t of reihe) {
    const dauer = Math.max(5, (t.dauer ?? 30) - (t.fokusMin ?? 0));
    const tag = [...platz.entries()].find(([, p]) => p >= dauer)?.[0];
    if (!tag) continue;
    platz.set(tag, platz.get(tag)! - dauer);
    aus.push({ pfad: t.pfad, titel: t.titel, tag, dauer });
  }
  return aus;
}
