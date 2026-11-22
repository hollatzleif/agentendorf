import crypto from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { DB } from '../db.js';
import type { Uhr } from '../uhr.js';
import type { VaultDienst } from '../vault/dienst.js';
import { dateinameBereinigen, normalisieren } from '../vault/pfade.js';
import { DorfFehler } from '../fehler.js';
import { tagIn } from '../zeit.js';
import { KARTEN_DATEI, kartenLesen } from '../karten.js';
import { probeLesen } from '../schriftprobe.js';
import { fremdinhaltHuelle, istHochgeladen } from './leine.js';
import type { ExtraWerkzeug } from './leine-extra.js';
import { ablageName, type RechenraumKlient } from './rechenraum.js';
import { groesseText, LITERATUR_BIB, MAX_ANHANG_BYTES, typText, vaultDateiFremd } from './anhaenge.js';
import { dateiStempel } from './hilfen.js';
import type { RueckgaengigArt } from './rueckgaengig.js';
import type { LaufKontext, WerkzeugAufrufErgebnis, WerkzeugDefinition } from './werkzeuge.js';
import {
  arxivParsen,
  betragText,
  bibtexAufbereiten,
  crossrefParsen,
  doiNormalisieren,
  einheitenUmrechnen,
  ezbKurseParsen,
  feiertage,
  openlibraryParsen,
  ortszeitZuMs,
  quelleZeile,
  tagText,
  verbindungenText,
  waehrungsCode,
  wetterTage,
  zahlText,
  type FeiertagRegion,
  type Quelle,
} from './extra-quellen.js';

/**
 * E199 – neue Werkzeuge aus der Ideen-Liste (docs/werkzeug-ideen.md), für beide Motoren (die Werkstatt bekommt die
 * Definitionen über intern.ts). Wer was bekommt, steht in leine.ts/leine-extra.ts; hier nur Beschreibung und Ausführung.
 * Jeder Aufruf steht im werkzeug_log; was von draußen kommt, steht in der Fremdinhalt-Hülle und stempelt den Lauf.
 */

const PDF_AKTIONEN = ['info', 'zusammenfuegen', 'teilen', 'seiten_drehen', 'seiten_loeschen', 'seiten_ordnen', 'komprimieren', 'wasserzeichen', 'formular_lesen', 'formular_ausfuellen'] as const;

const DATEIEN_BESCHREIBUNG = 'Vault-Pfade; Dateien aus dem Arbeitsordner des Rechenraums mit „rechenraum:“ davor (z. B. „rechenraum:blatt.pdf“)';

