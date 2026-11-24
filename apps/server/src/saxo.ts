import crypto from 'node:crypto';
import { z } from 'zod';
import type { BoerseAnalyse, SaxoUebersicht, SaxoPosition } from '@dorf/shared';
import type { DB } from './db.js';
import type { Uhr } from './uhr.js';
import type { LiveHub } from './live.js';
import { DorfFehler } from './fehler.js';
import { tagIn, tagPlus } from './zeit.js';

/**
 * Saxo (E73): Depotwert, Positionen und Performance aus Leifs Saxo-Konto – NUR LESEN.
 *
 * Nach der offiziellen Doku (developer.saxo, geprüft am 18.11.2026):
 * - Anmeldung: OAuth „Authorization Code Grant“ – /authorize und /token am AuthenticationUrl
 *   (live: https://live.logonvalidation.net), App-Schlüssel und -Secret als HTTP-Basic.
 * - Access-Token lebt ~20 min, Refresh-Token ~40 min (Werte stehen in expires_in / refresh_token_expires_in).
 *   Jedes Erneuern liefert einen NEUEN Refresh-Token, der alte wird ungültig → das Dorf erneuert laufend und
 *   speichert den neuesten in der DB (dorf_stand). Ist der Server zu lange weg oder beendet Saxo die Sitzung,
 *   muss Leif sich in der App neu verbinden – das Dorf meldet das einmal.
 * - Daten: GET /port/v1/clients/me, /port/v1/balances/me, /port/v1/netpositions/me, /hist/v4/performance/timeseries.
 *
 * DIE LEINE: Der Klient kennt nur GET und nur Pfade aus ERLAUBT. Orders, Überweisungen usw. sind im Code unmöglich.
 * Zusätzlich empfiehlt die Anleitung eine Live-App OHNE Handelsrecht („NOT enabled for trading“ = nur lesen).
 */
export const ERLAUBT = [/^\/port\/v1\/clients\/me$/, /^\/port\/v1\/balances\/me$/, /^\/port\/v1\/netpositions\/me$/, /^\/hist\/v4\/performance\/timeseries$/];
/** so lange vor Ablauf wird erneuert */
const ERNEUERN_VOR_MS = 5 * 60_000;
const ANMELDUNG_GUELTIG_MS = 15 * 60_000;
/** E219: so viele offene Anmeldungen gleichzeitig (zweimal geklickt, Handy und PC) – jede einmalig */
const MAX_OFFENE_ANMELDUNGEN = 5;

/** Saxos Fehlertext (error/error_description) lesbar und harmlos machen: eine Zeile, kurz, nur druckbare Zeichen */
function saxoText(roh: string) {
  let t = roh;
  try {
    const j = JSON.parse(roh) as { error?: unknown; error_description?: unknown; ErrorCode?: unknown; Message?: unknown };
    t = [j.error ?? j.ErrorCode, j.error_description ?? j.Message].filter((x) => typeof x === 'string' && x).join(' – ');
  } catch {
    /* kein JSON – Rohtext */
  }
  return t.replace(/[^\p{L}\p{N}\p{P}\p{Zs}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}
/** Depotstand so oft holen */
export const STAND_ALLE_MS = 30 * 60_000;
/** E222: so viele Tage Tagesstände (letzter Stand je Wiener Kalendertag) */
export const TAGE_BEHALTEN = 120;
/** E222: Bericht des Helfers „Depot-Tagesbericht“ (Boerse/aktionen/tagesbericht.md) – die Morgenzeitung nimmt daraus „Für die Zeitung“ */
export const TAGESBERICHT_PFAD = 'Boerse/00_Tagesbericht.md';

/** E222: letzter Depotstand eines Tages */
export interface SaxoTagesstand {
  tag: string;
  zeit: number;
  waehrung: string;
  gesamt: number | null;
  positionen: SaxoPosition[];
}
/** E222: was sich zwischen zwei Tagesständen bewegt hat */
export interface SaxoBewegung {
  tag: string;
  /** Vergleichstag (letzter Stand davor) – null: kein früherer Stand, Änderung aus Saxos Tagesänderung geschätzt */
  vorher: string | null;
  waehrung: string;
  gesamtVorher: number | null;
  gesamt: number | null;
  /** Änderung des Kontowerts (inkl. Ein-/Auszahlungen) */
  gesamtDelta: number | null;
  positionen: {
    name: string;
    symbol?: string;
    wert: number | null;
    /** Änderung des Werts in Kontowährung */
    delta: number | null;
    /** Kursänderung in % (aus Kursen; sonst Saxos Tagesänderung) */
    prozent: number | null;
    /** Stück vorher → nachher, wenn gekauft/verkauft */
    stueckVorher?: number;
    stueck?: number;
    neu?: boolean;
    weg?: boolean;
  }[];
}

export interface SaxoKonfig {
  appKey: string;
  appSecret: string;
  /** z. B. https://live.logonvalidation.net */
  authUrl: string;
  /** z. B. https://gateway.saxobank.com/openapi */
  apiUrl: string;
  /** Rückleitung nach der Anmeldung – muss genau so in der Saxo-App als Redirect URL stehen */
  rueckleitung: string;
}

interface Sitzung {
  access: string;
  accessBis: number;
  refresh: string;
  refreshBis: number;
  seit: number;
}

const TokenAntwort = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().positive(),
  refresh_token: z.string().min(1),
  refresh_token_expires_in: z.coerce.number().positive(),
});

