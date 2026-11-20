import { deckendeGrenzen } from './filter';
import { PROJEKT_FORMAT, zipLesen, zipSchreiben, type ProjektInhalt, type ZipDatei } from './projekt';

/**
 * E198 Atelier: das Dokument – Ebenen (je eine Leinwand in Dokumentgröße), Auswahl (Maske), Verlauf (Rückgängig) und
 * alle Operationen darauf. Kein React, kein Zeiger: Die Bühne (buehne.ts) und die Oberfläche (Atelier.tsx) rufen das hier.
 *
 * Grundlage ist bewusst das Canvas-2D des Browsers ohne Bibliothek: Ein Pixel-Editor braucht Rasterebenen, Mischmodi
 * (globalCompositeOperation kann alle 16), Pixelzugriff für Filter und Zeigerereignisse mit Druck – das alles ist
 * eingebaut. Konva/Fabric/Pixi sind Szenengraphen für Objekte und brächten 150–500 KB ohne Pinsel, Zauberstab oder Filter.
 */

export const MISCHMODI = [
  ['source-over', 'Normal'],
  ['multiply', 'Multiplizieren'],
  ['screen', 'Negativ multiplizieren'],
  ['overlay', 'Ineinanderkopieren'],
  ['darken', 'Abdunkeln'],
  ['lighten', 'Aufhellen'],
  ['color-dodge', 'Farbig abwedeln'],
  ['color-burn', 'Farbig nachbelichten'],
  ['hard-light', 'Hartes Licht'],
  ['soft-light', 'Weiches Licht'],
  ['difference', 'Differenz'],
  ['exclusion', 'Ausschluss'],
  ['hue', 'Farbton'],
  ['saturation', 'Sättigung'],
  ['color', 'Farbe'],
  ['luminosity', 'Luminanz'],
] as const;
export type Mischmodus = (typeof MISCHMODI)[number][0];

export interface Ebene {
  id: number;
  name: string;
  leinwand: HTMLCanvasElement;
  sichtbar: boolean;
  /** 0 … 1 */
  deckkraft: number;
  modus: Mischmodus;
  /** bekommt bei jeder Pixeländerung eine neue, im Dokument einmalige Nummer – der Verlauf teilt unveränderte Ebenen */
  stand: number;
}

interface SchnappEbene extends Omit<Ebene, 'leinwand'> {
  bild: HTMLCanvasElement;
}
interface Schnappschuss {
  name: string;
  breite: number;
  hoehe: number;
  aktivId: number;
  ebenen: SchnappEbene[];
  auswahl: HTMLCanvasElement | null;
  auswahlStand: number;
}

export type Rechteck = { x: number; y: number; b: number; h: number };
export const MAX_KANTE = 8192;
export const MAX_PIXEL = 32_000_000;
/** höchstens so viele Schritte und so viel Speicher im Verlauf (ältere fliegen raus) */
const VERLAUF_MAX = 40;
const VERLAUF_BYTES = (typeof navigator !== 'undefined' && (navigator as Navigator & { deviceMemory?: number }).deviceMemory && (navigator as Navigator & { deviceMemory?: number }).deviceMemory! <= 4 ? 300 : 700) * 1024 * 1024;

export function leinwand(b: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(b));
  c.height = Math.max(1, Math.round(h));
  return c;
}
export const ctxVon = (c: HTMLCanvasElement) => c.getContext('2d')!;
export function kopie(c: CanvasImageSource & { width: number; height: number }) {
  const k = leinwand(c.width, c.height);
  ctxVon(k).drawImage(c, 0, 0);
  return k;
}
export function groessePruefen(b: number, h: number) {
  if (!(b >= 1 && h >= 1)) throw new Error('Breite und Höhe müssen mindestens 1 Pixel sein.');
  if (b > MAX_KANTE || h > MAX_KANTE) throw new Error(`Höchstens ${MAX_KANTE} Pixel je Kante.`);
  if (b * h > MAX_PIXEL) throw new Error(`Höchstens ${MAX_PIXEL / 1_000_000} Megapixel.`);
}
export function alsBlob(c: HTMLCanvasElement, typ = 'image/png', qualitaet?: number): Promise<Blob> {
  return new Promise((ok, fehler) => c.toBlob((b) => (b ? ok(b) : fehler(new Error('Bild ließ sich nicht kodieren.'))), typ, qualitaet));
}
export async function bildLaden(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Das ist kein Bild, das der Browser lesen kann.');
  }
}

