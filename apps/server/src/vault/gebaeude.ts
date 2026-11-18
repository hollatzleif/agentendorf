import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { z } from 'zod';
import type { Gebaeude } from '@dorf/shared';
import type { VaultDienst } from './dienst.js';
import { dateinameBereinigen } from './pfade.js';
import { DorfFehler } from '../fehler.js';

export const GebaeudeKopf = z.object({
  name: z.string().min(1),
  status: z.enum(['offen', 'geschlossen']).default('offen'),
  symbol: z.string().default('🏠'),
  beschreibung: z.string().default(''),
  reihenfolge: z.number().default(100),
});

/** Ein Gebäude ist jeder Ordner auf oberster Ebene, der eine gebaeude.md enthält. */
export async function gebaeudeListe(vault: VaultDienst): Promise<Gebaeude[]> {
  const aus: Gebaeude[] = [];
  for (const e of await fs.readdir(vault.wurzel, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('00_')) continue;
    const datei = path.join(vault.wurzel, e.name, 'gebaeude.md');
    const roh = await fs.readFile(datei, 'utf8').catch(() => null);
    if (roh === null) continue;
    const aktionen = await fs
      .readdir(path.join(vault.wurzel, e.name, 'aktionen'))
      .then((l) => l.filter((n) => n.endsWith('.md') && !n.startsWith('.')).length)
      .catch(() => 0);
    try {
      const kopf = GebaeudeKopf.parse(matter(roh).data);
      aus.push({ id: e.name, ...kopf, aktionen });
    } catch (err) {
      aus.push({
        id: e.name,
        name: e.name,
        status: 'geschlossen',
        symbol: '⚠️',
        beschreibung: '',
        reihenfolge: 999,
        aktionen,
        fehler: `gebaeude.md ist fehlerhaft: ${err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : String(err)}`,
      });
    }
  }
  return aus.sort((a, b) => a.reihenfolge - b.reihenfolge || a.name.localeCompare(b.name, 'de'));
}

/** Ordnername für ein neues Gebäude: ASCII, ohne Leerzeichen, erster Buchstabe groß („Fitness-Studio“) */
export function gebaeudeOrdner(name: string) {
  const n = dateinameBereinigen(name.trim()).replace(/[ ()+.]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
  return n ? n[0]!.toUpperCase() + n.slice(1) : '';
}

export const GebaeudeNeu = z.object({
  name: z.string().trim().min(2).max(40).regex(/[\p{L}\p{N}]/u, 'Der Name braucht Buchstaben oder Ziffern.'),
  symbol: z.string().trim().min(1).max(8).default('🏠'),
  beschreibung: z.string().trim().max(200).default(''),
});

/** Etappe 7: neues Gebäude (Ordner + gebaeude.md + aktionen/) – erscheint sofort im Dorf (Platz sucht der Dorfplan) */
export async function gebaeudeAnlegen(vault: VaultDienst, roh: unknown) {
  const e = GebaeudeNeu.parse(roh);
  const id = gebaeudeOrdner(e.name);
  if (!id || id.startsWith('00_') || id.startsWith('.')) throw new DorfFehler(400, `„${e.name}“ geht nicht als Gebäudename.`);
  if ((await gebaeudeListe(vault)).some((g) => g.id.toLowerCase() === id.toLowerCase()) || (await vault.existiert(id)))
    throw new DorfFehler(409, `Ein Gebäude oder Ordner „${id}“ gibt es schon.`);
  const kopf = { name: e.name, symbol: e.symbol, status: 'offen', reihenfolge: 50, beschreibung: e.beschreibung };
  await vault.schreiben(
    `${id}/gebaeude.md`,
    matter.stringify(
      `\n# ${e.name} – Arbeitsanweisung\n\n${e.beschreibung || 'Wofür dieses Gebäude da ist.'}\n\n## Ordner\n- \`aktionen/\` – Skills dieses Gebäudes\n\n## Regeln\n- Es gilt die Stadtordnung.\n`,
      kopf,
    ),
    { nurNeu: true },
  );
  await vault.ordnerAnlegen(`${id}/aktionen`);
  return id;
}

export const GebaeudeAenderung = z.object({
  status: z.enum(['offen', 'geschlossen']).optional(),
  symbol: z.string().trim().min(1).max(8).optional(),
  beschreibung: z.string().trim().max(200).optional(),
  name: z.string().trim().min(2).max(40).optional(),
});

/** Etappe 7: Gebäude eröffnen/schließen, Symbol/Name/Beschreibung ändern (Frontmatter; der Text bleibt) */
export async function gebaeudeAendern(vault: VaultDienst, id: string, roh: unknown) {
  const a = GebaeudeAenderung.parse(roh);
  if (id === 'Rathaus' && a.status === 'geschlossen') throw new DorfFehler(400, 'Das Rathaus bleibt offen – dort wohnt der Bürgermeister.');
  const pfad = `${id}/gebaeude.md`;
  const d = await vault.lesen(pfad).catch(() => null);
  if (!d || id.includes('/')) throw new DorfFehler(404, `Gebäude „${id}“ gibt es nicht.`);
  const m = matter(d.inhalt);
  const kopf = { ...(m.data as Record<string, unknown>) };
  for (const [k, v] of Object.entries(a)) if (v !== undefined) kopf[k] = v;
  if (a.status === 'offen' && kopf.beschreibung === 'Noch nicht eröffnet') delete kopf.beschreibung;
  GebaeudeKopf.parse(kopf);
  const r = await vault.schreiben(pfad, matter.stringify(m.content, kopf), { basisVersion: d.version });
  if (r.konflikt) throw new DorfFehler(409, 'gebaeude.md wurde gerade geändert – bitte neu laden.');
  if (a.status === 'offen') await vault.ordnerAnlegen(`${id}/aktionen`).catch(() => undefined);
}
