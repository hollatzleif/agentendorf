import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Bausatz: sammelt viele kleine Teile (Fenster, Ziegelreihen, Säulen …) und fasst sie am Ende je
 * Material zu EINEM Mesh zusammen. Ein detailliertes Haus besteht so aus ~10 statt ~300 Zeichenaufrufen –
 * wichtig fürs Handy.
 */

export interface MatOpt {
  glanz?: boolean; // Glas, Wasser, Metall
  metall?: boolean;
  leuchten?: string; // Emissionsfarbe (Fensterlicht, Laternen)
  flach?: boolean; // Low-Poly-Schattierung (Bäume, Felsen)
  transparent?: number; // Deckkraft
  doppelseitig?: boolean;
}

const materialien = new Map<string, THREE.MeshStandardMaterial>();

/** Für Tag/Nacht: alle leuchtenden Materialien (Laternen, Lampen) und das Fensterglas */
export function leuchtMaterialien() {
  return [...materialien.entries()].filter(([k]) => k.split('|')[2]).map(([, m]) => m);
}
export function glasMaterialien() {
  return [...materialien.entries()].filter(([k]) => k.startsWith('#6e9fd1|1')).map(([, m]) => m);
}
export function material(farbe: string, o: MatOpt = {}): THREE.MeshStandardMaterial {
  const k = `${farbe}|${o.glanz ? 1 : 0}${o.metall ? 1 : 0}${o.flach ? 1 : 0}|${o.leuchten ?? ''}|${o.transparent ?? ''}|${o.doppelseitig ? 1 : 0}`;
  let m = materialien.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: farbe,
      roughness: o.glanz ? 0.18 : o.metall ? 0.35 : 0.82,
      metalness: o.metall ? 0.65 : 0,
      flatShading: !!o.flach,
      ...(o.leuchten ? { emissive: new THREE.Color(o.leuchten), emissiveIntensity: 0.75 } : {}),
      ...(o.transparent !== undefined ? { transparent: true, opacity: o.transparent, depthWrite: false } : {}),
      ...(o.doppelseitig ? { side: THREE.DoubleSide } : {}),
    });
    materialien.set(k, m);
  }
  return m;
}

// ---- Grundformen (zwischengespeichert, werden beim Zusammenfassen kopiert) ------------------------
const formen = new Map<string, THREE.BufferGeometry>();
function form(k: string, f: () => THREE.BufferGeometry) {
  let g = formen.get(k);
  if (!g) {
    g = f();
    if (g.index) g = g.toNonIndexed();
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.getAttribute('position').count) * 2), 2));
    g.computeBoundingBox();
    formen.set(k, g);
  }
  return g;
}
const r3 = (n: number) => Math.round(n * 1000) / 1000;
export const kasten = (w: number, h: number, d: number, r = 0.04) => {
  const rr = Math.min(r, w / 2.05, h / 2.05, d / 2.05);
  return form(`k${r3(w)},${r3(h)},${r3(d)},${r3(rr)}`, () => (rr < 0.006 ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, 2, rr)));
};
export const quader = (w: number, h: number, d: number) => form(`q${r3(w)},${r3(h)},${r3(d)}`, () => new THREE.BoxGeometry(w, h, d));
export const zylinder = (ro: number, ru: number, h: number, seg = 12) =>
  form(`z${r3(ro)},${r3(ru)},${r3(h)},${seg}`, () => new THREE.CylinderGeometry(ro, ru, h, seg));
export const kugel = (r: number, w = 12, h = 8) => form(`s${r3(r)},${w},${h}`, () => new THREE.SphereGeometry(r, w, h));
export const halbkugel = (r: number, w = 24) => form(`h${r3(r)},${w}`, () => new THREE.SphereGeometry(r, w, Math.max(6, w / 3), 0, Math.PI * 2, 0, Math.PI / 2));
export const ikosaeder = (r: number, d = 1) => form(`i${r3(r)},${d}`, () => new THREE.IcosahedronGeometry(r, d));
export const kegel = (r: number, h: number, seg = 12) => form(`c${r3(r)},${r3(h)},${seg}`, () => new THREE.ConeGeometry(r, h, seg));
export const pyramide = (b: number, h: number) =>
  form(`p${r3(b)},${r3(h)}`, () => {
    const g = new THREE.ConeGeometry(b * Math.SQRT1_2, h, 4, 1);
    g.rotateY(Math.PI / 4);
    return g;
  });
