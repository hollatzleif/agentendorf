/** Kleiner Wrapper um fetch: JSON hin und zurück, Fehlermeldungen des Servers als Error. */
export class ApiFehler extends Error {
  constructor(
    public status: number,
    message: string,
    public daten: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function api<T>(url: string, opt: { methode?: string; body?: unknown; formular?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (opt.formular) body = opt.formular;
  else if (opt.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opt.body);
  }
  const methode = opt.methode ?? (body ? 'POST' : 'GET');
  let r: Response;
  try {
    r = await fetch(url, { method: methode, headers, body, credentials: 'same-origin' });
  } catch (e) {
    // Offline: Neues (To-do, Listeneintrag, Notiz) merken und später senden – nichts geht verloren
    if (methode === 'POST' && !opt.formular && offlineErlaubt(url)) {
      offlineMerken(url, opt.body);
      throw new ApiFehler(0, 'Keine Verbindung – gemerkt, wird gesendet, sobald du wieder online bist.', { offline: true });
    }
    throw e;
  }
  const text = await r.text();
  const daten = text ? JSON.parse(text) : {};
  if (!r.ok) {
    if (r.status === 401 && !url.startsWith('/api/anmeldung') && url !== '/api/ich') window.dispatchEvent(new Event('dorf:abgemeldet'));
    throw new ApiFehler(r.status, daten.fehler ?? `Fehler ${r.status}`, daten);
  }
  return daten as T;
}

/** Offline gemerkt (kein echter Fehler: das Feld darf geleert werden) */
export const offlineGemerkt = (e: unknown) => e instanceof ApiFehler && e.daten.offline === true;

export const rohUrl = (pfad: string, download = false) =>
  `/api/vault/roh?pfad=${encodeURIComponent(pfad)}${download ? '&download=1' : ''}`;

// ---- Offline-Warteschlange (Nacht 18./19.11., nach Review abgesichert) -------------------------------
/** Nur Anlegen ist offline sinnvoll und harmlos, wenn es später ankommt (kein Löschen, kein Abhaken) */
const OFFLINE_ERLAUBT = [/^\/api\/todos$/, /^\/api\/listen\/[a-z]+$/, /^\/api\/notiz$/];
export const offlineErlaubt = (url: string) => OFFLINE_ERLAUBT.some((r) => r.test(url));
const SCHLANGE = 'dorf-offline-schlange';
export type OfflineEintrag = { id: string; url: string; body: unknown; zeit: number };
export const offlineSchlange = (): OfflineEintrag[] => {
  try {
    return (JSON.parse(localStorage.getItem(SCHLANGE) ?? '[]') as OfflineEintrag[]).map((e, i) => ({ ...e, id: e.id ?? `alt-${e.zeit}-${i}` }));
  } catch {
    return [];
  }
};
function schlangeSchreiben(s: OfflineEintrag[]) {
  localStorage.setItem(SCHLANGE, JSON.stringify(s));
  window.dispatchEvent(new Event('dorf:offline-schlange'));
}
function offlineMerken(url: string, body: unknown) {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  schlangeSchreiben([...offlineSchlange(), { id, url, body, zeit: Date.now() }].slice(-50));
}
/** 4xx, bei denen ein erneuter Versuch nichts ändert (ungültig, gibt es nicht, Konflikt, zu groß) */
const VERWERFEN = new Set([400, 404, 409, 413, 422]);
let laufend: Promise<number> | null = null;

/**
 * Alles Gemerkte senden – nie zweimal gleichzeitig (auch nicht aus zwei Tabs: Web Locks, wo vorhanden).
 * Entfernt am Ende nur, was gesendet oder verworfen wurde; neu Gemerktes bleibt. Gibt die Zahl der gesendeten zurück.
 */
export function offlineSenden(): Promise<number> {
  if (laufend) return laufend;
  const arbeit = async () => {
    const s = offlineSchlange();
    if (!s.length) return 0;
    const fertig = new Set<string>();
    let n = 0;
    for (const e of s) {
      try {
        // Notizen: ursprüngliche Uhrzeit mitgeben (sonst landet 23:50 als 07:00 im nächsten Tag)
        const body = e.url === '/api/notiz' && e.body && typeof e.body === 'object' ? { ...(e.body as object), zeit: e.zeit } : e.body;
        const r = await fetch(e.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
        if (r.ok) {
          n++;
          fertig.add(e.id);
        } else if (r.status === 401) {
          // abgemeldet: behalten und zur Anmeldung – nach dem Anmelden geht es weiter
          window.dispatchEvent(new Event('dorf:abgemeldet'));
          break;
        } else if (VERWERFEN.has(r.status)) fertig.add(e.id);
        // 403, 408, 429, 5xx: behalten, später nochmal
      } catch {
        break; // wieder offline
      }
    }
    // frisch lesen: was inzwischen dazugekommen ist, bleibt
    schlangeSchreiben(offlineSchlange().filter((e) => !fertig.has(e.id)));
    return n;
  };
  const sperre = typeof navigator !== 'undefined' && 'locks' in navigator ? (navigator as Navigator & { locks: { request: <T>(n: string, f: () => Promise<T>) => Promise<T> } }).locks : null;
  laufend = (sperre ? sperre.request('dorf-offline', arbeit) : arbeit()).finally(() => {
    laufend = null;
  });
  return laufend;
}
