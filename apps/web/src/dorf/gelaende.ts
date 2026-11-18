import * as THREE from 'three';
import { feldSchluessel } from '@dorf/shared';
import { Bausatz, canvasTextur, kasten, kugel, quader, scheibe, zufallAus, zylinder } from './bausatz';
import { FELD } from './modelle';
import { bodenFarbe, jahreszeit, laubFarben, nadelFarben } from './jahreszeit';

/** Rechteck des bebauten Dorfs in Welt-Einheiten */
export interface Grenzen {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const RAND = 4; // flacher Streifen um das Dorf

// ---- Glitzern auf dem Wasser: helle Wellenlinien als Leucht-Textur, die langsam treibt -----------------
let wellenBild: HTMLCanvasElement | null = null;
function wellenTextur(wiederholen: number) {
  if (!wellenBild) {
    const t = canvasTextur(256, 256, (k) => {
      k.fillStyle = '#000';
      k.fillRect(0, 0, 256, 256);
      const rnd = zufallAus('wellen');
      k.lineCap = 'round';
      for (let i = 0; i < 26; i++) {
        const x = rnd() * 256;
        const y = rnd() * 256;
        const l = 14 + rnd() * 26;
        k.strokeStyle = `rgba(255,255,255,${0.35 + rnd() * 0.5})`;
        k.lineWidth = 2 + rnd() * 2.5;
        // kacheln: jede Linie auch versetzt zeichnen, damit die Ränder nahtlos sind
        for (const dx of [-256, 0, 256])
          for (const dy of [-256, 0, 256]) {
            k.beginPath();
            k.moveTo(x + dx - l / 2, y + dy);
            k.quadraticCurveTo(x + dx, y + dy - 5, x + dx + l / 2, y + dy);
            k.stroke();
          }
      }
    });
    wellenBild = t.image as HTMLCanvasElement;
    t.dispose();
  }
  const t = new THREE.CanvasTexture(wellenBild);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(wiederholen, wiederholen);
  return t;
}
const wellen: THREE.Texture[] = [];
function wasserMaterial(farbe: string, wiederholen: number, rauheit: number) {
  const t = wellenTextur(wiederholen);
  wellen.push(t);
  return new THREE.MeshStandardMaterial({ color: farbe, roughness: rauheit, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.22 });
}
/** Wellen treiben lassen (jedes Bild); nachts glitzert es weniger */
export function wasserTick(zeit: number, dunkel: number) {
  for (const t of wellen) {
    t.offset.set(zeit * 0.012, Math.sin(zeit * 0.25) * 0.03 + zeit * 0.006);
  }
  for (const m of wasserMaterialien) m.emissiveIntensity = 0.22 * (1 - dunkel * 0.7);
}
const wasserMaterialien = new Set<THREE.MeshStandardMaterial>();
function wasserEntsorgen(m: THREE.Material) {
  const w = m as THREE.MeshStandardMaterial;
  if (!wasserMaterialien.delete(w) || !w.emissiveMap) return;
  const i = wellen.indexOf(w.emissiveMap);
  if (i >= 0) wellen.splice(i, 1);
  w.emissiveMap.dispose();
}
const SEEN = [
  { dx: -14, dz: 10, r: 4.5 },
  { dx: 22, dz: -18, r: 6 },
];

function rauschen(x: number, z: number) {
  return (
    Math.sin(x * 0.13 + 1.3) * Math.cos(z * 0.11 - 0.4) * 1.6 +
    Math.sin(x * 0.05 + z * 0.07) * 2.2 +
    Math.sin(x * 0.31 + z * 0.23) * 0.35 +
    Math.sin(x * 0.021 - z * 0.017) * 3
  );
}

export class Gelaende {
  readonly gruppe = new THREE.Group();
  private seen: { x: number; z: number; r: number }[];

  constructor(
    private g: Grenzen,
    private o: { baeume: number },
  ) {
    const mx = (g.minX + g.maxX) / 2;
    const mz = (g.minZ + g.maxZ) / 2;
    const bx = (g.maxX - g.minX) / 2;
    const bz = (g.maxZ - g.minZ) / 2;
    this.seen = SEEN.map((s) => ({ x: mx + Math.sign(s.dx) * (bx + RAND + s.r + 2) + s.dx * 0.3, z: mz + s.dz * 0.4 + Math.sign(s.dz) * 2, r: s.r }));
    this.boden();
    this.wald();
  }

  /** Abstand zum flachen Dorfbereich (0 = im Dorf) */
  private abstand(x: number, z: number) {
    const { minX, maxX, minZ, maxZ } = this.g;
    const dx = Math.max(minX - RAND - x, 0, x - maxX - RAND);
    const dz = Math.max(minZ - RAND - z, 0, z - maxZ - RAND);
    return Math.hypot(dx, dz);
  }

  hoehe(x: number, z: number) {
    const d = this.abstand(x, z);
    const t = Math.min(1, d / 16);
    const glatt = t * t * (3 - 2 * t);
    let h = glatt * Math.max(0.3, 2.6 + rauschen(x, z));
    for (const s of this.seen) {
      const ds = Math.hypot(x - s.x, z - s.z);
      if (ds < s.r + 3) h = Math.min(h, -0.45 + Math.max(0, ds - s.r) * 0.3);
    }
    return h;
  }

