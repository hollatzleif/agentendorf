import { tagPlus, versatzMinuten, ZONE_WIEN } from '../zeit.js';
import { DorfFehler } from '../fehler.js';

/**
 * E199: Reine Hilfen der neuen Werkzeuge – rechnen lokal oder lesen die Antworten freier Schnittstellen aus (ohne Schlüssel).
 * Formate am 20.11.2026 per Abruf geprüft (Beispiele in test/fixtures/e199/):
 *   Crossref   api.crossref.org/works?query.bibliographic=…          JSON message.items[]
 *   arXiv      export.arxiv.org/api/query?search_query=all:…         Atom-XML <entry>
 *   OpenLibrary openlibrary.org/search.json?q=…                      JSON docs[]
 *   doi.org    Accept: application/x-bibtex                          BibTeX (über Crossref/DataCite)
 *   Transitous api.transitous.org/api/v1/geocode, /api/v5/plan        MOTIS 2 (v2.11.4)
 *   Open-Meteo geocoding-api.open-meteo.com/v1/search, api.open-meteo.com/v1/forecast
 *   EZB        www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml  Referenzkurse je Euro
 */

// ---- Feiertage (lokal gerechnet) --------------------------------------------------------------------------------

/** Ostersonntag (gregorianisch, Algorithmus nach Gauß/„Anonymous Gregorian“) als JJJJ-MM-TT */
export function ostersonntag(jahr: number) {
  const a = jahr % 19;
  const b = Math.floor(jahr / 100);
  const c = jahr % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31);
  const tag = ((h + l - 7 * m + 114) % 31) + 1;
  return `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`;
}

export type FeiertagRegion = 'AT' | 'DE-BW';
export interface Feiertag {
  datum: string;
  name: string;
  regionen: FeiertagRegion[];
}

/**
 * Gesetzliche Feiertage in Österreich (bundesweit, Feiertagsruhegesetz; Karfreitag seit 2019 nicht mehr) und in
 * Baden-Württemberg (Konstanz). Schulferien und regionale Patronatstage (z. B. Florian in Oberösterreich) sind keine
 * gesetzlichen Feiertage und fehlen bewusst.
 */
export function feiertage(jahr: number): Feiertag[] {
  const ostern = ostersonntag(jahr);
  const o = (n: number) => tagPlus(ostern, n);
  const t = (mmtt: string) => `${jahr}-${mmtt}`;
  const liste: Feiertag[] = [
    { datum: t('01-01'), name: 'Neujahr', regionen: ['AT', 'DE-BW'] },
    { datum: t('01-06'), name: 'Heilige Drei Könige', regionen: ['AT', 'DE-BW'] },
    { datum: o(-2), name: 'Karfreitag', regionen: ['DE-BW'] },
    { datum: o(1), name: 'Ostermontag', regionen: ['AT', 'DE-BW'] },
    { datum: t('05-01'), name: 'Staatsfeiertag / Tag der Arbeit', regionen: ['AT', 'DE-BW'] },
    { datum: o(39), name: 'Christi Himmelfahrt', regionen: ['AT', 'DE-BW'] },
    { datum: o(50), name: 'Pfingstmontag', regionen: ['AT', 'DE-BW'] },
    { datum: o(60), name: 'Fronleichnam', regionen: ['AT', 'DE-BW'] },
    { datum: t('08-15'), name: 'Mariä Himmelfahrt', regionen: ['AT'] },
    { datum: t('10-03'), name: 'Tag der Deutschen Einheit', regionen: ['DE-BW'] },
    { datum: t('10-26'), name: 'Nationalfeiertag', regionen: ['AT'] },
    { datum: t('11-01'), name: 'Allerheiligen', regionen: ['AT', 'DE-BW'] },
    { datum: t('12-08'), name: 'Mariä Empfängnis', regionen: ['AT'] },
    { datum: t('12-25'), name: 'Christtag / 1. Weihnachtstag', regionen: ['AT', 'DE-BW'] },
    { datum: t('12-26'), name: 'Stefanitag / 2. Weihnachtstag', regionen: ['AT', 'DE-BW'] },
  ];
  return liste.sort((a, b) => a.datum.localeCompare(b.datum));
}