export const EXTRA_DEFINITIONEN: Record<ExtraWerkzeug, Omit<WerkzeugDefinition, 'name'> & { name: ExtraWerkzeug }> = {
  pdf_bearbeiten: {
    name: 'pdf_bearbeiten',
    description:
      'PDFs bearbeiten (im Rechenraum, ohne Internet): info, zusammenfuegen (mehrere dateien in Reihenfolge), teilen (seiten „1-3;4-6“, leer = jede Seite einzeln), seiten_drehen (grad 90/180/270), seiten_loeschen, seiten_ordnen (seiten = neue Reihenfolge, z. B. „3,1,2,4-“), komprimieren (für Upload-Grenzen), wasserzeichen (text), formular_lesen, formular_ausfuellen (felder {Name: Wert}). Ergebnis landet im Ablage-Ordner dieses Chats (Leif sieht es als Download) und im Arbeitsordner. Eingereicht wird nie etwas.',
    input_schema: {
      type: 'object',
      properties: {
        aktion: { type: 'string', enum: [...PDF_AKTIONEN] },
        dateien: { type: 'array', items: { type: 'string' }, description: DATEIEN_BESCHREIBUNG },
        seiten: { type: 'string', description: 'z. B. „1-3,5“, „4-“; bei teilen Gruppen mit „;“' },
        grad: { type: 'integer' },
        text: { type: 'string', description: 'Wasserzeichen-Text' },
        felder: { type: 'object', description: 'formular_ausfuellen: {Feldname: Wert}; Kästchen mit "ja"/"nein"' },
        name: { type: 'string', description: 'Dateiname des Ergebnisses (ohne Endung)' },
      },
      required: ['aktion', 'dateien'],
      additionalProperties: false,
    },
  },
  diagramm_zeichnen: {
    name: 'diagramm_zeichnen',
    description:
      'Zeichnet ein Diagramm aus Graphviz-DOT (z. B. „digraph { Mathe -> Statistik }“) als SVG, PNG oder PDF in den Ablage-Ordner. Mermaid geht nur als ```mermaid-Block in einer Notiz (Obsidian zeigt ihn an) – zum Bild braucht es einen Browser. Diagramme mit Daten: matplotlib im Rechenraum.',
    input_schema: {
      type: 'object',
      properties: {
        quelle: { type: 'string', description: 'Graphviz DOT' },
        format: { type: 'string', enum: ['svg', 'png', 'pdf'] },
        programm: { type: 'string', enum: ['dot', 'neato', 'fdp', 'circo', 'twopi'], description: 'Layout (Standard dot)' },
        name: { type: 'string' },
      },
      required: ['quelle'],
      additionalProperties: false,
    },
  },
  handschrift_schreiben: {
    name: 'handschrift_schreiben',
    description:
      'Schreibt Text als echt wirkende Handschrift – EINE Hand für alles (Text, Formeln, Tabellen), ungleichmäßig wie echt, auf Wunsch mit Verschriebenem und Durchgestrichenem; Umlaute ja. Formeln als $…$ (LaTeX: \\frac, \\sqrt, ^, _, \\sum, \\int, \\land, \\lor, \\neg, \\vdash …) oder schlicht „3x + 5 = 20 | -5“, „¬(p ∧ q) → r“ – Rechenwege (eine Umformung je Zeile) stehen am „=“/„≡“ untereinander. Tabellen als Markdown (| a | b |, |---|), gerade Linien wie in GoodNotes. Höchstens 1500 Zeichen je Aufruf. Ergebnis PNG/SVG/PDF im Ablage-Ordner.',


    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Der Text; Zeilenumbrüche = neue Zeile/Absatz' },
        unordnung: { type: 'number', description: '0 = ordentlich … 0,5 = normal (Standard) … 1 = hastig gekritzelt' },
        papier: { type: 'string', enum: ['blanko', 'liniert', 'kariert', 'keins'], description: 'keins = durchsichtig, eng zugeschnitten (zum Einfügen)' },
        tinte: { type: 'string', enum: ['blau', 'schwarz', 'bleistift', 'rot', 'gruen'] },
        groesse: { type: 'number', description: 'Schriftgröße 0,6–1,6 (Standard 1)' },
        durchstreichen: { type: 'boolean', description: 'ab und zu ein Wort verschreiben und durchstreichen (Standard ja; nur bei unordnung > 0 spürbar)' },
        format: { type: 'string', enum: ['png', 'svg', 'pdf'] },
        seed: { type: 'integer', description: 'gleicher seed = gleiche Handschrift; weglassen = jedes Mal ein anderer „Schreiber“' },
        stil: { type: 'string', enum: ['eigene', 'einheitlich', 'ki'], description: 'eigene: Leifs Hand aus der Schriftprobe (Standard, wenn es eine gibt); einheitlich: EINE erfundene Hand für alles; ki: freier Fließtext vom KI-Modell (verschreibt sich)' },
        name: { type: 'string' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  daten_abfragen: {
    name: 'daten_abfragen',
    description:
      'Tabellen auswerten mit SQL (DuckDB im Rechenraum): CSV (auch mit „;“ und Dezimalkomma), Excel, ODS, JSON, Parquet. Jede Datei wird eine Tabelle (Name = Dateiname klein, z. B. umsaetze). Ohne sql: Spalten, Typen und erste Zeilen. Mit sql: Ergebnis als Tabelle (bis 100 Zeilen), mit als_csv das ganze Ergebnis als CSV in den Ablage-Ordner. Für Diagramme danach matplotlib im Rechenraum.',
    input_schema: {
      type: 'object',
      properties: {
        dateien: { type: 'array', items: { type: 'string' }, description: DATEIEN_BESCHREIBUNG },
        sql: { type: 'string', description: 'EINE Abfrage, z. B. SELECT kategorie, SUM(betrag) FROM umsaetze GROUP BY 1' },
        als_csv: { type: 'boolean' },
        name: { type: 'string' },
      },
      required: ['dateien'],
      additionalProperties: false,
    },
  },
  qr_code: {
    name: 'qr_code',
    description: 'Erzeugt einen QR-Code (PNG oder SVG) in den Ablage-Ordner: Link, Text, WLAN („WIFI:T:WPA;S:<Name>;P:<Passwort>;;“), Kontakt (vCard).',
    input_schema: {
      type: 'object',
      properties: { inhalt: { type: 'string' }, format: { type: 'string', enum: ['png', 'svg'] }, name: { type: 'string' } },
      required: ['inhalt'],
      additionalProperties: false,
    },
  },
  karten_anki: {
    name: 'karten_anki',
    description: 'Exportiert die Karteikarten eines Fachs (Uni/faecher/<fach>/karten.md) als Anki-Paket (.apkg) in den Ablage-Ordner – fürs Handy (AnkiDroid/AnkiMobile). Erneuter Import aktualisiert die Karten statt sie zu verdoppeln.',
    input_schema: { type: 'object', properties: { fach: { type: 'string', description: 'Ordnername unter Uni/faecher/' } }, required: ['fach'], additionalProperties: false },
  },
  literatur_suchen: {
    name: 'literatur_suchen',
    description:
      'Sucht ECHTE wissenschaftliche Literatur (Crossref: Artikel/Bücher mit DOI und Zitationszahl; arXiv: Preprints mit Abstract; Open Library: Bücher mit ISBN). Nie Quellen erfinden – nur, was hier gefunden wurde. Ergebnis ist Fremdinhalt. Für BibTeX danach doi_bibtex.',
    input_schema: {
      type: 'object',
      properties: {
        anfrage: { type: 'string', description: 'Suchwörter (Titel, Thema, Autor)' },
        quelle: { type: 'string', enum: ['alle', 'crossref', 'arxiv', 'buecher'] },
        anzahl: { type: 'integer', description: '1–20 je Quelle (Standard 8)' },
      },
      required: ['anfrage'],
      additionalProperties: false,
    },
  },
  doi_bibtex: {
    name: 'doi_bibtex',
    description: 'Holt zu einer DOI den BibTeX-Eintrag (doi.org). Mit merken: true wird er an Uni/literatur.bib angehängt (jede DOI nur einmal; Leif kann es zurücknehmen).',
    input_schema: {
      type: 'object',
      properties: { doi: { type: 'string', description: 'z. B. 10.1007/978-3-540-85066-3_3' }, merken: { type: 'boolean' } },
      required: ['doi'],
      additionalProperties: false,
    },
  },
  verbindung_suchen: {
    name: 'verbindung_suchen',
    description:
      'Zug-/Öffi-Verbindungen in Europa (Transitous, freie Fahrplandaten, teils Echtzeit): Abfahrt/Ankunft, Dauer, Umstiege, Züge und Gleise. Nur Auskunft – Preise und Buchen gibt es nicht. von/nach als Bahnhof oder Ort (z. B. „Konstanz“, „Linz Hbf“).',
    input_schema: {
      type: 'object',
      properties: {
        von: { type: 'string' },
        nach: { type: 'string' },
        zeit: { type: 'string', description: 'Ortszeit „JJJJ-MM-TT HH:MM“ (Standard: jetzt)' },
        ankunft: { type: 'boolean', description: 'true = zeit ist die späteste Ankunft' },
        anzahl: { type: 'integer', description: '1–5 Verbindungen (Standard 3)' },
      },
      required: ['von', 'nach'],
      additionalProperties: false,
    },
  },
  wetter_vorhersage: {
    name: 'wetter_vorhersage',
    description: 'Wettervorhersage für bis zu 16 Tage an einem Ort (Open-Meteo): Wetter, Temperatur, Regenrisiko und -menge, Wind. Ohne ort: Leifs Wohnort.',
    input_schema: {
      type: 'object',
      properties: { ort: { type: 'string' }, tage: { type: 'integer', description: '1–16 (Standard 3)' } },
      required: [],
      additionalProperties: false,
    },
  },
  feiertage: {
    name: 'feiertage',
    description: 'Gesetzliche Feiertage eines Jahres in Österreich (Linz) und Baden-Württemberg (Konstanz) – für Lernpläne, Reisen und Fristen. Rechnet lokal.',
    input_schema: {
      type: 'object',
      properties: { jahr: { type: 'integer' }, region: { type: 'string', enum: ['beide', 'AT', 'DE-BW'] } },
      required: [],
      additionalProperties: false,
    },
  },
  umrechnen: {
    name: 'umrechnen',
    description:
      'Rechnet Einheiten um (Länge, Fläche, Volumen, Masse, Zeit, Geschwindigkeit, Energie, Druck, Daten, Leistung, Temperatur – z. B. mi→km, °F→°C, kcal→kJ) und Währungen zum EZB-Referenzkurs des letzten Bankarbeitstags (EUR, CHF, USD, GBP …).',
    input_schema: {
      type: 'object',
      properties: { wert: { type: 'number' }, von: { type: 'string', description: 'Einheit oder Währung, z. B. „km“, „°F“, „CHF“' }, nach: { type: 'string' } },
      required: ['wert', 'von', 'nach'],
      additionalProperties: false,
    },
  },
  post_anhang_lesen: {
    name: 'post_anhang_lesen',
    description:
      'Anhänge einer Mail aus Leifs Posteingang: ohne nr die Liste (Name, Typ, Größe); mit nr wird der Anhang unter Post/anhaenge/ gespeichert und gelesen (PDF, Word, Excel, Bilder … wie vault_lesen). Inhalt ist Fremdinhalt.',
    input_schema: {
      type: 'object',
      properties: { mail_id: { type: 'string' }, nr: { type: 'integer', description: 'Nummer aus der Liste (ab 1)' } },
      required: ['mail_id'],
      additionalProperties: false,
    },
  },
};

// ---- Netz: feste Adressen, eigene Kennung, Zwischenspeicher --------------------------------------------------------

export const NETZ_URLS = {
  crossref: 'https://api.crossref.org/works',
  arxiv: 'https://export.arxiv.org/api/query',
  openlibrary: 'https://openlibrary.org/search.json',
  doi: 'https://doi.org',
  transitous: 'https://api.transitous.org',
  geocoding: 'https://geocoding-api.open-meteo.com/v1/search',
  wetter: 'https://api.open-meteo.com/v1/forecast',
  ezb: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
} as const;

export interface ExtraNetz {
  abruf: (url: string, init?: RequestInit) => Promise<Response>;
  /** User-Agent: Name, Version, Kontakt (Transitous verlangt das; Crossref bevorzugt es) */
  agent: string;
  wetterOrt: string;
  urls?: Partial<Record<keyof typeof NETZ_URLS, string>>;
  /** EZB-Kurse, 6 h zwischengespeichert */
  kurse?: { bis: number; datum: string; kurse: Record<string, number> };
  /** Transitous bittet um wenig Last (< 720 Routensuchen am Tag): eigene Obergrenze je Tag */
  planZaehler?: { tag: string; anzahl: number };
}

export const VERBINDUNGEN_JE_TAG = 100;

export function netzBauen(o: { version: string; kontakt: string; wetterOrt: string }, abruf: ExtraNetz['abruf'] = (u, i) => fetch(u, i)): ExtraNetz {
  return { abruf, agent: `Agentendorf/${o.version} (privat, nicht kommerziell; +${o.kontakt})`, wetterOrt: o.wetterOrt };
}

const url = (n: ExtraNetz, k: keyof typeof NETZ_URLS) => n.urls?.[k] ?? NETZ_URLS[k];

async function holen(n: ExtraNetz, dienst: string, adresse: string, kopf: Record<string, string> = {}): Promise<Response> {
  let r: Response;
  try {
    r = await n.abruf(adresse, { headers: { 'user-agent': n.agent, ...kopf }, signal: AbortSignal.timeout(25_000), redirect: 'follow' });
  } catch (e) {
    throw new DorfFehler(502, `${dienst} nicht erreichbar (${(e as Error).message.slice(0, 120)}).`);
  }
  if (r.status === 404) throw new DorfFehler(404, `${dienst}: nicht gefunden.`);
  if (r.status === 429) throw new DorfFehler(429, `${dienst}: zu viele Anfragen – später noch einmal.`);
  if (!r.ok) throw new DorfFehler(502, `${dienst} antwortet mit HTTP ${r.status}.`);
  return begrenzt(r, dienst);
}

/** Höchstens 5 MB einer Antwort lesen (Review E199: ein fehlerhafter Dienst soll den Server-Speicher nicht füllen) */
export const MAX_ANTWORT_BYTES = 5 * 1024 * 1024;
async function begrenzt(r: Response, dienst: string): Promise<Response> {
  if (!r.body) return r;
  const leser = r.body.getReader();
  const teile: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    n += value.byteLength;
    if (n > MAX_ANTWORT_BYTES) {
      await leser.cancel().catch(() => undefined);
      throw new DorfFehler(502, `${dienst}: Antwort zu groß.`);
    }
    teile.push(value);
  }
  return new Response(Buffer.concat(teile), { status: r.status, headers: r.headers });
}
const json = async (r: Response, dienst: string) => {
  try {
    return (await r.json()) as unknown;
  } catch {
    throw new DorfFehler(502, `${dienst}: Antwort nicht lesbar.`);
  }
};

/** EZB-Kurse (zwischengespeichert) – nur die feste Adresse, kein Text des Agenten geht hinaus */
export async function ezbKurse(n: ExtraNetz, jetzt: number) {
  if (n.kurse && n.kurse.bis > jetzt) return n.kurse;
  const r = await holen(n, 'EZB', url(n, 'ezb'));
  const k = ezbKurseParsen(await r.text());
  n.kurse = { bis: jetzt + 6 * 3600_000, ...k };
  return n.kurse;
}

// ---- Anki (auch für die App: GET /api/karten/anki) -------------------------------------------------------------------

/** Baut das Anki-Paket eines Fachs im Rechenraum. Gibt Name und Inhalt zurück; die Datei bleibt im Raum liegen. */
export async function ankiBauen(rr: RechenraumKlient, vault: VaultDienst, fachRoh: string, raum: string): Promise<{ name: string; inhalt: Buffer; anzahl: number; text: string }> {
  const fach = fachRoh.trim();
  if (!fach || /[/\\]/.test(fach) || fach.startsWith('.')) throw new DorfFehler(400, 'Ungültiges Fach.');
  if (!rr.werkzeug) throw new DorfFehler(503, 'Der Rechenraum kann das noch nicht (altes Image).');
  const pfad = normalisieren(`Uni/faecher/${fach}/${KARTEN_DATEI}`);
  const d = await vault.lesen(pfad).catch(() => null);
  if (!d) throw new DorfFehler(404, `Keine Karteikarten: ${pfad} fehlt.`);
  const karten = kartenLesen(fach, d.inhalt).map((k) => ({ frage: k.frage, antwort: k.antwort }));
  if (!karten.length) throw new DorfFehler(404, `In ${pfad} stehen keine Karten („Frage :: Antwort“ oder „### Frage“).`);
  const erg = await rr.werkzeug(raum, { art: 'anki', fach, karten, name: fach });
  if (!erg.ok || !erg.dateien[0]) throw new DorfFehler(400, erg.fehler ?? 'Anki-Export fehlgeschlagen.');
  return { name: erg.dateien[0], inhalt: await rr.lesen(raum, erg.dateien[0]), anzahl: karten.length, text: erg.text ?? '' };
}

// ---- Ausführung -------------------------------------------------------------------------------------------------

export interface ExtraUmgebung {
  db: DB;
  uhr: Uhr;
  vault: VaultDienst;
  k: LaufKontext;
  log(werkzeug: string, eingabe: unknown, ergebnis: string, erlaubt: boolean, pfad?: string, art?: string): void;
  /** Der Lauf hat etwas von außen gelesen (stempelt spätere Notizen, E185/E195) */
  fremd(): void;
  /** vault_lesen (jedes Format, Hülle für Fremdes) */
  lesen(pfad: string): Promise<WerkzeugAufrufErgebnis>;
  merken(art: RueckgaengigArt, titel: string, daten: unknown, leise?: boolean): Promise<void>;
}

const Dateien = z.array(z.string().trim().min(1).max(500)).min(1).max(20);
const Name = z.string().trim().max(100).optional();

export async function extraAufrufen(name: ExtraWerkzeug, eingabe: unknown, u: ExtraUmgebung): Promise<WerkzeugAufrufErgebnis> {
  switch (name) {
    case 'pdf_bearbeiten': {
      const e = z
        .object({
          aktion: z.enum(PDF_AKTIONEN),
          dateien: Dateien,
          seiten: z.string().max(500).optional(),
          grad: z.number().int().optional(),
          text: z.string().max(80).optional(),
          felder: z.record(z.string(), z.union([z.string().max(2000), z.boolean(), z.number()])).optional(),
          name: Name,
        })
        .parse(eingabe);
      return dorfwerk(u, name, e.dateien, { art: 'pdf', aktion: e.aktion, seiten: e.seiten, grad: e.grad, text: e.text, felder: e.felder, name: e.name }, eingabe);
    }
    case 'diagramm_zeichnen': {
      const e = z
        .object({ quelle: z.string().min(1).max(100_000), format: z.enum(['svg', 'png', 'pdf']).optional(), programm: z.enum(['dot', 'neato', 'fdp', 'circo', 'twopi']).optional(), name: Name })
        .parse(eingabe);
      return dorfwerk(u, name, [], { art: 'diagramm', ...e }, { format: e.format, programm: e.programm, name: e.name, zeichen: e.quelle.length });
    }
    case 'handschrift_schreiben': {
      const e = z
        .object({
          text: z.string().min(1).max(1500),
          unordnung: z.number().min(0).max(1).optional(),
          papier: z.enum(['blanko', 'liniert', 'kariert', 'keins']).optional(),
          tinte: z.enum(['blau', 'schwarz', 'bleistift', 'rot', 'gruen']).optional(),
          groesse: z.number().min(0.6).max(1.6).optional(),
          durchstreichen: z.boolean().optional(),
          format: z.enum(['png', 'svg', 'pdf']).optional(),
          seed: z.number().int().min(0).max(2 ** 31).optional(),
          stil: z.enum(['eigene', 'einheitlich', 'ki']).optional(),
          name: Name,
        })
        .parse(eingabe);
      // E216: Leifs Schriftprobe – Standard, sobald es eine gibt; „eigene“ ohne Probe ist ein klarer Fehler
      const probe = e.stil === 'ki' || e.stil === 'einheitlich' ? null : await probeLesen(u.vault);
      if (e.stil === 'eigene' && !probe) {
        const t = 'Es gibt noch keine Schriftprobe – Leif kann sie im Atelier unter „Schriftprobe“ schreiben. Bis dahin stil: einheitlich.';
        u.log(name, { ...e, text: undefined }, t, false);
        return { ok: false, text: t };
      }
      const stil = e.stil === 'ki' ? 'ki' : 'einheitlich';
      return dorfwerk(
        u,
        name,
        [],
        { art: 'handschrift', ...e, stil, ...(probe ? { probe: probe.zeichen } : {}) },
        { ...e, text: undefined, zeichen: e.text.length, eigene_hand: !!probe },
      );
    }
    case 'daten_abfragen': {
      const e = z.object({ dateien: Dateien, sql: z.string().max(20_000).optional(), als_csv: z.boolean().optional(), name: Name }).parse(eingabe);
      return dorfwerk(u, name, e.dateien, { art: 'daten', sql: e.sql, als_csv: e.als_csv, name: e.name }, eingabe);
    }
    case 'qr_code': {
      const e = z.object({ inhalt: z.string().min(1).max(2000), format: z.enum(['png', 'svg']).optional(), name: Name }).parse(eingabe);
      // WLAN-Passwörter u. Ä. nicht ins Protokoll
      return dorfwerk(u, name, [], { art: 'qr', ...e }, { format: e.format, name: e.name, zeichen: e.inhalt.length });
    }
    case 'karten_anki': {
      const { fach } = z.object({ fach: z.string().trim().min(1).max(100) }).parse(eingabe);
      const r = rechenraum(u);
      const a = await ankiBauen(r.klient, u.vault, fach, u.k.chatId);
      const pfad = await ablegen(u, name, a.name, a.inhalt);
      u.log(name, { fach }, `${a.anzahl} Karten → ${pfad}`, true, pfad, 'geschrieben');
      return { ok: true, text: `${a.text}\nAbgelegt: ${pfad} – Leif öffnet die Datei in Anki (Handy: AnkiDroid/AnkiMobile).` };
    }
    case 'literatur_suchen':
      return literatur(u, eingabe);
    case 'doi_bibtex':
      return bibtex(u, eingabe);
    case 'verbindung_suchen':
      return verbindung(u, eingabe);
    case 'wetter_vorhersage':
      return wetter(u, eingabe);
    case 'feiertage': {
      const e = z.object({ jahr: z.number().int().min(1900).max(2200).optional(), region: z.enum(['beide', 'AT', 'DE-BW']).optional() }).parse(eingabe ?? {});
      const heute = tagIn(u.uhr.jetzt());
      const jahr = e.jahr ?? Number(heute.slice(0, 4));
      const region = e.region ?? 'beide';
      const liste = feiertage(jahr).filter((f) => region === 'beide' || f.regionen.includes(region as FeiertagRegion));
      const zeilen = liste.map((f) => `- ${tagText(f.datum)}: ${f.name}${region === 'beide' ? ` (${f.regionen.join(', ')})` : ''}${f.datum < heute ? ' – vorbei' : ''}`);
      u.log(name, e, `${liste.length} Feiertage ${jahr}`, true);
      return {
        ok: true,
        text: `Gesetzliche Feiertage ${jahr} (${region === 'beide' ? 'Österreich und Baden-Württemberg' : region === 'AT' ? 'Österreich' : 'Baden-Württemberg'}):\n${zeilen.join('\n')}\nNicht dabei: Schulferien, vorlesungsfreie Zeit der JKU, Landespatrone (z. B. Florian 4.5. in Oberösterreich).`,
      };
    }
    case 'umrechnen': {
      const e = z.object({ wert: z.number().finite(), von: z.string().trim().min(1).max(30), nach: z.string().trim().min(1).max(30) }).parse(eingabe);
      const a = waehrungsCode(e.von);
      const b = waehrungsCode(e.nach);
      if (a && b) {
        const netz = u.k.netz;
        if (!netz) throw new DorfFehler(503, 'Wechselkurse sind nicht eingerichtet.');
        const k = await ezbKurse(netz, u.uhr.jetzt());
        if (!k.kurse[a] || !k.kurse[b]) throw new DorfFehler(400, `Für ${!k.kurse[a] ? a : b} gibt es keinen EZB-Referenzkurs.`);
        const ergebnis = (e.wert / k.kurse[a]!) * k.kurse[b]!;
        const text = `${zahlText(e.wert)} ${a} = ${betragText(ergebnis)} ${b} (EZB-Referenzkurs vom ${tagText(k.datum)}; 1 EUR = ${zahlText(k.kurse[a === 'EUR' ? b : a]!)} ${a === 'EUR' ? b : a}). Banken und Karten rechnen mit eigenem Kurs.`;
        u.log(name, e, text, true);
        return { ok: true, text };
      }
      const r = einheitenUmrechnen(e.wert, e.von, e.nach);
      u.log(name, e, r.text, true);
      return { ok: true, text: r.text };
    }
    case 'post_anhang_lesen':
      return postAnhang(u, eingabe);
  }
  return { ok: false, text: 'Unbekanntes Werkzeug.' };
}

function rechenraum(u: ExtraUmgebung) {
  const r = u.k.rechenraum;
  if (!r) throw new DorfFehler(503, 'Der Rechenraum ist auf diesem Server nicht eingerichtet.');
  if (!r.klient.werkzeug) throw new DorfFehler(503, 'Der Rechenraum kann das noch nicht (altes Image) – nimm rechenraum_befehl.');
  return r as { klient: RechenraumKlient & Required<Pick<RechenraumKlient, 'werkzeug'>>; ablage: string };
}

/** Eine Datei aus dem Arbeitsordner in den Ablage-Ordner des Chats (vom Code bestimmt) – freier Name, nie fremdes überschreiben */
async function ablegen(u: ExtraUmgebung, werkzeug: string, datei: string, inhalt?: Buffer): Promise<string> {
  const r = rechenraum(u);
  const name = ablageName(datei);
  const ext = path.posix.extname(name);
  const stamm = name.slice(0, -ext.length);
  const vonDiesemChat = (p: string) =>
    !!u.db.prepare("SELECT 1 FROM werkzeug_log WHERE chat_id = ? AND pfad = ? AND art = 'geschrieben' AND erlaubt = 1 LIMIT 1").get(u.k.chatId, p);
  let ziel = `${r.ablage}/${name}`;
  for (let i = 2; (await u.vault.existiert(ziel)) && !vonDiesemChat(ziel); i++) {
    if (i > 50) throw new DorfFehler(409, `Kein freier Name für ${name}.`);
    ziel = `${r.ablage}/${stamm}_${i}${ext}`;
  }
  const daten = inhalt ?? (await r.klient.lesen(u.k.chatId, datei));
  const w = await u.vault.schreiben(ziel, daten);
  u.log(werkzeug, { datei }, `abgelegt (${groesseText(daten.length)})`, true, w.pfad, 'geschrieben');
  return w.pfad;
}

/** Vault-Dateien in den Arbeitsordner kopieren, dorfwerk.py aufrufen, Ergebnisse ablegen */
async function dorfwerk(u: ExtraUmgebung, werkzeug: ExtraWerkzeug, dateien: string[], auftrag: Record<string, unknown>, logEingabe: unknown): Promise<WerkzeugAufrufErgebnis> {
  const r = rechenraum(u);
  const raum = u.k.chatId;
  const eingaben: string[] = [];
  const namen: string[] = [];
  let fremd = false;
  for (const [i, roh] of dateien.entries()) {
    if (roh.startsWith('rechenraum:')) {
      const rel = roh.slice('rechenraum:'.length).trim();
      eingaben.push(rel);
      namen.push(path.posix.basename(rel));
      continue;
    }
    const pfad = normalisieren(roh);
    const st = await u.vault.stat(pfad);
    if (!st?.isFile()) throw new DorfFehler(404, `Gibt es nicht: ${pfad}`);
    if (st.size > 50 * 1024 * 1024) throw new DorfFehler(413, `${pfad}: zu groß (höchstens 50 MB).`);
    const d = await u.vault.puffer(pfad, { max: 50 * 1024 * 1024 });
    if (!d) throw new DorfFehler(404, `Gibt es nicht: ${pfad}`);
    if (vaultDateiFremd(pfad, d.inhalt, istHochgeladen(pfad))) fremd = true;
    const ziel = `.dorfwerk/ein/${i + 1}_${path.posix.basename(pfad).replace(/[^A-Za-z0-9._-]+/g, '_')}`;
    await r.klient.schreiben(raum, ziel, d.inhalt);
    u.log(werkzeug, { pfad }, `→ Rechenraum`, true, pfad, 'gelesen');
    eingaben.push(ziel);
    namen.push(path.posix.basename(pfad));
  }
  const erg = await r.klient.werkzeug(raum, { ...auftrag, eingaben, namen });
  if (!erg.ok) {
    const t = erg.fehler ?? 'Fehlgeschlagen.';
    u.log(werkzeug, logEingabe, t, false);
    return { ok: false, text: t };
  }
  const abgelegt: string[] = [];
  for (const datei of erg.dateien.slice(0, 60)) abgelegt.push(await ablegen(u, werkzeug, datei));
  // Formularfelder, Tabelleninhalte … aus hochgeladenen Dateien oder dem Arbeitsordner sind Daten von außen
  const ausArbeitsordner = dateien.some((d) => d.startsWith('rechenraum:'));
  let text = erg.text ?? 'Fertig.';
  if (fremd || ausArbeitsordner) {
    u.fremd();
    text = fremdinhaltHuelle(werkzeug, text);
  }
  u.log(werkzeug, logEingabe, `${(erg.text ?? '').split('\n')[0]!.slice(0, 200)}${abgelegt.length ? ` · ${abgelegt.length} Datei(en)` : ''}`, true);
  if (abgelegt.length)
    text += `\n\nAbgelegt (Leif sieht sie im Chat):\n${abgelegt.map((p) => `- ${p}`).join('\n')}\nIm Arbeitsordner: ${erg.dateien.map((d) => `rechenraum:${d}`).join(', ')}`;
  return { ok: true, text };
}

async function literatur(u: ExtraUmgebung, eingabe: unknown): Promise<WerkzeugAufrufErgebnis> {
  const netz = netzNoetig(u);
  const e = z
    .object({ anfrage: z.string().trim().min(2).max(300), quelle: z.enum(['alle', 'crossref', 'arxiv', 'buecher']).optional(), anzahl: z.number().int().min(1).max(20).optional() })
    .parse(eingabe);
  const quelle = e.quelle ?? 'alle';
  const n = e.anzahl ?? 8;
  const q = encodeURIComponent(e.anfrage);
  const aufgaben: [string, () => Promise<Quelle[]>][] = [];
  if (quelle === 'alle' || quelle === 'crossref')
    aufgaben.push([
      'Crossref',
      async () =>
        crossrefParsen(
          await json(
            await holen(netz, 'Crossref', `${url(netz, 'crossref')}?query.bibliographic=${q}&rows=${Math.min(n + 4, 30)}&select=DOI,title,author,issued,container-title,type,is-referenced-by-count,publisher,URL`),
            'Crossref',
          ),
        ).slice(0, n),
    ]);
  if (quelle === 'alle' || quelle === 'arxiv')
    aufgaben.push([
      'arXiv',
      async () => {
        // arXiv-Suchsprache: jedes Wort als all:<wort>, verbunden mit AND (sonst zählt nur das erste Feld)
        const woerter = e.anfrage.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}-]/gu, '')).filter(Boolean).slice(0, 8);
        const p = new URLSearchParams({ search_query: woerter.map((w) => `all:${w}`).join(' AND '), start: '0', max_results: String(n), sortBy: 'relevance' });
        return arxivParsen(await (await holen(netz, 'arXiv', `${url(netz, 'arxiv')}?${p}`)).text());
      },
    ]);
  if (quelle === 'alle' || quelle === 'buecher')
    aufgaben.push([
      'Open Library',
      async () => openlibraryParsen(await json(await holen(netz, 'Open Library', `${url(netz, 'openlibrary')}?q=${q}&limit=${Math.min(n, 10)}&fields=key,title,author_name,first_publish_year,isbn,publisher,edition_count`), 'Open Library')),
    ]);
  const ergebnisse = await Promise.allSettled(aufgaben.map(([, f]) => f()));
  const teile: string[] = [];
  let anzahl = 0;
  ergebnisse.forEach((r, i) => {
    const dienst = aufgaben[i]![0];
    if (r.status === 'fulfilled') {
      anzahl += r.value.length;
      teile.push(`## ${dienst} (${r.value.length})\n${r.value.length ? r.value.map(quelleZeile).join('\n') : '(nichts gefunden)'}`);
    } else teile.push(`## ${dienst}\n(nicht erreichbar: ${(r.reason as Error).message})`);
  });
  u.fremd();
  const ok = ergebnisse.some((r) => r.status === 'fulfilled');
  u.log('literatur_suchen', e, `${anzahl} Treffer`, ok, undefined, 'web');
  return { ok, text: fremdinhaltHuelle('literatur', teile.join('\n\n')) };
}

