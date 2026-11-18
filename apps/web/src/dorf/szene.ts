import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GRUNDSTUECK, belegungBerechnen, feldSchluessel, type DorfLayout, type DorfStatus, type Gebaeude } from '@dorf/shared';
import { Bausatz, entsorgen, ikosaeder, material, zufallAus } from './bausatz';
import { BODEN, FELD, PLATZ, auto, dekoBauen, gebaeudeModell, modellArt, type Modell } from './modelle';
import { Gelaende, feldMitte, strassenUndWasser, type Grenzen } from './gelaende';
import { Figuren } from './figuren';
import { blase, namensschild, type BlasenArt } from './blasen';
import { wegFinden } from './wege';

export type SzeneTreffer =
  | { art: 'gebaeude'; id: string }
  | { art: 'figur'; laufId: string }
  | { art: 'buergermeister' }
  | { art: 'feld'; x: number; z: number };

/** Schnittstelle für den Bau-Modus (bauen.ts). zeigerRunter → true = Geste übernehmen (keine Kamerabewegung). */
export interface BauHandler {
  zeigerRunter(t: SzeneTreffer | null, feld: [number, number] | null, e: PointerEvent): boolean;
  zeigerBewegt(feld: [number, number] | null, e: PointerEvent, gezogen: boolean): void;
  zeigerHoch(feld: [number, number] | null, e: PointerEvent): void;
}

export interface SzeneDaten {
  gebaeude: Gebaeude[];
  layout: DorfLayout;
  status?: DorfStatus;
}

interface GebaeudeEintrag {
  schluessel: string;
  modell: Modell;
  huelle: THREE.Group;
  pick: THREE.Mesh;
  schild: THREE.Sprite;
  blasen: THREE.Group;
  blasenSchluessel: string;
  rauch: Rauch[];
  rot: boolean;
}

const DREH = (d: number) => (d * Math.PI) / 2;
const ROT = material('#e0402f');
const ROT_DUNKEL = material('#c4321f');

class Rauch {
  readonly gruppe = new THREE.Group();
  private puffs: { m: THREE.Mesh; t: number }[] = [];
  constructor(pos: THREE.Vector3, statisch: boolean) {
    this.gruppe.position.copy(pos);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(ikosaeder(0.2, 1), new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 1, transparent: true, depthWrite: false }));
      this.gruppe.add(m);
      this.puffs.push({ m, t: i / 6 });
    }
    this.tick(0, statisch);
  }
  tick(dt: number, statisch = false) {
    for (const p of this.puffs) {
      if (!statisch) p.t = (p.t + dt * 0.28) % 1;
      const t = p.t;
      p.m.position.set(Math.sin(t * 5 + p.t) * 0.12 + t * 0.35, t * 1.9, -t * 0.15);
      p.m.scale.setScalar(0.55 + t * 1.4);
      (p.m.material as THREE.MeshStandardMaterial).opacity = Math.min(1, t * 6) * (1 - t) * 0.95;
    }
  }
  entsorgen() {
    for (const p of this.puffs) (p.m.material as THREE.Material).dispose();
  }
}

class Autos {
  readonly gruppe = new THREE.Group();
  private liste: { obj: THREE.Group; von: [number, number]; nach: [number, number]; vor: [number, number] | null; t: number; v: number }[] = [];
  private s = new Set<string>();
  constructor(strassen: [number, number][]) {
    this.s = new Set(strassen.map(([x, z]) => feldSchluessel(x, z)));
    const rnd = zufallAus(`autos${strassen.length}`);
    const n = Math.min(8, Math.floor(strassen.length / 10));
    const farben = ['#e8413c', '#3b6fd8', '#ffc23d', '#f7f7f7', '#2fa36b', '#8a5adf', '#f28c28', '#2b3a55'];
    for (let i = 0; i < n; i++) {
      const start = strassen[Math.floor(rnd() * strassen.length)]!;
      const nach = this.nachbar(start, null, rnd) ?? start;
      const obj = auto(farben[i % farben.length]!);
      this.gruppe.add(obj);
      this.liste.push({ obj, von: start, nach, vor: null, t: rnd(), v: 1.8 + rnd() * 0.8 });
    }
  }
  private nachbar(f: [number, number], vor: [number, number] | null, rnd = Math.random): [number, number] | null {
    const n = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const)
      .map(([dx, dz]) => [f[0] + dx, f[1] + dz] as [number, number])
      .filter(([x, z]) => this.s.has(feldSchluessel(x, z)));
    const ohneRueck = n.filter((p) => !vor || p[0] !== vor[0] || p[1] !== vor[1]);
    const w = ohneRueck.length ? ohneRueck : n;
    return w.length ? w[Math.floor(rnd() * w.length)]! : null;
  }
  tick(dt: number) {
    for (const a of this.liste) {
      a.t += (dt * a.v) / FELD;
      while (a.t >= 1) {
        a.t -= 1;
        const neu = this.nachbar(a.nach, a.von);
        a.vor = a.von;
        a.von = a.nach;
        a.nach = neu ?? a.von;
      }
      const p = feldMitte(...a.von).lerp(feldMitte(...a.nach), a.t);
      const r = new THREE.Vector3(a.nach[0] - a.von[0], 0, a.nach[1] - a.von[1]);
      if (r.lengthSq() > 0) {
        // Rechtsverkehr: Spur rechts der Fahrtrichtung
        p.add(new THREE.Vector3(-r.z, 0, r.x).multiplyScalar(0.27));
        const ziel = Math.atan2(-r.z, r.x);
        let diff = ziel - a.obj.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        a.obj.rotation.y += diff * Math.min(1, dt * 8);
      }
      a.obj.position.set(p.x, 0.05, p.z);
    }
  }
}

