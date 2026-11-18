// ---- Etappe 5: Dorf (Layout auf dem Server, Status, Figuren) -----------------------------------
//
// Das Dorf ist ein Raster aus Feldern (x, z ganzzahlig). Ein Gebäude belegt ein Grundstück aus
// GRUNDSTUECK × GRUNDSTUECK Feldern (x/z = Ecke mit den kleinsten Koordinaten). Straßen, Wasser und
// Deko belegen je ein Feld. Kein Feld darf doppelt belegt sein. Server und Oberfläche prüfen mit
// derselben Funktion (layoutPruefen).

import type { LaufStatus, Motor, Stufe, Ausloeser } from './index.js';

export const GRUNDSTUECK = 4;
export const RASTER_GRENZE = 60; // |x|, |z| ≤ 60
export const MAX_STRASSEN = 4000;
export const MAX_WASSER = 2000;
export const MAX_DEKO = 2000;

export const DEKO_ARTEN = ['baum', 'tanne', 'busch', 'blumen', 'laterne', 'bank', 'brunnen', 'felsen', 'hecke'] as const;
export type DekoArt = (typeof DEKO_ARTEN)[number];
export const DEKO_NAMEN: Record<DekoArt, string> = {
  baum: 'Laubbaum',
  tanne: 'Tanne',
  busch: 'Busch',
  blumen: 'Blumenbeet',
  laterne: 'Laterne',
  bank: 'Parkbank',
  brunnen: 'Brunnen',
  felsen: 'Felsen',
  hecke: 'Hecke',
};

export type Drehung = 0 | 1 | 2 | 3; // ×90°, 0 = Eingang nach Süden (+z)

export interface DorfLayout {
  gebaeude: Record<string, { x: number; z: number; dreh: Drehung }>;
  /** aus dem Dorf genommene Gebäude (der Ordner im Vault bleibt) */
  lager: string[];
  strassen: [number, number][];
  wasser: [number, number][];
  deko: { art: DekoArt; x: number; z: number; dreh: Drehung }[];
}

export interface DorfAntwort {
  layout: DorfLayout;
  version: number;
}

export interface DorfGebaeudeStatus {
  /** laufende Agenten in diesem Gebäude (→ Rauch) */
  arbeitet: number;
  /** offene Aufgaben: Schreibtisch (Rathaus) bzw. geplante Teilaufgaben eines wartenden Plans (→ Baustellenschild) */
  aufgaben: number;
  /** wartende Freigaben (→ Brief) */
  freigaben: number;
  /** nächste Frist unter 3 Tagen (→ rotes Dach) */
  frist: { titel: string; frist: string } | null;
}

export interface DorfFigur {
  laufId: string;
  chatId: string;
  gebaeude: string;
  titel: string;
  auftrag: string;
  motor: Motor;
  modell: string;
  stufe: Stufe;
  status: LaufStatus;
  ausloeser: Ausloeser;
  buergermeister: boolean;
  erstellt: string;
  start?: string;
  token: number;
  kostenUsd: number;
}

export interface DorfStatus {
  jetzt: string;
  gebaeude: Record<string, DorfGebaeudeStatus>;
  figuren: DorfFigur[];
  /** Wetter in Linz (Open-Meteo), wenn eingeschaltet */
  wetter?: DorfWetter;
  /** Läufe, die in den letzten 10 Minuten geendet haben (für Ticker und Feier) */
  zuletzt?: DorfLaufEnde[];
}
export interface DorfLaufEnde {
  laufId: string;
  gebaeude: string;
  titel: string;
  status: 'fertig' | 'fehler' | 'abgebrochen';
  ende: string;
  buergermeister: boolean;
}

export type WetterArt = 'klar' | 'heiter' | 'bedeckt' | 'nebel' | 'niesel' | 'regen' | 'schnee' | 'gewitter';
export interface DorfWetter {
  art: WetterArt;
  temperatur: number; // °C, jetzt
  tag: { art: WetterArt; min: number; max: number; regen: number | null }; // heute; regen = Wahrscheinlichkeit in %
  stand: string; // ISO, wann Open-Meteo die Werte berechnet hat
}

