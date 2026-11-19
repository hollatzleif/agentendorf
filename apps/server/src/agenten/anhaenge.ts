import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MAX_ANHANG_BYTES } from '@dorf/shared';
import type { VaultDienst } from '../vault/dienst.js';
import type { RechenraumKlient, UmwandelErgebnis } from './rechenraum.js';

/**
 * E190: Anhänge in allen Formaten verstehen.
 * - Text und Quelltext liest das Dorf selbst (nur dekodieren, nichts parsen).
 * - PDF und gängige Bilder bekommt das Modell nativ (wie bisher).
 * - Alles andere (Word, Excel, PowerPoint, ODF, RTF, HTML, Mail, Archive, HEIC/SVG/TIFF, Audio, Video …) ist Fremdinhalt
 *   und wird NUR im abgeschotteten Rechenraum umgewandelt (kein Internet, kein Vault, eigener Kindprozess mit Grenzen).
 *   Das Ergebnis wird je Inhalt (sha256) zwischengespeichert, damit Folgeläufe nicht neu rechnen.
 * - Unbekanntes wird nie still verschluckt: Name, Typ und Größe gehen immer ans Modell.
 */

export { MAX_ANHANG_BYTES };
/** Text-Dateien, die das Dorf selbst liest (UTF-8, sonst Windows-1252) */
export const TEXT_ENDUNGEN = new Set(
  [
    'md markdown txt csv tsv json jsonl yaml yml xml log ini cfg conf toml tex bib sty cls py js mjs cjs ts tsx jsx java c h cpp hpp cc cs rs go rb php',
    'swift kt kts scala r m jl lua pl sql sh bash zsh ps1 bat css scss vue svelte dart hs ml ex exs erl clj gradle properties srt vtt ics vcf rst adoc org',
    'ipynb dockerfile mk cmake asm s f90 do sas tikz gp plt dot mermaid mmd csl nix',
  ]
    .join(' ')
    .split(' ')
    .map((e) => `.${e}`),
);
const BILD_NATIV: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
/** Größer schickt die API ein Bild nicht (5 MB) – darüber verkleinert der Rechenraum */
const BILD_NATIV_MAX = 3_750_000;
const PDF_NATIV_MAX = 20 * 1024 * 1024;
const MAX_TEXT = 150_000;
/** Bump, wenn sich die Dorf-Seite der Umwandlung ändert (Teil des Cache-Schlüssels) */
const DORF_FASSUNG = '1';

export type VerstandenArt = 'text' | 'pdf' | 'bild' | 'umgewandelt' | 'unbekannt';
export interface Verstanden {
  pfad: string;
  name: string;
  /** lesbarer Typ, z. B. „Word-Dokument“ */
  typ: string;
  groesse: number;
  art: VerstandenArt;
  /** Text (ohne Fremdinhalt-Hülle) – bei text und umgewandelt */
  text?: string;
  /** nativ (pdf/bild) */
  base64?: string;
  mime?: string;
  /** Bilder aus der Umwandlung (Standbilder, umgewandelte Fotos …) */
  bilder: { mime: string; base64: string; titel?: string }[];
  hinweise: string[];
}

const TYPEN: Record<string, string> = {
  '.pdf': 'PDF',
  '.docx': 'Word-Dokument',
  '.doc': 'Word-Dokument (alt)',
  '.odt': 'OpenDocument-Text',
  '.rtf': 'RTF-Text',
  '.xlsx': 'Excel-Tabelle',
  '.xls': 'Excel-Tabelle (alt)',
  '.ods': 'OpenDocument-Tabelle',
  '.pptx': 'PowerPoint',
  '.ppt': 'PowerPoint (alt)',
  '.odp': 'OpenDocument-Präsentation',
  '.eml': 'E-Mail',
  '.msg': 'Outlook-Mail',
  '.zip': 'ZIP-Archiv',
  '.html': 'Webseite (HTML)',
  '.htm': 'Webseite (HTML)',
  '.svg': 'SVG-Grafik',
  '.heic': 'iPhone-Foto (HEIC)',
  '.mp3': 'Audio',
  '.m4a': 'Audio',
  '.ogg': 'Audio',
  '.oga': 'Sprachnachricht',
  '.opus': 'Audio',
  '.wav': 'Audio',
  '.mp4': 'Video',
  '.mov': 'Video',
};

export function typText(name: string) {
  const ext = path.posix.extname(name).toLowerCase();
  if (TYPEN[ext]) return TYPEN[ext]!;
  if (BILD_NATIV[ext]) return `Bild (${ext.slice(1).toUpperCase()})`;
  if (TEXT_ENDUNGEN.has(ext)) return `Text (${ext.slice(1)})`;
  return `Datei (${ext.slice(1) || 'ohne Endung'})`;
}

export function groesseText(n: number) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** Text dekodieren: BOM/UTF-8, sonst Windows-1252; null, wenn es kein Text ist (NUL-Bytes) */
export function textDekodieren(b: Buffer): string | null {
  if (b.subarray(0, 16384).includes(0) && !(b[0] === 0xff && b[1] === 0xfe) && !(b[0] === 0xfe && b[1] === 0xff)) return null;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.subarray(3).toString('utf8');
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    return new TextDecoder('windows-1252').decode(b);
  }
}

export class DateiVerstehen {
  /** Ordner für den Zwischenspeicher der Umwandlungen (Daten-Ordner des Dorfs, nicht der Vault) */
  cacheOrdner: string | null = null;
  /** höchstens so viele Einträge im Zwischenspeicher (älteste fliegen raus) */
  cacheMax = 400;