  private boden() {
    const mx = (this.g.minX + this.g.maxX) / 2;
    const mz = (this.g.minZ + this.g.maxZ) / 2;
    const geo = new THREE.PlaneGeometry(260, 260, 170, 170);
    geo.rotateX(-Math.PI / 2);
    geo.translate(mx, 0, mz);
    const pos = geo.attributes.position!;
    const farben: number[] = [];
    const c = new THREE.Color();
    const jz = jahreszeit();
    const schneeFarbe = new THREE.Color('#f4f8fb');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = this.hoehe(x, z);
      pos.setY(i, h);
      const n = Math.sin(x * 0.7) * Math.cos(z * 0.9) * 0.5 + Math.sin(x * 0.21 + z * 0.33) * 0.5;
      const bf = bodenFarbe(jz, h);
      c.set(h < -0.15 ? '#cdbb86' : bf.farbe).offsetHSL(n * 0.015, n * 0.05, n * 0.035 + Math.min(Math.max(h, 0), 5) * 0.01);
      // Schnee überall außer am Seeufer (die Rasenflächen der Grundstücke sind eigene Teile und bleiben grün)
      if (bf.schnee && h >= -0.15) c.lerp(schneeFarbe, Math.min(1, bf.schnee + n * 0.04));
      farben.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(farben, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    m.receiveShadow = true;
    m.name = 'boden';
    this.gruppe.add(m);
    for (const s of this.seen) {
      const mat = wasserMaterial('#3f9fd9', Math.max(2, Math.round((s.r + 0.9) / 1.6)), 0.15);
      wasserMaterialien.add(mat);
      const w = new THREE.Mesh(new THREE.CircleGeometry(s.r + 0.9, 48), mat);
      w.rotation.x = -Math.PI / 2;
      w.position.set(s.x, -0.18, s.z);
      w.receiveShadow = true;
      this.gruppe.add(w);
    }
  }

  private wald() {
    const rnd = zufallAus('wald');
    const laub: [number, number, number, number][] = [];
    const nadel: [number, number, number, number][] = [];
    const mx = (this.g.minX + this.g.maxX) / 2;
    const mz = (this.g.minZ + this.g.maxZ) / 2;
    for (let i = 0; i < 60_000 && laub.length + nadel.length < this.o.baeume; i++) {
      const x = mx + (rnd() - 0.5) * 150;
      const z = mz + (rnd() - 0.5) * 150;
      const d = this.abstand(x, z);
      if (d < 0.5) continue;
      if (this.seen.some((s) => Math.hypot(x - s.x, z - s.z) < s.r + 1.2)) continue;
      const dichte = 0.12 + 0.88 * Math.max(0, Math.sin(x * 0.09) * Math.cos(z * 0.11) * 0.8 + Math.min(d / 9, 0.75));
      if (rnd() > dichte) continue;
      (rnd() < 0.55 ? nadel : laub).push([x, this.hoehe(x, z), z, 0.5 + rnd() * 0.45]);
    }
    const inst = (geo: THREE.BufferGeometry, farben: string[], liste: typeof laub, y: number, flach = true) => {
      if (!liste.length) return;
      const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: flach }), liste.length);
      const o = new THREE.Object3D();
      const c = new THREE.Color();
      liste.forEach(([x, h, z, s], i) => {
        o.position.set(x, h + y * s, z);
        o.scale.setScalar(s);
        o.rotation.y = i;
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
        m.setColorAt(i, c.set(farben[i % farben.length]!));
      });
      m.castShadow = true;
      m.receiveShadow = true;
      this.gruppe.add(m);
    };
    inst(new THREE.CylinderGeometry(0.08, 0.11, 0.5, 6), ['#7a4a28'], [...laub, ...nadel], 0.25, false);
    const nf = nadelFarben();
    inst(new THREE.IcosahedronGeometry(0.5, 1), laubFarben(), laub, 0.85);
    inst(new THREE.ConeGeometry(0.45, 1.3, 7), nf.unten, nadel, 0.95);
    inst(new THREE.ConeGeometry(0.33, 0.9, 7), nf.oben, nadel, 1.45);
  }

  entsorgen() {
    this.gruppe.traverse((x) => {
      if (x instanceof THREE.Mesh) {
        x.geometry.dispose();
        wasserEntsorgen(x.material as THREE.Material);
        (x.material as THREE.Material).dispose();
      }
    });
  }
}

/** Welt-Mittelpunkt eines Feldes */
export const feldMitte = (x: number, z: number) => new THREE.Vector3((x + 0.5) * FELD, 0, (z + 0.5) * FELD);

/**
 * Straßen und Wasser als Felder. Fahrbahnmarkierung, Zebrastreifen und Bordsteine ergeben sich aus den
 * Nachbarfeldern; `frei` = Felder ohne Gebäude (dort bekommt die Straße einen Bordstein).
 */
