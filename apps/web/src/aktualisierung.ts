/**
 * E179: Die App aktualisiert sich selbst – auch wenn sie nie neu geladen wird (PWA am Handy aus dem Hintergrund,
 * Programm-Fenster den ganzen Tag offen).
 * - Service Worker (autoUpdate: aktiviert neue Fassungen sofort) wird alle 30 min, beim Zurückkommen in den
 *   Vordergrund und nach jedem Wiederverbinden der Live-Verbindung (= Server neu gestartet, meist ein Deploy) geprüft.
 * - Zusätzlich vergleicht die App ihr eigenes Haupt-Skript mit dem aktuellen index.html des Servers – das greift auch
 *   dort, wo kein Service Worker läuft (Programm).
 * - Neue Fassung da: ist die App gerade im Hintergrund, lädt sie sofort neu; sonst erscheint ein Hinweis zum
 *   Neuladen, und sie lädt beim nächsten Wechsel in den Hintergrund neu – nie mitten im Tippen.
 */
const EREIGNIS = 'dorf:neue-version';
let bereit = false;

const eigeneSkripte = () =>
  [...document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')]
    .map((s) => new URL(s.src, location.href).pathname)
    .filter((p) => p.startsWith('/assets/'))
    .sort()
    .join('|');

function melden() {
  if (bereit) return;
  bereit = true;
  if (document.visibilityState === 'hidden') neuLaden();
  else window.dispatchEvent(new Event(EREIGNIS));
}

export const neueVersionDa = () => bereit;
export const aufNeueVersion = (f: () => void) => {
  window.addEventListener(EREIGNIS, f);
  return () => window.removeEventListener(EREIGNIS, f);
};

export function neuLaden() {
  location.reload();
}

/** Server fragen: liefert index.html ein anderes Haupt-Skript als das, mit dem diese Seite läuft? */
export async function versionPruefen() {
  try {
    void navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => undefined);
    const eigen = eigeneSkripte();
    if (!eigen) return; // Entwicklungsserver (kein gebautes Skript) – nichts zu vergleichen
    // ?v=… umgeht den Precache des Service Workers (nur exakte Adressen), no-store den HTTP-Zwischenspeicher
    const html = await (await fetch(`/index.html?v=${Date.now()}`, { cache: 'no-store', credentials: 'same-origin' })).text();
    const server = [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)]
      .map((m) => new URL(m[1]!, location.href).pathname)
      .filter((p) => p.startsWith('/assets/'))
      .sort()
      .join('|');
    if (server && server !== eigen) melden();
  } catch {
    /* offline – beim nächsten Mal */
  }
}

export function aktualisierungStarten() {
  if ('serviceWorker' in navigator && !import.meta.env.DEV) {
    let hatteController = !!navigator.serviceWorker.controller;
    // neue Fassung hat übernommen (autoUpdate: skipWaiting + clientsClaim) – beim ersten Einrichten nicht melden
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hatteController) melden();
      hatteController = true;
    });
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  }
  setInterval(() => void versionPruefen(), 30 * 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (bereit) neuLaden();
    } else void versionPruefen();
  });
}
