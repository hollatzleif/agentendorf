// E240 (Bereich E): zusätzliche Linien-Symbole für Dorf-Overlays, Atelier, Codehaus und Schriftprobe – eigene Zeichnungen
// im 24er-Raster wie symbole.tsx (Strich 1,8). <Zeichen e="…" /> zeigt im Dorf-Design das bisherige Zeichen als reinen Text
// (gleiche DOM-Struktur, gleicher zugänglicher Name wie vorher) und in der Apple-Oberfläche ein Symbol – zuerst aus dieser
// Datei, dann aus symbole.tsx; Unbekanntes bleibt das Zeichen.
import type { ReactNode } from 'react';
import { useDesign } from './design';
import { Symbol, Ikon } from './Ikon';
import { symbolFuer } from './symbole';

const p = (d: string) => <path d={d} />;

export const WERKZEUG_SYMBOLE = {
  // Dorf
  drehen_links: p('M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4'),
  drehen_rechts: p('M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4'),
  minus: p('M5 12h14'),
  plus: p('M12 5v14M5 12h14'),
  ziel: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
      <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5" />
    </>
  ),
  zeitung: (
    <>
      <path d="M4 5.5h13v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M17 9h3v9.5a2 2 0 0 1-2 2M7 9h7M7 12.5h7M7 16h4" />
    </>
  ),
  globus: (
    <>
      <circle cx="12" cy="12" r="8.8" />
      <path d="M3.2 12h17.6M12 3.2c2.4 2.4 3.6 5.3 3.6 8.8s-1.2 6.4-3.6 8.8c-2.4-2.4-3.6-5.3-3.6-8.8S9.6 5.6 12 3.2z" />
    </>
  ),
  frage: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.4 9.4a2.7 2.7 0 0 1 5.2.9c0 1.8-2.6 2.3-2.6 4M12 17.2v.2" />
    </>
  ),
  roboter: (
    <>
      <rect x="4.5" y="8" width="15" height="11" rx="3.5" />
      <path d="M12 8V4.5M9 13v.5M15 13v.5M2.5 12.5v3M21.5 12.5v3" />
      <circle cx="12" cy="4" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  kompass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </>
  ),
  gehen: (
    <>
      <circle cx="13" cy="4.5" r="1.8" />
      <path d="m9 21 2.5-6 2.5 2.5V21M8 11l2.5-3.5 3.5 1 2 3.5 2.5 1M11.5 15l1-6" />
    </>
  ),
  flagge: p('M5.5 21V4M5.5 4.5h11l-2.5 4 2.5 4h-11'),
  kreis_x: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </>
  ),
  kreis_stop: (
    <>
      <circle cx="12" cy="12" r="9" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </>
  ),
  baustelle: p('M3 20h18M5.5 20 11 5h2l5.5 15M8 13h8M7 16.5h10'),
  zeiger: p('M6 3.5 18.5 13l-5.8.6 3.2 6.6-2.4 1.1-3.2-6.6L6 18.8z'),
  strasse: p('M7.5 3.5 4.5 20.5M16.5 3.5l3 17M12 4v3M12 10.5v3M12 17v3.5'),
  tropfen: p('M12 3.5c3 4 6 7.2 6 10.5a6 6 0 0 1-12 0c0-3.3 3-6.5 6-10.5z'),
  besen: p('M14 3.5 10.5 11M6 11.5h9l2.5 9h-14zM8.5 15.5v5M12 15.5v5'),
  kiste: (
    <>
      <path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4z" />
      <path d="M3.5 7.5 12 11.5l8.5-4M12 11.5v9" />
    </>
  ),
  rueckgaengig: p('M9 14.5 4.5 10 9 5.5M4.5 10H14a5.5 5.5 0 0 1 0 11h-3'),
  wiederholen: p('M15 14.5l4.5-4.5L15 5.5M19.5 10H10a5.5 5.5 0 0 0 0 11h3'),
  haken: p('m5 12.5 4.5 4.5L19 7.5'),
  quadrat: <rect x="4.5" y="4.5" width="15" height="15" rx="2.5" />,
  kreuz: p('M6.5 6.5l11 11M17.5 6.5l-11 11'),
  punkt_gefuellt: <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />,
  menue: p('M4 7h16M4 12h16M4 17h16'),
  auge: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  auge_zu: p('M2.5 12S6 5.5 12 5.5c2 0 3.7.7 5.1 1.7M21.5 12s-3.5 6.5-9.5 6.5c-2 0-3.7-.7-5.1-1.7M4 20 20 4'),
  // Atelier
  verschieben: p('M12 3v18M3 12h18M12 3 9.5 5.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5'),
  auswahl_rechteck: p('M4 7V4h3M10 4h4M17 4h3v3M20 10v4M20 17v3h-3M14 20h-4M7 20H4v-3M4 14v-4'),
  auswahl_ellipse: (
    <ellipse cx="12" cy="12" rx="8.5" ry="6.5" strokeDasharray="2.6 2.6" />
  ),
  lasso: p('M6 15.5C3.5 13.5 3.5 9 7 6.5s9.5-2.5 12 .5 .5 7.5-4.5 8.5c-2.5.5-5 .3-7.2-.7M7.3 14.8c-1.3 1-1.6 2.8-.6 4 1.1 1.4 3.3 1.5 3.3 3.2'),
  zauberstab: p('m4 20 11-11M14 4l1 2.5 2.5 1L15 8.5 14 11l-1-2.5-2.5-1L13 6.5zM19 13l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z'),
  zuschneiden: p('M7 2.5V17h14.5M2.5 7H17v14.5'),
  pipette: p('m14 6.5 3.5 3.5M16.5 3.5a2.1 2.1 0 0 1 3 3L17 9l-2-2zM15 8 6 17l-1 2.5L7.5 18.5 16.5 9.5'),
  pinsel: p('M14.5 4.5 19.5 9.5l-7 7-5-5zM7.5 11.5c-2.5 0-4 2-4 4.5 0 1.5-.5 2.5-1 3 3 .5 7 0 7.5-3'),
  radierer: p('m9.5 19.5-5-5a1.8 1.8 0 0 1 0-2.5l8-8a1.8 1.8 0 0 1 2.5 0l5 5a1.8 1.8 0 0 1 0 2.5l-8 8zM9 8.5l6.5 6.5M9.5 19.5H20'),
  eimer: p('M5 10.5 11.5 4l7 7-6.5 6.5a2 2 0 0 1-2.8 0L5 13.3a2 2 0 0 1 0-2.8zM5 11.5h13.5M20 15.5s1.5 2 1.5 3a1.5 1.5 0 0 1-3 0c0-1 1.5-3 1.5-3z'),
  verlauf: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <path d="M8 5v14M12 5v14M16 5v14" strokeDasharray="1.6 2.2" />
    </>
  ),
  text: p('M5 6.5V4.5h14v2M12 4.5v15M9 19.5h6'),
  form: (
    <>
      <rect x="3.5" y="9.5" width="10" height="10" rx="2" />
      <circle cx="15.5" cy="8.5" r="5" />
    </>
  ),
  hand: p('M8.5 12V5.5a1.5 1.5 0 0 1 3 0V11M11.5 10V4a1.5 1.5 0 0 1 3 0v7M14.5 10.5V6a1.5 1.5 0 0 1 3 0v8.5c0 4-2.5 6.5-6 6.5-2.5 0-4-1-5.5-3l-2.6-4a1.5 1.5 0 0 1 2.4-1.8l1.7 2V8.5a1.5 1.5 0 0 1 3 0'),
  lupe: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5" />
    </>
  ),
  duplizieren: (
    <>
      <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5" />
      <path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" />
    </>
  ),
  pfeil_hoch: p('M12 19.5v-15M6.5 10 12 4.5 17.5 10'),
  pfeil_runter: p('M12 4.5v15M6.5 14 12 19.5 17.5 14'),
  vereinen: p('M12 3.5v10M7.5 9.5l4.5 4.5 4.5-4.5M4.5 17.5h15M4.5 20.5h15'),
  papierkorb: p('M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5'),
  tauschen: p('M7 4.5 3.5 8 7 11.5M3.5 8h13M17 12.5l3.5 3.5-3.5 3.5M20.5 16h-13'),
  halbkreis: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" />
    </>
  ),
  // Codehaus
  ordner: p('M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2.5h6.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z'),
  ordner_offen: p('M3 18V7.5A2.5 2.5 0 0 1 5.5 5H10l2 2.5h5A2.5 2.5 0 0 1 19.5 10v.5M3 18l2.6-6.2a1.8 1.8 0 0 1 1.7-1.1H21l-2.8 7.4a1.8 1.8 0 0 1-1.7 1.2H4.5A1.5 1.5 0 0 1 3 18z'),
  dokument: p('M6 3h8l4 4v14H6zM14 3v4h4'),
  dokument_plus: p('M6 3h8l4 4v6M14 3v4h4M11 21H6V3M17.5 15.5v6M14.5 18.5h6'),
  ordner_plus: p('M11 20H5.5A2.5 2.5 0 0 1 3 17.5v-10A2.5 2.5 0 0 1 5.5 5H10l2 2.5h6.5A2.5 2.5 0 0 1 21 10v2.5M17.5 15v6M14.5 18h6'),
  link: p('M10 14a4 4 0 0 0 5.7 0l3.3-3.3a4 4 0 0 0-5.7-5.7L12 6.3M14 10a4 4 0 0 0-5.7 0L5 13.3A4 4 0 0 0 10.7 19l1.3-1.3'),
  hochladen: p('M12 15.5v-11M8 8.5l4-4 4 4M5.5 13v6.5h13V13'),
  herunterladen: p('M12 3.5v11M8 10.5l4 4 4-4M5.5 19.5h13'),
  stift: p('m4 20 1-4.5L15.5 5l3.5 3.5L8.5 19zM13.5 7l3.5 3.5'),
  neu_laden: p('M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4'),
  zweig: (
    <>
      <circle cx="6.5" cy="5.5" r="2" />
      <circle cx="6.5" cy="18.5" r="2" />
      <circle cx="17.5" cy="7.5" r="2" />
      <path d="M6.5 7.5v9M17.5 9.5c0 4.5-5 4-9.5 7.5" />
    </>
  ),
  tastatur: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M6 9.5h.1M9.5 9.5h.1M13 9.5h.1M16.5 9.5h.1M6.5 14.5h11" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="m7 9.5 3 2.5-3 2.5M12.5 15H17" />
    </>
  ),
  puzzle: p('M9 4.5h2a1.5 1.5 0 0 1 3 0h3.5V9a1.5 1.5 0 0 1 0 3v4.5H13a1.5 1.5 0 0 0-3 0H5.5V12a1.5 1.5 0 0 0 0-3V4.5z'),
  neues_fenster: p('M13.5 4.5h6v6M19.5 4.5 11 13M17.5 14v4a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h4'),
  sichern: p('M5 4h11.5L20 7.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1zM8 4v5h7V4M8 20v-6h8v6'),
  ausblenden: p('m6 9.5 6 6 6-6'),
  zurueck: p('M15 5l-7 7 7 7'),
  weiter: p('m9 5 7 7-7 7'),
  zeilenumbruch: p('M19.5 5v6a3 3 0 0 1-3 3h-12M8.5 10l-4 4 4 4'),
  warnung: p('M12 4 2.5 20h19zM12 10v4.5M12 17.3v.2'),
} satisfies Record<string, ReactNode>;

