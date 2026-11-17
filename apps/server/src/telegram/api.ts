/** Schmale Schnittstelle zur Telegram-Bot-API (nur fetch, keine Bibliothek). */
export interface TelegramSchnittstelle {
  aufruf<T = unknown>(methode: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<T>;
  dateiLaden(fileId: string): Promise<{ name: string; inhalt: Buffer }>;
}

export class TelegramFehler extends Error {
  constructor(
    public methode: string,
    public code: number | undefined,
    beschreibung: string,
  ) {
    super(`Telegram ${methode}: ${beschreibung}`);
  }
}

export const MAX_DATEI = 20 * 1024 * 1024; // Grenze der Bot-API für getFile

export function telegramApi(token: string, basis = 'https://api.telegram.org'): TelegramSchnittstelle {
  const url = (m: string) => `${basis}/bot${token}/${m}`;
  return {
    async aufruf<T>(methode: string, params: Record<string, unknown> = {}, signal?: AbortSignal) {
      const r = await fetch(url(methode), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal: signal ?? AbortSignal.timeout(70_000),
      });
      const j = (await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }))) as { ok: boolean; result?: T; description?: string; error_code?: number };
      if (!j.ok) throw new TelegramFehler(methode, j.error_code ?? r.status, j.description ?? 'unbekannter Fehler');
      return j.result as T;
    },
    async dateiLaden(fileId: string) {
      const f = await this.aufruf<{ file_path?: string; file_size?: number }>('getFile', { file_id: fileId });
      if (!f.file_path) throw new TelegramFehler('getFile', undefined, 'Datei nicht verfügbar');
      if ((f.file_size ?? 0) > MAX_DATEI) throw new TelegramFehler('getFile', undefined, 'Datei größer als 20 MB');
      const r = await fetch(`${basis}/file/bot${token}/${f.file_path}`, { signal: AbortSignal.timeout(120_000) });
      if (!r.ok) throw new TelegramFehler('download', r.status, `HTTP ${r.status}`);
      return { name: f.file_path.split('/').pop() ?? 'datei', inhalt: Buffer.from(await r.arrayBuffer()) };
    },
  };
}
