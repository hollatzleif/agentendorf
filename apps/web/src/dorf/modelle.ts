import * as THREE from 'three';
import { GRUNDSTUECK, type DekoArt, type Gebaeude } from '@dorf/shared';
import {
  Bausatz,
  canvasTextur,
  giebel,
  halbkugel,
  ikosaeder,
  kasten,
  kegel,
  kugel,
  material,
  pyramide,
  quader,
  scheibe,
  torus,
  zufallAus,
  zylinder,
} from './bausatz';
import { jahreszeit, laubFarben, nadelFarben } from './jahreszeit';

// Laub und Nadeln je Jahreszeit (beim Laden der Seite bestimmt)
const LAUB = laubFarben();
const NADEL = nadelFarben();

/** Kantenlänge eines Feldes in Welt-Einheiten */
export const FELD = 1.25;
export const PLATZ = GRUNDSTUECK * FELD;
/** Oberkante Rasen/Pflaster auf einem Grundstück */
export const BODEN = 0.18;

const F = {
  rahmen: '#fdf8ec',
  stein: '#c9c2b4',
  steinDunkel: '#a39b8c',
  glas: '#6e9fd1',
  dunkel: '#2b3a55',
  holz: '#8a5a32',
  holzDunkel: '#5a3a24',
  gold: '#f2c14e',
  // im Winter liegt auch auf den Rasenflächen Schnee
  rasen: jahreszeit() === 'winter' ? '#e4ece6' : '#7cc84a',
  rasenDunkel: jahreszeit() === 'winter' ? '#d6e2da' : '#6bb83e',
  gehweg: '#dcd8cf',
  bordstein: '#b9b3a8',
  erde: '#8b6340',
  blumen: ['#ff6b8a', '#ffd23d', '#ffffff', '#b07cff', '#ff8c42'],
};

export interface Modell {
  gruppe: THREE.Group;
  /** Lampen (lokal) für den nächtlichen Lichtschein */
  lichter: { pos: THREE.Vector3; groesse: number }[];
  /** Austrittspunkte für Rauch (lokal) */
  rauch: THREE.Vector3[];
  /** Höhe für Statusblasen */
  hoehe: number;
}

// ---- Bauteile -------------------------------------------------------------------------------------

function grundstueck(b: Bausatz, belag: 'rasen' | 'pflaster' | 'erde' = 'rasen') {
  b.teil(kasten(PLATZ, 0.14, PLATZ, 0.05), F.bordstein, 0, 0.07, 0);
  b.teil(kasten(PLATZ - 0.1, 0.16, PLATZ - 0.1, 0.04), F.gehweg, 0, 0.08, 0);
  // Fugen im Gehweg
  for (let i = -3; i <= 3; i++) {
    const t = i * 0.68;
    b.teil(quader(0.02, 0.005, 0.28), '#c8c3b8', t, 0.162, PLATZ / 2 - 0.19, { keinSchatten: true });
    b.teil(quader(0.02, 0.005, 0.28), '#c8c3b8', t, 0.162, -PLATZ / 2 + 0.19, { keinSchatten: true });
    b.teil(quader(0.28, 0.005, 0.02), '#c8c3b8', PLATZ / 2 - 0.19, 0.162, t, { keinSchatten: true });
    b.teil(quader(0.28, 0.005, 0.02), '#c8c3b8', -PLATZ / 2 + 0.19, 0.162, t, { keinSchatten: true });
  }
  const innen = PLATZ - 0.7;
  if (belag === 'rasen') {
    b.teil(kasten(innen + 0.08, 0.17, innen + 0.08, 0.03), F.bordstein, 0, 0.085, 0);
    b.teil(kasten(innen, 0.19, innen, 0.05), F.rasen, 0, 0.09, 0);
  } else if (belag === 'erde') {
    b.teil(kasten(innen, 0.17, innen, 0.03), '#b88a5a', 0, 0.085, 0);
  } else {
    // Kopfsteinpflaster aus einzelnen Platten
    b.teil(kasten(innen, 0.16, innen, 0.03), '#cdbf9c', 0, 0.08, 0);
    const n = 9;
    const s = innen / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        b.teil(kasten(s - 0.04, 0.03, s - 0.04, 0.012), (i + j) % 3 === 0 ? '#e3d3a8' : (i * 7 + j) % 4 === 0 ? '#d6c49a' : '#ebdcb4', -innen / 2 + s * (i + 0.5), 0.17, -innen / 2 + s * (j + 0.5), { keinSchatten: true });
  }
}

interface FensterOpt {
  w?: number;
  h?: number;
  laden?: string;
  kasten?: boolean;
  licht?: boolean;
  gitter?: boolean;
  sprossen?: boolean;
  rahmen?: string;
}
/** Fenster auf einer Wand, Blick nach +z (lokal) */
function fenster(b: Bausatz, x: number, y: number, z: number, ry: number, o: FensterOpt = {}) {
  const w = o.w ?? 0.4;
  const h = o.h ?? 0.55;
  const r = o.rahmen ?? F.rahmen;
  b.mit(x, y, z, ry, () => {
    b.teil(kasten(w + 0.09, h + 0.09, 0.06, 0.02), r, 0, 0, 0.01);
    b.teil(quader(w - 0.02, h - 0.02, 0.02), o.licht ? '#ffd86b' : F.glas, 0, 0, 0.035, o.licht ? { leuchten: '#ffb627' } : { glanz: true });
    if (o.sprossen !== false) {
      b.teil(quader(0.03, h - 0.02, 0.03), r, 0, 0, 0.045);
      b.teil(quader(w - 0.02, 0.03, 0.03), r, 0, h * 0.12, 0.045);
    }
    if (o.gitter) for (let i = -2; i <= 2; i++) b.teil(quader(0.018, h, 0.02), F.dunkel, (i * w) / 6, 0, 0.06);
    b.teil(kasten(w + 0.18, 0.05, 0.13, 0.015), r, 0, -h / 2 - 0.06, 0.06); // Fensterbank
    b.teil(kasten(w + 0.14, 0.06, 0.07, 0.015), F.stein, 0, h / 2 + 0.07, 0.03); // Sturz
    if (o.laden) {
      for (const s of [-1, 1]) {
        b.teil(kasten(w / 2 + 0.02, h + 0.04, 0.035, 0.012), o.laden, s * (w / 2 + w / 4 + 0.07), 0, 0.03);
        for (let k = -2; k <= 2; k++) b.teil(quader(w / 2 - 0.04, 0.012, 0.01), dunkler(o.laden, 0.08), s * (w / 2 + w / 4 + 0.07), (k * h) / 6, 0.05, { sy: 1 });
      }
    }
    if (o.kasten) {
      b.teil(kasten(w + 0.08, 0.1, 0.13, 0.02), F.holz, 0, -h / 2 - 0.15, 0.1);
      for (let k = 0; k < 5; k++) b.teil(kugel(0.045, 6, 5), F.blumen[k % F.blumen.length]!, -w / 2 + 0.06 + (k * (w - 0.08)) / 4, -h / 2 - 0.07, 0.1);
      b.teil(ikosaeder(0.07, 0), F.rasenDunkel, 0, -h / 2 - 0.09, 0.12, { flach: true, sx: w * 5, sy: 0.6 });
    }
  });
}

interface TuerOpt {
  w?: number;
  h?: number;
  vordach?: string;
  lampen?: boolean;
  glas?: boolean;
  stufen?: number;
}
/** Tür am Boden, Blick nach +z */
function tuer(b: Bausatz, x: number, z: number, ry: number, farbe: string, o: TuerOpt = {}) {
  const w = o.w ?? 0.52;
  const h = o.h ?? 0.88;
  b.mit(x, BODEN, z, ry, () => {
    b.teil(kasten(w + 0.16, h + 0.1, 0.07, 0.02), F.rahmen, 0, (h + 0.1) / 2, 0.01);
    if (o.glas) {
      b.teil(quader(w, h, 0.03), F.glas, 0, h / 2, 0.04, { glanz: true });
      b.teil(quader(0.03, h, 0.04), F.dunkel, 0, h / 2, 0.05);
    } else {
      b.teil(kasten(w, h, 0.06, 0.015), farbe, 0, h / 2, 0.04);
      for (const [px, py] of [[-1, 0.27], [1, 0.27], [-1, 0.68], [1, 0.68]] as const)
        b.teil(kasten(w * 0.34, h * 0.3, 0.02, 0.01), farbe, (px * w) / 4.4, h * py, 0.075, { sx: 1 });
      b.teil(quader(w * 0.7, 0.12, 0.02), F.glas, 0, h - 0.1, 0.075, { glanz: true });
      b.teil(kugel(0.03, 8, 6), F.gold, w / 2 - 0.08, h * 0.48, 0.09, { metall: true });
    }
    const stufen = o.stufen ?? 1;
    for (let i = 0; i < stufen; i++) b.teil(kasten(w + 0.42 + i * 0.14, 0.07, 0.24 + i * 0.12, 0.02), F.stein, 0, 0.035 - i * 0.07 + (stufen - 1) * 0.07, 0.14 + i * 0.07);
    if (o.vordach) {
      b.teil(kasten(w + 0.5, 0.05, 0.45, 0.02), o.vordach, 0, h + 0.2, 0.22, { rx: 0.18 });
      for (const s of [-1, 1]) b.teil(quader(0.03, 0.18, 0.03), F.dunkel, s * (w / 2 + 0.2), h + 0.1, 0.4);
    }
    if (o.lampen)
      for (const s of [-1, 1]) {
        b.teil(quader(0.04, 0.04, 0.12), F.dunkel, s * (w / 2 + 0.2), h * 0.78, 0.06);
        b.teil(kasten(0.1, 0.14, 0.1, 0.02), '#ffe39a', s * (w / 2 + 0.2), h * 0.78, 0.13, { leuchten: '#ffcc55' });
        b.licht(s * (w / 2 + 0.2), h * 0.78, 0.2, 1.2);
        b.teil(pyramide(0.14, 0.06), F.dunkel, s * (w / 2 + 0.2), h * 0.78 + 0.1, 0.13);
      }
  });
}

