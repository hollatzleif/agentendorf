/**
 * E224 – Aussehen der App: Farben, Schriften, Größen, Stile und Anzeigearten. Gespeichert auf dem Server (gilt auf allen
 * Geräten) und im Gerät zwischengespeichert, damit die App sofort richtig aussieht. Die App setzt daraus CSS-Variablen
 * und data-Attribute an <html> (aussehen.ts in apps/web).
 */
export const VORLAGEN = ['spiel', 'schlicht', 'nacht', 'mitternacht', 'pastell', 'wald', 'ozean', 'abendrot', 'papier', 'terminal', 'kontrast'] as const;
export type Vorlage = (typeof VORLAGEN)[number];

export const FARB_ROLLEN = ['akzent', 'grund', 'himmel', 'karte', 'flaeche', 'text', 'leise', 'rand', 'linie', 'plus', 'minus', 'warnung', 'kopf'] as const;
export type FarbRolle = (typeof FARB_ROLLEN)[number];
export const FARB_ROLLE_TEXT: Record<FarbRolle, string> = {
  akzent: 'Akzent (Knöpfe, Aktives)',
  grund: 'Hintergrund',
  himmel: 'Hintergrund oben (Verlauf)',
  karte: 'Tafeln',
  flaeche: 'Felder und Karten',
  text: 'Text',
  leise: 'Leiser Text',
  rand: 'Rahmen und Schatten',
  linie: 'Feine Linien',
  plus: 'Plus / Erfolg',
  minus: 'Minus / Fehler',
  warnung: 'Warnung / Frist',
  kopf: 'Kopfleiste',
};

export const SCHRIFTEN = ['system', 'rund', 'serif', 'mono', 'schmal', 'lesbar', 'handschrift'] as const;
export const SCHRIFT_TEXT: Record<(typeof SCHRIFTEN)[number], string> = {
  system: 'System (wie bisher)',
  rund: 'Rund & freundlich',
  serif: 'Serifen (wie ein Buch)',
  mono: 'Schreibmaschine',
  schmal: 'Schmal & sachlich',
  lesbar: 'Besonders gut lesbar',
  handschrift: 'Verspielt',
};

export const DICHTEN = ['kompakt', 'normal', 'luftig'] as const;
export const SCHATTEN = ['spiel', 'weich', 'flach', 'keine'] as const;
export const RAHMEN = ['dick', 'duenn', 'keine'] as const;
export const KNOEPFE = ['spiel', 'flach', 'umriss', 'pille'] as const;
export const HINTERGRUENDE = ['verlauf', 'einfarbig', 'punkte', 'karo', 'linien'] as const;
export const BREITEN = ['schmal', 'normal', 'breit', 'voll'] as const;
export const ANIMATIONEN = ['an', 'reduziert', 'aus'] as const;
export const TABELLEN = ['schlicht', 'zebra', 'gitter'] as const;
export const TITEL_GEWICHTE = ['normal', 'fett', 'extra'] as const;
export const FOKUS_RINGE = ['gelb', 'akzent', 'dick'] as const;
export const STARTSEITEN = ['dorf', 'liste', 'heute'] as const;

/** Prüfung auf dem Server: apps/server/src/aussehen.ts (Zod) – hier nur Typ und Standard */
export interface AussehenT {
  version: 1;
  vorlage: Vorlage;
  /** eigene Farben überschreiben die der Vorlage */
  farben: Partial<Record<FarbRolle, string>>;
  schrift: (typeof SCHRIFTEN)[number];
  schriftTitel: 'wie-text' | (typeof SCHRIFTEN)[number];
  /** Grundgröße in px (12–24) */
  groesse: number;
  zeilenhoehe: number;
  titelGewicht: (typeof TITEL_GEWICHTE)[number];
  dichte: (typeof DICHTEN)[number];
  /** Eckenradius in px (0–28) */
  ecken: number;
  schatten: (typeof SCHATTEN)[number];
  rahmen: (typeof RAHMEN)[number];
  knoepfe: (typeof KNOEPFE)[number];
  hintergrund: (typeof HINTERGRUENDE)[number];
  breite: (typeof BREITEN)[number];
  animationen: (typeof ANIMATIONEN)[number];
  tabellen: (typeof TABELLEN)[number];
  kopfleiste: 'mitlaufend' | 'fest';
  symbole: 'an' | 'aus';
  fokusRing: (typeof FOKUS_RINGE)[number];
  startseite: (typeof STARTSEITEN)[number];
  /** eigenes CSS (max. 20 000 Zeichen) */
  css: string;
}
export const AUSSEHEN_STANDARD: AussehenT = {
  version: 1,
  vorlage: 'spiel',
  farben: {},
  schrift: 'system',
  schriftTitel: 'wie-text',
  groesse: 16,
  zeilenhoehe: 1.5,
  titelGewicht: 'extra',
  dichte: 'normal',
  ecken: 16,
  schatten: 'spiel',
  rahmen: 'dick',
  knoepfe: 'spiel',
  hintergrund: 'verlauf',
  breite: 'normal',
  animationen: 'an',
  tabellen: 'schlicht',
  kopfleiste: 'mitlaufend',
  symbole: 'an',
  fokusRing: 'gelb',
  startseite: 'dorf',
  css: '',
};

