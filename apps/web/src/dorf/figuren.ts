import * as THREE from 'three';
import type { DorfFigur } from '@dorf/shared';
import { kasten, kugel, material, quader, zylinder, halbkugel, torus } from './bausatz';
import { blase, type BlasenArt } from './blasen';

/** Was die Figuren über das Dorf wissen müssen (liefert die Szene) */
export interface FigurenWelt {
  /** Stehplatz Nr. slot vor dem Gebäude (Welt) und Blickrichtung (rad) */
  platz(gebaeude: string, slot: number): { pos: THREE.Vector3; blick: number } | null;
  /** Weg von a nach b über die Straßen (Weltpunkte, inkl. a und b) */
  weg(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3[];
  /** Alle Gebäude im Dorf (für den Rundgang des Bürgermeisters) */
  gebaeude?(): string[];
}

const GESCHWINDIGKEIT = 1.6;
const GROESSE = 0.72;

interface Teile {
  obj: THREE.Group;
  koerper: THREE.Group;
  beine: THREE.Object3D[];
  arme: THREE.Object3D[];
  blase: THREE.Sprite | null;
}

function teil(eltern: THREE.Object3D, geo: THREE.BufferGeometry, farbe: string, x: number, y: number, z: number, o: { rx?: number; rz?: number; glanz?: boolean } = {}) {
  const m = new THREE.Mesh(geo, material(farbe, { glanz: o.glanz }));
  m.position.set(x, y, z);
  m.rotation.set(o.rx ?? 0, 0, o.rz ?? 0);
  m.castShadow = true;
  eltern.add(m);
  return m;
}

function figurBauen(o: { hemd: string; hose: string; hut: 'kappe' | 'zylinder' | 'helm'; gegenstand?: 'buch' | 'brief' | 'hammer' | 'mappe'; schaerpe?: boolean; helfer?: boolean }): Teile {
  const obj = new THREE.Group();
  const koerper = new THREE.Group();
  obj.add(koerper);
  const schatten = new THREE.Mesh(new THREE.CircleGeometry(0.22, 18), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.2, depthWrite: false }));
  schatten.rotation.x = -Math.PI / 2;
  schatten.position.y = 0.012;
  obj.add(schatten);
  const beine: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const huefte = new THREE.Group();
    huefte.position.set(s * 0.075, 0.36, 0);
    koerper.add(huefte);
    teil(huefte, kasten(0.11, 0.3, 0.12, 0.04), o.hose, 0, -0.16, 0);
    teil(huefte, kasten(0.12, 0.07, 0.17, 0.03), '#3a2a20', 0, -0.32, 0.02);
    beine.push(huefte);
  }
  teil(koerper, kasten(0.32, 0.36, 0.22, 0.09), o.hemd, 0, 0.55, 0);
  if (o.schaerpe) teil(koerper, quader(0.06, 0.42, 0.24), '#f2c14e', 0, 0.56, 0, { rz: 0.6 });
  if (o.hut === 'zylinder') {
    // Anzugsdetails: Hemdkragen, Knöpfe
    teil(koerper, quader(0.08, 0.2, 0.01), '#ffffff', 0, 0.62, 0.112);
    for (const y of [0.5, 0.58]) teil(koerper, kugel(0.015, 6, 4), '#f2c14e', 0.05, y, 0.115);
  }
  const arme: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const schulter = new THREE.Group();
    schulter.position.set(s * 0.2, 0.68, 0);
    koerper.add(schulter);
    teil(schulter, kasten(0.09, 0.3, 0.1, 0.04), o.hemd, 0, -0.14, 0);
    teil(schulter, kugel(0.05, 8, 6), '#f5c9a0', 0, -0.31, 0);
    arme.push(schulter);
  }
  teil(koerper, kugel(0.17, 16, 12), '#f5c9a0', 0, 0.9, 0);
  for (const s of [-1, 1]) teil(koerper, kugel(0.022, 6, 4), '#2b3a55', s * 0.06, 0.93, 0.155);
  teil(koerper, quader(0.06, 0.015, 0.01), '#c0705a', 0, 0.85, 0.165);
  if (o.hut === 'zylinder') {
    teil(koerper, zylinder(0.21, 0.21, 0.03, 18), '#1d1d24', 0, 1.04, 0);
    teil(koerper, zylinder(0.13, 0.14, 0.28, 18), '#1d1d24', 0, 1.19, 0);
    teil(koerper, zylinder(0.142, 0.142, 0.05, 18), '#c0392b', 0, 1.09, 0);
    teil(koerper, quader(0.16, 0.03, 0.02), '#5a3a24', 0, 0.86, 0.17); // Schnurrbart
  } else if (o.hut === 'helm') {
    teil(koerper, halbkugel(0.185, 16), '#ffc23d', 0, 0.97, 0);
    teil(koerper, torus(0.18, 0.02), '#ffc23d', 0, 0.97, 0, { rx: Math.PI / 2 });
  } else {
    teil(koerper, halbkugel(0.178, 16), o.hemd, 0, 0.97, 0);
    teil(koerper, kasten(0.2, 0.03, 0.15, 0.01), o.hemd, 0, 0.99, 0.15);
  }
  if (o.helfer) {
    // Helfer des Bürgermeisters: Rucksack mit goldenem Wimpel
    teil(koerper, kasten(0.24, 0.26, 0.12, 0.04), '#8a5a32', 0, 0.58, -0.16);
    teil(koerper, kasten(0.2, 0.06, 0.13, 0.02), '#6b4426', 0, 0.7, -0.16);
    teil(koerper, zylinder(0.012, 0.012, 0.55, 5), '#5a3a24', 0.08, 0.9, -0.2);
    teil(koerper, kasten(0.2, 0.12, 0.012, 0.004), '#f2c14e', 0.18, 1.1, -0.2);
  }
  const hand = arme[1]!;
  if (o.gegenstand === 'buch') teil(hand, kasten(0.18, 0.22, 0.05, 0.015), '#7a3fbf', 0.02, -0.32, 0.08);
  if (o.gegenstand === 'brief') teil(hand, kasten(0.2, 0.13, 0.02, 0.01), '#f7e7c4', 0.02, -0.32, 0.08);
  if (o.gegenstand === 'mappe') teil(hand, kasten(0.22, 0.17, 0.06, 0.02), '#5a3a24', 0.02, -0.36, 0.06);
  if (o.gegenstand === 'hammer') {
    teil(hand, quader(0.03, 0.03, 0.26), '#8a5a32', 0, -0.33, 0.12);
    teil(hand, kasten(0.12, 0.06, 0.06, 0.01), '#7a8597', 0, -0.33, 0.25);
  }
  obj.scale.setScalar(GROESSE);
  return { obj, koerper, beine, arme, blase: null };
}

