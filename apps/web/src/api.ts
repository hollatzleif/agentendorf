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
  const r = await fetch(url, { method: opt.methode ?? (body ? 'POST' : 'GET'), headers, body, credentials: 'same-origin' });
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