/** WMO-Wettercode → Art (https://open-meteo.com/en/docs: „WMO Weather interpretation codes“) */
export function wetterArt(code: number): WetterArt {
  if (code <= 0) return 'klar';
  if (code <= 2) return 'heiter';
  if (code === 3) return 'bedeckt';
  if (code === 45 || code === 48) return 'nebel';
  if (code >= 51 && code <= 57) return 'niesel';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'regen';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'schnee';
  if (code >= 95) return 'gewitter';
  return 'bedeckt';
}
export const WETTER_TEXT: Record<WetterArt, { symbol: string; text: string }> = {
  klar: { symbol: '☀️', text: 'klar' },
  heiter: { symbol: '🌤️', text: 'heiter' },
  bedeckt: { symbol: '☁️', text: 'bedeckt' },
  nebel: { symbol: '🌫️', text: 'Nebel' },
  niesel: { symbol: '🌦️', text: 'Nieselregen' },
  regen: { symbol: '🌧️', text: 'Regen' },
  schnee: { symbol: '🌨️', text: 'Schnee' },
  gewitter: { symbol: '⛈️', text: 'Gewitter' },
};

export const feldSchluessel = (x: number, z: number) => `${x},${z}`;

export function grundstueckFelder(x: number, z: number): [number, number][] {
  const f: [number, number][] = [];
  for (let dx = 0; dx < GRUNDSTUECK; dx++) for (let dz = 0; dz < GRUNDSTUECK; dz++) f.push([x + dx, z + dz]);
  return f;
}

export type Belegung = Map<string, { art: 'gebaeude'; id: string } | { art: 'strasse' } | { art: 'wasser' } | { art: 'deko'; index: number }>;

/** Belegung aller Felder; doppelte Belegung → Fehlertext */
export function belegungBerechnen(l: DorfLayout): { belegung: Belegung; fehler: string | null } {
  const b: Belegung = new Map();
  let fehler: string | null = null;
  const setzen = (x: number, z: number, wert: Belegung extends Map<string, infer V> ? V : never, was: string) => {
    const k = feldSchluessel(x, z);
    const alt = b.get(k);
    if (alt && !fehler) fehler = `Feld ${k} ist doppelt belegt (${was}).`;
    if (!alt) b.set(k, wert);
  };
  for (const [id, g] of Object.entries(l.gebaeude)) for (const [x, z] of grundstueckFelder(g.x, g.z)) setzen(x, z, { art: 'gebaeude', id }, id);
  for (const [x, z] of l.strassen) setzen(x, z, { art: 'strasse' }, 'Straße');
  for (const [x, z] of l.wasser) setzen(x, z, { art: 'wasser' }, 'Wasser');
  l.deko.forEach((d, i) => setzen(d.x, d.z, { art: 'deko', index: i }, 'Deko'));
  return { belegung: b, fehler };
}

const imRaster = (x: number, z: number) =>
  Number.isInteger(x) && Number.isInteger(z) && Math.abs(x) <= RASTER_GRENZE && Math.abs(z) <= RASTER_GRENZE;

/**
 * Prüft ein Layout vollständig. `erlaubt` = Gebäude, die es geben darf (Vault + bereits im Layout).
 * Gibt null zurück, wenn alles stimmt, sonst eine verständliche Meldung.
 */
export function layoutPruefen(l: DorfLayout, erlaubt: Set<string>): string | null {
  if (l.strassen.length > MAX_STRASSEN) return `Höchstens ${MAX_STRASSEN} Straßenfelder.`;
  if (l.wasser.length > MAX_WASSER) return `Höchstens ${MAX_WASSER} Wasserfelder.`;
  if (l.deko.length > MAX_DEKO) return `Höchstens ${MAX_DEKO} Deko-Objekte.`;
  for (const [id, g] of Object.entries(l.gebaeude)) {
    if (!erlaubt.has(id)) return `Unbekanntes Gebäude „${id}“.`;
    if (![0, 1, 2, 3].includes(g.dreh)) return `Ungültige Drehung bei „${id}“.`;
    if (!imRaster(g.x, g.z) || !imRaster(g.x + GRUNDSTUECK - 1, g.z + GRUNDSTUECK - 1)) return `„${id}“ liegt außerhalb des Dorfs.`;
  }
  const lager = new Set<string>();
  for (const id of l.lager) {
    if (!erlaubt.has(id)) return `Unbekanntes Gebäude „${id}“ im Lager.`;
    if (lager.has(id)) return `„${id}“ ist doppelt im Lager.`;
    if (l.gebaeude[id]) return `„${id}“ steht im Dorf und im Lager.`;
    lager.add(id);
  }
  for (const [x, z] of [...l.strassen, ...l.wasser]) if (!imRaster(x, z)) return `Feld ${x},${z} liegt außerhalb des Dorfs.`;
  for (const d of l.deko) {
    if (!(DEKO_ARTEN as readonly string[]).includes(d.art)) return `Unbekannte Deko „${String(d.art)}“.`;
    if (!imRaster(d.x, d.z)) return `Deko auf ${d.x},${d.z} liegt außerhalb des Dorfs.`;
    if (![0, 1, 2, 3].includes(d.dreh)) return 'Ungültige Drehung bei einer Deko.';
  }
  return belegungBerechnen(l).fehler;
}

