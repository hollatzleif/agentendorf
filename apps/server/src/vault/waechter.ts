import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { AenderungsArt } from './dienst.js';

/**
 * Beobachtet den Vault auf Änderungen von außen (Obsidian über Syncthing, Agenten, Konsole).
 * Versteckte Dateien und Ordner (.obsidian, .stfolder, .papierkorb, temporäre Dateien) werden ignoriert.
 */
export function vaultBeobachten(wurzel: string, melden: (rel: string, art: AenderungsArt) => void): FSWatcher {
  const w = watch(wurzel, {
    ignoreInitial: true,
    // E195: Symlinks im Vault nie verfolgen (ein Agent mit Shell könnte sonst fremde Ordner beobachten lassen)
    followSymlinks: false,
    ignored: (p: string) => {
      const rel = path.relative(wurzel, p);
      return rel !== '' && rel.split(path.sep).some((t) => t.startsWith('.'));
    },
    awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
  });
  const rel = (p: string) => path.relative(wurzel, p).split(path.sep).join('/');
  w.on('add', (p) => melden(rel(p), 'angelegt'));
  w.on('addDir', (p) => p !== wurzel && melden(rel(p), 'angelegt'));
  w.on('change', (p) => melden(rel(p), 'geaendert'));
  w.on('unlink', (p) => melden(rel(p), 'geloescht'));
  w.on('unlinkDir', (p) => melden(rel(p), 'geloescht'));
  return w;
}