function gegenstandFuer(gebaeude: string): 'buch' | 'brief' | 'hammer' | 'mappe' {
  if (gebaeude === 'Uni' || gebaeude === 'Bibliothek') return 'buch';
  if (gebaeude === 'Post') return 'brief';
  if (gebaeude === 'Bank' || gebaeude === 'Boerse') return 'mappe';
  return 'hammer';
}

interface Agent extends Teile {
  daten: DorfFigur;
  pfad: THREE.Vector3[];
  phase: 'hin' | 'da' | 'zurueck' | 'weg';
  t: number;
  slot: number;
  blick: number;
}

export class Figuren {
  readonly gruppe = new THREE.Group();
  private agenten = new Map<string, Agent>();
  private bm:
    | (Teile & {
        arbeitet: THREE.Object3D | null;
        t: number;
        pos: THREE.Vector3 | null;
        blick: number;
        laeuft: DorfFigur | null;
        winken: number;
        /** Rundgang (von selbst geweckt): Weg zum nächsten Gebäude bzw. zurück zum Rathaus */
        runde: THREE.Vector3[];
        besuche: number;
      })
    | null = null;
  private erst = true;
  private nachts = false;

  /** Nachts schläft der Bürgermeister, wenn er nichts zu tun hat */
  nachtSetzen(nachts: boolean) {
    if (this.nachts === nachts) return;
    this.nachts = nachts;
    if (this.bm) this.buergermeisterSetzen(this.bm.laeuft);
  }

