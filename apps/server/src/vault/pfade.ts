import fs from 'node:fs';
import path from 'node:path';
import { DorfFehler } from '../fehler.js';

/**
 * Normalisiert einen vom Client kommenden, vault-relativen Pfad.
 * Erlaubt keine absoluten Pfade, kein "..", keine Steuerzeichen und (standardmäßig) keine versteckten Segmente.
 * Ergebnis: "a/b/c.md" oder "" für die Wurzel.
 */
export function normalisieren(roh: string, opt: { versteckteErlaubt?: boolean } = {}): string {
  if (typeof roh !== 'string') throw new DorfFehler(400, 'Pfad fehlt.');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(roh)) throw new DorfFehler(400, 'Ungültige Zeichen im Pfad.');
  const teile = roh.replace(/\\/g, '/').split('/');
  const aus: string[] = [];
  for (const t of teile) {
    if (t === '' || t === '.') continue;
    if (t === '..') throw new DorfFehler(400, 'Pfad darf nicht aus dem Vault hinausführen.');
    if (t.startsWith('.') && !opt.versteckteErlaubt) throw new DorfFehler(400, 'Versteckte Dateien und Ordner sind hier nicht erlaubt.');
    aus.push(t);
  }
  return aus.join('/');
}

/**
 * Absoluter Pfad im Vault. Prüft zusätzlich, dass kein Symlink aus dem Vault hinauszeigt.
 * ACHTUNG (E195): Das ist nur eine Momentaufnahme – wer in den Vault schreiben kann (Coding-Agent mit Shell, E191),
 * kann nach der Prüfung einen Symlink unterschieben. Zum Lesen und Schreiben deshalb nie diesen Pfad benutzen,
 * sondern `sicherOeffnen` / `ordnerGriff` (bzw. die Methoden des VaultDienstes).
 */
export function absolut(wurzel: string, rel: string): string {
  const abs = path.resolve(wurzel, rel);
  const wurzelEcht = fs.realpathSync(wurzel);
  if (abs !== wurzel && !abs.startsWith(wurzel + path.sep)) throw new DorfFehler(400, 'Pfad liegt außerhalb des Vaults.');
  // nächsten existierenden Vorfahren auflösen
  let p = abs;
  while (!fs.existsSync(p) && p !== wurzel) p = path.dirname(p);
  const echt = fs.realpathSync(p);
  if (echt !== wurzelEcht && !echt.startsWith(wurzelEcht + path.sep)) throw new DorfFehler(400, 'Pfad zeigt aus dem Vault hinaus.');
  return abs;
}

// ---- Wettlauf-sicherer Zugriff (E195) --------------------------------------------------------------
//
// Der Weg in den Vault wird Stück für Stück über Dateideskriptoren gegangen (wie openat): jedes Teilstück wird relativ
// zum schon geöffneten Elternordner mit O_NOFOLLOW geöffnet. Ein Symlink – egal an welcher Stelle und egal, wann er
// untergeschoben wird – lässt das Öffnen scheitern; gelesen und geschrieben wird danach nur über den Deskriptor.
// Node kennt kein openat; auf Linux leistet `/proc/self/fd/<fd>/<name>` dasselbe. Ohne /proc (Entwicklung am Mac)
// bleibt es bei der alten Prüfung plus O_NOFOLLOW am Ende – dort gibt es keine Agenten mit Shell.
//
// Hardlinks: Ein harter Link im Vault auf eine Datei außerhalb lässt sich so nicht erkennen. Er ist aber nur innerhalb
// desselben Dateisystems möglich (nicht auf /proc, nicht auf /daten in einem anderen Mount), und der Coding-Container
// sieht außer /vault und /arbeit nichts vom Server – er kann also nur verlinken, was er ohnehin lesen darf.

const PROC = '/proc/self/fd';
const HAT_PROC = process.platform === 'linux' && fs.existsSync(PROC);
const { O_RDONLY, O_DIRECTORY, O_NOFOLLOW, O_NONBLOCK } = fs.constants;

function symlinkFehler(e: unknown): never {
  const code = (e as NodeJS.ErrnoException).code;
  if (code === 'ELOOP' || code === 'EMLINK') throw new DorfFehler(400, 'Pfad zeigt aus dem Vault hinaus (Verknüpfungen sind im Vault nicht erlaubt).');
  throw e;
}

/** Öffnet ein Teilstück unter einem offenen Ordner – nie über einen Symlink. */
function kindOeffnen(elternFd: number, name: string, flags: number): number {
  const p = `${PROC}/${elternFd}/${name}`;
  try {
    return fs.openSync(p, flags | O_NOFOLLOW);
  } catch (e) {
    // O_DIRECTORY|O_NOFOLLOW auf einem Symlink meldet ENOTDIR – unterscheiden, damit die Meldung stimmt
    if ((e as NodeJS.ErrnoException).code === 'ENOTDIR' && fs.lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink())
      throw new DorfFehler(400, 'Pfad zeigt aus dem Vault hinaus (Verknüpfungen sind im Vault nicht erlaubt).');
    return symlinkFehler(e);
  }
}

