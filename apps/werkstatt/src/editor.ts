import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Editor im Codehaus (E197): Dateizugriff, Suche und Git für den Editor in der Dorf-App – nur im Profil „coding“.
 *
 * Regeln (gleiche Sorgfalt wie der Vault seit E195):
 * - Jeder Pfad liegt unter <arbeit>/<projekt>; „projekt“ ist ein einzelner Ordnername, „pfad“ ist relativ, ohne „..“,
 *   ohne leere Teile, ohne Steuerzeichen. `.git` ist über den Editor nicht erreichbar (Git läuft über feste Befehle).
 * - Symlinks werden NIE verfolgt: Der Weg wird Ordner für Ordner über Dateideskriptoren mit O_NOFOLLOW gegangen
 *   (/proc/self/fd/<fd>/<name> leistet auf Linux dasselbe wie openat). Im Projekt arbeiten Agenten mit Shell – ein
 *   untergeschobener Link darf den Editor nie aus dem Projekt hinausführen (lesen wie schreiben).
 * - Grenzen: Text bis 2 MB im Editor, Hochladen bis 20 MB, Herunterladen bis 200 MB; Binärdateien nur als Download.
 * - Löschen = Papierkorb (<arbeit>/.papierkorb/<projekt>/…, 14 Tage).
 * - Git und ripgrep laufen mit festen Argumentlisten (nie über eine Shell) im Projektordner.
 */

export class EditorFehler extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const PROJEKT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const TEXT_MAX = 2 * 1024 * 1024;
export const HOCHLADEN_MAX = 20 * 1024 * 1024;
export const ROH_MAX = 200 * 1024 * 1024;
const BAUM_MAX = 3000;
const PAPIERKORB = '.papierkorb';
const PAPIERKORB_TAGE = 14;

const PROC = '/proc/self/fd';
const HAT_PROC = process.platform === 'linux' && fs.existsSync(PROC);
const { O_RDONLY, O_WRONLY, O_CREAT, O_EXCL, O_DIRECTORY, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
const code = (e: unknown) => (e as NodeJS.ErrnoException).code ?? '';

export function projektPruefen(projekt: unknown): string {
  if (typeof projekt !== 'string' || !PROJEKT.test(projekt)) throw new EditorFehler(400, 'Ungültiger Projektname.');
  return projekt;
}

/** Relativer Pfad im Projekt → Teile. Leer = Projektwurzel (nur wo `leerErlaubt`). */
export function pfadTeile(pfad: unknown, leerErlaubt = false): string[] {
  if (typeof pfad !== 'string' || pfad.length > 1000) throw new EditorFehler(400, 'Ungültiger Pfad.');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(pfad)) throw new EditorFehler(400, 'Ungültige Zeichen im Pfad.');
  if (pfad === '') {
    if (leerErlaubt) return [];
    throw new EditorFehler(400, 'Pfad fehlt.');
  }
  if (pfad.startsWith('/')) throw new EditorFehler(400, 'Nur Pfade innerhalb des Projekts (kein absoluter Pfad).');
  const teile = pfad.split('/');
  for (const t of teile) {
    if (t === '' || t === '.' || t === '..') throw new EditorFehler(400, 'Der Pfad darf nicht aus dem Projekt hinausführen.');
    if (t === '.git') throw new EditorFehler(400, '.git ist über den Editor nicht erreichbar – nimm die Git-Leiste oder das Terminal.');
    if (t.length > 255) throw new EditorFehler(400, 'Name zu lang.');
  }
  return teile;
}

function symlink(): never {
  throw new EditorFehler(400, 'Verknüpfungen (Symlinks) öffnet der Editor nicht – der Pfad könnte aus dem Projekt hinausführen.');
}

/** Öffnet `name` unter dem offenen Ordner – nie über einen Symlink. */
function kindOeffnen(elternFd: number, name: string, flags: number, modus?: number): number {
  const p = `${PROC}/${elternFd}/${name}`;
  try {
    return fs.openSync(p, flags | O_NOFOLLOW, modus);
  } catch (e) {
    if (code(e) === 'ELOOP' || code(e) === 'EMLINK') symlink();
    if (code(e) === 'ENOTDIR' && fs.lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink()) symlink();
    throw e;
  }
}

