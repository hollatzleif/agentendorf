import * as THREE from 'three';
import type { DorfBluete } from '@dorf/shared';
import { zufallAus } from './bausatz';
import type { Jahreszeit } from './jahreszeit';

/**
 * Das Dorf blüht (E112): Darstellung der Blüte im 3D-Dorf – Blumen auf Wiesen und an Wegen, sattere Farben,
 * mehr erleuchtete Fenster, Fahne vor dem Rathaus, Feuerwerk. „karg“ ist bewusst ruhig, nicht trostlos.
 * Zum Ausprobieren: ?bluete=karg|gruen|bluehend|praechtig, ?fahne, ?feuerwerk (übersteuern den Server, nur Darstellung).
 */
export type BlueteStufe = DorfBluete['stufe'];
const STUFEN: BlueteStufe[] = ['karg', 'gruen', 'bluehend', 'praechtig'];

export const BLUETE_TEXT: Record<BlueteStufe, { symbol: string; kurz: string; titel: string; satz: string }> = {
  karg: { symbol: '🌱', kurz: 'ruht', titel: 'Das Dorf ruht', satz: 'Eine ruhige Woche. Jeder aktive Tag lässt es wieder grünen.' },
  gruen: { symbol: '🌿', kurz: 'grünt', titel: 'Das Dorf grünt', satz: 'Es wächst – die ersten Blumen stehen schon.' },
  bluehend: { symbol: '🌸', kurz: 'blüht', titel: 'Das Dorf blüht', satz: 'Überall Blumen: Du bist gut dabei.' },
  praechtig: { symbol: '🌺', kurz: 'prächtig', titel: 'Das Dorf blüht prächtig', satz: 'Volle Blüte – eine starke Woche!' },
};

/** Was je Stufe zu sehen ist */
export const BLUETE_BILD: Record<BlueteStufe, { blumen: number; fenster: number; fensterLicht: number; satt: number }> = {
  // blumen: Anteil der Blumen · fenster: Anteil der Gebäude mit hellen Fenstern (nachts) · satt: Farbsättigung der Wiesen
  karg: { blumen: 0.06, fenster: 0.5, fensterLicht: 0.8, satt: -0.1 },
  gruen: { blumen: 0.3, fenster: 0.7, fensterLicht: 0.85, satt: 0 },
  bluehend: { blumen: 0.65, fenster: 0.88, fensterLicht: 0.95, satt: 0.1 },
  praechtig: { blumen: 1, fenster: 1, fensterLicht: 1.05, satt: 0.18 },
};

const schalter = (p: URLSearchParams, name: string): boolean | null => {
  const v = p.get(name);
  return v === null ? null : !['0', 'nein', 'aus', 'false'].includes(v);
};

/** Serverwert mit den Vorschau-Schaltern aus der Adresse; undefined = nichts bekannt (keine Anzeige) */
export function blueteVon(b: DorfBluete | undefined): DorfBluete | undefined {
  const p = new URLSearchParams(location.search);
  const v = p.get('bluete');
  const stufe = STUFEN.includes(v as BlueteStufe) ? (v as BlueteStufe) : null;
  const fahne = schalter(p, 'fahne');
  const feuerwerk = schalter(p, 'feuerwerk');
  if (!stufe && fahne === null && feuerwerk === null) return b;
  const basis: DorfBluete = b ?? { wert: 0.4, stufe: 'gruen', fahne: false, feuerwerk: false, gruende: [] };
  return {
    ...basis,
    ...(stufe ? { stufe, wert: [0.1, 0.4, 0.6, 0.9][STUFEN.indexOf(stufe)]!, gruende: ['Vorschau (?bluete=)'] } : {}),
    ...(fahne !== null ? { fahne } : {}),
    ...(feuerwerk !== null ? { feuerwerk } : {}),
  };
}

/** Tönung für Rasen und Wiesen (wird mit der Grundfarbe multipliziert): satt > 0 = kräftigeres Grün, < 0 = blasser */
export function wiesenToenung(satt: number, ziel = new THREE.Color()) {
  return ziel.setRGB(1 - satt * 0.55, 1 + satt * 0.12, 1 - satt * 0.9);
}

// ---- Blumen ---------------------------------------------------------------------------------------

const BLUMEN_FARBEN: Record<Jahreszeit, string[]> = {
  fruehling: ['#ff7fa5', '#ffd23d', '#ffffff', '#b07cff', '#ff9ec4', '#ffe98a'],
  sommer: ['#ff5a6e', '#ffd23d', '#ffffff', '#b07cff', '#ff8c42', '#5aa9ff'],
  herbst: ['#ff8c42', '#ffd23d', '#f4efe1', '#c86bd6', '#e8413c', '#ffb347'],
  // Winterblüher: Schneeglöckchen, Christrosen, ein wenig Rosa
  winter: ['#ffffff', '#f3f7ff', '#ffd9e6', '#e8f2c8'],
};

