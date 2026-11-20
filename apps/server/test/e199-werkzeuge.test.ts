import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WerkzeugKiste, WERKZEUG_DEFINITIONEN, type LaufKontext } from '../src/agenten/werkzeuge.js';
import { BUERGERMEISTER_WERKZEUGE, werkzeugprofil, type DorfWerkzeug } from '../src/agenten/leine.js';
import { EXTRA_ALLTAG, EXTRA_NETZ, EXTRA_RECHENRAUM, EXTRA_WERKZEUGE } from '../src/agenten/leine-extra.js';
import { netzBauen, VERBINDUNGEN_JE_TAG, type ExtraNetz } from '../src/agenten/werkzeuge-extra.js';
import {
  bibtexAufbereiten,
  doiNormalisieren,
  einheitenUmrechnen,
  feiertage,
  ortszeitZuMs,
  ostersonntag,
} from '../src/agenten/extra-quellen.js';
import { strictTauglich } from '../src/agenten/motor-api.js';
import type { GmailKlient, MailAnhang } from '../src/post/gmail.js';
import { anhaengeFinden } from '../src/post/gmail.js';
import { testDorf } from './hilfen.js';

/**
 * E199: neue Werkzeuge aus der Ideen-Liste. Kein echtes Netz: Antworten der freien Schnittstellen stammen aus echten
 * Abrufen vom 20.11.2026 (test/fixtures/e199/) und werden über eine Attrappe für fetch eingespielt.
 * TestUhr: Mo, 16.11.2026 12:00 UTC.
 */
const FIX = path.join(import.meta.dirname, 'fixtures', 'e199');
const fix = (n: string) => fs.readFileSync(path.join(FIX, n), 'utf8');

function netzAttrappe(antworten: Record<string, string | ((url: string, init?: RequestInit) => Response | string)>) {
  const aufrufe: { url: string; init?: RequestInit }[] = [];
  const netz: ExtraNetz = netzBauen({ version: 'test', kontakt: 'https://dorf.test', wetterOrt: 'Konstanz' }, async (url, init) => {
    aufrufe.push({ url, init });
    const treffer = Object.entries(antworten).find(([muster]) => url.toLowerCase().includes(muster.toLowerCase()));
    if (!treffer) throw new Error(`kein Netz in Tests: ${url}`);
    const a = typeof treffer[1] === 'function' ? treffer[1](url, init) : treffer[1];
    return typeof a === 'string' ? new Response(a, { status: 200 }) : a;
  });
  return { netz, aufrufe };
}

async function kiste(erlaubt: DorfWerkzeug[], extra: Partial<LaufKontext> = {}, gebaeude = 'Rathaus') {
  const d = await testDorf();
  const k = new WerkzeugKiste(d.db, d.uhr, d.vault, d.suche, d.agenten.freigaben, {
    laufId: 'l1',
    chatId: 'c1',
    gebaeude,
    erlaubt,
    rueckgaengig: d.agenten.rueckgaengig,
    ...extra,
  });
  const log = () => d.db.prepare('SELECT werkzeug, erlaubt, pfad, art, ergebnis FROM werkzeug_log ORDER BY id').all() as { werkzeug: string; erlaubt: number; pfad: string | null; art: string | null; ergebnis: string }[];
  return { d, k, log };
}