  constructor(
    private welt: FigurenWelt,
    private reduziert: boolean,
  ) {}

  /** Stehplatz am Rathaus (Start/Ziel aller Wege) */
  private rathaus() {
    return this.welt.platz('Rathaus', 5);
  }

  aktualisieren(liste: DorfFigur[]) {
    const neu = new Map(liste.filter((f) => !f.buergermeister).map((f) => [f.laufId, f]));
    // Bürgermeister: immer da (wenn es ein Rathaus gibt), denkt, wenn einer seiner Läufe läuft
    this.buergermeisterSetzen(liste.find((f) => f.buergermeister && f.status === 'laeuft') ?? liste.find((f) => f.buergermeister) ?? null);
    for (const [id, a] of this.agenten) {
      const d = neu.get(id);
      if (d) {
        a.daten = d;
        this.blaseSetzen(a, d.status === 'wartet_freigabe' ? 'brief' : d.status === 'wartend' ? 'sanduhr' : null);
      } else if (a.phase !== 'zurueck' && a.phase !== 'weg') {
        // fertig: zurück zum Rathaus
        const r = this.rathaus();
        this.blaseSetzen(a, null);
        if (!r || this.reduziert) a.phase = 'weg';
        else {
          a.pfad = this.welt.weg(a.obj.position.clone(), r.pos);
          a.phase = 'zurueck';
        }
      }
    }
    for (const [id, d] of neu) {
      if (this.agenten.has(id)) continue;
      const belegt = new Set([...this.agenten.values()].filter((a) => a.daten.gebaeude === d.gebaeude && a.phase !== 'weg').map((a) => a.slot));
      let slot = 0;
      while (belegt.has(slot)) slot++;
      const ziel = this.welt.platz(d.gebaeude, slot);
      if (!ziel) continue; // Gebäude steht nicht im Dorf
      const helfer = d.ausloeser === 'buergermeister';
      const t = figurBauen({ hemd: d.motor === 'api' ? '#3b6fd8' : '#e8762a', hose: '#34405a', hut: 'kappe', gegenstand: gegenstandFuer(d.gebaeude), helfer });
      // Der Bürgermeister winkt seinem Helfer hinterher
      if (helfer && this.bm && !this.erst) this.bm.winken = 2.2;
      const a: Agent = { ...t, daten: d, pfad: [], phase: 'da', t: Math.random() * 10, slot, blick: ziel.blick };
      const r = this.rathaus();
      if (this.erst || this.reduziert || !r) {
        a.obj.position.copy(ziel.pos);
        a.obj.rotation.y = ziel.blick;
      } else {
        a.obj.position.copy(r.pos);
        a.pfad = this.welt.weg(r.pos, ziel.pos);
        a.phase = 'hin';
      }
      a.obj.userData = { figur: id };
      this.gruppe.add(a.obj);
      this.agenten.set(id, a);
      this.blaseSetzen(a, d.status === 'wartet_freigabe' ? 'brief' : d.status === 'wartend' ? 'sanduhr' : null);
    }
    this.erst = false;
  }