/** Wand mit Sockel und Gesims; Unterkante auf BODEN */
function wand(b: Bausatz, w: number, h: number, d: number, farbe: string, o: { sockel?: string; gesims?: string } = {}) {
  b.teil(kasten(w, h, d, 0.05), farbe, 0, BODEN + h / 2, 0);
  b.teil(kasten(w + 0.08, 0.22, d + 0.08, 0.03), o.sockel ?? F.steinDunkel, 0, BODEN + 0.11, 0);
  b.teil(kasten(w + 0.12, 0.08, d + 0.12, 0.02), o.gesims ?? F.rahmen, 0, BODEN + h - 0.02, 0);
}

function eckquader(b: Bausatz, w: number, d: number, h: number, farbe = F.rahmen) {
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      for (let y = 0.3, i = 0; y < h - 0.15; y += 0.27, i++) {
        const lang = i % 2 === 0;
        b.teil(kasten(lang ? 0.2 : 0.12, 0.13, lang ? 0.12 : 0.2, 0.015), farbe, sx * (w / 2 - (lang ? 0.08 : 0.04)) + sx * 0.012, BODEN + y, sz * (d / 2 - (lang ? 0.04 : 0.08)) + sz * 0.012);
      }
}

function dunkler(farbe: string, l = 0.06) {
  return '#' + new THREE.Color(farbe).offsetHSL(0, 0, -l).getHexString();
}

/** Satteldach aus einzelnen Ziegelreihen; First entlang x. Reihen heißen 'dach' (zum Umfärben). */
function satteldach(b: Bausatz, w: number, d: number, h: number, y: number, farbe: string, o: { ueberstand?: number; giebelFarbe?: string } = {}) {
  const u = o.ueberstand ?? 0.2;
  const D = d / 2 + u;
  const L = Math.hypot(D, h);
  const a = Math.atan2(h, D);
  const n = Math.max(4, Math.round(L / 0.2));
  const dunkel = dunkler(farbe, 0.07);
  for (const s of [-1, 1])
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * (L / n);
      b.teil(kasten(w + 2 * u, 0.075, L / n + 0.05, 0.02), i % 2 ? farbe : dunkel, 0, y + h - t * Math.sin(a) + 0.03, s * t * Math.cos(a), {
        rx: s * a,
        name: i % 2 ? 'dach' : 'dach2',
      });
    }
  b.teil(kasten(w + 2 * u + 0.06, 0.1, 0.16, 0.04), dunkler(farbe, 0.09), 0, y + h + 0.04, 0, { name: 'dach2' });
  for (const sx of [-1, 1]) b.teil(giebel(d, h, 0.08), o.giebelFarbe ?? F.rahmen, sx * (w / 2 - 0.04), y, 0, { ry: Math.PI / 2 });
  for (const s of [-1, 1]) b.teil(kasten(w + 2 * u, 0.06, 0.08, 0.02), F.rahmen, 0, y - 0.02, s * D); // Traufe
  return { D, a, L };
}

/** Gaube auf der Vorderseite eines Satteldachs */
function gaube(b: Bausatz, x: number, y: number, z: number, wandFarbe: string, dachFarbe: string) {
  b.mit(x, y, z, 0, () => {
    b.teil(kasten(0.5, 0.5, 0.6, 0.03), wandFarbe, 0, 0.25, -0.1);
    b.teil(giebel(0.66, 0.3, 0.7), dachFarbe, 0, 0.5, -0.1, { name: 'dach' });
    b.teil(giebel(0.5, 0.24, 0.02), F.rahmen, 0, 0.5, 0.21);
  });
  fenster(b, x, y + 0.25, z + 0.2, 0, { w: 0.28, h: 0.3 });
}

function schornstein(b: Bausatz, x: number, y: number, z: number, h = 0.8): THREE.Vector3 {
  b.teil(kasten(0.3, h, 0.3, 0.03), '#a5533a', x, y + h / 2, z);
  for (let k = 0.15; k < h - 0.1; k += 0.18) b.teil(quader(0.31, 0.012, 0.31), '#8c4430', x, y + k, z, { keinSchatten: true });
  b.teil(kasten(0.38, 0.08, 0.38, 0.02), '#7d3b28', x, y + h + 0.02, z);
  return new THREE.Vector3(x, y + h + 0.1, z);
}

const tafelMaterialien = new Map<string, THREE.MeshStandardMaterial>();
/** Schild mit Schrift (eigene Textur) */
function tafel(b: Bausatz, text: string, x: number, y: number, z: number, ry: number, w: number, h: number, o: { grund?: string; schrift?: string; rahmen?: string } = {}) {
  const k = `${text}|${w}|${h}|${o.grund}|${o.schrift}`;
  let m = tafelMaterialien.get(k);
  if (!m) {
    const px = 512;
    const ph = Math.max(32, Math.round((px * h) / w));
    m = new THREE.MeshStandardMaterial({
      roughness: 0.6,
      map: canvasTextur(px, ph, (c) => {
        c.fillStyle = o.grund ?? F.dunkel;
        c.fillRect(0, 0, px, ph);
        c.fillStyle = o.schrift ?? '#ffffff';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        let groesse = ph * 0.72;
        c.font = `800 ${groesse}px system-ui, sans-serif`;
        while (c.measureText(text).width > px * 0.9 && groesse > 8) c.font = `800 ${(groesse -= 2)}px system-ui, sans-serif`;
        c.fillText(text, px / 2, ph / 2 + ph * 0.04);
      }),
    });
    tafelMaterialien.set(k, m);
  }
  b.mit(x, y, z, ry, () => {
    b.teil(kasten(w + 0.06, h + 0.06, 0.04, 0.015), o.rahmen ?? F.gold, 0, 0, 0);
    b.teil(quader(w, h, 0.01), m!, 0, 0, 0.026, { keinSchatten: true });
  });
}

function saeule(b: Bausatz, x: number, z: number, h: number, y0 = BODEN, farbe = '#fffaf0') {
  b.teil(kasten(0.26, 0.08, 0.26, 0.02), farbe, x, y0 + 0.04, z);
  b.teil(zylinder(0.095, 0.11, h - 0.16, 12), farbe, x, y0 + h / 2, z);
  b.teil(kasten(0.27, 0.08, 0.27, 0.02), farbe, x, y0 + h - 0.04, z);
}

// ---- Deko (auch auf Grundstücken genutzt) --------------------------------------------------------

