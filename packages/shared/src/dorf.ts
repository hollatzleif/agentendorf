// ---- Etappe 5: Dorf (Layout auf dem Server, Status, Figuren) -----------------------------------
//
// Das Dorf ist ein Raster aus Feldern (x, z ganzzahlig). Ein Gebäude belegt ein Grundstück aus
// GRUNDSTUECK × GRUNDSTUECK Feldern (x/z = Ecke mit den kleinsten Koordinaten). Straßen und Wasser
// belegen je ein Feld, Deko ein Feld oder – Häuschen – 2 × 2 Felder (DEKO_GROESSE, x/z wieder die Ecke).
// Kein Feld darf doppelt belegt sein. Server und Oberfläche prüfen mit derselben Funktion (layoutPruefen).

import type { LaufStatus, Motor, Stufe, Ausloeser } from './index.js';

export const GRUNDSTUECK = 4;
export const RASTER_GRENZE = 60; // |x|, |z| ≤ 60
export const MAX_STRASSEN = 4000;
export const MAX_WASSER = 2000;
export const MAX_DEKO = 2000;

export const DEKO_ARTEN = [
  'haeuschen',
  'baum',
  'tanne',
  'busch',
  'blumen',
  'laterne',
  'bank',
  'brunnen',
  'felsen',
  'hecke',
  'schuppen',
  'zaun',
  'mauer',
  'briefkasten',
  'kuebel',
  'holzstapel',
  'wegweiser',
  'bienenstock',
  'teich',
  'pilze',
  'heuballen',
] as const;
export type DekoArt = (typeof DEKO_ARTEN)[number];
export const DEKO_NAMEN: Record<DekoArt, string> = {
  haeuschen: 'Häuschen',
  baum: 'Laubbaum',
  tanne: 'Tanne',
  busch: 'Busch',
  blumen: 'Blumenbeet',
  laterne: 'Laterne',
  bank: 'Parkbank',
  brunnen: 'Brunnen',
  felsen: 'Felsen',
  hecke: 'Hecke',
  schuppen: 'Gartenhütte',
  zaun: 'Gartenzaun',
  mauer: 'Steinmauer',
  briefkasten: 'Briefkasten',
  kuebel: 'Blumenkübel',
  holzstapel: 'Holzstapel',
  wegweiser: 'Wegweiser',
  bienenstock: 'Bienenstock',
  teich: 'Seerosenteich',
  pilze: 'Pilze',
  heuballen: 'Heuballen',
};
/** Kantenlänge in Feldern (Standard 1); Häuschen brauchen 2 × 2 Felder, damit sie neben den Figuren nicht wie Puppenhäuser wirken */
export const DEKO_GROESSE: Partial<Record<DekoArt, number>> = { haeuschen: 2 };

/** Felder, die eine Deko belegt (x/z = Ecke mit den kleinsten Koordinaten) */
export function dekoFelder(d: { art: DekoArt; x: number; z: number }): [number, number][] {
  const n = DEKO_GROESSE[d.art] ?? 1;
  const f: [number, number][] = [];
  for (let dx = 0; dx < n; dx++) for (let dz = 0; dz < n; dz++) f.push([d.x + dx, d.z + dz]);
  return f;
}

export type Drehung = 0 | 1 | 2 | 3; // ×90°, 0 = Eingang nach Süden (+z)