export class Dokument {
  breite: number;
  hoehe: number;
  ebenen: Ebene[] = [];
  aktivId = 0;
  /** Auswahl als Maske in Dokumentgröße (Deckkraft = ausgewählt); null = nichts ausgewählt (dann gilt alles) */
  auswahl: HTMLCanvasElement | null = null;
  auswahlStand = 0;
  verlauf: Schnappschuss[] = [];
  verlaufPos = -1;
  /** seit dem letzten Speichern verändert? */
  geaendert = false;
  private naechsteId = 1;
  private standZaehler = 0;
  private zuhoerer = new Set<() => void>();
  private grenzenCache: { stand: number; wert: Rechteck | null } | null = null;

  constructor(b: number, h: number) {
    groessePruefen(b, h);
    this.breite = Math.round(b);
    this.hoehe = Math.round(h);
  }

  static leer(b: number, h: number, hintergrund: string | null) {
    const d = new Dokument(b, h);
    const e = d.ebeneAnlegen('Hintergrund');
    if (hintergrund) {
      const c = ctxVon(e.leinwand);
      c.fillStyle = hintergrund;
      c.fillRect(0, 0, d.breite, d.hoehe);
    }
    d.festhalten('Neu');
    d.geaendert = false;
    return d;
  }

  static ausBild(bild: CanvasImageSource & { width: number; height: number }, name = 'Hintergrund') {
    const d = new Dokument(bild.width, bild.height);
    ctxVon(d.ebeneAnlegen(name).leinwand).drawImage(bild, 0, 0);
    d.festhalten('Öffnen');
    d.geaendert = false;
    return d;
  }

  // ---- Zuhören ----------------------------------------------------------------------------------
  abonnieren(f: () => void) {
    this.zuhoerer.add(f);
    return () => {
      this.zuhoerer.delete(f);
    };
  }
  melden() {
    for (const f of this.zuhoerer) f();
  }

