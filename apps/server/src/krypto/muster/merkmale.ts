// E235: Merkmale aus den Ticks der letzten 2 min (die „Augen“ des Muster-Modells) und das Label „erst +Ziel, dann −Stop“.
// Reiner Code: nur die übergebenen Ticks, nur Ticks mit zeit <= t (keine Zukunftsdaten in den Merkmalen).
import type { Tick, TokenMeta, Ziel } from "./typen.js";

const FENSTER_MS = 120_000;
const KERZE_MS = 5_000;
const KERZEN = FENSTER_MS / KERZE_MS;

export const MERKMAL_NAMEN: string[] = [
  "rendite5s",
  "rendite15s",
  "rendite30s",
  "rendite60s",
  "rendite120s",
  "volatilitaet60s",
  "volatilitaet120s",
  "koerper1",
  "koerper2",
  "koerper3",
  "oberDocht1",
  "oberDocht2",
  "oberDocht3",
  "unterDocht1",
  "grueneFolge",
  "kaeufe30s",
  "verkaeufe30s",
  "nettoSol30s",
  "kaeufe60s",
  "verkaeufe60s",
  "nettoSol60s",
  "tickrate60s",
  "echtSol",
  "echtSolAenderung60s",
  "abstandHoch120s",
  "alterSek",
  "devTokens24h",
];

/** Index des letzten Ticks mit zeit <= t (−1, wenn keiner) – binäre Suche, Ticks aufsteigend nach zeit */
export function letzterIndex(ticks: Tick[], t: number): number {
  let lo = 0;
  let hi = ticks.length - 1;
  let erg = -1;
  while (lo <= hi) {
    const mitte = (lo + hi) >> 1;
    if (ticks[mitte]!.zeit <= t) {
      erg = mitte;
      lo = mitte + 1;
    } else hi = mitte - 1;
  }
  return erg;
}

function endlich(x: number) {
  return Number.isFinite(x) ? x : 0;
}

function prozent(a: number, b: number) {
  return b > 0 ? (a / b - 1) * 100 : 0;
}