  /** Nach Layout-Änderung: alle an ihre (neuen) Plätze */
  neuPlatzieren() {
    for (const a of this.agenten.values()) {
      const z = this.welt.platz(a.daten.gebaeude, a.slot);
      if (!z) {
        a.phase = 'weg';
        continue;
      }
      if (a.phase === 'da' || this.reduziert) {
        a.obj.position.copy(z.pos);
        a.obj.rotation.y = z.blick;
        a.blick = z.blick;
      } else if (a.phase === 'hin') a.pfad = this.welt.weg(a.obj.position.clone(), z.pos);
    }
    if (this.bm) {
      const r = this.welt.platz('Rathaus', 4);
      this.bm.runde = [];
      if (r) {
        this.bm.pos = r.pos;
        this.bm.blick = r.blick;
        this.bm.obj.position.copy(r.pos);
        this.bm.obj.rotation.y = r.blick;
      }
      this.bm.obj.visible = !!r;
    }
  }

  private buergermeisterSetzen(lauf: DorfFigur | null) {
    const r = this.welt.platz('Rathaus', 4);
    if (!this.bm) {
      const t = figurBauen({ hemd: '#2b2b3a', hose: '#2b2b3a', hut: 'zylinder', gegenstand: 'mappe', schaerpe: true });
      this.bm = { ...t, arbeitet: null, t: 0, pos: null, blick: 0, laeuft: null, winken: 0, runde: [], besuche: 0 };
      this.bm.obj.userData = { buergermeister: true };
      this.gruppe.add(this.bm.obj);
    }
    this.bm.obj.visible = !!r;
    if (r && !this.bm.pos) {
      this.bm.pos = r.pos;
      this.bm.blick = r.blick;
      this.bm.obj.position.copy(r.pos);
      this.bm.obj.rotation.y = r.blick;
    }
    // Rundgang gerade beendet (vorher Zeitplan-Lauf, jetzt nicht mehr): zurück zum Rathaus laufen.
    // Nur beim Übergang – sonst würde jedes Status-Update sein Auf-und-ab-Gehen beim Nachdenken unterbrechen.
    const warRundgang = this.bm.laeuft?.status === 'laeuft' && this.bm.laeuft.ausloeser === 'zeitplan';
    const istRundgang = lauf?.status === 'laeuft' && lauf.ausloeser === 'zeitplan';
    if (this.bm.pos && warRundgang && !istRundgang && this.bm.obj.position.distanceTo(this.bm.pos) > 0.05)
      this.bm.runde = this.reduziert ? [] : this.welt.weg(this.bm.obj.position.clone(), this.bm.pos);
    this.bm.laeuft = lauf;
    this.blaseSetzen(this.bm, lauf ? (lauf.status === 'laeuft' ? 'denken' : lauf.status === 'wartet_freigabe' ? 'brief' : 'sanduhr') : this.nachts ? 'schlafen' : null);
    // schlafend leicht zur Seite geneigt
    this.bm.koerper.rotation.z = !lauf && this.nachts ? 0.12 : 0;
  }

  private blaseSetzen(t: Teile, art: BlasenArt | null) {
    if ((t.blase?.userData.blase ?? null) === art) return;
    if (t.blase) t.obj.remove(t.blase);
    t.blase = null;
    if (art) {
      t.blase = blase(art, 0.75 / GROESSE);
      t.blase.position.y = 1.35;
      t.obj.add(t.blase);
    }
  }

