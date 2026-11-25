import { describe, expect, it } from 'vitest';
import { Hafen, KRYPTO_EUR_FEHLER_PAUSE_MS, KRYPTO_EUR_GUELTIG_MS } from '../src/krypto-dorf.js';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';

/** E237: Euro neben jedem SOL-Wert – das Dorf ergänzt Übersicht und Terminal um den EZB-Kurs (US-Dollar je Euro) */
const G = 'k'.repeat(40);
const BOT = '11111111-2222-4333-8444-555555555555';

function kryptowerk() {
  const pfade: string[] = [];
  const holen = (async (url: string) => {
    const u = new URL(url);
    pfade.push(u.pathname);
    if (u.pathname === '/uebersicht') return Response.json({ verbunden: true, notaus: false, datenOnline: true, beobachtet: 3, solUsd: 140, bots: [] });
    if (u.pathname.endsWith('/terminal')) return Response.json({ jetzt: 1, datenOnline: true, solUsd: 140, kerzen: [], trades: [] });
    return Response.json({ ok: true });
  }) as unknown as typeof fetch;
  return { holen, pfade };
}

describe('Euro-Werte im Hafen (E237)', () => {
  it('Übersicht und Terminal bekommen usdJeEur; 6 h zwischengespeichert; EZB-Fehler → alter Wert bzw. null, Antwort kommt trotzdem', async () => {
    const w = kryptowerk();
    let kurs: number | Error = 1.08;
    const abfragen: string[] = [];
    const d = await testDorf({
      env: { KRYPTO_GEHEIMNIS: G },
      hafenHolen: w.holen,
      boerseFx: async (waehrung) => {
        abfragen.push(waehrung);
        if (kurs instanceof Error) throw kurs;
        return { datum: '2026-11-16', kurs };
      },
    });
    const h = await kopf(d);
    const u = (await d.app.inject({ url: '/api/krypto', headers: h })).json();
    expect(u).toMatchObject({ verbunden: true, solUsd: 140, usdJeEur: 1.08 });
    expect(abfragen).toEqual(['USD']);
    const t = await d.app.inject({ url: `/api/krypto/bots/${BOT}/terminal?takt=5s`, headers: h });
    expect(t.statusCode).toBe(200);
    expect(t.json()).toMatchObject({ solUsd: 140, usdJeEur: 1.08 });
    expect(abfragen).toHaveLength(1); // zwischengespeichert

    // nach 6 h neu – EZB fällt aus: letzter Wert bleibt, Antwort kommt
    d.uhr.vor(KRYPTO_EUR_GUELTIG_MS + 1);
    kurs = new Error('EZB antwortet mit 503');
    const u2 = await d.app.inject({ url: '/api/krypto', headers: h });
    expect(u2.statusCode).toBe(200);
    expect(u2.json()).toMatchObject({ verbunden: true, usdJeEur: 1.08 });
    expect(abfragen).toHaveLength(2);
    // nach einem Fehler nicht bei jeder Anfrage neu
    await d.app.inject({ url: '/api/krypto', headers: h });
    expect(abfragen).toHaveLength(2);
    // nach der Pause wieder, jetzt mit neuem Kurs
    d.uhr.vor(KRYPTO_EUR_FEHLER_PAUSE_MS + 1);
    kurs = 1.1;
    expect((await d.app.inject({ url: '/api/krypto', headers: h })).json().usdJeEur).toBe(1.1);
    expect(abfragen).toHaveLength(3);
  });

  it('ohne je einen Kurs → null; ungültige Kurse zählen als Fehler; ohne Geheimnis keine EZB-Abfrage', async () => {
    let n = 0;
    const jetzt = 1_000_000;
    const h = new Hafen({
      url: 'http://krypto.test',
      geheimnis: G,
      jetzt: () => jetzt,
      usdJeEurHolen: async () => {
        n++;
        throw new Error('offline');
      },
    });
    expect(await h.usdJeEur()).toBeNull();
    expect(n).toBe(1);
    const h2 = new Hafen({ url: 'http://krypto.test', geheimnis: G, usdJeEurHolen: async () => Number.NaN });
    expect(await h2.usdJeEur()).toBeNull();
    const h3 = new Hafen({ url: 'http://krypto.test', usdJeEurHolen: async () => (n++, 1.08) });
    expect(await h3.usdJeEur()).toBeNull();
    expect(n).toBe(1);

    // Kryptowerk nicht erreichbar: Übersicht kommt trotzdem (mit Fehler und dem Kurs)
    const d = await testDorf({
      env: { KRYPTO_GEHEIMNIS: G },
      hafenHolen: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
      boerseFx: async () => ({ datum: '2026-11-16', kurs: 1.07 }),
    });
    const r = (await d.app.inject({ url: '/api/krypto', headers: await kopf(d) })).json();
    expect(r).toMatchObject({ verbunden: false, solUsd: null, usdJeEur: 1.07 });
    expect(r.fehler).toContain('nicht erreichbar');
  });

  it('langsame EZB hält die Antwort nicht auf (höchstens 3 s), der Kurs kommt beim nächsten Mal', async () => {
    let fertig!: (k: number) => void;
    const h = new Hafen({ url: 'http://krypto.test', geheimnis: G, usdJeEurHolen: () => new Promise<number>((r) => (fertig = r)) });
    const start = Date.now();
    expect(await h.usdJeEur()).toBeNull();
    expect(Date.now() - start).toBeLessThan(4000);
    fertig(1.09);
    await new Promise((r) => setTimeout(r, 0));
    expect(await h.usdJeEur()).toBe(1.09);
  }, 10_000);
});
