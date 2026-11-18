import type { DorfBluete, Statistik } from '@dorf/shared';

/**
 * Das Dorf blüht (E112): ein Wert 0–1 aus den letzten 7 Tagen – aktive Tage, Gewohnheiten, Fokus, Erledigtes –
 * plus Fahne (alle Wochenziele erreicht) und Feuerwerk (heute ≥ 5 erledigt). Nur aus vorhandenen Zahlen, keine KI.
 * Es soll motivieren, nicht bestrafen: schon ein paar aktive Tage machen das Dorf grün.
 */
export function bluete(s: Statistik, wochenziele?: { ziele: { erledigt: boolean }[] }): DorfBluete {
  const fokus = Math.min(1, s.summen.fokusMinWoche / (7 * 50)); // ~ 2 Pomodoros am Tag = voll
  const erledigt = Math.min(1, s.summen.erledigtWoche / 14); // ~ 2 am Tag = voll
  const aktiv = s.tage.slice(-7).filter((t) => t.erledigt || t.fokusMin || t.gewohnheitenErledigt).length / 7;
  const gw = s.summen.gewohnheitenQuote == null ? aktiv : s.summen.gewohnheitenQuote / 100;
  const wert = Math.round((0.35 * aktiv + 0.25 * gw + 0.2 * fokus + 0.2 * erledigt) * 100) / 100;
  const heute = s.tage.at(-1);
  const gruende: string[] = [];
  gruende.push(`${Math.round(aktiv * 7)} von 7 Tagen aktiv`);
  if (s.summen.gewohnheitenQuote != null) gruende.push(`Gewohnheiten ${s.summen.gewohnheitenQuote} %`);
  if (s.summen.fokusMinWoche) gruende.push(`${s.summen.fokusMinWoche} min Fokus`);
  if (s.summen.erledigtWoche) gruende.push(`${s.summen.erledigtWoche} erledigt`);
  const ziele = wochenziele?.ziele ?? [];
  return {
    wert,
    stufe: wert < 0.25 ? 'karg' : wert < 0.5 ? 'gruen' : wert < 0.75 ? 'bluehend' : 'praechtig',
    fahne: ziele.length > 0 && ziele.every((z) => z.erledigt),
    feuerwerk: (heute?.erledigt ?? 0) >= 5,
    gruende,
  };
}

export const STUFE_TEXT: Record<DorfBluete['stufe'], string> = { karg: '🌱 ruhig', gruen: '🌿 grün', bluehend: '🌸 blühend', praechtig: '🌺 prächtig' };

/** Eine Zeile für Morgenzeitung/Wochenrückblick */
export function blueteZeile(b: DorfBluete) {
  return `${STUFE_TEXT[b.stufe]} – ${b.gruende.join(', ')}${b.fahne ? ' · 🚩 alle Wochenziele erreicht' : ''}`;
}
