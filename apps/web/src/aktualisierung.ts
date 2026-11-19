/**
 * Updates von Hand (Leif, 19.11. – ersetzt die automatische Prüfung aus E179): Leif weiß, wann er deployt hat,
 * und drückt in den Einstellungen „Nach Update suchen“. Kein Prüfen im Hintergrund, kein Neuladen von selbst.
 * - Der Service Worker bleibt (Offline, PWA); er wird nur beim Knopfdruck auf eine neue Fassung geprüft.
 * - Verglichen wird das eigene Haupt-Skript mit dem aktuellen index.html des Servers – das greift auch dort,
 *   wo kein Service Worker läuft (Programm).
 */
const eigeneSkripte = () =>
  [...document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')]
    .map((s) => new URL(s.src, location.href).pathname)
    .filter((p) => p.startsWith('/assets/'))
    .sort()
    .join('|');

export type UpdateErgebnis = 'neu' | 'aktuell' | 'offline' | 'entwicklung';

/** Fragt den Server, ob es eine neue Fassung gibt. */
export async function updateSuchen(): Promise<UpdateErgebnis> {
  const eigen = eigeneSkripte();
  if (!eigen) return 'entwicklung'; // Entwicklungsserver (kein gebautes Skript) – nichts zu vergleichen
  try {
    // ?v=… umgeht den Precache des Service Workers (nur exakte Adressen), no-store den HTTP-Zwischenspeicher
    const html = await (await fetch(`/index.html?v=${Date.now()}`, { cache: 'no-store', credentials: 'same-origin' })).text();
    const server = [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)]
      .map((m) => new URL(m[1]!, location.href).pathname)
      .filter((p) => p.startsWith('/assets/'))
      .sort()
      .join('|');
    if (!server) return 'offline';
    return server !== eigen ? 'neu' : 'aktuell';
  } catch {
    return 'offline';
  }
}

/** Neue Fassung holen: Service Worker aktualisieren (neue Fassung übernimmt sofort), sonst ohne ihn neu laden. */
export async function updateInstallieren() {
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
  if (reg) {
    const uebernommen = new Promise<void>((ok) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => ok(), { once: true });
      setTimeout(ok, 8000);
    });
    try {
      await reg.update();
      if (reg.installing || reg.waiting) await uebernommen;
      else await reg.unregister(); // keine neue Fassung im Service Worker gefunden → ohne ihn frisch vom Server laden
    } catch {
      await reg.unregister().catch(() => undefined);
    }
  }
  location.reload();
}

export function aktualisierungStarten() {
  if ('serviceWorker' in navigator && !import.meta.env.DEV) void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
}