export type WerkzeugSymbolName = keyof typeof WERKZEUG_SYMBOLE;

/** Zeichen/Emoji (ohne Variationszeichen) → Symbol dieser Datei */
const ZEICHEN: Record<string, WerkzeugSymbolName> = {
  '⟲': 'drehen_links', '⟳': 'drehen_rechts', '−': 'minus', '+': 'plus', '＋': 'plus', '⌂': 'ziel',
  '📰': 'zeitung', '🌐': 'globus', '❓': 'frage', '🤖': 'roboter', '🧭': 'kompass', '🚶': 'gehen', '🏁': 'flagge',
  '❌': 'kreis_x', '⏹': 'kreis_stop', '🚧': 'baustelle', '👆': 'zeiger', '🛣': 'strasse', '💧': 'tropfen',
  '🧹': 'besen', '📦': 'kiste', '↶': 'rueckgaengig', '↷': 'wiederholen', '✓': 'haken', '☰': 'menue',
  '👁': 'auge', '✥': 'verschieben', '⬚': 'auswahl_rechteck', '◯': 'auswahl_ellipse', '➰': 'lasso', '🪄': 'zauberstab',
  '⛶': 'zuschneiden', '🖌': 'pinsel', '🧽': 'radierer', '🪣': 'eimer', '▤': 'verlauf', 'T': 'text', '▭': 'form',
  '✋': 'hand', '🔍': 'lupe', '⧉': 'duplizieren', '↑': 'pfeil_hoch', '↓': 'pfeil_runter', '⤓': 'vereinen', '🗑': 'papierkorb',
  '⇄': 'tauschen', '◐': 'halbkreis', '📁': 'ordner', '📂': 'ordner_offen', '📄': 'dokument', '🔗': 'link',
  '📄＋': 'dokument_plus', '📁＋': 'ordner_plus', '⬆': 'hochladen', '⬇': 'herunterladen', '✏': 'stift', '↻': 'neu_laden',
  '🌿': 'zweig', '⌨': 'tastatur', '🖥': 'terminal', '💻': 'terminal', '🧩': 'puzzle', '↗': 'neues_fenster', '💾': 'sichern',
  '▾': 'ausblenden', '←': 'zurueck', '→': 'weiter', '⏎': 'zeilenumbruch', '▢': 'quadrat', '·': 'auge_zu', '×': 'kreuz', '✕': 'kreuz', '●': 'punkt_gefuellt', '🔵': 'punkt_gefuellt', '🟠': 'punkt_gefuellt', '⚠': 'warnung', '📝': 'stift', '🔎': 'lupe',
};

export function werkzeugSymbolFuer(zeichen: string): WerkzeugSymbolName | null {
  return ZEICHEN[zeichen.replace(/️/g, '').trim()] ?? null;
}

export function WerkzeugSymbol({ name, groesse = '1.15em' }: { name: WerkzeugSymbolName; groesse?: string | number }) {
  return (
    <svg className="a-symbol" viewBox="0 0 24 24" width={groesse} height={groesse} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {WERKZEUG_SYMBOLE[name]}
    </svg>
  );
}

/**
 * Dorf-Design: genau das bisherige Zeichen als Text (keine zusätzliche Hülle). Apple: Linien-Symbol (diese Datei, dann symbole.tsx);
 * ist keins vorhanden, bleibt das Zeichen stehen.
 */
export function Zeichen({ e, groesse }: { e: string; groesse?: string | number }) {
  const design = useDesign();
  if (design !== 'apple') return <>{e}</>;
  const eigenes = werkzeugSymbolFuer(e);
  if (eigenes) return <WerkzeugSymbol name={eigenes} groesse={groesse} />;
  const name = symbolFuer(e);
  if (name) return <Symbol name={name} groesse={groesse} />;
  return <Ikon e={e} groesse={groesse} />;
}
