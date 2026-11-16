import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { Konflikt, SchreibErgebnis, VaultDatei, VaultEintrag } from '@dorf/shared';
import { DorfFehler } from '../fehler.js';
import type { Uhr } from '../uhr.js';
import { absolut, dateinameBereinigen, normalisieren } from './pfade.js';

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
 * - nie aus dem Vault heraus (Pfadprüfung)
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

  abs(rel: string) {
    return absolut(this.wurzel, rel);
  }

  async baum(relRoh = '', tiefe = Infinity): Promise<VaultEintrag> {
    const rel = normalisieren(relRoh);
    const abs = this.abs(rel);
    const st = await fsp.stat(abs).catch(() => null);
    if (!st) throw new DorfFehler(404, 'Nicht gefunden.');
    return this.eintrag(rel, abs, st, tiefe);
  }

  private async eintrag(rel: string, abs: string, st: fs.Stats, tiefe: number): Promise<VaultEintrag> {
    const name = rel === '' ? 'Vault' : path.posix.basename(rel);
    if (!st.isDirectory()) {
      return { pfad: rel, name, art: 'datei', groesse: st.size, geaendert: st.mtime.toISOString() };
    }
    const e: VaultEintrag = { pfad: rel, name, art: 'ordner', geaendert: st.mtime.toISOString() };
    if (tiefe > 0) {
      const namen = (await fsp.readdir(abs)).filter((n) => !n.startsWith('.'));
      const kinder: VaultEintrag[] = [];
      for (const n of namen) {
        const kAbs = path.join(abs, n);
        const kSt = await fsp.lstat(kAbs).catch(() => null);
        if (!kSt || kSt.isSymbolicLink()) continue;
        kinder.push(await this.eintrag(rel ? `${rel}/${n}` : n, kAbs, kSt, tiefe - 1));
      }
      kinder.sort((a, b) => (a.art !== b.art ? (a.art === 'ordner' ? -1 : 1) : a.name.localeCompare(b.name, 'de')));
      e.kinder = kinder;
    }
    return e;
  }

  async existiert(relRoh: string) {
    return fs.existsSync(this.abs(normalisieren(relRoh)));
  }

  async lesen(relRoh: string): Promise<VaultDatei> {
    const rel = normalisieren(relRoh);
    const abs = this.abs(rel);
    const st = await fsp.stat(abs).catch(() => null);
    if (!st || !st.isFile()) throw new DorfFehler(404, 'Datei nicht gefunden.');
    if (st.size > MAX_TEXT_BYTES) throw new DorfFehler(413, 'Datei zu groß für die Textansicht – bitte herunterladen.');
    const buf = await fsp.readFile(abs);
    return { pfad: rel, inhalt: buf.toString('utf8'), version: versionVon(buf), geaendert: st.mtime.toISOString() };
  }

  /** Für Downloads und Binärdateien. */
  rohOeffnen(relRoh: string) {
    const rel = normalisieren(relRoh);
    const abs = this.abs(rel);
    const st = fs.statSync(abs, { throwIfNoEntry: false });
    if (!st || !st.isFile()) throw new DorfFehler(404, 'Datei nicht gefunden.');
    return { rel, abs, groesse: st.size, strom: fs.createReadStream(abs) };
  }

  async schreiben(
    relRoh: string,
    inhalt: string | Buffer,
    opt: { basisVersion?: string; nurNeu?: boolean } = {},
  ): Promise<SchreibErgebnis> {
    const rel = normalisieren(relRoh);
    if (!rel) throw new DorfFehler(400, 'Dateiname fehlt.');
    const abs = this.abs(rel);
    const vorher = await fsp.readFile(abs).catch(() => null);
    if (vorher && opt.nurNeu) throw new DorfFehler(409, 'Eine Datei mit diesem Namen gibt es schon.');
    if ((await fsp.stat(abs).catch(() => null))?.isDirectory()) throw new DorfFehler(409, 'Dort liegt ein Ordner.');

    if (vorher && opt.basisVersion && versionVon(vorher) !== opt.basisVersion) {
      const konfliktRel = this.konfliktName(rel);
      await this.atomarSchreiben(this.abs(konfliktRel), inhalt);
      this.melden(konfliktRel, 'angelegt');
      return { pfad: rel, version: versionVon(vorher), konflikt: true, konfliktPfad: konfliktRel };
    }
    await this.atomarSchreiben(abs, inhalt);
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

  private async atomarSchreiben(abs: string, inhalt: string | Buffer) {
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.dorf-tmp-${crypto.randomBytes(4).toString('hex')}`);
    await fsp.writeFile(tmp, inhalt);
    await fsp.rename(tmp, abs);
  }

  async ordnerAnlegen(relRoh: string) {
    const rel = normalisieren(relRoh);
    if (!rel) throw new DorfFehler(400, 'Ordnername fehlt.');
    const abs = this.abs(rel);
    if (fs.existsSync(abs)) throw new DorfFehler(409, 'Gibt es schon.');
    await fsp.mkdir(abs, { recursive: true });
    this.melden(rel, 'angelegt');
    return rel;
  }

  async verschieben(vonRoh: string, nachRoh: string) {
    const von = normalisieren(vonRoh);
    const nach = normalisieren(nachRoh);
    if (!von || !nach) throw new DorfFehler(400, 'Pfad fehlt.');
    if (nach === von || nach.startsWith(von + '/')) throw new DorfFehler(400, 'Ein Ordner kann nicht in sich selbst verschoben werden.');
    const a = this.abs(von);
    const b = this.abs(nach);
    if (!fs.existsSync(a)) throw new DorfFehler(404, 'Nicht gefunden.');
    if (fs.existsSync(b)) throw new DorfFehler(409, 'Am Ziel liegt schon etwas.');
    await fsp.mkdir(path.dirname(b), { recursive: true });
    await fsp.rename(a, b);
    this.melden(von, 'geloescht');
    this.melden(nach, 'angelegt');
    return nach;
  }

  /** Verschiebt in den Papierkorb (.papierkorb/<zeit>/<pfad>). Nichts wird endgültig gelöscht. */
  async loeschen(relRoh: string) {
    const rel = normalisieren(relRoh);
    if (!rel) throw new DorfFehler(400, 'Der Vault selbst kann nicht gelöscht werden.');
    const a = this.abs(rel);
    if (!fs.existsSync(a)) throw new DorfFehler(404, 'Nicht gefunden.');
    const ziel = path.join(this.wurzel, PAPIERKORB, zeitstempel(this.uhr.jetzt()), rel);
    await fsp.mkdir(path.dirname(ziel), { recursive: true });
    await fsp.rename(a, ziel);
    this.melden(rel, 'geloescht');
    return path.relative(this.wurzel, ziel).split(path.sep).join('/');
  }

  /** Speichert einen hochgeladenen Strom. Gleichnamige Dateien bekommen " (2)" usw. */
  async hochladen(ordnerRoh: string, dateiname: string, strom: Readable): Promise<string> {
    const ordner = normalisieren(ordnerRoh);
    const name = dateinameBereinigen(dateiname);
    const ext = path.posix.extname(name);
    const basis = name.slice(0, name.length - ext.length);
    let rel = ordner ? `${ordner}/${name}` : name;
    let i = 2;
    while (fs.existsSync(this.abs(rel))) {
      rel = `${ordner ? ordner + '/' : ''}${basis} (${i++})${ext}`;
    }
    const abs = this.abs(rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.dorf-tmp-${crypto.randomBytes(4).toString('hex')}`);
    try {
      await pipeline(strom, fs.createWriteStream(tmp));
      if ((strom as Readable & { truncated?: boolean }).truncated) throw new DorfFehler(413, 'Datei zu groß.');
      await fsp.rename(tmp, abs);
    } catch (e) {
      await fsp.rm(tmp, { force: true });
      throw e;
    }
    this.melden(rel, 'angelegt');
    return rel;
  }

  /** Alle Konfliktdateien (von Syncthing oder vom Dorf angelegt). */
  async konflikte(): Promise<Konflikt[]> {
    const aus: Konflikt[] = [];
    const laufen = async (rel: string) => {
      const abs = this.abs(rel);
      for (const n of await fsp.readdir(abs, { withFileTypes: true })) {
        if (n.name.startsWith('.')) continue;
        const kRel = rel ? `${rel}/${n.name}` : n.name;
        if (n.isDirectory()) await laufen(kRel);
        else if (KONFLIKT_MUSTER.test(n.name)) {
          const st = await fsp.stat(path.join(abs, n.name));
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

  /** Alle Dateien (für den Suchindex). */
  async *alleDateien(rel = ''): AsyncGenerator<{ rel: string; abs: string; st: fs.Stats }> {
    const abs = this.abs(rel);
    for (const n of await fsp.readdir(abs, { withFileTypes: true })) {
      if (n.name.startsWith('.')) continue;
      const kRel = rel ? `${rel}/${n.name}` : n.name;
      const kAbs = path.join(abs, n.name);
      if (n.isDirectory()) yield* this.alleDateien(kRel);
      else if (n.isFile()) yield { rel: kRel, abs: kAbs, st: await fsp.stat(kAbs) };
    }
  }

  /** Füllt einen leeren Vault aus der Vorlage. Mit `ergaenzen` werden nur fehlende Dateien kopiert – nie überschrieben. */
  async ausVorlage(vorlage: string, opt: { ergaenzen?: boolean } = {}): Promise<number> {
    const leer = (await fsp.readdir(this.wurzel)).filter((n) => !n.startsWith('.')).length === 0;
    if (!leer && !opt.ergaenzen) return 0;
    let n = 0;
    const kopieren = async (von: string, nach: string) => {
      for (const e of await fsp.readdir(von, { withFileTypes: true })) {
        const a = path.join(von, e.name);
        const b = path.join(nach, e.name);
        if (e.isDirectory()) {
          await fsp.mkdir(b, { recursive: true });
          await kopieren(a, b);
        } else if (e.name !== '.gitkeep' && !fs.existsSync(b)) {
          await fsp.copyFile(a, b);
          n++;
        }
      }
    };
    await kopieren(vorlage, this.wurzel);
    return n;
  }
}