export function baum(b: Bausatz, x: number, z: number, s = 1, rnd = Math.random, y0 = BODEN) {
  b.mit(x, y0, z, rnd() * 6, () => {
    b.teil(zylinder(0.07, 0.11, 0.6, 7), '#7a4a28', 0, 0.3, 0);
    const kronen: [number, number, number, number][] = [[0, 0.85, 0, 0.42], [0.2, 0.72, 0.08, 0.3], [-0.18, 0.76, -0.07, 0.32], [0.02, 1.12, 0.02, 0.28], [-0.05, 0.7, 0.2, 0.26]];
    for (const [dx, dy, dz, r] of kronen) b.teil(ikosaeder(r, 1), LAUB[Math.floor(rnd() * LAUB.length)]!, dx, dy, dz, { flach: true });
  }, s);
}
export function tanne(b: Bausatz, x: number, z: number, s = 1, y0 = BODEN) {
  b.mit(x, y0, z, 0, () => {
    b.teil(zylinder(0.07, 0.09, 0.35, 7), '#7a4a28', 0, 0.17, 0);
    [[0.46, 0.5], [0.37, 0.85], [0.26, 1.15], [0.15, 1.38]].forEach(([r, y], i) =>
      b.teil(kegel(r!, 0.5, 8), i >= 2 ? NADEL.oben[i % NADEL.oben.length]! : NADEL.unten[i % NADEL.unten.length]!, 0, y!, 0, { flach: true }),
    );
  }, s);
}
export function busch(b: Bausatz, x: number, z: number, s = 1, rnd = Math.random, y0 = BODEN) {
  b.mit(x, y0, z, rnd() * 6, () => {
    b.teil(ikosaeder(0.22, 1), '#5dbb4a', 0, 0.16, 0, { flach: true });
    b.teil(ikosaeder(0.17, 1), '#4fae3f', 0.17, 0.12, 0.06, { flach: true });
    b.teil(ikosaeder(0.15, 1), '#66c450', -0.14, 0.11, -0.05, { flach: true });
    if (rnd() < 0.5) for (let i = 0; i < 4; i++) b.teil(kugel(0.035, 6, 4), F.blumen[i]!, Math.cos(i * 1.7) * 0.18, 0.28, Math.sin(i * 1.7) * 0.15);
  }, s);
}
export function laterne(b: Bausatz, x: number, z: number, y0 = BODEN) {
  b.mit(x, y0, z, 0, () => {
    b.teil(zylinder(0.07, 0.09, 0.12, 8), F.dunkel, 0, 0.06, 0);
    b.teil(zylinder(0.03, 0.04, 1.15, 8), F.dunkel, 0, 0.6, 0);
    b.teil(kasten(0.16, 0.2, 0.16, 0.03), '#ffe39a', 0, 1.25, 0, { leuchten: '#ffcc55' });
    b.licht(0, 1.25, 0);
    b.teil(pyramide(0.24, 0.12), F.dunkel, 0, 1.41, 0);
    b.teil(kugel(0.025, 6, 4), F.dunkel, 0, 1.48, 0);
  });
}
export function parkbank(b: Bausatz, x: number, z: number, ry: number, y0 = BODEN) {
  b.mit(x, y0, z, ry, () => {
    for (const s of [-1, 1]) {
      b.teil(quader(0.04, 0.22, 0.24), F.dunkel, s * 0.32, 0.11, 0);
      b.teil(quader(0.04, 0.3, 0.04), F.dunkel, s * 0.32, 0.33, -0.1);
    }
    for (let i = 0; i < 3; i++) b.teil(kasten(0.8, 0.035, 0.07, 0.01), F.holz, 0, 0.23, -0.08 + i * 0.08);
    for (let i = 0; i < 2; i++) b.teil(kasten(0.8, 0.07, 0.03, 0.01), F.holz, 0, 0.36 + i * 0.1, -0.12, { rx: -0.15 });
  });
}
function blumenbeet(b: Bausatz, x: number, z: number, w: number, d: number, rnd = Math.random, y0 = BODEN) {
  b.teil(kasten(w, 0.1, d, 0.03), F.steinDunkel, x, y0 + 0.05, z);
  b.teil(kasten(w - 0.08, 0.1, d - 0.08, 0.02), F.erde, x, y0 + 0.07, z);
  const n = Math.round(w * d * 40);
  for (let i = 0; i < n; i++) {
    const px = x + (rnd() - 0.5) * (w - 0.15);
    const pz = z + (rnd() - 0.5) * (d - 0.15);
    b.teil(quader(0.012, 0.1, 0.012), '#3f8f3a', px, y0 + 0.16, pz, { keinSchatten: true });
    b.teil(kugel(0.04, 6, 4), F.blumen[Math.floor(rnd() * F.blumen.length)]!, px, y0 + 0.22, pz);
  }
}
function hecke(b: Bausatz, x: number, z: number, lang: number, ry: number, y0 = BODEN) {
  b.mit(x, y0, z, ry, () => {
    b.teil(kasten(lang, 0.42, 0.34, 0.12), '#4a9e3c', 0, 0.21, 0, { flach: true });
    for (let i = 0; i < Math.round(lang / 0.3); i++) b.teil(ikosaeder(0.13, 0), i % 2 ? '#56ad45' : '#4a9e3c', -lang / 2 + 0.15 + i * 0.3, 0.42, 0, { flach: true });
  });
}
function kiste(b: Bausatz, x: number, z: number, s = 1, y0 = BODEN, inhalt?: string) {
  b.mit(x, y0, z, 0.3 * s, () => {
    b.teil(kasten(0.3, 0.22, 0.3, 0.02), '#c58a4a', 0, 0.11, 0);
    b.teil(quader(0.31, 0.03, 0.31), '#a8703a', 0, 0.2, 0);
    if (inhalt) for (let i = 0; i < 4; i++) b.teil(kugel(0.06, 7, 5), inhalt, -0.07 + (i % 2) * 0.14, 0.24, -0.07 + Math.floor(i / 2) * 0.14);
  });
}

// ---- Gebäude ------------------------------------------------------------------------------------

type Bauer = (b: Bausatz, g: Gebaeude, rnd: () => number) => { rauch: THREE.Vector3[]; hoehe: number };

const rathaus: Bauer = (b, _g, rnd) => {
  grundstueck(b);
  const wf = '#f6e7c8';
  const dach = '#3b6fd8';
  const laden = '#2e5aa8';
  const rauch: THREE.Vector3[] = [];
  b.teil(kasten(1.9, 0.03, 1.3, 0.02), '#e3dccd', 0, BODEN + 0.015, 1.55);
  b.mit(0, 0, -0.45, 0, () => {
    wand(b, 3.6, 2.1, 2.2, wf);
    eckquader(b, 3.6, 2.2, 2.1);
    b.teil(kasten(3.66, 0.07, 2.26, 0.02), F.rahmen, 0, BODEN + 1.05, 0);
    for (const fy of [0.6, 1.55])
      for (const fx of [-1.35, -0.8, 0.8, 1.35]) fenster(b, fx, BODEN + fy, 1.1, 0, { laden, kasten: fy > 1 });
    for (const fx of [-1.25, -0.42, 0.42, 1.25]) for (const fy of [0.6, 1.55]) fenster(b, fx, BODEN + fy, -1.1, Math.PI);
    for (const s of [-1, 1]) for (const fz of [-0.45, 0.45]) for (const fy of [0.6, 1.55]) fenster(b, s * 1.8, BODEN + fy, fz, (s * Math.PI) / 2, { laden });
    // Mittelrisalit mit Giebel, Balkon und Tür
    b.teil(kasten(1.2, 2.25, 0.3, 0.03), '#fbefd6', 0, BODEN + 1.125, 1.2);
    b.teil(giebel(1.45, 0.5, 0.34), '#fbefd6', 0, BODEN + 2.25, 1.2);
    b.teil(kasten(1.5, 0.07, 0.38, 0.02), F.rahmen, 0, BODEN + 2.25, 1.2);
    b.teil(kugel(0.12, 12, 8), F.gold, 0, BODEN + 2.5, 1.38, { metall: true, sz: 0.4 });
    fenster(b, 0, BODEN + 1.6, 1.35, 0, { w: 0.46, h: 0.62 });
    b.teil(kasten(0.95, 0.06, 0.38, 0.02), F.stein, 0, BODEN + 1.18, 1.52);
    for (let i = -4; i <= 4; i++) b.teil(zylinder(0.015, 0.015, 0.24, 5), F.dunkel, i * 0.1, BODEN + 1.32, 1.69);
    b.teil(quader(0.94, 0.025, 0.025), F.dunkel, 0, BODEN + 1.44, 1.69);
    tuer(b, 0, 1.35, 0, '#7a3b22', { lampen: true, stufen: 2 });
    const d = satteldach(b, 3.6, 2.2, 1.1, BODEN + 2.1, dach);
    for (const gx of [-1.1, 1.1]) gaube(b, gx, BODEN + 2.1 + 0.25, 0.75, wf, dach);
    void d;
    rauch.push(schornstein(b, 1.25, BODEN + 2.5, -0.5));
    // Uhrturm
    b.mit(0, 0, -0.85, 0, () => {
      b.teil(kasten(1.0, 3.75, 1.0, 0.05), '#efdcb8', 0, BODEN + 1.875, 0);
      eckquader(b, 1.0, 1.0, 3.75);
      b.teil(kasten(1.08, 0.08, 1.08, 0.02), F.rahmen, 0, BODEN + 3.0, 0);
      b.teil(kasten(1.12, 0.1, 1.12, 0.02), F.rahmen, 0, BODEN + 3.75, 0);
      for (let k = 0; k < 4; k++) {
        const ry = (k * Math.PI) / 2;
        b.mit(0, 0, 0, ry, () => {
          b.teil(zylinder(0.3, 0.3, 0.05, 24), '#ffffff', 0, BODEN + 3.38, 0.51, { rx: Math.PI / 2 });
          b.teil(torus(0.3, 0.03), F.dunkel, 0, BODEN + 3.38, 0.535);
          for (let s = 0; s < 12; s++) b.teil(quader(0.02, 0.05, 0.01), F.dunkel, Math.sin((s * Math.PI) / 6) * 0.24, BODEN + 3.38 + Math.cos((s * Math.PI) / 6) * 0.24, 0.54);
          b.teil(quader(0.03, 0.2, 0.012), F.dunkel, 0, BODEN + 3.47, 0.55);
          b.teil(quader(0.15, 0.03, 0.012), F.dunkel, 0.06, BODEN + 3.38, 0.55);
          fenster(b, 0, BODEN + 2.55, 0.5, 0, { w: 0.3, h: 0.45, sprossen: false });
        });
      }
      b.teil(pyramide(1.3, 1.15), dach, 0, BODEN + 3.8 + 0.575, 0, { name: 'dach' });
      b.teil(kugel(0.08, 10, 8), F.gold, 0, BODEN + 5.0, 0, { metall: true });
      b.teil(zylinder(0.02, 0.02, 0.9, 6), '#666666', 0, BODEN + 5.4, 0);
      b.teil(kasten(0.5, 0.3, 0.02, 0.01), F.gold, 0.26, BODEN + 5.7, 0, { doppelseitig: true });
      b.teil(quader(0.5, 0.1, 0.025), laden, 0.26, BODEN + 5.7, 0, { doppelseitig: true });
    });
  });
  blumenbeet(b, -1.4, 1.55, 0.8, 0.5, rnd);
  blumenbeet(b, 1.4, 1.55, 0.8, 0.5, rnd);
  laterne(b, -0.95, 2.0);
  laterne(b, 0.95, 2.0);
  baum(b, -1.85, -1.85, 0.8, rnd);
  baum(b, 1.85, -1.85, 0.75, rnd);
  parkbank(b, -1.75, 0.6, Math.PI / 2);
  return { rauch, hoehe: BODEN + 6.1 };
};

