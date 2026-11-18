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

export const rohUrl = (pfad: string, download = false) =>
  `/api/vault/roh?pfad=${encodeURIComponent(pfad)}${download ? '&download=1' : ''}`;

// ---- Offline-Warteschlange (Nacht 18./19.11.) ------------------------------------------------------
/** Nur Anlegen ist offline sinnvoll und harmlos, wenn es später ankommt (kein Löschen, kein Abhaken) */
const OFFLINE_ERLAUBT = [/^\/api\/todos$/, /^\/api\/listen\/[a-z]+$/, /^\/api\/notiz$/];
export const offlineErlaubt = (url: string) => OFFLINE_ERLAUBT.some((r) => r.test(url));
const SCHLANGE = 'dorf-offline-schlange';
export type OfflineEintrag = { url: string; body: unknown; zeit: number };
export const offlineSchlange = (): OfflineEintrag[] => {
  try {
    return JSON.parse(localStorage.getItem(SCHLANGE) ?? '[]') as OfflineEintrag[];
  } catch {
    return [];
  }
};
function offlineMerken(url: string, body: unknown) {
  const s = [...offlineSchlange(), { url, body, zeit: Date.now() }].slice(-50);
  localStorage.setItem(SCHLANGE, JSON.stringify(s));
  window.dispatchEvent(new Event('dorf:offline-schlange'));
}
/** Alles Gemerkte senden; was wieder an der Verbindung scheitert, bleibt. Gibt die Zahl der gesendeten zurück. */
export async function offlineSenden(): Promise<number> {
  const s = offlineSchlange();
  if (!s.length) return 0;
  const rest: OfflineEintrag[] = [];
  let n = 0;
  for (const e of s) {
    try {
      const r = await fetch(e.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(e.body), credentials: 'same-origin' });
      if (r.ok) n++;
      else if (r.status >= 500) rest.push(e); // Server kurz weg – später nochmal; 4xx (ungültig) verwerfen
    } catch {
      rest.push(e);
    }
  }
  localStorage.setItem(SCHLANGE, JSON.stringify(rest));
  window.dispatchEvent(new Event('dorf:offline-schlange'));
  return n;
}
