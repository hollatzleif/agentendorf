/**
 * E145: Fachnamen vergleichen (Moodle-Kurs, Ordnername, Pomodoro-Gruppe, Lernziel). Gleich, wenn die Wörter gleich
 * sind – oder die Wörter des kürzeren Namens als ganze Wörter zusammenhängend im längeren vorkommen (mind. 4 Buchstaben;
 * ein einzelnes Wort nur am Anfang).
 * So passt „Mathe III“ zu „Mathe III UE“, aber „Mathe I“ nicht zu „Mathe II“ (Review).
 */
export const fachWoerter = (x: string) =>
  x
    .toLowerCase()
    .split(/[^a-z0-9äöüß]+/)
    .filter(Boolean);

export function fachPasst(a: string, b: string) {
  const x = fachWoerter(a);
  const y = fachWoerter(b);
  if (!x.length || !y.length) return false;
  if (x.join(' ') === y.join(' ')) return true;
  const [kurz, lang] = x.length <= y.length ? [x, y] : [y, x];
  if (kurz.join('').length < 4 || kurz.length === lang.length) return false;
  // ein einzelnes Wort nur als Anfang (nach Kürzeln wie „VL“/„UE“): „Algorithmen“ ↔ „VL Algorithmen und Datenstrukturen“,
  // aber nicht „Lernen“ ↔ „Statistisches Lernen“
  if (kurz.length === 1) return lang.find((w) => w.length > 2) === kurz[0];
  for (let i = 0; i + kurz.length <= lang.length; i++) if (kurz.every((w, j) => lang[i + j] === w)) return true;
  return false;
}

/** Fristen-Blöcke aus dem Kalender „Moodle-Fristen (automatisch)“ („⏰ … ist fällig“) sind keine Termine (Review) */
export const istFristBlock = (t: { titel: string }) => /^\s*(?:(?:✅|✔️?|☑️?|erledigt:?|done:?)\s*)?⏰/i.test(t.titel);

/** Das beste Element zu einem Namen: erst exakt gleiche Wörter, sonst das erste mit `fachPasst` (Review: „Mathe III“ vor „Mathe III UE“) */
export function fachZuordnen<T>(liste: readonly T[], namen: (x: T) => (string | null | undefined)[], name: string): T | undefined {
  const ziel = fachWoerter(name).join(' ');
  if (!ziel) return undefined;
  const n = (x: T) => namen(x).filter((y): y is string => !!y);
  const exakt = liste.find((x) => n(x).some((y) => fachWoerter(y).join(' ') === ziel));
  if (exakt) return exakt;
  // sonst der Name mit den meisten Wörtern gewinnt – „Mathe III UE“ vor „Mathe III“, unabhängig von der Reihenfolge (Review)
  let best: T | undefined;
  let bestN = 0;
  for (const x of liste)
    for (const y of n(x))
      if (fachPasst(y, name) && fachWoerter(y).length > bestN) {
        best = x;
        bestN = fachWoerter(y).length;
      }
  return best;
}