export interface DorfLayout {
  gebaeude: Record<string, { x: number; z: number; dreh: Drehung }>;
  /** aus dem Dorf genommene Gebäude (der Ordner im Vault bleibt) */
  lager: string[];
  strassen: [number, number][];
  wasser: [number, number][];
  deko: DorfDeko[];
  /** Stand des einmaligen Verstreuens (VERSTREUT_STAND); fehlt bei Dörfern von vor E72 */
  verstreut?: number;
}
export interface DorfDeko {
  art: DekoArt;
  x: number;
  z: number;
  dreh: Drehung;
  /** vom Dorf selbst verstreut (E72): weicht einem neuen Gebäude; wer sie im Bau-Modus anfasst, macht sie zu seiner */
  auto?: boolean;
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
  /** Wetter am Wohnort (Open-Meteo, Standard Konstanz), wenn eingeschaltet */
  wetter?: DorfWetter;
  /** Läufe, die in den letzten 10 Minuten geendet haben (für Ticker und Feier) */
  zuletzt?: DorfLaufEnde[];
  /** E112: das Dorf blüht, wenn Leif produktiv ist */
  bluete?: DorfBluete;
  /** E131: To-dos von heute – steht auf der Tafel am Marktplatz */
  tag?: DorfTag;
  /** E131: ein Pomodoro läuft gerade in der Arbeitsphase – Licht am Kirchturm */
  fokus?: boolean;
}
export interface DorfTag {
  /** offene To-dos, die heute oder früher fällig sind (Wiener Kalendertag) */
  dran: number;
  /** heute erledigte To-dos */
  erledigt: number;
}
export interface DorfBluete {
  /** 0–1 aus den letzten 7 Tagen */
  wert: number;
  stufe: 'karg' | 'gruen' | 'bluehend' | 'praechtig';
  /** alle Wochenziele erreicht → Fahne am Rathaus */
  fahne: boolean;
  /** heute ≥ 5 To-dos erledigt → Feuerwerk */
  feuerwerk: boolean;
  /** kurze Begründung für die Anzeige */
  gruende: string[];
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
  /** Ortsname für die Anzeige (WETTER_ORT, Standard „Konstanz“) */
  ort?: string;
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
  l.deko.forEach((d, i) => {
    for (const [x, z] of dekoFelder(d)) setzen(x, z, { art: 'deko', index: i }, 'Deko');
  });
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
    if (!dekoFelder(d).every(([x, z]) => imRaster(x, z))) return `Deko auf ${d.x},${d.z} liegt außerhalb des Dorfs.`;
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

function ringFelder(bx: number, bz: number): [number, number][] {
  const f: [number, number][] = [];
  for (let x = bx - 1; x <= bx + GRUNDSTUECK; x++)
    for (let z = bz - 1; z <= bz + GRUNDSTUECK; z++)
      if (x === bx - 1 || x === bx + GRUNDSTUECK || z === bz - 1 || z === bz + GRUNDSTUECK) f.push([x, z]);
  return f;
}

function strassenRing(l: DorfLayout, bx: number, bz: number) {
  const { belegung } = belegungBerechnen(l);
  for (const [x, z] of ringFelder(bx, bz))
    if (imRaster(x, z) && !belegung.has(feldSchluessel(x, z))) {
      l.strassen.push([x, z]);
      belegung.set(feldSchluessel(x, z), { art: 'strasse' });
    }
}

/** Hohe Gebäude (E74/E72): kommen nach hinten, damit sie von der Startkamera (Blick von +z) nichts verdecken */
export const HOHE_GEBAEUDE = new Set(['Kirchturm']);

/**
 * Freien Block für ein Gebäude suchen; null, wenn das Dorf voll ist. Verstreute Deko (auto) zählt als frei – sie weicht.
 * hinten: nur Blöcke, hinter denen (kleineres z, gleiche Spalte) kein Gebäude steht.
 */
export function freienBlockFinden(l: DorfLayout, opt: { hinten?: boolean } = {}): { x: number; z: number } | null {
  const { belegung } = belegungBerechnen({ ...l, deko: l.deko.filter((d) => !d.auto) });
  const gebaeude = Object.values(l.gebaeude);
  for (const b of BLOECKE) {
    if (opt.hinten && gebaeude.some((g) => Math.abs(g.x - b.x) < GRUNDSTUECK + 1 && g.z < b.z)) continue;
    if (grundstueckFelder(b.x, b.z).every(([x, z]) => !belegung.has(feldSchluessel(x, z)))) return b;
  }
  return null;
}

/** Verstreute Deko auf einem Block und seinem Straßenring räumt einem neuen Gebäude den Platz */
function autoDekoRaeumen(l: DorfLayout, bx: number, bz: number) {
  const weg = new Set([...grundstueckFelder(bx, bz), ...ringFelder(bx, bz)].map(([x, z]) => feldSchluessel(x, z)));
  l.deko = l.deko.filter((d) => !d.auto || !dekoFelder(d).some(([x, z]) => weg.has(feldSchluessel(x, z))));
}

/** Setzt Gebäude, die weder im Dorf noch im Lager sind, auf freie Blöcke. Gibt zurück, ob sich etwas geändert hat. */
export function fehlendePlatzieren(l: DorfLayout, ids: string[]): boolean {
  let geaendert = false;
  for (const id of ids) {
    if (l.gebaeude[id] || l.lager.includes(id)) continue;
    const b = (HOHE_GEBAEUDE.has(id) ? freienBlockFinden(l, { hinten: true }) : null) ?? freienBlockFinden(l);
    if (!b) {
      l.lager.push(id);
    } else {
      autoDekoRaeumen(l, b.x, b.z);
      l.gebaeude[id] = { x: b.x, z: b.z, dreh: 0 };
      strassenRing(l, b.x, b.z);
    }
    geaendert = true;
  }
  return geaendert;
}

/** Erstes Dorf: Gebäude nach Reihenfolge um die Mitte, dazu ein kleiner Park und verstreute Häuschen/Deko. */
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
  dekoVerstreuen(l);
  return l;
}

