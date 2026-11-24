/**
 * E223 – Rechnungen für die Börse (App und Server): Zeiträume, Kennzahlen, Monatsrenditen, Rechner.
 * Reine Funktionen ohne Netz – die Daten kommen von /api/boerse/analyse. Keine Anlageberatung: nur Arithmetik.
 */
export type Punkt = [string, number]; // [JJJJ-MM-TT, Wert]

export const ZEITRAEUME = ['1W', '1M', '3M', '6M', 'YTD', '1J', '3J', '5J', 'MAX'] as const;
export type Zeitraum = (typeof ZEITRAEUME)[number];
export const ZEITRAUM_TEXT: Record<Zeitraum, string> = { '1W': '1 Woche', '1M': '1 Monat', '3M': '3 Monate', '6M': '6 Monate', YTD: 'Seit Jahresbeginn', '1J': '1 Jahr', '3J': '3 Jahre', '5J': '5 Jahre', MAX: 'Alles' };

const tagPlus = (tag: string, n: number) => new Date(Date.parse(`${tag}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const monatePlus = (tag: string, n: number) => {
  const d = new Date(`${tag}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};

/** Erster Tag des Zeitraums (inklusive) – MAX = null (alles) */
export function zeitraumVon(z: Zeitraum, heute: string): string | null {
  switch (z) {
    case '1W':
      return tagPlus(heute, -7);
    case '1M':
      return monatePlus(heute, -1);
    case '3M':
      return monatePlus(heute, -3);
    case '6M':
      return monatePlus(heute, -6);
    case 'YTD':
      return `${Number(heute.slice(0, 4)) - 1}-12-31`;
    case '1J':
      return monatePlus(heute, -12);
    case '3J':
      return monatePlus(heute, -36);
    case '5J':
      return monatePlus(heute, -60);
    default:
      return null;
  }
}

/** Ausschnitt [von, bis]; der letzte Punkt VOR `von` kommt als Startwert dazu (sonst fehlt die Änderung am ersten Tag) */
export function schneiden(p: Punkt[], von: string | null, bis?: string | null): Punkt[] {
  const r = p.filter(([d]) => (!von || d >= von) && (!bis || d <= bis));
  if (von) {
    const vor = [...p].reverse().find(([d]) => d < von);
    if (vor && (!r.length || r[0]![0] !== vor[0])) r.unshift(vor);
  }
  return r;
}

export interface Kennzahlen {
  start: number;
  ende: number;
  von: string;
  bis: string;
  differenz: number;
  prozent: number | null;
  hoch: { wert: number; datum: string };
  tief: { wert: number; datum: string };
  /** größter Rückgang vom Hoch, als Anteil (−0,12 = −12 %) */
  maxRueckgang: { anteil: number; von: string; bis: string } | null;
  /** annualisierte Schwankung (Standardabweichung der Tagesrenditen · √252), Anteil */
  volatilitaet: number | null;
  besterTag: { datum: string; anteil: number } | null;
  schlechtesterTag: { datum: string; anteil: number } | null;
  /** Anteil der Tage mit Plus */
  plusTage: number | null;
  /** jährliche Rendite (nur ab 1 Jahr Zeitraum), Anteil */
  proJahr: number | null;
}

/** Kennzahlen einer Wertreihe (Werte > 0). Mit `rendite` (kumulierte zeitgewichtete Rendite) zählen Ein-/Auszahlungen nicht. */
export function kennzahlen(p: Punkt[], rendite?: Punkt[]): Kennzahlen | null {
  const w = p.filter(([, v]) => Number.isFinite(v));
  if (w.length < 2) return null;
  const start = w[0]![1];
  const ende = w.at(-1)![1];
  let hoch = { wert: -Infinity, datum: '' };
  let tief = { wert: Infinity, datum: '' };
  for (const [d, v] of w) {
    if (v > hoch.wert) hoch = { wert: v, datum: d };
    if (v < tief.wert) tief = { wert: v, datum: d };
  }
  // Tagesrenditen: aus der zeitgewichteten Reihe, wenn vorhanden (dann verfälschen Einzahlungen nichts)
  const index: Punkt[] = rendite && rendite.length >= 2 ? rendite.map(([d, r]) => [d, 1 + r]) : w;
  const tage: { datum: string; anteil: number }[] = [];
  for (let i = 1; i < index.length; i++) if (index[i - 1]![1] > 0) tage.push({ datum: index[i]![0], anteil: index[i]![1] / index[i - 1]![1] - 1 });
  let spitze = index[0]!;
  let mdd: Kennzahlen['maxRueckgang'] = null;
  for (const pt of index) {
    if (pt[1] > spitze[1]) spitze = pt;
    const r = spitze[1] > 0 ? pt[1] / spitze[1] - 1 : 0;
    if (r < (mdd?.anteil ?? 0)) mdd = { anteil: r, von: spitze[0], bis: pt[0] };
  }
  const mittel = tage.reduce((s, t) => s + t.anteil, 0) / (tage.length || 1);
  const vol = tage.length >= 5 ? Math.sqrt(tage.reduce((s, t) => s + (t.anteil - mittel) ** 2, 0) / (tage.length - 1)) * Math.sqrt(252) : null;
  const sortiert = [...tage].sort((a, b) => a.anteil - b.anteil);
  const gesamt = rendite && rendite.length >= 2 ? (1 + rendite.at(-1)![1]) / (1 + rendite[0]![1]) - 1 : start ? ende / start - 1 : null;
  const jahre = (Date.parse(w.at(-1)![0]) - Date.parse(w[0]![0])) / (365.25 * 86_400_000);
  return {
    start,
    ende,
    von: w[0]![0],
    bis: w.at(-1)![0],
    differenz: ende - start,
    prozent: gesamt,
    hoch,
    tief,
    maxRueckgang: mdd,
    volatilitaet: vol,
    besterTag: sortiert.at(-1) ?? null,
    schlechtesterTag: sortiert[0] ?? null,
    plusTage: tage.length ? tage.filter((t) => t.anteil > 0).length / tage.length : null,
    proJahr: gesamt != null && jahre >= 1 ? (1 + gesamt) ** (1 / jahre) - 1 : null,
  };
}

/** Monatsrenditen (Anteil) aus einer Index- oder Wertreihe: { 2026: { 1: 0.02, … } } – Monat 1–12 */
export function monatsRenditen(p: Punkt[]): Record<number, Record<number, number>> {
  const ende = new Map<string, number>(); // JJJJ-MM → letzter Wert
  for (const [d, v] of p) ende.set(d.slice(0, 7), v);
  const monate = [...ende.keys()].sort();
  const r: Record<number, Record<number, number>> = {};
  for (let i = 1; i < monate.length; i++) {
    const vor = ende.get(monate[i - 1]!)!;
    if (!vor) continue;
    const [j, m] = monate[i]!.split('-').map(Number) as [number, number];
    (r[j] ??= {})[m] = ende.get(monate[i]!)! / vor - 1;
  }
  return r;
}

/** Jahresrenditen aus Monatsrenditen (verkettet) */
export function jahresRendite(monate: Record<number, number>): number {
  return Object.values(monate).reduce((s, m) => s * (1 + m), 1) - 1;
}

/** Reihe auf 100 am ersten Punkt (Vergleich verschieden großer Werte) */
export function aufHundert(p: Punkt[]): Punkt[] {
  const b = p.find(([, v]) => v > 0)?.[1];
  return b ? p.map(([d, v]) => [d, (v / b) * 100]) : [];
}

/** Mehrere Reihen tageweise addieren (fehlende Tage: letzter bekannter Wert der Reihe) */
export function summieren(reihen: Punkt[][]): Punkt[] {
  const tage = [...new Set(reihen.flatMap((r) => r.map(([d]) => d)))].sort();
  const zeiger = reihen.map(() => 0);
  const letzte: (number | null)[] = reihen.map(() => null);
  return tage.map((tag) => {
    let s = 0;
    reihen.forEach((r, i) => {
      while (zeiger[i]! < r.length && r[zeiger[i]!]![0] <= tag) letzte[i] = r[zeiger[i]!++]![1];
      s += letzte[i] ?? 0;
    });
    return [tag, s] as Punkt;
  });
}

// ---- Rechner ---------------------------------------------------------------------------------------

export interface SparplanZeile {
  jahr: number;
  eingezahlt: number;
  wert: number;
  ertrag: number;
  /** in heutiger Kaufkraft */
  real: number;
}
/** Sparplan mit monatlicher Einzahlung, jährlicher Erhöhung (Dynamik), Rendite p. a. nach Kosten, Inflation */
export function sparplan(o: { start: number; monatlich: number; jahre: number; rendite: number; kosten?: number; dynamik?: number; inflation?: number }): SparplanZeile[] {
  const zeilen: SparplanZeile[] = [];
  const rMonat = (1 + o.rendite - (o.kosten ?? 0)) ** (1 / 12) - 1;
  let wert = o.start;
  let eingezahlt = o.start;
  let rate = o.monatlich;
  for (let j = 1; j <= Math.min(o.jahre, 80); j++) {
    for (let m = 0; m < 12; m++) {
      wert = wert * (1 + rMonat) + rate;
      eingezahlt += rate;
    }
    rate *= 1 + (o.dynamik ?? 0);
    zeilen.push({ jahr: j, eingezahlt, wert, ertrag: wert - eingezahlt, real: wert / (1 + (o.inflation ?? 0)) ** j });
  }
  return zeilen;
}

/** Entnahmeplan: wie lange reicht das Kapital bei monatlicher Entnahme (steigt mit der Inflation)? null = länger als 100 Jahre */
export function entnahme(o: { kapital: number; monatlich: number; rendite: number; inflation?: number }): { monate: number | null; verlauf: Punkt[] } {
  const rMonat = (1 + o.rendite) ** (1 / 12) - 1;
  let k = o.kapital;
  let rate = o.monatlich;
  const verlauf: Punkt[] = [['0', k]];
  for (let m = 1; m <= 1200; m++) {
    k = k * (1 + rMonat) - rate;
    if (m % 12 === 0) {
      rate *= 1 + (o.inflation ?? 0);
      verlauf.push([String(m / 12), Math.max(0, k)]);
    }
    if (k <= 0) return { monate: m, verlauf };
  }
  return { monate: null, verlauf };
}

/** Rebalancing: was kaufen/verkaufen, damit die Zielgewichte stimmen (zusätzliches Geld wird mit verteilt) */
export function rebalancing(pos: { name: string; wert: number; ziel: number }[], zusatz = 0, nurKaufen = false): { name: string; jetzt: number; ziel: number; aenderung: number }[] {
  const summeZiel = pos.reduce((s, p) => s + p.ziel, 0) || 1;
  const gesamt = pos.reduce((s, p) => s + p.wert, 0) + zusatz;
  let r = pos.map((p) => ({ name: p.name, jetzt: p.wert, ziel: (gesamt * p.ziel) / summeZiel, aenderung: (gesamt * p.ziel) / summeZiel - p.wert }));
  if (nurKaufen) {
    // nur das Zusatzgeld verteilen – auf die untergewichteten, im Verhältnis ihrer Lücke
    const luecken = r.map((x) => Math.max(0, x.aenderung));
    const summe = luecken.reduce((s, l) => s + l, 0);
    r = r.map((x, i) => ({ ...x, aenderung: summe ? (luecken[i]! / summe) * zusatz : 0 }));
  }
  return r;
}

/** Was laufende Kosten (TER) über die Jahre kosten: Endwert mit und ohne Kosten */
export function kostenEffekt(o: { betrag: number; monatlich?: number; jahre: number; rendite: number; ter: number }) {
  const mit = sparplan({ start: o.betrag, monatlich: o.monatlich ?? 0, jahre: o.jahre, rendite: o.rendite, kosten: o.ter }).at(-1)?.wert ?? o.betrag;
  const ohne = sparplan({ start: o.betrag, monatlich: o.monatlich ?? 0, jahre: o.jahre, rendite: o.rendite }).at(-1)?.wert ?? o.betrag;
  return { mit, ohne, kosten: ohne - mit };
}

/** Konzentration: Anteil der größten Positionen und effektive Anzahl (1 / Σ Anteil²) */
export function konzentration(werte: number[]) {
  const s = werte.reduce((a, b) => a + b, 0);
  if (s <= 0) return null;
  const anteile = werte.map((w) => w / s).sort((a, b) => b - a);
  return { groesste: anteile[0] ?? 0, top3: anteile.slice(0, 3).reduce((a, b) => a + b, 0), effektiv: 1 / anteile.reduce((a, b) => a + b * b, 0) };
}

/** Zinseszins: wie lange bis sich ein Betrag verdoppelt */
export function verdopplungJahre(rendite: number) {
  return rendite > 0 ? Math.log(2) / Math.log(1 + rendite) : null;
}