const uni: Bauer = (b, _g, rnd) => {
  grundstueck(b);
  const wf = '#efe2c6';
  const dach = '#4f6d8f';
  const rauch: THREE.Vector3[] = [];
  b.mit(0, 0, -0.45, 0, () => {
    wand(b, 3.8, 2.2, 2.3, wf);
    eckquader(b, 3.8, 2.3, 2.2, '#fffaf0');
    b.teil(kasten(3.86, 0.07, 2.36, 0.02), '#fffaf0', 0, BODEN + 1.1, 0);
    for (const fy of [0.62, 1.62]) {
      for (const fx of [-1.55, -1.05, 1.05, 1.55]) fenster(b, fx, BODEN + fy, 1.15, 0, { w: 0.36, h: 0.62, licht: fy > 1 && fx < 0 });
      for (const fx of [-1.4, -0.7, 0, 0.7, 1.4]) fenster(b, fx, BODEN + fy, -1.15, Math.PI, { w: 0.36, h: 0.62 });
      for (const s of [-1, 1]) for (const fz of [-0.55, 0.45]) fenster(b, s * 1.9, BODEN + fy, fz, (s * Math.PI) / 2, { w: 0.36, h: 0.62 });
    }
    // Säulenportal
    b.mit(0, 0, 1.15, 0, () => {
      b.teil(kasten(2.0, 0.16, 1.0, 0.02), F.stein, 0, BODEN + 0.08, 0.4);
      for (let i = 0; i < 2; i++) b.teil(kasten(2.0, 0.08, 0.22, 0.02), F.stein, 0, BODEN - 0.04 - i * 0.07 + 0.08, 1.0 + i * 0.12);
      for (const sx of [-0.75, -0.25, 0.25, 0.75]) saeule(b, sx, 0.75, 1.95, BODEN + 0.16);
      b.teil(kasten(2.0, 0.22, 1.0, 0.02), '#fffaf0', 0, BODEN + 2.22, 0.4);
      b.teil(giebel(2.1, 0.6, 0.95), '#fffaf0', 0, BODEN + 2.33, 0.4);
      b.teil(giebel(1.7, 0.42, 0.02), '#e9dcc0', 0, BODEN + 2.38, 0.88);
      tafel(b, 'UNIVERSITÄT', 0, BODEN + 2.22, 0.91, 0, 1.5, 0.15, { grund: '#5a3a8a' });
      b.teil(kugel(0.1, 10, 8), F.gold, 0, BODEN + 2.62, 0.9, { metall: true, sz: 0.3 });
    });
    tuer(b, 0, 1.15, 0, '#5a3a8a', { w: 0.6, h: 1.0, lampen: true });
    satteldach(b, 3.8, 2.3, 1.0, BODEN + 2.2, dach);
    // Dachreiter mit Glocke
    b.mit(0, BODEN + 3.1, 0, 0, () => {
      b.teil(kasten(0.45, 0.55, 0.45, 0.03), '#fffaf0', 0, 0.27, 0);
      for (let k = 0; k < 4; k++) b.mit(0, 0, 0, (k * Math.PI) / 2, () => b.teil(kasten(0.2, 0.3, 0.02, 0.01), F.dunkel, 0, 0.3, 0.23));
      b.teil(pyramide(0.62, 0.55), dach, 0, 0.82, 0, { name: 'dach' });
      b.teil(kugel(0.06, 8, 6), F.gold, 0, 1.13, 0, { metall: true });
    });
    rauch.push(schornstein(b, -1.35, BODEN + 2.55, -0.55));
    rauch.push(schornstein(b, 1.35, BODEN + 2.55, -0.55));
  });
  baum(b, -1.85, 1.75, 0.75, rnd);
  baum(b, 1.85, 1.75, 0.75, rnd);
  // Fahrradständer
  for (let i = 0; i < 4; i++) b.teil(torus(0.12, 0.012), '#8892a0', 1.0 + i * 0.16, BODEN + 0.12, 1.95, { ry: Math.PI / 2 });
  parkbank(b, -1.0, 1.95, 0);
  return { rauch, hoehe: BODEN + 4.5 };
};

const bibliothek: Bauer = (b, _g, rnd) => {
  grundstueck(b);
  b.mit(0, 0, -0.25, 0, () => {
    b.teil(zylinder(1.58, 1.62, 0.24, 40), F.steinDunkel, 0, BODEN + 0.12, 0);
    b.teil(zylinder(1.38, 1.38, 1.9, 40), '#f3e3c3', 0, BODEN + 0.24 + 0.95, 0);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + Math.PI / 10;
      b.teil(kasten(0.16, 1.9, 0.1, 0.02), '#fffaf0', Math.sin(a) * 1.39, BODEN + 1.19, Math.cos(a) * 1.39, { ry: a });
      if (k !== 9 && k !== 0) fenster(b, Math.sin(a + Math.PI / 10) * 1.38, BODEN + 1.25, Math.cos(a + Math.PI / 10) * 1.38, a + Math.PI / 10, { w: 0.34, h: 0.8, licht: k === 4 });
    }
    b.teil(zylinder(1.5, 1.5, 0.14, 40), '#fffaf0', 0, BODEN + 2.2, 0);
    b.teil(zylinder(1.2, 1.25, 0.32, 40), '#f3e3c3', 0, BODEN + 2.43, 0);
    b.teil(halbkugel(1.15, 32), '#2fa39a', 0, BODEN + 2.58, 0, { sy: 0.9, name: 'dach' });
    for (let k = 0; k < 8; k++) b.teil(torus(1.12, 0.025), '#2a8f86', 0, BODEN + 2.58, 0, { ry: (k * Math.PI) / 8, rz: 0, rx: 0, sy: 0.9, keinSchatten: true });
    b.teil(zylinder(0.2, 0.2, 0.35, 16), '#fffaf0', 0, BODEN + 3.75, 0);
    b.teil(halbkugel(0.22, 16), '#2fa39a', 0, BODEN + 3.92, 0, { name: 'dach' });
    b.teil(kugel(0.08, 10, 8), F.gold, 0, BODEN + 4.18, 0, { metall: true });
    // Vorbau
    b.mit(0, 0, 1.35, 0, () => {
      for (const sx of [-0.4, 0.4]) saeule(b, sx, 0.4, 1.4);
      b.teil(kasten(1.1, 0.16, 0.65, 0.02), '#fffaf0', 0, BODEN + 1.48, 0.15);
      b.teil(giebel(1.2, 0.38, 0.6), '#fffaf0', 0, BODEN + 1.56, 0.15);
      tafel(b, 'BIBLIOTHEK', 0, BODEN + 1.48, 0.49, 0, 0.95, 0.12, { grund: '#2a7f78' });
      b.teil(kasten(1.2, 0.08, 0.8, 0.02), F.stein, 0, BODEN + 0.04, 0.2);
    });
    tuer(b, 0, 1.36, 0, '#5a3a24', { w: 0.5 });
  });
  busch(b, -1.9, 1.8, 1, rnd);
  busch(b, 1.9, 1.8, 1, rnd);
  busch(b, -1.9, -1.9, 1, rnd);
  baum(b, 1.85, -1.85, 0.8, rnd);
  parkbank(b, 1.5, 1.2, -Math.PI / 2);
  blumenbeet(b, -1.4, 1.7, 0.5, 0.5, rnd);
  return { rauch: [new THREE.Vector3(0, BODEN + 4.2, -0.25)], hoehe: BODEN + 4.6 };
};