const WOCHENTAG = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const wochentag = (tag: string) => WOCHENTAG[new Date(`${tag}T12:00:00Z`).getUTCDay()]!;
export const tagText = (tag: string) => `${wochentag(tag)} ${tag.slice(8, 10)}.${tag.slice(5, 7)}.${tag.slice(0, 4)}`;

// ---- Einheiten (lokal) ------------------------------------------------------------------------------------------

type Dimension = 'Länge' | 'Fläche' | 'Volumen' | 'Masse' | 'Zeit' | 'Geschwindigkeit' | 'Energie' | 'Druck' | 'Datenmenge' | 'Leistung';
/** Faktor zur SI-Basis der Dimension (m, m², m³, kg, s, m/s, J, Pa, Byte, W) */
const EINHEITEN: Record<string, [Dimension, number]> = {};
function einheit(dim: Dimension, faktor: number, ...namen: string[]) {
  for (const n of namen) EINHEITEN[n.toLowerCase()] = [dim, faktor];
}
einheit('Länge', 1, 'm', 'meter');
einheit('Länge', 1000, 'km', 'kilometer');
einheit('Länge', 0.01, 'cm', 'zentimeter');
einheit('Länge', 0.001, 'mm', 'millimeter');
einheit('Länge', 1e-6, 'µm', 'um', 'mikrometer');
einheit('Länge', 1e-9, 'nm', 'nanometer');
einheit('Länge', 1609.344, 'mi', 'meile', 'meilen', 'mile', 'miles');
einheit('Länge', 0.9144, 'yd', 'yard');
einheit('Länge', 0.3048, 'ft', 'fuß', 'fuss', 'foot', 'feet');
einheit('Länge', 0.0254, 'in', 'zoll', 'inch', '"');
einheit('Länge', 1852, 'sm', 'nmi', 'seemeile', 'seemeilen');
einheit('Fläche', 1, 'm2', 'm²', 'qm', 'quadratmeter');
einheit('Fläche', 1e6, 'km2', 'km²');
einheit('Fläche', 1e-4, 'cm2', 'cm²');
einheit('Fläche', 1e4, 'ha', 'hektar');
einheit('Fläche', 100, 'ar');
einheit('Fläche', 0.09290304, 'ft2', 'ft²', 'sqft');
einheit('Fläche', 4046.8564224, 'acre', 'acres');
einheit('Volumen', 0.001, 'l', 'liter');
einheit('Volumen', 1e-4, 'dl');
einheit('Volumen', 1e-5, 'cl');
einheit('Volumen', 1e-6, 'ml', 'cm3', 'cm³', 'ccm');
einheit('Volumen', 1, 'm3', 'm³', 'kubikmeter');
einheit('Volumen', 0.003785411784, 'gal', 'gallon', 'gallone');
einheit('Volumen', 2.95735295625e-5, 'floz', 'fl oz');
einheit('Volumen', 0.000236588, 'cup', 'cups');
einheit('Masse', 1, 'kg', 'kilogramm');
einheit('Masse', 0.001, 'g', 'gramm');
einheit('Masse', 1e-6, 'mg', 'milligramm');
einheit('Masse', 1000, 't', 'tonne', 'tonnen');
einheit('Masse', 0.45359237, 'lb', 'lbs', 'pfund (us)', 'pound');
einheit('Masse', 0.028349523125, 'oz', 'unze', 'ounce');
einheit('Masse', 0.5, 'pfund');
einheit('Masse', 6.35029318, 'st', 'stone');
einheit('Zeit', 1, 's', 'sek', 'sekunde', 'sekunden');
einheit('Zeit', 0.001, 'ms');
einheit('Zeit', 60, 'min', 'minute', 'minuten');
einheit('Zeit', 3600, 'h', 'std', 'stunde', 'stunden');
einheit('Zeit', 86400, 'd', 'tag', 'tage');
einheit('Zeit', 604800, 'woche', 'wochen');
einheit('Geschwindigkeit', 1, 'm/s');
einheit('Geschwindigkeit', 1 / 3.6, 'km/h', 'kmh');
einheit('Geschwindigkeit', 0.44704, 'mph');
einheit('Geschwindigkeit', 1852 / 3600, 'kn', 'knoten');
einheit('Energie', 1, 'j', 'joule');
einheit('Energie', 1000, 'kj');
einheit('Energie', 4.184, 'cal');
einheit('Energie', 4184, 'kcal');
einheit('Energie', 3600, 'wh');
einheit('Energie', 3.6e6, 'kwh');
einheit('Energie', 1.602176634e-19, 'ev');
einheit('Druck', 1, 'pa');
einheit('Druck', 100, 'hpa');
einheit('Druck', 1000, 'kpa');
einheit('Druck', 1e5, 'bar');
einheit('Druck', 100, 'mbar');
einheit('Druck', 101325, 'atm');
einheit('Druck', 6894.757293168, 'psi');
einheit('Druck', 133.322387415, 'mmhg');
einheit('Datenmenge', 1, 'b', 'byte', 'bytes');
einheit('Datenmenge', 0.125, 'bit');
einheit('Datenmenge', 1e3, 'kb');
einheit('Datenmenge', 1e6, 'mb');
einheit('Datenmenge', 1e9, 'gb');
einheit('Datenmenge', 1e12, 'tb');
einheit('Datenmenge', 1024, 'kib');
einheit('Datenmenge', 1024 ** 2, 'mib');
einheit('Datenmenge', 1024 ** 3, 'gib');
einheit('Datenmenge', 1024 ** 4, 'tib');
einheit('Leistung', 1, 'w', 'watt');
einheit('Leistung', 1000, 'kw');
einheit('Leistung', 735.49875, 'ps');
einheit('Leistung', 745.69987158227, 'hp');