export interface BlumenOrt {
  /** true = hier darf etwas wachsen (freies Feld, kein Wasser) */
  frei(x: number, z: number): boolean;
  /** true = liegt an einem Weg (dort stehen bevorzugt Blumen) */
  amWeg(x: number, z: number): boolean;
  hoehe(x: number, z: number): number;
  grenzen: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/**
 * Blumen als EIN instanziertes Mesh. Alle möglichen Blumen werden einmal verteilt (fest nach Zufallssaat);
 * die Stufe bestimmt nur, wie viele davon gezeichnet werden – höhere Stufen ergänzen die niedrigeren.
 */
export class Blumen {
  readonly mesh: THREE.InstancedMesh;
  private voll = 0;

  constructor(ort: BlumenOrt, hoechstens: number, jz: Jahreszeit) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    geo.scale(1, 0.62, 1);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.7, flatShading: true }), hoechstens);
    this.mesh.name = 'blumen';
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.raycast = () => undefined;
    const rnd = zufallAus('blumen');
    const farben = BLUMEN_FARBEN[jz];
    const { minX, maxX, minZ, maxZ } = ort.grenzen;
    const rand = 7;
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    let n = 0;
    for (let versuch = 0; versuch < hoechstens * 12 && n < hoechstens; versuch++) {
      const x = minX - rand + rnd() * (maxX - minX + 2 * rand);
      const z = minZ - rand + rnd() * (maxZ - minZ + 2 * rand);
      const wuerfel = rnd();
      const farbe = farben[Math.floor(rnd() * farben.length)]!;
      const gruppe = 3 + Math.floor(rnd() * 4);
      if (!ort.frei(x, z)) continue;
      // an Wegen dicht, auf der Wiese lockerer
      if (!ort.amWeg(x, z) && wuerfel > 0.4) continue;
      // ein Tuff aus 3–6 Blüten, meist in einer Farbe
      const tuff = zufallAus(`tuff${versuch}`); // eigene Saat: ändert sich das Layout, bleiben die übrigen Tuffs gleich
      for (let k = 0; k < gruppe && n < hoechstens; k++) {
        const w = tuff() * Math.PI * 2;
        const r = k === 0 ? 0 : 0.12 + tuff() * 0.3;
        const bx = x + Math.cos(w) * r;
        const bz = z + Math.sin(w) * r;
        const s = 0.075 + tuff() * 0.045;
        const andere = tuff() < 0.2;
        if (!ort.frei(bx, bz)) continue;
        o.position.set(bx, ort.hoehe(bx, bz) + 0.05 + s * 0.6, bz);
        o.scale.setScalar(s);
        o.rotation.y = w;
        o.updateMatrix();
        this.mesh.setMatrixAt(n, o.matrix);
        this.mesh.setColorAt(n, c.set(andere ? farben[(n + k) % farben.length]! : farbe));
        n++;
      }
    }
    this.voll = n;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Anteil 0–1 der Blumen zeigen; gibt die Anzahl zurück */
  zeigen(anteil: number) {
    this.mesh.count = Math.round(this.voll * THREE.MathUtils.clamp(anteil, 0, 1));
    this.mesh.visible = this.mesh.count > 0;
    return this.mesh.count;
  }
  anzahl() {
    return this.mesh.count;
  }
  entsorgen() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

// ---- Fahne ----------------------------------------------------------------------------------------

/** Festfahne an einem Mast (alle Wochenziele erreicht): Tuch aus einer unterteilten Fläche, die leicht weht */
export class Fahne {
  readonly gruppe = new THREE.Group();
  private tuch: THREE.Mesh;
  private ruhe: Float32Array;
  private mastMat = new THREE.MeshStandardMaterial({ color: '#e6e6e6', roughness: 0.4, metalness: 0.5 });
  private goldMat = new THREE.MeshStandardMaterial({ color: '#f2c14e', roughness: 0.35, metalness: 0.65 });
  static readonly HOEHE = 3.3;
  static readonly BREITE = 1.0;
  static readonly TUCH = 0.62;

