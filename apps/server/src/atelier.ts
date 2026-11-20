import crypto from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ATELIER_MAX_BYTES, MAX_ANHANG_BYTES, type AtelierStand } from '@dorf/shared';
import { DorfFehler } from './fehler.js';
import type { Konfig } from './konfig.js';
import type { BildKann, RechenraumKlient } from './agenten/rechenraum.js';
import type { VaultDienst } from './vault/dienst.js';
import { normalisieren } from './vault/pfade.js';

/**
 * E198 – Atelier: Server-Seite des Bildeditors.
 * - Öffnen: Bilder, die der Browser selbst lesen kann, unverändert; alles andere (HEIC, TIFF, SVG …) wird NUR im
 *   Rechenraum zu PNG (kein Internet, kein Vault, eigener Kindprozess mit Grenzen – wie E190).
 * - Speichern: ausschließlich über den VaultDienst (basisVersion → Konfliktkopie statt Überschreiben, atomar), nur
 *   Bildformate und das Projektformat, mit Größengrenze und Prüfung der ersten Bytes.
 * - KI ohne Kosten: „Hintergrund entfernen“ und „Hochskalieren“ rechnet der Rechenraum (kleine Modelle im Image).
 * - „Bild generieren“ / „Generatives Füllen“: optional über Cloudflare Workers AI (Gratiskontingent), nur wenn Leif den
 *   Zugang eingerichtet hat (`dorf bilder-einrichten`). Das ist der einzige Weg, auf dem hier etwas das Dorf verlässt –
 *   und nur auf Leifs Klick im Editor: Agenten haben dafür kein Werkzeug.
 */

/** Was der Browser ohne Hilfe als Bild lesen kann */
const DIREKT: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.avif': 'image/avif' };
/** Was der Rechenraum zu PNG macht */
const UMWANDELBAR = new Set(['.heic', '.heif', '.tif', '.tiff', '.svg', '.ico', '.tga', '.ppm', '.pgm', '.jfif']);
export const PROJEKT_ENDUNG = '.atelier';
/** Speichern: Endung → erlaubte Anfangsbytes (ein umbenanntes Skript wird so kein „Bild“) */
const SPEICHERBAR: Record<string, (b: Buffer) => boolean> = {
  '.png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  '.jpg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  '.jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  '.webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  [PROJEKT_ENDUNG]: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04,
};

const versionVon = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

/** Bilder aus Text – Cloudflare Workers AI, FLUX.2 [klein] 4B (Text → Bild und Bild + Text → Bild in einem Modell) */
export interface BildGenerator {
  generieren(a: { prompt: string; breite: number; hoehe: number; vorlage?: Buffer }): Promise<{ inhalt: Buffer; mime: string }>;
}

/**
 * Quelle (Stand 20.11.2026, cloudflare-docs): POST {API}/accounts/{ACCOUNT}/ai/run/@cf/black-forest-labs/flux-2-klein-4b,
 * Authorization: Bearer {TOKEN}, multipart/form-data mit prompt, width, height (256–1920), optional input_image_0…3
 * (binär, „smaller than 512x512“), Schritte fest 4. Antwort: JSON mit dem Bild als Base64 (`image`, über die REST-API in
 * `result`). Kosten: 26,05 Neuronen je 512×512-Kachel Ausgabe, 5,37 je Kachel Eingabe; 10 000 Neuronen pro Tag sind frei.
 */
