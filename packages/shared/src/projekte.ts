import type { TodoInfo } from './index.js';

/**
 * E161: Projekte = To-dos mit derselben Gruppe (mind. 3 insgesamt oder 2 offene). Je Projekt: Fortschritt, nächster Schritt,
 * Fokuszeit und wie lange nichts passiert ist (letzte Anlage/Erledigung). Ohne neue Datei, ohne neues Feld – nur Auswertung.
 */
export interface Projekt {
  name: string;
  gesamt: number;
  erledigt: number;
  offen: number;
  /** erledigt in den letzten 7 Tagen */
  dieseWoche: number;
  naechster?: { pfad: string; titel: string; faellig?: string; schritt?: string };
  fokusMin: number;
  /** ganze Tage seit der letzten Bewegung (Anlage oder Erledigung) */
  ruhtTage: number;
}

export function projekteAus(todos: TodoInfo[], jetzt: number): Projekt[] {
  const gruppen = new Map<string, TodoInfo[]>();
  for (const t of todos) {
    const g = t.gruppe?.trim();
    if (!g) continue;
    gruppen.set(g, [...(gruppen.get(g) ?? []), t]);
  }
  const aus: Projekt[] = [];
  for (const [name, liste] of gruppen) {
    const offen = liste.filter((t) => !t.erledigt);
    if (liste.length < 3 && offen.length < 2) continue;
    const naechster = [...offen].sort(
      (a, b) => Number(!!b.wichtig) - Number(!!a.wichtig) || (a.faellig ?? '9999').localeCompare(b.faellig ?? '9999') || (a.erstellt ?? '').localeCompare(b.erstellt ?? ''),
    )[0];
    const zeiten = liste.flatMap((t) => [t.erstellt, t.erledigtAm]).filter((x): x is string => !!x).map((x) => Date.parse(x)).filter((x) => Number.isFinite(x));
    const letzte = zeiten.length ? Math.max(...zeiten) : jetzt;
    aus.push({
      name,
      gesamt: liste.length,
      erledigt: liste.length - offen.length,
      offen: offen.length,
      dieseWoche: liste.filter((t) => t.erledigt && t.erledigtAm && jetzt - Date.parse(t.erledigtAm) < 7 * 86_400_000).length,
      ...(naechster ? { naechster: { pfad: naechster.pfad, titel: naechster.titel, ...(naechster.faellig ? { faellig: naechster.faellig } : {}), ...(naechster.schritte?.find((s) => !s.erledigt) ? { schritt: naechster.schritte.find((s) => !s.erledigt)!.text } : {}) } } : {}),
      fokusMin: liste.reduce((s, t) => s + (t.fokusMin ?? 0), 0),
      ruhtTage: Math.max(0, Math.floor((jetzt - letzte) / 86_400_000)),
    });
  }
  // offene zuerst, darunter die mit den meisten offenen; fertige Projekte ans Ende
  return aus.sort((a, b) => Number(b.offen > 0) - Number(a.offen > 0) || b.offen - a.offen || a.name.localeCompare(b.name, 'de'));
}
