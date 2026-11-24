// E235: Gradient Boosting für P(erst +Ziel, dann −Stop) – eigene kleine Implementierung ohne Abhängigkeit.
// Log-Loss, Regressionsbäume mit Newton-Schritt (Blatt = −ΣG / (ΣH + λ)), Schwellen aus Quantil-Histogrammen
// (höchstens 32 Stufen je Merkmal, einmal vorberechnet). Wichtigkeit = Summe der Gain-Werte je Merkmal (normiert).
// Kooperativ: nach jedem Baum und spätestens alle ~20 ms `await abgeben()` (das Kryptowerk darf nie blockieren).
import { MERKMAL_NAMEN } from "./merkmale.js";
import type { GbdtKnoten, GbdtModell } from "./typen.js";

const STUFEN = 32;
const LAMBDA = 1;
const PROBE = 20_000;

/** Ruft abgeben() höchstens alle `ms` Millisekunden auf */
export function takt(abgeben?: () => Promise<void>, ms = 20) {
  let letzt = Date.now();
  return async (erzwingen = false) => {
    if (!abgeben) return;
    if (erzwingen || Date.now() - letzt >= ms) {
      await abgeben();
      letzt = Date.now();
    }
  };
}

function sigmoid(x: number) {
  return 1 / (1 + Math.exp(-x));
}

function wert(x: number | undefined) {
  return x !== undefined && Number.isFinite(x) ? x : 0;
}

/** Schwellen je Merkmal (aufsteigend, eindeutig) aus Quantilen einer Probe */
function schwellenBerechnen(X: number[][], f: number): number[] {
  const n = X.length;
  const schritt = Math.max(1, Math.floor(n / PROBE));
  const werte: number[] = [];
  for (let i = 0; i < n; i += schritt) werte.push(wert(X[i]![f]));
  werte.sort((a, b) => a - b);
  const s: number[] = [];
  for (let q = 1; q < STUFEN; q++) {
    const v =
      werte[
        Math.min(werte.length - 1, Math.floor((q * werte.length) / STUFEN))
      ]!;
    if (s.length === 0 || v > s[s.length - 1]!) s.push(v);
  }
  // die größte Schwelle trennt nichts ab, wenn sie das Maximum ist
  if (s.length && s[s.length - 1]! >= werte[werte.length - 1]!) s.pop();
  return s;
}

/** Stufe = Anzahl Schwellen < x; Stufe b heißt x <= schwellen[b] (und > schwellen[b−1]) */
function stufe(s: number[], x: number) {
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (s[m]! < x) lo = m + 1;
    else hi = m;
  }
  return lo;
}