function lieferwagen(b: Bausatz, x: number, z: number, ry: number, farbe: string) {
  b.mit(x, BODEN, z, ry, () => {
    b.teil(kasten(1.1, 0.55, 0.55, 0.06), farbe, 0.1, 0.42, 0);
    b.teil(kasten(0.4, 0.42, 0.53, 0.06), farbe, -0.6, 0.35, 0);
    b.teil(quader(0.02, 0.2, 0.44), F.glas, -0.81, 0.45, 0, { glanz: true });
    b.teil(quader(0.2, 0.15, 0.56), F.glas, -0.6, 0.48, 0, { glanz: true });
    b.teil(quader(0.7, 0.12, 0.565), '#2e5aa8', 0.15, 0.45, 0);
    for (const [wx, wz] of [[-0.55, -0.27], [0.4, -0.27], [-0.55, 0.27], [0.4, 0.27]] as const)
      b.teil(zylinder(0.11, 0.11, 0.08, 12), '#222222', wx, 0.12, wz, { rx: Math.PI / 2 });
    for (const s of [-1, 1]) b.teil(kasten(0.03, 0.06, 0.08, 0.01), '#fff7d0', -0.81, 0.3, s * 0.18, { leuchten: '#fff3b0' });
  });
}

const post: Bauer = (b, _g, rnd) => {
  grundstueck(b);
  const wf = '#ffcf4a';
  const dach = '#33467a';
  const rauch: THREE.Vector3[] = [];
  b.mit(0.2, 0, -0.55, 0, () => {
    wand(b, 3.0, 1.75, 2.0, wf, { sockel: '#8b8f99' });
    eckquader(b, 3.0, 2.0, 1.75, '#fff3c4');
    for (const fx of [-1.05, -0.55, 0.55, 1.05]) fenster(b, fx, BODEN + 0.75, 1.0, 0, { w: 0.38, h: 0.7, sprossen: false, rahmen: '#2e5aa8' });
    for (const s of [-1, 1]) for (const fz of [-0.4, 0.4]) fenster(b, s * 1.5, BODEN + 0.85, fz, (s * Math.PI) / 2, { laden: '#2e5aa8' });
    tuer(b, 0, 1.0, 0, '#2e5aa8', { vordach: '#2e5aa8', glas: true });
    tafel(b, 'POST', 0, BODEN + 1.45, 1.03, 0, 0.9, 0.25, { grund: '#2e5aa8', schrift: '#ffcf4a', rahmen: '#ffcf4a' });
    satteldach(b, 3.0, 2.0, 0.95, BODEN + 1.75, dach, { giebelFarbe: wf });
    gaube(b, -0.8, BODEN + 1.75 + 0.2, 0.62, wf, dach);
    gaube(b, 0.8, BODEN + 1.75 + 0.2, 0.62, wf, dach);
    rauch.push(schornstein(b, -0.9, BODEN + 2.1, -0.45));
  });
  // Briefkasten, Pakete, Lieferwagen
  b.mit(1.9, BODEN, 1.45, 0, () => {
    b.teil(zylinder(0.03, 0.03, 0.35, 6), '#555555', 0, 0.17, 0);
    b.teil(kasten(0.32, 0.42, 0.26, 0.06), '#ffcf4a', 0, 0.55, 0);
    b.teil(quader(0.18, 0.025, 0.02), F.dunkel, 0, 0.66, 0.135);
    b.teil(halbkugel(0.16, 12), '#ffcf4a', 0, 0.76, 0, { sz: 0.8 });
  });
  kiste(b, 1.85, -1.6);
  kiste(b, 1.85, -1.25);
  kiste(b, 1.85, -1.42, 0.8, BODEN + 0.22);
  lieferwagen(b, -1.3, 1.6, 0, '#ffcf4a');
  baum(b, -1.9, -1.9, 0.7, rnd);
  return { rauch, hoehe: BODEN + 3.5 };
};

function marktstand(b: Bausatz, x: number, z: number, ry: number, f1: string, ware: string[]) {
  b.mit(x, BODEN, z, ry, () => {
    b.teil(kasten(0.95, 0.42, 0.5, 0.03), F.holz, 0, 0.21, 0);
    b.teil(kasten(1.0, 0.04, 0.55, 0.01), '#c99a5a', 0, 0.43, 0);
    for (const [px, pz] of [[-0.45, -0.25], [0.45, -0.25], [-0.45, 0.25], [0.45, 0.25]] as const) b.teil(zylinder(0.025, 0.025, 1.1, 6), F.holzDunkel, px, 0.55, pz);
    for (let i = 0; i < 6; i++) b.teil(kasten(0.18, 0.04, 0.7, 0.01), i % 2 ? f1 : '#ffffff', -0.45 + i * 0.18, 1.12, 0.05, { rx: -0.28 });
    b.teil(quader(1.08, 0.12, 0.02), f1, 0, 1.0, 0.39);
    ware.forEach((w, i) => {
      for (let k = 0; k < 3; k++) b.teil(kugel(0.06, 7, 5), w, -0.3 + i * 0.3 + (k - 1) * 0.07, 0.5, 0.05 + (k % 2) * 0.08);
    });
    kiste(b, 0.6, 0.35, 0.7, 0, ware[0]);
  });
}

const marktplatz: Bauer = (b, _g, rnd) => {
  grundstueck(b, 'pflaster');
  marktstand(b, -1.15, -1.1, 0.3, '#e8413c', ['#e8413c', '#ffc23d', '#7ccf4a']);
  marktstand(b, 1.15, -1.1, -0.3, '#3b6fd8', ['#f28c28', '#8a2be2', '#ffc23d']);
  marktstand(b, -1.25, 1.0, Math.PI - 0.2, '#2fa36b', ['#7ccf4a', '#e8413c', '#f5e6c8']);
  marktstand(b, 1.25, 1.0, Math.PI + 0.2, '#f2a33a', ['#f5e6c8', '#c58a4a', '#ffd23d']);
  // Brunnen in der Mitte
  b.mit(0, BODEN, 0, 0, () => {
    b.teil(zylinder(0.55, 0.6, 0.22, 24), F.stein, 0, 0.11, 0);
    b.teil(scheibe(0.48), '#59c3ef', 0, 0.2, 0, { glanz: true, keinSchatten: true });
    b.teil(zylinder(0.08, 0.12, 0.5, 10), '#d8d0c2', 0, 0.42, 0);
    b.teil(halbkugel(0.2, 14), '#d8d0c2', 0, 0.67, 0, { rx: Math.PI });
    b.teil(kugel(0.07, 8, 6), '#59c3ef', 0, 0.72, 0, { glanz: true });
  });
  laterne(b, -2.0, 0);
  laterne(b, 2.0, 0);
  kiste(b, 0.1, -1.95);
  kiste(b, 0.4, -1.95, 1, BODEN, '#e8413c');
  // Handkarren
  b.mit(-0.2, BODEN, 1.85, 0.4, () => {
    b.teil(kasten(0.6, 0.16, 0.36, 0.02), F.holz, 0, 0.3, 0);
    for (const s of [-1, 1]) b.teil(zylinder(0.15, 0.15, 0.04, 12), F.holzDunkel, 0, 0.17, s * 0.2, { rx: Math.PI / 2 });
    b.teil(quader(0.5, 0.03, 0.03), F.holzDunkel, 0.5, 0.33, 0.1);
    for (let i = 0; i < 5; i++) b.teil(kugel(0.06, 6, 4), '#7ccf4a', -0.2 + i * 0.1, 0.42, 0);
  });
  void rnd;
  return { rauch: [new THREE.Vector3(0, BODEN + 1.2, -1.1)], hoehe: BODEN + 2.0 };
};