const TEMPERATUR: Record<string, 'C' | 'F' | 'K'> = { c: 'C', '°c': 'C', celsius: 'C', grad: 'C', f: 'F', '°f': 'F', fahrenheit: 'F', k: 'K', kelvin: 'K' };

function zuKelvin(w: number, e: 'C' | 'F' | 'K') {
  return e === 'K' ? w : e === 'C' ? w + 273.15 : ((w - 32) * 5) / 9 + 273.15;
}
function vonKelvin(k: number, e: 'C' | 'F' | 'K') {
  return e === 'K' ? k : e === 'C' ? k - 273.15 : ((k - 273.15) * 9) / 5 + 32;
}

const WAEHRUNGS_ZEICHEN: Record<string, string> = { '€': 'EUR', euro: 'EUR', $: 'USD', dollar: 'USD', '£': 'GBP', fr: 'CHF', franken: 'CHF', sfr: 'CHF', '¥': 'JPY', yen: 'JPY' };
/** Währungen mit EZB-Referenzkurs (Stand 2026) – nur diese Codes gelten als Währung, sonst wäre „kWh“ oder „bar“ eine */
export const EZB_WAEHRUNGEN = new Set(
  'EUR USD JPY CZK DKK GBP HUF PLN RON SEK CHF ISK NOK TRY AUD BRL CAD CNY HKD IDR ILS INR KRW MXN MYR NZD PHP SGD THB ZAR BGN'.split(' '),
);

export function waehrungsCode(t: string): string | null {
  const s = t.trim();
  const z = WAEHRUNGS_ZEICHEN[s.toLowerCase()];
  if (z) return z;
  return EZB_WAEHRUNGEN.has(s.toUpperCase()) ? s.toUpperCase() : null;
}

/** Zahl schön (deutsch): bis 6 signifikante Stellen, Komma als Dezimalzeichen */
/** Geldbetrag: kaufmännisch auf 2 Stellen gerundet; Kleinstbeträge (< 0,01) mit 3 gültigen Ziffern statt „0,00“ */
export function betragText(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n !== 0 && Math.abs(n) < 0.01) return zahlText(n, 3);
  const r = Math.round(n * 100) / 100;
  return r.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: Math.abs(r) >= 10000 });
}

