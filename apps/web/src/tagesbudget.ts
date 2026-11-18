import type { KalenderTermin, TodoInfo } from '@dorf/shared';

/**
 * E120: Passt der Tag? Summe der Schätzungen der heute dran stehenden To-dos (überfällig, heute fällig, ⭐ mit Datum
 * bis heute) gegen die freie Zeit bis zum Feierabend (22 Uhr Ortszeit) abzüglich der restlichen Termine.
 * jetztMin: Minute des Tages in Ortszeit (Wien).
 */
export const FEIERABEND_MIN = 22 * 60;

export function tagesBudget(o: { todos: TodoInfo[]; termine: KalenderTermin[]; jetzt: number; jetztMin: number; heute: string }) {
  const dran = o.todos.filter((t) => !t.erledigt && t.faellig && t.faellig <= o.heute);
  const geschaetzt = dran.filter((t) => t.dauer);
  const geschaetztMin = geschaetzt.reduce((s, t) => s + t.dauer!, 0);
  const ende = o.jetzt + Math.max(0, FEIERABEND_MIN - o.jetztMin) * 60_000;
  let belegt = 0;
  for (const t of o.termine) {
    if (t.ganztags) continue;
    const a = Math.max(Date.parse(t.start), o.jetzt);
    const b = Math.min(Date.parse(t.ende), ende);
    if (b > a) belegt += b - a;
  }
  const freiMin = Math.max(0, Math.round((ende - o.jetzt - belegt) / 60_000));
  return { anzahl: dran.length, geschaetztMin, ohneSchaetzung: dran.length - geschaetzt.length, freiMin, zuViel: geschaetzt.length > 0 && geschaetztMin > freiMin };
}

export const minutenText = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);

/**
 * E123: „Jetzt dran“ – ein To-do, das in die Lücke bis zum nächsten Termin (sonst bis 22 Uhr) passt.
 * Reihenfolge: überfällig → heute fällig → ⭐ ohne Datum → in 3 Tagen fällig; ⭐ jeweils zuerst.
 * Passt keins ganz hinein, aber die Lücke reicht für einen Pomodoro (25 min), wird das erste vorgeschlagen
 * („ein 🍅 daran“). Läuft gerade ein Termin oder ist die Lücke unter 10 min, gibt es keinen Vorschlag.
 */
export function jetztDran(o: { todos: TodoInfo[]; termine: KalenderTermin[]; jetzt: number; jetztMin: number; heute: string }) {
  const zeitig = o.termine.filter((t) => !t.ganztags);
  if (zeitig.some((t) => Date.parse(t.start) <= o.jetzt && o.jetzt < Date.parse(t.ende))) return null;
  const naechster = zeitig.filter((t) => Date.parse(t.start) > o.jetzt).sort((a, b) => a.start.localeCompare(b.start))[0];
  const bisFeierabend = Math.max(0, FEIERABEND_MIN - o.jetztMin);
  const luecke = Math.min(bisFeierabend, naechster ? Math.floor((Date.parse(naechster.start) - o.jetzt) / 60_000) : Infinity);
  if (luecke < 10) return null;
  const plus3 = new Date(Date.parse(`${o.heute}T12:00:00Z`) + 3 * 86_400_000).toISOString().slice(0, 10);
  const stufe = (t: TodoInfo) => (t.faellig && t.faellig < o.heute ? 0 : t.faellig === o.heute ? 1 : !t.faellig && t.wichtig ? 2 : t.faellig && t.faellig <= plus3 ? 3 : 9);
  const kandidaten = o.todos
    .filter((t) => !t.erledigt && stufe(t) < 9)
    .sort((a, b) => stufe(a) - stufe(b) || Number(!!b.wichtig) - Number(!!a.wichtig) || (a.faellig ?? '9').localeCompare(b.faellig ?? '9'));
  if (!kandidaten.length) return null;
  const rest = (t: TodoInfo) => Math.max(5, (t.dauer ?? 30) - (t.fokusMin ?? 0));
  const passend = kandidaten.find((t) => rest(t) <= luecke);
  const t = passend ?? (luecke >= 25 ? kandidaten[0]! : undefined);
  if (!t) return null;
  return { todo: t, schritt: t.schritte?.find((s) => !s.erledigt)?.text, luecke, bis: naechster ? { titel: naechster.titel, start: naechster.start } : null, passt: !!passend };
}
