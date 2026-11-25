// E240: Linien-Symbole (24er Raster, Strich 1,8) im Stil von SF Symbols – eigene Zeichnungen.
// Zuordnung Emoji → Symbol: EMOJI_SYMBOL. Erweitern, wenn neue Emojis in der Oberfläche auftauchen.
import type { ReactNode } from 'react';

export const SYMBOLE = {
  bueroklammer: <path d="M16.5 7.5 9 15a2 2 0 0 0 2.8 2.8l7.8-7.8a4 4 0 0 0-5.7-5.7L6 12.2a6 6 0 0 0 8.5 8.5l6-6" />,
  haus: <path d="M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5M10 20v-5.5h4V20" />,
  kalender: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </>
  ),
  haken: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  kreis_haken: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.3 2.8 2.8L16.3 9.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  zahnrad: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
    </>
  ),
  buch: <path d="M4 5.5c2.5-1 5.5-1 8 .8 2.5-1.8 5.5-1.8 8-.8v13c-2.5-1-5.5-1-8 .8-2.5-1.8-5.5-1.8-8-.8zM12 6.3v13" />,
  brief: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  sprechblase: <path d="M20 12c0 4-3.6 7-8 7-1.2 0-2.3-.2-3.3-.6L4 20l1.4-3.6C4.5 15.1 4 13.6 4 12c0-4 3.6-7 8-7s8 3 8 7z" />,
  glocke: <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2.2 2.2 0 0 0 4 0" />,
  uhr: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.2 2" />
    </>
  ),
  stern: <path d="m12 3.8 2.5 5.2 5.7.7-4.2 3.9 1.1 5.6L12 16.4l-5.1 2.8 1.1-5.6-4.2-3.9 5.7-.7z" />,
  diagramm: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  kurve: <path d="M3 17l5-5 4 3 8-8M15 7h5v5" />,
  geld: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  anker: (
    <>
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v14M8 10.5h8M4.5 13a7.5 7.5 0 0 0 15 0" />
    </>
  ),
  gehirn: <path d="M9.5 4.5a3 3 0 0 0-3 3 3 3 0 0 0-2 5.2 3 3 0 0 0 2.6 4.6 3 3 0 0 0 4.4 2.2V5.7a2.4 2.4 0 0 0-2-1.2zM14.5 4.5a3 3 0 0 1 3 3 3 3 0 0 1 2 5.2 3 3 0 0 1-2.6 4.6 3 3 0 0 1-4.4 2.2" />,
  ordner: <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2.5h6.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />,
  dokument: <path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6" />,
  stift: <path d="m4 20 1-4.5L15.5 5l3.5 3.5L8.5 19zM13.5 7l3.5 3.5" />,
  papierkorb: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" />,
  suche: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5" />
    </>
  ),
  pfeil_links: <path d="M15 5l-7 7 7 7" />,
  pfeil_rechts: <path d="m9 5 7 7-7 7" />,
  schliessen: <path d="M6 6l12 12M18 6 6 18" />,
  mehr: (
    <>
      <circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="3.8" />
      <path d="M4.5 20.5c1.2-4 4-6 7.5-6s6.3 2 7.5 6" />
    </>
  ),
  mond: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />,
  sonne: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  blitz: <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />,
  warnung: <path d="M12 4 2.5 20h19zM12 10v4.5M12 17.3v.2" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.8v.2" />
    </>
  ),
  schloss: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="m7 9.5 3 2.5-3 2.5M12.5 15H17" />
    </>
  ),
  pinsel: <path d="M14.5 4.5 19.5 9.5l-7 7-5-5zM7.5 11.5c-2.5 0-4 2-4 4.5 0 1.5-.5 2.5-1 3 3 .5 7 0 7.5-3" />,
  einkauf: <path d="M5 7h14l-1.2 12.5H6.2zM9 7V5.5a3 3 0 0 1 6 0V7" />,
  hut: <path d="M2.5 9.5 12 5l9.5 4.5L12 14zM6.5 11.5V16c1.5 1.5 3.5 2.2 5.5 2.2s4-.7 5.5-2.2v-4.5M21.5 9.5V15" />,
  rakete: <path d="M14 4c3.5 0 6 2.5 6 6-2 3.5-5 6-8 7.5L6.5 12C8 9 10.5 6 14 4zM6.5 12l-3 1 3.5 3.5M12 17.5l-1 3-3.5-3.5M15 9.2v.1" />,
  flamme: <path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2-5 .8 1.5 1.5 2 2.5 2C11 8 11 5.5 12 3z" />,
  wiederholen: <path d="M4 12a8 8 0 0 1 14-5.3M20 4v4h-4M20 12a8 8 0 0 1-14 5.3M4 20v-4h4" />,
  liste: <path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.1M4.5 12h.1M4.5 17.5h.1" />,
  karte: <path d="M3 6.5 9 4l6 2.5 6-2.5v13.5L15 20l-6-2.5L3 20zM9 4v13.5M15 6.5V20" />,
  wolke: <path d="M7 18.5a4.5 4.5 0 1 1 .8-8.9A6 6 0 0 1 19.5 11a3.8 3.8 0 0 1-.5 7.5z" />,
  herz: <path d="M12 19.5s-7.5-4.5-7.5-10A4 4 0 0 1 12 7.2a4 4 0 0 1 7.5 2.3c0 5.5-7.5 10-7.5 10z" />,
  teilen: <path d="M12 3.5v11M8 7.5l4-4 4 4M5.5 11v8.5h13V11" />,
  herunterladen: <path d="M12 3.5v11M8 10.5l4 4 4-4M5.5 19.5h13" />,
  kopieren: (
    <>
      <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5" />
      <path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" />
    </>
  ),
  regler: <path d="M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4" />,
  bild: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="m21 16-5-5-9 8.5" />
    </>
  ),
  mikro: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3.5" />
    </>
  ),
  play: <path d="M7 4.5v15l12-7.5z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  schild: <path d="M12 3 4.5 6v6c0 4.5 3.2 7.7 7.5 9 4.3-1.3 7.5-4.5 7.5-9V6z" />,
  zauberstab: <path d="m4 20 11-11M14 4l1 2.5 2.5 1L15 8.5 14 11l-1-2.5-2.5-1L13 6.5zM19 13l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" />,
  baum: <path d="M12 3 6 11h3l-4 6h14l-4-6h3zM12 17v4" />,
  bauen: <path d="M14.5 6.5 17.5 3.5l3 3-3 3M17.5 6.5 6 18l-2.5.5L4 16 15.5 4.5M4 20.5h16" />,

  // ---- E240 Ausbau (Agent A): alle Emojis der Oberfläche ----
  rathaus: <path d="M3 9.5 12 4l9 5.5M5 20h14M6.5 10.5v7M10.2 10.5v7M13.8 10.5v7M17.5 10.5v7M3.5 20.5h17" />,
  korb: <path d="M3.5 10h17l-2 9.5h-13zM7.5 10l3-5.5M16.5 10l-3-5.5M9 13.5v3M12 13.5v3M15 13.5v3" />,
  timer: (
    <>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 13.5V9.5M10 2.5h4M18.3 6.7l1.4-1.4" />
    </>
  ),
  ziel: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5.3" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  kompass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </>
  ),
  befehl: <path d="M9 9H6.5A2.5 2.5 0 1 1 9 6.5v11A2.5 2.5 0 1 1 6.5 15h11a2.5 2.5 0 1 1-2.5 2.5v-11A2.5 2.5 0 1 1 17.5 9z" />,
  globus: (
    <>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18M4.6 7.5h14.8M4.6 16.5h14.8" />
    </>
  ),
  neu_laden: <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4h-4" />,
  rueckgaengig: <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
  wiederherstellen: <path d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />,
  eingabe: <path d="M19 5v7a3 3 0 0 1-3 3H5M9 11l-4 4 4 4" />,
  konfetti: <path d="m4 20 4.5-12 7.5 7.5zM13 3.5V5.5M18.5 5.5l-1.4 1.4M20.5 11h-2M14.5 9.5c1.2-1.5 1.2-3 0-4.5M7 12.5l4.5 4.5" />,
  pfeile_lr: <path d="M3.5 12h17M7.5 8l-4 4 4 4M16.5 8l4 4-4 4" />,
  gedanke: (
    <>
      <path d="M7.5 15.5a3.5 3.5 0 0 1-.6-7 4.6 4.6 0 0 1 8.8-1.3 3.9 3.9 0 0 1 1.8 8.3z" />
      <circle cx="7" cy="19" r="1.2" />
      <circle cx="4.3" cy="21" r="0.6" />
    </>
  ),
  umschalt: <path d="M12 4 4 12.5h4.5V19h7v-6.5H20z" />,
  chevron_unten: <path d="m6 9.5 6 6 6-6" />,
  chevron_oben: <path d="m6 14.5 6-6 6 6" />,
  dreieck_oben: <path d="M12 6.5 18.5 17h-13z" fill="currentColor" />,
  dreieck_unten: <path d="M12 17.5 18.5 7h-13z" fill="currentColor" />,
  feder: <path d="M20 4C11 4 6.5 9 5.5 19M20 4c-1 6.5-5.5 10-12.5 10.5M5.5 19 3.5 21" />,
  punkt: <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />,
  punkt_blau: <circle cx="12" cy="12" r="6" stroke="none" style={{ fill: 'var(--a-blau, #007aff)' }} />,
  punkt_gruen: <circle cx="12" cy="12" r="6" stroke="none" style={{ fill: 'var(--a-gruen, #34c759)' }} />,
  punkt_orange: <circle cx="12" cy="12" r="6" stroke="none" style={{ fill: 'var(--a-orange, #ff9500)' }} />,
  punkt_rot: <circle cx="12" cy="12" r="6" stroke="none" style={{ fill: 'var(--a-rot, #ff3b30)' }} />,
  kreis: <circle cx="12" cy="12" r="7" />,
  kreis_punkt: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
    </>
  ),
  halb: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor" />
    </>
  ),
  kaestchen: <rect x="4.5" y="4.5" width="15" height="15" rx="3.5" />,
  stern_voll: <path d="m12 3.8 2.5 5.2 5.7.7-4.2 3.9 1.1 5.6L12 16.4l-5.1 2.8 1.1-5.6-4.2-3.9 5.7-.7z" fill="currentColor" />,
  puzzle: <path d="M5 8h3.5a2 2 0 1 1 4 0H16v3.5a2 2 0 1 1 0 4V19H5z" />,
  extern: <path d="M8 16 16 8M9.5 8H16v6.5" />,
  pfeil_hoch: <path d="M12 19.5v-15M6.5 10 12 4.5l5.5 5.5" />,
  pfeil_runter: <path d="M12 4.5v15M6.5 14l5.5 5.5 5.5-5.5" />,
  blatt: <path d="M5 19c0-8 5-14 14-14 0 9-6 14-14 14zM5 19l8-8" />,
  pflanze: <path d="M12 21v-8M12 13c0-4 3-6.5 7-6.5 0 4-3 6.5-7 6.5zM12 15.5c0-3-2.5-5-6-5 0 3 2.5 5 6 5z" />,
  signal: <path d="M5 19v-3M10 19v-6.5M15 19V9.5M20 19V5.5" />,
  roboter: (
    <>
      <rect x="5" y="8" width="14" height="11" rx="3" />
      <path d="M12 8V5.5M9.5 12.5v1M14.5 12.5v1M3 12.5v3M21 12.5v3" />
      <circle cx="12" cy="4.2" r="1.1" />
    </>
  ),
  schere: (
    <>
      <circle cx="6.5" cy="17" r="2.5" />
      <circle cx="6.5" cy="7" r="2.5" />
      <path d="M8.6 8.4 20 18M8.6 15.6 20 6" />
    </>
  ),
  vollbild: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  loeschtaste: <path d="M9 5.5h10.5A1.5 1.5 0 0 1 21 7v10a1.5 1.5 0 0 1-1.5 1.5H9L3 12zM12 9.5l5 5M17 9.5l-5 5" />,
  blume: (
    <>
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 9.8C10 6 10.5 3.5 12 3.5s2 2.5 0 6.3M14.2 12c3.8-2 6.3-1.5 6.3 0s-2.5 2-6.3 0M12 14.2c2 3.8 1.5 6.3 0 6.3s-2-2.5 0-6.3M9.8 12C6 14 3.5 13.5 3.5 12s2.5-2 6.3 0" />
    </>
  ),
  zeitung: <path d="M4 5h13v13.5a1.5 1.5 0 0 0 1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM17 9h3v9.5a1.5 1.5 0 0 1-3 0M7 8.5h7M7 12h7M7 15.5h4.5" />,
  rechner: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2.5" />
      <path d="M8 7h8M8.5 11h.1M12 11h.1M15.5 11h.1M8.5 14.5h.1M12 14.5h.1M15.5 14.5h.1M8.5 18h.1M12 18h3.5" />
    </>
  ),
  auge: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  auge_durch: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
      <path d="m4 4 16 16" />
    </>
  ),
  stufen: <path d="M3.5 19.5h5v-5h5v-5h5v-5h2" />,
  handy: (
    <>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M10.5 18.5h3" />
    </>
  ),
  tastatur: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M6 9.5h.1M9.3 9.5h.1M12.6 9.5h.1M15.9 9.5h.1M18 9.5h.1M6 12.5h.1M18 12.5h.1M9.3 12.5h5.4M8 15h8" />
    </>
  ),
  ort: (
    <>
      <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  menue: <path d="M4 7h16M4 12h16M4 17h16" />,
  besen: <path d="m19.5 4-7 7M8.5 10.5l5 5-1.5 4.5c-3 0-7-1-9-4.5L4.5 14c1 .5 2 .5 3-.5z" />,
  flagge: <path d="M5 21V4M5 4.5h12l-2.5 4 2.5 4H5" />,
  schlaf: <path d="M4 9h5l-5 6h5M13 5h4l-4 5h4M16.5 14h3.5l-3.5 4.5H20" />,
  lautsprecher: <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />,
  stumm: <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9.5l5 5M20.5 9.5l-5 5" />,
  glocke_durch: <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2.2 2.2 0 0 0 4 0M4 4l16 16" />,
  gesicht_1: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 10h.1M15 10h.1M8.5 17c2-2.4 5-2.4 7 0" />
    </>
  ),
  gesicht_2: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 10h.1M15 10h.1M8.8 16.3c2.2-1.1 4.2-1.1 6.4 0" />
    </>
  ),
  gesicht_3: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 10h.1M15 10h.1M9 15.5h6" />
    </>
  ),
  gesicht_4: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 10h.1M15 10h.1M8.8 14.5c2 1.7 4.4 1.7 6.4 0" />
    </>
  ),
  gesicht_5: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9.5h.1M15 9.5h.1M8 13.5h8c0 2.5-1.8 4-4 4s-4-1.5-4-4z" />
    </>
  ),
  gluehbirne: <path d="M9 17.5h6M10 20.5h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V17h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" />,
  vorspulen: <path d="M4.5 6.5v11L12 12zM12 6.5v11l7.5-5.5zM20 6v12" />,
  daumen: <path d="M7.5 10.5v9h-3v-9zM7.5 10.5 11 4c1.5 0 2.5 1 2.2 2.6l-.6 3.4h5.6a2 2 0 0 1 2 2.4l-1.3 5.8a2 2 0 0 1-2 1.6H7.5" />,
  tropfen: <path d="M12 3.5s-6 6.5-6 11a6 6 0 0 0 12 0c0-4.5-6-11-6-11z" />,
  wegweiser: <path d="M12 21v-8M12 3v2M5 5h12l2.5 2.5L17 10H5z" />,
  stecker: <path d="M9 3v4.5M15 3v4.5M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0zM12 16v5" />,
  regen: (
    <>
      <path d="M7 15.5a4 4 0 1 1 .8-7.9A5.5 5.5 0 0 1 18.4 9a3.3 3.3 0 0 1-.9 6.5z" />
      <path d="m8.5 18.5-1 2M12.5 18.5l-1 2M16.5 18.5l-1 2" />
    </>
  ),
  baustelle: (
    <>
      <rect x="3" y="7" width="18" height="6" rx="1.5" />
      <path d="M7.5 7 4.5 13M12.5 7l-3 6M17.5 7l-3 6M6 13v7M18 13v7" />
    </>
  ),
  paket: <path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4zM3.5 7.5 12 11.5l8.5-4M12 11.5v9M7.8 5.5l8.5 4" />,
  karteikarte: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <circle cx="8.5" cy="10.5" r="2" />
      <path d="M5.5 15.8c.5-1.5 1.6-2.2 3-2.2s2.5.7 3 2.2M14 10h4M14 13.5h4" />
    </>
  ),
  frage: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.6v.6M12 17v.2" />
    </>
  ),
  stopp: <path d="M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3zM8 12h8" />,
  tasche: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2.5" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12.5h18" />
    </>
  ),
  puls: <path d="M3 12h4l2-5 4 10 2-5h6" />,
  waage: <path d="M12 4v16M8 20h8M5 7h14M5 7l-2.5 6a2.5 2.5 0 0 0 5 0zM19 7l-2.5 6a2.5 2.5 0 0 0 5 0z" />,
  film: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4" />
    </>
  ),
  zusammen: <path d="m4 4 5 5M9 5v4H5M20 20l-5-5M15 19v-4h4" />,
  personen: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3 19.5c.8-3.2 3.2-5 6-5s5.2 1.8 6 5M15.5 5.6a3.2 3.2 0 0 1 0 6M17.5 14.8c1.8.7 3 2.3 3.5 4.7" />
    </>
  ),
  bewegen: <path d="M12 3v18M3 12h18M9.5 5.5 12 3l2.5 2.5M9.5 18.5 12 21l2.5-2.5M5.5 9.5 3 12l2.5 2.5M18.5 9.5 21 12l-2.5 2.5" />,
  auswahl: <rect x="4" y="5" width="16" height="14" rx="1.5" strokeDasharray="2.6 2.6" />,
  lasso: (
    <>
      <ellipse cx="12.5" cy="9.5" rx="7.5" ry="5" />
      <path d="M7 13c-1 1.5-1.5 3 0 4.5s3.5.5 3.5 2.5" />
    </>
  ),
  eimer: <path d="M5 8h14l-1.5 12h-11zM5 8c0-2 3-3.5 7-3.5s7 1.5 7 3.5" />,
  hand: <path d="M8 13V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7.5-6.5 7.5-2.5 0-4-1.3-5.5-3.5l-1.5-3.2a1.5 1.5 0 0 1 2.4-1.8L8 14.5" />,
  sortieren: <path d="M8 4v16M4.5 7.5 8 4l3.5 3.5M16 20V4M12.5 16.5 16 20l3.5-3.5" />,
  strasse: <path d="M7 3 4 21M17 3l3 18M12 4v2.5M12 10.5v3M12 17.5V20" />,
  stein: <path d="M4 17.5 6.5 9 11 5.5l6 1.5 3.5 6-1.5 5.5z" />,
  ziegel: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <path d="M3 9.7h18M3 14.3h18M9 5v4.7M15 5v4.7M6 9.7v4.6M12 9.7v4.6M18 9.7v4.6M9 14.3V19M15 14.3V19" />
    </>
  ),
  stuhl: <path d="M7 3v18M7 13h10v8M17 13l-1-3H7" />,
  brunnen: <path d="M4 15h16l-1.5 5h-13zM12 15V6M12 6c-2-2.5-5-2.5-6.5 0M12 6c2-2.5 5-2.5 6.5 0M5.5 6.2v3M18.5 6.2v3" />,
  laterne: (
    <>
      <rect x="7" y="7" width="10" height="11" rx="4" />
      <path d="M10 4h4M12 4v3M10 18v2.5h4V18M7 12.5h10" />
    </>
  ),
  holz: (
    <>
      <ellipse cx="7" cy="12" rx="3.5" ry="5.5" />
      <path d="M7 6.5h11a3.5 5.5 0 0 1 0 11H7M7 10.5v3" />
    </>
  ),
  pilz: <path d="M3.5 12a8.5 7.5 0 0 1 17 0zM9.5 12v6a2.5 2.5 0 0 0 5 0v-6" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3.3-3.3a4 4 0 0 0-5.7-5.7l-1.3 1.3M14 10a4 4 0 0 0-5.7 0L5 13.3a4 4 0 0 0 5.7 5.7l1.3-1.3" />,
  speichern: <path d="M5.5 3.5H16L20 7.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19V5a1.5 1.5 0 0 1 1.5-1.5zM8 3.5v5h7v-5M7.5 20.5v-6h9v6" />,
  tasse: <path d="M4.5 9h12v6a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5zM16.5 10.5H18a2.5 2.5 0 0 1 0 5h-1.5M8.5 3.5V6M12.5 3.5V6" />,
  laptop: (
    <>
      <rect x="4.5" y="5" width="15" height="10.5" rx="1.5" />
      <path d="M2.5 18.5h19" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12.5" rx="2" />
      <path d="M9 20.5h6M12 16.5v4" />
    </>
  ),
  fenster: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9h17M6.5 6.8h.1M9 6.8h.1" />
    </>
  ),
  sonnenaufgang: <path d="M3 18h18M6.5 18a5.5 5.5 0 0 1 11 0M12 4.5v3M5 9l1.8 1.5M19 9l-1.8 1.5M8.5 21h7" />,
  wind: <path d="M3 9h11a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M3 17h7" />,
  geschenk: (
    <>
      <rect x="4" y="9" width="16" height="11.5" rx="1.5" />
      <path d="M3 9h18M12 9v11.5M12 9C10.5 5 6 4.5 6 7s3.5 2 6 2c2.5 0 6 .5 6-2s-4.5-2-6 2" />
    </>
  ),
  welle: <path d="M3 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />,
  fisch: <path d="M3 12c3-5 10-6 14 0-4 6-11 5-14 0zM17 12l4-3.5v7zM8 11h.1" />,
  aktenkoffer: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2.5" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type SymbolName = keyof typeof SYMBOLE;

