import path from 'node:path';
import { DorfFehler } from '../fehler.js';

/**
 * Rechenraum: eigener Container mit pdflatex, Python und pdftoppm – ohne Internet, ohne Vault.
 * Das Dorf ist der einzige Weg hinein (Dateien, Befehle) und hinaus (Ablage in einen vom Code bestimmten Ordner).
 */
/** E190: Ergebnis von /umwandeln – Text (Markdown) und Bilder für das Modell, Hinweise für alles, was nicht ging */
export interface UmwandelErgebnis {
  version: string;
  typ: string;
  text: string;
  bilder: { mime: string; b64: string; titel?: string }[];
  hinweise: string[];
  meta?: Record<string, unknown>;
}

/** E199: Ergebnis eines festen Werkzeugs aus dorfwerk.py (/werkzeug) – Dateien liegen danach im Arbeitsordner des Raums */
export interface DorfwerkErgebnis {
  ok: boolean;
  text?: string;
  fehler?: string;
  dateien: string[];
}

/** E198: ein Schritt der Bildbearbeitung im Rechenraum (/bild) – dieselben Namen wie in runner.py (BILD_SCHRITTE) */
export const BILD_SCHRITT_ARTEN = [
  'zuschneiden', 'groesse', 'drehen', 'spiegeln', 'hintergrund_entfernen', 'hochskalieren', 'graustufen', 'invertieren',
  'helligkeit', 'kontrast', 'saettigung', 'weichzeichnen', 'schaerfen', 'automatisch',
] as const;
export interface BildSchritt {
  art: (typeof BILD_SCHRITT_ARTEN)[number];
  x?: number;
  y?: number;
  breite?: number;
  hoehe?: number;
  grad?: number;
  richtung?: 'horizontal' | 'vertikal';
  faktor?: number;
  wert?: number;
  radius?: number;
  staerke?: number;
}
export type BildFormat = 'png' | 'jpg' | 'webp';
export interface BildErgebnis {
  inhalt: Buffer;
  breite: number;
  hoehe: number;
  eingang: [number, number];
  format: BildFormat;
  mime: string;
  transparenz: boolean;
  hinweise: string[];
}
/** E198: was der Rechenraum an Bildbearbeitung kann (Modelle sind nur im Image) */
export interface BildKann {
  bilder: boolean;
  hintergrund_entfernen: boolean;
  hochskalieren: boolean;
  heic: boolean;
  max_pixel: number;
  skalieren_max_pixel: number;
}

export interface RechenraumKlient {
  befehl(raum: string, befehl: string): Promise<{ code: number | null; abgelaufen: boolean; sekunden: number; ausgabe: string }>;
  schreiben(raum: string, pfad: string, inhalt: Buffer): Promise<void>;
  lesen(raum: string, pfad: string): Promise<Buffer>;
  dateien(raum: string): Promise<{ pfad: string; groesse: number }[]>;
  seite(raum: string, pdf: string, seite: number): Promise<{ png: Buffer; seiten: number | null }>;
  aufraeumen(raum: string): Promise<void>;
  /** E190: fremde Datei → Text/Bilder (eigener Kindprozess im Rechenraum, mit Zeit- und Speichergrenze) */
  umwandeln(name: string, inhalt: Buffer): Promise<UmwandelErgebnis>;
  /** E199: festes Werkzeug (PDF, Diagramm, QR, Anki, Daten) im Arbeitsordner des Raums – JSON-Auftrag statt Shell */
  werkzeug?(raum: string, auftrag: Record<string, unknown>): Promise<DorfwerkErgebnis>;
  /** E198: Bild bearbeiten (Schritte nacheinander, eigener Kindprozess mit Grenzen wie umwandeln) */
  bild(name: string, inhalt: Buffer, schritte: BildSchritt[], format: BildFormat, qualitaet?: number): Promise<BildErgebnis>;
  bildKann(): Promise<BildKann>;
}