/** Merkmale bei t (Reihenfolge = MERKMAL_NAMEN); null, wenn weniger als 3 Ticks in den letzten 120 s */
export function merkmale(
  ticks: Tick[],
  t: number,
  meta: TokenMeta,
): number[] | null {
  const iT = letzterIndex(ticks, t);
  if (iT < 0) return null;
  const iStart = letzterIndex(ticks, t - FENSTER_MS) + 1;
  if (iT - iStart + 1 < 3) return null;
  const jetzt = ticks[iT]!;
  const preis = jetzt.preis;
  // Kurs zu einem früheren Zeitpunkt: letzter Tick davor; vor dem ersten Tick gilt der erste
  const preisBei = (x: number) => {
    const j = letzterIndex(ticks, x);
    return (j >= 0 ? ticks[j]! : ticks[0]!).preis;
  };
  const echtSolBei = (x: number) => {
    const j = letzterIndex(ticks, x);
    return (j >= 0 ? ticks[j]! : ticks[0]!).echtSol;
  };

  const renditen = [5, 15, 30, 60, 120].map((s) =>
    prozent(preis, preisBei(t - s * 1000)),
  );

  const vol = (ab: number) => {
    const werte: number[] = [];
    for (let i = Math.max(iStart, 1); i <= iT; i++) {
      const a = ticks[i - 1]!;
      const b = ticks[i]!;
      if (b.zeit <= ab || a.preis <= 0 || b.preis <= 0) continue;
      werte.push(Math.log(b.preis / a.preis) * 100);
    }
    if (werte.length < 2) return 0;
    const m = werte.reduce((s, w) => s + w, 0) / werte.length;
    return Math.sqrt(
      werte.reduce((s, w) => s + (w - m) ** 2, 0) / (werte.length - 1),
    );
  };

  // 5-s-Kerzen: k = 0 ist die jüngste und deckt (t − 5 s, t] ab
  const hoch = new Array<number>(KERZEN).fill(-Infinity);
  const tief = new Array<number>(KERZEN).fill(Infinity);
  const schluss = new Array<number | null>(KERZEN).fill(null);
  let kaeufe30 = 0;
  let verkaeufe30 = 0;
  let netto30 = 0;
  let kaeufe60 = 0;
  let verkaeufe60 = 0;
  let netto60 = 0;
  let ticks60 = 0;
  let hoechster = 0;
  for (let i = iStart; i <= iT; i++) {
    const k = ticks[i]!;
    const idx = Math.min(KERZEN - 1, Math.floor((t - k.zeit) / KERZE_MS));
    hoch[idx] = Math.max(hoch[idx]!, k.preis);
    tief[idx] = Math.min(tief[idx]!, k.preis);
    schluss[idx] = k.preis;
    if (k.preis > hoechster) hoechster = k.preis;
    if (k.zeit > t - 60_000) {
      ticks60++;
      if (k.sol > 0) kaeufe60++;
      else if (k.sol < 0) verkaeufe60++;
      netto60 += k.sol;
      if (k.zeit > t - 30_000) {
        if (k.sol > 0) kaeufe30++;
        else if (k.sol < 0) verkaeufe30++;
        netto30 += k.sol;
      }
    }
  }
  const auf = new Array<number>(KERZEN);
  const zu = new Array<number>(KERZEN);
  let vorher = preisBei(t - FENSTER_MS);
  for (let k = KERZEN - 1; k >= 0; k--) {
    auf[k] = vorher;
    zu[k] = schluss[k] ?? vorher;
    hoch[k] = Math.max(hoch[k]!, auf[k]!, zu[k]!);
    tief[k] = Math.min(tief[k]!, auf[k]!, zu[k]!);
    vorher = zu[k]!;
  }
  const koerper = (k: number) => prozent(zu[k]!, auf[k]!);
  const oberDocht = (k: number) => prozent(hoch[k]!, Math.max(auf[k]!, zu[k]!));
  const unterDocht = (k: number) => {
    const basis = Math.min(auf[k]!, zu[k]!);
    return basis > 0 ? (1 - tief[k]! / basis) * 100 : 0;
  };
  let gruen = 0;
  for (let k = 0; k < KERZEN && zu[k]! > auf[k]!; k++) gruen++;

  const roh = [
    ...renditen,
    vol(t - 60_000),
    vol(t - FENSTER_MS),
    koerper(0),
    koerper(1),
    koerper(2),
    oberDocht(0),
    oberDocht(1),
    oberDocht(2),
    unterDocht(0),
    gruen,
    kaeufe30,
    verkaeufe30,
    netto30,
    kaeufe60,
    verkaeufe60,
    netto60,
    ticks60,
    jetzt.echtSol,
    jetzt.echtSol - echtSolBei(t - 60_000),
    prozent(preis, hoechster),
    (t - meta.erstellt) / 1000,
    meta.devTokens24h ?? -1,
  ];
  return roh.map(endlich);
}

/**
 * Label bei t: 1, wenn der Kurs danach (bis t + horizont) zuerst +zielProzent erreicht; 0, wenn zuerst −stopProzent oder
 * der Horizont ohne Ziel vergeht; null, wenn die Aufzeichnung den Horizont nicht abdeckt (kein Tick bei/nach t + horizont) –
 * auch dann, wenn Ziel oder Stop schon vorher erreicht wären (sonst Auswahlverzerrung am Ende der Aufzeichnung).
 */
export function label(ticks: Tick[], t: number, ziel: Ziel): 0 | 1 | null {
  const i = letzterIndex(ticks, t);
  if (i < 0) return null;
  const p0 = ticks[i]!.preis;
  if (!(p0 > 0)) return null;
  const oben = p0 * (1 + ziel.zielProzent / 100);
  const unten = p0 * (1 - ziel.stopProzent / 100);
  const ende = t + ziel.horizontMs;
  // erst prüfen, ob die Aufzeichnung den Horizont abdeckt: sonst kämen am Ende nur „schnell entschiedene“ Fälle durch
  // (Auswahlverzerrung – das Modell lernte „kurz vor dem Ende steigt es oft“)
  if (ticks[ticks.length - 1]!.zeit < ende) return null;
  for (let j = i + 1; j < ticks.length; j++) {
    const k = ticks[j]!;
    if (k.zeit > ende) return 0;
    if (k.preis >= oben) return 1;
    if (k.preis <= unten) return 0;
  }
  return 0;
}

/** Rat aus der Muster-Wahrscheinlichkeit: kaufen ab 0,6; raus (nur gehalten) unter 0,3; sonst halten */
export function ratAus(
  p: number,
  haelt: boolean,
): "kaufen" | "halten" | "raus" {
  if (haelt) return p < 0.3 ? "raus" : "halten";
  return p >= 0.6 ? "kaufen" : "halten";
}