const corpshaus: Bauer = (b, _g, rnd) => {
  grundstueck(b);
  const weiss = '#f7f1e3';
  const balken = F.holzDunkel;
  const dach = '#6b4a3a';
  const laden = '#2f5d3a';
  const rauch: THREE.Vector3[] = [];
  b.mit(0, 0, -0.5, 0, () => {
    // Erdgeschoss
    wand(b, 3.2, 1.05, 2.2, '#e9dcc4', { gesims: balken });
    for (const fx of [-1.15, -0.6, 0.6, 1.15]) fenster(b, fx, BODEN + 0.58, 1.1, 0, { w: 0.34, h: 0.5, laden });
    for (const s of [-1, 1]) fenster(b, s * 1.6, BODEN + 0.58, 0, (s * Math.PI) / 2, { laden });
    tuer(b, 0, 1.1, 0, laden, { lampen: true });
    // Obergeschoss (vorkragend) mit Fachwerk
    const y1 = BODEN + 1.05;
    b.teil(kasten(3.4, 1.0, 2.4, 0.03), weiss, 0, y1 + 0.5, 0);
    for (const yy of [y1 + 0.04, y1 + 0.97]) b.teil(kasten(3.44, 0.08, 2.44, 0.01), balken, 0, yy, 0);
    for (const s of [-1, 1]) {
      const zf = s * 1.205;
      for (let i = 0; i <= 6; i++) b.teil(quader(0.07, 1.0, 0.03), balken, -1.7 + i * (3.4 / 6), y1 + 0.5, zf);
      for (let i = 0; i < 6; i++) if (i % 2 === 0) b.teil(quader(0.06, 0.62, 0.025), balken, -1.7 + (i + 0.5) * (3.4 / 6), y1 + 0.5, zf, { rz: (i % 4 ? 1 : -1) * 0.75 });
      for (let i = 0; i <= 4; i++) b.teil(quader(0.03, 1.0, 0.07), balken, s * 1.705, y1 + 0.5, -1.2 + i * 0.6);
    }
    for (const fx of [-1.13, 1.13]) fenster(b, fx, y1 + 0.5, 1.22, 0, { w: 0.34, h: 0.46, laden, kasten: true });
    fenster(b, 0, y1 + 0.5, 1.22, 0, { w: 0.34, h: 0.46, kasten: true, licht: true });
    for (const fx of [-0.57, 0.57]) fenster(b, fx, y1 + 0.5, -1.22, Math.PI, { w: 0.3, h: 0.46 });
    satteldach(b, 3.4, 2.4, 1.45, y1 + 1.0, dach, { giebelFarbe: weiss });
    for (const s of [-1, 1]) {
      b.teil(quader(0.04, 1.2, 0.07), balken, s * 1.69, y1 + 1.55, 0, { ry: Math.PI / 2 });
      b.teil(quader(0.04, 0.05, 2.2), balken, s * 1.69, y1 + 1.4, 0);
    }
    gaube(b, 0, y1 + 1.05, 0.72, weiss, dach);
    rauch.push(schornstein(b, -1.0, y1 + 1.3, -0.4));
  });
  // Fahnenmast + Biergarten
  b.teil(zylinder(0.025, 0.03, 2.8, 6), '#dddddd', -1.95, BODEN + 1.4, 1.6);
  b.teil(kugel(0.05, 8, 6), F.gold, -1.95, BODEN + 2.82, 1.6, { metall: true });
  for (const [i, f] of [[0, '#2f5d3a'], [1, '#ffffff'], [2, '#c8a84a']] as const) b.teil(quader(0.6, 0.12, 0.02), f, -1.63, BODEN + 2.62 - i * 0.12, 1.6, { doppelseitig: true });
  b.mit(1.35, BODEN, 1.45, 0, () => {
    b.teil(kasten(0.9, 0.04, 0.4, 0.01), F.holz, 0, 0.36, 0);
    for (const s of [-1, 1]) b.teil(quader(0.04, 0.34, 0.3), F.holzDunkel, s * 0.38, 0.17, 0);
    for (const s of [-1, 1]) b.teil(kasten(0.9, 0.04, 0.16, 0.01), F.holz, 0, 0.22, s * 0.36);
    for (let i = 0; i < 3; i++) b.teil(zylinder(0.035, 0.03, 0.1, 8), '#f2c14e', -0.25 + i * 0.25, 0.43, 0.05, { glanz: true });
  });
  laterne(b, 0.6, 1.95);
  baum(b, 1.85, -1.85, 0.8, rnd);
  return { rauch, hoehe: BODEN + 4.2 };
};

const bank: Bauer = (b, _g, rnd) => {
  grundstueck(b);
  const wf = '#f7f4ee';
  const dach = '#2fa36b';
  b.mit(0, 0, -0.4, 0, () => {
    wand(b, 3.2, 1.85, 2.0, wf, { sockel: '#b8b2a6' });
    for (const s of [-1, 1]) for (const fz of [-0.45, 0.45]) fenster(b, s * 1.6, BODEN + 0.95, fz, (s * Math.PI) / 2, { w: 0.34, h: 0.7, gitter: true, sprossen: false });
    for (const fx of [-1.0, -0.33, 0.33, 1.0]) fenster(b, fx, BODEN + 0.95, -1.0, Math.PI, { w: 0.34, h: 0.7, gitter: true, sprossen: false });
    b.mit(0, 0, 1.0, 0, () => {
      for (let i = 0; i < 3; i++) b.teil(kasten(3.0 - i * 0.12, 0.08, 0.95 - i * 0.18, 0.02), F.stein, 0, BODEN + 0.04 + i * 0.08, 0.4 - i * 0.09);
      for (const sx of [-1.25, -0.75, -0.25, 0.25, 0.75, 1.25]) saeule(b, sx, 0.62, 1.7, BODEN + 0.24);
      b.teil(kasten(3.0, 0.24, 0.9, 0.02), '#ece6da', 0, BODEN + 2.06, 0.32);
      tafel(b, 'BANK', 0, BODEN + 2.06, 0.78, 0, 0.9, 0.17, { grund: '#2a6b4c', schrift: '#f2c14e' });
      b.teil(giebel(3.1, 0.65, 0.85), dach, 0, BODEN + 2.18, 0.32, { name: 'dach' });
      b.teil(giebel(2.6, 0.48, 0.02), '#ece6da', 0, BODEN + 2.22, 0.76);
      b.teil(zylinder(0.18, 0.18, 0.05, 24), F.gold, 0, BODEN + 2.42, 0.78, { rx: Math.PI / 2, metall: true });
      b.teil(quader(0.04, 0.2, 0.02), '#c8962a', 0, BODEN + 2.42, 0.81, { metall: true });
    });
    tuer(b, 0, 1.0, 0, '#2b5d3a', { w: 0.6, h: 1.05, lampen: true });
    satteldach(b, 3.2, 2.0, 0.6, BODEN + 1.85, dach, { giebelFarbe: wf });
  });
  hecke(b, -1.6, -2.0, 1.4, 0);
  hecke(b, 1.6, -2.0, 1.4, 0);
  busch(b, -1.9, 1.85, 0.9, rnd);
  busch(b, 1.9, 1.85, 0.9, rnd);
  laterne(b, -1.9, 1.2);
  return { rauch: [new THREE.Vector3(0.9, BODEN + 2.6, -0.4)], hoehe: BODEN + 3.4 };
};

const boerse: Bauer = (b, _g, rnd) => {
  grundstueck(b);
  const wf = '#dfe5ea';
  b.mit(0, 0, -0.35, 0, () => {
    wand(b, 3.0, 3.2, 2.4, wf, { sockel: '#6f7782', gesims: '#c4ccd6' });
    for (let s = 0; s < 3; s++) b.teil(kasten(3.04, 0.06, 2.44, 0.01), '#c4ccd6', 0, BODEN + 1.05 + s * 1.0, 0);
    for (const fy of [1.55, 2.55])
      for (const fx of [-1.1, -0.55, 0, 0.55, 1.1]) fenster(b, fx, BODEN + fy, 1.2, 0, { w: 0.34, h: 0.6, sprossen: false, licht: (fx + fy) % 1.1 < 0.2 });
    for (const fy of [0.55, 1.55, 2.55]) for (const s of [-1, 1]) for (const fz of [-0.6, 0, 0.6]) fenster(b, s * 1.5, BODEN + fy, fz, (s * Math.PI) / 2, { w: 0.3, h: 0.6, sprossen: false });
    for (const fy of [0.55, 1.55, 2.55]) for (const fx of [-1.0, 0, 1.0]) fenster(b, fx, BODEN + fy, -1.2, Math.PI, { w: 0.36, h: 0.6, sprossen: false });
    for (const fx of [-1.36, -0.82, 0.82, 1.36]) b.teil(quader(0.1, 3.0, 0.06), '#c4ccd6', fx, BODEN + 1.6, 1.22);
    tuer(b, 0, 1.2, 0, F.dunkel, { glas: true, w: 0.8, h: 0.85, stufen: 2 });
    tafel(b, '▲ 2,4 %   DAX   ▼ 0,3 %', 0, BODEN + 1.08, 1.24, 0, 1.6, 0.18, { grund: '#11161f', schrift: '#4ef08a', rahmen: '#4a5563' });
    tafel(b, 'BÖRSE', 0, BODEN + 3.0, 1.24, 0, 1.0, 0.2, { grund: '#33467a' });
    b.teil(kasten(3.1, 0.25, 2.5, 0.03), '#c4ccd6', 0, BODEN + 3.3, 0, { name: 'dach' });
    b.teil(kasten(1.2, 0.4, 0.9, 0.04), '#9aa4b1', 0.5, BODEN + 3.6, -0.4);
    b.teil(zylinder(0.02, 0.02, 1.0, 6), '#888888', -1.0, BODEN + 3.9, -0.6);
    b.teil(kugel(0.05, 8, 6), '#e8413c', -1.0, BODEN + 4.42, -0.6, { leuchten: '#ff3b2f' });
  });
  for (const sx of [-1.7, 1.7]) {
    b.teil(zylinder(0.02, 0.025, 2.2, 6), '#dddddd', sx, BODEN + 1.1, 1.85);
    b.teil(quader(0.45, 0.28, 0.02), sx < 0 ? '#33467a' : '#2fa36b', sx + 0.24, BODEN + 2.05, 1.85, { doppelseitig: true });
  }
  busch(b, -1.0, 1.9, 0.8, rnd);
  busch(b, 1.0, 1.9, 0.8, rnd);
  return { rauch: [new THREE.Vector3(0.5, BODEN + 3.9, -0.75)], hoehe: BODEN + 4.6 };
};