describe('E199 – Leine der neuen Werkzeuge', () => {
  it('Netz-Werkzeuge nur mit Web, Alltag für alle, Rechenraum- und Post-Werkzeuge nur mit ihrer Fähigkeit', () => {
    const ohne = werkzeugprofil({ werkzeuge: ['vault_lesen'], fremdinhalte: false }).dorf;
    for (const w of EXTRA_NETZ) expect(ohne).not.toContain(w);
    for (const w of EXTRA_RECHENRAUM) expect(ohne).not.toContain(w);
    expect(ohne).not.toContain('post_anhang_lesen');
    for (const w of EXTRA_ALLTAG) expect(ohne).toContain(w);
    const mitWeb = werkzeugprofil({ werkzeuge: ['vault_lesen', 'web'], fremdinhalte: true }).dorf;
    for (const w of EXTRA_NETZ) expect(mitWeb).toContain(w);
    expect(werkzeugprofil({ werkzeuge: ['rechenraum'], fremdinhalte: false }).dorf).toEqual(expect.arrayContaining([...EXTRA_RECHENRAUM]));
    expect(werkzeugprofil({ werkzeuge: ['post'], fremdinhalte: false }).dorf).toContain('post_anhang_lesen');
    // der Bürgermeister hat Web immer – also auch Literatur, Zug, Wetter
    for (const w of EXTRA_NETZ) expect(BUERGERMEISTER_WERKZEUGE).toContain(w);
  });

  it('jede Definition ist schlank und strict-tauglich (außer pdf_bearbeiten mit freien Formularfeldern)', () => {
    for (const n of EXTRA_WERKZEUGE) {
      const d = WERKZEUG_DEFINITIONEN[n];
      expect(d.name).toBe(n);
      expect(d.description.length).toBeLessThan(700);
      expect(strictTauglich(d.input_schema)).toBe(n !== 'pdf_bearbeiten');
    }
  });

  it('ohne Erlaubnis: abgelehnt und protokolliert, kein Abruf', async () => {
    const { netz, aufrufe } = netzAttrappe({});
    const { k, log } = await kiste(['vault_lesen'], { netz });
    const r = await k.aufrufen('literatur_suchen', { anfrage: 'Bayes' });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/nicht erlaubt/);
    expect(aufrufe).toHaveLength(0);
    expect(log()).toEqual([expect.objectContaining({ werkzeug: 'literatur_suchen', erlaubt: 0 })]);
  });
});

describe('E199 – Feiertage und Umrechnen (lokal)', () => {
  it('Ostern und bewegliche Feiertage stimmen', () => {
    expect(ostersonntag(2026)).toBe('2026-04-05');
    expect(ostersonntag(2027)).toBe('2027-03-28');
    expect(ostersonntag(2000)).toBe('2000-04-23');
    const f = Object.fromEntries(feiertage(2026).map((x) => [x.name, x]));
    expect(f['Christi Himmelfahrt']!.datum).toBe('2026-05-14');
    expect(f['Pfingstmontag']!.datum).toBe('2026-05-25');
    expect(f['Fronleichnam']!.datum).toBe('2026-06-04');
    expect(f['Karfreitag']).toEqual({ datum: '2026-04-03', name: 'Karfreitag', regionen: ['DE-BW'] });
    expect(f['Nationalfeiertag']!.regionen).toEqual(['AT']);
  });

  it('Werkzeug feiertage: nur Österreich, mit „vorbei“ nach heute', async () => {
    const { k, log } = await kiste(['feiertage']);
    const r = await k.aufrufen('feiertage', { region: 'AT' });
    expect(r.ok).toBe(true);
    expect(r.text).toContain('Mo 26.10.2026: Nationalfeiertag – vorbei');
    expect(r.text).toContain('Di 08.12.2026: Mariä Empfängnis');
    expect(r.text).not.toContain('Tag der Deutschen Einheit');
    expect(r.text).not.toContain('Karfreitag');
    expect(log()[0]).toMatchObject({ werkzeug: 'feiertage', erlaubt: 1 });
  });

  it('Einheiten: Länge, Temperatur, Daten; Unsinniges mit Grund', () => {
    expect(einheitenUmrechnen(5, 'mi', 'km').ergebnis).toBeCloseTo(8.04672, 6);
    expect(einheitenUmrechnen(68, '°F', '°C').ergebnis).toBeCloseTo(20, 9);
    expect(einheitenUmrechnen(1, 'GiB', 'MB').ergebnis).toBeCloseTo(1073.741824, 6);
    expect(einheitenUmrechnen(1, 'kWh', 'kJ').text).toBe('1 kWh = 3600 kJ');
    expect(() => einheitenUmrechnen(1, 'kg', 'km')).toThrow(/lässt sich nicht/);
    expect(() => einheitenUmrechnen(1, 'parsec', 'km')).toThrow(/kenne ich nicht/);
  });

  it('Währungen zum EZB-Kurs: einmal geholt, dann aus dem Zwischenspeicher; „kWh“ ist keine Währung', async () => {
    const { netz, aufrufe } = netzAttrappe({ 'eurofxref-daily.xml': fix('ezb.xml') });
    const { k } = await kiste(['umrechnen'], { netz });
    const r = await k.aufrufen('umrechnen', { wert: 100, von: 'CHF', nach: '€' });
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/^100 CHF = 107,9\d EUR \(EZB-Referenzkurs vom Do 19\.11\.2026; 1 EUR = 0,9262 CHF\)/);
    expect((await k.aufrufen('umrechnen', { wert: 50, von: 'USD', nach: 'CHF' })).ok).toBe(true);
    expect(aufrufe).toHaveLength(1);
    expect(new Headers(aufrufe[0]!.init?.headers).get('user-agent')).toMatch(/^Agentendorf\/test .*\+https:\/\/dorf\.test/);
    const e = await k.aufrufen('umrechnen', { wert: 3, von: 'kWh', nach: 'MJ' });
    expect(e.ok).toBe(false);
    expect(e.text).toMatch(/MJ.*kenne ich nicht/);
  });
});