// ---- Häuschen und Deko verstreuen (E72) -----------------------------------------------------------
//
// Einmal je Dorf (Markierung `verstreut` im Layout): kleine Häuschen an die Straßen, daneben Briefkasten,
// Zaun, Holzstapel …, dazu Deko auf freie Felder nahe der Straßen. Nie auf Straßen, Wasser, Grundstücke
// oder den Ring direkt um ein Grundstück (Eingänge und Gehsteig bleiben frei). Figuren und Autos fahren
// nur über Straßen – Deko daneben blockiert keinen Weg. Deterministisch: gleicher Stand → gleiches Ergebnis.

/** Erhöhen, wenn alle Dörfer noch einmal (zusätzlich) verstreut werden sollen */
export const VERSTREUT_STAND = 1;

/** Deterministischer Zufall aus einem Text (gleiches Verfahren wie zufallAus im 3D-Dorf) */
export function zufallAusText(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  let s = (h >>> 0) % 2147483646 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Nachbarn in Richtung +z, +x, −z, −x – Index = Drehung (0 = Süden/+z, 1 = +x, 2 = −z, 3 = −x; im Modell ry = dreh · 90°) */
const NACHBARN4: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/** Gestreute Deko: [Art, Gewicht] – direkt an der Straße bzw. ein Feld dahinter */
const AN_DER_STRASSE: [DekoArt, number][] = [['kuebel', 3], ['blumen', 2], ['busch', 3], ['laterne', 2], ['bank', 1], ['wegweiser', 2], ['zaun', 2], ['baum', 2], ['mauer', 1]];
const DAHINTER: [DekoArt, number][] = [['baum', 5], ['tanne', 3], ['busch', 3], ['felsen', 2], ['pilze', 2], ['heuballen', 2], ['holzstapel', 2], ['teich', 1], ['bienenstock', 1], ['hecke', 1], ['blumen', 1]];
/** Was neben einem Häuschen stehen darf */
const BEIM_HAUS: [DekoArt, number][] = [['holzstapel', 3], ['kuebel', 3], ['schuppen', 2], ['zaun', 3], ['busch', 2], ['baum', 2], ['bienenstock', 1], ['blumen', 2]];

function gewichtet(liste: [DekoArt, number][], rnd: () => number): DekoArt {
  let r = rnd() * liste.reduce((s, [, g]) => s + g, 0);
  for (const [a, g] of liste) if ((r -= g) < 0) return a;
  return liste[liste.length - 1]![0];
}

/** Die zwölf Felder rund um ein 2 × 2-Häuschen */
function ringRund(x: number, z: number): [number, number][] {
  const f: [number, number][] = [];
  for (let a = x - 1; a <= x + 2; a++) for (let b = z - 1; b <= z + 2; b++) if (a < x || a > x + 1 || b < z || b > z + 1) f.push([a, b]);
  return f;
}

/**
 * Verstreut einmalig Häuschen und Deko (alles mit `auto: true`) und setzt `verstreut`. Bestehendes bleibt
 * unangetastet. Gibt die Zahl der neuen Deko-Objekte zurück.
 */
export function dekoVerstreuen(l: DorfLayout, seed = `verstreuen-${VERSTREUT_STAND}`): number {
  l.verstreut = VERSTREUT_STAND;
  if (!l.strassen.length) return 0;
  const rnd = zufallAusText(seed);
  const { belegung } = belegungBerechnen(l);
  const k = feldSchluessel;
  const strasse = (x: number, z: number) => belegung.get(k(x, z))?.art === 'strasse';
  const anStrasse = (x: number, z: number) => NACHBARN4.findIndex(([dx, dz]) => strasse(x + dx, z + dz));

  // gesperrt: belegt oder im Ring direkt um ein Grundstück
  const gesperrt = new Set<string>(belegung.keys());
  for (const g of Object.values(l.gebaeude)) for (const [x, z] of ringFelder(g.x, g.z)) gesperrt.add(k(x, z));
  const frei = (x: number, z: number) => imRaster(x, z) && !gesperrt.has(k(x, z));

  // Bereich: Straßen plus zwei Felder
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of l.strassen) {
    minX = Math.min(minX, x - 2);
    maxX = Math.max(maxX, x + 2);
    minZ = Math.min(minZ, z - 2);
    maxZ = Math.max(maxZ, z + 2);
  }

  // Dorfmitte (Gebäude): Häuschen lieber zwischen den Gebäuden als draußen
  const gs = Object.values(l.gebaeude);
  const mx = gs.length ? gs.reduce((s, g) => s + g.x + GRUNDSTUECK / 2, 0) / gs.length : (minX + maxX) / 2;
  const mz = gs.length ? gs.reduce((s, g) => s + g.z + GRUNDSTUECK / 2, 0) / gs.length : (minZ + maxZ) / 2;

  const neu: DorfDeko[] = [];
  const setzen = (d: DorfDeko) => {
    neu.push({ ...d, auto: true });
    for (const [x, z] of dekoFelder(d)) gesperrt.add(k(x, z));
  };

  // 1) Häuschen: 2 × 2 freie Felder mit Straße an einer Seite, Eingang zur Straße, ein Feld Luft zueinander
  const kandidaten: { x: number; z: number; dreh: Drehung; wert: number }[] = [];
  for (let x = minX; x < maxX; x++)
    for (let z = minZ; z < maxZ; z++) {
      if (!frei(x, z) || !frei(x + 1, z) || !frei(x, z + 1) || !frei(x + 1, z + 1)) continue;
      // Straßenfelder je Seite (+z, +x, −z, −x)
      const seiten = [
        [[x, z + 2], [x + 1, z + 2]],
        [[x + 2, z], [x + 2, z + 1]],
        [[x, z - 1], [x + 1, z - 1]],
        [[x - 1, z], [x - 1, z + 1]],
      ].map((f) => f.filter(([a, b]) => strasse(a!, b!)).length);
      const beste = Math.max(...seiten);
      if (!beste) continue;
      kandidaten.push({ x, z, dreh: seiten.indexOf(beste) as Drehung, wert: Math.hypot(x + 1 - mx, z + 1 - mz) + (2 - beste) * 3 + rnd() * 8 });
    }
  kandidaten.sort((a, b) => a.wert - b.wert || a.x - b.x || a.z - b.z);
  const zielHaeuser = Math.max(4, Math.min(14, Math.round(gs.length * 1.2)));
  const haeuser: DorfDeko[] = [];
  for (const c of kandidaten) {
    if (haeuser.length >= zielHaeuser) break;
    if (!frei(c.x, c.z) || !frei(c.x + 1, c.z) || !frei(c.x, c.z + 1) || !frei(c.x + 1, c.z + 1)) continue;
    if (haeuser.some((h) => Math.abs(h.x - c.x) < 3 && Math.abs(h.z - c.z) < 3)) continue;
    const h: DorfDeko = { art: 'haeuschen', x: c.x, z: c.z, dreh: c.dreh };
    haeuser.push(h);
    setzen(h);
  }

  // 2) Neben jedes Häuschen: Briefkasten an der Straße, dazu ein, zwei Dinge aus dem Garten
  for (const h of haeuser) {
    const ring = ringRund(h.x, h.z);
    const vorn = ring.filter(([x, z]) => frei(x, z) && anStrasse(x, z) >= 0);
    if (vorn.length && rnd() < 0.75) {
      const [x, z] = vorn[Math.floor(rnd() * vorn.length)]!;
      setzen({ art: 'briefkasten', x, z, dreh: anStrasse(x, z) as Drehung });
    }
    const n = 1 + Math.floor(rnd() * 2.2);
    for (let i = 0; i < n; i++) {
      const rest = ring.filter(([x, z]) => frei(x, z));
      if (!rest.length) break;
      const [x, z] = rest[Math.floor(rnd() * rest.length)]!;
      const art = gewichtet(BEIM_HAUS, rnd);
      // Zaun längs der Hauswand, an der er steht
      const dreh = (art === 'zaun' ? (x < h.x || x > h.x + 1 ? 1 : 0) : Math.floor(rnd() * 4)) as Drehung;
      setzen({ art, x, z, dreh });
    }
  }

  // 3) Deko auf freie Felder bis zwei Felder neben den Straßen – locker, nie zwei direkt nebeneinander
  const felder: { x: number; z: number; a: number; wert: number }[] = [];
  for (let x = minX; x <= maxX; x++)
    for (let z = minZ; z <= maxZ; z++) {
      if (!frei(x, z)) continue;
      const a = anStrasse(x, z) >= 0 ? 1 : NACHBARN4.some(([dx, dz]) => frei(x + dx, z + dz) && anStrasse(x + dx, z + dz) >= 0) ? 2 : 0;
      if (a) felder.push({ x, z, a, wert: rnd() + (a === 1 ? 0 : 0.2) });
    }
  felder.sort((p, q) => p.wert - q.wert || p.x - q.x || p.z - q.z);
  const zielDeko = Math.max(12, Math.min(70, gs.length * 4));
  const gestreut: { x: number; z: number }[] = [];
  for (const f of felder) {
    if (gestreut.length >= zielDeko) break;
    if (!frei(f.x, f.z)) continue;
    if (gestreut.some((g) => Math.abs(g.x - f.x) <= 1 && Math.abs(g.z - f.z) <= 1)) continue;
    let art = gewichtet(f.a === 1 ? AN_DER_STRASSE : DAHINTER, rnd);
    const zurStrasse = anStrasse(f.x, f.z);
    // Wegweiser nur an Kreuzungen (ein Straßennachbar mit mindestens drei Straßennachbarn)
    if (art === 'wegweiser' && !NACHBARN4.some(([dx, dz]) => strasse(f.x + dx, f.z + dz) && NACHBARN4.filter(([ex, ez]) => strasse(f.x + dx + ex, f.z + dz + ez)).length >= 3))
      art = 'busch';
    // Bank und Wegweiser schauen zur Straße, Zaun/Mauer/Hecke laufen an ihr entlang
    const dreh = (
      zurStrasse >= 0 && (art === 'bank' || art === 'wegweiser')
        ? zurStrasse
        : zurStrasse >= 0 && (art === 'zaun' || art === 'mauer' || art === 'hecke')
          ? zurStrasse % 2
          : Math.floor(rnd() * 4)
    ) as Drehung;
    setzen({ art, x: f.x, z: f.z, dreh });
    gestreut.push(f);
  }

  const dazu = neu.slice(0, Math.max(0, MAX_DEKO - l.deko.length));
  l.deko.push(...dazu);
  return dazu.length;
}