const einkaufsladen: Bauer = (b, _g, rnd) => {
  grundstueck(b);
  const wf = '#f2e2d0';
  const dach = '#2f8f8f';
  b.mit(0, 0, -0.55, 0, () => {
    wand(b, 3.2, 1.5, 2.0, wf, { sockel: '#a5533a' });
    for (const sx of [-1, 1]) {
      b.teil(kasten(1.0, 0.85, 0.06, 0.02), F.dunkel, sx * 0.95, BODEN + 0.7, 1.0);
      b.teil(quader(0.92, 0.77, 0.02), F.glas, sx * 0.95, BODEN + 0.7, 1.035, { glanz: true });
      for (let i = 0; i < 4; i++) b.teil(kasten(0.14, 0.1, 0.1, 0.01), ['#e8413c', '#ffc23d', '#7ccf4a', '#f28c28'][i]!, sx * 0.95 - 0.3 + i * 0.2, BODEN + 0.35, 0.9);
    }
    tuer(b, 0, 1.0, 0, F.dunkel, { glas: true, w: 0.5 });
    // gestreifte Markise
    for (let i = 0; i < 12; i++) b.teil(kasten(0.27, 0.04, 0.62, 0.01), i % 2 ? '#2f8f8f' : '#ffffff', -1.48 + i * 0.27, BODEN + 1.32, 1.25, { rx: 0.35 });
    b.teil(quader(3.25, 0.1, 0.02), '#2f8f8f', 0, BODEN + 1.17, 1.54);
    tafel(b, 'LADEN', 0, BODEN + 1.62, 1.02, 0, 1.2, 0.22, { grund: '#2f8f8f' });
    satteldach(b, 3.2, 2.0, 0.75, BODEN + 1.5, dach, { giebelFarbe: wf });
  });
  kiste(b, -1.6, 1.4, 1, BODEN, '#e8413c');
  kiste(b, -1.25, 1.45, 1, BODEN, '#7ccf4a');
  kiste(b, -1.45, 1.75, 1, BODEN, '#ffc23d');
  // Einkaufswagen
  b.mit(1.4, BODEN, 1.6, -0.5, () => {
    b.teil(kasten(0.4, 0.25, 0.28, 0.02), '#b0b8c4', 0, 0.38, 0, { metall: true, transparent: 0.85 });
    b.teil(quader(0.03, 0.03, 0.32), '#e8413c', -0.25, 0.55, 0);
    for (const [wx, wz] of [[-0.15, -0.12], [0.15, -0.12], [-0.15, 0.12], [0.15, 0.12]] as const) b.teil(kugel(0.04, 6, 4), '#222222', wx, 0.05, wz);
    for (const [wx, wz] of [[-0.15, -0.12], [0.15, -0.12], [-0.15, 0.12], [0.15, 0.12]] as const) b.teil(quader(0.015, 0.22, 0.015), '#b0b8c4', wx, 0.16, wz);
  });
  baum(b, 1.85, -1.85, 0.75, rnd);
  busch(b, -1.9, -1.9, 1, rnd);
  return { rauch: [new THREE.Vector3(1.0, BODEN + 2.3, -0.8)], hoehe: BODEN + 3.0 };
};

/** Baustelle für Gebäude, die noch nicht eröffnet sind */
const baustelle: Bauer = (b, _g, rnd) => {
  grundstueck(b, 'erde');
  // Bauzaun
  const innen = PLATZ / 2 - 0.42;
  for (const s of [-1, 1])
    for (let i = -3; i <= 3; i++) {
      if (s === 1 && Math.abs(i) <= 0) continue; // Einfahrt
      for (const [x, z, ry] of [[i * 0.58, s * innen, 0], [s * innen, i * 0.58, Math.PI / 2]] as const) {
        b.teil(quader(0.04, 0.5, 0.04), '#d0d0d0', x - (ry ? 0 : 0.27), BODEN + 0.25, z - (ry ? 0.27 : 0));
        b.teil(quader(0.56, 0.08, 0.02), i % 2 ? '#f2a33a' : '#ffffff', x, BODEN + 0.4, z, { ry });
        b.teil(quader(0.56, 0.08, 0.02), i % 2 ? '#ffffff' : '#f2a33a', x, BODEN + 0.28, z, { ry });
      }
    }
  b.mit(-0.1, 0, -0.3, 0, () => {
    b.teil(kasten(2.6, 0.16, 1.9, 0.02), '#b8b2a6', 0, BODEN + 0.08, 0);
    // Mauern, unterschiedlich hoch, aus Steinreihen
    for (let r = 0; r < 6; r++) {
      const y = BODEN + 0.22 + r * 0.14;
      const lang = 2.5 - r * 0.25;
      b.teil(kasten(lang, 0.12, 0.18, 0.015), r % 2 ? '#d98a5b' : '#cf7d4e', -1.25 + lang / 2, y, -0.86);
      if (r < 4) b.teil(kasten(0.18, 0.12, 1.7 - r * 0.2, 0.015), r % 2 ? '#d98a5b' : '#cf7d4e', -1.22, y, -0.85 + (1.7 - r * 0.2) / 2);
    }
    // Gerüst
    for (const [px, pz] of [[-1.4, 1.05], [0.1, 1.05], [1.4, 1.05], [1.4, -1.0], [1.4, 0.0]] as const) b.teil(zylinder(0.025, 0.025, 1.9, 6), '#c0c4ca', px, BODEN + 0.95, pz);
    for (const y of [0.75, 1.5]) {
      b.teil(kasten(2.9, 0.05, 0.28, 0.01), '#e2b46b', 0, BODEN + y, 1.05);
      b.teil(kasten(0.28, 0.05, 2.1, 0.01), '#e2b46b', 1.4, BODEN + y, 0.02);
      b.teil(quader(2.8, 0.025, 0.025), '#c0c4ca', 0, BODEN + y + 0.4, 1.16);
    }
    b.teil(quader(0.025, 2.0, 0.025), '#c0c4ca', -0.65, BODEN + 1.0, 1.16, { rz: 0.62 });
  });
  // Kran
  b.mit(-1.75, BODEN, -1.75, 0.5, () => {
    b.teil(kasten(0.5, 0.2, 0.5, 0.02), '#8b8f99', 0, 0.1, 0);
    for (const [px, pz] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]] as const) b.teil(quader(0.04, 3.6, 0.04), '#ffc23d', px, 2.0, pz);
    for (let y = 0.4; y < 3.6; y += 0.35) {
      b.teil(quader(0.26, 0.025, 0.025), '#ffc23d', 0, y, 0.12, { rz: 0.9 });
      b.teil(quader(0.025, 0.025, 0.26), '#ffc23d', 0.12, y + 0.17, 0, { rx: 0.9 });
    }
    b.teil(kasten(0.35, 0.3, 0.35, 0.03), '#ffc23d', 0, 3.95, 0);
    b.teil(quader(0.3, 0.2, 0.25), F.glas, 0.12, 3.95, 0.06, { glanz: true });
    b.teil(kasten(3.4, 0.12, 0.14, 0.02), '#ffc23d', 1.0, 4.18, 0);
    b.teil(kasten(0.45, 0.3, 0.3, 0.02), '#8b8f99', -0.6, 4.05, 0);
    b.teil(pyramide(0.2, 0.6), '#ffc23d', 0, 4.5, 0);
    b.teil(quader(0.012, 1.6, 0.012), '#333333', 2.0, 3.35, 0, { keinSchatten: true });
    b.teil(kasten(0.4, 0.06, 0.3, 0.01), '#c58a4a', 2.0, 2.5, 0);
    for (let i = 0; i < 4; i++) b.teil(kasten(0.18, 0.08, 0.1, 0.01), '#d98a5b', 1.9 + (i % 2) * 0.2, 2.57, -0.06 + Math.floor(i / 2) * 0.12);
  });
  // Material, Mischer, Hütchen
  for (let i = 0; i < 4; i++) b.teil(kasten(1.0, 0.05, 0.14, 0.01), '#e2b46b', 1.2, BODEN + 0.03 + i * 0.05, -1.75 + (i % 2) * 0.02);
  b.mit(1.55, BODEN, 1.55, -0.6, () => {
    b.teil(kasten(0.3, 0.12, 0.3, 0.02), '#8b8f99', 0, 0.14, 0);
    b.teil(zylinder(0.13, 0.2, 0.35, 12), '#f28c28', 0, 0.42, 0, { rz: 0.5 });
    for (const s of [-1, 1]) b.teil(zylinder(0.07, 0.07, 0.04, 10), '#222222', s * 0.12, 0.07, 0.16, { rx: Math.PI / 2 });
  });
  for (const [x, z] of [[0.55, 1.85], [-0.55, 1.85], [1.9, 0.3]] as const) {
    b.teil(kegel(0.08, 0.28, 10), '#f28c28', x, BODEN + 0.16, z);
    b.teil(zylinder(0.062, 0.075, 0.05, 10), '#ffffff', x, BODEN + 0.16, z);
    b.teil(kasten(0.2, 0.03, 0.2, 0.01), '#f28c28', x, BODEN + 0.015, z);
  }
  void rnd;
  return { rauch: [new THREE.Vector3(1.55, BODEN + 0.7, 1.55)], hoehe: BODEN + 4.9 };
};

