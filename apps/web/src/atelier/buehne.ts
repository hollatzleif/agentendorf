import { flutMaske } from './filter';
import { ctxVon, kopie, leinwand, type Dokument, type Ebene, type Rechteck } from './kern';

/**
 * E198 Atelier: die Bühne – Ansicht (Zoom, Verschieben), Zeiger (Maus, Stift mit Druck, Finger mit Zwei-Finger-Geste)
 * und alle Werkzeuge. Zeichnet das zusammengesetzte Bild und darüber die Hilfen (Auswahl-Ameisen, Transformations-
 * rahmen, Zuschnitt, Pinselkreis). Kein React: Die Oberfläche setzt Werkzeug und Optionen und hört auf `beiZustand`.
 */

export type Werkzeug =
  | 'verschieben'
  | 'auswahl-rechteck'
  | 'auswahl-ellipse'
  | 'lasso'
  | 'zauberstab'
  | 'zuschneiden'
  | 'pipette'
  | 'pinsel'
  | 'radierer'
  | 'fuellen'
  | 'verlauf'
  | 'text'
  | 'form'
  | 'hand'
  | 'zoom';

export interface Optionen {
  vordergrund: string;
  hintergrund: string;
  /** Pinsel/Radierer: Durchmesser in Pixeln, Härte 0–100, Deckkraft 1–100, Druck des Stifts auf die Größe */
  groesse: number;
  haerte: number;
  deckkraft: number;
  druck: boolean;
  /** Zauberstab/Füllen */
  toleranz: number;
  zusammenhaengend: boolean;
  alleEbenen: boolean;
  auswahlModus: 'neu' | 'plus' | 'minus';
  form: 'rechteck' | 'ellipse' | 'linie';
  gefuellt: boolean;
  strich: number;
  verlaufArt: 'linear' | 'radial';
  verlaufTransparent: boolean;
  schrift: string;
  schriftGroesse: number;
  fett: boolean;
  kursiv: boolean;
}

export const STANDARD_OPTIONEN: Optionen = {
  vordergrund: '#1b2538',
  hintergrund: '#ffffff',
  groesse: 24,
  haerte: 80,
  deckkraft: 100,
  druck: true,
  toleranz: 32,
  zusammenhaengend: true,
  alleEbenen: false,
  auswahlModus: 'neu',
  form: 'rechteck',
  gefuellt: true,
  strich: 6,
  verlaufArt: 'linear',
  verlaufTransparent: false,
  schrift: 'system-ui, sans-serif',
  schriftGroesse: 64,
  fett: false,
  kursiv: false,
};

type Punkt = { x: number; y: number };
interface Aktion {
  bewegen(p: Punkt, e: PointerEvent): void;
  ende(p: Punkt, e: PointerEvent): void;
  abbrechen(): void;
}

export interface Transform {
  ebene: Ebene;
  bild: HTMLCanvasElement;
  rest: HTMLCanvasElement;
  maske: HTMLCanvasElement | null;
  cx: number;
  cy: number;
  /** aktuelle Breite/Höhe (negativ = gespiegelt) und Winkel in Bogenmaß */
  bw: number;
  bh: number;
  winkel: number;
}

const GRIFFE = ['lo', 'o', 'ro', 'r', 'ru', 'u', 'lu', 'l'] as const;
type Griff = (typeof GRIFFE)[number];
/** Lage der Griffe im Einheitsrahmen (−0,5 … 0,5) */
const GRIFF_ORT: Record<Griff, [number, number]> = { lo: [-0.5, -0.5], o: [0, -0.5], ro: [0.5, -0.5], r: [0.5, 0], ru: [0.5, 0.5], u: [0, 0.5], lu: [-0.5, 0.5], l: [-0.5, 0] };

export function hexAus(r: number, g: number, b: number) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

export class Buehne {
  doc!: Dokument;
  zoom = 1;
  vx = 0;
  vy = 0;
  werkzeug: Werkzeug = 'pinsel';
  opt: Optionen = { ...STANDARD_OPTIONEN };
  transform: Transform | null = null;
  /** Zuschnitt-Rahmen (Werkzeug Zuschneiden) */
  schnitt: Rechteck | null = null;
  /** Stelle, an der gerade Text eingegeben wird (die Oberfläche zeigt das Feld) */
  textOrt: Punkt | null = null;
  leertaste = false;
  beiZustand: () => void = () => {};
  beiHinweis: (text: string) => void = () => {};

  private misch: HTMLCanvasElement | null = null;
  private mischSchmutzig = true;
  private kratz: HTMLCanvasElement | null = null;
  private kratz2: HTMLCanvasElement | null = null;
  private aktion: Aktion | null = null;
  private zeiger = new Map<number, Punkt>();
  private geste: { abstand: number; mx: number; my: number } | null = null;
  private schwenk: { x: number; y: number } | null = null;
  private schwebe: Punkt | null = null;
  private vorschau: { art: 'rechteck' | 'ellipse' | 'lasso'; punkte: Punkt[] } | null = null;
  private kante: { stand: number; d: number; bild: HTMLCanvasElement } | null = null;
  private phase = 0;
  private bild = 0;
  private takt: ReturnType<typeof setInterval>;
  private abmelden: (() => void) | null = null;
  private beobachter: ResizeObserver;
  private tupferCache = new Map<string, HTMLCanvasElement>();
  /** Ansicht zeigt das ganze Bild (bis der Nutzer selbst zoomt oder verschiebt) – dann folgt sie der Fenstergröße */
  private eingepasst = false;

  constructor(public ansicht: HTMLCanvasElement) {
    const a = ansicht;
    a.addEventListener('pointerdown', this.runter);
    a.addEventListener('pointermove', this.bewegt);
    a.addEventListener('pointerup', this.hoch);
    a.addEventListener('pointercancel', this.abgebrochen);
    a.addEventListener('pointerleave', this.verlassen);
    a.addEventListener('wheel', this.rad, { passive: false });
    a.addEventListener('contextmenu', (e) => e.preventDefault());
    this.beobachter = new ResizeObserver(() => {
      if (this.eingepasst && this.doc) this.einpassen();
      this.neuZeichnen();
    });
    this.beobachter.observe(a);
    // Ameisen laufen nur, wenn es eine Auswahl gibt
    this.takt = setInterval(() => {
      if (this.doc?.auswahl && !document.hidden) {
        this.phase = (this.phase + 1) % 16;
        this.neuZeichnen();
      }
    }, 140);
  }

  zerstoeren() {
    clearInterval(this.takt);
    this.beobachter.disconnect();
    this.abmelden?.();
    cancelAnimationFrame(this.bild);
  }

