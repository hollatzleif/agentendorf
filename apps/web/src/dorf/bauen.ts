import { GRUNDSTUECK, RASTER_GRENZE, belegungBerechnen, dekoFelder, feldSchluessel, grundstueckFelder, type DekoArt, type DorfLayout, type Drehung } from '@dorf/shared';
import type { BauHandler, DorfSzene, SzeneTreffer } from './szene';

export type Werkzeug = { art: 'auswahl' } | { art: 'strasse' } | { art: 'wasser' } | { art: 'deko'; deko: DekoArt } | { art: 'abreissen' } | { art: 'platzieren'; id: string };

export type Auswahl = { art: 'gebaeude'; id: string } | { art: 'deko'; index: number } | null;

const kopie = (l: DorfLayout): DorfLayout => JSON.parse(JSON.stringify(l));
const imRaster = (x: number, z: number) => Math.abs(x) <= RASTER_GRENZE && Math.abs(z) <= RASTER_GRENZE;

/**
 * Bau-Modus: übersetzt Zeiger-Gesten in Layout-Änderungen. Jede abgeschlossene Geste ruft `aendern`
 * genau einmal auf (= ein Rückgängig-Schritt). Geprüft wird hier für die Vorschau; endgültig prüft der Server.
 */
export class BauSteuerung implements BauHandler {
  werkzeug: Werkzeug = { art: 'auswahl' };
  auswahl: Auswahl = null;
  private zug: { art: 'gebaeude'; id: string; dx: number; dz: number; ziel: [number, number] | null; ok: boolean } | { art: 'deko'; index: number; dx: number; dz: number; ziel: [number, number] | null; ok: boolean } | { art: 'malen'; entwurf: DorfLayout; geaendert: boolean } | null = null;

  constructor(
    private szene: DorfSzene,
    private o: {
      layout: () => DorfLayout;
      /** vorlaeufig = während einer Geste (nur anzeigen, kein Rückgängig-Schritt, nicht speichern) */
      aendern: (l: DorfLayout, vorlaeufig?: boolean) => void;
      auswahlGeaendert: (a: Auswahl) => void;
      hinweis: (t: string) => void;
    },
  ) {}

  private frei(l: DorfLayout, felder: [number, number][], ausser?: { gebaeude?: string; deko?: number }) {
    const { belegung } = belegungBerechnen(l);
    return felder.every(([x, z]) => {
      if (!imRaster(x, z)) return false;
      const b = belegung.get(feldSchluessel(x, z));
      if (!b) return true;
      if (ausser?.gebaeude && b.art === 'gebaeude' && b.id === ausser.gebaeude) return true;
      if (ausser?.deko !== undefined && b.art === 'deko' && b.index === ausser.deko) return true;
      return false;
    });
  }

  setzeWerkzeug(w: Werkzeug) {
    this.werkzeug = w;
    this.szene.markieren([], null);
    if (w.art !== 'auswahl') this.waehlen(null);
  }

  waehlen(a: Auswahl) {
    this.auswahl = a;
    this.o.auswahlGeaendert(a);
    this.auswahlZeigen();
  }

  private auswahlZeigen() {
    const l = this.o.layout();
    const a = this.auswahl;
    if (a?.art === 'gebaeude' && l.gebaeude[a.id]) this.szene.markieren(grundstueckFelder(l.gebaeude[a.id]!.x, l.gebaeude[a.id]!.z), 'auswahl');
    else if (a?.art === 'deko' && l.deko[a.index]) this.szene.markieren(dekoFelder(l.deko[a.index]!), 'auswahl');
    else this.szene.markieren([], null);
  }

  /** Ausgewähltes Gebäude/Deko drehen */
  drehen() {
    const a = this.auswahl;
    const l = kopie(this.o.layout());
    if (a?.art === 'gebaeude' && l.gebaeude[a.id]) l.gebaeude[a.id]!.dreh = ((l.gebaeude[a.id]!.dreh + 1) % 4) as Drehung;
    else if (a?.art === 'deko' && l.deko[a.index]) {
      const d = l.deko[a.index]!;
      d.dreh = ((d.dreh + 1) % 4) as Drehung;
      delete d.auto; // angefasst → gehört jetzt Leif (weicht keinem neuen Gebäude mehr)
    } else return;
    this.o.aendern(l);
  }

