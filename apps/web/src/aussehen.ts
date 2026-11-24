import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AUSSEHEN_STANDARD, FARB_ROLLEN, VORLAGE_FARBEN, VORLAGE_STIL, type AussehenT, type FarbRolle } from '@dorf/shared';
import { api } from './api';

/**
 * E224 – Aussehen anwenden: CSS-Variablen + data-Attribute an <html>, eigenes CSS als <style>. Der letzte Stand liegt
 * im Gerät (localStorage), damit die App schon vor der ersten Antwort des Servers richtig aussieht.
 */
const SPEICHER = 'dorf-aussehen';

export const SCHRIFT_STAPEL: Record<AussehenT['schrift'], string> = {
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  rund: "ui-rounded, 'SF Pro Rounded', 'Nunito', 'Varela Round', 'Arial Rounded MT Bold', system-ui, sans-serif",
  serif: "ui-serif, 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, 'Liberation Mono', monospace",
  schmal: "'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', 'Liberation Sans Narrow', sans-serif",
  lesbar: "'Atkinson Hyperlegible', Verdana, Tahoma, 'DejaVu Sans', sans-serif",
  handschrift: "'Comic Neue', 'Comic Sans MS', 'Chalkboard SE', 'Segoe Print', cursive",
};

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const zuHex = (r: number[]) => `#${r.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')}`;
/** a mit Anteil t von b gemischt */
export const mischen = (a: string, b: string, t: number) => {
  const x = hex(a);
  const y = hex(b);
  return zuHex(x.map((v, i) => v + (y[i]! - v) * t));
};
const hell = (h: string) => {
  const [r, g, b] = hex(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** Schrift auf dieser Farbe: weiß oder fast schwarz – was mehr Kontrast hat */
export const aufFarbe = (h: string) => ((1.05) / (hell(h) + 0.05) >= (hell(h) + 0.05) / 0.06 ? '#ffffff' : '#141414');

/** Vorlage + eigene Einstellungen → wirksames Aussehen (Stil der Vorlage, wo nichts Eigenes gesetzt ist) */
export function wirksam(a: AussehenT): AussehenT {
  const stil = VORLAGE_STIL[a.vorlage] ?? {};
  const r = { ...a } as Record<string, unknown>;
  for (const [k, v] of Object.entries(stil)) if (r[k] === (AUSSEHEN_STANDARD as unknown as Record<string, unknown>)[k]) r[k] = v;
  return r as unknown as AussehenT;
}

export function farbenVon(a: AussehenT): Record<FarbRolle, string> & { dunkel?: boolean } {
  return { ...VORLAGE_FARBEN[a.vorlage], ...a.farben };
}

/** CSS-Variablen aus den Farben (abgeleitete Töne werden gemischt) */
export function variablen(a: AussehenT): Record<string, string> {
  const f = farbenVon(a);
  const dunkel = !!f.dunkel || hell(f.flaeche) < 0.2;
  const schwarz = '#000000';
  const weiss = '#ffffff';
  const tiefer = (c: string, t: number) => mischen(c, dunkel ? weiss : schwarz, t);
  return {
    '--gruen': f.akzent,
    '--gruen-2': mischen(f.akzent, weiss, 0.12),
    '--gruen-dunkel': mischen(f.akzent, schwarz, dunkel ? 0.55 : 0.45),
    '--akzent-hell': mischen(f.akzent, weiss, 0.38),
    '--gruen-hell': mischen(f.flaeche, f.akzent, dunkel ? 0.22 : 0.14),
    '--gruen-rand': mischen(f.flaeche, f.akzent, 0.45),
    '--auf-akzent': aufFarbe(f.akzent),
    '--grund': f.grund,
    '--himmel': f.himmel,
    '--karte': f.karte,
    '--flaeche': f.flaeche,
    '--flaeche-2': mischen(f.flaeche, f.text, dunkel ? 0.1 : 0.06),
    '--text': f.text,
    '--leise': f.leise,
    '--navy': f.rand,
    '--navy-dunkel': mischen(f.rand, schwarz, 0.35),
    '--rand': f.linie,
    '--rot': f.minus,
    '--rot-dunkel': tiefer(f.minus, 0.3),
    '--rot-hell': mischen(f.flaeche, f.minus, dunkel ? 0.22 : 0.12),
    '--dach': f.warnung,
    '--dach-dunkel': tiefer(f.warnung, 0.4),
    '--gelb-hell': mischen(f.flaeche, f.warnung, dunkel ? 0.2 : 0.14),
    '--kopf': f.kopf,
    '--kopf-2': mischen(f.kopf, hell(f.kopf) > 0.6 ? f.kopf : weiss, 0.12),
    '--kopf-text': aufFarbe(f.kopf),
    '--schatten': `0 4px 0 ${f.rand}, 0 9px 20px rgb(0 0 0 / ${dunkel ? 0.35 : 0.16})`,
  };
}

let gesetzt: string[] = [];

const SCHNELL = 'dorf-dunkel-jetzt';
/** E224: Schnellschalter 🌙/☀️ in der Kopfleiste – nur dieses Gerät, bis man ihn wieder auf „automatisch“ stellt */
export function schnellDunkelUmschalten() {
  const jetzt = document.documentElement.dataset.dunkel === 'ja';
  localStorage.setItem(SCHNELL, jetzt ? 'aus' : 'an');
  if (zuletzt) aussehenAnwenden(zuletzt);
}
export function schnellDunkelZuruecksetzen() {
  localStorage.removeItem(SCHNELL);
  if (zuletzt) aussehenAnwenden(zuletzt);
}

/** automatisch dunkel? (System-Dunkelmodus oder 20–7 Uhr) */
export function jetztDunkel(a: AussehenT) {
  if (a.dunkelAuto === 'system') return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  if (a.dunkelAuto === 'nachts') {
    const h = new Date().getHours();
    return h >= 20 || h < 7;
  }
  return false;
}

let zuletzt: AussehenT | null = null;
let beobachtet = false;
function beobachten() {
  if (beobachtet) return;
  beobachtet = true;
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => zuletzt && aussehenAnwenden(zuletzt));
  window.setInterval(() => zuletzt && zuletzt.dunkelAuto === 'nachts' && aussehenAnwenden(zuletzt), 5 * 60_000);
}

export function aussehenAnwenden(rohEingabe: AussehenT) {
  zuletzt = rohEingabe;
  beobachten();
  const voll = { ...AUSSEHEN_STANDARD, ...rohEingabe };
  // Schnellschalter in der Kopfleiste (dieses Gerät) geht vor; sonst automatisch dunkel nach Einstellung
  const schnell = localStorage.getItem(SCHNELL);
  const vorlageDunkel = !!VORLAGE_FARBEN[voll.vorlage].dunkel;
  const dunkelWunsch = schnell === 'an' ? true : schnell === 'aus' ? false : jetztDunkel(voll) || vorlageDunkel;
  // dunkel gewünscht, Vorlage hell → die dunkle Vorlage (eigene Farben gelten dann nicht); hell gewünscht, Vorlage dunkel → Spiel-Look
  const roh = dunkelWunsch && !vorlageDunkel ? { ...voll, vorlage: voll.dunkelVorlage, farben: {} } : !dunkelWunsch && vorlageDunkel ? { ...voll, vorlage: 'spiel' as const, farben: {} } : voll;
  const a = wirksam(roh);
  const html = document.documentElement;
  for (const k of gesetzt) html.style.removeProperty(k);
  gesetzt = [];
  const setzen = (k: string, v: string) => {
    html.style.setProperty(k, v);
    gesetzt.push(k);
  };
  // Spiel-Look ohne eigene Farben = genau die Werte aus stil.css (nichts überschreiben)
  if (a.vorlage !== 'spiel' || Object.keys(a.farben).length) for (const [k, v] of Object.entries(variablen(a))) setzen(k, v);
  const f = farbenVon(a);
  setzen('--groesse', `${a.groesse}px`);
  html.style.lineHeight = String(a.zeilenhoehe);
  setzen('--schrift', SCHRIFT_STAPEL[a.schrift]);
  setzen('--schrift-titel', a.schriftTitel === 'wie-text' ? 'var(--schrift)' : SCHRIFT_STAPEL[a.schriftTitel]);
  setzen('--titel-gewicht', a.titelGewicht === 'normal' ? '600' : a.titelGewicht === 'fett' ? '800' : '900');
  setzen('--radius', `${a.ecken}px`);
  setzen('--breite', { schmal: '880px', normal: '1200px', breit: '1560px', voll: '100%' }[a.breite]);
  if (a.fokusRing === 'akzent') setzen('--fokus', f.akzent);
  const d = html.dataset;
  d.dunkel = f.dunkel || hell(f.flaeche) < 0.2 ? 'ja' : 'nein';
  d.schatten = a.schatten;
  d.rahmen = a.rahmen;
  d.knoepfe = a.knoepfe;
  d.dichte = a.dichte;
  d.hintergrund = a.hintergrund;
  d.animationen = a.animationen;
  d.tabellen = a.tabellen;
  d.kopfleiste = a.kopfleiste;
  d.fokus = a.fokusRing;
  d.navigation = a.navigation;
  d.buchstaben = a.buchstaben;
  d.karten = a.karten;
  d.ecken = a.ecken === AUSSEHEN_STANDARD.ecken ? 'standard' : 'eigen';
  // eigenes CSS
  let stil = document.getElementById('dorf-eigenes-css') as HTMLStyleElement | null;
  if (a.css.trim()) {
    if (!stil) {
      stil = document.createElement('style');
      stil.id = 'dorf-eigenes-css';
      document.head.appendChild(stil);
    }
    stil.textContent = a.css;
  } else stil?.remove();
  // Farbe der Browserleiste (Handy)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', f.kopf);
}

/** gespeichertes Aussehen sofort anwenden (main.tsx, vor dem ersten Zeichnen) */
export function aussehenAusSpeicher() {
  try {
    const g = geraetAussehen();
    const roh = localStorage.getItem(SPEICHER);
    if (g) aussehenAnwenden(g);
    else if (roh) aussehenAnwenden(JSON.parse(roh) as AussehenT);
  } catch {
    /* kaputt → Standard aus stil.css */
  }
}

/** E224: eigenes Aussehen nur für dieses Gerät (geht dem gemeinsamen vor) */
const GERAET = 'dorf-aussehen-geraet';
export function geraetAussehen(): AussehenT | null {
  try {
    const r = localStorage.getItem(GERAET);
    return r ? ({ ...AUSSEHEN_STANDARD, ...(JSON.parse(r) as Partial<AussehenT>) } as AussehenT) : null;
  } catch {
    return null;
  }
}
export function geraetAussehenSetzen(a: AussehenT | null) {
  if (a) localStorage.setItem(GERAET, JSON.stringify(a));
  else localStorage.removeItem(GERAET);
}

export function aussehenMerken(a: AussehenT) {
  localStorage.setItem(SPEICHER, JSON.stringify(a));
  // Anzeigeart „Startseite“ wirkt über die bisherigen Gerät-Schalter
  if (a.startseite === 'heute') localStorage.setItem('dorf-start', 'heute');
  else localStorage.removeItem('dorf-start');
  if (a.startseite === 'liste') localStorage.setItem('dorf-ansicht', 'liste');
  else if (a.startseite === 'dorf' && localStorage.getItem('dorf-ansicht') === 'liste') localStorage.setItem('dorf-ansicht', 'dorf');
}

/** in der App: Aussehen vom Server holen und anwenden (Live-Ereignis aussehen.geaendert lädt neu) */
export function useAussehen(angemeldet: boolean) {
  const q = useQuery({ queryKey: ['aussehen'], queryFn: () => api<AussehenT>('/api/aussehen'), enabled: angemeldet, staleTime: 60_000 });
  useEffect(() => {
    if (!q.data) return;
    // nicht überschreiben, solange Leif in Einstellungen → Aussehen eine Vorschau ansieht
    if (document.documentElement.dataset.vorschau === 'ja') return;
    const alt = localStorage.getItem(SPEICHER);
    const neu = JSON.stringify(q.data);
    if (alt !== neu) aussehenMerken(q.data);
    aussehenAnwenden(geraetAussehen() ?? q.data);
  }, [q.data]);
  return q.data;
}

export { FARB_ROLLEN };