export const CLOUDFLARE_MODELL = '@cf/black-forest-labs/flux-2-klein-4b';
export const VORLAGE_MAX_KANTE = 504;
export function cloudflareBilder(k: { accountId: string; token: string; url: string }, holen: typeof fetch = fetch): BildGenerator {
  return {
    async generieren(a) {
      const f = new FormData();
      f.append('prompt', a.prompt);
      f.append('width', String(a.breite));
      f.append('height', String(a.hoehe));
      if (a.vorlage) f.append('input_image_0', new Blob([new Uint8Array(a.vorlage)], { type: 'image/png' }), 'vorlage.png');
      let r: Response;
      try {
        r = await holen(`${k.url}/accounts/${encodeURIComponent(k.accountId)}/ai/run/${CLOUDFLARE_MODELL}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${k.token}` },
          body: f,
          signal: AbortSignal.timeout(120_000),
        });
      } catch (e) {
        throw new DorfFehler(503, `Cloudflare nicht erreichbar (${(e as Error).message}).`);
      }
      const typ = r.headers.get('content-type') ?? '';
      if (r.ok && typ.startsWith('image/')) return { inhalt: Buffer.from(await r.arrayBuffer()), mime: typ.split(';')[0]! };
      const j = (await r.json().catch(() => null)) as { result?: { image?: string }; image?: string; errors?: { code?: number; message?: string }[] } | null;
      if (!r.ok) {
        const text = j?.errors?.map((e) => e.message).filter(Boolean).join(' · ') || `HTTP ${r.status}`;
        if (r.status === 401 || r.status === 403) throw new DorfFehler(503, `Cloudflare lehnt den Zugang ab (${text}). Auf dem Server: dorf bilder-einrichten`);
        if (r.status === 429) throw new DorfFehler(429, `Cloudflare: Kontingent erschöpft oder zu viele Anfragen (${text}). Das freie Tageskontingent beginnt um 00:00 UTC neu.`);
        throw new DorfFehler(502, `Cloudflare: ${text}`.slice(0, 400));
      }
      const b64 = j?.result?.image ?? j?.image;
      if (!b64) throw new DorfFehler(502, 'Cloudflare hat kein Bild geliefert.');
      const inhalt = Buffer.from(b64, 'base64');
      const mime = SPEICHERBAR['.png']!(inhalt) ? 'image/png' : SPEICHERBAR['.webp']!(inhalt) ? 'image/webp' : 'image/jpeg';
      if (mime === 'image/jpeg' && !SPEICHERBAR['.jpg']!(inhalt)) throw new DorfFehler(502, 'Cloudflare hat etwas geliefert, das kein Bild ist.');
      return { inhalt, mime };
    },
  };
}

/** Maße für das Modell: 256–1920, Vielfache von 16 */
export function modellMass(n: number) {
  return Math.max(256, Math.min(1920, Math.round(n / 16) * 16));
}