export async function gbdtTrainieren(
  X: number[][],
  y: number[],
  o: {
    baeume?: number;
    tiefe?: number;
    lernrate?: number;
    minBlatt?: number;
  } = {},
  abgeben?: () => Promise<void>,
): Promise<{ modell: GbdtModell; wichtigkeit: number[] }> {
  const n = X.length;
  const F = n ? X[0]!.length : 0;
  const anzahlBaeume = o.baeume ?? 80;
  const tiefe = o.tiefe ?? 3;
  const lernrate = o.lernrate ?? 0.1;
  const minBlatt = Math.max(1, o.minBlatt ?? 20);
  const warte = takt(abgeben);
  const namen =
    F === MERKMAL_NAMEN.length
      ? [...MERKMAL_NAMEN]
      : Array.from({ length: F }, (_, i) => `m${i}`);

  const positiv = y.reduce((s, v) => s + (v > 0.5 ? 1 : 0), 0);
  const anteil = n ? Math.min(1 - 1e-4, Math.max(1e-4, positiv / n)) : 0.5;
  const basis = Math.log(anteil / (1 - anteil));
  const modell: GbdtModell = {
    version: 0,
    merkmale: namen,
    basis,
    lernrate,
    baeume: [],
  };
  const wichtigkeit = new Array<number>(F).fill(0);
  if (n === 0 || F === 0) return { modell, wichtigkeit };

  // Stufen vorberechnen (zeilenweise: Stufe von Beispiel i, Merkmal f an i·F + f – ein Beispiel liegt zusammen im Speicher)
  const schwellen: number[][] = [];
  const zeilen = new Uint8Array(n * F);
  for (let f = 0; f < F; f++) {
    const s = schwellenBerechnen(X, f);
    schwellen.push(s);
    for (let i = 0; i < n; i++) {
      zeilen[i * F + f] = stufe(s, wert(X[i]![f]));
      if ((i & 32767) === 32767) await warte();
    }
    await warte();
  }

  const ziel = new Float64Array(n);
  for (let i = 0; i < n; i++) ziel[i] = y[i]! > 0.5 ? 1 : 0;
  const roh = new Float64Array(n).fill(basis);
  const G = new Float64Array(n);
  const H = new Float64Array(n);
  const S = STUFEN + 1;

  /** Histogramm (ΣG, ΣH, Anzahl je Merkmal und Stufe) eines Knotens */
  interface Histo {
    g: Float64Array;
    h: Float64Array;
    c: Float64Array;
  }
  const histogramm = async (idx: Uint32Array): Promise<Histo> => {
    const g = new Float64Array(F * S);
    const h = new Float64Array(F * S);
    const c = new Float64Array(F * S);
    for (let j = 0; j < idx.length; j++) {
      const i = idx[j]!;
      const gi = G[i]!;
      const hi = H[i]!;
      const basis = i * F;
      for (let f = 0; f < F; f++) {
        const o = f * S + zeilen[basis + f]!;
        g[o] = g[o]! + gi;
        h[o] = h[o]! + hi;
        c[o] = c[o]! + 1;
      }
      if ((j & 16383) === 16383) await warte();
    }
    return { g, h, c };
  };
  /** Histogramm-Abzug: Geschwister = Eltern − kleineres Kind (spart das Zählen der größeren Hälfte) */
  const abziehen = (e: Histo, k: Histo): Histo => {
    const g = new Float64Array(F * S);
    const h = new Float64Array(F * S);
    const c = new Float64Array(F * S);
    for (let o = 0; o < F * S; o++) {
      g[o] = e.g[o]! - k.g[o]!;
      h[o] = e.h[o]! - k.h[o]!;
      c[o] = e.c[o]! - k.c[o]!;
    }
    return { g, h, c };
  };

  const blatt = (idx: Uint32Array, sg: number, sh: number): GbdtKnoten => {
    const w = Math.max(-8, Math.min(8, -sg / (sh + LAMBDA)));
    const d = lernrate * w;
    for (let j = 0; j < idx.length; j++) roh[idx[j]!] = roh[idx[j]!]! + d;
    return { w };
  };
  const teilbar = (idx: Uint32Array, rest: number) =>
    rest > 0 && idx.length >= 2 * minBlatt;

  const bauen = async (
    idx: Uint32Array,
    rest: number,
    histo: Histo | null,
  ): Promise<GbdtKnoten> => {
    let sg = 0;
    let sh = 0;
    for (let j = 0; j < idx.length; j++) {
      sg += G[idx[j]!]!;
      sh += H[idx[j]!]!;
    }
    if (!teilbar(idx, rest) || !histo) return blatt(idx, sg, sh);
    const eltern = (sg * sg) / (sh + LAMBDA);
    let besterGain = 1e-9;
    let bestesF = -1;
    let besteStufe = -1;
    for (let f = 0; f < F; f++) {
      const anzahl = schwellen[f]!.length;
      let gl = 0;
      let hl = 0;
      let cl = 0;
      for (let k = 0; k < anzahl; k++) {
        const o = f * S + k;
        gl += histo.g[o]!;
        hl += histo.h[o]!;
        cl += histo.c[o]!;
        const cr = idx.length - cl;
        if (cl < minBlatt) continue;
        if (cr < minBlatt) break;
        const gr = sg - gl;
        const hr = sh - hl;
        const gain =
          (gl * gl) / (hl + LAMBDA) + (gr * gr) / (hr + LAMBDA) - eltern;
        if (gain > besterGain) {
          besterGain = gain;
          bestesF = f;
          besteStufe = k;
        }
      }
    }
    if (bestesF < 0) return blatt(idx, sg, sh);
    wichtigkeit[bestesF] = wichtigkeit[bestesF]! + besterGain;
    let links = 0;
    for (let j = 0; j < idx.length; j++)
      if (zeilen[idx[j]! * F + bestesF]! <= besteStufe) links++;
    const l = new Uint32Array(links);
    const r = new Uint32Array(idx.length - links);
    let a = 0;
    let c = 0;
    for (let j = 0; j < idx.length; j++) {
      const i = idx[j]!;
      if (zeilen[i * F + bestesF]! <= besteStufe) l[a++] = i;
      else r[c++] = i;
    }
    let hl: Histo | null = null;
    let hr: Histo | null = null;
    if (teilbar(l, rest - 1) || teilbar(r, rest - 1)) {
      if (l.length <= r.length) {
        hl = await histogramm(l);
        hr = abziehen(histo, hl);
      } else {
        hr = await histogramm(r);
        hl = abziehen(histo, hr);
      }
    }
    await warte();
    return {
      m: bestesF,
      s: schwellen[bestesF]![besteStufe]!,
      l: await bauen(l, rest - 1, hl),
      r: await bauen(r, rest - 1, hr),
    };
  };

  const alle = new Uint32Array(n);
  for (let i = 0; i < n; i++) alle[i] = i;
  for (let baum = 0; baum < anzahlBaeume; baum++) {
    for (let i = 0; i < n; i++) {
      const p = sigmoid(roh[i]!);
      G[i] = p - ziel[i]!;
      H[i] = Math.max(1e-6, p * (1 - p));
    }
    const wurzel = teilbar(alle, tiefe) ? await histogramm(alle) : null;
    await warte();
    modell.baeume.push(await bauen(alle, tiefe, wurzel));
    await warte(true);
  }
  const summe = wichtigkeit.reduce((s, w) => s + w, 0);
  return {
    modell,
    wichtigkeit: wichtigkeit.map((w) => (summe > 0 ? w / summe : 0)),
  };
}

/** Wahrscheinlichkeit (0–1) für ein Merkmal-Bündel */
export function gbdtVorhersagen(m: GbdtModell, x: number[]): number {
  let s = m.basis;
  for (const baum of m.baeume) {
    let k: GbdtKnoten = baum;
    while (k.w === undefined) {
      const naechster: GbdtKnoten | undefined =
        wert(x[k.m ?? 0]) <= (k.s ?? 0) ? k.l : k.r;
      if (!naechster) break;
      k = naechster;
    }
    s += m.lernrate * (k.w ?? 0);
  }
  return sigmoid(s);
}

/** Fläche unter der ROC-Kurve über Ränge (Gleichstände bekommen den mittleren Rang); 0,5 ohne beide Klassen */
export function auc(p: number[], y: number[]): number {
  const n = Math.min(p.length, y.length);
  const idx = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => p[a]! - p[b]!,
  );
  let pos = 0;
  let rangSumme = 0;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && p[idx[j + 1]!] === p[idx[i]!]) j++;
    const rang = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) {
      if (y[idx[k]!]! > 0.5) {
        pos++;
        rangSumme += rang;
      }
    }
    i = j + 1;
  }
  const neg = n - pos;
  if (pos === 0 || neg === 0) return 0.5;
  return (rangSumme - (pos * (pos + 1)) / 2) / (pos * neg);
}
