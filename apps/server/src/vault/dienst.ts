import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { Konflikt, SchreibErgebnis, VaultDatei, VaultEintrag } from '@dorf/shared';
import { DorfFehler } from '../fehler.js';
import type { Uhr } from '../uhr.js';
import { promisify } from 'node:util';
import { absolut, dateinameBereinigen, normalisieren, ordnerGriff, sicherOeffnen, type OrdnerGriff } from './pfade.js';

const fdLesen = promisify(fs.readFile) as (fd: number) => Promise<Buffer>;

export const PAPIERKORB = '.papierkorb';
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const KONFLIKT_MUSTER = /\.(sync-conflict-|konflikt-)/;

export type AenderungsArt = 'angelegt' | 'geaendert' | 'geloescht';
export type Beobachter = (pfad: string, art: AenderungsArt) => void;

export function versionVon(inhalt: Buffer | string) {
  return crypto.createHash('sha256').update(inhalt).digest('hex');
}

function zeitstempel(ms: number) {
  const d = new Date(ms);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

/**
 * Einziger Weg, wie das Dorf Dateien im Vault liest und schreibt.
 * - nie aus dem Vault heraus (Pfadprüfung; seit E195 wettlauf-sicher: jeder Zugriff geht Ordner für Ordner über
 *   Dateideskriptoren mit O_NOFOLLOW, siehe pfade.ts – Symlinks im Vault werden nie verfolgt, auch nicht, wenn sie
 *   ein Agent mit Shell zwischen Prüfung und Zugriff unterschiebt)
 * - atomares Schreiben (temporäre Datei + rename)
 * - Konfliktschutz: wurde eine Datei zwischendurch woanders geändert, entsteht eine Konfliktkopie statt Überschreiben
 * - Löschen verschiebt in den Papierkorb
 */
export class VaultDienst {
  private beobachter = new Set<Beobachter>();

  constructor(
    public readonly wurzel: string,
    private uhr: Uhr,
  ) {
    fs.mkdirSync(wurzel, { recursive: true });
    this.wurzel = fs.realpathSync(wurzel);
  }

  beobachten(fn: Beobachter) {
    this.beobachter.add(fn);
    return () => this.beobachter.delete(fn);
  }

  private melden(pfad: string, art: AenderungsArt) {
    for (const fn of this.beobachter) fn(pfad, art);
  }

  /**
   * Absoluter Pfad (Momentaufnahme!). Nur für Dinge, die keinen Inhalt lesen oder schreiben (z. B. Schreibrecht der Wurzel,
   * Tests). Lesen/Schreiben/Auflisten immer über die Methoden unten – die folgen keinem Symlink (E195).
   */
  abs(rel: string) {
    return absolut(this.wurzel, rel);
  }

  /** Datei oder Ordner sicher öffnen, `fn` bekommt Deskriptor + fstat; null, wenn es den Pfad nicht gibt. */
  private async mitFd<T>(rel: string, fn: (fd: number, st: fs.Stats) => T | Promise<T>): Promise<T | null> {
    const fd = sicherOeffnen(this.wurzel, rel);
    if (fd === null) return null;
    try {
      return await fn(fd, fs.fstatSync(fd));
    } finally {
      fs.closeSync(fd);
    }
  }

  private griff(rel: string, anlegen = false): OrdnerGriff | null {
    return ordnerGriff(this.wurzel, rel, anlegen);
  }

  private griffPflicht(rel: string, anlegen = false): OrdnerGriff {
    const g = this.griff(rel, anlegen);
    if (!g) throw new DorfFehler(anlegen ? 409 : 404, anlegen ? 'Dort liegt eine Datei, kein Ordner.' : 'Nicht gefunden.');
    return g;
  }

  /** Größe/Art/Zeit eines Eintrags – folgt keinem Symlink; null, wenn es ihn nicht gibt. `rel` wird normalisiert. */
  async stat(relRoh: string, opt: { versteckteErlaubt?: boolean } = {}): Promise<fs.Stats | null> {
    return this.statJetzt(relRoh, opt);
  }

  /** Wie stat, ohne Promise (für die wenigen synchronen Stellen); ein Symlink im Weg zählt als „gibt es nicht“. */
  statJetzt(relRoh: string, opt: { versteckteErlaubt?: boolean } = {}): fs.Stats | null {
    let fd: number | null;
    try {
      fd = sicherOeffnen(this.wurzel, normalisieren(relRoh, opt));
    } catch (e) {
      if (e instanceof DorfFehler) return null;
      throw e;
    }
    if (fd === null) return null;
    try {
      return fs.fstatSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  /** Wie namen, ohne Promise. */
  namenJetzt(relRoh: string, opt: { versteckteErlaubt?: boolean } = {}): { name: string; ordner: boolean; datei: boolean }[] {
    let g: OrdnerGriff | null;
    try {
      g = this.griff(normalisieren(relRoh, opt));
    } catch (e) {
      if (e instanceof DorfFehler) return [];
      throw e;
    }
    if (!g) return [];
    try {
      return fs
        .readdirSync(g.selbst, { withFileTypes: true })
        .filter((n) => (opt.versteckteErlaubt || !n.name.startsWith('.')) && (n.isDirectory() || n.isFile()))
        .map((n) => ({ name: n.name, ordner: n.isDirectory(), datei: n.isFile() }));
    } finally {
      g.zu();
    }
  }

  /** Inhalt einer Datei als Puffer (für Binäres und alles, was nicht die Textansicht ist); null, wenn es keine Datei ist. */
  async puffer(relRoh: string, opt: { versteckteErlaubt?: boolean; max?: number } = {}): Promise<{ inhalt: Buffer; st: fs.Stats } | null> {
    return this.mitFd(normalisieren(relRoh, opt), async (fd, st) => {
      if (!st.isFile()) return null;
      if (opt.max !== undefined && st.size > opt.max) throw new DorfFehler(413, 'Datei zu groß.');
      return { inhalt: await fdLesen(fd), st };
    });
  }

  /** Text einer Datei oder null (fehlt / kein gewöhnliche Datei) – für Stellen, die früher `readFile(vault.abs(…))` riefen. */
  async text(relRoh: string, opt: { versteckteErlaubt?: boolean; max?: number } = {}): Promise<string | null> {
    return (await this.puffer(relRoh, opt))?.inhalt.toString('utf8') ?? null;
  }

  /** Namen in einem Ordner (ohne Verstecktes und ohne Symlinks); leer, wenn es den Ordner nicht gibt. */
  async namen(relRoh: string, opt: { versteckteErlaubt?: boolean } = {}): Promise<{ name: string; ordner: boolean; datei: boolean }[]> {
    return this.namenJetzt(relRoh, opt);
  }

  async baum(relRoh = '', tiefe = Infinity): Promise<VaultEintrag> {
    const rel = normalisieren(relRoh);
    const st = await this.stat(rel);
    if (!st) throw new DorfFehler(404, 'Nicht gefunden.');
    return this.eintrag(rel, st, tiefe);
  }

  private async eintrag(rel: string, st: fs.Stats, tiefe: number): Promise<VaultEintrag> {
    const name = rel === '' ? 'Vault' : path.posix.basename(rel);
    if (!st.isDirectory()) {
      return { pfad: rel, name, art: 'datei', groesse: st.size, geaendert: st.mtime.toISOString() };
    }
    const e: VaultEintrag = { pfad: rel, name, art: 'ordner', geaendert: st.mtime.toISOString() };
    if (tiefe > 0) {
      const kinder: VaultEintrag[] = [];
      for (const n of await this.namen(rel)) {
        const kRel = rel ? `${rel}/${n.name}` : n.name;
        const kSt = await this.stat(kRel).catch(() => null); // inzwischen gegen einen Symlink getauscht → auslassen
        if (!kSt) continue;
        kinder.push(await this.eintrag(kRel, kSt, tiefe - 1));
      }
      kinder.sort((a, b) => (a.art !== b.art ? (a.art === 'ordner' ? -1 : 1) : a.name.localeCompare(b.name, 'de')));
      e.kinder = kinder;
    }
    return e;
  }

  async existiert(relRoh: string) {
    return (await this.stat(relRoh)) !== null;
  }

  /** Gibt es dort schon etwas? (auch ein Symlink zählt – er wird nie überschrieben oder verfolgt) */
  private belegt(g: OrdnerGriff, name: string) {
    return fs.lstatSync(g.pfad(name), { throwIfNoEntry: false }) !== undefined;
  }

  async lesen(relRoh: string): Promise<VaultDatei> {
    const rel = normalisieren(relRoh);
    const r = await this.mitFd(rel, async (fd, st) => {
      if (!st.isFile()) return null;
      if (st.size > MAX_TEXT_BYTES) throw new DorfFehler(413, 'Datei zu groß für die Textansicht – bitte herunterladen.');
      return { buf: await fdLesen(fd), st };
    });
    if (!r) throw new DorfFehler(404, 'Datei nicht gefunden.');
    return { pfad: rel, inhalt: r.buf.toString('utf8'), version: versionVon(r.buf), geaendert: r.st.mtime.toISOString() };
  }

  /** Für Downloads und Binärdateien. Der Strom liest über den geprüften Deskriptor und schließt ihn selbst. */
  rohOeffnen(relRoh: string) {
    const rel = normalisieren(relRoh);
    const fd = sicherOeffnen(this.wurzel, rel);
    if (fd === null) throw new DorfFehler(404, 'Datei nicht gefunden.');
    const st = fs.fstatSync(fd);
    if (!st.isFile()) {
      fs.closeSync(fd);
      throw new DorfFehler(404, 'Datei nicht gefunden.');
    }
    return { rel, groesse: st.size, strom: fs.createReadStream('', { fd, autoClose: true }) };
  }

  async schreiben(
    relRoh: string,
    inhalt: string | Buffer,
    opt: { basisVersion?: string; nurNeu?: boolean } = {},
  ): Promise<SchreibErgebnis> {
    const rel = normalisieren(relRoh);
    if (!rel) throw new DorfFehler(400, 'Dateiname fehlt.');
    const da = await this.mitFd(rel, async (fd, st) => ({ ordner: st.isDirectory(), vorher: st.isFile() ? await fdLesen(fd) : null }));
    const vorher = da?.vorher ?? null;
    if (vorher && opt.nurNeu) throw new DorfFehler(409, 'Eine Datei mit diesem Namen gibt es schon.');
    if (da?.ordner) throw new DorfFehler(409, 'Dort liegt ein Ordner.');

    if (vorher && opt.basisVersion && versionVon(vorher) !== opt.basisVersion) {
      const konfliktRel = this.konfliktName(rel);
      await this.atomarSchreiben(konfliktRel, inhalt);
      this.melden(konfliktRel, 'angelegt');
      return { pfad: rel, version: versionVon(vorher), konflikt: true, konfliktPfad: konfliktRel };
    }
    await this.atomarSchreiben(rel, inhalt);
    this.melden(rel, vorher ? 'geaendert' : 'angelegt');
    return { pfad: rel, version: versionVon(inhalt), konflikt: false };
  }

  konfliktName(rel: string) {
    const ext = path.posix.extname(rel);
    const basis = rel.slice(0, rel.length - ext.length);
    let kandidat = `${basis}.konflikt-${zeitstempel(this.uhr.jetzt())}${ext}`;
    let i = 2;
    while (fs.existsSync(this.abs(kandidat))) kandidat = `${basis}.konflikt-${zeitstempel(this.uhr.jetzt())}-${i++}${ext}`;
    return kandidat;
  }

  /**
   * Temporäre Datei + rename – beides im geöffneten Zielordner (E195): Der Ordner kann danach nicht mehr gegen einen
   * Symlink getauscht werden; die temporäre Datei entsteht mit O_EXCL (ein untergeschobener Symlink gleichen Namens
   * wird nicht verfolgt), und rename ersetzt einen Symlink am Ziel, statt ihm zu folgen.
   */
  private async atomarSchreiben(rel: string, inhalt: string | Buffer) {
    const g = this.griffPflicht(path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel), true);
    const name = path.posix.basename(rel);
    const tmp = `.${name}.dorf-tmp-${crypto.randomBytes(4).toString('hex')}`;
    try {
      await fsp.writeFile(g.pfad(tmp), inhalt, { flag: 'wx' });
      await fsp.rename(g.pfad(tmp), g.pfad(name));
    } catch (e) {
      await fsp.rm(g.pfad(tmp), { force: true }).catch(() => {});
      throw e;
    } finally {
      g.zu();
    }
  }

  private eltern(rel: string) {
    const d = path.posix.dirname(rel);
    return { ordner: d === '.' ? '' : d, name: path.posix.basename(rel) };
  }

  async ordnerAnlegen(relRoh: string) {
    const rel = normalisieren(relRoh);
    if (!rel) throw new DorfFehler(400, 'Ordnername fehlt.');
    if (await this.existiert(rel)) throw new DorfFehler(409, 'Gibt es schon.');
    this.griffPflicht(rel, true).zu();
    this.melden(rel, 'angelegt');
    return rel;
  }

  async verschieben(vonRoh: string, nachRoh: string) {
    const von = normalisieren(vonRoh);
    const nach = normalisieren(nachRoh);
    if (!von || !nach) throw new DorfFehler(400, 'Pfad fehlt.');
    if (nach === von || nach.startsWith(von + '/')) throw new DorfFehler(400, 'Ein Ordner kann nicht in sich selbst verschoben werden.');
    const a = this.eltern(von);
    const b = this.eltern(nach);
    const ga = this.griff(a.ordner);
    if (!ga) throw new DorfFehler(404, 'Nicht gefunden.');
    let gb: OrdnerGriff | null = null;
    try {
      if (!this.belegt(ga, a.name)) throw new DorfFehler(404, 'Nicht gefunden.');
      gb = this.griffPflicht(b.ordner, true);
      if (this.belegt(gb, b.name)) throw new DorfFehler(409, 'Am Ziel liegt schon etwas.');
      await fsp.rename(ga.pfad(a.name), gb.pfad(b.name));
    } finally {
      ga.zu();
      gb?.zu();
    }
    this.melden(von, 'geloescht');
    this.melden(nach, 'angelegt');
    return nach;
  }

  /** Verschiebt in den Papierkorb (.papierkorb/<zeit>/<pfad>). Nichts wird endgültig gelöscht. */
  async loeschen(relRoh: string) {
    const rel = normalisieren(relRoh);
    if (!rel) throw new DorfFehler(400, 'Der Vault selbst kann nicht gelöscht werden.');
    const a = this.eltern(rel);
    const ga = this.griff(a.ordner);
    if (!ga) throw new DorfFehler(404, 'Nicht gefunden.');
    const zielRel = `${PAPIERKORB}/${zeitstempel(this.uhr.jetzt())}/${rel}`;
    let gb: OrdnerGriff | null = null;
    try {
      if (!this.belegt(ga, a.name)) throw new DorfFehler(404, 'Nicht gefunden.');
      gb = this.griffPflicht(this.eltern(zielRel).ordner, true);
      await fsp.rename(ga.pfad(a.name), gb.pfad(a.name));
    } finally {
      ga.zu();
      gb?.zu();
    }
    this.melden(rel, 'geloescht');
    return zielRel;
  }

  /** Speichert einen hochgeladenen Strom. Gleichnamige Dateien bekommen " (2)" usw. */
  async hochladen(ordnerRoh: string, dateiname: string, strom: Readable): Promise<string> {
    const ordner = normalisieren(ordnerRoh);
    const name = dateinameBereinigen(dateiname);
    const ext = path.posix.extname(name);
    const basis = name.slice(0, name.length - ext.length);
    const g = this.griffPflicht(ordner, true);
    let ziel = name;
    let i = 2;
    const tmp = `.${name}.dorf-tmp-${crypto.randomBytes(4).toString('hex')}`;
    try {
      while (this.belegt(g, ziel)) ziel = `${basis} (${i++})${ext}`;
      await pipeline(strom, fs.createWriteStream(g.pfad(tmp), { flags: 'wx' }));
      if ((strom as Readable & { truncated?: boolean }).truncated) throw new DorfFehler(413, 'Datei zu groß.');
      await fsp.rename(g.pfad(tmp), g.pfad(ziel));
    } catch (e) {
      await fsp.rm(g.pfad(tmp), { force: true }).catch(() => {});
      throw e;
    } finally {
      g.zu();
    }
    const rel = ordner ? `${ordner}/${ziel}` : ziel;
    this.melden(rel, 'angelegt');
    return rel;
  }

  /** Alle Konfliktdateien (von Syncthing oder vom Dorf angelegt). */
  async konflikte(): Promise<Konflikt[]> {
    const aus: Konflikt[] = [];
    const laufen = async (rel: string) => {
      for (const n of await this.namen(rel)) {
        const kRel = rel ? `${rel}/${n.name}` : n.name;
        if (n.ordner) await laufen(kRel);
        else if (KONFLIKT_MUSTER.test(n.name)) {
          const st = await this.stat(kRel).catch(() => null);
          if (!st) continue;
          const quelle = n.name.includes('.sync-conflict-') ? 'syncthing' : 'dorf';
          const original = kRel.replace(/\.(sync-conflict-[^.]+|konflikt-[0-9-]+)/, '');
          aus.push({ pfad: kRel, original, quelle, geaendert: st.mtime.toISOString() });
        }
      }
    };
    await laufen('');
    return aus;
  }

  static istKonflikt(rel: string) {
    return KONFLIKT_MUSTER.test(rel);
  }

  /** Alle Dateien (für den Suchindex) – ohne Verstecktes, ohne Symlinks. */
  async *alleDateien(rel = ''): AsyncGenerator<{ rel: string; st: fs.Stats }> {
    for (const n of await this.namen(rel)) {
      const kRel = rel ? `${rel}/${n.name}` : n.name;
      if (n.ordner) yield* this.alleDateien(kRel);
      else {
        const st = await this.stat(kRel).catch(() => null);
        if (st?.isFile()) yield { rel: kRel, st };
      }
    }
  }

  /** Füllt einen leeren Vault aus der Vorlage. Mit `ergaenzen` werden nur fehlende Dateien kopiert – nie überschrieben. */
  async ausVorlage(vorlage: string, opt: { ergaenzen?: boolean } = {}): Promise<number> {
    const leer = (await fsp.readdir(this.wurzel)).filter((n) => !n.startsWith('.')).length === 0;
    if (!leer && !opt.ergaenzen) return 0;
    let n = 0;
    // E195: auch hier nur über Deskriptoren – ein untergeschobener Symlink-Ordner bekäme sonst Vorlagendateien nach draußen
    const kopieren = async (von: string, rel: string) => {
      for (const e of await fsp.readdir(von, { withFileTypes: true })) {
        const a = path.join(von, e.name);
        const kRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          this.griffPflicht(kRel, true).zu();
          await kopieren(a, kRel);
        } else if (e.name !== '.gitkeep') {
          const { ordner, name } = this.eltern(kRel);
          const g = this.griffPflicht(ordner, true);
          const frei = !this.belegt(g, name);
          g.zu();
          if (!frei) continue;
          await this.atomarSchreiben(kRel, await fsp.readFile(a));
          n++;
        }
      }
    };
    await kopieren(vorlage, '');
    return n;
  }
}
