import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ErweiterungTreffer, ErweiterungenSuche } from '@dorf/shared';
import { DorfFehler } from './fehler.js';
import type { Konfig } from './konfig.js';

/**
 * Erweiterungen für VS Code im Codehaus (E205): in Open VSX suchen, im Coding-Container installieren und entfernen.
 *
 * - Verzeichnis ist NUR Open VSX (open-vsx.org, Eclipse Foundation) – dasselbe, das openvscode-server von Haus aus nutzt.
 *   Der Marketplace von Microsoft wird nirgends angefragt (seine Nutzungsbedingungen erlauben ihn nur aus Microsoft-
 *   Produkten heraus), auch keine VSIX-Datei von dort.
 * - Die Suche läuft vom Dorf aus (feste Adresse, Zeit- und Größengrenze, Antwort per Zod gelesen, nur geprüfte Felder gehen
 *   an die App – nie HTML, nie eine Adresse aus der Antwort). Der Runner bleibt so ein reiner Ausführer ohne eigenen
 *   Netz-Klienten, und die Suche geht auch, wenn der Coding-Container gerade steht.
 * - Installieren/Entfernen: Das Dorf prüft die Kennung und ruft den Runner im Coding-Container (Profil coding, mit dem
 *   Runner-Geheimnis); der prüft noch einmal und ruft openvscode-server mit festen Argumenten (apps/werkstatt/src/erweiterungen.ts).
 * - Alle Routen liegen unter /api/ und stehen in keiner Ausnahmeliste: Sitzung und – für Schreibendes – Herkunft prüft der
 *   allgemeine Schutz in app.ts (E203). Es gibt KEIN Agenten-Werkzeug dafür: Erweiterungen laufen mit vollem Zugriff im
 *   Codehaus, installiert wird nur auf Leifs Klick.
 */

/**
 * wie im Runner: herausgeber.name, optional @version – beginnt nie mit „-“, keine Adresse, und nie mit der Endung „.vsix“
 * (VS Code hält jedes Argument auf .vsix für eine Datei relativ zu seinem Arbeitsordner – Review E205)
 */
export const ERWEITERUNG_ID = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*(@[0-9][0-9A-Za-z.+-]*)?$/;
const ERWEITERUNG_OHNE_VERSION = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/;
export const VSIX_MAX = 50 * 1024 * 1024;
/** So viel einer Antwort von Open VSX wird höchstens gelesen */
export const OPENVSX_ANTWORT_MAX = 1024 * 1024;
const OPENVSX_ZEIT_MS = 8000;
const TREFFER_JE_SEITE = 10;
const MERKEN_MS = 60 * 60 * 1000;
const MERKEN_MAX = 500;

const keinVsix = (w: string) => !/\.vsix$/i.test(w);
export const erweiterungIdOk = (w: string) => w.length <= 200 && ERWEITERUNG_ID.test(w) && keinVsix(w);
const id = z.string().max(200).regex(ERWEITERUNG_ID, 'Ungültige Erweiterungs-Kennung – erwartet wird „herausgeber.name“ (klein geschrieben), optional „@version“.').refine(keinVsix, 'Ungültige Erweiterungs-Kennung (endet auf „.vsix“).');
const idOhneVersion = z.string().max(200).regex(ERWEITERUNG_OHNE_VERSION, 'Ungültige Erweiterungs-Kennung – erwartet wird „herausgeber.name“ (klein geschrieben).').refine(keinVsix, 'Ungültige Erweiterungs-Kennung (endet auf „.vsix“).');
/**
 * Zeitgrenzen (Review E205): Der Runner braucht für einen Auftrag höchstens Warten in der Reihe (60 s) + Aufruf (180 s
 * installieren, 60 s entfernen) + Liste (30 s). Das Dorf wartet jeweils länger – sonst meldete es einen Fehler, obwohl der
 * Runner die Erweiterung noch fertig installiert (ein abgebrochener Aufruf beendet den Auftrag im Runner nicht).
 */
export const ZEIT_INSTALLIEREN_MS = 300_000;
export const ZEIT_ENTFERNEN_MS = 170_000;
export const ZEIT_VSIX_MS = 330_000;
const ZEIT_LISTE_MS = 45_000;
/** Antwort des Runners: nur die Liste zählt – fehlt sie oder hat sie eine andere Form, ist sie leer (nie ein Absturz in der App) */
const eintrag = z.object({ id: z.string().max(200), version: z.string().max(60) });
const STAND = z.object({ erweiterungen: z.array(z.unknown()).max(1000).catch([]) }).catch({ erweiterungen: [] });
const stand = (j: unknown) => ({
  erweiterungen: STAND.parse(j ?? {}).erweiterungen.flatMap((e) => {
    const r = eintrag.safeParse(e);
    return r.success ? [r.data] : [];
  }),
});
const ergebnis = (j: unknown) => ({ ok: true as const, ausgabe: text((j as { ausgabe?: unknown } | null)?.ausgabe, 6000), ...stand(j) });

