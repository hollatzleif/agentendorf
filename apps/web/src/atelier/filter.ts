/**
 * E198 Atelier: Rechnen auf Pixeln – reine Funktionen auf RGBA-Daten (Uint8ClampedArray), ohne DOM.
 * Alle Anpassungen lassen die Deckkraft (Alpha) unberührt; die Filter mit Nachbarschaft (Weichzeichnen, Schärfen)
 * rechnen mit vormultiplizierter Farbe, damit durchsichtige Ränder keine dunklen Säume bekommen.
 */
export type Pixel = Uint8ClampedArray;

const klemme = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Wendet eine Tabelle (256 Einträge) auf R, G und B an */
export function tabelleAnwenden(d: Pixel, t: Uint8ClampedArray | number[]) {
  for (let i = 0; i < d.length; i += 4) {
    d[i] = t[d[i]!]!;
    d[i + 1] = t[d[i + 1]!]!;
    d[i + 2] = t[d[i + 2]!]!;
  }
}

function tabelle(f: (v: number) => number) {
  const t = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) t[i] = klemme(Math.round(f(i)));
  return t;
}

/** Helligkeit und Kontrast, je −100 … 100 */
export function helligkeitKontrast(d: Pixel, helligkeit: number, kontrast: number) {
  const h = (helligkeit / 100) * 127;
  const k = kontrast >= 0 ? 1 + (kontrast / 100) * 2 : 1 + kontrast / 100;
  tabelleAnwenden(d, tabelle((v) => (v - 128) * k + 128 + h));
}

/** Belichtung in Blendenstufen (−3 … 3) und Gamma (0,2 … 3) */
export function belichtung(d: Pixel, stufen: number, gamma: number) {
  const f = 2 ** stufen;
  const g = 1 / Math.max(0.05, gamma);
  tabelleAnwenden(d, tabelle((v) => 255 * Math.min(1, (v / 255) * f) ** g));
}

/** „Kurven light“: Tiefen, Mitten, Lichter je −100 … 100 – eine glatte Kurve durch fünf Punkte */
export function kurvenTabelle(tiefen: number, mitten: number, lichter: number) {
  const xs = [0, 64, 128, 192, 255];
  const ys = [0, klemme(64 + tiefen * 0.6), klemme(128 + mitten * 0.6), klemme(192 + lichter * 0.6), 255];
  // monotone kubische Interpolation (Fritsch–Carlson): schwingt nicht über
  const n = xs.length;
  const steig: number[] = [];
  for (let i = 0; i < n - 1; i++) steig.push((ys[i + 1]! - ys[i]!) / (xs[i + 1]! - xs[i]!));
  const m: number[] = [steig[0]!];
  for (let i = 1; i < n - 1; i++) m.push(steig[i - 1]! * steig[i]! <= 0 ? 0 : (steig[i - 1]! + steig[i]!) / 2);
  m.push(steig[n - 2]!);
  for (let i = 0; i < n - 1; i++) {
    if (steig[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / steig[i]!;
    const b = m[i + 1]! / steig[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * steig[i]!;
      m[i + 1] = t * b * steig[i]!;
    }
  }
  return tabelle((v) => {
    let i = 0;
    while (i < n - 2 && v > xs[i + 1]!) i++;
    const h = xs[i + 1]! - xs[i]!;
    const t = (v - xs[i]!) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i]! + (t3 - 2 * t2 + t) * h * m[i]! + (-2 * t3 + 3 * t2) * ys[i + 1]! + (t3 - t2) * h * m[i + 1]!;
  });
}
export function kurven(d: Pixel, tiefen: number, mitten: number, lichter: number) {
  tabelleAnwenden(d, kurvenTabelle(tiefen, mitten, lichter));
}

export function invertieren(d: Pixel) {
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i]!;
    d[i + 1] = 255 - d[i + 1]!;
    d[i + 2] = 255 - d[i + 2]!;
  }
}

/** Graustufen nach wahrgenommener Helligkeit (Rec. 601) */
export function graustufen(d: Pixel) {
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.round(0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!);
    d[i] = d[i + 1] = d[i + 2] = g;
  }
}