export { LITERATUR_BIB };

async function bibtex(u: ExtraUmgebung, eingabe: unknown): Promise<WerkzeugAufrufErgebnis> {
  const netz = netzNoetig(u);
  const e = z.object({ doi: z.string().trim().min(5).max(300), merken: z.boolean().optional() }).parse(eingabe);
  const doi = doiNormalisieren(e.doi);
  if (!doi) throw new DorfFehler(400, `„${e.doi}“ ist keine DOI (Form 10.xxxx/…).`);
  // Uni/literatur.bib liegt im Uni-Gebäude: direkt schreiben nur von dort und für den Bürgermeister (Review E199)
  if (e.merken && u.k.gebaeude !== 'Uni' && u.k.gebaeude !== 'Rathaus')
    throw new DorfFehler(403, `${LITERATUR_BIB} gehört zum Uni-Gebäude – von hier nur ohne „merken“ (den Eintrag dann zeigen).`);
  // DOIs sind unabhängig von Groß-/Kleinschreibung; steht sie schon in der .bib, braucht es keinen Abruf
  const altGelesen = e.merken ? await u.vault.lesen(LITERATUR_BIB).catch(() => null) : null;
  const doiMuster = new RegExp(`doi\\s*=\\s*[{"]${doi.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[}"]`, 'i');
  if (altGelesen && doiMuster.test(altGelesen.inhalt)) {
    u.log('doi_bibtex', e, `steht schon in ${LITERATUR_BIB}`, true);
    return { ok: true, text: `DOI ${doi} steht schon in ${LITERATUR_BIB} – nichts geändert.` };
  }
  const r = await holen(netz, 'doi.org', `${url(netz, 'doi')}/${doi.split('/').map(encodeURIComponent).join('/')}`, { accept: 'application/x-bibtex; charset=utf-8' });
  const roh = (await r.text()).slice(0, 50_000);
  const { eintrag, schluessel } = bibtexAufbereiten(roh);
  u.fremd();
  if (!e.merken) {
    u.log('doi_bibtex', e, `@${schluessel}`, true, undefined, 'web');
    return { ok: true, text: fremdinhaltHuelle(`doi:${doi}`, eintrag) };
  }
  // Neue Liste: erst mit Kopf anlegen, dann wie unten anhängen – so gibt es auch beim ersten Eintrag „Rückgängig“
  let alt = altGelesen;
  if (!alt) {
    await u.vault.schreiben(LITERATUR_BIB, '% Literatur (vom Agentendorf gepflegt, in Obsidian/LaTeX nutzbar)\n', { nurNeu: true });
    alt = await u.vault.lesen(LITERATUR_BIB);
  }
  // Schlüssel eindeutig halten (lecun2015deep, lecun2015deepb, …)
  let schl = schluessel;
  for (let i = 0; alt && new RegExp(`@\\w+\\{${schl},`).test(alt.inhalt); i++) schl = `${schluessel}${String.fromCharCode(98 + i)}`;
  const neu = eintrag.replace(`{${schluessel},`, `{${schl},`);
  {
    // wie vault_aendern: alte Fassung ins Archiv, Schreiben nur auf die gelesene Fassung, Leif kann es zurücknehmen
    const archiv = `Uni/archiv/aenderungen/${dateiStempel(u.uhr.jetzt())}_${crypto.randomUUID().slice(0, 6)}_literatur.bib`;
    await u.vault.schreiben(archiv, alt.inhalt, { nurNeu: true });
    const w = await u.vault.schreiben(LITERATUR_BIB, `${alt.inhalt.replace(/\n*$/, '\n\n')}${neu}\n`, { basisVersion: alt.version });
    if (w.konflikt) throw new DorfFehler(409, `${LITERATUR_BIB} wurde gerade geändert – noch einmal versuchen.`);
    await u.merken('datei_geaendert', `Literatur ergänzt: ${schl}`, { pfad: LITERATUR_BIB, archiv, version: w.version }, true);
  }
  u.log('doi_bibtex', e, `@${schl} → ${LITERATUR_BIB}`, true, LITERATUR_BIB, 'geschrieben');
  return { ok: true, text: `${fremdinhaltHuelle(`doi:${doi}`, neu)}\nIn ${LITERATUR_BIB} eingetragen als \\cite{${schl}}.` };
}