// ---- Standardlayout und automatisches Platzieren -------------------------------------------------
//
// Grundstücke liegen in einem Blockraster (Abstand 5: 4 Felder Grundstück + 1 Feld Straße). Neue
// Gebäude kommen auf den freien Block, der der Dorfmitte am nächsten liegt, und bekommen einen
// Straßenring (nur auf freien Feldern).

const BLOCK = GRUNDSTUECK + 1;

function bloecke(): { x: number; z: number }[] {
  const b: { x: number; z: number }[] = [];
  for (let c = -4; c <= 3; c++) for (let r = -3; r <= 3; r++) b.push({ x: c * BLOCK + 1, z: r * BLOCK + 1 });
  // Mitte des Dorfs: zwischen Block (-1,-1) und (0,0) → Abstand zu (0.5, 0.5)
  const d = (p: { x: number; z: number }) => Math.hypot(p.x + GRUNDSTUECK / 2 - 0.5, (p.z + GRUNDSTUECK / 2 - 0.5) * 1.6);
  return b.sort((a, c) => d(a) - d(c) || a.x - c.x || a.z - c.z);
}
const BLOECKE = bloecke();

function strassenRing(l: DorfLayout, bx: number, bz: number) {
  const { belegung } = belegungBerechnen(l);
  for (let x = bx - 1; x <= bx + GRUNDSTUECK; x++)
    for (let z = bz - 1; z <= bz + GRUNDSTUECK; z++) {
      const rand = x === bx - 1 || x === bx + GRUNDSTUECK || z === bz - 1 || z === bz + GRUNDSTUECK;
      if (rand && imRaster(x, z) && !belegung.has(feldSchluessel(x, z))) {
        l.strassen.push([x, z]);
        belegung.set(feldSchluessel(x, z), { art: 'strasse' });
      }
    }
}

/** Freien Block für ein Gebäude suchen; null, wenn das Dorf voll ist. */
export function freienBlockFinden(l: DorfLayout): { x: number; z: number } | null {
  const { belegung } = belegungBerechnen(l);
  for (const b of BLOECKE) {
    if (grundstueckFelder(b.x, b.z).every(([x, z]) => !belegung.has(feldSchluessel(x, z)))) return b;
  }
  return null;
}

/** Setzt Gebäude, die weder im Dorf noch im Lager sind, auf freie Blöcke. Gibt zurück, ob sich etwas geändert hat. */
export function fehlendePlatzieren(l: DorfLayout, ids: string[]): boolean {
  let geaendert = false;
  for (const id of ids) {
    if (l.gebaeude[id] || l.lager.includes(id)) continue;
    const b = freienBlockFinden(l);
    if (!b) {
      l.lager.push(id);
    } else {
      l.gebaeude[id] = { x: b.x, z: b.z, dreh: 0 };
      strassenRing(l, b.x, b.z);
    }
    geaendert = true;
  }
  return geaendert;
}

/** Erstes Dorf: Gebäude nach Reihenfolge um die Mitte, dazu ein kleiner Park. */
export function standardLayout(ids: string[]): DorfLayout {
  const l: DorfLayout = { gebaeude: {}, lager: [], strassen: [], wasser: [], deko: [] };
  fehlendePlatzieren(l, ids);
  const park = freienBlockFinden(l);
  if (park) {
    strassenRing(l, park.x, park.z);
    l.wasser.push([park.x, park.z + 2], [park.x + 1, park.z + 2], [park.x, park.z + 3], [park.x + 1, park.z + 3]);
    l.deko.push(
      { art: 'brunnen', x: park.x + 2, z: park.z + 1, dreh: 0 },
      { art: 'baum', x: park.x, z: park.z, dreh: 0 },
      { art: 'tanne', x: park.x + 3, z: park.z, dreh: 1 },
      { art: 'baum', x: park.x + 3, z: park.z + 3, dreh: 2 },
      { art: 'bank', x: park.x + 2, z: park.z + 3, dreh: 0 },
      { art: 'blumen', x: park.x + 1, z: park.z, dreh: 0 },
      { art: 'busch', x: park.x + 3, z: park.z + 2, dreh: 0 },
      { art: 'laterne', x: park.x + 2, z: park.z + 2, dreh: 0 },
    );
  }
  return l;
}
