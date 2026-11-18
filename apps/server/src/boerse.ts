import matter from 'gray-matter';
import { z } from 'zod';
import type { BoerseUebersicht, BoerseWert } from '@dorf/shared';
import type { DB } from './db.js';
import type { Uhr } from './uhr.js';
import type { VaultDienst } from './vault/dienst.js';
import type { LiveHub } from './live.js';
import { DorfFehler } from './fehler.js';

/**
 * Börse (Etappe 7): Depot und Watchlist stehen in Boerse/depot.md (Leif pflegt sie, App oder Obsidian).
 * Kurse: EODHD (Leifs Schlüssel, kostenlose Stufe = 20 Abrufe am Tag) – Tagesschlusskurse von Xetra und US-Börsen;
 * eine ISIN wird einmal per Suche in ein Kürzel übersetzt und gemerkt. Euro/Dollar: EZB-Referenzkurs (ohne Schlüssel).
 * Gehandelt wird nie – es gibt dafür keine Schnittstelle und kein Werkzeug.
 */
export const DEPOT_PFAD = 'Boerse/depot.md';
/** kostenlose Stufe: 20 Abrufe am Tag – einer bleibt Reserve */
export const ABRUFE_PRO_TAG = 19;

const Wert = z.object({
  name: z.string().trim().min(1).max(80),
  /** ISIN (wird einmal in ein Kürzel übersetzt) oder direkt das Kürzel wie „VWCE.XETRA“ / „AAPL.US“ */
  isin: z.string().trim().regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/, 'ISIN wie IE00BK5BQT80').optional(),
  symbol: z.string().trim().regex(/^[A-Z0-9.-]{1,20}\.[A-Z]{1,10}$/, 'Kürzel wie VWCE.XETRA oder AAPL.US').optional(),
  /** Börse für die ISIN-Suche: XETRA (Standard) oder US */
  boerse: z.enum(['XETRA', 'US', 'F']).default('XETRA'),
  stueck: z.coerce.number().min(0).optional(),
  /** Einstandskurs je Stück in Euro */
  einstand: z.coerce.number().min(0).optional(),
});
const Depot = z.object({
  positionen: z.array(Wert).default([]),
  watchlist: z.array(Wert).default([]),
});
type WertT = z.infer<typeof Wert>;

export interface BoerseKlient {
  /** Tagesschlusskurse der letzten Tage, neueste zuerst */
  eod(symbol: string): Promise<{ datum: string; kurs: number }[]>;
  /** ISIN → Kürzel (Code.Exchange) und Währung */
  suche(isin: string, boerse: string): Promise<{ symbol: string; waehrung: string; name?: string } | null>;
}

/** EODHD-Klient nach der offiziellen Doku (eod: date/close; search: Code/Exchange/Currency/ISIN) */
export function eodhdKlient(o: { url: string; schluessel: string; jetzt: () => number }): BoerseKlient {
  const holen = async (pfad: string, q: Record<string, string>) => {
    const u = new URL(`${o.url}${pfad}`);
    for (const [k, v] of Object.entries({ ...q, api_token: o.schluessel, fmt: 'json' })) u.searchParams.set(k, v);
    const r = await fetch(u, { signal: AbortSignal.timeout(20_000) });
    if (r.status === 401 || r.status === 403) throw new DorfFehler(502, 'EODHD lehnt den Schlüssel ab (dorf boerse-schluessel).');
    if (r.status === 402 || r.status === 429) throw new DorfFehler(429, 'EODHD: Tageslimit erreicht – morgen geht es weiter.');
    if (!r.ok) throw new DorfFehler(502, `EODHD antwortet mit ${r.status}.`);
    return r.json() as Promise<unknown>;
  };
  return {
    async eod(symbol) {
      const von = new Date(o.jetzt() - 10 * 86_400_000).toISOString().slice(0, 10);
      const roh = z.array(z.object({ date: z.string(), close: z.coerce.number() }).passthrough()).parse(await holen(`/eod/${encodeURIComponent(symbol)}`, { order: 'd', from: von }));
      return roh.map((x) => ({ datum: x.date.slice(0, 10), kurs: x.close })).sort((a, b) => b.datum.localeCompare(a.datum));
    },
    async suche(isin, boerse) {
      const roh = z
        .array(z.object({ Code: z.string(), Exchange: z.string(), Currency: z.string().optional(), ISIN: z.string().nullish(), Name: z.string().optional() }).passthrough())
        .parse(await holen(`/search/${encodeURIComponent(isin)}`, { exchange: boerse }));
      const t = roh.find((x) => x.Exchange === boerse && (!x.ISIN || x.ISIN === isin)) ?? roh.find((x) => x.Exchange === boerse);
      return t ? { symbol: `${t.Code}.${t.Exchange}`, waehrung: t.Currency ?? (boerse === 'US' ? 'USD' : 'EUR'), name: t.Name } : null;
    },
  };
}

