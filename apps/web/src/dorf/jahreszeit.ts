/**
 * Jahreszeit nach dem Kalender (mitteleuropäische Zeit): färbt Laub, Wald und Hügel.
 * ?jahreszeit=winter (fruehling, sommer, herbst) zum Ausprobieren.
 */
export type Jahreszeit = 'fruehling' | 'sommer' | 'herbst' | 'winter';

export function jahreszeit(datum = new Date()): Jahreszeit {
  const vorgabe = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('jahreszeit') : null;
  if (vorgabe === 'fruehling' || vorgabe === 'sommer' || vorgabe === 'herbst' || vorgabe === 'winter') return vorgabe;
  const monat = Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Vienna', month: 'numeric' }).format(datum));
  if (monat >= 3 && monat <= 5) return 'fruehling';
  if (monat >= 6 && monat <= 8) return 'sommer';
  if (monat >= 9 && monat <= 11) return 'herbst';
  return 'winter';
}

/** Kronenfarben der Laubbäume (Deko im Dorf und Wald) */
export function laubFarben(j: Jahreszeit = jahreszeit()): string[] {
  switch (j) {
    case 'fruehling':
      return ['#6fcf4f', '#5cbf4a', '#8edb5c', '#f7b6cf', '#6fcf4f'];
    case 'herbst':
      return ['#e8892b', '#d9612a', '#f2b93b', '#c8452c', '#9fae3a', '#e8a33a'];
    case 'winter':
      return ['#dfe8ee', '#c9d6de', '#9db3a3', '#eef3f6'];
    default:
      return ['#4caf50', '#3f9f45', '#5cbf4a', '#6aaa3a'];
  }
}

/** Nadelbäume: im Winter mit Schnee auf den oberen Etagen */
export function nadelFarben(j: Jahreszeit = jahreszeit()) {
  return {
    unten: j === 'winter' ? ['#2a6e4a', '#2f7a50', '#286648'] : ['#2e8b57', '#2a7a4d', '#3a9a5f'],
    oben: j === 'winter' ? ['#eef3f6', '#e2eaef', '#f5f8fa'] : ['#2e8b57', '#3a9a5f', '#2a7a4d'],
  };
}

/** Bodenfarbe der Hügel: Herbst etwas gelblicher, Winter Schnee (je höher, desto weißer) */
export function bodenFarbe(j: Jahreszeit, hoehe: number): { farbe: string; schnee: number } {
  if (j === 'winter') return { farbe: '#9cbf7a', schnee: Math.min(0.95, 0.62 + Math.max(0, hoehe) * 0.15) };
  if (j === 'herbst') return { farbe: '#9cbf52', schnee: 0 };
  if (j === 'fruehling') return { farbe: '#80cc55', schnee: 0 };
  return { farbe: '#86c552', schnee: 0 };
}
