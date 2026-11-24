import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DorfFehler } from './fehler.js';
import type { Konfig } from './konfig.js';

/**
 * E230 – Paketwerk: Leif installiert selbst Python-Pakete für den Rechenraum (z. B. `pip install scikit-learn==1.9.1`).
 *
 * - Ausgeführt wird im Container „paketwerk“ (gleiches Image wie der Rechenraum, Modus paketwerk, Internet über
 *   „paketnetz“). Er kann nur in /pakete schreiben (pip --user, PYTHONUSERBASE) und /tmp; kein Vault, keine Geheimnisse
 *   außer dem Rechenraum-Geheimnis, mit dem das Dorf ihn ruft.
 * - Der Rechenraum bindet /pakete NUR LESEND ein und hängt es an Python an – er selbst bleibt ohne Internet.
 * - Nur Leif führt aus (Sitzung + Origin über den allgemeinen Schutz in app.ts, E203). Agenten bekommen KEIN Werkzeug
 *   dafür: Sie schlagen Befehle vor (Link /paketwerk?befehl=…), die App setzt ihn nur in die Zeile.
 */
export interface PaketwerkKlient {
  starten(befehl: string): Promise<{ id: string }>;
  stand(id: string, ab: number): Promise<PaketwerkStand>;
  abbrechen(id: string): Promise<{ ok: boolean }>;
  pakete(): Promise<{ name: string; version: string }[]>;
}

export interface PaketwerkStand {
  ausgabe: string;
  bis: number;
  fertig: boolean;
  code: number | null;
  sekunden: number;
}

/** so viel einer Antwort des Paketwerks wird höchstens gelesen (Puffer im Runner: 256 KB) */
const ANTWORT_MAX = 2 * 1024 * 1024;

export function paketwerkKlient(url: string, geheimnis: string, holen: typeof fetch = fetch): PaketwerkKlient {
  const basis = url.replace(/\/$/, '');
  async function post<T>(weg: string, daten: Record<string, unknown>, zeitMs = 20_000): Promise<T> {
    let r: Response;
    try {
      r = await holen(`${basis}${weg}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-rechenraum-geheimnis': geheimnis },
        body: JSON.stringify(daten),
        signal: AbortSignal.timeout(zeitMs),
      });
    } catch (e) {
      throw new DorfFehler(503, `Paketwerk nicht erreichbar (${(e as Error).message}). Auf dem Server: dorf status`);
    }
    const text = await r.text();
    if (text.length > ANTWORT_MAX) throw new DorfFehler(502, 'Antwort des Paketwerks zu groß.');
    let j = {} as T & { fehler?: string };
    try {
      j = JSON.parse(text) as T & { fehler?: string };
    } catch {
      /* kein JSON – unten zählt der Status */
    }
    if (!r.ok) throw new DorfFehler(r.status === 401 ? 503 : r.status === 409 || r.status === 404 ? r.status : 400, j.fehler ?? `Paketwerk: HTTP ${r.status}`);
    return j;
  }
  return {
    starten: (befehl) => post('/konsole/start', { befehl }),
    async stand(id, ab) {
      const s = await post<PaketwerkStand>('/konsole/stand', { id, ab });
      return { ausgabe: String(s.ausgabe ?? ''), bis: Number(s.bis) || 0, fertig: !!s.fertig, code: typeof s.code === 'number' ? s.code : null, sekunden: Number(s.sekunden) || 0 };
    },
    abbrechen: (id) => post('/konsole/abbrechen', { id }),
    async pakete() {
      const r = await post<{ pakete?: unknown[] }>('/konsole/pakete', {}, 70_000);
      return (Array.isArray(r.pakete) ? r.pakete : [])
        .map((p) => p as { name?: unknown; version?: unknown })
        .filter((p) => typeof p.name === 'string' && typeof p.version === 'string')
        .map((p) => ({ name: p.name as string, version: p.version as string }));
    },
  };
}

const StartSchema = z.object({ befehl: z.string().trim().min(1, 'Befehl fehlt.').max(4000, 'Befehl zu lang (höchstens 4000 Zeichen).') });
const IdSchema = z.string().regex(/^[0-9a-f]{16}$/, 'Unbekannter Befehl.');

export function paketwerkRouten(app: FastifyInstance, o: { konfig: Konfig; klient?: PaketwerkKlient }) {
  const klient = o.klient ?? (o.konfig.rechenraumGeheimnis ? paketwerkKlient(o.konfig.paketwerkUrl, o.konfig.rechenraumGeheimnis) : undefined);
  const brauchen = () => {
    if (!klient) throw new DorfFehler(503, 'Das Paketwerk ist nicht eingerichtet (RECHENRAUM_GEHEIMNIS fehlt).');
    return klient;
  };

  app.get('/api/paketwerk', async () => {
    if (!klient) return { eingerichtet: false, pakete: [], fehler: 'Das Paketwerk ist nicht eingerichtet (RECHENRAUM_GEHEIMNIS fehlt).' };
    try {
      return { eingerichtet: true, pakete: await klient.pakete() };
    } catch (e) {
      return { eingerichtet: false, pakete: [], fehler: (e as Error).message };
    }
  });

  app.post('/api/paketwerk/start', async (req) => {
    const { befehl } = StartSchema.parse(req.body);
    return brauchen().starten(befehl);
  });

  app.get('/api/paketwerk/stand', async (req) => {
    const q = z.object({ id: IdSchema, ab: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    return brauchen().stand(q.id, q.ab);
  });

  app.post('/api/paketwerk/abbrechen', async (req) => {
    const { id } = z.object({ id: IdSchema }).parse(req.body);
    return brauchen().abbrechen(id);
  });
}