/** Ein geöffneter Ordner: Pfade für Einträge darin, die sich nicht mehr umbiegen lassen. */
interface Griff {
  fd: number;
  pfad(name: string): string;
  selbst: string;
  zu(): void;
}

function griffOeffnen(wurzel: string, teile: string[], anlegen = false): Griff {
  if (!HAT_PROC) {
    // Ohne /proc (Entwicklung am Mac): Momentaufnahme über realpath – dort gibt es keine Agenten mit Shell.
    const abs = path.join(wurzel, ...teile);
    if (anlegen) fs.mkdirSync(abs, { recursive: true });
    const echt = fs.realpathSync(abs);
    const w = fs.realpathSync(wurzel);
    if (echt !== path.join(w, ...teile)) symlink();
    if (!fs.statSync(echt).isDirectory()) throw Object.assign(new Error('kein Ordner'), { code: 'ENOTDIR' });
    return { fd: -1, pfad: (n) => path.join(echt, n), selbst: echt, zu: () => {} };
  }
  let fd = fs.openSync(wurzel, O_RDONLY | O_DIRECTORY);
  try {
    for (const t of teile) {
      let naechster: number;
      try {
        naechster = kindOeffnen(fd, t, O_RDONLY | O_DIRECTORY);
      } catch (e) {
        if (!anlegen || code(e) !== 'ENOENT') throw e;
        try {
          fs.mkdirSync(`${PROC}/${fd}/${t}`);
        } catch (m) {
          if (code(m) !== 'EEXIST') throw m;
        }
        naechster = kindOeffnen(fd, t, O_RDONLY | O_DIRECTORY);
      }
      fs.closeSync(fd);
      fd = naechster;
    }
  } catch (e) {
    fs.closeSync(fd);
    throw e;
  }
  let offen = true;
  const f = fd;
  return {
    fd: f,
    pfad: (n) => `${PROC}/${f}/${n}`,
    selbst: `${PROC}/${f}`,
    zu: () => {
      if (offen) fs.closeSync(f);
      offen = false;
    },
  };
}

/** Systemfehler → verständliche Meldung mit passendem Status */
function uebersetzen(e: unknown): never {
  if (e instanceof EditorFehler) throw e;
  const c = code(e);
  if (c === 'ENOENT' || c === 'ENOTDIR') throw new EditorFehler(404, 'Datei oder Ordner gibt es nicht (mehr).');
  if (c === 'EEXIST' || c === 'ENOTEMPTY') throw new EditorFehler(409, 'Das gibt es schon.');
  if (c === 'EISDIR') throw new EditorFehler(400, 'Das ist ein Ordner.');
  if (c === 'EACCES' || c === 'EPERM' || c === 'EROFS') throw new EditorFehler(403, 'Keine Berechtigung für diesen Pfad.');
  if (c === 'ENOSPC') throw new EditorFehler(507, 'Kein Platz mehr auf der Platte.');
  throw e;
}

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