export const torus = (r: number, t: number) => form(`t${r3(r)},${r3(t)}`, () => new THREE.TorusGeometry(r, t, 6, 18));
export const scheibe = (r: number, seg = 24) =>
  form(`d${r3(r)},${seg}`, () => {
    const g = new THREE.CircleGeometry(r, seg);
    g.rotateX(-Math.PI / 2);
    return g;
  });
/** Dreieck (Giebel) in der x/y-Ebene, Dicke t in z */
export const giebel = (w: number, h: number, t: number) =>
  form(`g${r3(w)},${r3(h)},${r3(t)}`, () => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(0, h);
    s.lineTo(w / 2, 0);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
    g.translate(0, 0, -t / 2);
    return g;
  });

export interface TeilOpt extends MatOpt {
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  name?: string; // eigenes Mesh mit Namen (z. B. 'dach' zum Umfärben)
  keinSchatten?: boolean;
}

export class Bausatz {
  private teile = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; name?: string; schatten: boolean }>();
  private stapel: THREE.Matrix4[] = [new THREE.Matrix4()];
  private hilf = new THREE.Object3D();

  /** Lokales Koordinatensystem (verschoben/gedreht) für alles, was in fn gebaut wird */
  mit(x: number, y: number, z: number, ry: number, fn: () => void, s = 1) {
    this.hilf.position.set(x, y, z);
    this.hilf.rotation.set(0, ry, 0);
    this.hilf.scale.setScalar(s);
    this.hilf.updateMatrix();
    this.stapel.push(this.stapel[this.stapel.length - 1]!.clone().multiply(this.hilf.matrix));
    try {
      fn();
    } finally {
      this.stapel.pop();
    }
  }

  teil(geo: THREE.BufferGeometry, farbe: string | THREE.Material, x: number, y: number, z: number, o: TeilOpt = {}) {
    const mat = typeof farbe === 'string' ? material(farbe, o) : farbe;
    this.hilf.position.set(x, y, z);
    this.hilf.rotation.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
    this.hilf.scale.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
    this.hilf.updateMatrix();
    const m = this.stapel[this.stapel.length - 1]!.clone().multiply(this.hilf.matrix);
    const g = geo.clone().applyMatrix4(m);
    const k = `${mat.uuid}|${o.name ?? ''}|${o.keinSchatten ? 0 : 1}`;
    let t = this.teile.get(k);
    if (!t) this.teile.set(k, (t = { mat, geos: [], name: o.name, schatten: !o.keinSchatten }));
    t.geos.push(g);
  }

  fertig(): THREE.Group {
    const gruppe = new THREE.Group();
    for (const t of this.teile.values()) {
      const geo = t.geos.length === 1 ? t.geos[0]! : mergeGeometries(t.geos, false);
      if (!geo) continue;
      for (const g of t.geos) if (g !== geo) g.dispose();
      const m = new THREE.Mesh(geo, t.mat);
      m.castShadow = t.schatten;
      m.receiveShadow = true;
      if (t.name) m.name = t.name;
      gruppe.add(m);
    }
    this.teile.clear();
    return gruppe;
  }
}

/** Textur aus einem Canvas (Schilder, Blasen, Namensschilder) */
export function canvasTextur(w: number, h: number, zeichnen: (k: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  zeichnen(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Deterministischer Zufall aus einem Text (gleiches Gebäude → gleiches Aussehen auf allen Geräten) */
export function zufallAus(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  let s = (h >>> 0) % 2147483646 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function entsorgen(o: THREE.Object3D) {
  o.traverse((x) => {
    if (x instanceof THREE.Mesh || x instanceof THREE.Sprite) {
      // Sprites teilen sich eine Geometrie, Grundformen liegen im Zwischenspeicher – beides nicht entsorgen
      if (x instanceof THREE.Mesh && !formenEnthalten(x.geometry)) x.geometry.dispose();
      const m = x.material as THREE.Material & { map?: THREE.Texture | null };
      // geteilte Materialien (Cache) nicht entsorgen – nur Einzelstücke mit eigener Textur
      if (m.map && !materialienEnthalten(m)) {
        m.map.dispose();
        m.dispose();
      }
    }
  });
}
function materialienEnthalten(m: THREE.Material) {
  for (const x of materialien.values()) if (x === m) return true;
  return false;
}
function formenEnthalten(g: THREE.BufferGeometry) {
  for (const x of formen.values()) if (x === g) return true;
  return false;
}