const Zahl = z.coerce.number().optional().catch(undefined);
const Text = z.string().optional().catch(undefined);
const NetPosition = z
  .object({
    NetPositionId: Text,
    NetPositionBase: z.object({ Amount: Zahl, AssetType: Text, Uic: Zahl }).passthrough().optional().catch(undefined),
    NetPositionView: z
      .object({
        AverageOpenPrice: Zahl,
        CurrentPrice: Zahl,
        CurrentPriceDelayMinutes: Zahl,
        MarketValue: Zahl,
        MarketValueInBaseCurrency: Zahl,
        ExposureInBaseCurrency: Zahl,
        ProfitLossOnTrade: Zahl,
        ProfitLossOnTradeInBaseCurrency: Zahl,
        InstrumentPriceDayPercentChange: Zahl,
      })
      .passthrough()
      .optional()
      .catch(undefined),
    DisplayAndFormat: z.object({ Description: Text, Symbol: Text, Currency: Text }).passthrough().optional().catch(undefined),
  })
  .passthrough();
const Reihe = z.array(z.object({ Date: z.string(), Value: z.coerce.number() }).passthrough()).optional().catch(undefined);

export class Saxo {
  /** z. B. Telegram: Sitzung beendet → neu verbinden */
  readonly beiMeldung: ((text: string) => void)[] = [];
  private erneuernLaeuft: Promise<void> | null = null;

  constructor(private o: { db: DB; uhr: Uhr; hub: LiveHub; konfig?: SaxoKonfig; holen?: typeof fetch; log?: (t: string) => void }) {}

  get eingerichtet() {
    return !!this.o.konfig;
  }

  private holen(url: string, init: RequestInit = {}) {
    return (this.o.holen ?? fetch)(url, { ...init, signal: AbortSignal.timeout(20_000) });
  }
  private stand<T>(schluessel: string): T | undefined {
    const z2 = this.o.db.prepare('SELECT wert FROM dorf_stand WHERE schluessel = ?').get(schluessel) as { wert: string } | undefined;
    return z2 ? (JSON.parse(z2.wert) as T) : undefined;
  }
  private merken(schluessel: string, wert: unknown) {
    if (wert === undefined) this.o.db.prepare('DELETE FROM dorf_stand WHERE schluessel = ?').run(schluessel);
    else this.o.db.prepare('INSERT OR REPLACE INTO dorf_stand (schluessel, wert) VALUES (?, ?)').run(schluessel, JSON.stringify(wert));
  }
  private get sitzung() {
    return this.stand<Sitzung>('saxo_sitzung');
  }

  // ---- Anmeldung -------------------------------------------------------------------------------------

  /** Leif klickt „Mit Saxo verbinden“ → Adresse der Saxo-Anmeldung (state: einmalig, 15 min gültig) */
  anmeldenStart(): { url: string } {
    const k = this.konfig();
    const state = crypto.randomBytes(24).toString('base64url');
    const jetzt = this.o.uhr.jetzt();
    // E219: mehrere offene Anmeldungen (sonst verfällt die erste, wenn man zweimal klickt)
    const offen = (this.stand<{ state: string; bis: number }[]>('saxo_anmeldungen') ?? []).filter((a) => a.bis > jetzt);
    this.merken('saxo_anmeldungen', [...offen, { state, bis: jetzt + ANMELDUNG_GUELTIG_MS }].slice(-MAX_OFFENE_ANMELDUNGEN));
    const u = new URL(`${k.authUrl}/authorize`);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', k.appKey);
    u.searchParams.set('state', state);
    u.searchParams.set('redirect_uri', k.rueckleitung);
    return { url: u.toString() };
  }