export function zahlText(n: number, stellen = 6) {
  if (!Number.isFinite(n)) return String(n);
  const g = Number(n.toPrecision(stellen));
  return g.toLocaleString('de-AT', { maximumFractionDigits: 12, useGrouping: Math.abs(g) >= 10000 });
}

/** Einheiten umrechnen (ohne Währungen). Wirft mit verständlichem Grund. */
export function einheitenUmrechnen(wert: number, von: string, nach: string): { ergebnis: number; text: string } {
  const v = von.trim().toLowerCase();
  const n = nach.trim().toLowerCase();
  if (TEMPERATUR[v] && TEMPERATUR[n]) {
    const ergebnis = vonKelvin(zuKelvin(wert, TEMPERATUR[v]!), TEMPERATUR[n]!);
    return { ergebnis, text: `${zahlText(wert)} ${von} = ${zahlText(ergebnis)} ${nach}` };
  }
  const a = EINHEITEN[v];
  const b = EINHEITEN[n];
  if (!a) throw new DorfFehler(400, `Einheit „${von}“ kenne ich nicht.`);
  if (!b) throw new DorfFehler(400, `Einheit „${nach}“ kenne ich nicht.`);
  if (a[0] !== b[0]) throw new DorfFehler(400, `${von} (${a[0]}) lässt sich nicht in ${nach} (${b[0]}) umrechnen.`);
  const ergebnis = (wert * a[1]) / b[1];
  const hinweis = v === 'pfund' || n === 'pfund' ? ' (Pfund = 500 g; für das englische Pfund „lb“ nehmen)' : '';
  return { ergebnis, text: `${zahlText(wert)} ${von} = ${zahlText(ergebnis)} ${nach}${hinweis}` };
}

/** EZB-Referenzkurse (Einheiten je Euro) aus eurofxref-daily.xml */
export function ezbKurseParsen(xml: string): { datum: string; kurse: Record<string, number> } {
  const datum = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  const kurse: Record<string, number> = { EUR: 1 };
  for (const m of xml.matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]\s*\/>/g)) {
    const k = Number(m[2]);
    if (Number.isFinite(k) && k > 0) kurse[m[1]!] = k;
  }
  if (!datum || Object.keys(kurse).length < 5) throw new DorfFehler(502, 'EZB: Kurstabelle nicht lesbar.');
  return { datum, kurse };
}

// ---- Literatur --------------------------------------------------------------------------------------------------

export interface Quelle {
  titel: string;
  autoren: string[];
  jahr?: number;
  doi?: string;
  arxiv?: string;
  isbn?: string;
  ort?: string;
  art?: string;
  zitiert?: number;
  link?: string;
  zusammenfassung?: string;
  herkunft: 'Crossref' | 'arXiv' | 'Open Library';
}

const UNERWUENSCHT = new Set(['peer-review', 'component', 'grant', 'dataset', 'journal-issue', 'journal-volume', 'journal']);

export function crossrefParsen(j: unknown): Quelle[] {
  const items = ((j as { message?: { items?: unknown[] } })?.message?.items ?? []) as {
    DOI?: string; title?: string[]; author?: { given?: string; family?: string; name?: string }[]; issued?: { 'date-parts'?: (number | null)[][] };
    'container-title'?: string[]; type?: string; 'is-referenced-by-count'?: number; publisher?: string; URL?: string;
  }[];
  return items
    .filter((i) => i.title?.[0] && !UNERWUENSCHT.has(i.type ?? ''))
    .map((i) => ({
      titel: i.title![0]!.replace(/\s+/g, ' ').trim(),
      autoren: (i.author ?? []).map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean),
      jahr: i.issued?.['date-parts']?.[0]?.[0] ?? undefined,
      doi: i.DOI,
      ort: i['container-title']?.filter(Boolean).slice(-1)[0] ?? i.publisher,
      art: i.type,
      zitiert: i['is-referenced-by-count'],
      link: i.URL,
      herkunft: 'Crossref' as const,
    }));
}