  // ---- Ebenen -----------------------------------------------------------------------------------
  get aktiv(): Ebene {
    return this.ebenen.find((e) => e.id === this.aktivId) ?? this.ebenen[this.ebenen.length - 1]!;
  }
  ebene(id: number) {
    return this.ebenen.find((e) => e.id === id);
  }
  /** legt eine Ebene über der aktiven an und macht sie aktiv (ohne Verlaufsschritt – den setzt der Aufrufer) */
  ebeneAnlegen(name?: string, bild?: HTMLCanvasElement): Ebene {
    const id = this.naechsteId++;
    const e: Ebene = { id, name: name ?? `Ebene ${id}`, leinwand: bild ?? leinwand(this.breite, this.hoehe), sichtbar: true, deckkraft: 1, modus: 'source-over', stand: ++this.standZaehler };
    const i = this.ebenen.findIndex((x) => x.id === this.aktivId);
    this.ebenen.splice(i < 0 ? this.ebenen.length : i + 1, 0, e);
    this.aktivId = id;
    return e;
  }
  beruehrt(e: Ebene = this.aktiv) {
    e.stand = ++this.standZaehler;
  }
  neueEbene(name?: string) {
    const e = this.ebeneAnlegen(name);
    this.festhalten('Neue Ebene');
    return e;
  }
  ebeneDuplizieren(id = this.aktivId) {
    const q = this.ebene(id);
    if (!q) return;
    this.aktivId = id;
    const e = this.ebeneAnlegen(`${q.name} Kopie`, kopie(q.leinwand));
    Object.assign(e, { deckkraft: q.deckkraft, modus: q.modus, sichtbar: q.sichtbar });
    this.festhalten('Ebene duplizieren');
  }
  ebeneLoeschen(id = this.aktivId) {
    if (this.ebenen.length <= 1) throw new Error('Die letzte Ebene bleibt – ein Bild braucht mindestens eine.');
    const i = this.ebenen.findIndex((e) => e.id === id);
    if (i < 0) return;
    this.ebenen.splice(i, 1);
    if (this.aktivId === id) this.aktivId = this.ebenen[Math.max(0, i - 1)]!.id;
    this.festhalten('Ebene löschen');
  }
  /** richtung +1 = nach oben (weiter vorn), −1 = nach unten */
  ebeneVerschieben(id: number, richtung: 1 | -1) {
    const i = this.ebenen.findIndex((e) => e.id === id);
    const j = i + richtung;
    if (i < 0 || j < 0 || j >= this.ebenen.length) return;
    [this.ebenen[i], this.ebenen[j]] = [this.ebenen[j]!, this.ebenen[i]!];
    this.festhalten('Ebenen-Reihenfolge');
  }
  ebeneSetzen(id: number, a: Partial<Pick<Ebene, 'name' | 'sichtbar' | 'deckkraft' | 'modus'>>, schritt: string | null = 'Ebene ändern') {
    const e = this.ebene(id);
    if (!e) return;
    Object.assign(e, a);
    if (schritt) this.festhalten(schritt);
    else this.melden();
  }
  /** vereint die Ebene mit der darunter (Deckkraft und Mischmodus werden eingerechnet) */
  nachUntenVereinen(id = this.aktivId) {
    const i = this.ebenen.findIndex((e) => e.id === id);
    if (i <= 0) throw new Error('Darunter liegt keine Ebene.');
    const oben = this.ebenen[i]!;
    const unten = this.ebenen[i - 1]!;
    const c = ctxVon(unten.leinwand);
    c.save();
    c.globalAlpha = oben.deckkraft;
    c.globalCompositeOperation = oben.modus;
    c.drawImage(oben.leinwand, 0, 0);
    c.restore();
    this.beruehrt(unten);
    this.ebenen.splice(i, 1);
    this.aktivId = unten.id;
    this.festhalten('Nach unten vereinen');
  }
  aufEineReduzieren() {
    const bild = this.zusammengesetzt();
    this.ebenen = [];
    this.aktivId = 0;
    this.ebeneAnlegen('Hintergrund', bild);
    this.festhalten('Auf eine Ebene reduzieren');
  }