  /**
   * Saxo leitet nach der Anmeldung hierher zurück (ohne Dorf-Cookie, weil SameSite=Strict bei der Rückleitung
   * von einer fremden Seite nicht mitkommt). Abgesichert über den einmaligen state, den nur Leifs angemeldete
   * Sitzung erzeugt haben kann.
   */
  async rueckruf(code: string, state: string) {
    try {
      await this.rueckrufInnen(code, state);
    } catch (e) {
      this.merken('saxo_fehler', { zeit: this.o.uhr.jetzt(), text: (e as Error).message });
      this.o.hub.senden({ typ: 'boerse.geaendert' });
      throw e;
    }
  }

  private async rueckrufInnen(code: string, state: string) {
    const k = this.konfig();
    const offen = this.stand<{ state: string; bis: number }[]>('saxo_anmeldungen') ?? [];
    const gleich = (x: string) => x.length === state.length && crypto.timingSafeEqual(Buffer.from(x), Buffer.from(state));
    const a = offen.find((x) => gleich(x.state));
    this.merken('saxo_anmeldungen', offen.filter((x) => x !== a)); // einmalig
    if (!a || a.bis < this.o.uhr.jetzt()) throw new DorfFehler(400, 'Diese Anmeldung ist abgelaufen oder ungültig – bitte in der App noch einmal „Mit Saxo verbinden“.');
    await this.tokenHolen({ grant_type: 'authorization_code', code, redirect_uri: k.rueckleitung });
    this.merken('saxo_fehler', undefined);
    this.o.hub.senden({ typ: 'boerse.geaendert' });
    await this.aktualisieren(true).catch((e) => this.o.log?.(`Saxo: ${(e as Error).message}`));
  }

  /** E219: Fehler der Rückleitung festhalten (z. B. ?error=access_denied von Saxo), damit die App den Grund zeigt */
  fehlerMerken(text: string) {
    this.merken('saxo_fehler', { zeit: this.o.uhr.jetzt(), text: saxoText(text) || text.slice(0, 200) });
    this.o.hub.senden({ typ: 'boerse.geaendert' });
  }

  /** Verbindung im Dorf trennen (die App-Freigabe selbst entfernt Leif in SaxoTrader → Konto → Sonstiges → Anwendungszugriff) */
  abmelden() {
    this.merken('saxo_sitzung', undefined);
    this.o.hub.senden({ typ: 'boerse.geaendert' });
  }

  private konfig() {
    if (!this.o.konfig) throw new DorfFehler(409, 'Saxo ist nicht eingerichtet. Auf dem Server: dorf saxo-einrichten');
    return this.o.konfig;
  }