/** Namensteile, wie Open VSX sie vergibt (auch Großbuchstaben/Unterstrich) – nur solche gehen in eine Adresse */
const TEIL = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
// eslint-disable-next-line no-control-regex
const text = (w: unknown, max: number) => (typeof w === 'string' ? w.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '');
const zahl = (w: unknown) => (typeof w === 'number' && Number.isFinite(w) && w >= 0 ? w : 0);

const SUCHE = z.object({
  totalSize: z.unknown().optional(),
  extensions: z
    .array(
      z
        .object({
          namespace: z.string(),
          name: z.string(),
          version: z.unknown().optional(),
          displayName: z.unknown().optional(),
          description: z.unknown().optional(),
          downloadCount: z.unknown().optional(),
          averageRating: z.unknown().optional(),
          verified: z.unknown().optional(),
          deprecated: z.unknown().optional(),
        })
        .passthrough(),
    )
    .max(100),
});

async function begrenztJson(r: Response, max: number): Promise<unknown> {
  const teile: Buffer[] = [];
  let n = 0;
  for await (const t of (r.body ?? []) as AsyncIterable<Uint8Array>) {
    n += t.length;
    if (n > max) {
      await r.body?.cancel().catch(() => undefined);
      throw new DorfFehler(502, 'Open VSX: Antwort zu groß.');
    }
    teile.push(Buffer.from(t));
  }
  try {
    return JSON.parse(Buffer.concat(teile).toString('utf8')) as unknown;
  } catch {
    throw new DorfFehler(502, 'Open VSX: Antwort nicht lesbar.');
  }
}

