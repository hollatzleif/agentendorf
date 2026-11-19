import type { TodoInfo } from './index.js';
import { ruht } from './tagesbudget.js';

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
  /** ganze Tage seit der letzten Bewegung (Anlage, Erledigung, Fokussitzung) */
  ruhtTage: number;
  /** E166: „ruht“ lohnt einen Anstoß – offen, eine Woche still, nicht alles wartend, nächster Schritt nicht erst später fällig */
  ruhtMelden: boolean;
}

export function projekteAus(todos: TodoInfo[], jetzt: number): Projekt[] {
  const heute = new Date(jetzt).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
  const gruppen = new Map<string, TodoInfo[]>();
  for (const t of todos) {
    const g = t.gruppe?.trim();
    // wiederkehrende („Sport“ täglich) sind Gewohnheiten, keine Projektschritte (Review)
    if (!g || t.wiederholen) continue;
    gruppen.set(g, [...(gruppen.get(g) ?? []), t]);
  }
  const aus: Projekt[] = [];
  for (const [name, liste] of gruppen) {
    const offen = liste.filter((t) => !t.erledigt);
    if (liste.length < 3 && offen.length < 2) continue;
    // Wartendes ist kein nächster Schritt (E147) – man kann gerade nichts tun (Review)
    const aktiv = offen.filter((t) => !ruht(t, heute));
    const naechster = [...aktiv].sort(
      (a, b) => Number(!!b.wichtig) - Number(!!a.wichtig) || (a.faellig ?? '9999').localeCompare(b.faellig ?? '9999') || (a.erstellt ?? '').localeCompare(b.erstellt ?? ''),
    )[0];
    const zeiten = liste.flatMap((t) => [t.erstellt, t.erledigtAm, t.fokusZuletzt]).filter((x): x is string => !!x).map((x) => Date.parse(x)).filter((x) => Number.isFinite(x));
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
      ruhtMelden: offen.length > 0 && aktiv.length > 0 && jetzt - letzte >= 7 * 86_400_000 && !(naechster?.faellig && naechster.faellig > heute),
    });
  }
  // offene zuerst, darunter die mit den meisten offenen; fertige Projekte ans Ende
  return aus.sort((a, b) => Number(b.offen > 0) - Number(a.offen > 0) || b.offen - a.offen || a.name.localeCompare(b.name, 'de'));
}