describe('E199 – Literatur und BibTeX', () => {
  it('literatur_suchen: Crossref, arXiv, Open Library in der Hülle; eine Quelle darf ausfallen', async () => {
    const { netz, aufrufe } = netzAttrappe({
      'api.crossref.org': fix('crossref.json'),
      'export.arxiv.org': fix('arxiv.xml'),
      'openlibrary.org': () => new Response('kaputt', { status: 503 }),
    });
    const { k, log } = await kiste([...EXTRA_NETZ], { netz });
    const r = await k.aufrufen('literatur_suchen', { anfrage: 'Bayesian networks tutorial', anzahl: 5 });
    expect(r.ok).toBe(true);
    expect(r.text.startsWith('<fremdinhalt quelle="literatur">')).toBe(true);
    expect(r.text).toContain('„A Tutorial on Learning with Bayesian Networks“ – David Heckerman · Innovations in Bayesian Networks · DOI 10.1007/978-3-540-85066-3_3 · zitiert 280× [Crossref]');
    expect(r.text).not.toContain('Review for'); // Gutachten (peer-review) sind keine Literatur
    expect(r.text).toContain('arXiv 1209.5350v3');
    expect(r.text).toContain('Open Library\n(nicht erreichbar: Open Library antwortet mit HTTP 503.)');
    expect(aufrufe.map((a) => new URL(a.url).hostname).sort()).toEqual(['api.crossref.org', 'export.arxiv.org', 'openlibrary.org']);
    expect(log().at(-1)).toMatchObject({ werkzeug: 'literatur_suchen', art: 'web', erlaubt: 1 });
    // Bücher allein
    const b = netzAttrappe({ 'openlibrary.org': fix('openlibrary.json') });
    const k2 = (await kiste(['literatur_suchen'], { netz: b.netz })).k;
    const r2 = await k2.aufrufen('literatur_suchen', { anfrage: 'Statistik Fahrmeir', quelle: 'buecher' });
    expect(r2.text).toContain('„Statistik“ – Ludwig Fahrmeir, Rita Künstler, Iris Pigeot u. a. (2006)');
    expect(r2.text).toContain('ISBN 9783540350378');
  });

  it('DOI erkennen und BibTeX aufbereiten (eigener Schlüssel, ein Feld je Zeile)', () => {
    expect(doiNormalisieren('https://doi.org/10.1038/nature14539')).toBe('10.1038/nature14539');
    expect(doiNormalisieren('doi: 10.1007/978-3-540-85066-3_3')).toBe('10.1007/978-3-540-85066-3_3');
    expect(doiNormalisieren('kein doi')).toBeNull();
    const b = bibtexAufbereiten(fix('bibtex-lecun.bib'));
    expect(b.schluessel).toBe('lecun2015deep');
    expect(b.eintrag.split('\n')[0]).toBe('@article{lecun2015deep,');
    expect(b.eintrag).toContain('\n  author={LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},\n');
    expect(b.eintrag).toContain('\n  month=May,\n');
    expect(bibtexAufbereiten(fix('bibtex-heckerman.bib')).schluessel).toBe('heckermantutorial');
    expect(() => bibtexAufbereiten('<html>')).toThrow(/kein BibTeX/);
  });

  it('doi_bibtex mit merken: Uni/literatur.bib anlegen, jede DOI einmal, Ergänzen mit Rückgängig', async () => {
    const { netz, aufrufe } = netzAttrappe({ '10.1038/nature14539': fix('bibtex-lecun.bib'), '10.1007/978-3-540-85066-3_3': fix('bibtex-heckerman.bib') });
    const { d, k, log } = await kiste(['doi_bibtex'], { netz });
    const r = await k.aufrufen('doi_bibtex', { doi: '10.1038/nature14539', merken: true });
    expect(r.ok).toBe(true);
    expect(r.text).toContain('\\cite{lecun2015deep}');
    expect(new Headers(aufrufe[0]!.init?.headers).get('accept')).toMatch(/application\/x-bibtex/);
    expect(aufrufe[0]!.url).toBe('https://doi.org/10.1038/nature14539');
    const bib = (await d.vault.lesen('Uni/literatur.bib')).inhalt;
    expect(bib).toContain('@article{lecun2015deep,');
    expect((await k.aufrufen('doi_bibtex', { doi: 'https://doi.org/10.1038/NATURE14539', merken: true })).text).toContain('steht schon in Uni/literatur.bib');
    expect(aufrufe).toHaveLength(1); // kein zweiter Abruf
    expect((await d.vault.lesen('Uni/literatur.bib')).inhalt).toBe(bib);
    await k.aufrufen('doi_bibtex', { doi: '10.1007/978-3-540-85066-3_3', merken: true });
    const neu = (await d.vault.lesen('Uni/literatur.bib')).inhalt;
    expect(neu.startsWith(bib.trimEnd())).toBe(true);
    expect(neu).toContain('@inbook{heckermantutorial,');
    const rg = d.db.prepare("SELECT art, titel FROM rueckgaengig ORDER BY erstellt").all() as { art: string; titel: string }[];
    expect(rg).toEqual([{ art: 'datei_geaendert', titel: 'Literatur ergänzt: heckermantutorial' }]);
    expect(log().filter((l) => l.pfad === 'Uni/literatur.bib' && l.art === 'geschrieben')).toHaveLength(2);
    const f = await k.aufrufen('doi_bibtex', { doi: 'Rübezahl' });
    expect(f.ok).toBe(false);
    expect(f.text).toMatch(/keine DOI/);
  });
});