  private async tokenHolen(form: Record<string, string>) {
    const k = this.konfig();
    const r = await this.holen(`${k.authUrl}/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${k.appKey}:${k.appSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
    if (!r.ok) {
      // E219: Saxos Begründung mitgeben (z. B. „invalid_grant – redirect_uri mismatch“) – sonst ist nicht zu sehen, was fehlt
      const grund = saxoText(await r.text().catch(() => ''));
      const e = new DorfFehler(r.status >= 500 ? 502 : 401, `Saxo-Anmeldung abgelehnt (${r.status}${grund ? `: ${grund}` : ''}).`);
      (e as DorfFehler & { endgueltig?: boolean }).endgueltig = r.status < 500;
      throw e;
    }
    const t = TokenAntwort.parse(await r.json());
    const jetzt = this.o.uhr.jetzt();
    const alt = this.sitzung;
    this.merken('saxo_sitzung', {
      access: t.access_token,
      accessBis: jetzt + t.expires_in * 1000,
      refresh: t.refresh_token,
      refreshBis: jetzt + t.refresh_token_expires_in * 1000,
      seit: form.grant_type === 'authorization_code' ? jetzt : (alt?.seit ?? jetzt),
    } satisfies Sitzung);
  }

  /** Jede Minute: kurz vor Ablauf erneuern. Abgelehnt → Sitzung weg, Leif bekommt EINE Meldung. */
  async erneuern(erzwingen = false): Promise<void> {
    if (this.erneuernLaeuft) return this.erneuernLaeuft;
    const s = this.sitzung;
    if (!s || !this.o.konfig) return;
    const jetzt = this.o.uhr.jetzt();
    if (s.refreshBis <= jetzt) return this.beenden('Die Saxo-Sitzung ist abgelaufen (das Dorf war zu lange nicht erreichbar).');
    if (!erzwingen && s.accessBis - jetzt > ERNEUERN_VOR_MS && s.refreshBis - jetzt > ERNEUERN_VOR_MS) return;
    this.erneuernLaeuft = (async () => {
      try {
        await this.tokenHolen({ grant_type: 'refresh_token', refresh_token: s.refresh, redirect_uri: this.o.konfig!.rueckleitung });
      } catch (e) {
        // nur eine endgültige Ablehnung beendet die Sitzung; Netz-/Serverfehler: beim nächsten Takt nochmal
        if ((e as { endgueltig?: boolean }).endgueltig) this.beenden('Saxo hat die Sitzung beendet (z. B. neue Bedingungen oder Zugriff entfernt).');
        else this.o.log?.(`Saxo: Erneuern fehlgeschlagen: ${(e as Error).message}`);
      } finally {
        this.erneuernLaeuft = null;
      }
    })();
    return this.erneuernLaeuft;
  }

  private beenden(grund: string) {
    this.merken('saxo_sitzung', undefined);
    this.merken('saxo_fehler', { zeit: this.o.uhr.jetzt(), text: grund });
    this.o.hub.senden({ typ: 'boerse.geaendert' });
    for (const fn of this.beiMeldung) fn(`📈 Saxo: ${grund} Bitte in der App unter Börse → „Mit Saxo verbinden“ neu anmelden.`);
  }

  // ---- Lesen (die Leine) -------------------------------------------------------------------------------

  /** Einziger Weg zu Saxo-Daten: nur GET, nur erlaubte Pfade */
  async lesen<T = unknown>(pfad: string, abfrage: Record<string, string> = {}): Promise<T> {
    if (!ERLAUBT.some((r) => r.test(pfad))) throw new DorfFehler(403, `Saxo: ${pfad} ist für das Dorf gesperrt (nur Depot lesen).`);
    const k = this.konfig();
    await this.erneuern();
    for (let versuch = 0; versuch < 2; versuch++) {
      const s = this.sitzung;
      if (!s) throw new DorfFehler(409, 'Nicht mit Saxo verbunden.');
      const u = new URL(`${k.apiUrl}${pfad}`);
      for (const [a, b] of Object.entries(abfrage)) u.searchParams.set(a, b);
      const r = await this.holen(u.toString(), { method: 'GET', headers: { Authorization: `Bearer ${s.access}`, Accept: 'application/json' } });
      if (r.status === 401 && versuch === 0) {
        await this.erneuern(true);
        continue;
      }
      if (r.status === 429) throw new DorfFehler(429, 'Saxo: zu viele Anfragen – später nochmal.');
      if (!r.ok) throw new DorfFehler(502, `Saxo antwortet mit ${r.status} auf ${pfad}.`);
      return (await r.json()) as T;
    }
    throw new DorfFehler(401, 'Saxo lehnt das Token ab.');
  }

  /** Depotstand holen (alle 30 min; Performance einmal am Tag – Saxo rechnet sie nachts) */
  async aktualisieren(sofort = false) {
    if (!this.o.konfig || !this.sitzung) return;
    const jetzt = this.o.uhr.jetzt();
    const alt = this.stand<{ zeit: number }>('saxo_stand');
    if (!sofort && alt && jetzt - alt.zeit < STAND_ALLE_MS - 60_000) return;
    try {
      const kunde = z.object({ ClientKey: z.string(), DefaultCurrency: z.string().optional() }).passthrough().parse(await this.lesen('/port/v1/clients/me'));
      const saldo = z
        .object({ TotalValue: Zahl, CashBalance: Zahl, Currency: Text, UnrealizedPositionsValue: Zahl, NonMarginPositionsValue: Zahl })
        .passthrough()
        .parse(await this.lesen('/port/v1/balances/me'));
      const pos = z
        .object({ Data: z.array(NetPosition).default([]) })
        .passthrough()
        .parse(await this.lesen('/port/v1/netpositions/me', { FieldGroups: 'NetPositionBase,NetPositionView,DisplayAndFormat', $top: '500' }));
      const positionen: SaxoPosition[] = pos.Data.map((p) => ({
        name: p.DisplayAndFormat?.Description ?? p.DisplayAndFormat?.Symbol ?? p.NetPositionId ?? '?',
        symbol: p.DisplayAndFormat?.Symbol,
        art: p.NetPositionBase?.AssetType,
        waehrung: p.DisplayAndFormat?.Currency,
        stueck: p.NetPositionBase?.Amount,
        einstand: p.NetPositionView?.AverageOpenPrice,
        kurs: p.NetPositionView?.CurrentPrice,
        verzoegerungMin: p.NetPositionView?.CurrentPriceDelayMinutes,
        wert: p.NetPositionView?.MarketValueInBaseCurrency ?? p.NetPositionView?.ExposureInBaseCurrency ?? p.NetPositionView?.MarketValue,
        gewinn: p.NetPositionView?.ProfitLossOnTradeInBaseCurrency ?? p.NetPositionView?.ProfitLossOnTrade,
        tagProzent: p.NetPositionView?.InstrumentPriceDayPercentChange,
      }));
      positionen.sort((a, b) => (b.wert ?? 0) - (a.wert ?? 0));
      const waehrung = saldo.Currency ?? kunde.DefaultCurrency ?? 'EUR';
      this.merken('saxo_stand', {
        zeit: jetzt,
        waehrung,
        gesamt: saldo.TotalValue,
        bar: saldo.CashBalance,
        positionen,
      });
      // E222: letzter Stand je Tag (Wien) – daraus liest das Dorf, was sich bewegt hat (gekauft, verkauft, Kurse)
      this.tagesstandMerken({ tag: tagIn(jetzt), zeit: jetzt, waehrung, gesamt: saldo.TotalValue ?? null, positionen });
      // Performance: einmal am Tag (oder sofort nach dem Verbinden)
      const perf = this.stand<{ tag: string }>('saxo_verlauf');
      const heute = new Date(jetzt).toISOString().slice(0, 10);
      if (sofort || perf?.tag !== heute) {
        // E223: so weit zurück wie möglich (10 Jahre); lehnt Saxo das ab, wie bisher ein Jahr
        const reihe = async (jahre: number) =>
          z
            .object({ Balance: z.object({ AccountValue: Reihe }).passthrough().optional().catch(undefined), TimeWeighted: z.object({ Accumulated: Reihe }).passthrough().optional().catch(undefined) })
            .passthrough()
            .parse(await this.lesen('/hist/v4/performance/timeseries', { ClientKey: kunde.ClientKey, FromDate: new Date(jetzt - jahre * 365 * 86_400_000).toISOString().slice(0, 10), ToDate: heute, FieldGroups: 'Balance_AccountValue,TimeWeighted_Accumulated' }));
        let t: Awaited<ReturnType<typeof reihe>>;
        try {
          t = await reihe(10);
        } catch (e) {
          this.o.log?.(`Saxo: Performance über 10 Jahre abgelehnt (${(e as Error).message}) – nehme ein Jahr.`);
          t = await reihe(1);
        }
        const rendite = new Map((t.TimeWeighted?.Accumulated ?? []).map((x) => [x.Date.slice(0, 10), x.Value]));
        const verlauf = (t.Balance?.AccountValue ?? []).map((x) => ({ datum: x.Date.slice(0, 10), wert: x.Value, rendite: rendite.get(x.Date.slice(0, 10)) ?? null }));
        this.merken('saxo_verlauf', { tag: heute, verlauf });
      }
      this.merken('saxo_fehler', undefined);
    } catch (e) {
      this.merken('saxo_fehler', { zeit: jetzt, text: (e as Error).message });
      throw e;
    } finally {
      this.o.hub.senden({ typ: 'boerse.geaendert' });
    }
  }

  uebersicht(): SaxoUebersicht {
    const s = this.sitzung;
    const stand = this.stand<{ zeit: number; waehrung: string; gesamt?: number; bar?: number; positionen: SaxoPosition[] }>('saxo_stand');
    const verlauf = this.stand<{ verlauf: { datum: string; wert: number; rendite: number | null }[] }>('saxo_verlauf')?.verlauf ?? [];
    const fehler = this.stand<{ zeit: number; text: string }>('saxo_fehler');
    const jahr = new Date(this.o.uhr.jetzt()).getUTCFullYear();
    // Rendite seit Jahresbeginn aus der zeitgewichteten Reihe: (1+r_jetzt)/(1+r_31.12.)−1
    const r = (x: { rendite: number | null } | undefined) => x?.rendite ?? null;
    const letzte = verlauf.at(-1);
    const vorJahr = [...verlauf].reverse().find((x) => x.datum < `${jahr}-01-01`);
    const seitJahresbeginn = r(letzte) != null && r(vorJahr) != null ? (1 + r(letzte)!) / (1 + r(vorJahr)!) - 1 : null;
    // E223: die Reihe kann jetzt Jahre lang sein – „12 Monate“ = gegen den letzten Wert vor einem Jahr
    const vorEinemJahr = new Date(this.o.uhr.jetzt() - 365 * 86_400_000).toISOString().slice(0, 10);
    const basis12 = [...verlauf].reverse().find((x) => x.datum <= vorEinemJahr) ?? verlauf[0];
    const zwoelf = r(letzte) != null && r(basis12) != null ? (1 + r(letzte)!) / (1 + r(basis12)!) - 1 : null;
    return {
      eingerichtet: this.eingerichtet,
      verbunden: !!s,
      // E219: zum Vergleichen mit der Saxo-App (Redirect URL muss genau so dort stehen; live oder Simulation)
      ...(this.o.konfig ? { rueckleitung: this.o.konfig.rueckleitung, anmeldeServer: new URL(this.o.konfig.authUrl).host } : {}),
      ...(s ? { verbundenSeit: new Date(s.seit).toISOString() } : {}),
      ...(stand
        ? {
            stand: {
              zeit: new Date(stand.zeit).toISOString(),
              waehrung: stand.waehrung,
              gesamt: stand.gesamt ?? null,
              bar: stand.bar ?? null,
              positionen: stand.positionen,
            },
          }
        : {}),
      verlauf: verlauf.map((x) => ({ datum: x.datum, wert: x.wert })),
      renditeJahr: seitJahresbeginn,
      rendite12Monate: zwoelf,
      ...(fehler ? { fehler: fehler.text } : {}),
    };
  }

  // ---- E222: Tagesstände und Bewegungen ----------------------------------------------------------------

  private tagesstandMerken(s: SaxoTagesstand) {
    const tage = (this.stand<SaxoTagesstand[]>('saxo_tage') ?? []).filter((x) => x.tag !== s.tag);
    tage.push(s);
    tage.sort((a, b) => a.tag.localeCompare(b.tag));
    this.merken('saxo_tage', tage.slice(-TAGE_BEHALTEN));
  }

  /** Gespeicherte Tagesstände (ältester zuerst) */
  tagesstaende(): SaxoTagesstand[] {
    return this.stand<SaxoTagesstand[]>('saxo_tage') ?? [];
  }

  /**
   * Was sich an `tag` bewegt hat: letzter Stand dieses Tages gegen den letzten Stand davor. Gibt es keinen früheren
   * Stand (erste Tage nach dem Verbinden), wird die Änderung je Position aus Saxos Tagesänderung (InstrumentPriceDay-
   * PercentChange) geschätzt und der Kontowert aus der Performance-Reihe genommen. null = für den Tag kein Stand.
   */
  bewegung(tag: string): SaxoBewegung | null {
    const tage = this.tagesstaende();
    const jetzt = tage.find((x) => x.tag === tag);
    if (!jetzt) return null;
    const vor = [...tage].reverse().find((x) => x.tag < tag) ?? null;
    const schluessel = (p: SaxoPosition) => p.symbol ?? p.name;
    const alt = new Map((vor?.positionen ?? []).map((p) => [schluessel(p), p]));
    const runden = (n: number) => Math.round(n * 100) / 100;
    const positionen: SaxoBewegung['positionen'] = jetzt.positionen.map((p) => {
      const a = alt.get(schluessel(p));
      alt.delete(schluessel(p));
      const wert = p.wert ?? null;
      let delta: number | null = null;
      let prozent: number | null = null;
      if (a) {
        if (a.kurs && p.kurs) prozent = (p.kurs / a.kurs - 1) * 100;
        if (wert != null && a.wert != null) delta = wert - a.wert;
      } else if (!vor && p.tagProzent != null && wert != null) {
        prozent = p.tagProzent;
        delta = wert - wert / (1 + p.tagProzent / 100);
      }
      const gekauft = a && a.stueck != null && p.stueck != null && a.stueck !== p.stueck;
      return {
        name: p.name,
        ...(p.symbol ? { symbol: p.symbol } : {}),
        wert,
        delta: delta == null ? null : runden(delta),
        prozent: prozent == null ? null : Math.round(prozent * 100) / 100,
        ...(gekauft ? { stueckVorher: a.stueck, stueck: p.stueck } : {}),
        ...(vor && !a ? { neu: true, ...(p.stueck != null ? { stueck: p.stueck } : {}) } : {}),
      };
    });
    for (const a of alt.values())
      positionen.push({ name: a.name, ...(a.symbol ? { symbol: a.symbol } : {}), wert: 0, delta: a.wert != null ? runden(-a.wert) : null, prozent: null, ...(a.stueck != null ? { stueckVorher: a.stueck, stueck: 0 } : {}), weg: true });
    positionen.sort((x, y) => Math.abs(y.delta ?? 0) - Math.abs(x.delta ?? 0));
    let gesamtVorher = vor?.gesamt ?? null;
    if (gesamtVorher == null) {
      // ohne früheren Stand: Kontowert des Vortags aus der Performance-Reihe (Saxo rechnet sie nachts)
      const reihe = this.stand<{ verlauf: { datum: string; wert: number }[] }>('saxo_verlauf')?.verlauf ?? [];
      gesamtVorher = [...reihe].reverse().find((x) => x.datum < tag)?.wert ?? null;
    }
    return {
      tag,
      vorher: vor?.tag ?? null,
      waehrung: jetzt.waehrung,
      gesamtVorher,
      gesamt: jetzt.gesamt,
      gesamtDelta: jetzt.gesamt != null && gesamtVorher != null ? runden(jetzt.gesamt - gesamtVorher) : null,
      positionen,
    };
  }

  /** E223: Daten für die Analyse in der App (Konto-Reihe, Tagesstände, jetzt) – null, wenn Saxo nicht eingerichtet */
  analyse(): BoerseAnalyse['saxo'] {
    if (!this.o.konfig) return null;
    const stand = this.stand<{ waehrung: string; gesamt?: number; bar?: number; positionen: SaxoPosition[] }>('saxo_stand');
    const verlauf = this.stand<{ verlauf: { datum: string; wert: number; rendite: number | null }[] }>('saxo_verlauf')?.verlauf ?? [];
    if (!stand && !verlauf.length) return null;
    return {
      verbunden: !!this.sitzung,
      waehrung: stand?.waehrung ?? 'EUR',
      verlauf,
      tage: this.tagesstaende().map((t) => ({ tag: t.tag, gesamt: t.gesamt, positionen: t.positionen })),
      positionen: stand?.positionen ?? [],
      bar: stand?.bar ?? null,
      gesamt: stand?.gesamt ?? null,
    };
  }

  /** Symbole der aktuellen Positionen (für Kursverläufe) */
  symbole(): string[] {
    return (this.stand<{ positionen: SaxoPosition[] }>('saxo_stand')?.positionen ?? []).map((p) => p.symbol).filter((s): s is string => !!s);
  }

  /** Bewegungen für jeden Tag mit Stand in [von, bis] (höchstens 31 Tage) */
  bewegungen(von: string, bis: string): SaxoBewegung[] {
    const tage = this.tagesstaende().filter((x) => x.tag >= von && x.tag <= bis).slice(-31);
    return tage.map((x) => this.bewegung(x.tag)!).filter(Boolean);
  }

  /** E222: Morgenzeitung, ganz unten – was gestern auf dem Saxo-Konto passiert ist (Zahlen vom Code) */
  gesternZeilen(jetzt = this.o.uhr.jetzt()): string[] {
    if (!this.sitzung && !this.tagesstaende().length) return [];
    const gestern = tagPlus(tagIn(jetzt), -1);
    const b = this.bewegung(gestern);
    if (!b) return [];
    // Wochenende: nur erwähnen, wenn sich wirklich etwas getan hat (gehandelt, Krypto, Ein-/Auszahlung)
    const wochentag = new Date(`${gestern}T12:00:00Z`).getUTCDay();
    const ruhig = !b.positionen.some((p) => p.neu || p.weg || p.stueckVorher != null || Math.abs(p.delta ?? 0) >= 1) && Math.abs(b.gesamtDelta ?? 0) < 1;
    if ((wochentag === 0 || wochentag === 6) && ruhig) return [];
    return bewegungZeilen(b, 3);
  }

  /** E225: Telegram /depot – Kontowert, Rendite, heute die größten Ausschläge, gestern */
  kurzbericht(): string[] {
    const u = this.uebersicht();
    if (!u.eingerichtet) return [];
    if (!u.stand) return [u.verbunden ? 'Saxo: noch kein Stand abgerufen.' : 'Saxo ist nicht verbunden (App → Börse → „Mit Saxo verbinden“).'];
    const st = u.stand;
    const pr = (n: number | null) => (n == null ? '–' : `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(1).replace('.', ',')} %`);
    const z = [`<b>Saxo</b> ${st.gesamt != null ? geldText(st.gesamt, st.waehrung) : '–'} · Jahr ${pr(u.renditeJahr)} · 12 Monate ${pr(u.rendite12Monate)}${u.verbunden ? '' : ' (getrennt)'}`];
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const heute = st.positionen.filter((p) => p.tagProzent != null).sort((a, b) => Math.abs(b.tagProzent!) - Math.abs(a.tagProzent!)).slice(0, 4);
    if (heute.length) z.push(`Zuletzt bewegt: ${heute.map((p) => `${esc(p.name)} ${p.tagProzent! >= 0 ? '+' : '−'}${Math.abs(p.tagProzent!).toFixed(1).replace('.', ',')} %`).join(' · ')}`);
    const g = this.gesternZeilen();
    if (g.length) z.push(`Gestern: ${g[0]}`);
    return z;
  }

  /** Morgenzeitung: Saxo-Depotwert und Rendite seit Jahresbeginn */
  zeitungsZeilen(): string[] {
    const u = this.uebersicht();
    if (!u.verbunden || !u.stand || u.stand.gesamt == null) return [];
    const geld = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: u.stand!.waehrung }).replace(/[  ]/g, ' ');
    const pr = (n: number) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1).replace('.', ',')} %`;
    return [`Saxo-Depot: ${geld(u.stand.gesamt)}${u.renditeJahr != null ? ` (${pr(u.renditeJahr)} seit Jahresbeginn)` : ''}`];
  }
}