function netzNoetig(u: ExtraUmgebung) {
  if (!u.k.netz) throw new DorfFehler(503, 'Abrufe nach draußen sind auf diesem Server nicht eingerichtet.');
  return u.k.netz;
}

interface Haltestelle {
  id: string;
  name: string;
  country?: string;
}

async function haltestelle(netz: ExtraNetz, text: string): Promise<Haltestelle> {
  const r = await holen(netz, 'Transitous', `${url(netz, 'transitous')}/api/v1/geocode?text=${encodeURIComponent(text)}&type=STOP`);
  const l = (await json(r, 'Transitous')) as { id?: string; name?: string; country?: string; type?: string }[];
  const h = Array.isArray(l) ? l.find((x) => x.id && x.name) : undefined;
  if (!h) throw new DorfFehler(404, `Keinen Bahnhof/keine Haltestelle zu „${text}“ gefunden.`);
  return { id: h.id!, name: h.name!, country: h.country };
}

async function verbindung(u: ExtraUmgebung, eingabe: unknown): Promise<WerkzeugAufrufErgebnis> {
  const netz = netzNoetig(u);
  const e = z
    .object({ von: z.string().trim().min(2).max(120), nach: z.string().trim().min(2).max(120), zeit: z.string().trim().max(30).optional(), ankunft: z.boolean().optional(), anzahl: z.number().int().min(1).max(5).optional() })
    .parse(eingabe);
  const tag = tagIn(u.uhr.jetzt());
  if (netz.planZaehler?.tag !== tag) netz.planZaehler = { tag, anzahl: 0 };
  if (netz.planZaehler.anzahl >= VERBINDUNGEN_JE_TAG) throw new DorfFehler(429, `Heute schon ${VERBINDUNGEN_JE_TAG} Verbindungssuchen – Transitous ist ein freiwilliges Projekt, morgen wieder.`);
  const zeit = e.zeit ? ortszeitZuMs(e.zeit) : u.uhr.jetzt();
  const [von, nach] = await Promise.all([haltestelle(netz, e.von), haltestelle(netz, e.nach)]);
  netz.planZaehler.anzahl++;
  const p = new URLSearchParams({ fromPlace: von.id, toPlace: nach.id, time: new Date(zeit).toISOString(), arriveBy: String(!!e.ankunft), numItineraries: String(e.anzahl ?? 3) });
  const plan = await json(await holen(netz, 'Transitous', `${url(netz, 'transitous')}/api/v5/plan?${p}`), 'Transitous');
  const text = `Verbindungen ${von.name} → ${nach.name} (${e.ankunft ? 'Ankunft bis' : 'ab'} ${new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(zeit)}; alle Zeiten MEZ/MESZ):\n${verbindungenText(plan, e.anzahl ?? 3)}`;
  u.fremd();
  u.log('verbindung_suchen', e, `${von.name} → ${nach.name}`, true, undefined, 'web');
  return { ok: true, text: `${fremdinhaltHuelle('transitous', text)}\nDaten: Transitous (transitous.org/sources), ohne Gewähr. Preise und Buchung nur bei ÖBB/DB/SBB – nichts wird gebucht.` };
}