  /** Bewegt alles um dt Sekunden; true, wenn sich etwas bewegt hat */
  tick(dt: number): boolean {
    let aktiv = false;
    for (const [id, a] of this.agenten) {
      a.t += dt;
      if (a.phase === 'weg') {
        a.obj.scale.multiplyScalar(this.reduziert ? 0 : 0.85);
        if (a.obj.scale.x < 0.05) {
          this.gruppe.remove(a.obj);
          this.agenten.delete(id);
        }
        aktiv = true;
        continue;
      }
      if ((a.phase === 'hin' || a.phase === 'zurueck') && a.pfad.length) {
        aktiv = true;
        let rest = GESCHWINDIGKEIT * dt;
        while (rest > 0 && a.pfad.length) {
          const z = a.pfad[0]!;
          const d = a.obj.position.distanceTo(z);
          if (d <= rest) {
            a.obj.position.copy(z);
            a.pfad.shift();
            rest -= d;
          } else {
            const r = z.clone().sub(a.obj.position).normalize();
            a.obj.position.addScaledVector(r, rest);
            const ziel = Math.atan2(r.x, r.z);
            let diff = ziel - a.obj.rotation.y;
            diff = Math.atan2(Math.sin(diff), Math.cos(diff));
            a.obj.rotation.y += diff * Math.min(1, dt * 10);
            rest = 0;
          }
        }
        const s = Math.sin(a.t * 11);
        a.beine[0]!.rotation.x = s * 0.6;
        a.beine[1]!.rotation.x = -s * 0.6;
        a.arme[0]!.rotation.x = -s * 0.5;
        a.arme[1]!.rotation.x = s * 0.5;
        a.koerper.position.y = Math.abs(s) * 0.04;
        if (!a.pfad.length) {
          if (a.phase === 'zurueck') a.phase = 'weg';
          else {
            a.phase = 'da';
            a.obj.rotation.y = a.blick;
          }
        }
      } else if (a.phase === 'da') {
        a.beine[0]!.rotation.x = 0;
        a.beine[1]!.rotation.x = 0;
        a.koerper.position.y = 0;
        if (a.daten.status === 'laeuft' && !this.reduziert) {
          aktiv = true;
          // Arbeiten: rechter Arm schwingt (hämmern/blättern)
          a.arme[1]!.rotation.x = -1.1 + Math.abs(Math.sin(a.t * 6)) * 0.9;
          a.arme[0]!.rotation.x = -0.3;
          a.koerper.position.y = Math.abs(Math.sin(a.t * 6)) * 0.015;
        } else {
          a.arme[0]!.rotation.x = 0;
          a.arme[1]!.rotation.x = 0;
        }
      }
      if (a.blase) a.blase.position.y = 1.35 + (this.reduziert ? 0 : Math.sin(a.t * 3) * 0.04);
    }
    if (this.bm?.obj.visible && this.bm.pos) {
      const bm = this.bm;
      bm.t += dt;
      if (bm.winken > 0 && !this.reduziert) {
        // Winken: rechter Arm hoch und hin und her
        aktiv = true;
        bm.winken -= dt;
        // unterwegs (Rundgang) bleibt er stehen, wo er ist, und winkt von dort
        if (!bm.runde.length && bm.obj.position.distanceTo(bm.pos!) < 0.05) {
          bm.obj.position.copy(bm.pos!);
          bm.obj.rotation.y = bm.blick;
        }
        bm.arme[1]!.rotation.x = -2.6;
        bm.arme[1]!.rotation.z = Math.sin(bm.t * 12) * 0.35;
        if (bm.winken <= 0) {
          bm.arme[1]!.rotation.x = 0;
          bm.arme[1]!.rotation.z = 0;
        }
      } else if (
        bm.laeuft?.status === 'laeuft' &&
        bm.laeuft.ausloeser === 'zeitplan' &&
        this.welt.gebaeude &&
        this.welt.gebaeude().some((g) => g !== 'Rathaus') &&
        !this.reduziert
      ) {
        // Rundgang (stündlich von selbst geweckt): von Gebäude zu Gebäude durchs Dorf, dazwischen kurz zurück zum Rathaus
        aktiv = true;
        if (!bm.runde.length) {
          const andere = this.welt.gebaeude().filter((g) => g !== 'Rathaus');
          const heim = bm.besuche % 3 === 2 || !andere.length;
          const ziel = heim ? { pos: bm.pos!, blick: bm.blick } : this.welt.platz(andere[Math.floor(Math.random() * andere.length)]!, 5);
          bm.besuche++;
          if (ziel) bm.runde = this.welt.weg(bm.obj.position.clone(), ziel.pos);
        }
        if (bm.runde.length) this.gehen(bm, bm.runde, dt);
      } else if (bm.runde.length && !this.reduziert) {
        // Rundgang vorbei: auf dem Weg zurück zum Rathaus
        aktiv = true;
        this.gehen(bm, bm.runde, dt);
        if (!bm.runde.length) bm.obj.rotation.y = bm.blick;
      } else if (bm.laeuft?.status === 'laeuft' && !this.reduziert) {
        // Auf und ab gehen und nachdenken
        aktiv = true;
        const s = Math.sin(bm.t * 0.9);
        const quer = new THREE.Vector3(Math.cos(bm.blick), 0, -Math.sin(bm.blick));
        bm.obj.position.copy(bm.pos!).addScaledVector(quer, s * 0.55);
        bm.obj.rotation.y = bm.blick + (Math.cos(bm.t * 0.9) > 0 ? Math.PI / 2 : -Math.PI / 2);
        const w = Math.sin(bm.t * 9);
        bm.beine[0]!.rotation.x = w * 0.5;
        bm.beine[1]!.rotation.x = -w * 0.5;
        bm.arme[0]!.rotation.x = -0.9;
        bm.koerper.position.y = Math.abs(w) * 0.03;
      } else {
        bm.obj.position.copy(bm.pos!);
        bm.obj.rotation.y = bm.blick;
        bm.beine[0]!.rotation.x = 0;
        bm.beine[1]!.rotation.x = 0;
        bm.arme[0]!.rotation.x = 0;
        bm.koerper.position.y = 0;
      }
    }
    return aktiv;
  }

