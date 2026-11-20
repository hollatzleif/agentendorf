import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { EditorFehler } from './editor.js';

/**
 * Erweiterungen für VS Code im Codehaus (E205) – nur Profil coding.
 *
 * Der Runner ruft das openvscode-server-Programm des Containers mit FESTEN Argumentlisten auf (nie über eine Shell):
 *   --list-extensions --show-versions · --install-extension <id|datei> --force · --uninstall-extension <id>
 * (so geprüft gegen openvscode-server 1.109.5; die Kennung holt es selbst aus Open VSX – product.json des Archivs:
 * extensionsGallery.serviceUrl = https://open-vsx.org/vscode/gallery).
 * Die Kennung ist streng geprüft (`herausgeber.name`, optional `@version`): Sie beginnt nie mit „-“ (keine Option), enthält
 * weder „/“ noch „:“ (keine Adresse) und endet nie auf „.vsix“ – VS Code hält JEDES Argument mit dieser Endung für eine Datei
 * relativ zum Arbeitsordner (server-main.js: `/\.vsix$/i.test(t) ? URI.file(isAbsolute(t) ? t : join(cwd(), t)) : t`, Review E205).
 * Zusätzlich läuft jeder Aufruf in einem frischen, leeren Arbeitsordner. Eine hochgeladene VSIX-Datei bekommt ihren Namen vom Runner.
 * Erweiterungen laufen danach im VS Code des Containers – mit dessen Rechten (Shell, Internet, Vault). Installiert wird
 * nur auf Zuruf des Dorfs, und das Dorf ruft nur auf Leifs Klick in der App (kein Agenten-Werkzeug führt hierher).
 */
export const ERWEITERUNG_ID = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*(@[0-9][0-9A-Za-z.+-]*)?$/;
const ID_MAX = 200;
export const VSIX_MAX = 50 * 1024 * 1024;
const AUSGABE_MAX = 6000;
export const ZEIT_LISTE_MS = 30_000;
export const ZEIT_INSTALLIEREN_MS = 180_000;
export const ZEIT_ENTFERNEN_MS = 60_000;
/** So lange wartet ein Auftrag höchstens, bis er an der Reihe ist – danach 409 statt endlos (Review E205: das Dorf wartet nicht ewig) */
export const ZEIT_WARTEN_MS = 60_000;
/** Kennung ohne Version, wie `entfernen` sie annimmt (die App zeigt den Knopf nur dafür) */
export const ERWEITERUNG_OHNE_VERSION = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/;

export function erweiterungIdPruefen(w: unknown, mitVersion = true): string {
  if (typeof w !== 'string' || w.length > ID_MAX || !ERWEITERUNG_ID.test(w) || /\.vsix$/i.test(w) || (!mitVersion && w.includes('@')))
    throw new EditorFehler(400, 'Ungültige Erweiterungs-Kennung – erwartet wird „herausgeber.name“ (Kleinbuchstaben, Ziffern, Bindestrich)' + (mitVersion ? ', optional „@version“.' : '.'));
  return w;
}

/** Zeilen von `--list-extensions --show-versions`: „herausgeber.name@1.2.3“ – alles andere (Hinweise) wird übergangen */
export function listeLesen(ausgabe: string): { id: string; version: string }[] {
  // je Kennung ein Eintrag (klein geschrieben fielen sonst zwei Schreibweisen zusammen)
  const aus = new Map<string, { id: string; version: string }>();
  for (const zeile of ausgabe.split('\n')) {
    const m = /^([A-Za-z0-9][A-Za-z0-9_-]*\.[A-Za-z0-9][A-Za-z0-9._-]*)@([0-9][0-9A-Za-z.+-]*)$/.exec(zeile.trim());
    if (m && !aus.has(m[1]!.toLowerCase())) aus.set(m[1]!.toLowerCase(), { id: m[1]!.toLowerCase(), version: m[2]! });
  }
  return [...aus.values()].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 500);
}

// eslint-disable-next-line no-control-regex
const saeubern = (t: string) => t.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');

export class Erweiterungen {
  /** Immer nur ein Aufruf zur selben Zeit: zwei Installationen nebeneinander schrieben beide in extensions.json */
  private kette: Promise<unknown> = Promise.resolve();

  constructor(
    private bin: string,
    /** derselbe Ordner wie beim laufenden VS Code (start.sh: --server-data-dir) – nur dann sieht es die Erweiterungen */
    private datenOrdner: string,
    private vsixOrdner: string,
    private umgebung: () => NodeJS.ProcessEnv,
    /** Zeitlimit fürs Installieren – nur Tests setzen es herab */
    private zeitInstallierenMs = ZEIT_INSTALLIEREN_MS,
    /** Höchste Wartezeit in der Reihe – nur Tests setzen sie herab */
    private zeitWartenMs = ZEIT_WARTEN_MS,
  ) {}

  /**
   * Schreibende Aufrufe laufen nacheinander. Wer länger als zeitWartenMs ansteht, bekommt 409 und wird NICHT mehr ausgeführt –
   * so ist die längste Dauer eines Auftrags bekannt (Warten + Aufruf + Liste), und das Dorf kann sicher länger warten.
   */
  private nacheinander<T>(f: () => Promise<T>): Promise<T> {
    const seit = Date.now();
    const lauf = () => {
      if (Date.now() - seit > this.zeitWartenMs) throw new EditorFehler(409, 'VS Code ist noch mit einer anderen Erweiterung beschäftigt – gleich noch einmal versuchen.');
      return f();
    };
    const p = this.kette.then(lauf, lauf);
    this.kette = p.catch(() => undefined);
    return p;
  }