  dokumentSetzen(doc: Dokument) {
    this.aktionAbbrechen();
    this.abmelden?.();
    this.doc = doc;
    this.transform = null;
    this.schnitt = null;
    this.textOrt = null;
    this.abmelden = doc.abonnieren(() => {
      this.mischSchmutzig = true;
      this.neuZeichnen();
    });
    this.mischSchmutzig = true;
    this.eingepasst = true;
    this.einpassen();
    this.neuZeichnen();
  }

  werkzeugSetzen(w: Werkzeug) {
    this.aktionAbbrechen();
    if (this.transform) this.transformAnwenden();
    if (w !== 'zuschneiden') this.schnitt = null;
    if (w !== 'text') this.textOrt = null;
    this.werkzeug = w;
    this.neuZeichnen();
    this.beiZustand();
  }

  // ---- Ansicht ----------------------------------------------------------------------------------
  einpassen() {
    const b = this.ansicht.clientWidth;
    const h = this.ansicht.clientHeight;
    this.eingepasst = true;
    if (!b || !h || !this.doc) return;
    const rand = Math.min(48, b * 0.06);
    this.zoom = Math.min(8, (b - 2 * rand) / this.doc.breite, (h - 2 * rand) / this.doc.hoehe);
    this.vx = (b - this.doc.breite * this.zoom) / 2;
    this.vy = (h - this.doc.hoehe * this.zoom) / 2;
    this.neuZeichnen();
    this.beiZustand();
  }
  /** Zoom um den Faktor f; der Punkt (sx, sy) der Ansicht bleibt an seiner Stelle (Standard: Mitte) */
  zoomen(f: number, sx = this.ansicht.clientWidth / 2, sy = this.ansicht.clientHeight / 2) {
    this.eingepasst = false;
    const neu = Math.min(64, Math.max(0.02, this.zoom * f));
    const k = neu / this.zoom;
    this.vx = sx - (sx - this.vx) * k;
    this.vy = sy - (sy - this.vy) * k;
    this.zoom = neu;
    this.neuZeichnen();
    this.beiZustand();
  }
  zoomSetzen(z: number) {
    this.zoomen(z / this.zoom);
  }
  zuDok(sx: number, sy: number): Punkt {
    return { x: (sx - this.vx) / this.zoom, y: (sy - this.vy) / this.zoom };
  }
  zuAnsicht(p: Punkt): Punkt {
    return { x: p.x * this.zoom + this.vx, y: p.y * this.zoom + this.vy };
  }
  private ort(e: PointerEvent | WheelEvent): Punkt {
    const r = this.ansicht.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  neuZeichnen() {
    if (this.bild) return;
    this.bild = requestAnimationFrame(() => {
      this.bild = 0;
      this.zeichne();
    });
  }
  /** Ebenen wurden von außen verändert (Filter-Vorschau u. Ä.) */
  schmutzig() {
    this.mischSchmutzig = true;
    this.neuZeichnen();
  }
  /** das zusammengesetzte Bild in Dokumentgröße (für Pipette, Zauberstab „alle Ebenen“) */
  gemischt(): HTMLCanvasElement {
    const d = this.doc;
    if (!this.misch || this.misch.width !== d.breite || this.misch.height !== d.hoehe) {
      this.misch = leinwand(d.breite, d.hoehe);
      this.mischSchmutzig = true;
    }
    if (this.mischSchmutzig) {
      const c = ctxVon(this.misch);
      c.clearRect(0, 0, d.breite, d.hoehe);
      d.zeichnen(c);
      this.mischSchmutzig = false;
    }
    return this.misch;
  }

  private karo: CanvasPattern | null = null;
  private streifen: HTMLCanvasElement | null = null;
  private zeichne() {
    const a = this.ansicht;
    const d = this.doc;
    if (!d) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const b = a.clientWidth;
    const h = a.clientHeight;
    if (!b || !h) return;
    if (a.width !== Math.round(b * dpr) || a.height !== Math.round(h * dpr)) {
      a.width = Math.round(b * dpr);
      a.height = Math.round(h * dpr);
    }
    const c = ctxVon(a);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, b, h);
    const dx = this.vx;
    const dy = this.vy;
    const db = d.breite * this.zoom;
    const dh = d.hoehe * this.zoom;
    // Karomuster zeigt Durchsichtigkeit
    if (!this.karo) {
      const k = leinwand(16, 16);
      const kc = ctxVon(k);
      kc.fillStyle = '#ffffff';
      kc.fillRect(0, 0, 16, 16);
      kc.fillStyle = '#d5d9e0';
      kc.fillRect(0, 0, 8, 8);
      kc.fillRect(8, 8, 8, 8);
      this.karo = c.createPattern(k, 'repeat');
    }
    c.save();
    c.shadowColor = 'rgb(0 0 0 / 0.45)';
    c.shadowBlur = 18;
    c.fillStyle = '#fff';
    c.fillRect(dx, dy, db, dh);
    c.restore();
    c.fillStyle = this.karo!;
    c.fillRect(dx, dy, db, dh);
    c.imageSmoothingEnabled = this.zoom < 3;
    c.imageSmoothingQuality = 'high';
    c.drawImage(this.gemischt(), dx, dy, db, dh);

    this.zeichneAmeisen(c, b, h, dpr);
    if (this.vorschau) this.zeichneVorschau(c);
    if (this.schnitt) this.zeichneSchnitt(c, b, h);
    if (this.transform) this.zeichneTransform(c);
    // Pinselkreis (Maus/Stift)
    if (this.schwebe && (this.werkzeug === 'pinsel' || this.werkzeug === 'radierer') && !this.transform) {
      const r = (this.opt.groesse / 2) * this.zoom;
      c.beginPath();
      c.arc(this.schwebe.x, this.schwebe.y, Math.max(1.5, r), 0, Math.PI * 2);
      c.lineWidth = 1;
      c.strokeStyle = 'rgb(0 0 0 / 0.8)';
      c.stroke();
      c.beginPath();
      c.arc(this.schwebe.x, this.schwebe.y, Math.max(0.5, r - 1), 0, Math.PI * 2);
      c.strokeStyle = 'rgb(255 255 255 / 0.8)';
      c.stroke();
    }
  }

