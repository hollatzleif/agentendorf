import { ruht, type TodoInfo } from '@dorf/shared';

/**
 * Tag planen (Nacht 18./19.11.): verteilt die wichtigsten offenen To-dos als Zeitblöcke auf die freien Lücken eines
 * Tages – ohne KI, nachvollziehbar. Reihenfolge: überfällig → heute fällig → bald fällig (Uni-Abgaben/Prüfungen
 * zuerst) → Rest nach Datum. Dauer: Leifs Schätzung (E120), sonst Abgabe/Prüfung 90 min, Rest 45 min. Zwischen Blöcken 15 min Pause.
 * Das Ergebnis ist nur ein Vorschlag – eingetragen wird, was Leif anhakt.
 */
export interface Block {
  titel: string;
  todoPfad: string;
  start: number;
  ende: number;
  grund: string;
}

const MIN = 60_000;
const PAUSE = 15 * MIN;

export function rangfolge(todos: TodoInfo[], heute: string) {
  // E147: wer auf jemanden wartet, plant das erst am Nachfass-Tag ein
  const offen = todos.filter((t) => !t.erledigt && !ruht(t, heute));
  const wichtig = (t: TodoInfo) => /^(Abgabe|Prüfung):/i.test(t.titel) || t.gebaeude === 'Uni';
  const stufe = (t: TodoInfo) => {
    if (t.wichtig) return t.faellig && t.faellig < heute ? 0 : 1;
    if (t.faellig && t.faellig < heute) return 0;
    if (t.faellig === heute) return 1;
    if (t.faellig) return wichtig(t) ? 2 : 3;
    return 4;
  };
  return offen
    .map((t) => ({ t, s: stufe(t) }))
    .sort((a, b) => a.s - b.s || (a.t.faellig ?? '9999').localeCompare(b.t.faellig ?? '9999') || Number(wichtig(b.t)) - Number(wichtig(a.t)) || (b.t.erstellt ?? '').localeCompare(a.t.erstellt ?? ''))
    .sort((a, b) => a.s - b.s || Number(!!b.t.wichtig) - Number(!!a.t.wichtig))
    .map((x) => ({ ...x, grund: x.t.wichtig ? `⭐ wichtig${x.s === 0 ? ', überfällig' : ''}` : ['überfällig', 'heute fällig', `fällig ${x.t.faellig}`, `fällig ${x.t.faellig}`, 'ohne Datum'][x.s]! }));
}

export function tagPlanen(o: { todos: TodoInfo[]; heute: string; frei: [number, number][]; hoechstens?: number }): Block[] {
  const reihe = rangfolge(o.todos, o.heute).filter((x) => x.s <= 3 || o.todos.length <= 8);
  const luecken = o.frei.map(([a, b]) => [a, b] as [number, number]).sort((x, y) => x[0] - y[0]);
  const aus: Block[] = [];
  for (const { t, grund: g } of reihe) {
    let grund = g;
    if (aus.length >= (o.hoechstens ?? 5)) break;
    // E120: Leifs Schätzung zählt; sonst Abgabe/Prüfung 90 min, Rest 45 min
    const dauer = (t.dauer ?? (/^(Abgabe|Prüfung):/i.test(t.titel) ? 90 : 45)) * MIN;
    let l = luecken.find(([a, b]) => b - a >= dauer);
    let laenge = dauer;
    if (!l && t.dauer) {
      // Große Schätzung passt in keine Lücke: lieber ein Teilblock in der größten Lücke (ab 30 min) als gar nichts (Review)
      const groesste = [...luecken].sort((x, y) => y[1] - y[0] - (x[1] - x[0]))[0];
      if (groesste && groesste[1] - groesste[0] >= 30 * MIN) {
        l = groesste;
        laenge = groesste[1] - groesste[0];
        grund = `${grund} · Teil von ⏱ ${t.dauer >= 60 ? `${Math.round((t.dauer / 60) * 10) / 10} h`.replace('.', ',') : `${t.dauer} min`}`;
      }
    }
    if (!l) continue;
    aus.push({ titel: t.titel.replace(/^(Abgabe|Prüfung): /i, ''), todoPfad: t.pfad, start: l[0], ende: l[0] + laenge, grund });
    l[0] += laenge + PAUSE;
  }
  return aus.sort((a, b) => a.start - b.start);
}