  /** Feste Argumentliste, eigene Prozessgruppe, Zeitlimit, Ausgabe begrenzt (das Ende zählt: dort steht das Ergebnis). */
  private aufruf(args: string[], ms: number): Promise<{ code: number | null; ausgabe: string }> {
    return new Promise((fertig, fehler) => {
      // frischer, leerer Arbeitsordner: Selbst wenn VS Code ein Argument als Pfad relativ zu cwd läse, läge dort nichts
      const leer = fs.mkdtempSync(path.join(os.tmpdir(), 'erw-'));
      const weg = () => fs.rmSync(leer, { recursive: true, force: true });
      const p = spawn(this.bin, ['--server-data-dir', this.datenOrdner, ...args], { cwd: leer, env: this.umgebung(), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
      let ausgabe = '';
      let abgelaufen = false;
      const dazu = (d: Buffer) => {
        ausgabe = (ausgabe + d.toString('utf8')).slice(-AUSGABE_MAX * 4);
      };
      p.stdout.on('data', dazu);
      p.stderr.on('data', dazu);
      const uhr = setTimeout(() => {
        abgelaufen = true;
        try {
          process.kill(-p.pid!, 'SIGKILL');
        } catch {
          p.kill('SIGKILL');
        }
      }, ms);
      p.on('error', (e: NodeJS.ErrnoException) => {
        clearTimeout(uhr);
        weg();
        fehler(e.code === 'ENOENT' ? new EditorFehler(501, 'In diesem Container gibt es kein VS Code (openvscode-server fehlt).') : new EditorFehler(500, `VS Code ließ sich nicht aufrufen: ${e.message}`));
      });
      p.on('close', (code) => {
        clearTimeout(uhr);
        weg();
        if (abgelaufen) return fehler(new EditorFehler(504, `Abgebrochen nach ${Math.round(ms / 1000)} s.`));
        fertig({ code, ausgabe: saeubern(ausgabe).trim().slice(-AUSGABE_MAX) });
      });
    });
  }

  /** Nur lesen – steht nicht in der Reihe: Die Liste antwortet auch, während gerade etwas installiert wird. */
  async liste() {
    const r = await this.aufruf(['--list-extensions', '--show-versions'], ZEIT_LISTE_MS);
    if (r.code !== 0) throw new EditorFehler(502, `VS Code meldet einen Fehler: ${r.ausgabe.slice(-500) || `Code ${r.code}`}`);
    return { erweiterungen: listeLesen(r.ausgabe) };
  }

  /** --force: ohne Rückfrage, und „Installieren“ einer vorhandenen Erweiterung bringt sie auf den neuesten Stand */
  installieren(id: unknown) {
    const kennung = erweiterungIdPruefen(id);
    return this.nacheinander(() => this.fertig(['--install-extension', kennung, '--force'], this.zeitInstallierenMs, 'installieren'));
  }

  entfernen(id: unknown) {
    const kennung = erweiterungIdPruefen(id, false);
    return this.nacheinander(() => this.fertig(['--uninstall-extension', kennung], ZEIT_ENTFERNEN_MS, 'entfernen'));
  }

  /**
   * VSIX hochladen und installieren: Die Datei wird beim Empfangen auf die Platte geschrieben (nie ganz im Speicher),
   * heißt wie der Runner will (<uuid>.vsix im eigenen Ordner, absoluter Pfad → nie eine Option) und ist danach wieder weg.
   */
  async vsix(req: http.IncomingMessage) {
    fs.mkdirSync(this.vsixOrdner, { recursive: true, mode: 0o700 });
    const datei = path.join(this.vsixOrdner, `${crypto.randomUUID()}.vsix`);
    try {
      const fd = fs.openSync(datei, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      let n = 0;
      let anfang = Buffer.alloc(0);
      try {
        for await (const t of req) {
          const stueck = t as Buffer;
          n += stueck.length;
          if (n > VSIX_MAX) throw new EditorFehler(413, 'Die VSIX-Datei ist zu groß (über 50 MB).');
          if (anfang.length < 4) anfang = Buffer.concat([anfang, stueck.subarray(0, 4 - anfang.length)]);
          fs.writeSync(fd, stueck);
        }
      } finally {
        fs.closeSync(fd);
      }
      // Eine VSIX ist ein ZIP-Archiv – alles andere gar nicht erst an VS Code geben
      if (!anfang.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new EditorFehler(400, 'Das ist keine VSIX-Datei (kein ZIP-Archiv).');
      return await this.nacheinander(() => this.fertig(['--install-extension', datei, '--force'], this.zeitInstallierenMs, 'installieren'));
    } finally {
      fs.rmSync(datei, { force: true });
    }
  }

  private async fertig(args: string[], ms: number, was: string) {
    const r = await this.aufruf(args, ms);
    // der Pfad der hochgeladenen Datei sagt Leif nichts
    const ausgabe = r.ausgabe.split(this.vsixOrdner + path.sep).join('');
    if (r.code !== 0) throw new EditorFehler(422, ausgabe.slice(-1500) || `VS Code konnte nicht ${was} (Code ${r.code}).`);
    return { ok: true, ausgabe, ...(await this.listeRoh()) };
  }

  private async listeRoh() {
    const r = await this.aufruf(['--list-extensions', '--show-versions'], ZEIT_LISTE_MS);
    return { erweiterungen: r.code === 0 ? listeLesen(r.ausgabe) : [] };
  }
}