const WANDFARBEN = ['#f6e7c8', '#ffd8a8', '#d7ecff', '#e8f5d0', '#f9d5e5', '#fff1b8', '#e6dcf5'];
const DACHFARBEN = ['#3b6fd8', '#2fa36b', '#7a5c99', '#33467a', '#8a5a32', '#2f8f8f', '#5f6f8a'];
const LADENFARBEN = ['#2e5aa8', '#2f5d3a', '#7a3b22', '#5a3a8a', '#2f8f8f'];

/** Gebäude ohne eigenes Modell: Wohnhaus, Farben/Form fest aus dem Namen abgeleitet */
const haus: Bauer = (b, g, rnd) => {
  grundstueck(b);
  const wf = WANDFARBEN[Math.floor(rnd() * WANDFARBEN.length)]!;
  const dach = DACHFARBEN[Math.floor(rnd() * DACHFARBEN.length)]!;
  const laden = LADENFARBEN[Math.floor(rnd() * LADENFARBEN.length)]!;
  const stock = rnd() < 0.55 ? 2 : 1;
  const w = 2.6 + Math.round(rnd() * 3) * 0.3;
  const h = stock === 2 ? 2.0 : 1.2;
  const rauch: THREE.Vector3[] = [];
  b.mit(0, 0, -0.45, 0, () => {
    wand(b, w, h, 2.0, wf);
    eckquader(b, w, 2.0, h);
    const xs: number[] = [];
    for (let x = -w / 2 + 0.5; x <= w / 2 - 0.45; x += 0.6) if (Math.abs(x) > 0.38) xs.push(x);
    for (let s = 0; s < stock; s++) for (const fx of xs) fenster(b, fx, BODEN + 0.6 + s * 0.95, 1.0, 0, { laden, kasten: s === 1 || stock === 1 });
    if (stock === 2) fenster(b, 0, BODEN + 1.55, 1.0, 0, { laden, kasten: true });
    for (const s of [-1, 1]) for (let k = 0; k < stock; k++) fenster(b, (s * w) / 2, BODEN + 0.6 + k * 0.95, 0, (s * Math.PI) / 2, { laden });
    tuer(b, 0, 1.0, 0, laden, { vordach: dach, lampen: rnd() < 0.5 });
    satteldach(b, w, 2.0, 0.85 + rnd() * 0.3, BODEN + h, dach);
    if (rnd() < 0.6) gaube(b, 0, BODEN + h + 0.18, 0.6, wf, dach);
    rauch.push(schornstein(b, w / 2 - 0.5, BODEN + h + 0.3, -0.4));
  });
  baum(b, -1.85, 1.75, 0.75, rnd);
  blumenbeet(b, 1.4, 1.65, 0.8, 0.45, rnd);
  if (rnd() < 0.5) hecke(b, 0, -2.05, 3.6, 0);
  void g;
  return { rauch, hoehe: BODEN + h + 2.0 };
};

const BAUER: Record<string, Bauer> = {
  rathaus,
  uni,
  bibliothek,
  post,
  marktplatz,
  corpshaus,
  bank,
  boerse,
  einkaufsladen,
};

export function modellArt(g: Gebaeude): string {
  if (g.status === 'geschlossen' || g.fehler) return 'baustelle';
  const k = g.id.toLowerCase().replace(/ö/g, 'oe').replace(/ä/g, 'ae').replace(/ü/g, 'ue').replace(/[^a-z]/g, '');
  return BAUER[k] ? k : 'haus';
}

export function gebaeudeModell(g: Gebaeude): Modell {
  const b = new Bausatz();
  const art = modellArt(g);
  const bauer = art === 'baustelle' ? baustelle : (BAUER[art] ?? haus);
  const { rauch, hoehe } = bauer(b, g, zufallAus(g.id));
  const lichter = [...b.lichter];
  return { gruppe: b.fertig(), rauch, hoehe, lichter };
}

// ---- Deko-Felder ----------------------------------------------------------------------------------

/** Ein Deko-Objekt auf einem Feld (lokal um die Feldmitte, Boden y=0) */
export function dekoBauen(b: Bausatz, art: DekoArt, x: number, z: number, dreh: number, rnd: () => number) {
  const ry = (dreh * Math.PI) / 2;
  switch (art) {
    case 'baum':
      return baum(b, x, z, 0.85 + rnd() * 0.3, rnd, 0);
    case 'tanne':
      return tanne(b, x, z, 0.9 + rnd() * 0.35, 0);
    case 'busch':
      busch(b, x - 0.2, z - 0.15, 1, rnd, 0);
      return busch(b, x + 0.25, z + 0.2, 0.8, rnd, 0);
    case 'blumen':
      return blumenbeet(b, x, z, FELD - 0.2, FELD - 0.2, rnd, 0);
    case 'laterne':
      return laterne(b, x, z, 0);
    case 'bank':
      return parkbank(b, x, z, ry, 0);
    case 'brunnen':
      b.mit(x, 0, z, 0, () => {
        b.teil(zylinder(0.52, 0.56, 0.24, 24), F.stein, 0, 0.12, 0);
        b.teil(scheibe(0.45), '#59c3ef', 0, 0.22, 0, { glanz: true, keinSchatten: true });
        b.teil(zylinder(0.07, 0.1, 0.5, 10), '#d8d0c2', 0, 0.4, 0);
        b.teil(halbkugel(0.18, 14), '#d8d0c2', 0, 0.64, 0, { rx: Math.PI });
        b.teil(kugel(0.06, 8, 6), '#59c3ef', 0, 0.7, 0, { glanz: true });
      });
      return;
    case 'felsen':
      b.mit(x, 0, z, rnd() * 6, () => {
        b.teil(ikosaeder(0.32, 0), '#9aa1a8', 0, 0.16, 0, { flach: true, sy: 0.7 });
        b.teil(ikosaeder(0.2, 0), '#8a9198', 0.28, 0.1, 0.14, { flach: true, sy: 0.8 });
        b.teil(ikosaeder(0.14, 0), '#a8afb6', -0.25, 0.07, 0.18, { flach: true });
      });
      return;
    case 'hecke':
      return hecke(b, x, z, FELD, ry, 0);
  }
}

export function auto(farbe: string): THREE.Group {
  const b = new Bausatz();
  b.teil(kasten(0.9, 0.26, 0.46, 0.08), farbe, 0, 0.24, 0);
  b.teil(kasten(0.5, 0.22, 0.42, 0.08), farbe, -0.04, 0.45, 0);
  b.teil(quader(0.02, 0.15, 0.36), F.glas, 0.215, 0.46, 0, { glanz: true, rz: -0.3 });
  b.teil(quader(0.02, 0.15, 0.36), F.glas, -0.29, 0.46, 0, { glanz: true, rz: 0.3 });
  for (const s of [-1, 1]) b.teil(quader(0.38, 0.13, 0.02), F.glas, -0.04, 0.46, s * 0.212, { glanz: true });
  for (const [wx, wz] of [[-0.28, -0.22], [0.28, -0.22], [-0.28, 0.22], [0.28, 0.22]] as const) b.teil(zylinder(0.1, 0.1, 0.07, 12), '#222222', wx, 0.1, wz, { rx: Math.PI / 2 });
  for (const s of [-1, 1]) b.teil(kasten(0.02, 0.05, 0.08, 0.01), '#fff7d0', 0.45, 0.26, s * 0.15, { leuchten: '#fff3b0' });
  for (const s of [-1, 1]) b.teil(kasten(0.02, 0.05, 0.08, 0.01), '#ff4b3a', -0.45, 0.26, s * 0.15, { leuchten: '#ff2a1a' });
  const g = b.fertig();
  g.scale.setScalar(0.85);
  return g;
}

export { material };