/** Emoji (ohne Variationszeichen) → Symbol */
const EMOJI_SYMBOL: Record<string, SymbolName> = {
  '🏠': 'haus', '🏡': 'haus', '🏘': 'haus',
  '📅': 'kalender', '🗓': 'kalender', '📆': 'kalender',
  '✅': 'kreis_haken', '✔': 'haken', '✓': 'haken', '☑': 'kreis_haken',
  '➕': 'plus', '⚙': 'zahnrad', '🔧': 'zahnrad', '🛠': 'bauen', '🏗': 'bauen', '🔨': 'bauen',
  '📚': 'buch', '📖': 'buch', '📘': 'buch', '📓': 'buch',
  '✉': 'brief', '📬': 'brief', '📮': 'brief', '📨': 'brief', '📧': 'brief',
  '💬': 'sprechblase', '🗨': 'sprechblase',
  '🔔': 'glocke', '⏰': 'uhr', '⏱': 'timer', '🕐': 'uhr', '⌛': 'uhr', '⏳': 'uhr',
  '⭐': 'stern', '🌟': 'stern', '📊': 'diagramm', '📈': 'kurve', '📉': 'kurve',
  '💶': 'geld', '💰': 'geld', '🏦': 'geld', '💵': 'geld', '💳': 'geld',
  '⚓': 'anker', '🧠': 'gehirn', '📁': 'ordner', '📂': 'ordner', '🗂': 'ordner',
  '📄': 'dokument', '📝': 'stift', '✏': 'stift', '🖊': 'stift', '✍': 'stift',
  '🗑': 'papierkorb', '🔍': 'suche', '🔎': 'suche',
  '←': 'pfeil_links', '⬅': 'pfeil_links', '→': 'pfeil_rechts', '➡': 'pfeil_rechts',
  '✕': 'schliessen', '✖': 'schliessen', '❌': 'schliessen', '⋯': 'mehr', '…': 'mehr',
  '👤': 'person', '🧑': 'person', '🎩': 'person', '🌙': 'mond', '☀': 'sonne', '🌞': 'sonne',
  '⚡': 'blitz', '⚠': 'warnung', '🚨': 'warnung', 'ℹ': 'info', '🔒': 'schloss', '🔐': 'schloss',
  '🖥': 'monitor', '💻': 'laptop', '🧪': 'terminal', '🎨': 'pinsel', '🖌': 'pinsel',
  '🛒': 'einkauf', '🎓': 'hut', '🚀': 'rakete', '🔥': 'flamme', '💥': 'flamme',
  '🔁': 'wiederholen', '🔄': 'wiederholen', '📋': 'liste', '🗺': 'karte', '☁': 'wolke',
  '❤': 'herz', '📤': 'teilen', '📥': 'herunterladen', '⬇': 'herunterladen', '📎': 'bueroklammer',
  '🎛': 'regler', '🖼': 'bild', '📷': 'bild', '🎤': 'mikro', '🎙': 'mikro',

  // E240 Ausbau
  '🏛': 'rathaus', '🧺': 'korb', '🍅': 'timer', '⏲': 'timer', '🕘': 'uhr',
  '🎯': 'ziel', '🧭': 'kompass', '⌘': 'befehl', '🌐': 'globus', '🌍': 'globus', '🌎': 'globus',
  '↻': 'neu_laden', '↺': 'rueckgaengig', '↶': 'rueckgaengig', '↷': 'wiederherstellen', '↩': 'eingabe', '⏎': 'eingabe',
  '🎉': 'konfetti', '🎆': 'konfetti', '↔': 'pfeile_lr', '⇄': 'pfeile_lr', '⇋': 'pfeile_lr', '⇔': 'pfeile_lr', '⇒': 'pfeil_rechts',
  '💭': 'gedanke', '⇧': 'umschalt', '👉': 'pfeil_rechts', '▸': 'pfeil_rechts', '▾': 'chevron_unten', '▴': 'chevron_oben',
  '▲': 'dreieck_oben', '▼': 'dreieck_unten', '🪶': 'feder',
  '●': 'punkt', '🔵': 'punkt_blau', '🟢': 'punkt_gruen', '🟠': 'punkt_orange', '🔴': 'punkt_rot', '🟡': 'punkt_orange',
  '○': 'kreis', '◯': 'kreis', '⚪': 'kreis', '🔘': 'kreis_punkt', '◐': 'halb',
  '☐': 'kaestchen', '▢': 'kaestchen', '□': 'kaestchen', '▫': 'kaestchen', '🟩': 'kaestchen', '☆': 'stern', '★': 'stern_voll',
  '🧩': 'puzzle', '↗': 'extern', '↑': 'pfeil_hoch', '⬆': 'pfeil_hoch', '↓': 'pfeil_runter',
  '🌿': 'blatt', '🌾': 'blatt', '🍃': 'blatt', '🌱': 'pflanze', '🪴': 'pflanze', '📶': 'signal',
  '🤖': 'roboter', '✂': 'schere', '⛶': 'vollbild', '⌫': 'loeschtaste',
  '🌸': 'blume', '🌷': 'blume', '🌺': 'blume', '🪷': 'blume', '🌼': 'blume', '🐝': 'blume',
  '📰': 'zeitung', '🗞': 'zeitung', '🧮': 'rechner', '👁': 'auge', '👀': 'auge', '🙈': 'auge_durch',
  '🪜': 'stufen', '📱': 'handy', '⌨': 'tastatur', '📍': 'ort', '📌': 'ort', '☰': 'menue',
  '🧹': 'besen', '🧽': 'besen', '🏁': 'flagge', '🚩': 'flagge', '💤': 'schlaf',
  '🔊': 'lautsprecher', '🔉': 'lautsprecher', '🔇': 'stumm', '🔕': 'glocke_durch',
  '😞': 'gesicht_1', '😢': 'gesicht_1', '😕': 'gesicht_2', '😐': 'gesicht_3', '🙂': 'gesicht_4', '😊': 'gesicht_4', '😄': 'gesicht_5', '😀': 'gesicht_5',
  '💡': 'gluehbirne', '⏭': 'vorspulen', '⏩': 'vorspulen', '👍': 'daumen', '💧': 'tropfen', '🪧': 'wegweiser', '🔌': 'stecker',
  '🌦': 'regen', '☔': 'regen', '🌧': 'regen', '🚧': 'baustelle', '📦': 'paket', '📇': 'karteikarte', '🃏': 'karteikarte', '❓': 'frage', '❔': 'frage',
  '🛑': 'stopp', '👛': 'tasche', '💼': 'aktenkoffer', '🩺': 'puls', '⚖': 'waage', '💸': 'geld',
  '🎬': 'film', '📽': 'film', '🗜': 'zusammen', '👥': 'personen', '🚶': 'person', '✥': 'bewegen',
  '⬚': 'auswahl', '▭': 'auswahl', '▤': 'auswahl', '🔳': 'auswahl', '➰': 'lasso', '🪣': 'eimer', '✋': 'hand', '👆': 'hand',
  '⇵': 'sortieren', '🛣': 'strasse', '🪨': 'stein', '🧱': 'ziegel', '🪑': 'stuhl', '⛲': 'brunnen', '🏮': 'laterne',
  '🪵': 'holz', '🍄': 'pilz', '🛖': 'haus', '⌂': 'haus', '📫': 'brief', '🔗': 'link', '💾': 'speichern', '☕': 'tasse',
  '🍎': 'laptop', '🪟': 'fenster', '🌅': 'sonnenaufgang', '💨': 'wind', '🎁': 'geschenk', '🌊': 'welle', '🚢': 'anker',
  '🐟': 'fisch', '🦈': 'fisch', '🐙': 'fisch', '🦀': 'fisch', '🐋': 'fisch', '🐡': 'fisch', '🦑': 'fisch', '🐬': 'fisch', '🐠': 'fisch',
  '🔮': 'zauberstab', '🪄': 'zauberstab', '🏖': 'sonne', '📕': 'buch', '📗': 'buch', '🌳': 'baum', '✗': 'schliessen', '✘': 'schliessen',
  '🧑‍💻': 'laptop', '🧾': 'dokument', '📃': 'dokument', '📑': 'dokument', '🗒': 'liste', '📜': 'dokument', '🖨': 'dokument',
  '🌡': 'puls', '🍺': 'tasse', '🥂': 'tasse', '🏃': 'person', '💪': 'blitz', '🌤': 'sonne', '⛅': 'wolke', '❄': 'wolke', '🌫': 'wolke',
  '▶': 'play', '⏸': 'pause', '⏹': 'stop', '🛡': 'schild', '✨': 'zauberstab', '🌲': 'baum',
};

export function symbolFuer(emoji: string): SymbolName | null {
  return EMOJI_SYMBOL[emoji.replace(/️/g, '').trim()] ?? null;
}
