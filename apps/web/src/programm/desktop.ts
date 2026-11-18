/**
 * Brücke zum Desktop-Programm (Etappe 6, Tauri). Im Browser/als PWA tut sie nichts.
 * Das Programm erlaubt dieser Seite nur ein paar eigene Befehle (Meldung zeigen, Zähler setzen, Schnelleingabe
 * schließen) – keine Dateien, keine Systembefehle. Die Befehle prüft das Programm selbst noch einmal.
 */
type Aufruf = (befehl: string, args?: Record<string, unknown>) => Promise<unknown>;

function aufruf(): Aufruf | null {
  const t = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: Aufruf } }).__TAURI_INTERNALS__;
  return typeof t?.invoke === 'function' ? t.invoke.bind(t) : null;
}

/** Läuft die Seite im Desktop-Programm? */
export const istProgramm = () => aufruf() !== null;

async function befehl(name: string, args?: Record<string, unknown>) {
  const f = aufruf();
  if (!f) return;
  try {
    await f(name, args);
  } catch {
    // ältere Programmversion ohne diesen Befehl – egal
  }
}

/** Systemmeldung (nur sinnvoll, wenn das Fenster nicht im Vordergrund ist) */
export const melden = (titel: string, text: string) => befehl('melden', { titel: titel.slice(0, 120), text: text.slice(0, 400) });
/** Zahl offener Freigaben fürs Symbol in der Leiste */
export const zaehlerSetzen = (anzahl: number) => befehl('zaehler_setzen', { anzahl: Math.max(0, Math.min(999, Math.round(anzahl))) });
/** Schnelleingabe-Fenster ausblenden */
export const schnellSchliessen = () => befehl('schnell_schliessen');
/** E74: Kirchturm-Glocke (nur im Programm hörbar): „schlag“ oder „gelaeut“, 1–20 Mal */
export const glocke = (art: 'schlag' | 'gelaeut', mal = 1) => befehl('glocke', { art, mal: Math.max(1, Math.min(20, Math.round(mal))) });
/** Glocke sofort verstummen lassen */
export const glockeStopp = () => befehl('glocke_stopp');
