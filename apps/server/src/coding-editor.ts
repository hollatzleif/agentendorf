import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { TerminalMeldung } from '@dorf/shared';
import type { Sitzungen } from './auth/sitzungen.js';
import { DorfFehler } from './fehler.js';
import type { Konfig } from './konfig.js';
import { PROJEKT_MUSTER } from './agenten/motor-claude-code.js';

/**
 * Editor im Codehaus (E197): Dateien, Suche, Git und Terminal des Coding-Containers direkt in der Dorf-App.
 *
 * Das Dorf ist hier nur Türsteher und Durchreiche: Es prüft Sitzung und Herkunft (der allgemeine Schutz in app.ts –
 * diese Routen stehen in keiner Ausnahmeliste), prüft Projektname und Pfad und reicht an den Runner im Coding-Container
 * weiter (Profil coding, mit dem Runner-Geheimnis). Der Runner prüft alles noch einmal und folgt nie Symlinks
 * (apps/werkstatt/src/editor.ts). Der Browser spricht nie selbst mit dem Container und kennt kein Geheimnis.
 *
 * Terminal: WebSocket Browser ↔ Dorf (Sitzung + Origin wie /api/live), Dorf ↔ Runner über HTTP (Ausgabe = Antwortstrom,
 * Eingabe = kleine POSTs in fester Reihenfolge), Runner ↔ Shell am PTY. Endet die Sitzung (Abmelden), kappt das Dorf
 * die Terminals dieser Sitzung – der Runner beendet dann die Shell.
 */

export const EDITOR_TEXT_MAX = 2 * 1024 * 1024;
export const EDITOR_HOCHLADEN_MAX = 20 * 1024 * 1024;
const TERMINALS_JE_SITZUNG = 8;

/** Relativer Pfad im Projekt – dieselben Regeln wie im Runner (dort wird noch einmal geprüft). */
export function editorPfadOk(pfad: string, leerErlaubt = false): boolean {
  if (pfad === '') return leerErlaubt;
  // eslint-disable-next-line no-control-regex
  if (pfad.length > 1000 || /[\u0000-\u001f\u007f\\]/.test(pfad) || pfad.startsWith('/')) return false;
  return pfad.split('/').every((t) => t !== '' && t !== '.' && t !== '..' && t !== '.git' && t.length <= 255);
}
const PFAD_MELDUNG = 'Ungültiger Pfad: nur Pfade innerhalb des Projekts (kein „..“, kein absoluter Pfad, nicht .git).';
const projekt = z.string().regex(PROJEKT_MUSTER, 'Ungültiger Projektname.');
const pfad = z.string().refine((p) => editorPfadOk(p), PFAD_MELDUNG);
const pfadOderWurzel = z.string().refine((p) => editorPfadOk(p, true), PFAD_MELDUNG);

const GIT = z.discriminatedUnion('befehl', [
  z.object({ befehl: z.enum(['status', 'init', 'push', 'pull', 'holen', 'branches', 'verlauf']) }),
  z.object({ befehl: z.enum(['original', 'vormerken', 'zuruecknehmen', 'verwerfen']), pfad }),
  z.object({ befehl: z.literal('commit'), nachricht: z.string().trim().min(1, 'Commit-Nachricht fehlt.').max(5000), alle: z.boolean().optional() }),
  z.object({
    befehl: z.enum(['wechseln', 'anlegen']),
    branch: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/, 'Ungültiger Branch-Name (Buchstaben, Ziffern, . _ - /).')
      .refine((b) => !b.includes('..') && !b.includes('//') && !b.endsWith('/') && !b.endsWith('.lock'), 'Ungültiger Branch-Name.'),
  }),
]);

interface OffenesTerminal {
  sitzungId: string;
  schliessen(code: number, grund: string): void;
}