export function codingErweiterungenRouten(app: FastifyInstance, d: { konfig: Konfig; holen?: typeof fetch; jetzt?: () => number }) {
  const { konfig } = d;
  const holen = d.holen ?? fetch;
  const jetzt = d.jetzt ?? Date.now;
  /** Lizenz je Erweiterung (steht nur in den Einzelheiten, nicht in der Suche) – eine Stunde gemerkt, damit eine Suche Open VSX nicht jedes Mal elfmal fragt */
  const lizenzen = new Map<string, { lizenz: string | null; bis: number }>();

  async function openvsx(weg: string): Promise<unknown> {
    let r: Response;
    try {
      r = await holen(`${konfig.openvsxUrl}${weg}`, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(OPENVSX_ZEIT_MS) });
    } catch (e) {
      throw new DorfFehler(502, `Open VSX ist nicht erreichbar (${(e as Error).name === 'TimeoutError' ? 'keine Antwort' : (e as Error).message}).`);
    }
    if (r.status === 429) {
      await r.body?.cancel().catch(() => undefined);
      throw new DorfFehler(429, 'Open VSX: zu viele Anfragen – später noch einmal.');
    }
    if (!r.ok) {
      await r.body?.cancel().catch(() => undefined);
      throw new DorfFehler(r.status === 404 ? 404 : 502, r.status === 404 ? 'Open VSX: nicht gefunden.' : `Open VSX antwortet mit HTTP ${r.status}.`);
    }
    return begrenztJson(r, OPENVSX_ANTWORT_MAX);
  }

  async function lizenz(namespace: string, name: string): Promise<string | null> {
    const schluessel = `${namespace}.${name}`.toLowerCase();
    const gemerkt = lizenzen.get(schluessel);
    if (gemerkt && gemerkt.bis > jetzt()) return gemerkt.lizenz;
    let wert: string | null = null;
    try {
      const j = z.object({ license: z.unknown().optional() }).passthrough().parse(await openvsx(`/api/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`));
      wert = text(j.license, 60) || null;
    } catch {
      // Einzelheiten nicht abrufbar: Die Suche soll daran nicht scheitern – „Lizenz unbekannt“, und nicht gemerkt
      return null;
    }
    if (lizenzen.size >= MERKEN_MAX) lizenzen.delete(lizenzen.keys().next().value!);
    lizenzen.set(schluessel, { lizenz: wert, bis: jetzt() + MERKEN_MS });
    return wert;
  }

  // ---- Suche in Open VSX -------------------------------------------------------------------------------
  app.get('/api/coding/erweiterungen/suche', async (req): Promise<ErweiterungenSuche> => {
    const q = z.object({ q: z.string().trim().max(100).default(''), versatz: z.coerce.number().int().min(0).max(5000).default(0) }).parse(req.query);
    // ohne Suchwort: die meistgeladenen
    const frage = new URLSearchParams({ query: q.q, size: String(TREFFER_JE_SEITE), offset: String(q.versatz), sortBy: q.q ? 'relevance' : 'downloadCount', sortOrder: 'desc' });
    const roh = SUCHE.safeParse(await openvsx(`/api/-/search?${frage.toString()}`));
    if (!roh.success) throw new DorfFehler(502, 'Open VSX: Antwort hat eine unerwartete Form.');
    const brauchbar = roh.data.extensions.filter((e) => TEIL.test(e.namespace) && TEIL.test(e.name)).slice(0, TREFFER_JE_SEITE);
    const treffer = await Promise.all(
      brauchbar.map(async (e): Promise<ErweiterungTreffer> => {
        const kennung = `${e.namespace}.${e.name}`.toLowerCase();
        return {
          id: kennung,
          name: text(e.displayName, 100) || e.name,
          herausgeber: e.namespace,
          beschreibung: text(e.description, 400),
          version: text(e.version, 40),
          downloads: Math.round(zahl(e.downloadCount)),
          bewertung: typeof e.averageRating === 'number' && Number.isFinite(e.averageRating) ? Math.round(e.averageRating * 10) / 10 : null,
          verifiziert: e.verified === true,
          veraltet: e.deprecated === true,
          lizenz: await lizenz(e.namespace, e.name),
          // die Adresse baut das Dorf selbst aus den geprüften Namensteilen – nie eine aus der Antwort
          seite: `https://open-vsx.org/extension/${encodeURIComponent(e.namespace)}/${encodeURIComponent(e.name)}`,
          installierbar: ERWEITERUNG_OHNE_VERSION.test(kennung) && keinVsix(kennung),
        };
      }),
    );
    return { treffer, gesamt: Math.round(zahl(roh.data.totalSize)), versatz: q.versatz };
  });

  // ---- Coding-Container: auflisten, installieren, entfernen ----------------------------------------------
  async function runner(weg: string, init: { json?: unknown; daten?: Buffer; ms: number }): Promise<unknown> {
    if (!konfig.codingGeheimnis) throw new DorfFehler(503, 'Das Codehaus ist noch nicht eingerichtet. Auf dem Server: dorf coding-einrichten');
    const headers: Record<string, string> = { 'x-werkstatt-geheimnis': konfig.codingGeheimnis };
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
      r = await holen(`${konfig.codingUrl}${weg}`, { method: body ? 'POST' : 'GET', headers, body, signal: AbortSignal.timeout(init.ms) });
    } catch (e) {
      throw new DorfFehler(502, `Der Coding-Container antwortet nicht (${(e as Error).message}). Auf dem Server: dorf status – läuft „coding“?`);
    }
    // Ausgabe von VS Code: begrenzt lesen (der Runner kürzt selbst – doppelt hält besser)
    const j = (await begrenztJson(r, 2 * 1024 * 1024).catch(() => ({}))) as { fehler?: string };
    if (r.ok) return j;
    if (r.status === 404 && j.fehler === 'unbekannt') throw new DorfFehler(501, 'Der Coding-Container ist noch auf einem älteren Stand – Erweiterungen kommen mit dem nächsten Deploy (neues Coding-Image).');
    // 401 vom Runner = falsches Geheimnis – das ist kein „nicht angemeldet“ für die App
    throw new DorfFehler(r.status === 401 ? 502 : r.status, text(j.fehler, 2000) || `Coding-Container: Antwort ${r.status}`);
  }

  app.get('/api/coding/erweiterungen', async () => stand(await runner('/erweiterungen', { ms: ZEIT_LISTE_MS })));
  // Installieren kann dauern (Herunterladen, Auspacken) – Grenzen siehe oben
  app.post('/api/coding/erweiterungen/installieren', async (req) => ergebnis(await runner('/erweiterungen/installieren', { json: z.object({ id }).strict().parse(req.body), ms: ZEIT_INSTALLIEREN_MS })));
  app.post('/api/coding/erweiterungen/entfernen', async (req) => ergebnis(await runner('/erweiterungen/entfernen', { json: z.object({ id: idOhneVersion }).strict().parse(req.body), ms: ZEIT_ENTFERNEN_MS })));

  // VSIX hochladen und installieren (z. B. eine selbst gebaute oder eine vom Hersteller): roh im Körper, eigener Rahmen für den Parser
  void app.register(async (teil) => {
    teil.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: VSIX_MAX }, (_req, body, fertig) => fertig(null, body));
    teil.post('/api/coding/erweiterungen/vsix', { bodyLimit: VSIX_MAX }, async (req) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new DorfFehler(400, 'Datei fehlt (Content-Type: application/octet-stream).');
      if (!req.body.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new DorfFehler(400, 'Das ist keine VSIX-Datei (kein ZIP-Archiv).');
      return ergebnis(await runner('/erweiterungen/vsix', { daten: req.body, ms: ZEIT_VSIX_MS }));
    });
  });
}