  // ---- Zusammensetzen ---------------------------------------------------------------------------
  /** zeichnet alle sichtbaren Ebenen (von unten nach oben) in den Kontext */
  zeichnen(c: CanvasRenderingContext2D) {
    for (const e of this.ebenen) {
      if (!e.sichtbar || e.deckkraft <= 0) continue;
      c.globalAlpha = e.deckkraft;
      c.globalCompositeOperation = e.modus;
      c.drawImage(e.leinwand, 0, 0);
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }
  zusammengesetzt(hintergrund?: string): HTMLCanvasElement {
    const l = leinwand(this.breite, this.hoehe);
    const c = ctxVon(l);
    if (hintergrund) {
      c.fillStyle = hintergrund;
      c.fillRect(0, 0, l.width, l.height);
    }
    this.zeichnen(c);
    return l;
  }
  /** fertiges Bild als Datei; JPEG kennt keine Durchsichtigkeit → weißer Grund */
  async exportieren(format: 'png' | 'jpg' | 'webp', qualitaet = 0.92): Promise<Blob> {
    const typ = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[format];
    const blob = await alsBlob(this.zusammengesetzt(format === 'jpg' ? '#ffffff' : undefined), typ, format === 'png' ? undefined : qualitaet);
    if (blob.type !== typ) throw new Error(`Dieser Browser kann ${format.toUpperCase()} nicht schreiben – bitte PNG oder JPG wählen.`);
    return blob;
  }

  // ---- Verlauf ----------------------------------------------------------------------------------
  /** hält den jetzigen Zustand als Schritt fest (nach jeder abgeschlossenen Änderung) */
  festhalten(name: string) {
    const davor = this.verlauf[this.verlaufPos];
    const s: Schnappschuss = {
      name,
      breite: this.breite,
      hoehe: this.hoehe,
      aktivId: this.aktivId,
      ebenen: this.ebenen.map((e) => {
        // unveränderte Ebene: das Bild des vorigen Schritts mitbenutzen (spart Speicher und Zeit)
        const alt = davor?.ebenen.find((x) => x.id === e.id && x.stand === e.stand && x.bild.width === e.leinwand.width && x.bild.height === e.leinwand.height);
        return { id: e.id, name: e.name, sichtbar: e.sichtbar, deckkraft: e.deckkraft, modus: e.modus, stand: e.stand, bild: alt?.bild ?? kopie(e.leinwand) };
      }),
      auswahl: this.auswahl ? (davor && davor.auswahlStand === this.auswahlStand && davor.auswahl ? davor.auswahl : kopie(this.auswahl)) : null,
      auswahlStand: this.auswahlStand,
    };
    this.verlauf.length = this.verlaufPos + 1;
    this.verlauf.push(s);
    this.verlaufPos = this.verlauf.length - 1;
    this.verlaufKuerzen();
    this.geaendert = true;
    this.melden();
  }
  private verlaufKuerzen() {
    const bytes = () => {
      const gesehen = new Set<HTMLCanvasElement>();
      for (const s of this.verlauf) {
        for (const e of s.ebenen) gesehen.add(e.bild);
        if (s.auswahl) gesehen.add(s.auswahl);
      }
      let n = 0;
      for (const c of gesehen) n += c.width * c.height * 4;
      return n;
    };
    while (this.verlauf.length > 2 && (this.verlauf.length > VERLAUF_MAX || bytes() > VERLAUF_BYTES)) {
      this.verlauf.shift();
      this.verlaufPos--;
    }
  }
  /** das Bild der Ebene, wie es im aktuellen Verlaufsschritt steht (unveränderlich – als „vorher“ für Werkzeuge) */
  gespeichert(e: Ebene = this.aktiv): HTMLCanvasElement {
    const s = this.verlauf[this.verlaufPos]?.ebenen.find((x) => x.id === e.id);
    return s?.bild ?? kopie(e.leinwand);
  }
  /** stellt die Ebene aus dem aktuellen Verlaufsschritt wieder her (Werkzeug abgebrochen) */
  zuruecksetzen(e: Ebene = this.aktiv) {
    const s = this.verlauf[this.verlaufPos]?.ebenen.find((x) => x.id === e.id);
    if (!s) return;
    const c = ctxVon(e.leinwand);
    c.clearRect(0, 0, e.leinwand.width, e.leinwand.height);
    c.drawImage(s.bild, 0, 0);
    e.stand = s.stand;
  }
  private herstellen(s: Schnappschuss) {
    this.breite = s.breite;
    this.hoehe = s.hoehe;
    this.ebenen = s.ebenen.map((x) => {
      const da = this.ebenen.find((e) => e.id === x.id && e.stand === x.stand && e.leinwand.width === s.breite && e.leinwand.height === s.hoehe);
      return { id: x.id, name: x.name, sichtbar: x.sichtbar, deckkraft: x.deckkraft, modus: x.modus, stand: x.stand, leinwand: da?.leinwand ?? kopie(x.bild) };
    });
    this.aktivId = s.aktivId;
    this.auswahl = s.auswahl ? kopie(s.auswahl) : null;
    this.auswahlStand = s.auswahlStand;
    this.grenzenCache = null;
    this.geaendert = true;
    this.melden();
  }
  get kannRueckgaengig() {
    return this.verlaufPos > 0;
  }
  get kannWiederholen() {
    return this.verlaufPos < this.verlauf.length - 1;
  }
  rueckgaengig() {
    if (this.kannRueckgaengig) this.herstellen(this.verlauf[--this.verlaufPos]!);
  }
  wiederholen() {
    if (this.kannWiederholen) this.herstellen(this.verlauf[++this.verlaufPos]!);
  }
  springen(i: number) {
    if (i < 0 || i >= this.verlauf.length || i === this.verlaufPos) return;
    this.verlaufPos = i;
    this.herstellen(this.verlauf[i]!);
  }

  // ---- Auswahl ----------------------------------------------------------------------------------
  /** setzt die Auswahl aus einer Maske; modus: neu, plus (dazu), minus (abziehen), schnitt (Schnittmenge) */
  auswahlSetzen(maske: HTMLCanvasElement | null, modus: 'neu' | 'plus' | 'minus' | 'schnitt' = 'neu', schritt: string | null = 'Auswahl') {
    if (!maske) {
      if (!this.auswahl) return;
      this.auswahl = null;
    } else if (modus === 'neu' || !this.auswahl) {
      if (modus === 'minus' || (modus === 'schnitt' && !this.auswahl)) return;
      this.auswahl = kopie(maske);
    } else {
      const c = ctxVon(this.auswahl);
      c.save();
      c.globalCompositeOperation = modus === 'plus' ? 'source-over' : modus === 'minus' ? 'destination-out' : 'destination-in';
      c.drawImage(maske, 0, 0);
      c.restore();
    }
    this.auswahlStand++;
    this.grenzenCache = null;
    // ohne Verlaufsschritt (während ein Werkzeug zieht) wird nicht geprüft – das Auslesen der Maske wäre je Bewegung zu teuer
    if (schritt) {
      this.auswahlPruefen();
      this.festhalten(schritt);
    } else this.melden();
  }
  /** leere Auswahl = keine Auswahl */
  auswahlPruefen() {
    if (this.auswahl && !this.auswahlGrenzen()) {
      this.auswahl = null;
      this.auswahlStand++;
    }
  }
  allesAuswaehlen() {
    const m = leinwand(this.breite, this.hoehe);
    const c = ctxVon(m);
    c.fillStyle = '#000';
    c.fillRect(0, 0, m.width, m.height);
    this.auswahlSetzen(m, 'neu', 'Alles auswählen');
  }
  auswahlUmkehren() {
    const m = leinwand(this.breite, this.hoehe);
    const c = ctxVon(m);
    c.fillStyle = '#000';
    c.fillRect(0, 0, m.width, m.height);
    if (this.auswahl) {
      c.globalCompositeOperation = 'destination-out';
      c.drawImage(this.auswahl, 0, 0);
    }
    this.auswahlSetzen(m, 'neu', 'Auswahl umkehren');
  }
  /** kleinstes Rechteck um die Auswahl (null = keine) */
  auswahlGrenzen(): Rechteck | null {
    if (!this.auswahl) return null;
    if (this.grenzenCache?.stand === this.auswahlStand) return this.grenzenCache.wert;
    const d = ctxVon(this.auswahl).getImageData(0, 0, this.auswahl.width, this.auswahl.height);
    const wert = deckendeGrenzen(d.data, d.width, d.height, 0);
    this.grenzenCache = { stand: this.auswahlStand, wert };
    return wert;
  }
  /** Maske aus einem Pfad (Rechteck, Ellipse, Lasso) */
  maskeAusPfad(pfad: (c: CanvasRenderingContext2D) => void, glatt = true) {
    const m = leinwand(this.breite, this.hoehe);
    const c = ctxVon(m);
    c.fillStyle = '#000';
    c.beginPath();
    pfad(c);
    c.fill();
    if (!glatt) {
      // harte Kante (Rechteck): halbdeckende Randpixel voll deckend machen
      const d = c.getImageData(0, 0, m.width, m.height);
      for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i]! >= 128 ? 255 : 0;
      c.putImageData(d, 0, 0);
    }
    return m;
  }
  maskeAusDaten(maske: Uint8Array) {
    const m = leinwand(this.breite, this.hoehe);
    const c = ctxVon(m);
    const d = c.createImageData(m.width, m.height);
    for (let i = 0; i < maske.length; i++) d.data[i * 4 + 3] = maske[i]!;
    c.putImageData(d, 0, 0);
    return m;
  }