async function wetter(u: ExtraUmgebung, eingabe: unknown): Promise<WerkzeugAufrufErgebnis> {
  const netz = netzNoetig(u);
  const e = z.object({ ort: z.string().trim().min(2).max(100).optional(), tage: z.number().int().min(1).max(16).optional() }).parse(eingabe ?? {});
  const ort = e.ort ?? netz.wetterOrt;
  const geo = (await json(await holen(netz, 'Open-Meteo', `${url(netz, 'geocoding')}?name=${encodeURIComponent(ort)}&count=1&language=de&format=json`), 'Open-Meteo')) as {
    results?: { name: string; latitude: number; longitude: number; admin1?: string; country?: string }[];
  };
  const g = geo.results?.[0];
  if (!g) throw new DorfFehler(404, `Ort „${ort}“ nicht gefunden.`);
  const p = new URLSearchParams({
    latitude: String(g.latitude),
    longitude: String(g.longitude),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max',
    timezone: 'auto',
    forecast_days: String(e.tage ?? 3),
  });
  const tage = wetterTage(await json(await holen(netz, 'Open-Meteo', `${url(netz, 'wetter')}?${p}`), 'Open-Meteo'));
  u.fremd();
  u.log('wetter_vorhersage', e, `${g.name}: ${tage.length} Tage`, true, undefined, 'web');
  return { ok: true, text: fremdinhaltHuelle('open-meteo', `Wetter ${g.name}${g.admin1 ? ` (${g.admin1}${g.country ? `, ${g.country}` : ''})` : ''}:\n${tage.join('\n')}`) };
}