function xmlText(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function arxivParsen(xml: string): Quelle[] {
  const aus: Quelle[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1]!;
    const feld = (n: string) => {
      const r = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`).exec(e);
      return r ? xmlText(r[1]!) : '';
    };
    const id = feld('id');
    const titel = feld('title');
    if (!titel || !/arxiv\.org\/abs\//.test(id)) continue;
    const doi = /<arxiv:doi[^>]*>([^<]+)<\/arxiv:doi>/.exec(e)?.[1]?.trim();
    const zeitschrift = /<arxiv:journal_ref[^>]*>([^<]+)<\/arxiv:journal_ref>/.exec(e)?.[1];
    const summary = feld('summary');
    aus.push({
      titel,
      autoren: [...e.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((a) => xmlText(a[1]!)),
      jahr: Number(feld('published').slice(0, 4)) || undefined,
      arxiv: id.replace(/^https?:\/\/arxiv\.org\/abs\//, ''),
      doi,
      ort: zeitschrift ? xmlText(zeitschrift) : 'arXiv (Preprint)',
      link: id.replace(/^http:/, 'https:'),
      zusammenfassung: summary.length > 400 ? `${summary.slice(0, 400)}…` : summary,
      herkunft: 'arXiv',
    });
  }
  return aus;
}

export function openlibraryParsen(j: unknown): Quelle[] {
  const docs = ((j as { docs?: unknown[] })?.docs ?? []) as { key?: string; title?: string; author_name?: string[]; first_publish_year?: number; isbn?: string[]; publisher?: string[]; edition_count?: number }[];
  return docs
    .filter((d) => d.title)
    .map((d) => ({
      titel: d.title!,
      autoren: d.author_name ?? [],
      jahr: d.first_publish_year,
      isbn: d.isbn?.find((i) => i.length === 13) ?? d.isbn?.[0],
      ort: d.publisher?.slice(0, 2).join(', '),
      art: d.edition_count ? `Buch, ${d.edition_count} Ausgabe(n)` : 'Buch',
      link: d.key ? `https://openlibrary.org${d.key}` : undefined,
      herkunft: 'Open Library' as const,
    }));
}

export function quelleZeile(q: Quelle) {
  const autoren = q.autoren.length > 3 ? `${q.autoren.slice(0, 3).join(', ')} u. a.` : q.autoren.join(', ') || 'o. A.';
  const teile = [`„${q.titel}“ – ${autoren}${q.jahr ? ` (${q.jahr})` : ''}`];
  if (q.ort) teile.push(q.ort);
  if (q.doi) teile.push(`DOI ${q.doi}`);
  if (q.arxiv) teile.push(`arXiv ${q.arxiv}`);
  if (q.isbn) teile.push(`ISBN ${q.isbn}`);
  if (q.zitiert) teile.push(`zitiert ${q.zitiert}×`);
  let z = `- ${teile.join(' · ')} [${q.herkunft}]`;
  if (q.zusammenfassung) z += `\n  ${q.zusammenfassung}`;
  return z;
}

