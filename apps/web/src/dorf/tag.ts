import * as THREE from 'three';
import type { DorfTag } from '@dorf/shared';
import { Bausatz, kasten, kugel, quader, zylinder } from './bausatz';

/**
 * Das Dorf spiegelt den Tag (E131): eine Kreidetafel am Marktplatz zeigt die To-dos von heute, und am Kirchturm
 * brennt ein warmes Licht, solange ein Pomodoro in der Arbeitsphase läuft. Beides nur Anzeige – die Zahlen kommen
 * aus dem Dorfstatus. Vorschau über die Adresse: ?tafel=2/5 (erledigt/insgesamt), ?fokus=1 (oder =0).
 */
export interface TagStand {
  tag?: DorfTag;
  fokus: boolean;
}

/** Serverwerte mit den Vorschau-Schaltern aus der Adresse */
export function tagVon(tag: DorfTag | undefined, fokus: boolean | undefined): TagStand {
  const p = new URLSearchParams(location.search);
  const m = /^(\d{1,3})\/(\d{1,3})$/.exec(p.get('tafel') ?? '');
  const f = p.get('fokus');
  const erledigt = m ? Math.min(Number(m[1]), Number(m[2])) : 0;
  const t = m ? { erledigt, dran: Number(m[2]) - erledigt } : tag;
  return { ...(t ? { tag: t } : {}), fokus: f === null ? !!fokus : !['0', 'nein', 'aus', 'false'].includes(f) };
}

/** Was auf der Tafel steht (auch für Tests und Vorlesen): „Heute ☑ 2/5“ = 2 von 5 erledigt */
export function tafelText(t: DorfTag): string {
  const alle = t.dran + t.erledigt;
  return alle ? `Heute ☑ ${t.erledigt}/${alle}` : 'Heute frei';
}

const KREIDE = '#f4f1e6';
const KREIDE_FERTIG = '#c9eb9c';

/** Kreidetafel auf zwei Pfosten mit kleinem Dach; beide Seiten beschrieben. Ursprung am Boden, Blick nach +z. */
export class Tafel {
  readonly gruppe = new THREE.Group();
  static readonly BREITE = 1.3;
  static readonly HOEHE = 0.96;
  private static readonly PX = 512;
  private static readonly PY = 378;
  private leinwand = document.createElement('canvas');
  private textur: THREE.CanvasTexture;
  private mat: THREE.MeshStandardMaterial;
  private flaeche = new THREE.PlaneGeometry(Tafel.BREITE, Tafel.HOEHE);
  private gestell: THREE.Group;
  private stand = '';

  constructor() {
    const w = Tafel.BREITE;
    const h = Tafel.HOEHE;
    const unten = 0.42;
    const mitte = unten + h / 2;
    // Gestell: je Material ein Mesh (Bausatz), Materialien aus dem gemeinsamen Vorrat
    const b = new Bausatz();
    for (const s of [-1, 1]) {
      b.teil(kasten(0.09, unten + h + 0.12, 0.09, 0.015), '#8a5a32', s * (w / 2 + 0.045), (unten + h + 0.12) / 2, 0);
      b.teil(kasten(0.2, 0.05, 0.3, 0.01), '#5a3a24', s * (w / 2 + 0.045), 0.025, 0);
    }
    b.teil(kasten(w + 0.02, h + 0.02, 0.05, 0.01), '#1d2622', 0, mitte, 0);
    b.teil(quader(w + 0.1, 0.06, 0.09), '#8a5a32', 0, unten - 0.03, 0);
    b.teil(quader(w + 0.1, 0.06, 0.09), '#8a5a32', 0, unten + h + 0.03, 0);
    // Kreideablage mit zwei Kreidestücken
    b.teil(quader(w * 0.7, 0.025, 0.1), '#5a3a24', 0, unten + 0.005, 0.085);
    b.teil(zylinder(0.014, 0.014, 0.09, 6), '#ffffff', -0.18, unten + 0.032, 0.09, { rz: Math.PI / 2 });
    b.teil(zylinder(0.014, 0.014, 0.07, 6), '#ffd23d', 0.05, unten + 0.032, 0.1, { rz: Math.PI / 2, ry: 0.4 });
    // kleines Satteldach gegen den Regen
    for (const s of [-1, 1]) b.teil(kasten(w + 0.36, 0.035, 0.2, 0.01), '#b5523b', 0, unten + h + 0.15, s * 0.075, { rx: s * 0.5 });
    this.gestell = b.fertig();

    this.leinwand.width = Tafel.PX;
    this.leinwand.height = Tafel.PY;
    this.textur = new THREE.CanvasTexture(this.leinwand);
    this.textur.colorSpace = THREE.SRGBColorSpace;
    this.textur.anisotropy = 8;
    // die Schrift leuchtet ganz leicht aus sich heraus – so bleibt sie abends und im Schatten lesbar
    this.mat = new THREE.MeshStandardMaterial({ map: this.textur, emissiveMap: this.textur, emissive: '#ffffff', emissiveIntensity: 0.22, roughness: 0.9 });
    for (const s of [1, -1]) {
      const m = new THREE.Mesh(this.flaeche, this.mat);
      m.position.set(0, mitte, s * 0.027);
      if (s < 0) m.rotation.y = Math.PI;
      m.receiveShadow = true;
      this.gruppe.add(m);
    }
    this.gruppe.add(this.gestell);
    this.gruppe.name = 'tagestafel';
    this.gruppe.traverse((x) => {
      x.raycast = () => undefined; // Klicks gehen ans Gebäude dahinter
    });
  }