function istText(b: Buffer): boolean {
  if (b.subarray(0, 8192).includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
}

export interface BaumEintrag {
  name: string;
  art: 'ordner' | 'datei' | 'link' | 'sonst';
  groesse?: number;
}

export class Editor {
  constructor(
    private arbeit: string,
    private umgebung: () => NodeJS.ProcessEnv,
  ) {}

  /** Ordner unter <arbeit>/<projekt>/… öffnen (das Projekt selbst muss ein echter Ordner sein). */
  private griff(projekt: string, teile: string[], anlegen = false): Griff {
    projektPruefen(projekt);
    try {
      return griffOeffnen(this.arbeit, [projekt, ...teile], anlegen);
    } catch (e) {
      if (teile.length === 0 && (code(e) === 'ENOENT' || code(e) === 'ENOTDIR')) throw new EditorFehler(404, `Das Projekt „${projekt}“ gibt es nicht.`);
      return uebersetzen(e);
    }
  }

  /** Projektordner als gewöhnlicher Pfad (für cwd von git/rg) – nur wenn er ein echter Ordner ist, kein Symlink. */
  projektOrdner(projekt: string): string {
    projektPruefen(projekt);
    const p = path.join(this.arbeit, projekt);
    const s = fs.lstatSync(p, { throwIfNoEntry: false });
    if (!s) throw new EditorFehler(404, `Das Projekt „${projekt}“ gibt es nicht.`);
    if (!s.isDirectory()) symlink();
    return p;
  }

  projektAnlegen(projekt: string) {
    projektPruefen(projekt);
    try {
      fs.mkdirSync(path.join(this.arbeit, projekt));
    } catch (e) {
      if (code(e) === 'EEXIST') throw new EditorFehler(409, `Das Projekt „${projekt}“ gibt es schon.`);
      uebersetzen(e);
    }
    return { ok: true, projekt };
  }

  /** Einträge EINES Ordners (der Baum lädt Ordner erst beim Aufklappen). */
  baum(projekt: string, pfad: string): { pfad: string; eintraege: BaumEintrag[]; gekuerzt: boolean } {
    const g = this.griff(projekt, pfadTeile(pfad, true));
    try {
      const alle = fs.readdirSync(g.selbst, { withFileTypes: true }).filter((e) => e.name !== '.git');
      const eintraege: BaumEintrag[] = alle.slice(0, BAUM_MAX).map((e) => {
        if (e.isSymbolicLink()) return { name: e.name, art: 'link' };
        if (e.isDirectory()) return { name: e.name, art: 'ordner' };
        if (!e.isFile()) return { name: e.name, art: 'sonst' };
        return { name: e.name, art: 'datei', groesse: fs.lstatSync(g.pfad(e.name), { throwIfNoEntry: false })?.size ?? 0 };
      });
      eintraege.sort((a, b) => Number(b.art === 'ordner') - Number(a.art === 'ordner') || a.name.localeCompare(b.name, 'de', { numeric: true }));
      return { pfad, eintraege, gekuerzt: alle.length > BAUM_MAX };
    } catch (e) {
      return uebersetzen(e);
    } finally {
      g.zu();
    }
  }

  /** Datei zum Lesen öffnen – Deskriptor einer gewöhnlichen Datei (Aufrufer schließt). */
  private dateiFd(projekt: string, pfad: string): { fd: number; groesse: number } {
    const teile = pfadTeile(pfad);
    const name = teile.pop()!;
    const g = this.griff(projekt, teile);
    let fd: number;
    try {
      // O_NONBLOCK: eine untergeschobene FIFO darf den Runner nicht aufhängen
      fd = HAT_PROC ? kindOeffnen(g.fd, name, O_RDONLY | O_NONBLOCK) : fs.openSync(g.pfad(name), O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    } catch (e) {
      if (code(e) === 'ELOOP') symlink();
      return uebersetzen(e);
    } finally {
      g.zu();
    }
    const s = fs.fstatSync(fd);
    if (!s.isFile()) {
      fs.closeSync(fd);
      throw new EditorFehler(400, s.isDirectory() ? 'Das ist ein Ordner.' : 'Das ist keine gewöhnliche Datei.');
    }
    return { fd, groesse: s.size };
  }

  lesen(projekt: string, pfad: string): { pfad: string; groesse: number; text?: string; version?: string; binaer?: boolean; zuGross?: boolean } {
    const { fd, groesse } = this.dateiFd(projekt, pfad);
    try {
      if (groesse > TEXT_MAX) return { pfad, groesse, zuGross: true };
      const b = fs.readFileSync(fd);
      if (!istText(b)) return { pfad, groesse, binaer: true };
      return { pfad, groesse, text: b.toString('utf8'), version: sha(b) };
    } finally {
      fs.closeSync(fd);
    }
  }

  /** Rohdaten zum Herunterladen (Strom über den schon geöffneten Deskriptor). */
  roh(projekt: string, pfad: string): { strom: fs.ReadStream; groesse: number; name: string } {
    const { fd, groesse } = this.dateiFd(projekt, pfad);
    if (groesse > ROH_MAX) {
      fs.closeSync(fd);
      throw new EditorFehler(413, 'Die Datei ist zu groß zum Herunterladen (über 200 MB) – nimm das Terminal.');
    }
    return { strom: fs.createReadStream('', { fd, autoClose: true }), groesse, name: pfad.split('/').pop()! };
  }

  /**
   * Schreibt eine Datei atomar (temporäre Datei im selben, geöffneten Ordner, dann umbenennen).
   * `basisVersion` (sha256 des Stands, den der Editor geladen hat): weicht die Datei ab → 409, nichts wird überschrieben.
   * `neu`: die Datei darf noch nicht bestehen.
   */
  schreiben(projekt: string, pfad: string, inhalt: Buffer, opt: { basisVersion?: string; neu?: boolean; max?: number } = {}): { pfad: string; version: string; groesse: number } {
    if (inhalt.length > (opt.max ?? TEXT_MAX)) throw new EditorFehler(413, 'Die Datei ist zu groß.');
    const teile = pfadTeile(pfad);
    const name = teile.pop()!;
    const g = this.griff(projekt, teile, true);
    try {
      const ziel = g.pfad(name);
      const alt = fs.lstatSync(ziel, { throwIfNoEntry: false });
      if (alt?.isSymbolicLink()) symlink();
      if (alt && !alt.isFile()) throw new EditorFehler(400, alt.isDirectory() ? 'Dort liegt ein Ordner.' : 'Dort liegt keine gewöhnliche Datei.');
      if (alt && opt.neu) throw new EditorFehler(409, 'Die Datei gibt es schon.');
      if (opt.basisVersion !== undefined) {
        if (!alt) throw new EditorFehler(409, 'Die Datei wurde inzwischen gelöscht oder verschoben.', { konflikt: true });
        const fd = fs.openSync(ziel, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
        let aktuell: string;
        try {
          aktuell = sha(fs.readFileSync(fd));
        } finally {
          fs.closeSync(fd);
        }
        if (aktuell !== opt.basisVersion) throw new EditorFehler(409, 'Die Datei wurde inzwischen geändert (z. B. von einem Agenten oder im Terminal).', { konflikt: true, version: aktuell });
      }
      const tmp = g.pfad(`.${name.slice(0, 200)}.dorf-${crypto.randomBytes(6).toString('hex')}`);
      const fd = fs.openSync(tmp, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, alt ? alt.mode & 0o777 : 0o644);
      try {
        fs.writeSync(fd, inhalt);
        // Rechte der alten Datei behalten (ausführbare Skripte bleiben ausführbar)
        if (alt) fs.fchmodSync(fd, alt.mode & 0o777);
        fs.closeSync(fd);
        fs.renameSync(tmp, ziel);
      } catch (e) {
        try {
          fs.closeSync(fd);
        } catch {
          /* schon zu */
        }
        fs.rmSync(tmp, { force: true });
        throw e;
      }
      return { pfad, version: sha(inhalt), groesse: inhalt.length };
    } catch (e) {
      return uebersetzen(e);
    } finally {
      g.zu();
    }
  }

  neu(projekt: string, pfad: string, art: 'datei' | 'ordner') {
    if (art === 'datei') return this.schreiben(projekt, pfad, Buffer.alloc(0), { neu: true });
    const teile = pfadTeile(pfad);
    const name = teile.pop()!;
    const g = this.griff(projekt, teile, true);
    try {
      fs.mkdirSync(g.pfad(name));
      return { pfad };
    } catch (e) {
      return uebersetzen(e);
    } finally {
      g.zu();
    }
  }

  umbenennen(projekt: string, von: string, nach: string) {
    const a = pfadTeile(von);
    const b = pfadTeile(nach);
    if (b.length > a.length && a.every((t, i) => b[i] === t)) throw new EditorFehler(400, 'Ein Ordner lässt sich nicht in sich selbst verschieben.');
    const an = a.pop()!;
    const bn = b.pop()!;
    const ga = this.griff(projekt, a);
    let gb: Griff | undefined;
    try {
      gb = this.griff(projekt, b, true);
      if (!fs.lstatSync(ga.pfad(an), { throwIfNoEntry: false })) throw new EditorFehler(404, 'Datei oder Ordner gibt es nicht (mehr).');
      if (fs.lstatSync(gb.pfad(bn), { throwIfNoEntry: false })) throw new EditorFehler(409, 'Unter dem neuen Namen gibt es schon etwas.');
      // rename folgt keinem Symlink: ein Link würde selbst umbenannt, nie sein Ziel
      fs.renameSync(ga.pfad(an), gb.pfad(bn));
      return { von, nach };
    } catch (e) {
      return uebersetzen(e);
    } finally {
      ga.zu();
      gb?.zu();
    }
  }

  /** Löschen = in den Papierkorb verschieben (<arbeit>/.papierkorb/<projekt>/<Zeit>_<Name>), nach 14 Tagen endgültig. */
  loeschen(projekt: string, pfad: string) {
    const teile = pfadTeile(pfad);
    const name = teile.pop()!;
    const g = this.griff(projekt, teile);
    let korb: Griff | undefined;
    try {
      if (!fs.lstatSync(g.pfad(name), { throwIfNoEntry: false })) throw new EditorFehler(404, 'Datei oder Ordner gibt es nicht (mehr).');
      korb = griffOeffnen(this.arbeit, [PAPIERKORB, projekt], true);
      const zielName = `${new Date().toISOString().replace(/[:.]/g, '-')}_${crypto.randomBytes(3).toString('hex')}_${name}`.slice(0, 250);
      fs.renameSync(g.pfad(name), korb.pfad(zielName));
      this.papierkorbLeeren(korb);
      return { pfad, papierkorb: `${PAPIERKORB}/${projekt}/${zielName}` };
    } catch (e) {
      return uebersetzen(e);
    } finally {
      g.zu();
      korb?.zu();
    }
  }

  private papierkorbLeeren(korb: Griff) {
    const grenze = Date.now() - PAPIERKORB_TAGE * 86_400_000;
    try {
      for (const n of fs.readdirSync(korb.selbst)) {
        const zeit = Date.parse(n.slice(0, 24).replace(/^(\d{4}-\d\d-\d\dT\d\d)-(\d\d)-(\d\d)-(\d{3}Z)$/, '$1:$2:$3.$4'));
        // rm folgt keinen Symlinks (löscht den Link, nie das Ziel)
        if (Number.isFinite(zeit) && zeit < grenze) fs.rmSync(korb.pfad(n), { recursive: true, force: true });
      }
    } catch {
      /* Aufräumen ist nie ein Grund zu scheitern */
    }
  }

  // ---- Befehle im Projektordner (nie über eine Shell) ----------------------------------------------

  private befehl(projekt: string, bin: string, args: string[], opt: { ms?: number; max?: number; eingabe?: string } = {}): Promise<{ code: number; aus: Buffer; fehler: string; gekuerzt: boolean }> {
    const cwd = this.projektOrdner(projekt);
    const max = opt.max ?? 2_000_000;
    return new Promise((fertig, kaputt) => {
      const p = spawn(bin, args, {
        cwd,
        env: { ...this.umgebung(), GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', PAGER: 'cat', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C.UTF-8', GIT_EDITOR: 'true' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const teile: Buffer[] = [];
      let n = 0;
      let fehler = '';
      let gekuerzt = false;
      const uhr = setTimeout(() => {
        fehler += '\n(Zeitlimit erreicht – abgebrochen)';
        p.kill('SIGKILL');
      }, opt.ms ?? 30_000);
      p.stdout.on('data', (d: Buffer) => {
        if (n >= max) {
          if (!gekuerzt) p.kill('SIGTERM');
          gekuerzt = true;
          return;
        }
        teile.push(d.subarray(0, max - n));
        n += d.length;
      });
      p.stderr.on('data', (d: Buffer) => {
        fehler = (fehler + d.toString()).slice(-20_000);
      });
      p.on('error', (e) => {
        clearTimeout(uhr);
        if (code(e) === 'ENOENT') kaputt(new EditorFehler(501, `„${bin}“ ist im Coding-Container nicht installiert.`));
        else kaputt(e);
      });
      p.on('close', (c) => {
        clearTimeout(uhr);
        fertig({ code: c ?? 1, aus: Buffer.concat(teile), fehler, gekuerzt });
      });
      p.stdin.on('error', () => {});
      p.stdin.end(opt.eingabe ?? '');
    });
  }

  /** Alle Dateien des Projekts für die Schnellsuche (ripgrep beachtet .gitignore, folgt keinen Symlinks). */
  async dateien(projekt: string): Promise<{ dateien: string[]; gekuerzt: boolean }> {
    const r = await this.befehl(projekt, 'rg', ['--files', '--hidden', '--glob', '!.git', '--sort', 'path'], { ms: 20_000, max: 1_500_000 });
    if (r.code > 1 && !r.gekuerzt) throw new EditorFehler(500, `Dateiliste fehlgeschlagen: ${r.fehler.slice(0, 300)}`);
    const dateien = r.aus.toString('utf8').split('\n').filter(Boolean);
    if (r.gekuerzt) dateien.pop();
    return { dateien: dateien.slice(0, 20_000), gekuerzt: r.gekuerzt || dateien.length > 20_000 };
  }

  /** Volltextsuche im Projekt (ripgrep). */
  async suche(projekt: string, o: { text: string; regex?: boolean; gross?: boolean; wort?: boolean }): Promise<{ treffer: { pfad: string; zeile: number; spalte: number; text: string }[]; gekuerzt: boolean }> {
    if (typeof o.text !== 'string' || !o.text || o.text.length > 500) throw new EditorFehler(400, 'Suchtext fehlt oder ist zu lang.');
    const args = ['--json', '--hidden', '--glob', '!.git', '--max-count', '200', '--max-columns', '400', '--max-columns-preview', '--max-filesize', '2M'];
    if (!o.regex) args.push('--fixed-strings');
    if (!o.gross) args.push('--ignore-case');
    if (o.wort) args.push('--word-regexp');
    args.push('-e', o.text, '--', '.');
    const r = await this.befehl(projekt, 'rg', args, { ms: 20_000, max: 4_000_000 });
    if (r.code > 1 && !r.gekuerzt) throw new EditorFehler(400, `Suche fehlgeschlagen: ${r.fehler.slice(0, 300)}`);
    const treffer: { pfad: string; zeile: number; spalte: number; text: string }[] = [];
    let gekuerzt = r.gekuerzt;
    for (const z of r.aus.toString('utf8').split('\n')) {
      if (!z.startsWith('{"type":"match"')) continue;
      try {
        const m = (JSON.parse(z) as { data: { path: { text?: string }; lines: { text?: string }; line_number: number; submatches: { start: number }[] } }).data;
        if (!m.path.text) continue;
        if (treffer.length >= 500) {
          gekuerzt = true;
          break;
        }
        treffer.push({ pfad: m.path.text.replace(/^\.\//, ''), zeile: m.line_number, spalte: (m.submatches[0]?.start ?? 0) + 1, text: (m.lines.text ?? '').replace(/\n$/, '').slice(0, 400) });
      } catch {
        /* abgeschnittene letzte Zeile */
      }
    }
    return { treffer, gekuerzt };
  }

  /** Git: feste Befehle mit geprüften Werten. Ausgabe und Code gehen zurück – Fehler von git sind kein Fehler des Runners. */
  async git(projekt: string, b: Record<string, unknown>): Promise<Record<string, unknown>> {
    const text = (r: { aus: Buffer; fehler: string }) => [r.aus.toString('utf8'), r.fehler].filter((t) => t.trim()).join('\n').trim();
    const lauf = async (args: string[], opt?: { ms?: number }) => {
      const r = await this.befehl(projekt, 'git', args, opt);
      return { ok: r.code === 0, code: r.code, ausgabe: text(r).slice(0, 20_000) };
    };
    const datei = () => pfadTeile(b.pfad).join('/');
    const branch = () => {
      const n = b.branch;
      if (typeof n !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(n) || n.includes('..') || n.includes('//') || n.endsWith('/') || n.endsWith('.lock'))
        throw new EditorFehler(400, 'Ungültiger Branch-Name (Buchstaben, Ziffern, . _ - /).');
      return n;
    };
    switch (b.befehl) {
      case 'status':
        return this.gitStatus(projekt);
      case 'init':
        return lauf(['init']);
      case 'original': {
        // Stand der Datei im letzten Commit (für die Diff-Ansicht); neue Dateien: leer
        const r = await this.befehl(projekt, 'git', ['show', `HEAD:./${datei()}`], { max: TEXT_MAX });
        if (r.code !== 0) return { text: '', neu: true };
        if (r.gekuerzt || !istText(r.aus)) return { text: '', binaer: true };
        return { text: r.aus.toString('utf8') };
      }
      case 'vormerken':
        return lauf(['add', '--', datei()]);
      case 'zuruecknehmen':
        return lauf(['reset', '-q', '--', datei()]);
      case 'verwerfen':
        return lauf(['restore', '--source=HEAD', '--staged', '--worktree', '--', datei()]);
      case 'commit': {
        const nachricht = b.nachricht;
        if (typeof nachricht !== 'string' || !nachricht.trim() || nachricht.length > 5000) throw new EditorFehler(400, 'Commit-Nachricht fehlt.');
        if (b.alle) {
          const a = await lauf(['add', '-A']);
          if (!a.ok) return a;
        }
        // Nachricht über die Standardeingabe: kein Wert kann als Option missverstanden werden
        const r = await this.befehl(projekt, 'git', ['commit', '-F', '-'], { eingabe: nachricht, ms: 60_000 });
        return { ok: r.code === 0, code: r.code, ausgabe: text(r).slice(0, 20_000) };
      }
      case 'push': {
        const s = await this.gitStatus(projekt);
        return lauf(s.upstream ? ['push'] : ['push', '-u', 'origin', 'HEAD'], { ms: 120_000 });
      }
      case 'pull':
        return lauf(['pull', '--ff-only'], { ms: 120_000 });
      case 'holen':
        return lauf(['fetch', '--prune'], { ms: 120_000 });
      case 'branches': {
        const r = await this.befehl(projekt, 'git', ['branch', '-a', '--format=%(refname)%09%(HEAD)']);
        if (r.code !== 0) return { ok: false, code: r.code, ausgabe: text(r), lokal: [], fern: [] };
        const lokal: string[] = [];
        const fern: string[] = [];
        let aktuell = '';
        for (const z of r.aus.toString('utf8').split('\n')) {
          const [ref, kopf] = z.split('\t');
          if (ref?.startsWith('refs/heads/')) {
            lokal.push(ref.slice(11));
            if (kopf === '*') aktuell = ref.slice(11);
          } else if (ref?.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')) fern.push(ref.slice(13).replace(/^[^/]+\//, ''));
        }
        return { ok: true, aktuell, lokal, fern: [...new Set(fern)].filter((f) => !lokal.includes(f)) };
      }
      case 'wechseln':
        return lauf(['switch', branch()]);
      case 'anlegen':
        return lauf(['switch', '-c', branch()]);
      case 'verlauf': {
        const r = await this.befehl(projekt, 'git', ['log', '-30', '--format=%h%x09%cI%x09%an%x09%s']);
        if (r.code !== 0) return { ok: true, commits: [] };
        return {
          ok: true,
          commits: r.aus.toString('utf8').split('\n').filter(Boolean).map((z) => {
            const [kurz, zeit, autor, ...rest] = z.split('\t');
            return { kurz, zeit, autor, betreff: rest.join('\t') };
          }),
        };
      }
      default:
        throw new EditorFehler(400, 'Unbekannter Git-Befehl.');
    }
  }

  private async gitStatus(projekt: string) {
    const r = await this.befehl(projekt, 'git', ['status', '--porcelain=v1', '-b', '-z', '--untracked-files=all']);
    if (r.code !== 0) return { ok: false, git: false, branch: '', upstream: '', voraus: 0, zurueck: 0, dateien: [] as { pfad: string; x: string; y: string; alt?: string }[], ausgabe: r.fehler.slice(0, 2000) };
    const teile = r.aus.toString('utf8').split('\0');
    const dateien: { pfad: string; x: string; y: string; alt?: string }[] = [];
    let branch = '';
    let upstream = '';
    let voraus = 0;
    let zurueck = 0;
    for (let i = 0; i < teile.length; i++) {
      const t = teile[i]!;
      if (!t) continue;
      if (t.startsWith('## ')) {
        const k = t.slice(3);
        const m = /^(?:No commits yet on |Initial commit on )?(.+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/.exec(k);
        branch = m?.[1] ?? k;
        upstream = m?.[2] ?? '';
        voraus = Number(/ahead (\d+)/.exec(m?.[3] ?? '')?.[1] ?? 0);
        zurueck = Number(/behind (\d+)/.exec(m?.[3] ?? '')?.[1] ?? 0);
        continue;
      }
      const x = t[0]!;
      const y = t[1]!;
      const e: { pfad: string; x: string; y: string; alt?: string } = { pfad: t.slice(3), x, y };
      // Umbenannt/kopiert: der alte Pfad folgt als eigener Eintrag
      if (x === 'R' || x === 'C') e.alt = teile[++i];
      if (dateien.length < 2000) dateien.push(e);
    }
    return { ok: true, git: true, branch, upstream, voraus, zurueck, dateien };
  }
}