/** DOI aus Eingabe („10.…“, „doi:10.…“, „https://doi.org/10.…“) – null, wenn es keine ist */
export function doiNormalisieren(roh: string): string | null {
  const s = roh.trim().replace(/^doi:\s*/i, '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  return /^10\.\d{4,9}\/[^\s"<>{}]+$/.test(s) ? s : null;
}

/** BibTeX von doi.org: eigenen, stabilen Schlüssel setzen (Nachname + Jahr + erstes Titelwort) und lesbar umbrechen */
const BIB_FELDER = new Set(
  'author editor title booktitle journal year month volume number pages publisher address edition series chapter school institution organization type doi url isbn issn'.split(' '),
);

export function bibtexAufbereiten(bib: string): { eintrag: string; schluessel: string } {
  const b = bib.trim();
  const kopf = /^@(\w+)\s*\{\s*([^,]*),/.exec(b);
  if (!kopf) throw new DorfFehler(502, 'doi.org lieferte kein BibTeX.');
  const feld = (n: string) => new RegExp(`\\b${n}\\s*=\\s*[{"]([^}"]*)`, 'i').exec(b)?.[1]?.trim() ?? '';
  const ascii = (t: string) =>
    t
      .replace(/[äÄ]/g, 'ae')
      .replace(/[öÖ]/g, 'oe')
      .replace(/[üÜ]/g, 'ue')
      .replace(/ß/g, 'ss')
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9]/g, '');
  const nachname = ascii(feld('author').split(/\s+and\s+/i)[0]!.split(',')[0]!.trim().split(/\s+/).slice(-1)[0] ?? '') || 'quelle';
  const wort = ascii((feld('title').split(/\s+/).find((w) => w.replace(/\W/g, '').length > 3) ?? '').toLowerCase());
  const schluessel = `${nachname.toLowerCase()}${feld('year')}${wort}`.slice(0, 60) || `quelle${Date.now()}`;
  const rumpf = b.slice(kopf[0].length).replace(/\}\s*$/, '');
  // Felder auf eigene Zeilen: an Kommas zwischen „}“ und dem nächsten Feldnamen trennen
  // Nur bibliografische Felder, je höchstens 500 Zeichen (Review E199: kein abstract/keywords – frei vom DOI-Inhaber
  // gewählter Text gehört nicht dauerhaft in die Literaturliste)
  const felder = rumpf
    .split(/,\s*(?=[A-Za-z]+\s*=)/)
    .map((f) => f.trim())
    .filter((f) => BIB_FELDER.has((/^([A-Za-z]+)\s*=/.exec(f)?.[1] ?? '').toLowerCase()))
    .map((f) => (f.length > 500 ? `${f.slice(0, 497).replace(/[{}"]/g, '')}…}` : f));
  return { eintrag: `@${kopf[1]}{${schluessel},\n${felder.map((f) => `  ${f}`).join(',\n')}\n}`, schluessel };
}

// ---- Zugverbindungen (Transitous / MOTIS 2) ---------------------------------------------------------------------

/** „2026-11-22T15:00“ (Ortszeit Wien; Konstanz, Zürich, München sind dieselbe Zone) → ms */
export function ortszeitZuMs(text: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?$/.exec(text.trim());
  if (!m) throw new DorfFehler(400, 'Zeit bitte als „JJJJ-MM-TT HH:MM“ (Ortszeit).');
  const lokal = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 8), Number(m[5] ?? 0));
  let ms = lokal - versatzMinuten(lokal) * 60_000;
  ms = lokal - versatzMinuten(ms) * 60_000;
  return ms;
}

const uhr = new Intl.DateTimeFormat('de-AT', { timeZone: ZONE_WIEN, hour: '2-digit', minute: '2-digit' });
const tagKurz = new Intl.DateTimeFormat('de-AT', { timeZone: ZONE_WIEN, weekday: 'short', day: '2-digit', month: '2-digit' });

