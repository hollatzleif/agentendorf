import crypto from 'node:crypto';
import { z } from 'zod';
import type { SaxoUebersicht, SaxoPosition } from '@dorf/shared';
import type { DB } from './db.js';
import type { Uhr } from './uhr.js';
import type { LiveHub } from './live.js';
import { DorfFehler } from './fehler.js';

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
/** Depotstand so oft holen */
export const STAND_ALLE_MS = 30 * 60_000;

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
    this.merken('saxo_anmeldung', { state, bis: this.o.uhr.jetzt() + ANMELDUNG_GUELTIG_MS });
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
    const a = this.stand<{ state: string; bis: number }>('saxo_anmeldung');
    this.merken('saxo_anmeldung', undefined);
    const gleich = !!a && a.state.length === state.length && crypto.timingSafeEqual(Buffer.from(a.state), Buffer.from(state));
    if (!a || !gleich || a.bis < this.o.uhr.jetzt()) throw new DorfFehler(400, 'Diese Anmeldung ist abgelaufen oder ungültig – bitte in der App noch einmal „Mit Saxo verbinden“.');
    await this.tokenHolen({ grant_type: 'authorization_code', code, redirect_uri: k.rueckleitung });
    this.merken('saxo_fehler', undefined);
    this.o.hub.senden({ typ: 'boerse.geaendert' });
    await this.aktualisieren(true).catch((e) => this.o.log?.(`Saxo: ${(e as Error).message}`));
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
      const e = new DorfFehler(r.status >= 500 ? 502 : 401, `Saxo-Anmeldung abgelehnt (${r.status}).`);
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
      this.merken('saxo_stand', {
        zeit: jetzt,
        waehrung: saldo.Currency ?? kunde.DefaultCurrency ?? 'EUR',
        gesamt: saldo.TotalValue,
        bar: saldo.CashBalance,
        positionen,
      });
      // Performance: einmal am Tag (oder sofort nach dem Verbinden)
      const perf = this.stand<{ tag: string }>('saxo_verlauf');
      const heute = new Date(jetzt).toISOString().slice(0, 10);
      if (sofort || perf?.tag !== heute) {
        const von = new Date(jetzt - 365 * 86_400_000).toISOString().slice(0, 10);
        const t = z
          .object({ Balance: z.object({ AccountValue: Reihe }).passthrough().optional().catch(undefined), TimeWeighted: z.object({ Accumulated: Reihe }).passthrough().optional().catch(undefined) })
          .passthrough()
          .parse(await this.lesen('/hist/v4/performance/timeseries', { ClientKey: kunde.ClientKey, FromDate: von, ToDate: heute, FieldGroups: 'Balance_AccountValue,TimeWeighted_Accumulated' }));
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
    const zwoelf = r(letzte) != null && r(verlauf[0]) != null ? (1 + r(letzte)!) / (1 + r(verlauf[0])!) - 1 : null;
    return {
      eingerichtet: this.eingerichtet,
      verbunden: !!s,
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

  /** Morgenzeitung: Saxo-Depotwert und Rendite seit Jahresbeginn */
  zeitungsZeilen(): string[] {
    const u = this.uebersicht();
    if (!u.verbunden || !u.stand || u.stand.gesamt == null) return [];
    const geld = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: u.stand!.waehrung }).replace(/[  ]/g, ' ');
    const pr = (n: number) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1).replace('.', ',')} %`;
    return [`Saxo-Depot: ${geld(u.stand.gesamt)}${u.renditeJahr != null ? ` (${pr(u.renditeJahr)} seit Jahresbeginn)` : ''}`];
  }
}