export function strassenUndWasser(b: Bausatz, strassen: [number, number][], wasser: [number, number][], istFrei: (x: number, z: number) => boolean) {
  const s = new Set(strassen.map(([x, z]) => feldSchluessel(x, z)));
  const w = new Set(wasser.map(([x, z]) => feldSchluessel(x, z)));
  const ist = (m: Set<string>, x: number, z: number) => m.has(feldSchluessel(x, z));
  const grad = (x: number, z: number) => +ist(s, x + 1, z) + +ist(s, x - 1, z) + +ist(s, x, z + 1) + +ist(s, x, z - 1);
  const H = FELD / 2;
  for (const [x, z] of strassen) {
    const m = feldMitte(x, z);
    b.mit(m.x, 0, m.z, 0, () => {
      b.teil(quader(FELD, 0.05, FELD), '#575d67', 0, 0.025, 0);
      const ow = ist(s, x + 1, z) || ist(s, x - 1, z);
      const ns = ist(s, x, z + 1) || ist(s, x, z - 1);
      const g = grad(x, z);
      if (g <= 2 && ow && !ns) for (const dx of [-0.31, 0.31]) b.teil(quader(0.36, 0.006, 0.06), '#f2f2f2', dx, 0.053, 0, { keinSchatten: true });
      if (g <= 2 && ns && !ow) for (const dz of [-0.31, 0.31]) b.teil(quader(0.06, 0.006, 0.36), '#f2f2f2', 0, 0.053, dz, { keinSchatten: true });
      // Zebrastreifen vor Kreuzungen
      if (g === 2 && ow && !ns)
        for (const r of [-1, 1]) if (grad(x + r, z) >= 3) for (let i = -2; i <= 2; i++) b.teil(quader(0.24, 0.006, 0.12), '#f5f5f5', r * 0.38, 0.054, i * 0.22, { keinSchatten: true });
      if (g === 2 && ns && !ow)
        for (const r of [-1, 1]) if (grad(x, z + r) >= 3) for (let i = -2; i <= 2; i++) b.teil(quader(0.12, 0.006, 0.24), '#f5f5f5', i * 0.22, 0.054, r * 0.38, { keinSchatten: true });
      // Bordsteine zu freien Feldern
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const nz = z + dz;
        if (ist(s, nx, nz) || ist(w, nx, nz) || !istFrei(nx, nz)) continue;
        b.teil(kasten(dx ? 0.1 : FELD, 0.09, dz ? 0.1 : FELD, 0.02), '#c3bdb2', dx * (H - 0.05), 0.045, dz * (H - 0.05));
      }
    });
  }
  const rnd = zufallAus('wasser');
  // ein Material je Bau (wird mit dem Bausatz-Ergebnis entsorgt: wasserFreigeben)
  const glitzer = wasser.length ? wasserMaterial('#4aa9df', 1, 0.18) : null;
  if (glitzer) wasserMaterialien.add(glitzer);
  for (const [x, z] of wasser) {
    const m = feldMitte(x, z);
    b.mit(m.x, 0, m.z, 0, () => {
      b.teil(quader(FELD, 0.02, FELD), glitzer!, 0, 0.035, 0, { keinSchatten: true });
      b.teil(quader(FELD, 0.02, FELD), '#2f7fae', 0, 0.01, 0, { keinSchatten: true });
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (ist(w, x + dx, z + dz)) continue;
        // Uferkante aus Steinen
        for (let i = -2; i <= 2; i++) {
          const t = (i * FELD) / 5;
          b.teil(kasten(dx ? 0.16 : 0.24, 0.12 + rnd() * 0.05, dz ? 0.16 : 0.24, 0.04), rnd() < 0.5 ? '#a9b0b8' : '#959ca5', dx ? dx * (H - 0.08) : t, 0.06, dz ? dz * (H - 0.08) : t, { ry: rnd() });
        }
        if (rnd() < 0.5) for (let k = 0; k < 3; k++) b.teil(zylinder(0.012, 0.012, 0.35, 4), '#5c8f3a', (dx ? dx * (H - 0.22) : (rnd() - 0.5) * FELD * 0.8), 0.2, dz ? dz * (H - 0.22) : (rnd() - 0.5) * FELD * 0.8, { keinSchatten: true });
      }
      if (rnd() < 0.35) {
        b.teil(scheibe(0.12, 10), '#5fae4a', (rnd() - 0.5) * 0.6, 0.05, (rnd() - 0.5) * 0.6, { keinSchatten: true });
        b.teil(kugel(0.035, 6, 4), '#ff9ec4', (rnd() - 0.5) * 0.6, 0.07, (rnd() - 0.5) * 0.6);
      }
    });
  }
}

/** Wasser-Material eines alten Straßen-/Wasser-Baus freigeben (sonst treiben verwaiste Texturen weiter) */
export function wasserFreigeben(o: THREE.Object3D) {
  o.traverse((x) => {
    if (x instanceof THREE.Mesh && wasserMaterialien.has(x.material as THREE.MeshStandardMaterial)) {
      wasserEntsorgen(x.material as THREE.Material);
      (x.material as THREE.Material).dispose();
    }
  });
}