  constructor() {
    const h = Fahne.HOEHE;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.04, h, 8), this.mastMat);
    mast.position.y = h / 2;
    mast.castShadow = true;
    const knauf = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), this.goldMat);
    knauf.position.y = h + 0.05;
    const sockel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.12, 10), this.mastMat);
    sockel.position.y = 0.06;
    // Tuch: Streifen in den Rathausfarben (Blau, Gold, Blau) als Eckenfarben
    const geo = new THREE.PlaneGeometry(Fahne.BREITE, Fahne.TUCH, 12, 6);
    geo.translate(Fahne.BREITE / 2 + 0.03, h - Fahne.TUCH / 2 - 0.06, 0);
    const pos = geo.getAttribute('position');
    const farben = new Float32Array(pos.count * 3);
    const blau = new THREE.Color('#2e5aa8');
    const gold = new THREE.Color('#f7c948');
    const mitte = h - Fahne.TUCH / 2 - 0.06;
    for (let i = 0; i < pos.count; i++) {
      const c = Math.abs(pos.getY(i) - mitte) < Fahne.TUCH / 6 + 0.001 ? gold : blau;
      farben.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(farben, 3));
    this.ruhe = new Float32Array(pos.array as Float32Array);
    this.tuch = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.75, flatShading: false }));
    this.tuch.castShadow = true;
    this.gruppe.add(mast, knauf, sockel, this.tuch);
    this.gruppe.name = 'festfahne';
    this.gruppe.traverse((x) => {
      x.raycast = () => undefined;
    });
    this.tick(0);
  }

  /** Wellen im Tuch; am Mast fest, zum freien Ende hin stärker */
  tick(t: number) {
    const pos = this.tuch.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    for (let i = 0; i < a.length; i += 3) {
      const u = (this.ruhe[i]! - 0.03) / Fahne.BREITE; // 0 am Mast, 1 am freien Ende
      const welle = Math.sin(u * 5.2 - t * 4.2) * 0.075 + Math.sin(u * 9 - t * 6.5 + 1.3) * 0.025;
      a[i + 2] = welle * u;
      a[i + 1] = this.ruhe[i + 1]! - u * u * 0.05 + Math.sin(t * 2.1 + u * 3) * 0.012 * u;
    }
    pos.needsUpdate = true;
    this.tuch.geometry.computeVertexNormals();
  }

  entsorgen() {
    this.gruppe.traverse((x) => {
      if (x instanceof THREE.Mesh) x.geometry.dispose();
    });
    (this.tuch.material as THREE.Material).dispose();
    this.mastMat.dispose();
    this.goldMat.dispose();
  }
}

// ---- Feuerwerk ------------------------------------------------------------------------------------

function funkenTextur() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const k = c.getContext('2d')!;
  const g = k.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  k.fillStyle = g;
  k.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const FUNKEN = 56;
const RAKETEN = 5;
const BUNT = ['#ffc21a', '#ff4f7b', '#3fb8ff', '#62e04a', '#ff8a1f', '#b56bff', '#ffffff'];

/**
 * Kurzes, dezentes Feuerwerk über dem Dorf (heute ≥ 5 To-dos erledigt): fünf Raketen innerhalb weniger Sekunden,
 * dann Ruhe bis zur nächsten Runde. Ein einziges Points-Objekt für alle Funken.
 */
export class Feuerwerk {
  readonly obj: THREE.Points;
  private pos: Float32Array;
  private farbe: Float32Array;
  private v: Float32Array;
  private grund: Float32Array;
  private raketen: { start: number; ziel: THREE.Vector3; geplatzt: boolean; t: number }[] = [];
  private zeit = 0;
  private dauer = 0;
  private textur = funkenTextur();
  /** Sekunden bis zur nächsten Runde */
  private pause: number;
  runden = 0;