  /** Auswahlkante als laufende schwarz-weiße Striche („Ameisen“) */
  private zeichneAmeisen(c: CanvasRenderingContext2D, b: number, h: number, dpr: number) {
    const d = this.doc;
    if (!d.auswahl) return;
    const dicke = Math.max(1, Math.round(1.6 / this.zoom));
    if (!this.kante || this.kante.stand !== d.auswahlStand || this.kante.d !== dicke) {
      // Kante = Auswahl ohne ihr Inneres (Inneres = Pixel, deren vier Nachbarn auch ausgewählt sind)
      const innen = kopie(d.auswahl);
      const ic = ctxVon(innen);
      ic.globalCompositeOperation = 'destination-in';
      for (const [sx, sy] of [[dicke, 0], [-dicke, 0], [0, dicke], [0, -dicke]] as const) ic.drawImage(d.auswahl, sx, sy);
      const kante = kopie(d.auswahl);
      const kc = ctxVon(kante);
      kc.globalCompositeOperation = 'destination-out';
      kc.drawImage(innen, 0, 0);
      this.kante = { stand: d.auswahlStand, d: dicke, bild: kante };
    }
    if (!this.kratz2 || this.kratz2.width !== Math.round(b * dpr) || this.kratz2.height !== Math.round(h * dpr)) this.kratz2 = leinwand(b * dpr, h * dpr);
    const z = this.kratz2;
    const zc = ctxVon(z);
    zc.setTransform(dpr, 0, 0, dpr, 0, 0);
    zc.globalCompositeOperation = 'source-over';
    zc.clearRect(0, 0, b, h);
    zc.imageSmoothingEnabled = false;
    zc.drawImage(this.kante.bild, this.vx, this.vy, d.breite * this.zoom, d.hoehe * this.zoom);
    if (!this.streifen) {
      this.streifen = leinwand(16, 16);
      const sc = ctxVon(this.streifen);
      sc.fillStyle = '#fff';
      sc.fillRect(0, 0, 16, 16);
      sc.fillStyle = '#000';
      sc.beginPath();
      sc.moveTo(0, 0);
      sc.lineTo(8, 0);
      sc.lineTo(0, 8);
      sc.closePath();
      sc.moveTo(16, 0);
      sc.lineTo(16, 8);
      sc.lineTo(8, 16);
      sc.lineTo(0, 16);
      sc.closePath();
      sc.fill();
    }
    const muster = zc.createPattern(this.streifen, 'repeat')!;
    muster.setTransform(new DOMMatrix().translate(this.phase, 0));
    zc.globalCompositeOperation = 'source-in';
    zc.fillStyle = muster;
    zc.fillRect(0, 0, b, h);
    c.drawImage(z, 0, 0, b, h);
  }

  private zeichneVorschau(c: CanvasRenderingContext2D) {
    const v = this.vorschau!;
    const p = v.punkte.map((q) => this.zuAnsicht(q));
    if (p.length < 2) return;
    c.save();
    c.beginPath();
    if (v.art === 'rechteck') c.rect(p[0]!.x, p[0]!.y, p[1]!.x - p[0]!.x, p[1]!.y - p[0]!.y);
    else if (v.art === 'ellipse') c.ellipse((p[0]!.x + p[1]!.x) / 2, (p[0]!.y + p[1]!.y) / 2, Math.abs(p[1]!.x - p[0]!.x) / 2, Math.abs(p[1]!.y - p[0]!.y) / 2, 0, 0, Math.PI * 2);
    else {
      c.moveTo(p[0]!.x, p[0]!.y);
      for (const q of p.slice(1)) c.lineTo(q.x, q.y);
    }
    c.lineWidth = 1;
    c.strokeStyle = '#fff';
    c.stroke();
    c.setLineDash([5, 5]);
    c.strokeStyle = '#000';
    c.stroke();
    c.restore();
  }

  private zeichneSchnitt(c: CanvasRenderingContext2D, b: number, h: number) {
    const s = this.schnitt!;
    const a = this.zuAnsicht({ x: s.x, y: s.y });
    const sb = s.b * this.zoom;
    const sh = s.h * this.zoom;
    c.save();
    c.fillStyle = 'rgb(0 0 0 / 0.55)';
    c.beginPath();
    c.rect(0, 0, b, h);
    c.rect(a.x, a.y, sb, sh);
    c.fill('evenodd');
    c.strokeStyle = '#fff';
    c.lineWidth = 1.5;
    c.strokeRect(a.x, a.y, sb, sh);
    // Drittel-Linien
    c.lineWidth = 0.5;
    c.strokeStyle = 'rgb(255 255 255 / 0.6)';
    c.beginPath();
    for (const t of [1 / 3, 2 / 3]) {
      c.moveTo(a.x + sb * t, a.y);
      c.lineTo(a.x + sb * t, a.y + sh);
      c.moveTo(a.x, a.y + sh * t);
      c.lineTo(a.x + sb, a.y + sh * t);
    }
    c.stroke();
    c.fillStyle = '#fff';
    c.strokeStyle = '#1b2538';
    c.lineWidth = 1.5;
    for (const g of GRIFFE) {
      const [gx, gy] = GRIFF_ORT[g];
      c.beginPath();
      c.rect(a.x + sb * (gx + 0.5) - 5, a.y + sh * (gy + 0.5) - 5, 10, 10);
      c.fill();
      c.stroke();
    }
    c.restore();
  }