/** E222: Geld/Prozent kurz und mit Vorzeichen, wie in der Zeitung */
export function geldText(n: number, waehrung: string, vorzeichen = false) {
  const t = Math.abs(n).toLocaleString('de-DE', { style: 'currency', currency: waehrung }).replace(/[\u00a0\u202f]/g, ' ');
  return vorzeichen ? `${n >= 0 ? '+' : '−'}${t}` : `${n < 0 ? '−' : ''}${t}`;
}
const prozentText = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1).replace('.', ',')} %`;

/** E222: Bewegung eines Tages in Zeilen – Kontowert, die größten Ausschläge, Käufe/Verkäufe */
export function bewegungZeilen(b: SaxoBewegung, max = 5): string[] {
  const z: string[] = [];
  if (b.gesamt != null)
    z.push(
      `Kontowert ${geldText(b.gesamt, b.waehrung)}${b.gesamtDelta != null && b.gesamtVorher ? ` (${geldText(b.gesamtDelta, b.waehrung, true)}, ${prozentText((b.gesamtDelta / b.gesamtVorher) * 100)})` : ''}${b.vorher ? '' : ' – erster gespeicherter Tag, Positionen aus Saxos Tagesänderung'}`,
    );
  const handel = b.positionen.filter((p) => p.neu || p.weg || p.stueckVorher != null);
  for (const p of handel)
    z.push(p.neu ? `Neu im Depot: ${p.name}${p.stueck != null ? ` (${p.stueck} Stück)` : ''}` : p.weg ? `Nicht mehr im Depot: ${p.name}` : `${p.name}: ${p.stueckVorher} → ${p.stueck} Stück`);
  const bewegt = b.positionen.filter((p) => !p.neu && !p.weg && p.delta != null && Math.abs(p.delta) >= 0.01).slice(0, max);
  for (const p of bewegt) z.push(`${p.name}: ${geldText(p.delta!, b.waehrung, true)}${p.prozent != null ? ` (${prozentText(p.prozent)})` : ''}`);
  if (!bewegt.length && !handel.length) z.push('Keine nennenswerte Bewegung bei den Positionen.');
  return z;
}