/** EZB-Referenzkurs: Dollar je Euro (letzter Wert), ohne Schlüssel */
export async function ezbDollarJeEuro(url: string): Promise<{ datum: string; kurs: number }> {
  const r = await fetch(`${url}?lastNObservations=1&format=csvdata`, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`EZB antwortet mit ${r.status}`);
  const zeilen = (await r.text()).trim().split(/\r?\n/);
  const kopf = zeilen[0]!.split(',');
  const werte = zeilen[zeilen.length - 1]!.split(',');
  const kurs = Number(werte[kopf.indexOf('OBS_VALUE')]);
  const datum = werte[kopf.indexOf('TIME_PERIOD')] ?? '';
  if (!Number.isFinite(kurs) || kurs <= 0) throw new Error('EZB: kein Kurs in der Antwort');
  return { datum, kurs };
}

export class Boerse {
  constructor(
    private o: {
      db: DB;
      uhr: Uhr;
      vault: VaultDienst;
      hub: LiveHub;
      klient?: BoerseKlient;
      fx?: () => Promise<{ datum: string; kurs: number }>;
      log?: (t: string) => void;
    },
  ) {}

  get eingerichtet() {
    return !!this.o.klient;
  }

  async depot(): Promise<{ positionen: WertT[]; watchlist: WertT[]; fehler?: string }> {
    const d = await this.o.vault.lesen(DEPOT_PFAD).catch(() => null);
    if (!d) return { positionen: [], watchlist: [] };
    try {
      return Depot.parse(matter(d.inhalt).data);
    } catch (e) {
      const f = e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : String(e);
      return { positionen: [], watchlist: [], fehler: `Boerse/depot.md ist fehlerhaft: ${f}` };
    }
  }