export function codingEditorRouten(app: FastifyInstance, d: { konfig: Konfig; holen?: typeof fetch; sitzungen?: Sitzungen }) {
  const { konfig } = d;
  const holen = d.holen ?? fetch;
  const terminals = new Map<string, OffenesTerminal>();

  // Abmelden / „Gerät abmelden“ / „alle abmelden“: Terminals dieser Sitzungen sofort kappen (wie E195 bei VS Code)
  d.sitzungen?.beiEnde.push((ids) => {
    for (const t of [...terminals.values()]) if (ids.includes(t.sitzungId)) t.schliessen(4001, 'Sitzung beendet');
  });

  const kopf = (): Record<string, string> => {
    if (!konfig.codingGeheimnis) throw new DorfFehler(503, 'Das Codehaus ist noch nicht eingerichtet. Auf dem Server: dorf coding-einrichten');
    return { 'x-werkstatt-geheimnis': konfig.codingGeheimnis };
  };

  /** Anfrage an den Runner; Fehler des Runners kommen mit seiner Meldung und seinem Status zurück. */
  async function roh(weg: string, init: { methode?: string; json?: unknown; daten?: Buffer; ms?: number } = {}): Promise<Response> {
    const headers = kopf();
    let body: BodyInit | undefined;
    if (init.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(init.json);
    } else if (init.daten) {
      headers['content-type'] = 'application/octet-stream';
      body = new Uint8Array(init.daten);
    }
    let r: Response;
    try {
      r = await holen(`${konfig.codingUrl}${weg}`, { method: init.methode ?? (body ? 'POST' : 'GET'), headers, body, signal: AbortSignal.timeout(init.ms ?? 30_000) });
    } catch (e) {
      throw new DorfFehler(502, `Der Coding-Container antwortet nicht (${(e as Error).message}). Auf dem Server: dorf status – läuft „coding“?`);
    }
    if (r.ok) return r;
    const j = (await r.json().catch(() => ({}))) as { fehler?: string; konflikt?: boolean; version?: string };
    // älteres Image (vor E197): der Runner kennt die Editor-Endpunkte noch nicht
    if (r.status === 404 && j.fehler === 'unbekannt') throw new DorfFehler(501, 'Der Coding-Container ist noch auf einem älteren Stand – der Editor kommt mit dem nächsten Deploy (neues Coding-Image).');
    // 401 vom Runner = falsches Geheimnis – das ist kein „nicht angemeldet“ für die App
    throw new DorfFehler(r.status === 401 ? 502 : r.status, j.fehler ?? `Coding-Container: Antwort ${r.status}`, { ...(j.konflikt ? { konflikt: true } : {}), ...(j.version ? { version: j.version } : {}) });
  }
  const runner = async (weg: string, init?: Parameters<typeof roh>[1]) => (await roh(weg, init)).json() as Promise<unknown>;
  const frage = (o: Record<string, string>) => new URLSearchParams(o).toString();

  app.get('/api/coding/editor/baum', async (req) => {
    const q = z.object({ projekt, pfad: pfadOderWurzel.default('') }).parse(req.query);
    return runner(`/editor/baum?${frage(q)}`);
  });

  app.get('/api/coding/editor/datei', async (req) => {
    const q = z.object({ projekt, pfad }).parse(req.query);
    return runner(`/editor/datei?${frage(q)}`);
  });

  // Herunterladen (auch Binärdateien): immer als Anhang, nie anzeigen – Projektdateien können aus fremden Quellen stammen
  app.get('/api/coding/editor/roh', async (req, reply) => {
    const q = z.object({ projekt, pfad }).parse(req.query);
    const r = await roh(`/editor/roh?${frage(q)}`, { ms: 120_000 });
    const name = q.pfad.split('/').pop()!;
    reply
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', 'sandbox')
      .header('Cache-Control', 'no-store');
    const laenge = r.headers.get('content-length');
    if (laenge) reply.header('Content-Length', laenge);
    return reply.send(r.body ? Readable.fromWeb(r.body as import('node:stream/web').ReadableStream) : Buffer.alloc(0));
  });

  app.get('/api/coding/editor/dateien', async (req) => {
    const q = z.object({ projekt }).parse(req.query);
    return runner(`/editor/dateien?${frage(q)}`);
  });

  app.put('/api/coding/editor/datei', { bodyLimit: EDITOR_TEXT_MAX * 2 + 100_000 }, async (req) => {
    const b = z.object({ projekt, pfad, text: z.string(), basisVersion: z.string().regex(/^[0-9a-f]{64}$/).optional(), neu: z.boolean().optional() }).parse(req.body);
    if (Buffer.byteLength(b.text, 'utf8') > EDITOR_TEXT_MAX) throw new DorfFehler(413, 'Die Datei ist zu groß für den Editor (über 2 MB).');
    return runner('/editor/datei', { methode: 'PUT', json: b });
  });

  app.post('/api/coding/editor/neu', async (req) => runner('/editor/neu', { json: z.object({ projekt, pfad, art: z.enum(['datei', 'ordner']) }).parse(req.body) }));
  app.post('/api/coding/editor/umbenennen', async (req) => runner('/editor/umbenennen', { json: z.object({ projekt, von: pfad, nach: pfad }).parse(req.body) }));
  app.post('/api/coding/editor/loeschen', async (req) => runner('/editor/loeschen', { json: z.object({ projekt, pfad }).parse(req.body) }));
  app.post('/api/coding/editor/projekt', async (req) => runner('/editor/projekt', { json: z.object({ projekt }).parse(req.body) }));
  app.post('/api/coding/editor/suche', async (req) =>
    runner('/editor/suche', { json: z.object({ projekt, text: z.string().min(1).max(500), regex: z.boolean().optional(), gross: z.boolean().optional(), wort: z.boolean().optional() }).parse(req.body) }),
  );
  app.post('/api/coding/editor/git', async (req) => {
    const b = z.object({ projekt }).and(GIT).parse(req.body);
    return runner('/editor/git', { json: b, ms: 150_000 });
  });

  // Hochladen: eine Datei je Anfrage, roh im Körper (kein multipart nötig) – eigener Rahmen, damit der Parser nur hier gilt
  void app.register(async (teil) => {
    teil.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: EDITOR_HOCHLADEN_MAX }, (_req, body, fertig) => fertig(null, body));
    teil.post('/api/coding/editor/hochladen', { bodyLimit: EDITOR_HOCHLADEN_MAX }, async (req) => {
      const q = z.object({ projekt, pfad, ersetzen: z.literal('1').optional() }).parse(req.query);
      if (!Buffer.isBuffer(req.body)) throw new DorfFehler(400, 'Datei fehlt (Content-Type: application/octet-stream).');
      return runner(`/editor/hochladen?${frage(q)}`, { daten: req.body, ms: 120_000 });
    });
  });

  // ---- Terminal --------------------------------------------------------------------------------------
  // Sitzung und Herkunft prüft der allgemeine Schutz (Upgrade-Anfragen brauchen immer eine passende Origin).
  app.get('/api/coding/terminal', { websocket: true }, (socket, req) => {
    const melden = (m: TerminalMeldung) => {
      try {
        socket.send(JSON.stringify(m));
      } catch {
        /* schon zu */
      }
    };
    const q = z.object({ projekt: projekt.optional(), spalten: z.coerce.number().int().min(2).max(1000).default(80), zeilen: z.coerce.number().int().min(2).max(500).default(24) }).safeParse(req.query);
    const sitzungId = req.sitzung!.id;
    let grund = '';
    if (!q.success) grund = 'Ungültige Anfrage.';
    else if (!konfig.codingGeheimnis) grund = 'Das Codehaus ist noch nicht eingerichtet. Auf dem Server: dorf coding-einrichten';
    else if ([...terminals.values()].filter((t) => t.sitzungId === sitzungId).length >= TERMINALS_JE_SITZUNG) grund = `Es sind schon ${TERMINALS_JE_SITZUNG} Terminals offen – schließ eins.`;
    if (grund || !q.success) {
      melden({ typ: 'fehler', text: grund });
      socket.close(4400, 'abgelehnt');
      return;
    }
    const id = crypto.randomUUID();
    const basis = `${konfig.codingUrl}/terminal`;
    const headers = { ...kopf(), 'content-type': 'application/json' };
    const ab = new AbortController();
    let bereit = false;
    let zu = false;
    const schliessen = (code: number, text: string) => {
      if (zu) return;
      zu = true;
      terminals.delete(id);
      ab.abort();
      try {
        socket.close(code, text);
      } catch {
        /* schon zu */
      }
    };
    terminals.set(id, { sitzungId, schliessen });

    // Eingaben streng der Reihe nach: immer nur eine Anfrage unterwegs, was inzwischen kommt, geht gesammelt hinterher
    let wartend = '';
    let sendet = false;
    const eingabeSenden = async () => {
      if (sendet || !bereit) return;
      sendet = true;
      try {
        while (wartend && !zu) {
          const stueck = wartend.slice(0, 200_000);
          wartend = wartend.slice(stueck.length);
          const r = await holen(`${basis}/${id}/eingabe`, { method: 'POST', headers: { ...headers, 'content-type': 'application/octet-stream' }, body: stueck, signal: AbortSignal.timeout(10_000) });
          if (!r.ok) throw new Error(`Antwort ${r.status}`);
        }
      } catch {
        if (!zu) {
          melden({ typ: 'fehler', text: 'Die Eingabe kam im Terminal nicht an.' });
          schliessen(1011, 'Eingabe fehlgeschlagen');
        }
      } finally {
        sendet = false;
      }
    };
    let groesse: { spalten: number; zeilen: number } | null = null;
    const groesseSenden = () => {
      if (!bereit || !groesse || zu) return;
      const g = groesse;
      groesse = null;
      void holen(`${basis}/${id}/groesse`, { method: 'POST', headers, body: JSON.stringify(g), signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
    };

    socket.on('message', (roh: Buffer, binaer: boolean) => {
      if (binaer || zu) return;
      let m: unknown;
      try {
        m = JSON.parse(roh.toString('utf8'));
      } catch {
        return;
      }
      const e = z
        .discriminatedUnion('typ', [
          z.object({ typ: z.literal('eingabe'), daten: z.string().max(60_000) }),
          z.object({ typ: z.literal('groesse'), spalten: z.number().int().min(2).max(1000), zeilen: z.number().int().min(2).max(500) }),
        ])
        .safeParse(m);
      if (!e.success) return;
      if (e.data.typ === 'eingabe') {
        // nie unbegrenzt puffern (hängender Container)
        if (wartend.length > 2_000_000) return;
        wartend += e.data.daten;
        void eingabeSenden();
      } else {
        groesse = { spalten: e.data.spalten, zeilen: e.data.zeilen };
        groesseSenden();
      }
    });
    socket.on('close', () => schliessen(1000, 'geschlossen'));
    socket.on('error', () => schliessen(1011, 'Fehler'));

    void (async () => {
      try {
        const r = await holen(basis, { method: 'POST', headers, body: JSON.stringify({ id, projekt: q.data.projekt, spalten: q.data.spalten, zeilen: q.data.zeilen }), signal: ab.signal });
        if (!r.ok || !r.body) {
          const j = (await r.json().catch(() => ({}))) as { fehler?: string };
          melden({ typ: 'fehler', text: r.status === 404 && j.fehler === 'unbekannt' ? 'Der Coding-Container ist noch auf einem älteren Stand – das Terminal kommt mit dem nächsten Deploy.' : (j.fehler ?? `Coding-Container: Antwort ${r.status}`) });
          return schliessen(1011, 'abgelehnt');
        }
        bereit = true;
        melden({ typ: 'bereit' });
        void eingabeSenden();
        groesseSenden();
        for await (const stueck of r.body as unknown as AsyncIterable<Uint8Array>) {
          if (zu) break;
          socket.send(stueck, { binary: true });
        }
        melden({ typ: 'ende' });
        schliessen(1000, 'beendet');
      } catch (e) {
        if (zu) return;
        melden({ typ: 'fehler', text: `Der Coding-Container antwortet nicht (${(e as Error).message}).` });
        schliessen(1011, 'nicht erreichbar');
      }
    })();
  });

  return { terminalsOffen: () => terminals.size };
}