export function atelierRouten(
  app: FastifyInstance,
  a: { konfig: Konfig; vault: VaultDienst; rechenraum: () => RechenraumKlient | undefined; generator?: BildGenerator },
) {
  const generator = a.generator ?? (a.konfig.cloudflare ? cloudflareBilder(a.konfig.cloudflare) : undefined);
  let kann: { wert: BildKann | null; bis: number } | null = null;
  const rechenraumKann = async () => {
    const rr = a.rechenraum();
    if (!rr) return null;
    if (kann && kann.bis > Date.now()) return kann.wert;
    const wert = await rr.bildKann().catch(() => null);
    // kurz merken (auch „geht nicht“ – der Rechenraum startet vielleicht gerade neu)
    kann = { wert, bis: Date.now() + (wert ? 60_000 : 5_000) };
    return wert;
  };
  const rechenraum = () => {
    const rr = a.rechenraum();
    if (!rr) throw new DorfFehler(503, 'Der Rechenraum ist auf diesem Server nicht eingerichtet.');
    return rr;
  };
  /** genau eine Datei aus dem Formular, mit eigener Größengrenze */
  const datei = async (req: FastifyRequest, max: number) => {
    const teil = await req.file({ limits: { fileSize: max, files: 1 } });
    if (!teil) throw new DorfFehler(400, 'Keine Datei empfangen.');
    let inhalt: Buffer;
    try {
      inhalt = await teil.toBuffer();
    } catch {
      throw new DorfFehler(413, `Datei zu groß (höchstens ${Math.round(max / 1024 / 1024)} MB).`);
    }
    if (!inhalt.length) throw new DorfFehler(400, 'Die Datei ist leer.');
    const felder: Record<string, string> = {};
    for (const [k, v] of Object.entries(teil.fields)) {
      const f = Array.isArray(v) ? v[0] : v;
      if (f && 'value' in f && typeof f.value === 'string') felder[k] = f.value;
    }
    return { name: teil.filename || 'bild', inhalt, felder };
  };
  const bildAntwort = (reply: import('fastify').FastifyReply, inhalt: Buffer, mime: string, kopf: Record<string, string> = {}) => {
    for (const [k, v] of Object.entries(kopf)) reply.header(k, v);
    return reply.header('Content-Type', mime).header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'private, no-store').send(inhalt);
  };

  app.get('/api/atelier/stand', async (): Promise<AtelierStand> => {
    const k = await rechenraumKann();
    return {
      rechenraum: !!k?.bilder,
      hintergrund: !!k?.hintergrund_entfernen,
      hochskalieren: !!k?.hochskalieren,
      heic: !!k?.heic,
      skalierenMaxPixel: k?.skalieren_max_pixel ?? 0,
      generieren: !!generator,
      maxBytes: ATELIER_MAX_BYTES,
    };
  });

  /** Bild oder Projekt aus dem Vault für den Editor: Bytes + Version (für basisVersion beim Speichern) */
  app.get('/api/atelier/oeffnen', async (req, reply) => {
    const pfad = normalisieren(z.object({ pfad: z.string().min(1) }).parse(req.query).pfad);
    const ext = path.posix.extname(pfad).toLowerCase();
    const direkt = DIREKT[ext] ?? (ext === PROJEKT_ENDUNG ? 'application/zip' : undefined);
    if (!direkt && !UMWANDELBAR.has(ext)) throw new DorfFehler(400, `„${ext || 'ohne Endung'}“ kann das Atelier nicht öffnen (Bilder und ${PROJEKT_ENDUNG}-Projekte).`);
    const max = direkt ? ATELIER_MAX_BYTES : MAX_ANHANG_BYTES;
    const st = await a.vault.stat(pfad);
    if (!st?.isFile()) throw new DorfFehler(404, 'Datei nicht gefunden.');
    if (st.size > max) throw new DorfFehler(413, `Datei zu groß (höchstens ${Math.round(max / 1024 / 1024)} MB).`);
    const d = await a.vault.puffer(pfad, { max });
    if (!d) throw new DorfFehler(404, 'Datei nicht gefunden.');
    const kopf = { 'X-Dorf-Version': versionVon(d.inhalt) };
    if (direkt) return bildAntwort(reply, d.inhalt, direkt, kopf);
    const e = await rechenraum().bild(path.posix.basename(pfad), d.inhalt, [], 'png');
    return bildAntwort(reply, e.inhalt, e.mime, { ...kopf, 'X-Dorf-Umgewandelt': '1' });
  });

  /** Datei von der Festplatte, die der Browser nicht lesen kann (HEIC vom iPhone, TIFF …) → PNG */
  app.post('/api/atelier/umwandeln', async (req, reply) => {
    const d = await datei(req, MAX_ANHANG_BYTES);
    const e = await rechenraum().bild(d.name, d.inhalt, [], 'png');
    return bildAntwort(reply, e.inhalt, e.mime);
  });

  /** Speichern in den Vault – nur Bilder und Projekte, nur über den VaultDienst (Konfliktkopie bei veralteter basisVersion) */
  app.post('/api/atelier/speichern', async (req) => {
    const q = z.object({ pfad: z.string().min(1).max(500), basisVersion: z.string().regex(/^[0-9a-f]{64}$/).optional(), neu: z.string().optional() }).parse(req.query);
    const pfad = normalisieren(q.pfad);
    const ext = path.posix.extname(pfad).toLowerCase();
    const pruefen = SPEICHERBAR[ext];
    if (!pruefen) throw new DorfFehler(400, `Das Atelier speichert nur ${Object.keys(SPEICHERBAR).join(', ')}.`);
    if (!pfad.includes('/')) throw new DorfFehler(400, 'Bitte in einen Ordner speichern, z. B. Atelier/bilder/.');
    const d = await datei(req, ATELIER_MAX_BYTES);
    if (!pruefen(d.inhalt)) throw new DorfFehler(400, `Der Inhalt passt nicht zur Endung ${ext}.`);
    return a.vault.schreiben(pfad, d.inhalt, { basisVersion: q.basisVersion, nurNeu: q.neu === '1' });
  });

  /** KI ohne Kosten und ohne Internet: rechnet der Rechenraum */
  app.post('/api/atelier/ki', async (req, reply) => {
    const q = z.object({ art: z.enum(['hintergrund', 'hochskalieren']), faktor: z.coerce.number().int().optional() }).parse(req.query);
    if (q.art === 'hochskalieren' && q.faktor !== 2 && q.faktor !== 4) throw new DorfFehler(400, 'faktor ist 2 oder 4.');
    const d = await datei(req, MAX_ANHANG_BYTES);
    const e = await rechenraum().bild(d.name, d.inhalt, [q.art === 'hintergrund' ? { art: 'hintergrund_entfernen' } : { art: 'hochskalieren', faktor: q.faktor }], 'png');
    return bildAntwort(reply, e.inhalt, e.mime);
  });

  const Prompt = z.string().trim().min(1).max(2000);
  const ohneZugang = () => new DorfFehler(503, 'Bilder generieren ist nicht eingerichtet. Auf dem Server: dorf bilder-einrichten (Cloudflare Workers AI, kostenloses Tageskontingent).');

  /** Text → Bild (verlässt das Dorf: der Text geht an Cloudflare) */
  app.post('/api/atelier/generieren', async (req, reply) => {
    const b = z.object({ prompt: Prompt, breite: z.number().int().min(64).max(4096), hoehe: z.number().int().min(64).max(4096) }).parse(req.body);
    if (!generator) throw ohneZugang();
    const e = await generator.generieren({ prompt: b.prompt, breite: modellMass(b.breite), hoehe: modellMass(b.hoehe) });
    return bildAntwort(reply, e.inhalt, e.mime);
  });

  /** Bild + Text → Bild (generatives Füllen: der Ausschnitt und der Text gehen an Cloudflare) */
  app.post('/api/atelier/fuellen', async (req, reply) => {
    if (!generator) throw ohneZugang();
    const d = await datei(req, 4 * 1024 * 1024);
    const f = z.object({ prompt: Prompt, breite: z.coerce.number().int().min(64).max(4096), hoehe: z.coerce.number().int().min(64).max(4096) }).parse(d.felder);
    if (!SPEICHERBAR['.png']!(d.inhalt)) throw new DorfFehler(400, 'Die Vorlage muss ein PNG sein.');
    // PNG-Kopf: Breite und Höhe stehen an fester Stelle (IHDR) – das Modell nimmt nur kleine Vorlagen
    const [vb, vh] = [d.inhalt.readUInt32BE(16), d.inhalt.readUInt32BE(20)];
    if (vb > VORLAGE_MAX_KANTE || vh > VORLAGE_MAX_KANTE) throw new DorfFehler(400, `Die Vorlage darf höchstens ${VORLAGE_MAX_KANTE}×${VORLAGE_MAX_KANTE} Pixel haben.`);
    const e = await generator.generieren({ prompt: f.prompt, breite: modellMass(f.breite), hoehe: modellMass(f.hoehe), vorlage: d.inhalt });
    return bildAntwort(reply, e.inhalt, e.mime);
  });
}