  /** Ausgewähltes Gebäude ins Lager (Ordner im Vault bleibt) bzw. Deko entfernen */
  entfernen() {
    const a = this.auswahl;
    const l = kopie(this.o.layout());
    if (a?.art === 'gebaeude' && l.gebaeude[a.id]) {
      delete l.gebaeude[a.id];
      l.lager.push(a.id);
    } else if (a?.art === 'deko' && l.deko[a.index]) l.deko.splice(a.index, 1);
    else return;
    this.waehlen(null);
    this.o.aendern(l);
  }

  // ---- Gesten -------------------------------------------------------------------------------------

  zeigerRunter(t: SzeneTreffer | null, feld: [number, number] | null, _e: PointerEvent): boolean {
    const l = this.o.layout();
    const w = this.werkzeug;
    if (!feld) return false;
    const { belegung } = belegungBerechnen(l);
    const b = belegung.get(feldSchluessel(...feld));
    if (w.art === 'auswahl') {
      const id = t?.art === 'gebaeude' ? t.id : b?.art === 'gebaeude' ? b.id : null;
      if (id && l.gebaeude[id]) {
        this.waehlen({ art: 'gebaeude', id });
        const g = l.gebaeude[id]!;
        this.zug = { art: 'gebaeude', id, dx: feld[0] - g.x, dz: feld[1] - g.z, ziel: null, ok: true };
        return true;
      }
      if (b?.art === 'deko' && l.deko[b.index]) {
        const d = l.deko[b.index]!;
        this.waehlen({ art: 'deko', index: b.index });
        this.zug = { art: 'deko', index: b.index, dx: feld[0] - d.x, dz: feld[1] - d.z, ziel: null, ok: true };
        return true;
      }
      this.waehlen(null);
      return false; // Kamera darf verschieben
    }
    if (w.art === 'platzieren') return true;
    // Malen: Straße, Wasser, Deko, Abreißen
    this.zug = { art: 'malen', entwurf: kopie(l), geaendert: false };
    this.malen(feld);
    return true;
  }

  private malen(feld: [number, number]) {
    const z = this.zug;
    if (z?.art !== 'malen') return;
    const l = z.entwurf;
    const w = this.werkzeug;
    const [x, zz] = feld;
    if (w.art === 'abreissen') {
      const k = feldSchluessel(x, zz);
      const vorher = l.strassen.length + l.wasser.length + l.deko.length;
      l.strassen = l.strassen.filter((f) => feldSchluessel(...f) !== k);
      l.wasser = l.wasser.filter((f) => feldSchluessel(...f) !== k);
      l.deko = l.deko.filter((d) => !dekoFelder(d).some((f) => feldSchluessel(...f) === k));
      if (l.strassen.length + l.wasser.length + l.deko.length !== vorher) z.geaendert = true;
      else if (belegungBerechnen(l).belegung.get(k)?.art === 'gebaeude') this.o.hinweis('Gebäude kommen über „Auswählen“ → „Ins Lager“ aus dem Dorf.');
    } else if (this.frei(l, w.art === 'deko' ? dekoFelder({ art: w.deko, x, z: zz }) : [feld])) {
      if (w.art === 'strasse') l.strassen.push([x, zz]);
      else if (w.art === 'wasser') l.wasser.push([x, zz]);
      else if (w.art === 'deko') l.deko.push({ art: w.deko, x, z: zz, dreh: (Math.abs(x * 7 + zz * 3) % 4) as Drehung });
      else return;
      z.geaendert = true;
    } else return;
    this.szene.markieren(w.art === 'deko' ? dekoFelder({ art: w.deko, x, z: zz }) : [feld], w.art === 'abreissen' ? 'nein' : 'ok');
    this.o.aendern(kopie(l), true);
  }