  /**
   * Malt auf die Ebene – beschränkt auf die Auswahl, falls es eine gibt. `malen` bekommt einen Kontext in Dokumentgröße;
   * mit Auswahl ist das eine leere Zwischenleinwand, die danach durch die Maske geschnitten und aufgelegt wird.
   */
  malenMitAuswahl(e: Ebene, malen: (c: CanvasRenderingContext2D) => void, modus: GlobalCompositeOperation = 'source-over', deckkraft = 1) {
    const ziel = ctxVon(e.leinwand);
    const zw = leinwand(this.breite, this.hoehe);
    const c = ctxVon(zw);
    malen(c);
    if (this.auswahl) {
      c.globalCompositeOperation = 'destination-in';
      c.globalAlpha = 1;
      c.drawImage(this.auswahl, 0, 0);
    }
    ziel.save();
    ziel.globalCompositeOperation = modus;
    ziel.globalAlpha = deckkraft;
    ziel.drawImage(zw, 0, 0);
    ziel.restore();
    this.beruehrt(e);
  }
  /** ersetzt den Inhalt der Ebene durch `neu` – mit Auswahl nur dort (weiche Kanten werden gemischt) */
  ersetzenMitAuswahl(e: Ebene, neu: HTMLCanvasElement) {
    const ziel = ctxVon(e.leinwand);
    if (!this.auswahl) {
      ziel.clearRect(0, 0, e.leinwand.width, e.leinwand.height);
      ziel.drawImage(neu, 0, 0);
    } else {
      const teil = kopie(neu);
      const c = ctxVon(teil);
      c.globalCompositeOperation = 'destination-in';
      c.drawImage(this.auswahl, 0, 0);
      ziel.save();
      ziel.globalCompositeOperation = 'destination-out';
      ziel.drawImage(this.auswahl, 0, 0);
      ziel.globalCompositeOperation = 'lighter';
      ziel.drawImage(teil, 0, 0);
      ziel.restore();
    }
    this.beruehrt(e);
  }
  /** Pixelanpassung (Filter): rechnet auf einer Kopie der Quelle und legt das Ergebnis in die Ebene (nur in der Auswahl) */
  anpassen(e: Ebene, quelle: HTMLCanvasElement, rechnen: (d: ImageData) => void) {
    const g = this.auswahlGrenzen() ?? { x: 0, y: 0, b: this.breite, h: this.hoehe };
    // Nachbarschaftsfilter brauchen Rand um die Auswahl – großzügig mitnehmen
    const rand = this.auswahl ? 64 : 0;
    const x = Math.max(0, g.x - rand);
    const y = Math.max(0, g.y - rand);
    const b = Math.min(this.breite, g.x + g.b + rand) - x;
    const h = Math.min(this.hoehe, g.y + g.h + rand) - y;
    const d = ctxVon(quelle).getImageData(x, y, b, h);
    rechnen(d);
    const neu = kopie(quelle);
    ctxVon(neu).putImageData(d, x, y);
    this.ersetzenMitAuswahl(e, neu);
  }
  /** löscht den Inhalt der Auswahl (oder der ganzen Ebene) */
  loeschen(e: Ebene = this.aktiv) {
    const c = ctxVon(e.leinwand);
    if (this.auswahl) {
      c.save();
      c.globalCompositeOperation = 'destination-out';
      c.drawImage(this.auswahl, 0, 0);
      c.restore();
    } else c.clearRect(0, 0, e.leinwand.width, e.leinwand.height);
    this.beruehrt(e);
    this.festhalten('Löschen');
  }
  fuellen(farbe: string, e: Ebene = this.aktiv) {
    this.malenMitAuswahl(e, (c) => {
      c.fillStyle = farbe;
      c.fillRect(0, 0, this.breite, this.hoehe);
    });
    this.festhalten('Fläche füllen');
  }
  /** Inhalt der Auswahl (oder die ganze Ebene) als eigenes Bild, zugeschnitten – für Kopieren und Transformieren */
  ausschnitt(e: Ebene = this.aktiv): { bild: HTMLCanvasElement; x: number; y: number } | null {
    const teil = kopie(e.leinwand);
    if (this.auswahl) {
      const c = ctxVon(teil);
      c.globalCompositeOperation = 'destination-in';
      c.drawImage(this.auswahl, 0, 0);
    }
    const d = ctxVon(teil).getImageData(0, 0, teil.width, teil.height);
    const g = deckendeGrenzen(d.data, d.width, d.height, 0);
    if (!g) return null;
    const bild = leinwand(g.b, g.h);
    ctxVon(bild).drawImage(teil, -g.x, -g.y);
    return { bild, x: g.x, y: g.y };
  }