export function sepia(d: Pixel, staerke: number) {
  const s = staerke / 100;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i]!;
    const g = d[i + 1]!;
    const b = d[i + 2]!;
    d[i] = r + (0.393 * r + 0.769 * g + 0.189 * b - r) * s;
    d[i + 1] = g + (0.349 * r + 0.686 * g + 0.168 * b - g) * s;
    d[i + 2] = b + (0.272 * r + 0.534 * g + 0.131 * b - b) * s;
  }
}

export function schwellenwert(d: Pixel, schwelle: number) {
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]! >= schwelle ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
}

export function rgbZuHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const diff = max - min;
  const s = l > 0.5 ? diff / (2 - max - min) : diff / (max + min);
  let h = max === r ? (g - b) / diff + (g < b ? 6 : 0) : max === g ? (b - r) / diff + 2 : (r - g) / diff + 4;
  h /= 6;
  return [h, s, l];
}
function farbanteil(p: number, q: number, t: number) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
export function hslZuRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [farbanteil(p, q, h + 1 / 3) * 255, farbanteil(p, q, h) * 255, farbanteil(p, q, h - 1 / 3) * 255];
}

/** Farbton (−180 … 180 Grad), Sättigung und Helligkeit (je −100 … 100) */
export function farbtonSaettigung(d: Pixel, farbton: number, saettigung: number, helligkeit: number) {
  const dh = farbton / 360;
  const fs = saettigung >= 0 ? 1 + saettigung / 50 : 1 + saettigung / 100;
  const dl = helligkeit / 100;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    let [h, s, l] = rgbZuHsl(d[i]!, d[i + 1]!, d[i + 2]!);
    h = (h + dh + 1) % 1;
    s = Math.min(1, Math.max(0, s * fs));
    l = dl >= 0 ? l + (1 - l) * dl : l + l * dl;
    const [r, g, b] = hslZuRgb(h, s, l);
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
}

/** Kastenfilter in einer Richtung auf Float-Daten (4 Kanäle) – Baustein für den Weichzeichner */
function kasten(quelle: Float32Array, ziel: Float32Array, b: number, h: number, r: number, waagrecht: boolean) {
  const n = waagrecht ? b : h;
  const m = waagrecht ? h : b;
  const schritt = waagrecht ? 4 : b * 4;
  const teiler = 2 * r + 1;
  for (let j = 0; j < m; j++) {
    const start = waagrecht ? j * b * 4 : j * 4;
    for (let k = 0; k < 4; k++) {
      let summe = 0;
      // Rand wird fortgesetzt (erste/letzte Zeile bzw. Spalte wiederholt)
      for (let i = -r; i <= r; i++) summe += quelle[start + Math.min(n - 1, Math.max(0, i)) * schritt + k]!;
      for (let i = 0; i < n; i++) {
        ziel[start + i * schritt + k] = summe / teiler;
        const raus = Math.max(0, i - r);
        const rein = Math.min(n - 1, i + r + 1);
        summe += quelle[start + rein * schritt + k]! - quelle[start + raus * schritt + k]!;
      }
    }
  }
}

/** Gaußscher Weichzeichner (drei Kastenfilter hintereinander – praktisch nicht von Gauß zu unterscheiden) */
export function weichzeichnen(d: Pixel, b: number, h: number, radius: number) {
  if (radius <= 0 || b < 1 || h < 1) return;
  const a = new Float32Array(d.length);
  const c = new Float32Array(d.length);
  for (let i = 0; i < d.length; i += 4) {
    const al = d[i + 3]! / 255;
    a[i] = d[i]! * al;
    a[i + 1] = d[i + 1]! * al;
    a[i + 2] = d[i + 2]! * al;
    a[i + 3] = d[i + 3]!;
  }
  // Kastenbreiten für drei Durchgänge mit Standardabweichung ≈ radius
  const sigma = radius;
  const ideal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  let wl = Math.floor(ideal);
  if (wl % 2 === 0) wl--;
  const mAnzahl = Math.round((12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4));
  for (let p = 0; p < 3; p++) {
    const r = Math.max(0, ((p < mAnzahl ? wl : wl + 2) - 1) / 2);
    if (r === 0) continue;
    kasten(a, c, b, h, r, true);
    kasten(c, a, b, h, r, false);
  }
  for (let i = 0; i < d.length; i += 4) {
    const al = a[i + 3]!;
    if (al < 0.5) {
      d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
      continue;
    }
    const f = 255 / al;
    d[i] = a[i]! * f;
    d[i + 1] = a[i + 1]! * f;
    d[i + 2] = a[i + 2]! * f;
    d[i + 3] = al;
  }
}