export function rechenraumKlient(url: string, geheimnis: string): RechenraumKlient {
  const basis = url.replace(/\/$/, '');
  async function post<T>(weg: string, daten: Record<string, unknown>, zeitMs = 60_000): Promise<T> {
    let r: Response;
    try {
      r = await fetch(`${basis}${weg}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-rechenraum-geheimnis': geheimnis },
        body: JSON.stringify(daten),
        signal: AbortSignal.timeout(zeitMs),
      });
    } catch (e) {
      throw new DorfFehler(503, `Rechenraum nicht erreichbar (${(e as Error).message}). Auf dem Server: dorf status`);
    }
    const j = (await r.json().catch(() => ({}))) as T & { fehler?: string };
    if (!r.ok) throw new DorfFehler(r.status === 401 ? 503 : 400, j.fehler ?? `Rechenraum: HTTP ${r.status}`);
    return j;
  }
  return {
    befehl: (raum, befehl) => post('/befehl', { raum, befehl }, 180_000),
    async schreiben(raum, pfad, inhalt) {
      await post('/schreiben', { raum, pfad, inhalt_b64: inhalt.toString('base64') });
    },
    async lesen(raum, pfad) {
      return Buffer.from((await post<{ inhalt_b64: string }>('/lesen', { raum, pfad })).inhalt_b64, 'base64');
    },
    async dateien(raum) {
      return (await post<{ dateien: { pfad: string; groesse: number }[] }>('/dateien', { raum })).dateien;
    },
    async seite(raum, pdf, seite) {
      const r = await post<{ png: string; seiten: number | null }>('/seite', { raum, pdf, seite, dpi: 100 });
      return { png: Buffer.from(r.png, 'base64'), seiten: r.seiten };
    },
    async aufraeumen(raum) {
      await post('/aufraeumen', { raum });
    },
    async umwandeln(name, inhalt) {
      // Zeitlimit im Rechenraum: 420 s (Transkription bis 6 min Audio, OCR) – hier etwas mehr für Warten und Übertragung
      const r = await post<UmwandelErgebnis>('/umwandeln', { name, inhalt_b64: inhalt.toString('base64') }, 600_000);
      return { version: r.version, typ: r.typ, text: r.text ?? '', bilder: r.bilder ?? [], hinweise: r.hinweise ?? [], meta: r.meta };
    },
    async werkzeug(raum, auftrag) {
      // im Rechenraum: bis 60 s warten (eines nach dem anderen) + 120 s Zeitlimit
      const r = await post<DorfwerkErgebnis>('/werkzeug', { raum, auftrag }, 200_000);
      return { ok: !!r.ok, text: r.text, fehler: r.fehler, dateien: Array.isArray(r.dateien) ? r.dateien : [] };
    },
    async bild(name, inhalt, schritte, format, qualitaet) {
      // Hochskalieren kann bis ans Zeitlimit des Rechenraums gehen (420 s)
      const r = await post<Omit<BildErgebnis, 'inhalt'> & { inhalt_b64: string }>(
        '/bild',
        { name, inhalt_b64: inhalt.toString('base64'), schritte, format, ...(qualitaet ? { qualitaet } : {}) },
        600_000,
      );
      return { inhalt: Buffer.from(r.inhalt_b64, 'base64'), breite: r.breite, hoehe: r.hoehe, eingang: r.eingang, format: r.format, mime: r.mime, transparenz: !!r.transparenz, hinweise: r.hinweise ?? [] };
    },
    bildKann: () => post<BildKann>('/bild/kann', {}, 10_000),
  };
}

/** Kurzname für Ordner: Kleinbuchstaben, Ziffern, Bindestriche */
export function kurzname(t: string, max = 40) {
  const umlaute: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };
  return (
    t
      .toLowerCase()
      .replace(/[äöüß]/g, (z) => umlaute[z] ?? z)
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/, '') || 'entwurf'
  );
}

function stempel(ms: number) {
  // Linzer Zeit, wie die Dateinamen der Agenten: JJJJ-MM-TT_HHMM
  const t = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date(ms))
    .replace(' ', '_')
    .replace(':', '');
  return t;
}

/**
 * Der Ordner, in den rechenraum_ablegen schreibt – bestimmt vom CODE, nie vom Agenten:
 *   Uni mit Eingabe „abgabe“ (= „<Fach>/aufgaben/<Abgabe>“): Uni/faecher/<Fach>/entwuerfe/JJJJ-MM-TT_HHMM_<abgabe>/
 *   Bürgermeister (E190): Rathaus/dateien/JJJJ-MM-TT_HHMM_<aufgabe>/
 *   sonst: <Gebäude>/entwuerfe/JJJJ-MM-TT_HHMM_<chat-titel>/
 * Der Zeitstempel ist der Start des Chats – alle Läufe eines Chats legen in denselben Ordner.
 */
export function ablageOrdner(c: { gebaeude: string; titel: string; erstellt: number; eingaben: Record<string, string>; rolle?: string | null }) {
  if (c.rolle === 'buergermeister') return `Rathaus/dateien/${stempel(c.erstellt)}_${kurzname(c.titel.replace(/^Bürgermeister:\s*/, ''))}`;
  const m = c.gebaeude === 'Uni' ? /^([^/]+)\/aufgaben\/([^/]+)$/.exec(c.eingaben.abgabe ?? '') : null;
  if (m && !m[1]!.startsWith('.')) return `Uni/faecher/${m[1]}/entwuerfe/${stempel(c.erstellt)}_${kurzname(m[2]!.replace(/\.pdf$/i, ''))}`;
  return `${c.gebaeude}/entwuerfe/${stempel(c.erstellt)}_${kurzname(c.titel)}`;
}

/**
 * Nur fertige Ergebnisse verlassen den Rechenraum (E190: Dokumente, Tabellen, Folien, Bilder, Archive) – keine Skripte,
 * keine ausführbaren Dateien, kein HTML (könnte im Browser Skripte ausführen).
 */
export const ABLAGE_ENDUNGEN = [
  '.pdf', '.tex', '.bib', '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp', '.rtf', '.csv', '.tsv', '.txt', '.md', '.json',
  '.png', '.jpg', '.jpeg', '.svg', '.gif', '.webp', '.zip', '.ics', '.vcf', '.mp3', '.wav',
  // E199: Anki-Paket (Karteikarten, eine SQLite-Datenbank im ZIP – nichts Ausführbares)
  '.apkg',
];

export function ablageName(datei: string) {
  const name = path.posix.basename(datei.replace(/\\/g, '/'));
  const ext = path.posix.extname(name).toLowerCase();
  if (!ABLAGE_ENDUNGEN.includes(ext)) throw new DorfFehler(400, `Abgelegt werden nur fertige Dateien (${ABLAGE_ENDUNGEN.join(', ')}) – nicht „${name}“.`);
  const basis = name
    .slice(0, -ext.length)
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._-]+/, '')
    .slice(0, 100);
  if (!basis) throw new DorfFehler(400, 'Ungültiger Dateiname.');
  return basis + ext;
}