  // ---- Bild (ganzes Dokument) -------------------------------------------------------------------
  private alleEbenen(b: number, h: number, zeichne: (c: CanvasRenderingContext2D, quelle: HTMLCanvasElement) => void) {
    groessePruefen(b, h);
    for (const e of this.ebenen) {
      const neu = leinwand(b, h);
      const c = ctxVon(neu);
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      zeichne(c, e.leinwand);
      e.leinwand = neu;
      this.beruehrt(e);
    }
    if (this.auswahl) {
      const neu = leinwand(b, h);
      zeichne(ctxVon(neu), this.auswahl);
      this.auswahl = neu;
      this.auswahlStand++;
      this.grenzenCache = null;
      if (!this.auswahlGrenzen()) this.auswahl = null;
    }
    this.breite = Math.round(b);
    this.hoehe = Math.round(h);
  }
  /** Bildgröße: alles neu berechnen (skalieren) */
  bildgroesse(b: number, h: number) {
    b = Math.round(b);
    h = Math.round(h);
    this.alleEbenen(b, h, (c, q) => c.drawImage(q, 0, 0, b, h));
    this.festhalten('Bildgröße');
  }
  /** Arbeitsfläche: Rand dazu oder weg; anker 0 … 8 (links oben … rechts unten) sagt, wo der Inhalt bleibt */
  arbeitsflaeche(b: number, h: number, anker = 4) {
    b = Math.round(b);
    h = Math.round(h);
    const dx = Math.round(((b - this.breite) * (anker % 3)) / 2);
    const dy = Math.round(((h - this.hoehe) * Math.floor(anker / 3)) / 2);
    this.alleEbenen(b, h, (c, q) => c.drawImage(q, dx, dy));
    this.festhalten('Arbeitsfläche');
  }
  zuschneiden(r: Rechteck) {
    const x = Math.max(0, Math.round(r.x));
    const y = Math.max(0, Math.round(r.y));
    const b = Math.min(this.breite, Math.round(r.x + r.b)) - x;
    const h = Math.min(this.hoehe, Math.round(r.y + r.h)) - y;
    if (b < 1 || h < 1) throw new Error('Der Ausschnitt liegt außerhalb des Bildes.');
    this.alleEbenen(b, h, (c, q) => c.drawImage(q, -x, -y));
    this.festhalten('Zuschneiden');
  }
  /** ganzes Bild drehen: 90 = im Uhrzeigersinn, −90 = dagegen, 180 */
  drehen(grad: 90 | -90 | 180) {
    const [b, h] = grad === 180 ? [this.breite, this.hoehe] : [this.hoehe, this.breite];
    this.alleEbenen(b, h, (c, q) => {
      c.translate(b / 2, h / 2);
      c.rotate((grad * Math.PI) / 180);
      c.drawImage(q, -q.width / 2, -q.height / 2);
    });
    this.festhalten(`Bild drehen ${grad}°`);
  }
  spiegeln(waagrecht: boolean, nurEbene?: Ebene) {
    const tun = (c: CanvasRenderingContext2D, q: HTMLCanvasElement) => {
      c.translate(waagrecht ? q.width : 0, waagrecht ? 0 : q.height);
      c.scale(waagrecht ? -1 : 1, waagrecht ? 1 : -1);
      c.drawImage(q, 0, 0);
    };
    if (nurEbene) {
      const neu = leinwand(this.breite, this.hoehe);
      tun(ctxVon(neu), nurEbene.leinwand);
      nurEbene.leinwand = neu;
      this.beruehrt(nurEbene);
    } else this.alleEbenen(this.breite, this.hoehe, tun);
    this.festhalten(waagrecht ? 'Horizontal spiegeln' : 'Vertikal spiegeln');
  }