describe('E199 – Zugverbindungen (Transitous) und Wetter (Open-Meteo)', () => {
  it('verbindung_suchen: Haltestellen suchen, Verbindungen lesbar, Ortszeit → UTC, Hülle', async () => {
    const { netz, aufrufe } = netzAttrappe({
      'geocode?text=Konstanz': fix('transitous-geocode-konstanz.json'),
      'geocode?text=Linz': fix('transitous-geocode-linz.json'),
      '/api/v5/plan': fix('transitous-plan.json'),
    });
    const { k, log } = await kiste(['verbindung_suchen'], { netz });
    const r = await k.aufrufen('verbindung_suchen', { von: 'Konstanz', nach: 'Linz Hbf', zeit: '2026-11-22 16:00', anzahl: 2 });
    expect(r.ok).toBe(true);
    const plan = new URL(aufrufe.find((a) => a.url.includes('/plan'))!.url);
    expect(plan.searchParams.get('fromPlace')).toBe('de-DELFI_de:08335:6554');
    expect(plan.searchParams.get('toPlace')).toBe('at-Railway-Current-Reference-Data-2026_Pat:44:41164');
    expect(plan.searchParams.get('time')).toBe('2026-11-22T15:00:00.000Z'); // 16:00 Wien = 15:00 UTC im Winter
    expect(plan.searchParams.get('arriveBy')).toBe('false');
    expect(r.text).toContain('<fremdinhalt quelle="transitous">');
    expect(r.text).toContain('Verbindungen Konstanz → Linz Hauptbahnhof');
    expect(r.text).toContain('1) So., 22.11. 17:09 → Mo., 23.11. 01:30 · 8 h 21 min · 3 Umstiege');
    expect(r.text).toContain('18:32 St. Gallen(CH) → 21:16 München Hbf: EC 197 Ri. St. Margrethen SG (SBB)');
    expect(r.text).toContain('2) ');
    expect(r.text).not.toContain('3) ');
    expect(r.text).toContain('nichts wird gebucht');
    expect(log().at(-1)).toMatchObject({ werkzeug: 'verbindung_suchen', art: 'web', erlaubt: 1 });
    // freundlich zu Transitous: eigene Obergrenze je Tag
    netz.planZaehler = { tag: '2026-11-16', anzahl: VERBINDUNGEN_JE_TAG };
    const z = await k.aufrufen('verbindung_suchen', { von: 'Konstanz', nach: 'Linz Hbf' });
    expect(z.ok).toBe(false);
    expect(z.text).toMatch(/morgen wieder/);
  });

  it('Ortszeit mit Sommerzeit; unbekannte Haltestelle mit Grund', async () => {
    expect(new Date(ortszeitZuMs('2026-07-01 08:30')).toISOString()).toBe('2026-07-01T06:30:00.000Z');
    expect(new Date(ortszeitZuMs('2026-03-29T03:30')).toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(() => ortszeitZuMs('morgen früh')).toThrow(/JJJJ-MM-TT/);
    const { netz } = netzAttrappe({ geocode: '[]' });
    const { k } = await kiste(['verbindung_suchen'], { netz });
    const r = await k.aufrufen('verbindung_suchen', { von: 'Atlantis', nach: 'Linz' });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/Atlantis/);
  });

  it('wetter_vorhersage: Ort suchen, Tage lesbar; ohne Ort Leifs Wohnort', async () => {
    const { netz, aufrufe } = netzAttrappe({ 'geocoding-api.open-meteo.com': fix('open-meteo-geocode.json'), 'api.open-meteo.com/v1/forecast': fix('open-meteo-forecast.json') });
    const { k } = await kiste(['wetter_vorhersage'], { netz });
    const r = await k.aufrufen('wetter_vorhersage', { ort: 'Linz', tage: 3 });
    expect(r.ok).toBe(true);
    expect(r.text).toContain('Wetter Linz (Oberösterreich, Österreich):');
    expect(r.text).toContain('- Fr 20.11.2026: leichte Regenschauer, 9 bis 11 °C, Regenrisiko 73 %, 4,7 mm, Wind bis 30 km/h');
    expect(r.text).toContain('- So 22.11.2026: bedeckt, 0 bis 7 °C, Regenrisiko 33 %, Wind bis 6 km/h');
    const f = new URL(aufrufe[1]!.url);
    expect(f.searchParams.get('latitude')).toBe('48.30639');
    expect(f.searchParams.get('forecast_days')).toBe('3');
    await k.aufrufen('wetter_vorhersage', {});
    expect(new URL(aufrufe[2]!.url).searchParams.get('name')).toBe('Konstanz');
  });
});