  /** Neu beschriften – nur wenn sich die Zahlen geändert haben (kein Zeichnen pro Bild) */
  schreiben(t: DorfTag): boolean {
    const text = tafelText(t);
    if (text === this.stand) return false;
    this.stand = text;
    const px = Tafel.PX;
    const py = Tafel.PY;
    const k = this.leinwand.getContext('2d')!;
    const alle = t.dran + t.erledigt;
    const fertig = alle > 0 && t.dran === 0;
    k.fillStyle = '#25332d';
    k.fillRect(0, 0, px, py);
    // Wischspuren (fest, kein Zufall: gleiche Tafel auf allen Geräten)
    k.strokeStyle = 'rgba(255,255,255,0.045)';
    k.lineCap = 'round';
    k.lineWidth = 46;
    for (const [x1, y1, x2, y2] of [[40, 300, 250, 250], [230, 110, 480, 70], [300, 330, 470, 300]] as const) {
      k.beginPath();
      k.moveTo(x1, y1);
      k.lineTo(x2, y2);
      k.stroke();
    }
    k.fillStyle = KREIDE;
    k.textAlign = 'center';
    k.textBaseline = 'middle';
    k.font = '700 86px system-ui, sans-serif';
    k.fillText('Heute', px / 2, 78);
    k.strokeStyle = KREIDE;
    k.lineWidth = 7;
    k.beginPath();
    k.moveTo(130, 134);
    k.quadraticCurveTo(px / 2, 124, px - 130, 136);
    k.stroke();
    const farbe = fertig ? KREIDE_FERTIG : KREIDE;
    k.fillStyle = farbe;
    if (!alle) {
      k.font = '800 150px system-ui, sans-serif';
      k.fillText('frei', px / 2, 256);
    } else {
      const zahl = `${t.erledigt}/${alle}`;
      let groesse = 190;
      k.font = `800 ${groesse}px system-ui, sans-serif`;
      while (k.measureText(zahl).width > px - 210 && groesse > 60) k.font = `800 ${(groesse -= 6)}px system-ui, sans-serif`;
      const kasten = 112;
      const breite = kasten + 34 + k.measureText(zahl).width;
      const x0 = (px - breite) / 2;
      const y0 = 258;
      // Kästchen mit Haken selbst zeichnen (kein Emoji: sieht überall gleich aus)
      k.strokeStyle = farbe;
      k.lineWidth = 13;
      k.lineJoin = 'round';
      k.strokeRect(x0 + 7, y0 - kasten / 2, kasten - 14, kasten - 14);
      if (t.erledigt > 0) {
        k.lineWidth = 17;
        k.beginPath();
        k.moveTo(x0 + 26, y0 - 8);
        k.lineTo(x0 + 50, y0 + 22);
        k.lineTo(x0 + 104, y0 - 62);
        k.stroke();
      }
      k.textAlign = 'left';
      k.fillText(zahl, x0 + kasten + 34, y0 + 4);
    }
    this.textur.needsUpdate = true;
    return true;
  }

  text() {
    return this.stand;
  }