  // ---- Projekt (.atelier) -----------------------------------------------------------------------
  async alsProjekt(): Promise<Blob> {
    const dateien: ZipDatei[] = [];
    const inhalt: ProjektInhalt = { format: PROJEKT_FORMAT, version: 1, breite: this.breite, hoehe: this.hoehe, aktiv: Math.max(0, this.ebenen.findIndex((e) => e.id === this.aktivId)), ebenen: [] };
    for (const [i, e] of this.ebenen.entries()) {
      const datei = `ebene-${i}.png`;
      inhalt.ebenen.push({ name: e.name, sichtbar: e.sichtbar, deckkraft: e.deckkraft, modus: e.modus, datei });
      dateien.push({ name: datei, daten: new Uint8Array(await (await alsBlob(e.leinwand)).arrayBuffer()) });
    }
    const f = Math.min(1, 512 / Math.max(this.breite, this.hoehe));
    const klein = leinwand(this.breite * f, this.hoehe * f);
    ctxVon(klein).drawImage(this.zusammengesetzt(), 0, 0, klein.width, klein.height);
    dateien.unshift({ name: 'projekt.json', daten: new TextEncoder().encode(JSON.stringify(inhalt, null, 2)) });
    dateien.push({ name: 'vorschau.png', daten: new Uint8Array(await (await alsBlob(klein)).arrayBuffer()) });
    return new Blob([zipSchreiben(dateien) as BlobPart], { type: 'application/zip' });
  }
  static async ausProjekt(daten: Uint8Array): Promise<Dokument> {
    const zip = zipLesen(daten);
    const roh = zip.get('projekt.json');
    if (!roh) throw new Error('Kein Atelier-Projekt (projekt.json fehlt).');
    let p: ProjektInhalt;
    try {
      p = JSON.parse(new TextDecoder().decode(roh)) as ProjektInhalt;
    } catch {
      throw new Error('Atelier-Projekt beschädigt (projekt.json).');
    }
    if (p.format !== PROJEKT_FORMAT || !Array.isArray(p.ebenen) || !p.ebenen.length || p.ebenen.length > 200) throw new Error('Kein Atelier-Projekt, das diese Fassung lesen kann.');
    const d = new Dokument(Number(p.breite), Number(p.hoehe));
    for (const pe of p.ebenen) {
      const bytes = zip.get(String(pe.datei));
      if (!bytes) throw new Error(`Atelier-Projekt beschädigt (${String(pe.datei)} fehlt).`);
      const bild = await bildLaden(new Blob([bytes as BlobPart], { type: 'image/png' }));
      d.aktivId = d.ebenen[d.ebenen.length - 1]?.id ?? 0;
      const e = d.ebeneAnlegen(String(pe.name).slice(0, 100));
      ctxVon(e.leinwand).drawImage(bild, 0, 0);
      bild.close();
      e.sichtbar = pe.sichtbar !== false;
      e.deckkraft = Math.min(1, Math.max(0, Number(pe.deckkraft ?? 1)));
      e.modus = MISCHMODI.some(([m]) => m === pe.modus) ? (pe.modus as Mischmodus) : 'source-over';
    }
    d.aktivId = d.ebenen[Math.min(d.ebenen.length - 1, Math.max(0, Number(p.aktiv) || 0))]!.id;
    d.festhalten('Öffnen');
    d.geaendert = false;
    return d;
  }
}