async function postAnhang(u: ExtraUmgebung, eingabe: unknown): Promise<WerkzeugAufrufErgebnis> {
  const gmail = u.k.post;
  if (!gmail) throw new DorfFehler(503, 'Gmail ist nicht verbunden (dorf gmail-anmelden).');
  if (!gmail.anhaenge || !gmail.anhangLaden) throw new DorfFehler(503, 'Anhänge lesen geht mit dieser Gmail-Verbindung nicht.');
  const e = z.object({ mail_id: z.string().trim().min(1).max(200), nr: z.number().int().min(1).max(100).optional() }).parse(eingabe);
  const mail = u.db.prepare('SELECT id, datum FROM post_mails WHERE id = ?').get(e.mail_id) as { id: string; datum: number } | undefined;
  if (!mail) throw new DorfFehler(404, 'Diese Mail kennt das Dorf nicht (nur Mails aus dem Posteingang).');
  const liste = await gmail.anhaenge(mail.id);
  u.fremd();
  if (e.nr === undefined) {
    u.log('post_anhang_lesen', e, `${liste.length} Anhänge`, true, undefined, 'gelesen');
    return {
      ok: true,
      text: fremdinhaltHuelle('gmail-anhaenge', liste.length ? liste.map((a) => `${a.nr}. ${a.name} (${typText(a.name)}, ${groesseText(a.groesse)})`).join('\n') : '(keine Anhänge)'),
    };
  }
  const a = liste.find((x) => x.nr === e.nr);
  if (!a) throw new DorfFehler(404, `Anhang ${e.nr} gibt es nicht (die Mail hat ${liste.length}).`);
  if (a.groesse > MAX_ANHANG_BYTES) throw new DorfFehler(413, `${a.name} ist zu groß (${groesseText(a.groesse)}).`);
  const daten = await gmail.anhangLaden(mail.id, a);
  if (daten.length > MAX_ANHANG_BYTES) throw new DorfFehler(413, `${a.name} ist zu groß (${groesseText(daten.length)}).`);
  // Ablage vom Code bestimmt: Post/anhaenge/<Tag der Mail>_<Mail-ID>/ – „anhaenge/“ heißt für jedes spätere Lesen: Fremdinhalt
  const ordner = `Post/anhaenge/${tagIn(mail.datum)}_${mail.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 20)}`;
  const name = dateinameBereinigen(a.name) || `anhang-${a.nr}`;
  // Nie überschreiben (Review E199): gleicher Inhalt → wiederverwenden, sonst nächster freier Name
  let pfad = '';
  for (const kandidat of [`${ordner}/${name}`, `${ordner}/${a.nr}_${name}`]) {
    const st = await u.vault.stat(kandidat);
    if (!st) {
      await u.vault.schreiben(kandidat, daten, { nurNeu: true });
      pfad = kandidat;
      break;
    }
    const vorhanden = st.isFile() && st.size === daten.length ? await u.vault.puffer(kandidat, { max: MAX_ANHANG_BYTES }).catch(() => null) : null;
    if (vorhanden?.inhalt.equals(daten)) {
      pfad = kandidat;
      break;
    }
  }
  if (!pfad) throw new DorfFehler(409, `In ${ordner} liegt schon eine andere Datei namens ${name}.`);
  u.log('post_anhang_lesen', { mail_id: e.mail_id, nr: e.nr }, `${groesseText(daten.length)} → ${pfad}`, true, pfad, 'geschrieben');
  const gelesen = await u.lesen(pfad);
  return {
    ok: gelesen.ok,
    text: `Anhang ${a.nr} gespeichert: ${pfad} (weiterverarbeiten z. B. mit pdf_bearbeiten oder rechenraum_vault_kopieren).\n\n${gelesen.text}`,
    ...(gelesen.bilder?.length ? { bilder: gelesen.bilder } : {}),
  };
}