/** Unscharf maskieren: Stärke in Prozent (0 … 300), Radius in Pixeln */
export function schaerfen(d: Pixel, b: number, h: number, staerke: number, radius: number) {
  if (staerke <= 0) return;
  const weich = new Uint8ClampedArray(d);
  weichzeichnen(weich, b, h, radius);
  const f = staerke / 100;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = d[i]! + (d[i]! - weich[i]!) * f;
    d[i + 1] = d[i + 1]! + (d[i + 1]! - weich[i + 1]!) * f;
    d[i + 2] = d[i + 2]! + (d[i + 2]! - weich[i + 2]!) * f;
  }
}

/** Rauschen hinzufügen: Menge 0 … 100; einfarbig = gleiches Rauschen auf allen Kanälen. Mit Startwert wiederholbar. */
export function rauschen(d: Pixel, menge: number, einfarbig: boolean, start = 1) {
  let s = start >>> 0 || 1;
  const zufall = () => {
    // xorshift32 – schnell und für Bildrauschen gut genug
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
  const a = (menge / 100) * 128;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    if (einfarbig) {
      const n = zufall() * a;
      d[i] = d[i]! + n;
      d[i + 1] = d[i + 1]! + n;
      d[i + 2] = d[i + 2]! + n;
    } else {
      d[i] = d[i]! + zufall() * a;
      d[i + 1] = d[i + 1]! + zufall() * a;
      d[i + 2] = d[i + 2]! + zufall() * a;
    }
  }
}

/**
 * Zauberstab / Fülleimer: Maske (0/255) aller Pixel, die der Farbe am Startpunkt ähneln (Toleranz 0 … 255, größter
 * Abstand eines Kanals inkl. Alpha). zusammenhaengend = nur die Fläche, die den Startpunkt berührt (Zeilen-Füllung).
 */
export function flutMaske(d: Pixel, b: number, h: number, x: number, y: number, toleranz: number, zusammenhaengend: boolean) {
  const maske = new Uint8Array(b * h);
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= b || y >= h) return maske;
  const o = (y * b + x) * 4;
  const r0 = d[o]!;
  const g0 = d[o + 1]!;
  const b0 = d[o + 2]!;
  const a0 = d[o + 3]!;
  const passt = (i: number) => {
    const p = i * 4;
    const a = d[p + 3]!;
    // ganz durchsichtige Pixel haben keine Farbe: nur die Deckkraft zählt
    if (a0 === 0 || a === 0) return Math.abs(a - a0) <= toleranz;
    return Math.abs(d[p]! - r0) <= toleranz && Math.abs(d[p + 1]! - g0) <= toleranz && Math.abs(d[p + 2]! - b0) <= toleranz && Math.abs(a - a0) <= toleranz;
  };
  if (!zusammenhaengend) {
    for (let i = 0; i < b * h; i++) if (passt(i)) maske[i] = 255;
    return maske;
  }
  const stapel: number[] = [x, y];
  while (stapel.length) {
    const sy = stapel.pop()!;
    let sx = stapel.pop()!;
    let i = sy * b + sx;
    if (maske[i] || !passt(i)) continue;
    while (sx > 0 && !maske[i - 1] && passt(i - 1)) {
      sx--;
      i--;
    }
    let oben = false;
    let unten = false;
    for (; sx < b && !maske[i] && passt(i); sx++, i++) {
      maske[i] = 255;
      if (sy > 0) {
        const frei = !maske[i - b] && passt(i - b);
        if (frei && !oben) stapel.push(sx, sy - 1);
        oben = frei;
      }
      if (sy < h - 1) {
        const frei = !maske[i + b] && passt(i + b);
        if (frei && !unten) stapel.push(sx, sy + 1);
        unten = frei;
      }
    }
  }
  return maske;
}

/** Kleinstes Rechteck um alles, was (teil)deckend ist; null, wenn nichts da ist */
export function deckendeGrenzen(d: Pixel, b: number, h: number, schwelle = 0): { x: number; y: number; b: number; h: number } | null {
  let x0 = b;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    let o = y * b * 4 + 3;
    for (let x = 0; x < b; x++, o += 4) {
      if (d[o]! > schwelle) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, b: x1 - x0 + 1, h: y1 - y0 + 1 };
}