/** Farben je Vorlage (alle Rollen) – „spiel“ = der bisherige Look (E63) */
export const VORLAGE_FARBEN: Record<Vorlage, Record<FarbRolle, string> & { dunkel?: boolean }> = {
  spiel: { akzent: '#2f8a2b', grund: '#e4f0d6', himmel: '#cfe8f5', karte: '#fffdf6', flaeche: '#ffffff', text: '#2b3a55', leise: '#5c677a', rand: '#2b3a55', linie: '#cdd6e3', plus: '#2f8a2b', minus: '#d2352a', warnung: '#e8761a', kopf: '#2b3a55' },
  schlicht: { akzent: '#2a78d6', grund: '#f3f4f6', himmel: '#f3f4f6', karte: '#ffffff', flaeche: '#ffffff', text: '#1f2937', leise: '#6b7280', rand: '#d1d5db', linie: '#e5e7eb', plus: '#15803d', minus: '#dc2626', warnung: '#d97706', kopf: '#ffffff' },
  nacht: { akzent: '#4ade80', grund: '#111827', himmel: '#0b1220', karte: '#1f2937', flaeche: '#243041', text: '#e5e7eb', leise: '#9ca3af', rand: '#0b0f17', linie: '#374151', plus: '#4ade80', minus: '#f87171', warnung: '#fbbf24', kopf: '#0b1220', dunkel: true },
  mitternacht: { akzent: '#8b9cf7', grund: '#0f1026', himmel: '#1a1b3d', karte: '#1b1c3a', flaeche: '#24264d', text: '#e7e8ff', leise: '#a3a6d6', rand: '#06061a', linie: '#34366a', plus: '#6ee7b7', minus: '#fb7185', warnung: '#fcd34d', kopf: '#06061a', dunkel: true },
  pastell: { akzent: '#b5548f', grund: '#fdf2f8', himmel: '#ede9fe', karte: '#fffbfe', flaeche: '#ffffff', text: '#4a3557', leise: '#8a7398', rand: '#6d4c7d', linie: '#ead8f2', plus: '#2f855a', minus: '#c53030', warnung: '#c05621', kopf: '#6d4c7d' },
  wald: { akzent: '#3f7d3a', grund: '#e8efe3', himmel: '#d4e4cc', karte: '#fbfcf7', flaeche: '#ffffff', text: '#24361f', leise: '#5f6f58', rand: '#2e4228', linie: '#cbd8c3', plus: '#2f7d32', minus: '#b3261e', warnung: '#b5651d', kopf: '#2e4228' },
  ozean: { akzent: '#0e7490', grund: '#e0f2fe', himmel: '#bae6fd', karte: '#f8fdff', flaeche: '#ffffff', text: '#0c3547', leise: '#4b6b7a', rand: '#0c4a6e', linie: '#c7e3f0', plus: '#047857', minus: '#be123c', warnung: '#c2410c', kopf: '#0c4a6e' },
  abendrot: { akzent: '#d9480f', grund: '#fff1e6', himmel: '#ffd8c2', karte: '#fffaf5', flaeche: '#ffffff', text: '#4a2511', leise: '#86614b', rand: '#6b2e12', linie: '#f3d5c2', plus: '#2b8a3e', minus: '#c92a2a', warnung: '#e67700', kopf: '#6b2e12' },
  papier: { akzent: '#5b4636', grund: '#f4efe6', himmel: '#f4efe6', karte: '#fbf8f2', flaeche: '#fffdf8', text: '#2f2a24', leise: '#7a6f63', rand: '#bfb3a3', linie: '#e3dacb', plus: '#3d7a3a', minus: '#a3322a', warnung: '#a86418', kopf: '#fbf8f2' },
  terminal: { akzent: '#22c55e', grund: '#0a0f0a', himmel: '#0a0f0a', karte: '#0f170f', flaeche: '#122012', text: '#b7f7c4', leise: '#6fae7e', rand: '#22c55e', linie: '#1d3a22', plus: '#4ade80', minus: '#f87171', warnung: '#facc15', kopf: '#050805', dunkel: true },
  kontrast: { akzent: '#0000c8', grund: '#ffffff', himmel: '#ffffff', karte: '#ffffff', flaeche: '#ffffff', text: '#000000', leise: '#222222', rand: '#000000', linie: '#000000', plus: '#006400', minus: '#b00000', warnung: '#8a4b00', kopf: '#000000' },
};

/** Vorlagen setzen auch Stile (nicht nur Farben) – eigene Einstellungen gehen vor */
export const VORLAGE_STIL: Partial<Record<Vorlage, Partial<AussehenT>>> = {
  schlicht: { schatten: 'weich', rahmen: 'duenn', knoepfe: 'flach', hintergrund: 'einfarbig', ecken: 10, titelGewicht: 'fett' },
  papier: { schatten: 'flach', rahmen: 'duenn', knoepfe: 'umriss', hintergrund: 'linien', schrift: 'serif', ecken: 6, titelGewicht: 'fett' },
  terminal: { schatten: 'keine', rahmen: 'duenn', knoepfe: 'umriss', hintergrund: 'einfarbig', schrift: 'mono', ecken: 0, titelGewicht: 'normal' },
  kontrast: { schatten: 'flach', rahmen: 'dick', knoepfe: 'umriss', hintergrund: 'einfarbig', fokusRing: 'dick', titelGewicht: 'extra' },
  mitternacht: { schatten: 'weich', rahmen: 'duenn', hintergrund: 'punkte' },
  nacht: { schatten: 'weich', rahmen: 'duenn' },
  pastell: { schatten: 'weich', rahmen: 'duenn', knoepfe: 'pille', ecken: 22, schrift: 'rund' },
};