  private transformEcke(t: Transform, gx: number, gy: number): Punkt {
    const lx = gx * t.bw;
    const ly = gy * t.bh;
    const co = Math.cos(t.winkel);
    const si = Math.sin(t.winkel);
    return { x: t.cx + lx * co - ly * si, y: t.cy + lx * si + ly * co };
  }
  private drehGriff(t: Transform): Punkt {
    const oben = this.zuAnsicht(this.transformEcke(t, 0, -0.5 * Math.sign(t.bh || 1)));
    return { x: oben.x + Math.sin(t.winkel) * 28, y: oben.y - Math.cos(t.winkel) * 28 };
  }
  private zeichneTransform(c: CanvasRenderingContext2D) {
    const t = this.transform!;
    const ecken = (['lo', 'ro', 'ru', 'lu'] as const).map((g) => this.zuAnsicht(this.transformEcke(t, ...GRIFF_ORT[g])));
    c.save();
    c.beginPath();
    c.moveTo(ecken[0]!.x, ecken[0]!.y);
    for (const e of ecken.slice(1)) c.lineTo(e.x, e.y);
    c.closePath();
    c.lineWidth = 1.5;
    c.strokeStyle = '#3aa0ff';
    c.stroke();
    const dreh = this.drehGriff(t);
    const oben = this.zuAnsicht(this.transformEcke(t, 0, -0.5 * Math.sign(t.bh || 1)));
    c.beginPath();
    c.moveTo(oben.x, oben.y);
    c.lineTo(dreh.x, dreh.y);
    c.stroke();
    c.fillStyle = '#fff';
    for (const g of GRIFFE) {
      const p = this.zuAnsicht(this.transformEcke(t, ...GRIFF_ORT[g]));
      c.beginPath();
      c.rect(p.x - 5, p.y - 5, 10, 10);
      c.fill();
      c.stroke();
    }
    c.beginPath();
    c.arc(dreh.x, dreh.y, 6, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.restore();
  }

  // ---- Zeiger -----------------------------------------------------------------------------------
  private runter = (e: PointerEvent) => {
    if (!this.doc) return;
    const s = this.ort(e);
    try {
      this.ansicht.setPointerCapture(e.pointerId);
    } catch {
      /* Zeiger schon weg (oder nachgebautes Ereignis im Test) – ohne Fangen geht es auch */
    }
    if (e.pointerType === 'touch') {
      this.zeiger.set(e.pointerId, s);
      if (this.zeiger.size === 2) {
        // zweiter Finger: laufende Aktion verwerfen, ab jetzt zoomen/verschieben
        this.aktionAbbrechen();
        const [a, b] = [...this.zeiger.values()];
        this.geste = { abstand: Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1, mx: (a!.x + b!.x) / 2, my: (a!.y + b!.y) / 2 };
        return;
      }
      if (this.zeiger.size > 2) return;
    }
    e.preventDefault();
    if (e.button === 1 || e.button === 2 || this.leertaste || (this.werkzeug === 'hand' && !this.transform)) {
      this.schwenk = s;
      return;
    }
    const p = this.zuDok(s.x, s.y);
    this.aktion = this.transform ? this.transformZiehen(s, p, e) : this.starten(s, p, e);
  };

  private bewegt = (e: PointerEvent) => {
    if (!this.doc) return;
    const s = this.ort(e);
    if (e.pointerType === 'touch' && this.zeiger.has(e.pointerId)) {
      this.zeiger.set(e.pointerId, s);
      if (this.geste && this.zeiger.size >= 2) {
        const [a, b] = [...this.zeiger.values()];
        const abstand = Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1;
        const mx = (a!.x + b!.x) / 2;
        const my = (a!.y + b!.y) / 2;
        this.vx += mx - this.geste.mx;
        this.vy += my - this.geste.my;
        this.zoomen(abstand / this.geste.abstand, mx, my);
        this.geste = { abstand, mx, my };
        return;
      }
    }
    if (this.geste) return;
    if (this.schwenk) {
      this.vx += s.x - this.schwenk.x;
      this.vy += s.y - this.schwenk.y;
      this.schwenk = s;
      this.eingepasst = false;
      this.neuZeichnen();
      return;
    }
    if (this.aktion) {
      e.preventDefault();
      const ereignisse = e.getCoalescedEvents?.() ?? [];
      for (const k of ereignisse.length ? ereignisse : [e]) {
        const ks = this.ort(k);
        this.aktion.bewegen(this.zuDok(ks.x, ks.y), k);
      }
      this.mischSchmutzig = true;
      this.neuZeichnen();
      return;
    }
    if (e.pointerType !== 'touch') {
      this.schwebe = s;
      if (this.werkzeug === 'pinsel' || this.werkzeug === 'radierer') this.neuZeichnen();
    }
  };

  private hoch = (e: PointerEvent) => {
    const s = this.ort(e);
    if (e.pointerType === 'touch') {
      this.zeiger.delete(e.pointerId);
      if (this.geste) {
        // die Geste endet erst, wenn alle Finger weg sind (ein liegengebliebener Finger malt nicht plötzlich)
        if (this.zeiger.size === 0) this.geste = null;
        return;
      }
    }
    if (this.schwenk) {
      this.schwenk = null;
      return;
    }
    const a = this.aktion;
    this.aktion = null;
    if (a) {
      try {
        a.ende(this.zuDok(s.x, s.y), e);
      } catch (f) {
        this.beiHinweis((f as Error).message);
      }
      this.mischSchmutzig = true;
      this.neuZeichnen();
      this.beiZustand();
    }
  };
  private abgebrochen = (e: PointerEvent) => {
    this.zeiger.delete(e.pointerId);
    if (this.zeiger.size === 0) this.geste = null;
    this.schwenk = null;
    this.aktionAbbrechen();
  };
  private verlassen = () => {
    this.schwebe = null;
    this.neuZeichnen();
  };
  private rad = (e: WheelEvent) => {
    e.preventDefault();
    const s = this.ort(e);
    // Strg/⌘/Alt + Rad (und die Zoom-Geste des Trackpads) zoomt, sonst wird verschoben – wie in Photoshop
    if (e.ctrlKey || e.metaKey || e.altKey) this.zoomen(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)), s.x, s.y);
    else {
      const f = e.deltaMode === 1 ? 32 : 1;
      this.vx -= (e.shiftKey ? e.deltaY : e.deltaX) * f;
      this.vy -= (e.shiftKey ? 0 : e.deltaY) * f;
      this.eingepasst = false;
      this.neuZeichnen();
    }
  };

  aktionAbbrechen() {
    const a = this.aktion;
    this.aktion = null;
    this.vorschau = null;
    if (a) {
      a.abbrechen();
      this.mischSchmutzig = true;
      this.neuZeichnen();
    }
  }
  get beschaeftigt() {
    return !!this.aktion;
  }

  // ---- Werkzeuge --------------------------------------------------------------------------------
  private malbar(): Ebene | null {
    const e = this.doc.aktiv;
    if (!e.sichtbar) {
      this.beiHinweis('Die aktive Ebene ist ausgeblendet – erst einblenden (Auge im Ebenen-Fenster).');
      return null;
    }
    return e;
  }

  private starten(s: Punkt, p: Punkt, e: PointerEvent): Aktion | null {
    switch (this.werkzeug) {
      case 'pinsel':
      case 'radierer':
        return this.pinsel(p, e, this.werkzeug === 'radierer');
      case 'pipette':
        return this.pipette(p, e);
      case 'fuellen':
        this.fuelleimer(p);
        return null;
      case 'zauberstab':
        this.zauberstab(p, e);
        return null;
      case 'auswahl-rechteck':
      case 'auswahl-ellipse':
      case 'lasso':
        return this.auswaehlen(p, e, this.werkzeug === 'lasso' ? 'lasso' : this.werkzeug === 'auswahl-ellipse' ? 'ellipse' : 'rechteck');
      case 'verschieben':
        return this.verschieben(p);
      case 'zuschneiden':
        return this.schnittZiehen(s, p);
      case 'form':
        return this.form(p);
      case 'verlauf':
        return this.verlauf(p);
      case 'text':
        // ein offenes Textfeld schließt sich durch diesen Klick selbst (und setzt seinen Text) – erst der nächste Klick setzt neu an
        if (this.textOrt) return null;
        this.textOrt = { x: Math.round(p.x), y: Math.round(p.y) };
        this.beiZustand();
        return null;
      case 'zoom':
        this.zoomen(e.altKey ? 1 / 1.5 : 1.5, s.x, s.y);
        return null;
      default:
        return null;
    }
  }

  private tupfer(durchmesser: number, haerte: number, farbe: string) {
    const d = Math.max(1, Math.round(durchmesser));
    const schluessel = `${d}|${haerte}|${farbe}`;
    let t = this.tupferCache.get(schluessel);
    if (t) return t;
    t = leinwand(d, d);
    const c = ctxVon(t);
    const r = d / 2;
    if (haerte >= 99 || d <= 2) {
      c.fillStyle = farbe;
      c.beginPath();
      c.arc(r, r, r, 0, Math.PI * 2);
      c.fill();
    } else {
      const g = c.createRadialGradient(r, r, 0, r, r, r);
      g.addColorStop(0, farbe);
      g.addColorStop(Math.max(0, Math.min(0.98, haerte / 100)), farbe);
      g.addColorStop(1, `${farbe}00`);
      c.fillStyle = g;
      c.fillRect(0, 0, d, d);
    }
    if (this.tupferCache.size > 24) this.tupferCache.clear();
    this.tupferCache.set(schluessel, t);
    return t;
  }

  private kratzLeinwand() {
    const d = this.doc;
    if (!this.kratz || this.kratz.width !== d.breite || this.kratz.height !== d.hoehe) this.kratz = leinwand(d.breite, d.hoehe);
    else ctxVon(this.kratz).clearRect(0, 0, d.breite, d.hoehe);
    return this.kratz;
  }

  private pinsel(p0: Punkt, e0: PointerEvent, radieren: boolean): Aktion | null {
    const ebene = this.malbar();
    if (!ebene) return null;
    const d = this.doc;
    const o = this.opt;
    const vorher = d.gespeichert(ebene);
    const strich = this.kratzLeinwand();
    const sc = ctxVon(strich);
    // der Strich sammelt nur Deckkraft (schwarze Tupfer); die Farbe kommt beim Auftragen in einem Zug dazu – so stimmt sie
    // aufs Bit, auch bei weichen, sich überlagernden Tupfern
    const tupfer = this.tupfer(o.groesse, o.haerte, '#000000');
    const farbig = radieren && !d.auswahl ? null : leinwand(d.breite, d.hoehe);
    const lc = ctxVon(ebene.leinwand);
    const druck = (e: PointerEvent) => (o.druck && e.pointerType === 'pen' && e.pressure > 0 ? 0.25 + 0.75 * e.pressure : 1);
    let letzter = p0;
    let letzterDruck = druck(e0);
    let rest = 0;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const stempel = (p: Punkt, f: number) => {
      const g = Math.max(1, o.groesse * f);
      sc.drawImage(tupfer, p.x - g / 2, p.y - g / 2, g, g);
      x0 = Math.min(x0, p.x - g / 2);
      y0 = Math.min(y0, p.y - g / 2);
      x1 = Math.max(x1, p.x + g / 2);
      y1 = Math.max(y1, p.y + g / 2);
    };
    const auftragen = () => {
      const rx = Math.max(0, Math.floor(x0) - 1);
      const ry = Math.max(0, Math.floor(y0) - 1);
      const rb = Math.min(d.breite, Math.ceil(x1) + 1) - rx;
      const rh = Math.min(d.hoehe, Math.ceil(y1) + 1) - ry;
      if (rb <= 0 || rh <= 0) return;
      let quelle = strich;
      if (farbig) {
        const mc = ctxVon(farbig);
        mc.globalCompositeOperation = 'source-over';
        mc.clearRect(rx, ry, rb, rh);
        mc.drawImage(strich, rx, ry, rb, rh, rx, ry, rb, rh);
        // source-in / destination-in leeren alles außerhalb des Rechtecks – gebraucht wird ohnehin nur das Rechteck
        if (!radieren) {
          mc.globalCompositeOperation = 'source-in';
          mc.fillStyle = o.vordergrund;
          mc.fillRect(rx, ry, rb, rh);
        }
        if (d.auswahl) {
          mc.globalCompositeOperation = 'destination-in';
          mc.drawImage(d.auswahl, rx, ry, rb, rh, rx, ry, rb, rh);
        }
        quelle = farbig;
      }
      lc.save();
      lc.clearRect(rx, ry, rb, rh);
      lc.drawImage(vorher, rx, ry, rb, rh, rx, ry, rb, rh);
      lc.globalAlpha = o.deckkraft / 100;
      lc.globalCompositeOperation = radieren ? 'destination-out' : 'source-over';
      lc.drawImage(quelle, rx, ry, rb, rh, rx, ry, rb, rh);
      lc.restore();
    };
    stempel(p0, letzterDruck);
    auftragen();
    this.mischSchmutzig = true;
    this.neuZeichnen();
    return {
      bewegen: (p, e) => {
        const f = druck(e);
        const dx = p.x - letzter.x;
        const dy = p.y - letzter.y;
        const lang = Math.hypot(dx, dy);
        const abstand = Math.max(0.5, o.groesse * 0.1);
        let weg = abstand - rest;
        while (weg <= lang) {
          const t = weg / lang;
          stempel({ x: letzter.x + dx * t, y: letzter.y + dy * t }, letzterDruck + (f - letzterDruck) * t);
          weg += abstand;
        }
        rest = lang - (weg - abstand);
        letzter = p;
        letzterDruck = f;
        auftragen();
      },
      ende: () => {
        d.beruehrt(ebene);
        d.festhalten(radieren ? 'Radierer' : 'Pinsel');
      },
      abbrechen: () => d.zuruecksetzen(ebene),
    };
  }

  private pipette(p0: Punkt, e0: PointerEvent): Aktion {
    const nehmen = (p: Punkt, e: PointerEvent) => {
      const x = Math.floor(p.x);
      const y = Math.floor(p.y);
      if (x < 0 || y < 0 || x >= this.doc.breite || y >= this.doc.hoehe) return;
      const d = ctxVon(this.gemischt()).getImageData(x, y, 1, 1).data;
      if (d[3] === 0) return;
      const farbe = hexAus(d[0]!, d[1]!, d[2]!);
      if (e.altKey) this.opt.hintergrund = farbe;
      else this.opt.vordergrund = farbe;
      this.beiZustand();
    };
    nehmen(p0, e0);
    return { bewegen: nehmen, ende: () => {}, abbrechen: () => {} };
  }

  private flut(p: Punkt) {
    const d = this.doc;
    const quelle = this.opt.alleEbenen ? this.gemischt() : d.aktiv.leinwand;
    const daten = ctxVon(quelle).getImageData(0, 0, d.breite, d.hoehe);
    return d.maskeAusDaten(flutMaske(daten.data, d.breite, d.hoehe, p.x, p.y, this.opt.toleranz, this.opt.zusammenhaengend));
  }
  private imBild(p: Punkt) {
    return p.x >= 0 && p.y >= 0 && p.x < this.doc.breite && p.y < this.doc.hoehe;
  }
  private fuelleimer(p: Punkt) {
    const e = this.malbar();
    if (!e || !this.imBild(p)) return;
    const m = this.flut(p);
    this.doc.malenMitAuswahl(
      e,
      (c) => {
        c.drawImage(m, 0, 0);
        c.globalCompositeOperation = 'source-in';
        c.fillStyle = this.opt.vordergrund;
        c.fillRect(0, 0, this.doc.breite, this.doc.hoehe);
      },
      'source-over',
      this.opt.deckkraft / 100,
    );
    this.doc.festhalten('Füllen');
  }
  private modus(e: PointerEvent): 'neu' | 'plus' | 'minus' {
    return e.shiftKey ? 'plus' : e.altKey ? 'minus' : this.opt.auswahlModus;
  }
  private zauberstab(p: Punkt, e: PointerEvent) {
    if (!this.imBild(p)) return this.doc.auswahlSetzen(null, 'neu', 'Auswahl aufheben');
    this.doc.auswahlSetzen(this.flut(p), this.modus(e), 'Zauberstab');
  }

  private auswaehlen(p0: Punkt, e0: PointerEvent, art: 'rechteck' | 'ellipse' | 'lasso'): Aktion {
    const modus = this.modus(e0);
    const d = this.doc;
    const punkte: Punkt[] = [p0, p0];
    this.vorschau = { art, punkte };
    const ende = (p: Punkt, e: PointerEvent) => {
      // Umschalt hält Quadrat/Kreis – aber nur, wenn Umschalt nicht schon „dazu“ bedeutet hat
      if (e.shiftKey && modus !== 'plus') {
        const s = Math.max(Math.abs(p.x - p0.x), Math.abs(p.y - p0.y));
        return { x: p0.x + Math.sign(p.x - p0.x) * s, y: p0.y + Math.sign(p.y - p0.y) * s };
      }
      return p;
    };
    return {
      bewegen: (p, e) => {
        if (art === 'lasso') punkte.push(p);
        else punkte[1] = ende(p, e);
      },
      ende: (p, e) => {
        this.vorschau = null;
        let maske: HTMLCanvasElement | null = null;
        if (art === 'lasso') {
          if (punkte.length >= 4) {
            maske = d.maskeAusPfad((c) => {
              c.moveTo(punkte[0]!.x, punkte[0]!.y);
              for (const q of punkte.slice(1)) c.lineTo(q.x, q.y);
              c.closePath();
            });
          }
        } else {
          const q = ende(p, e);
          const x = Math.round(Math.max(0, Math.min(p0.x, q.x)));
          const y = Math.round(Math.max(0, Math.min(p0.y, q.y)));
          const b = Math.round(Math.min(d.breite, Math.max(p0.x, q.x))) - x;
          const h = Math.round(Math.min(d.hoehe, Math.max(p0.y, q.y))) - y;
          if (b >= 1 && h >= 1 && (b > 1 || h > 1)) {
            maske = d.maskeAusPfad((c) => (art === 'rechteck' ? c.rect(x, y, b, h) : c.ellipse(x + b / 2, y + h / 2, b / 2, h / 2, 0, 0, Math.PI * 2)), art !== 'rechteck');
          }
        }
        // Klick ohne Ziehen hebt die Auswahl auf
        if (!maske) {
          if (modus === 'neu') d.auswahlSetzen(null, 'neu', 'Auswahl aufheben');
          return;
        }
        d.auswahlSetzen(maske, modus, art === 'lasso' ? 'Lasso' : art === 'ellipse' ? 'Auswahlellipse' : 'Auswahlrechteck');
      },
      abbrechen: () => {
        this.vorschau = null;
      },
    };
  }

  /** verschiebt den Inhalt der Auswahl (oder die ganze Ebene) um ganze Pixel; die Auswahl wandert mit */
  private versatzAnwenden(ebene: Ebene, vorher: HTMLCanvasElement, auswahlVorher: HTMLCanvasElement | null, dx: number, dy: number) {
    const d = this.doc;
    const lc = ctxVon(ebene.leinwand);
    lc.clearRect(0, 0, d.breite, d.hoehe);
    if (auswahlVorher) {
      const teil = kopie(vorher);
      const tc = ctxVon(teil);
      tc.globalCompositeOperation = 'destination-in';
      tc.drawImage(auswahlVorher, 0, 0);
      lc.drawImage(vorher, 0, 0);
      lc.save();
      lc.globalCompositeOperation = 'destination-out';
      lc.drawImage(auswahlVorher, 0, 0);
      lc.restore();
      lc.drawImage(teil, dx, dy);
      const m = leinwand(d.breite, d.hoehe);
      ctxVon(m).drawImage(auswahlVorher, dx, dy);
      d.auswahlSetzen(m, 'neu', null);
    } else lc.drawImage(vorher, dx, dy);
  }
  private verschieben(p0: Punkt): Aktion | null {
    const ebene = this.malbar();
    if (!ebene) return null;
    const d = this.doc;
    const vorher = d.gespeichert(ebene);
    const auswahlVorher = d.auswahl ? kopie(d.auswahl) : null;
    let bewegt = false;
    return {
      bewegen: (p) => {
        const dx = Math.round(p.x - p0.x);
        const dy = Math.round(p.y - p0.y);
        if (dx || dy) bewegt = true;
        this.versatzAnwenden(ebene, vorher, auswahlVorher, dx, dy);
      },
      ende: () => {
        if (!bewegt) return;
        d.auswahlPruefen();
        d.beruehrt(ebene);
        d.festhalten('Verschieben');
      },
      abbrechen: () => {
        d.zuruecksetzen(ebene);
        if (auswahlVorher) d.auswahlSetzen(auswahlVorher, 'neu', null);
      },
    };
  }
  /** Pfeiltasten: um dx/dy Pixel schieben */
  schieben(dx: number, dy: number) {
    if (this.transform) {
      this.transform.cx += dx;
      this.transform.cy += dy;
      this.transformMalen();
      return;
    }
    const ebene = this.malbar();
    if (!ebene || this.aktion) return;
    this.versatzAnwenden(ebene, this.doc.gespeichert(ebene), this.doc.auswahl ? kopie(this.doc.auswahl) : null, dx, dy);
    this.doc.auswahlPruefen();
    this.doc.beruehrt(ebene);
    this.doc.festhalten('Verschieben');
  }

  private formPfad(c: CanvasRenderingContext2D, a: Punkt, b: Punkt) {
    const o = this.opt;
    c.fillStyle = o.vordergrund;
    c.strokeStyle = o.vordergrund;
    c.lineWidth = o.strich;
    c.lineJoin = 'miter';
    c.beginPath();
    if (o.form === 'linie') {
      c.lineCap = 'round';
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      c.stroke();
      return;
    }
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    const rand = o.gefuellt ? 0 : o.strich / 2;
    if (w <= 2 * rand || h <= 2 * rand) return;
    if (o.form === 'rechteck') c.rect(x + rand, y + rand, w - 2 * rand, h - 2 * rand);
    else c.ellipse(x + w / 2, y + h / 2, w / 2 - rand, h / 2 - rand, 0, 0, Math.PI * 2);
    if (o.gefuellt) c.fill();
    else c.stroke();
  }
  private form(p0: Punkt): Aktion | null {
    const ebene = this.malbar();
    if (!ebene) return null;
    const d = this.doc;
    let gemalt = false;
    const ziel = (p: Punkt, e: PointerEvent): Punkt => {
      if (!e.shiftKey) return p;
      const dx = p.x - p0.x;
      const dy = p.y - p0.y;
      if (this.opt.form === 'linie') {
        // auf 45°-Schritte einrasten
        const w = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const l = Math.hypot(dx, dy);
        return { x: p0.x + Math.cos(w) * l, y: p0.y + Math.sin(w) * l };
      }
      const s = Math.max(Math.abs(dx), Math.abs(dy));
      return { x: p0.x + Math.sign(dx || 1) * s, y: p0.y + Math.sign(dy || 1) * s };
    };
    const malen = (p: Punkt, e: PointerEvent) => {
      d.zuruecksetzen(ebene);
      const q = ziel(p, e);
      if (Math.hypot(q.x - p0.x, q.y - p0.y) < 1) return (gemalt = false);
      d.malenMitAuswahl(ebene, (c) => this.formPfad(c, p0, q), 'source-over', this.opt.deckkraft / 100);
      return (gemalt = true);
    };
    return {
      bewegen: (p, e) => void malen(p, e),
      ende: (p, e) => {
        if (malen(p, e)) d.festhalten(this.opt.form === 'linie' ? 'Linie' : this.opt.form === 'ellipse' ? 'Ellipse' : 'Rechteck');
        else if (gemalt) d.zuruecksetzen(ebene);
      },
      abbrechen: () => d.zuruecksetzen(ebene),
    };
  }

  private verlauf(p0: Punkt): Aktion | null {
    const ebene = this.malbar();
    if (!ebene) return null;
    const d = this.doc;
    const o = this.opt;
    const malen = (p: Punkt) => {
      d.zuruecksetzen(ebene);
      const lang = Math.hypot(p.x - p0.x, p.y - p0.y);
      if (lang < 2) return false;
      d.malenMitAuswahl(
        ebene,
        (c) => {
          const g = o.verlaufArt === 'radial' ? c.createRadialGradient(p0.x, p0.y, 0, p0.x, p0.y, lang) : c.createLinearGradient(p0.x, p0.y, p.x, p.y);
          g.addColorStop(0, o.vordergrund);
          g.addColorStop(1, o.verlaufTransparent ? `${o.vordergrund}00` : o.hintergrund);
          c.fillStyle = g;
          c.fillRect(0, 0, d.breite, d.hoehe);
        },
        'source-over',
        o.deckkraft / 100,
      );
      return true;
    };
    return {
      bewegen: (p) => void malen(p),
      ende: (p) => {
        if (malen(p)) d.festhalten('Verlauf');
      },
      abbrechen: () => d.zuruecksetzen(ebene),
    };
  }

  /** Text als neue Ebene (x/y = linke obere Ecke der ersten Zeile) */
  textSetzen(text: string) {
    const ort = this.textOrt;
    this.textOrt = null;
    this.beiZustand();
    if (!ort || !text.trim()) return;
    const d = this.doc;
    const o = this.opt;
    const e = d.ebeneAnlegen(text.trim().split('\n')[0]!.slice(0, 24) || 'Text');
    const c = ctxVon(e.leinwand);
    c.font = this.textSchrift();
    c.fillStyle = o.vordergrund;
    c.globalAlpha = o.deckkraft / 100;
    c.textBaseline = 'top';
    // kleine Verschiebung nach unten: so sitzt der Text dort, wo ihn das Eingabefeld gezeigt hat (halber Zeilenabstand)
    text.split('\n').forEach((zeile, i) => c.fillText(zeile, ort.x, ort.y + (i * 1.25 + 0.1) * o.schriftGroesse));
    d.beruehrt(e);
    d.festhalten('Text');
  }
  textSchrift(groesse = this.opt.schriftGroesse) {
    const o = this.opt;
    return `${o.kursiv ? 'italic ' : ''}${o.fett ? 'bold ' : ''}${groesse}px ${o.schrift}`;
  }

  // ---- Zuschneiden ------------------------------------------------------------------------------
  private schnittGriff(s: Punkt): Griff | 'innen' | null {
    const r = this.schnitt;
    if (!r) return null;
    const a = this.zuAnsicht({ x: r.x, y: r.y });
    for (const g of GRIFFE) {
      const [gx, gy] = GRIFF_ORT[g];
      if (Math.abs(s.x - (a.x + r.b * this.zoom * (gx + 0.5))) <= 14 && Math.abs(s.y - (a.y + r.h * this.zoom * (gy + 0.5))) <= 14) return g;
    }
    return s.x > a.x && s.y > a.y && s.x < a.x + r.b * this.zoom && s.y < a.y + r.h * this.zoom ? 'innen' : null;
  }
  private schnittZiehen(s: Punkt, p0: Punkt): Aktion {
    const d = this.doc;
    const griff = this.schnittGriff(s);
    const start = this.schnitt ? { ...this.schnitt } : null;
    const klemmen = (x0: number, y0: number, x1: number, y1: number) => {
      const x = Math.round(Math.max(0, Math.min(x0, x1)));
      const y = Math.round(Math.max(0, Math.min(y0, y1)));
      const b = Math.round(Math.min(d.breite, Math.max(x0, x1))) - x;
      const h = Math.round(Math.min(d.hoehe, Math.max(y0, y1))) - y;
      return b >= 1 && h >= 1 ? { x, y, b, h } : null;
    };
    return {
      bewegen: (p) => {
        if (griff && start) {
          if (griff === 'innen') {
            const x = Math.round(Math.max(0, Math.min(d.breite - start.b, start.x + p.x - p0.x)));
            const y = Math.round(Math.max(0, Math.min(d.hoehe - start.h, start.y + p.y - p0.y)));
            this.schnitt = { ...start, x, y };
          } else {
            const [gx, gy] = GRIFF_ORT[griff];
            const x0 = gx < 0 ? p.x : start.x;
            const x1 = gx > 0 ? p.x : start.x + start.b;
            const y0 = gy < 0 ? p.y : start.y;
            const y1 = gy > 0 ? p.y : start.y + start.h;
            this.schnitt = klemmen(x0, y0, x1, y1) ?? this.schnitt;
          }
        } else this.schnitt = klemmen(p0.x, p0.y, p.x, p.y) ?? this.schnitt;
        this.beiZustand();
      },
      ende: () => this.beiZustand(),
      abbrechen: () => {
        this.schnitt = start;
      },
    };
  }
  schnittAnwenden() {
    if (!this.schnitt) return;
    const r = this.schnitt;
    this.schnitt = null;
    this.doc.zuschneiden(r);
    this.einpassen();
  }
  schnittAbbrechen() {
    this.schnitt = null;
    this.neuZeichnen();
    this.beiZustand();
  }

  // ---- Frei transformieren ----------------------------------------------------------------------
  transformStarten() {
    if (this.transform) return;
    this.aktionAbbrechen();
    const e = this.malbar();
    if (!e) return;
    const d = this.doc;
    const a = d.ausschnitt(e);
    if (!a) return this.beiHinweis('Hier ist nichts zu transformieren – die Ebene (bzw. die Auswahl) ist leer.');
    const rest = kopie(d.gespeichert(e));
    let maske: HTMLCanvasElement | null = null;
    if (d.auswahl) {
      const rc = ctxVon(rest);
      rc.globalCompositeOperation = 'destination-out';
      rc.drawImage(d.auswahl, 0, 0);
      maske = leinwand(a.bild.width, a.bild.height);
      ctxVon(maske).drawImage(d.auswahl, -a.x, -a.y);
    } else ctxVon(rest).clearRect(0, 0, rest.width, rest.height);
    this.transform = { ebene: e, bild: a.bild, rest, maske, cx: a.x + a.bild.width / 2, cy: a.y + a.bild.height / 2, bw: a.bild.width, bh: a.bild.height, winkel: 0 };
    this.schnitt = null;
    this.transformMalen();
  }
  private transformAuf(c: CanvasRenderingContext2D, t: Transform, bild: HTMLCanvasElement) {
    c.save();
    c.translate(t.cx, t.cy);
    c.rotate(t.winkel);
    c.scale(t.bw / bild.width, t.bh / bild.height);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(bild, -bild.width / 2, -bild.height / 2);
    c.restore();
  }
  transformMalen() {
    const t = this.transform;
    if (!t) return;
    const c = ctxVon(t.ebene.leinwand);
    c.clearRect(0, 0, this.doc.breite, this.doc.hoehe);
    c.drawImage(t.rest, 0, 0);
    this.transformAuf(c, t, t.bild);
    this.mischSchmutzig = true;
    this.neuZeichnen();
    this.beiZustand();
  }
  transformSetzen(a: Partial<Pick<Transform, 'bw' | 'bh' | 'winkel' | 'cx' | 'cy'>>) {
    if (!this.transform) return;
    Object.assign(this.transform, a);
    this.transformMalen();
  }
  transformAnwenden() {
    const t = this.transform;
    if (!t) return;
    this.transform = null;
    const d = this.doc;
    if (t.maske) {
      const m = leinwand(d.breite, d.hoehe);
      this.transformAuf(ctxVon(m), t, t.maske);
      d.auswahlSetzen(m, 'neu', null);
      d.auswahlPruefen();
    }
    d.beruehrt(t.ebene);
    d.festhalten('Transformieren');
    this.beiZustand();
  }
  transformAbbrechen() {
    const t = this.transform;
    if (!t) return;
    this.transform = null;
    this.doc.zuruecksetzen(t.ebene);
    this.mischSchmutzig = true;
    this.neuZeichnen();
    this.beiZustand();
  }
  private transformZiehen(s: Punkt, p0: Punkt, e0: PointerEvent): Aktion {
    const t = this.transform!;
    const start = { ...t };
    const nah = (a: Punkt, r: number) => Math.hypot(a.x - s.x, a.y - s.y) <= r;
    const griff = GRIFFE.find((g) => nah(this.zuAnsicht(this.transformEcke(t, ...GRIFF_ORT[g])), e0.pointerType === 'touch' ? 20 : 11));
    // in den Rahmen umgerechnet: liegt der Punkt innen?
    const lokal = (p: Punkt) => {
      const dx = p.x - start.cx;
      const dy = p.y - start.cy;
      const co = Math.cos(-start.winkel);
      const si = Math.sin(-start.winkel);
      return { x: dx * co - dy * si, y: dx * si + dy * co };
    };
    const l0 = lokal(p0);
    const innen = Math.abs(l0.x) <= Math.abs(start.bw) / 2 && Math.abs(l0.y) <= Math.abs(start.bh) / 2;
    const art: 'groesse' | 'drehen' | 'schieben' = griff ? 'groesse' : nah(this.drehGriff(t), 18) || !innen ? 'drehen' : 'schieben';
    const w0 = Math.atan2(p0.y - start.cy, p0.x - start.cx);
    return {
      bewegen: (p, e) => {
        if (art === 'schieben') {
          t.cx = start.cx + Math.round(p.x - p0.x);
          t.cy = start.cy + Math.round(p.y - p0.y);
        } else if (art === 'drehen') {
          let w = start.winkel + Math.atan2(p.y - start.cy, p.x - start.cx) - w0;
          if (e.shiftKey) w = Math.round(w / (Math.PI / 12)) * (Math.PI / 12);
          t.winkel = w;
        } else if (griff) {
          const [gx, gy] = GRIFF_ORT[griff];
          // fester Punkt = gegenüberliegender Griff; alles im gedrehten Rahmen rechnen
          const fest = { x: -gx * start.bw, y: -gy * start.bh };
          const z = lokal(p);
          let bw = gx ? (z.x - fest.x) * Math.sign(gx) : start.bw;
          let bh = gy ? (z.y - fest.y) * Math.sign(gy) : start.bh;
          if (gx && gy && !e.shiftKey) {
            // Ecken halten das Seitenverhältnis (Umschalt gibt es frei)
            const f = Math.max(Math.abs(bw / start.bw), Math.abs(bh / start.bh));
            bw = start.bw * f * Math.sign(bw / start.bw || 1);
            bh = start.bh * f * Math.sign(bh / start.bh || 1);
          }
          if (Math.abs(bw) < 1) bw = Math.sign(bw || 1);
          if (Math.abs(bh) < 1) bh = Math.sign(bh || 1);
          // neue Mitte: fester Punkt + halbe neue Größe, zurück in Dokumentkoordinaten
          const mx = fest.x + (gx ? Math.sign(gx) * bw : 0) / 2 + (gx ? 0 : -fest.x);
          const my = fest.y + (gy ? Math.sign(gy) * bh : 0) / 2 + (gy ? 0 : -fest.y);
          const co = Math.cos(start.winkel);
          const si = Math.sin(start.winkel);
          t.cx = start.cx + mx * co - my * si;
          t.cy = start.cy + mx * si + my * co;
          t.bw = bw;
          t.bh = bh;
        }
        this.transformMalen();
      },
      ende: () => {},
      abbrechen: () => {
        Object.assign(t, start);
        this.transformMalen();
      },
    };
  }
}
