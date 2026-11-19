/**
 * E170: Rückwärtsplanung – ein großes To-do mit Frist in gleich große Etappen auf die Tage davor verteilen.
 * Tage: heute bis Vortag der Frist. Anzahl: je angefangene Stunde eine Etappe (mind. 2, höchstens 8 und nicht mehr als Tage).
 * Etappen ≥ 15 min, in 5-Minuten-Schritten. Ohne Schätzung wird mit 2 h gerechnet.
 */
export interface Etappe {
  titel: string;
  faellig: string;
  dauer: number;
}

const plus = (tag: string, n: number) => new Date(Date.parse(`${tag}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function etappenPlan(t: { titel: string; faellig?: string; dauer?: number }, heute: string, anzahlWunsch?: number): Etappe[] {
  if (!t.faellig || t.faellig <= plus(heute, 1)) return [];
  const tage = Math.round((Date.parse(`${t.faellig}T12:00:00Z`) - Date.parse(`${heute}T12:00:00Z`)) / 86_400_000); // heute … Vortag
  const dauer = t.dauer ?? 120;
  const anzahl = Math.max(2, Math.min(anzahlWunsch ?? Math.ceil(dauer / 60), 8, tage));
  const je = Math.max(15, Math.round(dauer / anzahl / 5) * 5);
  const titel = t.titel.replace(/\s+–\s+Etappe \d+\/\d+$/, '').slice(0, 170);
  return Array.from({ length: anzahl }, (_, i) => ({ titel: `${titel} – Etappe ${i + 1}/${anzahl}`, faellig: plus(heute, Math.floor((i * tage) / anzahl)), dauer: je }));
}