  constructor(
    private mitte: () => THREE.Vector3,
    private breite: () => number,
    erstePause = 2.5,
    private abstand = 240,
  ) {
    const n = RAKETEN * (FUNKEN + 1);
    this.pos = new Float32Array(n * 3).fill(-999);
    this.farbe = new Float32Array(n * 3);
    this.grund = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.farbe, 3));
    this.obj = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.55, map: this.textur, vertexColors: true, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    this.obj.frustumCulled = false;
    this.obj.renderOrder = 6;
    this.obj.visible = false;
    this.obj.raycast = () => undefined;
    this.pause = erstePause;
  }

  laeuft() {
    return this.raketen.length > 0;
  }

  /** Eine Runde sofort starten (auch für Tests) */
  zuenden() {
    const m = this.mitte();
    const b = Math.max(5, this.breite() * 0.22);
    this.raketen = [];
    for (let i = 0; i < RAKETEN; i++) {
      this.raketen.push({
        start: i * 0.75 + Math.random() * 0.35,
        ziel: new THREE.Vector3(m.x + (Math.random() - 0.5) * 2 * b, 7.5 + Math.random() * 3.5, m.z + (Math.random() - 0.5) * 2 * b),
        geplatzt: false,
        t: 0,
      });
    }
    this.pos.fill(-999);
    this.zeit = 0;
    this.dauer = RAKETEN * 0.75 + 3;
    this.obj.visible = true;
    this.runden++;
  }

  /** true = es bewegt sich etwas. hell = 0 (Nacht) … 1 (Tag): am Tag kräftigere, deckende Funken */
  tick(dt: number, hell: number, himmel: THREE.Color) {
    if (!this.raketen.length) {
      this.pause -= dt;
      if (this.pause > 0) return false;
      this.pause = this.abstand;
      this.zuenden();
    }
    const mat = this.obj.material as THREE.PointsMaterial;
    const tags = hell > 0.5;
    if ((mat.blending === THREE.AdditiveBlending) === tags) {
      mat.blending = tags ? THREE.NormalBlending : THREE.AdditiveBlending;
      mat.needsUpdate = true;
    }
    mat.size = tags ? 1.0 : 1.3;
    this.zeit += dt;
    const c = new THREE.Color();
    this.raketen.forEach((r, i) => {
      const basis = i * (FUNKEN + 1);
      const t = this.zeit - r.start;
      if (t < 0) return;
      const steig = 0.9;
      if (t < steig) {
        // Rakete steigt als einzelner heller Punkt
        const k = t / steig;
        this.pos.set([r.ziel.x, 0.5 + (r.ziel.y - 0.5) * (1 - (1 - k) * (1 - k)), r.ziel.z], basis * 3);
        this.farbe.set([1, 0.9, 0.6], basis * 3);
        return;
      }
      if (!r.geplatzt) {
        r.geplatzt = true;
        this.pos.set([0, -999, 0], basis * 3);
        const f1 = BUNT[Math.floor(Math.random() * BUNT.length)]!;
        const f2 = Math.random() < 0.4 ? BUNT[Math.floor(Math.random() * BUNT.length)]! : f1;
        const kraft = 3.4 + Math.random() * 1.4;
        for (let k = 1; k <= FUNKEN; k++) {
          // gleichmäßig auf einer Kugel
          const y = 1 - (2 * (k - 0.5)) / FUNKEN;
          const rr = Math.sqrt(1 - y * y);
          const w = k * 2.399963;
          const s = kraft * (0.85 + Math.random() * 0.3);
          const j = (basis + k) * 3;
          this.v.set([Math.cos(w) * rr * s, y * s, Math.sin(w) * rr * s], j);
          this.pos.set([r.ziel.x, r.ziel.y, r.ziel.z], j);
          c.set(k % 2 ? f1 : f2);
          this.grund.set([c.r, c.g, c.b], j);
        }
      }
      r.t = t - steig;
      const leben = 1.9;
      const rest = Math.max(0, 1 - r.t / leben);
      // nachts verglühen die Funken (additives Licht); am Tag verblassen sie zur Himmelsfarbe
      const hellig = tags ? 1 : rest * rest * (0.75 + Math.random() * 0.25);
      const blass = tags ? (1 - rest) ** 3 : 0;
      for (let k = 1; k <= FUNKEN; k++) {
        const j = (basis + k) * 3;
        if (r.t > leben) {
          this.pos[j + 1] = -999;
          continue;
        }
        const brems = 1 - dt * 1.6;
        this.v[j]! *= brems;
        this.v[j + 1] = this.v[j + 1]! * brems - 1.5 * dt;
        this.v[j + 2]! *= brems;
        this.pos[j]! += this.v[j]! * dt;
        this.pos[j + 1]! += this.v[j + 1]! * dt;
        this.pos[j + 2]! += this.v[j + 2]! * dt;
        this.farbe[j] = (this.grund[j]! + (himmel.r - this.grund[j]!) * blass) * hellig;
        this.farbe[j + 1] = (this.grund[j + 1]! + (himmel.g - this.grund[j + 1]!) * blass) * hellig;
        this.farbe[j + 2] = (this.grund[j + 2]! + (himmel.b - this.grund[j + 2]!) * blass) * hellig;
      }
    });
    (this.obj.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.obj.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    if (this.zeit > this.dauer) {
      this.raketen = [];
      this.obj.visible = false;
    }
    return true;
  }

  entsorgen() {
    this.obj.geometry.dispose();
    (this.obj.material as THREE.Material).dispose();
    this.textur.dispose();
  }
}