  constructor(
    private vault: VaultDienst,
    private rechenraum: () => RechenraumKlient | undefined,
  ) {}

  /**
   * Versteht eine Vault-Datei. `pdfNativ`/`bildNativ`: PDF bzw. Bild unverändert ans Modell (erste Nachricht);
   * sonst wird auch ein PDF im Rechenraum zu Text (vault_lesen) – Bilder gehen dort als Bild-Ergebnis zurück.
   */
  async verstehen(pfad: string, o: { pdfNativ: boolean; bildNativ: boolean }): Promise<Verstanden> {
    const name = path.posix.basename(pfad);
    const ext = path.posix.extname(name).toLowerCase();
    const basis: Verstanden = { pfad, name, typ: typText(name), groesse: 0, art: 'unbekannt', bilder: [], hinweise: [] };
    const abs = this.vault.abs(pfad);
    const st = await fs.stat(abs).catch(() => null);
    if (!st?.isFile()) return { ...basis, hinweise: ['Datei nicht gefunden.'] };
    basis.groesse = st.size;

    if (TEXT_ENDUNGEN.has(ext) && st.size <= MAX_ANHANG_BYTES) {
      const b = await fs.readFile(abs);
      const t = textDekodieren(b);
      if (t !== null) return { ...basis, art: 'text', text: t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}\n[… gekürzt – ${t.length} Zeichen]` : t };
    }
    if (ext === '.pdf' && o.pdfNativ && st.size <= PDF_NATIV_MAX) return { ...basis, art: 'pdf', mime: 'application/pdf', base64: (await fs.readFile(abs)).toString('base64') };
    if (BILD_NATIV[ext] && o.bildNativ && st.size <= BILD_NATIV_MAX) return { ...basis, art: 'bild', mime: BILD_NATIV[ext], base64: (await fs.readFile(abs)).toString('base64') };

    if (st.size > MAX_ANHANG_BYTES)
      return { ...basis, hinweise: [`Zu groß zum Umwandeln (${groesseText(st.size)}, höchstens ${groesseText(MAX_ANHANG_BYTES)}).`] };
    const rr = this.rechenraum();
    if (!rr) return { ...basis, hinweise: ['Umwandlung nicht verfügbar – der Rechenraum ist auf diesem Server nicht eingerichtet.'] };
    const inhalt = await fs.readFile(abs);
    let e: UmwandelErgebnis;
    try {
      e = await this.umwandeln(rr, name, inhalt);
    } catch (err) {
      return { ...basis, hinweise: [`Umwandlung fehlgeschlagen: ${(err as Error).message}`] };
    }
    const hatEtwas = !!e.text.trim() || e.bilder.length > 0;
    return {
      ...basis,
      typ: e.typ || basis.typ,
      art: hatEtwas ? 'umgewandelt' : 'unbekannt',
      text: e.text,
      bilder: e.bilder.map((b) => ({ mime: b.mime, base64: b.b64, titel: b.titel })),
      hinweise: e.hinweise,
    };
  }

  private async umwandeln(rr: RechenraumKlient, name: string, inhalt: Buffer): Promise<UmwandelErgebnis> {
    const ext = path.posix.extname(name).toLowerCase();
    const schluessel = crypto.createHash('sha256').update(`${DORF_FASSUNG}\0${ext}\0`).update(inhalt).digest('hex');
    const datei = this.cacheOrdner ? path.join(this.cacheOrdner, `${schluessel}.json`) : null;
    if (datei) {
      const alt = await fs.readFile(datei, 'utf8').catch(() => null);
      if (alt) {
        try {
          const j = JSON.parse(alt) as UmwandelErgebnis;
          void fs.utimes(datei, new Date(), new Date()).catch(() => undefined);
          return j;
        } catch {
          /* kaputter Eintrag → neu rechnen */
        }
      }
    }
    const e = await rr.umwandeln(name, inhalt);
    // Nur vollständige Ergebnisse merken – ein Zeitlimit oder Absturz soll beim nächsten Mal neu versucht werden
    const voruebergehend = e.hinweise.some((h) => /Zeitlimit|abgestürzt|zu lange|Zu wenig Speicher/.test(h));
    if (datei && !voruebergehend) {
      await fs.mkdir(this.cacheOrdner!, { recursive: true });
      const tmp = `${datei}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(e));
      await fs.rename(tmp, datei);
      void this.aufraeumen();
    }
    return e;
  }

  private async aufraeumen() {
    if (!this.cacheOrdner) return;
    const namen = (await fs.readdir(this.cacheOrdner).catch(() => [] as string[])).filter((n) => n.endsWith('.json'));
    if (namen.length <= this.cacheMax) return;
    const mitZeit = await Promise.all(namen.map(async (n) => ({ n, t: (await fs.stat(path.join(this.cacheOrdner!, n)).catch(() => null))?.mtimeMs ?? 0 })));
    mitZeit.sort((a, b) => a.t - b.t);
    for (const { n } of mitZeit.slice(0, namen.length - this.cacheMax)) await fs.rm(path.join(this.cacheOrdner, n), { force: true });
  }
}

/** Kopfzeile, die das Modell vor jedem Anhang sieht: Name, Typ, Größe, Hinweise */
export function anhangKopf(v: Verstanden) {
  return `${v.typ}, ${groesseText(v.groesse)}${v.art === 'umgewandelt' ? ' – im Rechenraum umgewandelt' : ''}${v.hinweise.length ? `\nHinweise: ${v.hinweise.join(' · ')}` : ''}`;
}