  /** Eine Figur ein Stück den Weg entlang (Beine und Arme schwingen) */
  private gehen(f: Teile & { t: number }, pfad: THREE.Vector3[], dt: number) {
    let rest = GESCHWINDIGKEIT * dt;
    while (rest > 0 && pfad.length) {
      const z = pfad[0]!;
      const d = f.obj.position.distanceTo(z);
      if (d <= rest) {
        f.obj.position.copy(z);
        pfad.shift();
        rest -= d;
      } else {
        const r = z.clone().sub(f.obj.position).normalize();
        f.obj.position.addScaledVector(r, rest);
        let diff = Math.atan2(r.x, r.z) - f.obj.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        f.obj.rotation.y += diff * Math.min(1, dt * 10);
        rest = 0;
      }
    }
    const s = Math.sin(f.t * 11);
    f.beine[0]!.rotation.x = s * 0.6;
    f.beine[1]!.rotation.x = -s * 0.6;
    f.arme[0]!.rotation.x = -s * 0.5;
    f.arme[1]!.rotation.x = s * 0.5;
    f.koerper.position.y = Math.abs(s) * 0.04;
  }

  treffer(ray: THREE.Raycaster): { art: 'figur'; laufId: string } | { art: 'buergermeister' } | null {
    const h = ray.intersectObjects(this.gruppe.children, true)[0];
    let o: THREE.Object3D | null = h?.object ?? null;
    while (o && !o.userData.figur && !o.userData.buergermeister) o = o.parent;
    if (!o) return null;
    return o.userData.buergermeister ? { art: 'buergermeister' } : { art: 'figur', laufId: o.userData.figur as string };
  }

  daten(laufId: string) {
    return this.agenten.get(laufId)?.daten ?? null;
  }
  buergermeisterLauf() {
    return this.bm?.laeuft ?? null;
  }

  /** Weltposition (für Tests und die Infokarte) */
  position(laufId: string | 'buergermeister'): THREE.Vector3 | null {
    if (laufId === 'buergermeister') return this.bm?.obj.visible ? this.bm.obj.position.clone().setY(0.5) : null;
    const a = this.agenten.get(laufId);
    return a ? a.obj.position.clone().setY(0.5) : null;
  }
  anzahl() {
    return [...this.agenten.values()].filter((a) => a.phase !== 'weg').length;
  }
  unterwegs() {
    return [...this.agenten.values()].some((a) => a.phase === 'hin' || a.phase === 'zurueck');
  }
}