export interface KameraStand {
  ziel: [number, number, number];
  pos: [number, number, number];
}

export class DorfSzene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private kamera: THREE.PerspectiveCamera;
  private steuerung: OrbitControls;
  private sonne: THREE.DirectionalLight;
  private stadt = new THREE.Group();
  private blasenEbene = new THREE.Group();
  private gebaeude = new Map<string, GebaeudeEintrag>();
  private statisch: { schluessel: string; gruppe: THREE.Group } | null = null;
  private gelaende: { schluessel: string; g: Gelaende } | null = null;
  private autos: Autos | null = null;
  private figuren: Figuren;
  private raster: THREE.LineSegments | null = null;
  private markierung: THREE.InstancedMesh;
  private daten: SzeneDaten | null = null;
  private strassenSet = new Set<string>();
  private grenzen: Grenzen = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
  private uhr = new THREE.Clock();
  private schmutzig = true;
  private laeuft = true;
  private raf = 0;
  private beobachter: ResizeObserver;
  private zeiger: { x: number; y: number; zeit: number; id: number } | null = null;
  private bauZieht = false;
  private kameraAnimation: { von: number; nach: number; t: number } | null = null;
  bau: BauHandler | null = null;
  /** angetipptes Gebäude: goldener Rahmen + kurzer Hüpfer */
  private auswahl: { id: string; rahmen: THREE.Group; t: number } | null = null;
  /** Software-Grafik (z. B. Testbrowser, sehr alte Geräte): nur bei Änderungen zeichnen, keine Daueranimation */
  readonly sparsam: boolean;
  private voll = false;

  constructor(
    private el: HTMLElement,
    private o: { reduziert: boolean; handy: boolean; onKlick: (t: SzeneTreffer) => void; kamera?: KameraStand | null },
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, o.handy ? 1.75 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.setAttribute('aria-label', 'Das Dorf in 3D – Gebäude und Figuren anklickbar');
    el.appendChild(this.renderer.domElement);
    const gl = this.renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    this.sparsam = /swiftshader|llvmpipe|software/i.test(info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '') && !new URLSearchParams(location.search).has('animiert');
    // ?voll: auch mit Software-Grafik volle Qualität (für Bildschirmfotos), aber weiter nur bei Änderungen zeichnen
    this.voll = new URLSearchParams(location.search).has('voll');
    if (this.sparsam && !this.voll) this.renderer.setPixelRatio(1);

    this.scene.background = new THREE.Color('#bfe2f3');
    this.scene.fog = new THREE.Fog('#cfe7f2', 60, 140);
    this.scene.add(new THREE.HemisphereLight('#d8f0ff', '#5d8a3a', 1.35));
    this.sonne = new THREE.DirectionalLight('#fff0d0', 2.6);
    this.sonne.castShadow = true;
    const ms = o.handy ? 2048 : 4096;
    this.sonne.shadow.mapSize.set(ms, ms);
    this.sonne.shadow.bias = -0.0004;
    this.sonne.shadow.normalBias = 0.02;
    this.scene.add(this.sonne, this.sonne.target);
    this.scene.add(this.stadt, this.blasenEbene);

    this.kamera = new THREE.PerspectiveCamera(o.handy ? 38 : 30, 1, 0.3, 400);
    this.zeigerEinrichten();
    this.steuerung = new OrbitControls(this.kamera, this.renderer.domElement);
    this.steuerung.enableDamping = !o.reduziert && !this.sparsam;
    this.steuerung.dampingFactor = 0.12;
    this.steuerung.screenSpacePanning = false;
    this.steuerung.minDistance = 7;
    this.steuerung.maxDistance = 90;
    this.steuerung.minPolarAngle = 0.35;
    this.steuerung.maxPolarAngle = 1.2;
    this.steuerung.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.steuerung.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.steuerung.zoomToCursor = true;
    this.steuerung.addEventListener('change', () => {
      this.zielBegrenzen();
      this.schmutzig = true;
    });
    if (o.kamera) {
      this.steuerung.target.set(...o.kamera.ziel);
      this.kamera.position.set(...o.kamera.pos);
    }

    const geo = new THREE.PlaneGeometry(FELD * 0.94, FELD * 0.94);
    geo.rotateX(-Math.PI / 2);
    this.markierung = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45, depthWrite: false }), 64);
    this.markierung.count = 0;
    this.markierung.renderOrder = 5;
    this.scene.add(this.markierung);

    this.figuren = new Figuren(
      {
        platz: (id, slot) => this.platz(id, slot),
        weg: (a, b) => this.weg(a, b),
      },
      o.reduziert || this.sparsam,
    );
    this.scene.add(this.figuren.gruppe);

    this.beobachter = new ResizeObserver(() => this.groesse());
    this.beobachter.observe(el);
    this.groesse();
    document.addEventListener('visibilitychange', this.sichtbarkeit);
    this.schleife();
  }

  // ---- Daten → Szene ----------------------------------------------------------------------------

  setzen(d: SzeneDaten) {
    const erstes = !this.daten;
    this.daten = d;
    const sichtbar = d.gebaeude.filter((g) => d.layout.gebaeude[g.id]);
    this.grenzenBerechnen(d.layout);

    // Gelände nur neu, wenn sich die Grenzen deutlich ändern
    const gk = `${Math.round(this.grenzen.minX / 10)},${Math.round(this.grenzen.maxX / 10)},${Math.round(this.grenzen.minZ / 10)},${Math.round(this.grenzen.maxZ / 10)}`;
    if (this.gelaende?.schluessel !== gk) {
      if (this.gelaende) {
        this.scene.remove(this.gelaende.g.gruppe);
        this.gelaende.g.entsorgen();
      }
      const g = new Gelaende(this.grenzen, { baeume: this.sparsam && !this.voll ? 500 : this.o.handy ? 1500 : 3200 });
      this.scene.add(g.gruppe);
      this.gelaende = { schluessel: gk, g };
    }

    // Gebäude (Modelle werden nur bei geänderter Art neu gebaut)
    const ids = new Set(sichtbar.map((g) => g.id));
    for (const [id, e] of this.gebaeude) if (!ids.has(id)) this.gebaeudeEntfernen(id, e);
    for (const g of sichtbar) {
      const schluessel = `${modellArt(g)}|${g.name}`;
      let e = this.gebaeude.get(g.id);
      if (e && e.schluessel !== schluessel) {
        this.gebaeudeEntfernen(g.id, e);
        e = undefined;
      }
      if (!e) e = this.gebaeudeAnlegen(g, schluessel);
      const p = d.layout.gebaeude[g.id]!;
      this.gebaeudePlatzieren(e, p.x, p.z, p.dreh);
    }

    // Straßen, Wasser, Deko
    const { belegung } = belegungBerechnen(d.layout);
    const sk = JSON.stringify([d.layout.strassen, d.layout.wasser, d.layout.deko, Object.values(d.layout.gebaeude).map((g) => [g.x, g.z])]);
    if (this.statisch?.schluessel !== sk) {
      if (this.statisch) {
        this.stadt.remove(this.statisch.gruppe);
        entsorgen(this.statisch.gruppe);
      }
      const b = new Bausatz();
      strassenUndWasser(b, d.layout.strassen, d.layout.wasser, (x, z) => belegung.get(feldSchluessel(x, z))?.art !== 'gebaeude');
      const rnd = zufallAus('deko');
      for (const k of d.layout.deko) {
        const m = feldMitte(k.x, k.z);
        dekoBauen(b, k.art, m.x, m.z, k.dreh, rnd);
      }
      const gruppe = b.fertig();
      this.stadt.add(gruppe);
      this.statisch = { schluessel: sk, gruppe };
      this.strassenSet = new Set(d.layout.strassen.map(([x, z]) => feldSchluessel(x, z)));
      if (this.autos) this.scene.remove(this.autos.gruppe);
      this.autos = null;
      if (!this.o.reduziert && !this.sparsam && d.layout.strassen.length >= 10) {
        this.autos = new Autos(d.layout.strassen);
        this.scene.add(this.autos.gruppe);
      }
      this.figuren.neuPlatzieren();
    }

    this.statusSetzen(d.status);
    this.schattenAnpassen();
    if (erstes && !this.o.kamera) this.zentrieren(false);
    this.schmutzig = true;
  }

  private grenzenBerechnen(l: DorfLayout) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const feld = (x: number, z: number) => {
      minX = Math.min(minX, x * FELD);
      maxX = Math.max(maxX, (x + 1) * FELD);
      minZ = Math.min(minZ, z * FELD);
      maxZ = Math.max(maxZ, (z + 1) * FELD);
    };
    for (const g of Object.values(l.gebaeude)) {
      feld(g.x, g.z);
      feld(g.x + GRUNDSTUECK - 1, g.z + GRUNDSTUECK - 1);
    }
    for (const [x, z] of [...l.strassen, ...l.wasser]) feld(x, z);
    for (const d of l.deko) feld(d.x, d.z);
    if (!Number.isFinite(minX)) {
      minX = -10;
      maxX = 10;
      minZ = -10;
      maxZ = 10;
    }
    this.grenzen = { minX, maxX, minZ, maxZ };
  }

  private gebaeudeAnlegen(g: Gebaeude, schluessel: string): GebaeudeEintrag {
    const modell = gebaeudeModell(g);
    const huelle = new THREE.Group();
    huelle.add(modell.gruppe);
    const pick = new THREE.Mesh(new THREE.BoxGeometry(PLATZ, modell.hoehe, PLATZ), new THREE.MeshBasicMaterial({ visible: false }));
    pick.position.y = modell.hoehe / 2;
    pick.userData = { gebaeude: g.id };
    huelle.add(pick);
    this.stadt.add(huelle);
    const schild = namensschild(g.status === 'geschlossen' || g.fehler ? `${g.name} (bald)` : g.name);
    schild.userData = { gebaeude: g.id };
    this.blasenEbene.add(schild);
    const blasen = new THREE.Group();
    this.blasenEbene.add(blasen);
    const e: GebaeudeEintrag = { schluessel, modell, huelle, pick, schild, blasen, blasenSchluessel: '', rauch: [], rot: false };
    this.gebaeude.set(g.id, e);
    return e;
  }

  private gebaeudeEntfernen(id: string, e: GebaeudeEintrag) {
    this.stadt.remove(e.huelle);
    this.blasenEbene.remove(e.schild, e.blasen);
    for (const r of e.rauch) r.entsorgen();
    entsorgen(e.huelle);
    (e.schild.material as THREE.SpriteMaterial).map?.dispose();
    e.schild.material.dispose();
    this.gebaeude.delete(id);
  }

  private gebaeudePlatzieren(e: GebaeudeEintrag, x: number, z: number, dreh: number) {
    const mitte = new THREE.Vector3((x + GRUNDSTUECK / 2) * FELD, 0, (z + GRUNDSTUECK / 2) * FELD);
    e.huelle.position.copy(mitte);
    e.huelle.rotation.y = DREH(dreh);
    const vorn = new THREE.Vector3(0, 0, PLATZ / 2 + 0.1).applyAxisAngle(new THREE.Vector3(0, 1, 0), DREH(dreh));
    e.schild.position.copy(mitte).add(vorn).setY(0.55);
    e.blasen.position.copy(mitte).setY(e.modell.hoehe);
  }

  /** Gebäude hervorheben (Spiel-Auswahl) – null hebt auf */
  waehlen(id: string | null) {
    if (this.auswahl?.id === id) return;
    if (this.auswahl) {
      this.scene.remove(this.auswahl.rahmen);
      this.auswahl.rahmen.traverse((o) => {
        if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose();
      });
      const alt = this.gebaeude.get(this.auswahl.id);
      if (alt) alt.modell.gruppe.scale.set(1, 1, 1);
      this.auswahl = null;
    }
    const e = id ? this.gebaeude.get(id) : undefined;
    if (id && e) {
      const rahmen = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: '#ffd84a', transparent: true, opacity: 0.9, depthWrite: false });
      const s2 = PLATZ / 2 + 0.06;
      for (const [x, z, w, d] of [[0, s2, PLATZ + 0.24, 0.12], [0, -s2, PLATZ + 0.24, 0.12], [s2, 0, 0.12, PLATZ + 0.24], [-s2, 0, 0.12, PLATZ + 0.24]] as const) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), mat);
        m.position.set(x, 0.2, z);
        rahmen.add(m);
      }
      // Eckpfeiler wie Markierungen
      for (const [x, z] of [[s2, s2], [-s2, s2], [s2, -s2], [-s2, -s2]] as const) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.35, 10), mat);
        m.position.set(x, 0.3, z);
        rahmen.add(m);
      }
      rahmen.position.copy(e.huelle.position);
      rahmen.rotation.y = e.huelle.rotation.y;
      rahmen.renderOrder = 6;
      this.scene.add(rahmen);
      this.auswahl = { id, rahmen, t: 0 };
    }
    this.schmutzig = true;
  }

  /** Vorschau beim Verschieben (ohne Layout zu ändern) */
  vorschau(id: string, x: number, z: number, dreh: number) {
    const e = this.gebaeude.get(id);
    if (!e) return;
    this.gebaeudePlatzieren(e, x, z, dreh);
    this.schmutzig = true;
  }

  private statusSetzen(s: DorfStatus | undefined) {
    for (const [id, e] of this.gebaeude) {
      const st = s?.gebaeude[id];
      const g = this.daten?.gebaeude.find((x) => x.id === id);
      // rotes Dach bei Frist < 3 Tage
      const rot = !!st?.frist;
      if (rot !== e.rot) {
        e.modell.gruppe.traverse((m) => {
          if (!(m instanceof THREE.Mesh) || (m.name !== 'dach' && m.name !== 'dach2')) return;
          m.userData.orig ??= m.material;
          m.material = rot ? (m.name === 'dach' ? ROT : ROT_DUNKEL) : m.userData.orig;
        });
        e.rot = rot;
      }
      // Rauch, wenn ein Agent arbeitet
      const raucht = (st?.arbeitet ?? 0) > 0;
      if (raucht && !e.rauch.length) {
        for (const p of e.modell.rauch) {
          const r = new Rauch(p, this.o.reduziert || this.sparsam);
          e.modell.gruppe.add(r.gruppe);
          e.rauch.push(r);
        }
      } else if (!raucht && e.rauch.length) {
        for (const r of e.rauch) {
          e.modell.gruppe.remove(r.gruppe);
          r.entsorgen();
        }
        e.rauch = [];
      }
      // Blasen: Brief (Freigabe), Baustelle (Aufgaben), Uhr (Frist), Fehler (gebaeude.md kaputt)
      const arten: BlasenArt[] = [];
      if (g?.fehler) arten.push('fehler');
      if (st?.freigaben) arten.push('brief');
      if (st?.aufgaben) arten.push('baustelle');
      if (st?.frist) arten.push('uhr');
      const k = arten.join(',');
      if (k !== e.blasenSchluessel) {
        e.blasen.clear();
        arten.forEach((a, i) => {
          const b = blase(a, 1.5);
          b.position.x = (i - (arten.length - 1) / 2) * 1.6;
          b.userData.gebaeude = id;
          e.blasen.add(b);
        });
        e.blasenSchluessel = k;
      }
    }
    this.figuren.aktualisieren(s?.figuren ?? []);
    this.schmutzig = true;
  }

  // ---- Orte und Wege für Figuren -----------------------------------------------------------------

  private platz(id: string, slot: number) {
    const p = this.daten?.layout.gebaeude[id];
    if (!p || !this.gebaeude.has(id)) return null;
    const mitte = new THREE.Vector3((p.x + GRUNDSTUECK / 2) * FELD, BODEN, (p.z + GRUNDSTUECK / 2) * FELD);
    const lokal =
      slot === 4 ? new THREE.Vector3(-0.85, 0, PLATZ / 2 - 0.55) : slot === 5 ? new THREE.Vector3(0.0, 0, PLATZ / 2 - 0.15) : new THREE.Vector3(-1.4 + (slot % 4) * 0.93, 0, PLATZ / 2 - 0.55 - Math.floor(slot / 4) * 0.25);
    const pos = mitte.add(lokal.applyAxisAngle(new THREE.Vector3(0, 1, 0), DREH(p.dreh)));
    // Agenten schauen zum Gebäude, der Bürgermeister nach vorn
    return { pos, blick: DREH(p.dreh) + (slot === 4 || slot === 5 ? 0 : Math.PI) };
  }

  private naechsteStrasse(p: THREE.Vector3): [number, number] | null {
    let best: [number, number] | null = null;
    let bd = Infinity;
    for (const k of this.strassenSet) {
      const [x, z] = k.split(',').map(Number) as [number, number];
      const d = feldMitte(x, z).distanceToSquared(p);
      if (d < bd) {
        bd = d;
        best = [x, z];
      }
    }
    return best && bd < 16 * FELD * FELD ? best : null;
  }

  private weg(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3[] {
    const sa = this.naechsteStrasse(a);
    const sb = this.naechsteStrasse(b);
    if (!sa || !sb) return [b.clone()];
    const felder = wegFinden(sa, sb, (x, z) => this.strassenSet.has(feldSchluessel(x, z)));
    if (!felder) return [b.clone()];
    // Fußgänger gehen am Fahrbahnrand
    const pts = felder.map(([x, z]) => feldMitte(x, z).setY(0.06));
    return [...pts, b.clone()];
  }

  // ---- Kamera ---------------------------------------------------------------------------------------

  zentrieren(sanft = true) {
    // ganzes Dorf ins Bild: Mitte der bebauten Fläche, Abstand nach Größe und Bildformat
    const ziel = new THREE.Vector3((this.grenzen.minX + this.grenzen.maxX) / 2, 0, (this.grenzen.minZ + this.grenzen.maxZ) / 2);
    const breite = Math.max(this.grenzen.maxX - this.grenzen.minX, this.grenzen.maxZ - this.grenzen.minZ);
    const hochkant = this.kamera.aspect < 1;
    const abstand = THREE.MathUtils.clamp(breite * (hochkant ? 2.5 : 1.35), 20, 95);
    // Hochformat: steiler von oben, damit das Dorf die Höhe nutzt
    const richtung = (hochkant ? new THREE.Vector3(0.36, 1.3, 0.74) : new THREE.Vector3(0.42, 0.78, 0.86)).normalize();
    this.steuerung.target.copy(ziel);
    this.kamera.position.copy(ziel).addScaledVector(richtung, abstand);
    void sanft;
    this.steuerung.update();
    this.schmutzig = true;
  }

  /** Um 90° drehen (Knöpfe) */
  drehen(richtung: 1 | -1) {
    const v = this.kamera.position.clone().sub(this.steuerung.target);
    const von = Math.atan2(v.x, v.z);
    if (this.o.reduziert || this.sparsam) {
      v.applyAxisAngle(new THREE.Vector3(0, 1, 0), (richtung * Math.PI) / 2);
      this.kamera.position.copy(this.steuerung.target).add(v);
      this.steuerung.update();
    } else this.kameraAnimation = { von, nach: von + (richtung * Math.PI) / 2, t: 0 };
    this.schmutzig = true;
  }

  zoomen(faktor: number) {
    const v = this.kamera.position.clone().sub(this.steuerung.target);
    const l = THREE.MathUtils.clamp(v.length() * faktor, this.steuerung.minDistance, this.steuerung.maxDistance);
    this.kamera.position.copy(this.steuerung.target).add(v.setLength(l));
    this.steuerung.update();
    this.schmutzig = true;
  }

  kameraStand(): KameraStand {
    return { ziel: this.steuerung.target.toArray() as [number, number, number], pos: this.kamera.position.toArray() as [number, number, number] };
  }

  private zielBegrenzen() {
    const t = this.steuerung.target;
    const r = 12;
    const cx = THREE.MathUtils.clamp(t.x, this.grenzen.minX - r, this.grenzen.maxX + r);
    const cz = THREE.MathUtils.clamp(t.z, this.grenzen.minZ - r, this.grenzen.maxZ + r);
    if (cx !== t.x || cz !== t.z || t.y !== 0) {
      const d = new THREE.Vector3(cx - t.x, -t.y, cz - t.z);
      t.add(d);
      this.kamera.position.add(d);
    }
    const dist = this.kamera.position.distanceTo(t);
    const nebel = this.scene.fog as THREE.Fog;
    nebel.near = dist * 1.6 + 10;
    nebel.far = dist * 3.4 + 40;
  }

  private schattenAnpassen() {
    const { minX, maxX, minZ, maxZ } = this.grenzen;
    const m = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    const h = Math.max(maxX - minX, maxZ - minZ) / 2 + 10;
    const c = this.sonne.shadow.camera;
    c.left = -h;
    c.right = h;
    c.top = h;
    c.bottom = -h;
    c.near = 1;
    c.far = h * 4 + 40;
    c.updateProjectionMatrix();
    this.sonne.target.position.copy(m);
    this.sonne.position.copy(m).add(new THREE.Vector3(-0.55, 1, 0.42).setLength(h * 1.6 + 20));
  }

  // ---- Bau-Modus-Hilfen ----------------------------------------------------------------------------

  rasterZeigen(an: boolean) {
    if (this.raster) {
      this.scene.remove(this.raster);
      this.raster.geometry.dispose();
      this.raster = null;
    }
    if (an) {
      const pts: number[] = [];
      const x0 = Math.floor(this.grenzen.minX / FELD) - 8;
      const x1 = Math.ceil(this.grenzen.maxX / FELD) + 8;
      const z0 = Math.floor(this.grenzen.minZ / FELD) - 8;
      const z1 = Math.ceil(this.grenzen.maxZ / FELD) + 8;
      for (let x = x0; x <= x1; x++) pts.push(x * FELD, 0.07, z0 * FELD, x * FELD, 0.07, z1 * FELD);
      for (let z = z0; z <= z1; z++) pts.push(x0 * FELD, 0.07, z * FELD, x1 * FELD, 0.07, z * FELD);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      this.raster = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }));
      this.raster.renderOrder = 4;
      this.scene.add(this.raster);
    }
    this.schmutzig = true;
  }

  /** Felder einfärben: grün = geht, rot = geht nicht, blau = Auswahl */
  markieren(felder: [number, number][], art: 'ok' | 'nein' | 'auswahl' | null) {
    const n = art ? Math.min(felder.length, 64) : 0;
    const o = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      o.position.copy(feldMitte(...felder[i]!)).setY(0.25);
      o.updateMatrix();
      this.markierung.setMatrixAt(i, o.matrix);
    }
    this.markierung.count = n;
    this.markierung.instanceMatrix.needsUpdate = true;
    (this.markierung.material as THREE.MeshBasicMaterial).color.set(art === 'nein' ? '#ff4b3a' : art === 'auswahl' ? '#4aa3ff' : '#5bff7a');
    this.schmutzig = true;
  }

  steuerungAn(an: boolean) {
    this.steuerung.enabled = an;
  }

  // ---- Zeiger ---------------------------------------------------------------------------------------

  private ray(e: { clientX: number; clientY: number }) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.kamera);
    return ray;
  }

  feldUnter(e: { clientX: number; clientY: number }): [number, number] | null {
    const p = new THREE.Vector3();
    if (!this.ray(e).ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) return null;
    return [Math.floor(p.x / FELD), Math.floor(p.z / FELD)];
  }

  treffer(e: { clientX: number; clientY: number }): SzeneTreffer | null {
    const ray = this.ray(e);
    const f = this.figuren.treffer(ray);
    if (f) return f;
    const ziele: THREE.Object3D[] = [];
    for (const g of this.gebaeude.values()) ziele.push(g.pick, g.schild, ...g.blasen.children);
    const h = ray.intersectObjects(ziele, false)[0];
    if (h?.object.userData.gebaeude) return { art: 'gebaeude', id: h.object.userData.gebaeude as string };
    const feld = this.feldUnter(e);
    return feld ? { art: 'feld', x: feld[0], z: feld[1] } : null;
  }

  private zeigerEinrichten() {
    const c = this.renderer.domElement;
    // vor OrbitControls registriert → kann Gesten für den Bau-Modus übernehmen
    c.addEventListener('pointerdown', (e) => {
      this.zeiger = { x: e.clientX, y: e.clientY, zeit: performance.now(), id: e.pointerId };
      if (this.bau && e.isPrimary && e.button === 0) {
        const t = this.treffer(e);
        if (this.bau.zeigerRunter(t, this.feldUnter(e), e)) {
          this.bauZieht = true;
          c.setPointerCapture(e.pointerId);
          e.stopImmediatePropagation();
        }
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.bau) return;
      if (this.bauZieht) this.bau.zeigerBewegt(this.feldUnter(e), e, true);
      else if (e.pointerType === 'mouse' && e.buttons === 0) this.bau.zeigerBewegt(this.feldUnter(e), e, false);
    });
    c.addEventListener('pointerup', (e) => {
      if (this.bauZieht) {
        this.bauZieht = false;
        this.bau?.zeigerHoch(this.feldUnter(e), e);
        this.zeiger = null;
        return;
      }
      const z = this.zeiger;
      this.zeiger = null;
      if (!z || z.id !== e.pointerId) return;
      if (Math.hypot(e.clientX - z.x, e.clientY - z.y) > 7 || performance.now() - z.zeit > 600) return;
      const t = this.treffer(e);
      if (t) this.o.onKlick(t);
    });
    c.addEventListener('pointercancel', () => {
      this.zeiger = null;
      if (this.bauZieht) {
        this.bauZieht = false;
        this.bau?.zeigerHoch(null, new PointerEvent('pointercancel'));
      }
    });
  }

  // ---- Für Tests und Infokarten ---------------------------------------------------------------------

  bildschirmPunkt(art: 'gebaeude' | 'figur' | 'buergermeister', id = ''): { x: number; y: number } | null {
    let p: THREE.Vector3 | null = null;
    if (art === 'gebaeude') {
      const e = this.gebaeude.get(id);
      if (e) p = e.huelle.position.clone().setY(Math.min(1.2, e.modell.hoehe / 2));
    } else p = this.figuren.position(art === 'buergermeister' ? 'buergermeister' : id);
    if (!p) return null;
    p.project(this.kamera);
    const r = this.renderer.domElement.getBoundingClientRect();
    if (p.z > 1) return null;
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }

  /** Bildschirmpunkt eines Feldes (Tests) */
  feldPunkt(x: number, z: number) {
    const p = feldMitte(x, z).project(this.kamera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }
  /** Was gerade gezeigt wird (Tests) */
  layoutStand() {
    return this.daten?.layout ?? null;
  }
  zustand(id: string) {
    const e = this.gebaeude.get(id);
    return e ? { rot: e.rot, blasen: e.blasenSchluessel, rauch: e.rauch.length } : null;
  }
  /** Kamera so setzen, dass ein Feld in der Mitte liegt (Tests, Bau-Modus) */
  blickAuf(x: number, z: number, abstand = 26) {
    const ziel = feldMitte(x, z);
    const v = this.kamera.position.clone().sub(this.steuerung.target).setLength(abstand);
    this.steuerung.target.copy(ziel);
    this.kamera.position.copy(ziel).add(v);
    this.steuerung.update();
    this.schmutzig = true;
  }

  figurDaten(laufId: string) {
    return this.figuren.daten(laufId);
  }
  buergermeisterLauf() {
    return this.figuren.buergermeisterLauf();
  }
  figurenAnzahl() {
    return this.figuren.anzahl();
  }
  /** Welt → Bildschirm für eine Figur (Infokarte folgt der Figur nicht – reicht für die Position beim Klick) */

  // ---- Schleife ---------------------------------------------------------------------------------------

  private groesse() {
    const w = Math.max(1, this.el.clientWidth);
    const h = Math.max(1, this.el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.kamera.aspect = w / h;
    this.kamera.updateProjectionMatrix();
    this.schmutzig = true;
  }

  private sichtbarkeit = () => {
    this.uhr.getDelta();
    this.schmutzig = true;
  };

  private schleife = () => {
    if (!this.laeuft) return;
    this.raf = requestAnimationFrame(this.schleife);
    if (document.hidden) return;
    const dt = Math.min(this.uhr.getDelta(), 0.1);
    let animiert = false;
    if (this.kameraAnimation) {
      const a = this.kameraAnimation;
      a.t = Math.min(1, a.t + dt / 0.45);
      const k = a.t < 0.5 ? 2 * a.t * a.t : 1 - (-2 * a.t + 2) ** 2 / 2;
      const winkel = a.von + (a.nach - a.von) * k;
      const v = this.kamera.position.clone().sub(this.steuerung.target);
      const flach = Math.hypot(v.x, v.z);
      this.kamera.position.set(this.steuerung.target.x + Math.sin(winkel) * flach, this.kamera.position.y, this.steuerung.target.z + Math.cos(winkel) * flach);
      this.steuerung.update();
      if (a.t >= 1) this.kameraAnimation = null;
      animiert = true;
    }
    if (this.steuerung.enableDamping && this.steuerung.update()) animiert = true;
    if (!this.o.reduziert && !this.sparsam) {
      for (const e of this.gebaeude.values()) {
        for (const r of e.rauch) r.tick(dt);
        if (e.rauch.length) animiert = true;
        e.blasen.position.y = e.modell.hoehe + Math.sin(this.uhr.elapsedTime * 2.2 + e.huelle.position.x) * 0.08;
      }
      if (this.autos) {
        this.autos.tick(dt);
        animiert = true;
      }
      if (this.gebaeude.size) animiert = true; // Blasen schweben
    }
    if (this.auswahl) {
      const ausw = this.auswahl;
      ausw.t += dt;
      const e = this.gebaeude.get(ausw.id);
      if (e) {
        // kurzer Hüpfer (0,35 s), danach ruhig; Rahmen pulsiert sanft
        const h = ausw.t < 0.35 && !this.o.reduziert ? Math.sin((ausw.t / 0.35) * Math.PI) * 0.08 : 0;
        e.modell.gruppe.scale.set(1 - h * 0.4, 1 + h, 1 - h * 0.4);
        const m = (ausw.rahmen.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
        m.opacity = this.o.reduziert || this.sparsam ? 0.9 : 0.65 + Math.sin(ausw.t * 4) * 0.25;
        ausw.rahmen.position.copy(e.huelle.position);
        if (ausw.t < 0.4 || !this.sparsam) animiert = true;
      }
    }
    if (this.figuren.tick(dt)) animiert = true;
    if (!animiert && !this.schmutzig) return;
    this.schmutzig = false;
    this.renderer.render(this.scene, this.kamera);
  };

  entsorgen() {
    this.laeuft = false;
    cancelAnimationFrame(this.raf);
    this.beobachter.disconnect();
    document.removeEventListener('visibilitychange', this.sichtbarkeit);
    this.steuerung.dispose();
    for (const [id, e] of this.gebaeude) this.gebaeudeEntfernen(id, e);
    if (this.statisch) entsorgen(this.statisch.gruppe);
    this.gelaende?.g.entsorgen();
    // WebGL-Kontext sofort freigeben: Browser erlauben nur ~16 gleichzeitig, sonst bleibt das Dorf nach
    // häufigem Hin- und Herwechseln irgendwann leer
    this.renderer.forceContextLoss();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