export function dauerText(sekunden: number) {
  const m = Math.round(sekunden / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

interface MotisOrt {
  name?: string;
  departure?: string;
  arrival?: string;
  scheduledDeparture?: string;
  scheduledArrival?: string;
  track?: string;
  cancelled?: boolean;
}
interface MotisLeg {
  mode?: string;
  from: MotisOrt;
  to: MotisOrt;
  duration?: number;
  startTime?: string;
  endTime?: string;
  realTime?: boolean;
  headsign?: string;
  displayName?: string;
  routeShortName?: string;
  tripShortName?: string;
  agencyName?: string;
  cancelled?: boolean;
}
interface MotisReise {
  startTime: string;
  endTime: string;
  duration: number;
  transfers: number;
  legs: MotisLeg[];
}

const VERKEHRSMITTEL: Record<string, string> = { BUS: 'Bus', TRAM: 'Straßenbahn', SUBWAY: 'U-Bahn', FERRY: 'Schiff', COACH: 'Fernbus', AIRPLANE: 'Flug' };

function verspaetung(ist?: string, plan?: string) {
  if (!ist || !plan) return '';
  const d = Math.round((Date.parse(ist) - Date.parse(plan)) / 60_000);
  return d >= 1 ? ` (+${d})` : '';
}

export function verbindungenText(j: unknown, max: number): string {
  const reisen = (((j as { itineraries?: MotisReise[] })?.itineraries ?? []) as MotisReise[]).slice(0, max);
  if (!reisen.length) return '(keine Verbindung gefunden – anderes Datum oder größere Bahnhöfe versuchen)';
  return reisen
    .map((r, i) => {
      const s = Date.parse(r.startTime);
      const e = Date.parse(r.endTime);
      const kopf = `${i + 1}) ${tagKurz.format(s)} ${uhr.format(s)} → ${tagKurz.format(e) === tagKurz.format(s) ? '' : `${tagKurz.format(e)} `}${uhr.format(e)} · ${dauerText(r.duration)} · ${r.transfers === 0 ? 'direkt' : `${r.transfers} Umstieg${r.transfers === 1 ? '' : 'e'}`}`;
      const zeilen = r.legs.map((l) => {
        if (l.mode === 'WALK') return `   (${dauerText(l.duration ?? 0)} Fußweg${l.to.name && l.to.name !== l.from.name ? ` zu ${l.to.name}` : ''})`;
        const ab = l.from.departure ?? l.startTime ?? '';
        const an = l.to.arrival ?? l.endTime ?? '';
        const zug = l.displayName || l.routeShortName || l.tripShortName || VERKEHRSMITTEL[l.mode ?? ''] || l.mode || '?';
        const richtung = l.headsign ? ` Ri. ${l.headsign}` : '';
        const gleis = l.from.track ? `, Gl. ${l.from.track}` : '';
        const aus = l.cancelled || l.from.cancelled ? ' – FÄLLT AUS' : '';
        return `   ${uhr.format(Date.parse(ab))}${verspaetung(l.from.departure, l.from.scheduledDeparture)} ${l.from.name}${gleis} → ${uhr.format(Date.parse(an))}${verspaetung(l.to.arrival, l.to.scheduledArrival)} ${l.to.name}: ${zug}${richtung}${l.agencyName ? ` (${l.agencyName})` : ''}${aus}`;
      });
      return [kopf, ...zeilen].join('\n');
    })
    .join('\n');
}

// ---- Wetter (Open-Meteo) ----------------------------------------------------------------------------------------

const WMO: Record<number, string> = {
  0: 'klar', 1: 'überwiegend klar', 2: 'teils bewölkt', 3: 'bedeckt', 45: 'Nebel', 48: 'Nebel mit Reif',
  51: 'leichter Niesel', 53: 'Niesel', 55: 'starker Niesel', 56: 'gefrierender Niesel', 57: 'starker gefrierender Niesel',
  61: 'leichter Regen', 63: 'Regen', 65: 'starker Regen', 66: 'gefrierender Regen', 67: 'starker gefrierender Regen',
  71: 'leichter Schneefall', 73: 'Schneefall', 75: 'starker Schneefall', 77: 'Schneegriesel',
  80: 'leichte Regenschauer', 81: 'Regenschauer', 82: 'heftige Regenschauer', 85: 'Schneeschauer', 86: 'starke Schneeschauer',
  95: 'Gewitter', 96: 'Gewitter mit Hagel', 99: 'schweres Gewitter mit Hagel',
};

export function wetterTage(j: unknown): string[] {
  const d = (j as { daily?: Record<string, (number | string | null)[]> })?.daily;
  if (!d?.time?.length) throw new DorfFehler(502, 'Open-Meteo: keine Vorhersage in der Antwort.');
  return d.time.map((tag, i) => {
    const wert = (n: string) => d[n]?.[i];
    const code = Number(wert('weather_code'));
    const teile = [`${tagText(String(tag))}: ${WMO[code] ?? `Wetter-Code ${code}`}`, `${Math.round(Number(wert('temperature_2m_min')))} bis ${Math.round(Number(wert('temperature_2m_max')))} °C`];
    const p = wert('precipitation_probability_max');
    if (p != null) teile.push(`Regenrisiko ${p} %`);
    const summe = wert('precipitation_sum');
    if (summe != null && Number(summe) > 0) teile.push(`${zahlText(Number(summe), 2)} mm`);
    const wind = wert('wind_speed_10m_max');
    if (wind != null) teile.push(`Wind bis ${Math.round(Number(wind))} km/h`);
    return `- ${teile.join(', ')}`;
  });
}
