import { DorfFehler } from '../fehler.js';

/**
 * Klient für den Moodle-Browser (eigener Container mit Chromium). Der Container kennt Leifs JKU-Zugangsdaten,
 * das Dorf nicht. Die Leine (nur JKU-Domains, nur lesen) sitzt im Container selbst (apps/browser/src/leine.ts).
 */
export interface SeitenAuszug {
  url: string;
  titel: string;
  text: string;
  links: { nr: number; text: string; ziel: string | null; art: 'link' | 'knopf' }[];
  blockiert: string[];
}

export interface MoodleBrowserKlient {
  oeffnen(sitzung: string, url: string): Promise<SeitenAuszug>;
  klicken(sitzung: string, nr: number): Promise<SeitenAuszug>;
  seite(sitzung: string): Promise<SeitenAuszug>;
  zurueck(sitzung: string): Promise<SeitenAuszug>;
  bild(sitzung: string): Promise<string>; // JPEG, base64
  herunterladen(sitzung: string, nr: number): Promise<{ name: string; mime: string; daten: Buffer }>;
  schliessen(sitzung: string): Promise<void>;
  anmeldungPruefen(): Promise<{ ok: boolean; url: string; meldung: string }>;
}

export function moodleBrowserKlient(url: string, geheimnis: string): MoodleBrowserKlient {
  const basis = url.replace(/\/$/, '');
  async function post<T>(weg: string, daten: Record<string, unknown>, zeitMs = 120_000): Promise<T> {
    let r: Response;
    try {
      r = await fetch(`${basis}${weg}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${geheimnis}` },
        body: JSON.stringify(daten),
        signal: AbortSignal.timeout(zeitMs),
      });
    } catch (e) {
      throw new DorfFehler(503, `Moodle-Browser nicht erreichbar (${(e as Error).message}). Auf dem Server: dorf status`);
    }
    const j = (await r.json().catch(() => ({}))) as T & { ok?: boolean; fehler?: string };
    if (r.status === 401) throw new DorfFehler(503, 'Moodle-Browser lehnt ab (Geheimnis passt nicht) – dorf moodle-browser-zugang erneut ausführen.');
    if (!r.ok || j.ok === false) throw new DorfFehler(400, j.fehler ?? `Moodle-Browser: HTTP ${r.status}`);
    return j;
  }
  return {
    oeffnen: (sitzung, url) => post('/oeffnen', { sitzung, url }),
    klicken: (sitzung, nr) => post('/klicken', { sitzung, nr }),
    seite: (sitzung) => post('/seite', { sitzung }),
    zurueck: (sitzung) => post('/zurueck', { sitzung }),
    async bild(sitzung) {
      return (await post<{ bild: string }>('/bild', { sitzung })).bild;
    },
    async herunterladen(sitzung, nr) {
      const r = await post<{ name: string; mime: string; daten: string }>('/herunterladen', { sitzung, nr }, 180_000);
      return { name: r.name, mime: r.mime, daten: Buffer.from(r.daten, 'base64') };
    },
    async schliessen(sitzung) {
      await post('/schliessen', { sitzung }, 10_000).catch(() => undefined);
    },
    async anmeldungPruefen() {
      const r = await fetch(`${basis}/anmeldung-pruefen`, { method: 'POST', headers: { authorization: `Bearer ${geheimnis}` }, signal: AbortSignal.timeout(120_000) }).catch((e: Error) => {
        throw new DorfFehler(503, `Moodle-Browser nicht erreichbar (${e.message}).`);
      });
      return (await r.json()) as { ok: boolean; url: string; meldung: string };
    },
  };
}

/** Seitenauszug als Text fürs Modell (die Hülle legt werkzeuge.ts drum) */
export function auszugText(a: SeitenAuszug) {
  const kurz = (z: string | null) => {
    if (!z) return '';
    try {
      const u = new URL(z);
      return ` → ${u.pathname}${u.search}`.slice(0, 140);
    } catch {
      return '';
    }
  };
  const links = a.links.map((l) => `[${l.nr}] ${l.art === 'knopf' ? '(Knopf) ' : ''}${l.text}${kurz(l.ziel)}`).join('\n');
  const blockiert = a.blockiert.length ? `\n\nVon der Leine abgefangen (der Browser liest nur):\n${a.blockiert.slice(0, 10).map((b) => `- ${b}`).join('\n')}` : '';
  return `Seite: ${a.titel}\nAdresse: ${a.url}\n\n${a.text}\n\nLinks und Knöpfe (Nummer für moodle_klicken / moodle_herunterladen):\n${links || '(keine)'}${blockiert}`;
}