/** Knapper Abschnitt für den Systemprompt (kontext.ts) – nur, was dieser Lauf wirklich hat */
export function extraHinweise(hat: (n: ExtraWerkzeug) => boolean): string[] {
  const z: string[] = [];
  if (hat('pdf_bearbeiten'))
    z.push(
      '- pdf_bearbeiten, diagramm_zeichnen (Graphviz), daten_abfragen (SQL/DuckDB über CSV/Excel), qr_code, karten_anki (.apkg), handschrift_schreiben (Text als echte, ungleichmäßige Handschrift – unordnung 0 ordentlich … 1 gekritzelt): feste Werkzeuge im Rechenraum, Ergebnis direkt im Ablage-Ordner. Mermaid: als ```mermaid-Block in eine Notiz schreiben. ZIP: python3 -m zipfile -c paket.zip … im Rechenraum.',
    );
  if (hat('literatur_suchen'))
    z.push('- literatur_suchen, doi_bibtex (merken → Uni/literatur.bib): nur echte, gefundene Quellen zitieren. verbindung_suchen: Zugverbindungen (nur Auskunft). wetter_vorhersage: bis 16 Tage.');
  if (hat('feiertage')) z.push('- feiertage (AT, Baden-Württemberg), umrechnen (Einheiten, Währungen zum EZB-Kurs)');
  if (hat('post_anhang_lesen')) z.push('- post_anhang_lesen: Anhänge einer Mail auflisten/lesen (gespeichert unter Post/anhaenge/, Fremdinhalt)');
  return z;
}
