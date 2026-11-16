import { useQuery } from '@tanstack/react-query';
import type { VaultEintrag } from '@dorf/shared';
import { api } from './api';

export function useBaum() {
  return useQuery({ queryKey: ['baum'], queryFn: () => api<VaultEintrag>('/api/vault/baum'), staleTime: 30_000 });
}

export function finden(baum: VaultEintrag | undefined, pfad: string): VaultEintrag | undefined {
  if (!baum) return undefined;
  if (baum.pfad === pfad) return baum;
  for (const k of baum.kinder ?? []) {
    if (pfad === k.pfad || pfad.startsWith(k.pfad + '/')) {
      const f = finden(k, pfad);
      if (f) return f;
    }
  }
  return undefined;
}

export function alleDateien(baum: VaultEintrag | undefined, aus: string[] = []): string[] {
  if (!baum) return aus;
  if (baum.art === 'datei') aus.push(baum.pfad);
  for (const k of baum.kinder ?? []) alleDateien(k, aus);
  return aus;
}

export const ordnerVon = (pfad: string) => (pfad.includes('/') ? pfad.slice(0, pfad.lastIndexOf('/')) : '');
export const endung = (pfad: string) => (pfad.includes('.') ? pfad.slice(pfad.lastIndexOf('.') + 1).toLowerCase() : '');

/** Löst einen relativen Pfad (Markdown-Link) gegenüber einem Ordner auf. */
export function relativAufloesen(ordner: string, ziel: string): string {
  const teile = ordner ? ordner.split('/') : [];
  for (const t of decodeURIComponent(ziel).split('/')) {
    if (t === '..') teile.pop();
    else if (t && t !== '.') teile.push(t);
  }
  return teile.join('/');
}

/** Löst einen Obsidian-Wikilink-Namen auf einen Pfad im Vault auf (wie Obsidian: kürzester passender Pfad). */
export function wikilinkAufloesen(name: string, dateien: string[]): string | null {
  const n = name.trim().replace(/^\//, '');
  const mitEndung = /\.[a-z0-9]+$/i.test(n) ? n : `${n}.md`;
  const kandidaten = dateien.filter((d) => d === mitEndung || d.endsWith('/' + mitEndung));
  if (!kandidaten.length) return null;
  return kandidaten.sort((a, b) => a.length - b.length)[0]!;
}

export const TEXT_ENDUNGEN = new Set(['md', 'markdown', 'txt', 'csv', 'json', 'yaml', 'yml']);
export const BILD_ENDUNGEN = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