/** Geht die Ordner von `teile` ab der Wurzel und gibt den Deskriptor des letzten zurück (Aufrufer schließt ihn). */
function ordnerFd(wurzel: string, teile: string[], anlegen: boolean): number {
  let fd = fs.openSync(wurzel, O_RDONLY | O_DIRECTORY);
  try {
    for (const t of teile) {
      let naechster: number;
      try {
        naechster = kindOeffnen(fd, t, O_RDONLY | O_DIRECTORY);
      } catch (e) {
        if (!anlegen || (e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        try {
          fs.mkdirSync(`${PROC}/${fd}/${t}`);
        } catch (m) {
          if ((m as NodeJS.ErrnoException).code !== 'EEXIST') throw m;
        }
        naechster = kindOeffnen(fd, t, O_RDONLY | O_DIRECTORY);
      }
      fs.closeSync(fd);
      fd = naechster;
    }
    return fd;
  } catch (e) {
    fs.closeSync(fd);
    throw e;
  }
}

function teileVon(rel: string) {
  return rel.split('/').filter(Boolean);
}

/**
 * Öffnet eine Datei oder einen Ordner im Vault zum Lesen – ohne je einem Symlink zu folgen.
 * `rel` muss schon normalisiert sein. Rückgabe: Deskriptor (Aufrufer schließt ihn) oder null, wenn es den Pfad nicht gibt.
 */
export function sicherOeffnen(wurzel: string, rel: string): number | null {
  const teile = teileVon(rel);
  if (!HAT_PROC) {
    try {
      const abs = absolut(wurzel, rel);
      const fd = fs.openSync(abs, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
      const echt = fs.realpathSync(abs);
      const a = fs.fstatSync(fd);
      const b = fs.statSync(echt);
      const w = fs.realpathSync(wurzel);
      if (a.ino !== b.ino || a.dev !== b.dev || (echt !== w && !echt.startsWith(w + path.sep))) {
        fs.closeSync(fd);
        throw new DorfFehler(400, 'Pfad zeigt aus dem Vault hinaus.');
      }
      return fd;
    } catch (e) {
      if (['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '')) return null;
      return symlinkFehler(e);
    }
  }
  const name = teile.pop();
  let ordner: number;
  try {
    ordner = ordnerFd(wurzel, teile, false);
  } catch (e) {
    if (['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '')) return null;
    throw e;
  }
  if (name === undefined) return ordner;
  try {
    // O_NONBLOCK: eine untergeschobene FIFO darf das Dorf nicht aufhängen (für gewöhnliche Dateien ohne Wirkung)
    return kindOeffnen(ordner, name, O_RDONLY | O_NONBLOCK);
  } catch (e) {
    if (['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '')) return null;
    throw e;
  } finally {
    fs.closeSync(ordner);
  }
}

/** Ein geöffneter Ordner im Vault: Pfade für Einträge darin, die nicht mehr umgebogen werden können. */
export interface OrdnerGriff {
  /** Pfad eines Eintrags in diesem Ordner (nur ein Name, kein Unterpfad) – für open/rename/lstat/mkdir */
  pfad(name: string): string;
  /** Pfad des Ordners selbst (readdir) */
  selbst: string;
  zu(): void;
}

/** Öffnet den Ordner `rel` (normalisiert) im Vault – nie über einen Symlink; mit `anlegen` wie mkdir -p. */
export function ordnerGriff(wurzel: string, rel: string, anlegen = false): OrdnerGriff | null {
  if (!HAT_PROC) {
    const abs = absolut(wurzel, rel);
    if (anlegen) fs.mkdirSync(abs, { recursive: true });
    if (!fs.statSync(absolut(wurzel, rel), { throwIfNoEntry: false })?.isDirectory()) return null;
    return { pfad: (n) => path.join(abs, n), selbst: abs, zu: () => {} };
  }
  let fd: number;
  try {
    fd = ordnerFd(wurzel, teileVon(rel), anlegen);
  } catch (e) {
    if (['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '')) return null;
    throw e;
  }
  let offen = true;
  return {
    pfad: (n) => {
      if (!n || n === '.' || n === '..' || n.includes('/')) throw new DorfFehler(400, 'Ungültiger Name.');
      return `${PROC}/${fd}/${n}`;
    },
    selbst: `${PROC}/${fd}`,
    zu: () => {
      if (offen) fs.closeSync(fd);
      offen = false;
    },
  };
}

const UMLAUTE: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' };
const RESERVIERT = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/**
 * Macht aus einem beliebigen Namen einen Dateinamen, der auf macOS, Windows, Linux und in Syncthing funktioniert:
 * Umlaute werden umgeschrieben, Sonderzeichen ersetzt, reservierte Windows-Namen vermieden.
 */
export function dateinameBereinigen(name: string): string {
  let n = name.normalize('NFC').replace(/[äöüÄÖÜß]/g, (z) => UMLAUTE[z] ?? z);
  n = n.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  n = n.replace(/[^A-Za-z0-9._ ()+-]/g, '-').replace(/-{2,}/g, '-');
  n = n.replace(/^[.\s-]+/, '').replace(/[.\s]+$/, '');
  if (n.length > 120) {
    const ext = path.extname(n).slice(0, 10);
    n = n.slice(0, 120 - ext.length) + ext;
  }
  if (!n || RESERVIERT.test(n)) n = `datei-${n || 'ohne-namen'}`;
  return n;
}
