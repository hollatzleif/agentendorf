import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ProgrammeInfo } from '@dorf/shared';
import { DorfFehler } from './fehler.js';

/**
 * Programme für Mac und Windows (Etappe 6): Die CI baut sie und liefert sie mit dem Deploy in <daten>/programme/.
 * Dort liegt programme.json (von der CI geschrieben) und die Dateien. Der Server
 *  - zeigt sie angemeldet unter Einstellungen → Programme (GET /api/programme),
 *  - liefert sie aus (GET /programme/datei/<name>) und
 *  - erzeugt die Update-Datei für den Tauri-Updater (GET /programme/latest.json, Adresse = eigener Ursprung).
 * Download und Update sind ohne Anmeldung erreichbar, weil der Updater im Programm keine Sitzung hat. Die Programme
 * enthalten nichts Persönliches (die Dorf-Adresse wird beim ersten Start abgefragt); Updates sind signiert.
 */
const Manifest = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  kennung: z.string().optional(),
  erstellt: z.string().optional(),
  mac: z.object({ installer: z.string(), update: z.string().default(''), signatur: z.string().default('') }).optional(),
  windows: z.object({ installer: z.string(), update: z.string().default(''), signatur: z.string().default('') }).optional(),
});
export type ProgrammeManifest = z.infer<typeof Manifest>;

/** Nur einfache Dateinamen direkt im Ordner (kein Pfad, keine versteckten Dateien) */
const DATEINAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,150}$/;

export function manifestLesen(ordner: string): ProgrammeManifest | null {
  try {
    return Manifest.parse(JSON.parse(fs.readFileSync(path.join(ordner, 'programme.json'), 'utf8')));
  } catch {
    return null;
  }
}

export function programmeInfo(ordner: string): ProgrammeInfo {
  const m = manifestLesen(ordner);
  if (!m) return { vorhanden: false };
  const url = (n: string) => `/programme/datei/${encodeURIComponent(n)}`;
  return {
    vorhanden: true,
    version: m.version,
    erstellt: m.erstellt,
    mac: m.mac && fs.existsSync(path.join(ordner, m.mac.installer)) ? { datei: m.mac.installer, url: url(m.mac.installer) } : undefined,
    windows: m.windows && fs.existsSync(path.join(ordner, m.windows.installer)) ? { datei: m.windows.installer, url: url(m.windows.installer) } : undefined,
  };
}

/** Update-Datei im Format des Tauri-Updaters (statische JSON-Datei, Plattformen darwin-aarch64 und windows-x86_64) */
export function updateDatei(ordner: string, ursprung: string) {
  const m = manifestLesen(ordner);
  if (!m) return null;
  const plattformen: Record<string, { signature: string; url: string }> = {};
  const url = (n: string) => `${ursprung}/programme/datei/${encodeURIComponent(n)}`;
  // ohne Signatur (Schlüssel fehlte beim Bauen) kein Update-Eintrag – der Updater würde es ohnehin ablehnen
  if (m.mac?.signatur && fs.existsSync(path.join(ordner, m.mac.update))) plattformen['darwin-aarch64'] = { signature: m.mac.signatur, url: url(m.mac.update) };
  if (m.windows?.signatur && fs.existsSync(path.join(ordner, m.windows.update))) plattformen['windows-x86_64'] = { signature: m.windows.signatur, url: url(m.windows.update) };
  if (!Object.keys(plattformen).length) return null;
  return { version: m.version, notes: 'Neue Version des Agentendorf-Programms', pub_date: m.erstellt ?? new Date(0).toISOString(), platforms: plattformen };
}

export function programmeRouten(app: FastifyInstance, o: { ordner: string; ursprung: string }) {
  app.get('/api/programme', async () => programmeInfo(o.ordner));
  // ohne Anmeldung (liegen nicht unter /api/; siehe oben)
  app.get('/programme/latest.json', async (_req, rep) => {
    const u = updateDatei(o.ordner, o.ursprung);
    if (!u) return rep.code(204).send();
    rep.header('Cache-Control', 'no-cache');
    return u;
  });
  app.get('/programme/datei/:name', async (req, rep) => {
    const { name } = z.object({ name: z.string() }).parse(req.params);
    if (!DATEINAME.test(name) || name === 'programme.json') throw new DorfFehler(404, 'Gibt es nicht.');
    const datei = path.join(o.ordner, name);
    const st = fs.statSync(datei, { throwIfNoEntry: false });
    if (!st?.isFile()) throw new DorfFehler(404, 'Gibt es nicht.');
    rep.header('Content-Type', 'application/octet-stream');
    rep.header('Content-Length', String(st.size));
    rep.header('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"`);
    rep.header('Cache-Control', 'public, max-age=3600');
    return rep.send(fs.createReadStream(datei));
  });
}
