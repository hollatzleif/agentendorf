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

/** Absoluter Pfad im Vault. Prüft zusätzlich, dass kein Symlink aus dem Vault hinauszeigt. */
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
