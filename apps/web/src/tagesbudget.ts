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