  zeigerBewegt(feld: [number, number] | null, _e: PointerEvent, gezogen: boolean) {
    const l = this.o.layout();
    const z = this.zug;
    if (!gezogen) {
      // Vorschau unter der Maus
      if (!feld) return this.auswahlZeigen();
      const w = this.werkzeug;
      if (w.art === 'platzieren') {
        const f = grundstueckFelder(feld[0], feld[1]);
        this.szene.markieren(f, this.frei(l, f) ? 'ok' : 'nein');
      } else if (w.art === 'deko') {
        const f = dekoFelder({ art: w.deko, x: feld[0], z: feld[1] });
        this.szene.markieren(f, this.frei(l, f) ? 'ok' : 'nein');
      } else if (w.art === 'strasse' || w.art === 'wasser') this.szene.markieren([feld], this.frei(l, [feld]) ? 'ok' : 'nein');
      else if (w.art === 'abreissen') this.szene.markieren([feld], 'nein');
      return;
    }
    if (!feld || !z) return;
    if (z.art === 'malen') return this.malen(feld);
    if (z.art === 'gebaeude') {
      const g = l.gebaeude[z.id]!;
      const ziel: [number, number] = [feld[0] - z.dx, feld[1] - z.dz];
      z.ziel = ziel;
      const f = grundstueckFelder(...ziel);
      z.ok = this.frei(l, f, { gebaeude: z.id });
      this.szene.markieren(f, z.ok ? 'ok' : 'nein');
      this.szene.vorschau(z.id, ziel[0], ziel[1], g.dreh);
    } else if (z.art === 'deko') {
      const d = l.deko[z.index];
      if (!d) return;
      const ziel: [number, number] = [feld[0] - z.dx, feld[1] - z.dz];
      z.ziel = ziel;
      const f = dekoFelder({ art: d.art, x: ziel[0], z: ziel[1] });
      z.ok = this.frei(l, f, { deko: z.index });
      this.szene.markieren(f, z.ok ? 'ok' : 'nein');
    }
  }

  zeigerHoch(feld: [number, number] | null, _e: PointerEvent) {
    const z = this.zug;
    this.zug = null;
    const w = this.werkzeug;
    if (w.art === 'platzieren') {
      if (!feld) return;
      const l = kopie(this.o.layout());
      if (!this.frei(l, grundstueckFelder(...feld))) return this.o.hinweis('Dort ist kein Platz – das Grundstück braucht 4 × 4 freie Felder.');
      l.gebaeude[w.id] = { x: feld[0], z: feld[1], dreh: 0 };
      l.lager = l.lager.filter((x) => x !== w.id);
      this.werkzeug = { art: 'auswahl' };
      this.o.aendern(l);
      this.waehlen({ art: 'gebaeude', id: w.id });
      return;
    }
    if (!z) return;
    if (z.art === 'malen') {
      this.szene.markieren([], null);
      if (z.geaendert) this.o.aendern(z.entwurf);
      return;
    }
    const l = kopie(this.o.layout());
    if (z.art === 'gebaeude') {
      const g = l.gebaeude[z.id]!;
      if (z.ziel && z.ok && (z.ziel[0] !== g.x || z.ziel[1] !== g.z)) {
        g.x = z.ziel[0];
        g.z = z.ziel[1];
        this.o.aendern(l);
      } else {
        this.szene.vorschau(z.id, g.x, g.z, g.dreh); // zurück an den alten Platz
        if (z.ziel && !z.ok) this.o.hinweis('Dort ist kein Platz.');
      }
    } else if (z.art === 'deko') {
      const d = l.deko[z.index];
      if (d && z.ziel && z.ok && (z.ziel[0] !== d.x || z.ziel[1] !== d.z)) {
        d.x = z.ziel[0];
        d.z = z.ziel[1];
        delete d.auto; // verschoben → gehört jetzt Leif
        this.o.aendern(l);
      }
    }
    this.auswahlZeigen();
  }
}

export { GRUNDSTUECK };
