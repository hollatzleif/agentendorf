import { describe, expect, it } from 'vitest';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';

const AUTH = 'https://live.logonvalidation.net';
const API = 'https://gateway.saxobank.com/openapi';

/** Nachgebauter Saxo-Server nach developer.saxo (Authorization Code Grant, Portfolio, Performance) */
function saxoAttrappe() {
  const anfragen: { methode: string; url: string; auth?: string; form?: Record<string, string> }[] = [];
  let n = 0;
  let refreshGueltig = 'r0';
  const stand = { tokenAblehnen: false };
  const holen = (async (eingabe: string | URL | Request, init: RequestInit = {}) => {
    const url = String(eingabe);
    const methode = init.method ?? 'GET';
    const kopf = new Headers(init.headers);
    const form = init.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : undefined;
    anfragen.push({ methode, url, auth: kopf.get('authorization') ?? undefined, form });
    const json = (status: number, x: unknown) => new Response(JSON.stringify(x), { status, headers: { 'Content-Type': 'application/json' } });
    if (url === `${AUTH}/token`) {
      if (kopf.get('authorization') !== `Basic ${Buffer.from('APPKEY:APPSECRET').toString('base64')}`) return json(401, {});
      if (stand.tokenAblehnen) return json(400, { error: 'invalid_grant' });
      if (form!.grant_type === 'authorization_code' && form!.code !== 'CODE1') return json(400, { error: 'invalid_grant' });
      if (form!.grant_type === 'refresh_token' && form!.refresh_token !== refreshGueltig) return json(400, { error: 'invalid_grant' });
      n++;
      refreshGueltig = `r${n}`;
      return json(200, { access_token: `a${n}`, expires_in: 1200, token_type: 'Bearer', refresh_token: `r${n}`, refresh_token_expires_in: 2400 });
    }
    if (!url.startsWith(API)) return json(404, {});
    if (!/^Bearer a\d+$/.test(kopf.get('authorization') ?? '')) return json(401, {});
    const pfad = new URL(url).pathname.replace('/openapi', '');
    if (pfad === '/port/v1/clients/me') return json(200, { ClientKey: 'CK==', DefaultCurrency: 'CHF', ClientId: '1' });
    if (pfad === '/port/v1/balances/me') return json(200, { TotalValue: 12500.5, CashBalance: 500.5, Currency: 'CHF' });
    if (pfad === '/port/v1/netpositions/me')
      return json(200, {
        Data: [
          {
            NetPositionId: 'NESN',
            NetPositionBase: { Amount: 50, AssetType: 'Stock', Uic: 1 },
            NetPositionView: { AverageOpenPrice: 90, CurrentPrice: 80, MarketValueInBaseCurrency: 4000, ProfitLossOnTradeInBaseCurrency: -500, InstrumentPriceDayPercentChange: -1.2, CurrentPriceDelayMinutes: 15 },
            DisplayAndFormat: { Description: 'Nestlé SA', Symbol: 'NESN:xswx', Currency: 'CHF' },
          },
          {
            NetPositionId: 'VWCE',
            NetPositionBase: { Amount: 60, AssetType: 'Etf' },
            NetPositionView: { AverageOpenPrice: 100, CurrentPrice: 125, MarketValue: 7500, ProfitLossOnTrade: 1500 },
            DisplayAndFormat: { Description: 'Vanguard FTSE All-World', Symbol: 'VWCE:xetr', Currency: 'EUR' },
          },
        ],
      });
    if (pfad === '/hist/v4/performance/timeseries')
      return json(200, {
        Balance: { AccountValue: [{ Date: '2025-12-31T00:00:00Z', Value: 11000 }, { Date: '2026-11-13T00:00:00Z', Value: 12400 }] },
        TimeWeighted: { Accumulated: [{ Date: '2025-12-31T00:00:00Z', Value: 0.1 }, { Date: '2026-11-13T00:00:00Z', Value: 0.21 }] },
      });
    return json(404, {});
  }) as typeof fetch;
  return { holen, anfragen, stand };
}

async function aufbau() {
  const s = saxoAttrappe();
  const d = await testDorf({ saxoHolen: s.holen, env: { SAXO_APP_KEY: 'APPKEY', SAXO_APP_SECRET: 'APPSECRET' } });
  return { d, s, h: await kopf(d) };
}

async function verbinden(x: Awaited<ReturnType<typeof aufbau>>) {
  const { url } = (await x.d.app.inject({ method: 'POST', url: '/api/boerse/saxo/anmelden', headers: x.h })).json() as { url: string };
  const state = new URL(url).searchParams.get('state')!;
  const r = await x.d.app.inject({ url: `/api/boerse/saxo/rueckruf?code=CODE1&state=${encodeURIComponent(state)}` });
  return { url, state, r };
}