  entsorgen() {
    this.gestell.traverse((x) => {
      if (x instanceof THREE.Mesh) x.geometry.dispose(); // Materialien gehören dem gemeinsamen Vorrat
    });
    this.flaeche.dispose();
    this.textur.dispose();
    this.mat.dispose();
  }
}

function scheinTextur() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const k = c.getContext('2d')!;
  const g = k.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,225,170,0.5)');
  g.addColorStop(1, 'rgba(255,200,120,0)');
  k.fillStyle = g;
  k.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Fokus am Kirchturm: die vier Zifferblätter schimmern warm, und über der Tür hängt eine kleine Tomaten-Laterne
 * (Pomodoro). Ruhiges Dauerlicht, nichts blinkt. Maße passen zum Kirchturm-Modell (modelle.ts); Ursprung = Gebäudemitte.
 */
export class FokusLicht {
  readonly gruppe = new THREE.Group();
  private warm = new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.34, depthWrite: false, toneMapped: false });
  private tomate = new THREE.MeshStandardMaterial({ color: '#e5402f', emissive: '#ff5a30', emissiveIntensity: 0.9, roughness: 0.45 });
  private scheinMat = new THREE.SpriteMaterial({ map: scheinTextur(), color: '#ffb060', transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
  private scheiben: THREE.Mesh[] = [];
  private eigen: THREE.BufferGeometry[] = [];
  private halter: THREE.Group;

  /** tz = Versatz des Turms auf dem Grundstück, uhrY/uhrHalb = Mitte und Wandabstand der Zifferblätter */
  constructor(o: { tz: number; uhrY: number; uhrHalb: number; tuerZ: number; lampeY: number }) {
    const blatt = new THREE.CircleGeometry(0.5, 32);
    this.eigen.push(blatt);
    for (let k = 0; k < 4; k++) {
      const seite = new THREE.Group();
      seite.position.set(0, 0, o.tz);
      seite.rotation.y = (k * Math.PI) / 2;
      // knapp vor dem Zifferblatt, hinter den Zeigern
      const m = new THREE.Mesh(blatt, this.warm);
      m.position.set(0, o.uhrY, o.uhrHalb + 0.068);
      m.renderOrder = 2;
      seite.add(m);
      this.scheiben.push(m);
      this.gruppe.add(seite);
    }
    // Laterne über der Tür: Ausleger aus dem gemeinsamen Vorrat, die Tomate leuchtet selbst
    const z = o.tz + o.tuerZ;
    const b = new Bausatz();
    b.teil(quader(0.035, 0.035, 0.3), '#3a3530', 0, o.lampeY + 0.2, z + 0.13, { keinSchatten: true });
    b.teil(zylinder(0.008, 0.008, 0.1, 5), '#3a3530', 0, o.lampeY + 0.14, z + 0.25, { keinSchatten: true });
    b.teil(kugel(0.045, 8, 5), '#3f9a4a', 0, o.lampeY + 0.085, z + 0.25, { sy: 0.35, keinSchatten: true });
    this.halter = b.fertig();
    const frucht = new THREE.SphereGeometry(0.11, 14, 10);
    this.eigen.push(frucht);
    const t = new THREE.Mesh(frucht, this.tomate);
    t.scale.y = 0.86;
    t.position.set(0, o.lampeY, z + 0.25);
    const schein = new THREE.Sprite(this.scheinMat);
    schein.position.set(0, o.lampeY, z + 0.3);
    schein.scale.setScalar(0.95);
    this.gruppe.add(this.halter, t, schein);
    this.gruppe.name = 'fokuslicht';
    this.gruppe.traverse((x) => {
      x.raycast = () => undefined;
    });
  }

  /** Am Tag zurückhaltend, in der Dämmerung und nachts deutlicher (dunkel 0–1) */
  nacht(dunkel: number) {
    this.warm.opacity = 0.3 + 0.4 * dunkel;
    this.scheinMat.opacity = 0.38 + 0.5 * dunkel;
    this.tomate.emissiveIntensity = 0.8 + 0.9 * dunkel;
  }

  entsorgen() {
    this.halter.traverse((x) => {
      if (x instanceof THREE.Mesh) x.geometry.dispose();
    });
    for (const g of this.eigen) g.dispose();
    this.warm.dispose();
    this.tomate.dispose();
    this.scheinMat.map?.dispose();
    this.scheinMat.dispose();
  }
}