describe('E199 – Gmail-Anhänge lesen', () => {
  function gmail(anhaenge: MailAnhang[], inhalt: Record<string, Buffer>) {
    const geladen: string[] = [];
    const g = {
      profil: async () => ({ emailAddress: 'leif@example.com', historyId: '1' }),
      liste: async () => [],
      seit: async () => null,
      nachricht: async () => {
        throw new Error('nicht gebraucht');
      },
      entwurf: async () => ({ id: 'd1' }),
      anhaenge: async () => anhaenge,
      anhangLaden: async (_id: string, a: MailAnhang) => {
        geladen.push(a.name);
        return inhalt[a.name]!;
      },
    } satisfies GmailKlient;
    return { g, geladen };
  }

  it('Teile mit Dateinamen werden gefunden (auch verschachtelt, auch eingebettet)', () => {
    const l = anhaengeFinden({
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'text/plain', body: { data: 'SGFsbG8' } },
        { mimeType: 'application/pdf', filename: 'Rechnung.pdf', body: { attachmentId: 'A1', size: 1200 } },
        { mimeType: 'multipart/related', parts: [{ mimeType: 'image/png', filename: 'logo.png', body: { data: 'iVBO', size: 3 } }] },
      ],
    });
    expect(l).toEqual([
      { nr: 1, name: 'Rechnung.pdf', mime: 'application/pdf', groesse: 1200, anhangId: 'A1', daten: undefined },
      { nr: 2, name: 'logo.png', mime: 'image/png', groesse: 3, anhangId: undefined, daten: 'iVBO' },
    ]);
  });

  it('Liste, dann Anhang speichern (Post/anhaenge/…) und in der Hülle lesen; nur bekannte Mails', async () => {
    const csv = Buffer.from('Posten;Betrag\nMiete;450\n');
    const { g, geladen } = gmail(
      [
        { nr: 1, name: 'Abrechnung Okt.csv', mime: 'text/csv', groesse: csv.length, anhangId: 'x' },
        { nr: 2, name: 'riesig.zip', mime: 'application/zip', groesse: 90 * 1024 * 1024, anhangId: 'y' },
      ],
      { 'Abrechnung Okt.csv': csv },
    );
    const { d, k, log } = await kiste(['post_anhang_lesen', 'vault_lesen'], { post: g });
    d.db.prepare('INSERT INTO post_mails (id, thread_id, von, betreff, datum, kategorie, zusammenfassung, eingeordnet) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('m123', 't1', 'Hausverwaltung <hv@example.com>', 'Abrechnung', Date.UTC(2026, 10, 15, 9), 'rechnung', 'Abrechnung Oktober', 1);
    const l = await k.aufrufen('post_anhang_lesen', { mail_id: 'm123' });
    expect(l.ok).toBe(true);
    expect(l.text).toContain('<fremdinhalt quelle="gmail-anhaenge">');
    expect(l.text).toContain('1. Abrechnung Okt.csv (Text (csv)');
    expect(l.text).toContain('2. riesig.zip (ZIP-Archiv, 90,0 MB)');
    const r = await k.aufrufen('post_anhang_lesen', { mail_id: 'm123', nr: 1 });
    expect(r.ok).toBe(true);
    expect(r.text).toContain('Anhang 1 gespeichert: Post/anhaenge/2026-11-15_m123/Abrechnung Okt.csv');
    expect(r.text).toContain('<fremdinhalt quelle="Post/anhaenge/2026-11-15_m123/Abrechnung Okt.csv">\nPosten;Betrag');
    expect((await d.vault.puffer('Post/anhaenge/2026-11-15_m123/Abrechnung Okt.csv', { max: 1000 }))!.inhalt.equals(csv)).toBe(true);
    // gleicher Anhang nochmal: dieselbe Datei, keine zweite
    await k.aufrufen('post_anhang_lesen', { mail_id: 'm123', nr: 1 });
    expect(fs.readdirSync(path.join(d.vault.wurzel, 'Post/anhaenge/2026-11-15_m123'))).toEqual(['Abrechnung Okt.csv']);
    expect((await k.aufrufen('post_anhang_lesen', { mail_id: 'm123', nr: 2 })).text).toMatch(/zu groß/);
    expect(geladen).toEqual(['Abrechnung Okt.csv', 'Abrechnung Okt.csv']);
    expect((await k.aufrufen('post_anhang_lesen', { mail_id: 'fremd', nr: 1 })).text).toMatch(/kennt das Dorf nicht/);
    expect(log().some((x) => x.werkzeug === 'post_anhang_lesen' && x.art === 'geschrieben' && x.pfad === 'Post/anhaenge/2026-11-15_m123/Abrechnung Okt.csv')).toBe(true);
    expect(k.hatFremdesGelesen).toBe(true);
  });
});

describe('E199 – Rechenraum-Werkzeuge ohne Rechenraum', () => {
  it('ehrliche Meldung statt Absturz', async () => {
    const { k } = await kiste([...EXTRA_RECHENRAUM]);
    for (const [n, e] of [
      ['pdf_bearbeiten', { aktion: 'info', dateien: ['Uni/x.pdf'] }],
      ['qr_code', { inhalt: 'https://jku.at' }],
      ['karten_anki', { fach: 'Mathe' }],
    ] as const) {
      const r = await k.aufrufen(n, e);
      expect(r.ok).toBe(false);
      expect(r.text).toMatch(/Rechenraum ist auf diesem Server nicht eingerichtet/);
    }
  });
});