describe('Saxo (E73): nur lesen', () => {
  it('Anmeldung nach Doku: /authorize mit client_id, state, redirect_uri; Rückleitung ohne Cookie tauscht den Code; Daten werden geholt', async () => {
    const x = await aufbau();
    expect((await x.d.app.inject({ url: '/api/boerse/saxo', headers: x.h })).json()).toMatchObject({ eingerichtet: true, verbunden: false });
    const { url, r } = await verbinden(x);
    const u = new URL(url);
    expect(`${u.origin}${u.pathname}`).toBe(`${AUTH}/authorize`);
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ response_type: 'code', client_id: 'APPKEY', redirect_uri: 'https://dorf.test/api/boerse/saxo/rueckruf' });
    expect(url).not.toContain('APPSECRET');
    // E219: eine Seite, die selbst weiterführt (Cookie SameSite=Strict kommt so mit) – zur Börse, auch in der Listenansicht
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('url=/gebaeude/Boerse?saxo=ok');
    // Token-Tausch: Basic-Auth, Formular nach Doku
    const tausch = x.s.anfragen.find((a) => a.url === `${AUTH}/token`)!;
    expect(tausch.form).toEqual({ grant_type: 'authorization_code', code: 'CODE1', redirect_uri: 'https://dorf.test/api/boerse/saxo/rueckruf' });

    const ue = (await x.d.app.inject({ url: '/api/boerse/saxo', headers: x.h })).json();
    expect(ue).toMatchObject({ verbunden: true, stand: { waehrung: 'CHF', gesamt: 12500.5, bar: 500.5 } });
    expect(ue.stand.positionen.map((p: { name: string; wert: number; gewinn: number }) => [p.name, p.wert, p.gewinn])).toEqual([
      ['Vanguard FTSE All-World', 7500, 1500],
      ['Nestlé SA', 4000, -500],
    ]);
    expect(ue.verlauf).toEqual([
      { datum: '2025-12-31', wert: 11000 },
      { datum: '2026-11-13', wert: 12400 },
    ]);
    // (1,21 / 1,10) − 1 = 10 %
    expect(ue.renditeJahr).toBeCloseTo(0.1, 6);
    expect(x.d.saxo.zeitungsZeilen()).toEqual(['Saxo-Depot: 12.500,50 CHF (+10,0 % seit Jahresbeginn)']);
    // Performance-Abfrage mit ClientKey und Feldgruppen
    const perf = new URL(x.s.anfragen.find((a) => a.url.includes('/hist/v4/performance/timeseries'))!.url);
    expect(Object.fromEntries(perf.searchParams)).toMatchObject({ ClientKey: 'CK==', FieldGroups: 'Balance_AccountValue,TimeWeighted_Accumulated', ToDate: '2026-11-16' });
    // Geheimnisse landen nicht in der Antwort an die App
    expect(JSON.stringify(ue)).not.toMatch(/a\d|r\d|APPSECRET/);
  });

  it('die Leine: nur GET und nur Depot-Pfade – Orders und alles andere sind gesperrt', async () => {
    const x = await aufbau();
    await verbinden(x);
    for (const pfad of ['/trade/v2/orders', '/port/v1/orders/me', '/atr/v1/cashmanagement/wiretransfers', '/port/v1/balances/me/../../../trade/v2/orders', '/port/v1/clients/me?x=1'])
      await expect(x.d.saxo.lesen(pfad)).rejects.toThrow(/gesperrt/);
    // jede Anfrage an die API war ein GET
    expect(x.s.anfragen.filter((a) => a.url.startsWith(API)).every((a) => a.methode === 'GET')).toBe(true);
  });

  it('state ist einmalig und läuft ab; falscher state → keine Verbindung', async () => {
    const x = await aufbau();
    const r = await x.d.app.inject({ url: '/api/boerse/saxo/rueckruf?code=CODE1&state=geraten' });
    expect(r.body).toContain('saxo=fehler');
    expect(x.d.saxo.uebersicht()).toMatchObject({ verbunden: false, fehler: expect.stringMatching(/abgelaufen oder ungültig/) });
    // Ablauf nach 15 min
    const { url } = (await x.d.app.inject({ method: 'POST', url: '/api/boerse/saxo/anmelden', headers: x.h })).json() as { url: string };
    x.d.uhr.vor(16 * 60_000);
    const r2 = await x.d.app.inject({ url: `/api/boerse/saxo/rueckruf?code=CODE1&state=${new URL(url).searchParams.get('state')}` });
    expect(r2.body).toContain('saxo=fehler');
    // derselbe state kein zweites Mal
    const v = await verbinden(x);
    expect(v.r.body).toContain('saxo=ok');
    const r3 = await x.d.app.inject({ url: `/api/boerse/saxo/rueckruf?code=CODE1&state=${encodeURIComponent(v.state)}` });
    expect(r3.body).toContain('saxo=fehler');
  });

  it('Refresh-Token wird vor Ablauf erneuert und immer der neueste verwendet; abgelehnt → Sitzung weg, eine Meldung', async () => {
    const x = await aufbau();
    const meldungen: string[] = [];
    x.d.saxo.beiMeldung.push((t) => meldungen.push(t));
    await verbinden(x);
    // nach 10 min: noch nichts zu tun
    x.d.uhr.vor(10 * 60_000);
    await x.d.saxo.erneuern();
    expect(x.s.anfragen.filter((a) => a.form?.grant_type === 'refresh_token')).toHaveLength(0);
    // 16 min: Access-Token läuft in < 5 min ab → erneuern mit r1, danach mit r2 usw.
    for (let i = 0; i < 4; i++) {
      x.d.uhr.vor(16 * 60_000);
      await x.d.saxo.erneuern();
    }
    expect(x.s.anfragen.filter((a) => a.form?.grant_type === 'refresh_token').map((a) => a.form!.refresh_token)).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(x.d.saxo.uebersicht().verbunden).toBe(true);
    // Saxo beendet die Sitzung
    x.s.stand.tokenAblehnen = true;
    x.d.uhr.vor(16 * 60_000);
    await x.d.saxo.erneuern();
    expect(x.d.saxo.uebersicht()).toMatchObject({ verbunden: false, fehler: expect.stringMatching(/beendet/) });
    expect(meldungen).toHaveLength(1);
    await x.d.saxo.erneuern();
    expect(meldungen).toHaveLength(1);
  });

  it('Server zu lange weg (Refresh-Token abgelaufen) → Sitzung weg; ohne Schlüssel: nicht eingerichtet', async () => {
    const x = await aufbau();
    await verbinden(x);
    x.d.uhr.vor(41 * 60_000);
    await x.d.saxo.erneuern();
    expect(x.d.saxo.uebersicht()).toMatchObject({ verbunden: false, fehler: expect.stringMatching(/abgelaufen/) });
    const ohne = await testDorf();
    const h = await kopf(ohne);
    expect((await ohne.app.inject({ url: '/api/boerse/saxo', headers: h })).json()).toMatchObject({ eingerichtet: false, verbunden: false });
    expect((await ohne.app.inject({ method: 'POST', url: '/api/boerse/saxo/anmelden', headers: h })).statusCode).toBe(409);
  });

  it('E219: zweimal geklickt → beide Anmeldungen gelten; Saxos Grund ist in der App zu sehen; Redirect URL zum Vergleichen', async () => {
    const x = await aufbau();
    const neu = async () => new URL(((await x.d.app.inject({ method: 'POST', url: '/api/boerse/saxo/anmelden', headers: x.h })).json() as { url: string }).url).searchParams.get('state')!;
    const erste = await neu();
    await neu(); // zweiter Klick (z. B. am Handy)
    const r = await x.d.app.inject({ url: `/api/boerse/saxo/rueckruf?code=CODE1&state=${encodeURIComponent(erste)}` });
    expect(r.body).toContain('saxo=ok');
    expect(x.d.saxo.uebersicht()).toMatchObject({ verbunden: true, rueckleitung: 'https://dorf.test/api/boerse/saxo/rueckruf', anmeldeServer: 'live.logonvalidation.net' });

    // Saxo lehnt den Code ab → Saxos Begründung steht im Fehler (nicht nur „abgelehnt“)
    x.d.saxo.abmelden();
    const s2 = await neu();
    await x.d.app.inject({ url: `/api/boerse/saxo/rueckruf?code=FALSCH&state=${encodeURIComponent(s2)}` });
    expect(x.d.saxo.uebersicht().fehler).toMatch(/400: invalid_grant/);

    // Saxo leitet mit ?error= zurück (z. B. Zugriff verweigert) → steht in der App
    const r3 = await x.d.app.inject({ url: '/api/boerse/saxo/rueckruf?error=access_denied&error_description=Der%20Nutzer%20hat%20abgebrochen' });
    expect(r3.body).toContain('saxo=fehler');
    expect(x.d.saxo.uebersicht().fehler).toMatch(/access_denied.*abgebrochen/);
    // Kaputtes oder Unsinniges in der Rückleitung bricht nichts
    const r4 = await x.d.app.inject({ url: `/api/boerse/saxo/rueckruf?error=${'x'.repeat(500)}` });
    expect(r4.statusCode).toBe(200);
  });
});
