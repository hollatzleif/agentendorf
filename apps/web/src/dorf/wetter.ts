import * as THREE from 'three';
import type { DorfWetter, WetterArt } from '@dorf/shared';
import { zufallAus } from './bausatz';

/** Wie trüb das Licht bei welchem Wetter ist (0 = klar, 1 = sehr düster) */
export const TRUEBUNG: Record<WetterArt, number> = { klar: 0, heiter: 0.08, bedeckt: 0.4, nebel: 0.38, niesel: 0.45, regen: 0.55, schnee: 0.4, gewitter: 0.72 };

/** ?wetter=regen (schnee, gewitter, nebel …) zum Ausprobieren – übersteuert den Server */
export function wetterVorgabe(): WetterArt | null {
  const v = new URLSearchParams(location.search).get('wetter');
  return v && v in TRUEBUNG ? (v as WetterArt) : null;
}
export function wetterArtVon(w: DorfWetter | undefined): WetterArt {
  return wetterVorgabe() ?? w?.art ?? 'heiter';
}

const BREITE = 44;
const HOEHE = 16;

/**
 * Regen (Streifen) oder Schnee (Flocken) in einem Kasten um die Bildmitte. Die Teilchen liegen lokal im Kasten,
 * der Kasten folgt der Kamera – so regnet es immer dort, wo man hinschaut.
 */
export class Niederschlag {
  readonly obj: THREE.LineSegments | THREE.Points;
  private pos: Float32Array;
  private regen: boolean;

  constructor(art: 'regen' | 'niesel' | 'schnee' | 'gewitter', anzahl: number) {
    this.regen = art !== 'schnee';
    const rnd = zufallAus(`niederschlag-${art}`);
    const n = art === 'niesel' ? Math.round(anzahl * 0.5) : anzahl;
    const geo = new THREE.BufferGeometry();
    if (this.regen) {
      this.pos = new Float32Array(n * 6);
      const laenge = art === 'niesel' ? 0.25 : 0.55;
      for (let i = 0; i < n; i++) {
        const x = (rnd() - 0.5) * BREITE;
        const y = rnd() * HOEHE;
        const z = (rnd() - 0.5) * BREITE;
        this.pos.set([x, y, z, x + 0.06, y - laenge, z + 0.03], i * 6);
      }
      geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      this.obj = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#b8cde6', transparent: true, opacity: art === 'niesel' ? 0.4 : 0.62, depthWrite: false }));
    } else {
      this.pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) this.pos.set([(rnd() - 0.5) * BREITE, rnd() * HOEHE, (rnd() - 0.5) * BREITE], i * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      this.obj = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffffff', size: 0.24, transparent: true, opacity: 0.92, depthWrite: false }));
    }
    this.obj.frustumCulled = false;
    this.obj.renderOrder = 5;
  }

  tick(dt: number, t: number, mitte: THREE.Vector3) {
    this.obj.position.set(mitte.x, 0, mitte.z);
    const p = this.pos;
    if (this.regen) {
      const fall = 16 * dt;
      for (let i = 0; i < p.length; i += 6) {
        p[i + 1]! -= fall;
        p[i + 4]! -= fall;
        if (p[i + 4]! < 0) {
          p[i + 1]! += HOEHE;
          p[i + 4]! += HOEHE;
        }
      }
    } else {
      for (let i = 0, k = 0; i < p.length; i += 3, k++) {
        p[i + 1]! -= (1 + (k % 5) * 0.12) * dt;
        p[i]! += Math.sin(t * 0.8 + k) * 0.35 * dt;
        if (p[i + 1]! < 0) p[i + 1]! += HOEHE;
      }
    }
    (this.obj.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  entsorgen() {
    this.obj.geometry.dispose();
    (this.obj.material as THREE.Material).dispose();
  }
}
