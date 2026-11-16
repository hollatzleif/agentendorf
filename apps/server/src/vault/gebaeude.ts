import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { z } from 'zod';
import type { Gebaeude } from '@dorf/shared';
import type { VaultDienst } from './dienst.js';

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