  /** Eintrag hinzufügen/entfernen über die App (Frontmatter von depot.md, Text bleibt) */
  async wertAendern(art: 'positionen' | 'watchlist', aktion: { neu?: unknown; entfernen?: number }) {
    const d = await this.o.vault.lesen(DEPOT_PFAD).catch(() => null);
    const m = d ? matter(d.inhalt) : { data: {}, content: '\n# Depot und Watchlist\n\nPflegst du hier oder in der App (Börse → Depot).\n' };
    const kopf = Depot.parse(m.data);
    if (aktion.neu !== undefined) {
      const w = Wert.parse(aktion.neu);
      if (!w.isin && !w.symbol) throw new DorfFehler(400, 'ISIN oder Kürzel angeben.');
      kopf[art].push(w);
    }
    if (aktion.entfernen !== undefined) {
      if (!kopf[art][aktion.entfernen]) throw new DorfFehler(404, 'Diesen Eintrag gibt es nicht.');
      kopf[art].splice(aktion.entfernen, 1);
    }
    // nur gesetzte Felder schreiben (übersichtlich in Obsidian)
    const sauber = (x: WertT) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined));
    const daten = { ...(m.data as Record<string, unknown>), positionen: kopf.positionen.map(sauber), watchlist: kopf.watchlist.map(sauber) };
    const r = await this.o.vault.schreiben(DEPOT_PFAD, matter.stringify(m.content, daten), d ? { basisVersion: d.version } : { nurNeu: true });
    if (r.konflikt) throw new DorfFehler(409, 'depot.md wurde gerade woanders geändert – bitte neu laden.');
    this.o.hub.senden({ typ: 'boerse.geaendert' });
  }

  private abrufeHeute() {
    const tag = new Date(this.o.uhr.jetzt()).toISOString().slice(0, 10);
    return { tag, n: (this.o.db.prepare('SELECT anzahl FROM boerse_abrufe WHERE tag = ?').get(tag) as { anzahl: number } | undefined)?.anzahl ?? 0 };
  }
  private abrufZaehlen() {
    const { tag } = this.abrufeHeute();
    this.o.db.prepare('INSERT INTO boerse_abrufe (tag, anzahl) VALUES (?, 1) ON CONFLICT(tag) DO UPDATE SET anzahl = anzahl + 1').run(tag);
  }

  /** Kürzel eines Werts (ISIN → einmalige Suche, gemerkt) */
  private async kuerzel(w: WertT): Promise<{ symbol: string; waehrung: string } | null> {
    if (w.symbol) return { symbol: w.symbol, waehrung: w.symbol.endsWith('.US') ? 'USD' : 'EUR' };
    const z2 = this.o.db.prepare('SELECT symbol, waehrung FROM boerse_zuordnung WHERE isin = ? AND boerse = ?').get(w.isin, w.boerse) as { symbol: string; waehrung: string } | undefined;
    if (z2) return z2;
    if (!this.o.klient || this.abrufeHeute().n >= ABRUFE_PRO_TAG) return null;
    this.abrufZaehlen();
    const t = await this.o.klient.suche(w.isin!, w.boerse);
    if (!t) {
      this.o.db.prepare('INSERT OR REPLACE INTO boerse_zuordnung (isin, boerse, symbol, waehrung) VALUES (?, ?, ?, ?)').run(w.isin, w.boerse, '', '');
      return null;
    }
    this.o.db.prepare('INSERT OR REPLACE INTO boerse_zuordnung (isin, boerse, symbol, waehrung) VALUES (?, ?, ?, ?)').run(w.isin, w.boerse, t.symbol, t.waehrung);
    return t;
  }

  /**
   * Kurse holen: höchstens 19 Abrufe am Tag (kostenlose Stufe). Zuerst Werte ohne heutigen Kurs, die am längsten
   * nicht dran waren. Einmal am Tag reicht (Schlusskurse).
   */
  async aktualisieren(): Promise<{ abgerufen: number; offen: number; fehler?: string }> {
    if (!this.o.klient) return { abgerufen: 0, offen: 0, fehler: 'Kein Kurs-Anbieter eingerichtet (dorf boerse-schluessel).' };
    const d = await this.depot();
    const alle = [...d.positionen, ...d.watchlist];
    const heute = new Date(this.o.uhr.jetzt()).toISOString().slice(0, 10);
    let abgerufen = 0;
    let fehler: string | undefined;
    // Wechselkurs (EZB, zählt nicht gegen EODHD)
    if (this.o.fx && alle.some((w) => w.symbol?.endsWith('.US') || w.boerse === 'US')) {
      try {
        const fx = await this.o.fx();
        this.o.db.prepare('INSERT OR REPLACE INTO boerse_fx (datum, usd_je_eur, abgerufen) VALUES (?, ?, ?)').run(fx.datum, fx.kurs, this.o.uhr.jetzt());
      } catch (e) {
        this.o.log?.(`Börse: EZB-Kurs: ${(e as Error).message}`);
      }
    }
    const kandidaten: { w: WertT; symbol: string; waehrung: string; zuletzt: number }[] = [];
    for (const w of alle) {
      try {
        const k = await this.kuerzel(w);
        if (!k?.symbol) continue;
        const stand = this.o.db.prepare('SELECT abgerufen FROM boerse_kurse WHERE symbol = ?').get(k.symbol) as { abgerufen: number } | undefined;
        if (stand && new Date(stand.abgerufen).toISOString().slice(0, 10) === heute) continue;
        if (!kandidaten.some((x) => x.symbol === k.symbol)) kandidaten.push({ w, ...k, zuletzt: stand?.abgerufen ?? 0 });
      } catch (e) {
        fehler = (e as Error).message;
        break;
      }
    }
    kandidaten.sort((a, b) => a.zuletzt - b.zuletzt);
    let versucht = 0;
    for (const k of kandidaten) {
      if (this.abrufeHeute().n >= ABRUFE_PRO_TAG || fehler) break;
      versucht++;
      try {
        this.abrufZaehlen();
        const kurse = await this.o.klient.eod(k.symbol);
        if (!kurse.length) continue;
        this.o.db
          .prepare('INSERT OR REPLACE INTO boerse_kurse (symbol, kurs, vorher, datum, waehrung, abgerufen) VALUES (?, ?, ?, ?, ?, ?)')
          .run(k.symbol, kurse[0]!.kurs, kurse[1]?.kurs ?? null, kurse[0]!.datum, k.waehrung, this.o.uhr.jetzt());
        abgerufen++;
      } catch (e) {
        fehler = (e as Error).message;
      }
    }
    // noch nicht versucht (Tageslimit) – kommen morgen zuerst dran
    const offen = kandidaten.length - versucht;
    this.o.db.prepare("INSERT OR REPLACE INTO dorf_stand (schluessel, wert) VALUES ('boerse_letzter', ?)").run(JSON.stringify({ zeit: this.o.uhr.jetzt(), abgerufen, offen, fehler: fehler ?? null }));
    if (abgerufen || fehler) this.o.hub.senden({ typ: 'boerse.geaendert' });
    return { abgerufen, offen, ...(fehler ? { fehler } : {}) };
  }

  private fx() {
    return this.o.db.prepare('SELECT datum, usd_je_eur FROM boerse_fx ORDER BY datum DESC LIMIT 1').get() as { datum: string; usd_je_eur: number } | undefined;
  }

  private bewerten(w: WertT, index: number): BoerseWert {
    const symbol = w.symbol ?? (this.o.db.prepare('SELECT symbol FROM boerse_zuordnung WHERE isin = ? AND boerse = ?').get(w.isin, w.boerse) as { symbol: string } | undefined)?.symbol;
    const k = symbol
      ? (this.o.db.prepare('SELECT kurs, vorher, datum, waehrung FROM boerse_kurse WHERE symbol = ?').get(symbol) as { kurs: number; vorher: number | null; datum: string; waehrung: string } | undefined)
      : undefined;
    const fx = this.fx();
    const inEuro = (betrag: number, waehrung: string) => (waehrung === 'EUR' ? betrag : waehrung === 'USD' && fx ? betrag / fx.usd_je_eur : null);
    const kursEur = k ? inEuro(k.kurs, k.waehrung) : null;
    const r = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);
    const wert = kursEur != null && w.stueck != null ? kursEur * w.stueck : null;
    const einstand = w.einstand != null && w.stueck != null ? w.einstand * w.stueck : null;
    return {
      index,
      name: w.name,
      isin: w.isin,
      symbol: symbol || undefined,
      stueck: w.stueck,
      einstand: w.einstand,
      kurs: k ? k.kurs : undefined,
      waehrung: k?.waehrung,
      datum: k?.datum,
      veraenderungProzent: k?.vorher ? r(((k.kurs - k.vorher) / k.vorher) * 100) ?? undefined : undefined,
      wertEur: r(wert) ?? undefined,
      gewinnEur: wert != null && einstand != null ? r(wert - einstand) ?? undefined : undefined,
      gewinnProzent: wert != null && einstand ? r(((wert - einstand) / einstand) * 100) ?? undefined : undefined,
    };
  }

  async uebersicht(): Promise<BoerseUebersicht> {
    const d = await this.depot();
    const positionen = d.positionen.map((w, i) => this.bewerten(w, i));
    const watchlist = d.watchlist.map((w, i) => this.bewerten(w, i));
    const gesamt = positionen.reduce((s, p) => s + (p.wertEur ?? 0), 0);
    const einstand = d.positionen.reduce((s, p) => s + (p.einstand != null && p.stueck != null ? p.einstand * p.stueck : 0), 0);
    const letzter = this.o.db.prepare("SELECT wert FROM dorf_stand WHERE schluessel = 'boerse_letzter'").get() as { wert: string } | undefined;
    const fx = this.fx();
    return {
      eingerichtet: this.eingerichtet,
      positionen,
      watchlist,
      gesamtEur: Math.round(gesamt * 100) / 100,
      einstandEur: Math.round(einstand * 100) / 100,
      abrufeHeute: this.abrufeHeute().n,
      abrufeMax: ABRUFE_PRO_TAG,
      ...(letzter ? { letzter: JSON.parse(letzter.wert) as BoerseUebersicht['letzter'] } : {}),
      ...(fx ? { dollarJeEuro: { datum: fx.datum, kurs: fx.usd_je_eur } } : {}),
      ...(d.fehler ? { fehler: d.fehler } : {}),
    };
  }

  /** Morgenzeitung: Depotwert und Veränderung (nur wenn es Positionen mit Kurs gibt) */
  async zeitungsZeilen(): Promise<string[]> {
    const u = await this.uebersicht();
    const mitKurs = u.positionen.filter((p) => p.wertEur != null);
    if (!mitKurs.length) return [];
    const z2 = [`Depot: ${u.gesamtEur.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }).replace(/\u00a0/g, ' ')}${u.einstandEur ? ` (${u.gesamtEur >= u.einstandEur ? '+' : ''}${(((u.gesamtEur - u.einstandEur) / u.einstandEur) * 100).toFixed(1).replace('.', ',')} % seit Kauf)` : ''}`];
    const bewegt = mitKurs.filter((p) => p.veraenderungProzent != null && Math.abs(p.veraenderungProzent) >= 3);
    for (const p of bewegt) z2.push(`${p.name}: ${p.veraenderungProzent! > 0 ? '+' : ''}${p.veraenderungProzent!.toFixed(1).replace('.', ',')} % am letzten Handelstag`);
    return z2;
  }
}
