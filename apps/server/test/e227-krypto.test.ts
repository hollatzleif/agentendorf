import { describe, expect, it } from 'vitest';
import { KRYPTO_STANDARD, type KryptoEinstellung } from '@dorf/shared';
import { TestUhr } from '../src/uhr.js';
import { GEBUEHR_KURVE, K, START_SOL, START_TOKEN, gebuehrSatz, kaufen, kurveAusKurs, preisVon, verkaufen } from '../src/krypto/kurve.js';
import { gate, positionsGroesse, pruefen, punkte } from '../src/krypto/bewertung.js';
import { Kryptowerk, kryptoDb, type LlmAnfrage, type LlmAntwort } from '../src/krypto/motor.js';
import type { DexScreener, RugBericht, RugCheck, Schnappschuss } from '../src/krypto/quellen.js';
import { DexScreener as EchterDex, PumpPortal, RugCheck as EchterRug } from '../src/krypto/quellen.js';
import { kryptoServer } from '../src/krypto/server.js';

/** E227: Hafen – Paper Trading. Alles ohne Netz: Datenquellen sind nachgebaut, Zufall und Zeit fest. */

const MINT = 'AbCdEfGhJkLmNoPqRsTuVwXyZ123456789pump';
const START = KRYPTO_STANDARD;

function snap(mint: string, zeit: number, preis: number, o: Partial<Schnappschuss> = {}): Schnappschuss {
  return { mint, zeit, symbol: 'TEST', name: 'Test', dex: 'pumpfun', preisSol: preis, preisUsd: preis * 140, marktwertUsd: preis * 1e9 * 140, volumenUsdM5: 20_000, kaeufeM5: 80, verkaeufeM5: 30, aenderungM5: 12, aenderungH1: null, poolSol: null, poolToken: null, ...o };
}

const SAUBER: RugBericht = { zeit: 0, scoreNormiert: 5, risiken: [] };

function aufbau(o: { zufall?: number; llm?: (a: LlmAnfrage) => Promise<LlmAntwort>; rug?: RugBericht } = {}) {
  const uhr = new TestUhr();
  const db = kryptoDb(':memory:');
  const kurse = new Map<string, Schnappschuss>();
  let preis = 4e-8; // ~ 5600 $ Marktwert bei 140 $/SOL
  const dex = {
    async paare(mints: string[]) {
      return { schnappschuesse: mints.filter((m) => m === MINT).map((m) => kurse.get(m) ?? snap(m, uhr.jetzt(), preis)).map((s) => ({ ...s, zeit: uhr.jetzt() })), solUsd: 140 };
    },
  } as unknown as DexScreener;
  const rugAnfragen: string[] = [];
  const rug = {
    bereit: () => true,
    async bericht(m: string) {
      rugAnfragen.push(m);
      return { ...(o.rug ?? SAUBER), zeit: uhr.jetzt() };
    },
  } as unknown as RugCheck;
  const werk = new Kryptowerk({ db, uhr, dex, rug, zufall: () => o.zufall ?? 0.99, ...(o.llm ? { llm: o.llm } : {}) });
  const kurs = (p: number, extra: Partial<Schnappschuss> = {}) => {
    preis = p;
    kurse.set(MINT, snap(MINT, uhr.jetzt(), p, extra));
  };
  const neu = () => werk.neuerToken({ mint: MINT, txType: 'create', initialBuy: 20_000_000, solAmount: 0.6, name: 'Test', symbol: 'TEST', vSolInBondingCurve: 30.6, vTokensInBondingCurve: 1_052_000_000, marketCapSol: 29 } as never, uhr.jetzt());
  const schritt = async (ms: number) => {
    uhr.vor(ms);
    await werk.takt();
  };
  return { uhr, db, werk, kurs, neu, schritt, rugAnfragen };
}

function einstellung(e: Partial<KryptoEinstellung> = {}): KryptoEinstellung {
  return { ...structuredClone(START), name: 'Testbot', ...e };
}

describe('Marktmechanik (Bonding Curve, Gebühren)', () => {
  it('K aus echten Startreserven; Kurs ↔ Reserven; Kauf/Verkauf mit Gebühr und Slippage', () => {
    expect(K).toBe(START_SOL * START_TOKEN);
    // echtes create-Ereignis von PumpPortal: 30,059259258 SOL / 1 070 884 672,297 Token
    expect((30.059259258 * 1070884672.297204) / K).toBeCloseTo(1, 4);
    const m = kurveAusKurs(5e-8);
    expect(preisVon(m)).toBeCloseTo(5e-8, 15);
    expect(m.sol * m.token).toBeCloseTo(K, -2);
    const k = kaufen(m, 1);
    expect(k.gebuehrSol).toBeCloseTo(GEBUEHR_KURVE, 10);
    expect(k.slippageProzent).toBeGreaterThan(1.25); // Gebühr + Kurswirkung
    // sofort zurückverkaufen kostet zweimal Gebühr
    const v = verkaufen({ ...m, sol: m.sol + 1 - k.gebuehrSol, token: m.token - k.token }, k.token);
    expect(v.sol).toBeLessThan(0.98);
    expect(v.sol).toBeGreaterThan(0.97);
  });

  it('PumpSwap-Gebühr nach Marktwert in SOL (pump.fun/docs/fees)', () => {
    expect(gebuehrSatz('kurve', 50)).toBe(0.0125);
    expect(gebuehrSatz('pool', 100)).toBe(0.0125);
    expect(gebuehrSatz('pool', 1000)).toBe(0.012);
    expect(gebuehrSatz('pool', 5000)).toBe(0.01);
    expect(gebuehrSatz('pool', 200_000)).toBe(0.003);
  });
});

describe('Prüfmodule und Risk-Gate', () => {
  const t = { mint: MINT, symbol: 'T', name: 'T', erstellt: 0, devToken: 20_000_000, creator: null };
  it('Rug, Dev, Bundle, Holder, Volumen, Einstiegsfenster', () => {
    const e = einstellung();
    const s = snap(MINT, 120_000, 4e-8);
    const gut = pruefen(e, t, s, SAUBER, 120_000);
    expect(punkte(gut)).toBeGreaterThanOrEqual(60);
    // RugCheck „danger“ sperrt
    const boese: RugBericht = { zeit: 0, scoreNormiert: 67, risiken: [{ name: 'Creator history of rugged tokens', wert: '', stufe: 'danger' }, { name: 'Single holder ownership', wert: '50.00%', stufe: 'danger' }] };
    const r = pruefen(e, t, s, boese, 120_000);
    expect(punkte(r)).toBeNull();
    expect(r.find((x) => x.schluessel === 'rug')!.sperre).toBe(true);
    expect(r.find((x) => x.schluessel === 'dev')!.zeile).toContain('gerugged');
    expect(r.find((x) => x.schluessel === 'holder')!.sperre).toBe(true);
    // Entwickler hält zu viel, zu jung, zu wenig Volumen
    expect(pruefen(e, { ...t, devToken: 200_000_000 }, s, SAUBER, 120_000).find((x) => x.schluessel === 'dev')!.sperre).toBe(true);
    expect(pruefen(e, t, s, SAUBER, 10_000).find((x) => x.schluessel === 'sniper')!.sperre).toBe(true);
    expect(pruefen(e, t, { ...s, volumenUsdM5: 100 }, SAUBER, 120_000).find((x) => x.schluessel === 'volumen')!.sperre).toBe(true);
    // ohne RugCheck nie kaufen
    expect(punkte(pruefen(e, t, s, null, 120_000))).toBeNull();
  });

  it('Gate: Not-Aus, Bestand, offene Positionen, Tagesverlust, Kapital – Größe = kleinerer Wert', () => {
    const e = einstellung();
    expect(positionsGroesse(e, 100)).toBe(0.5);
    expect(positionsGroesse(e, 4)).toBeCloseTo(0.2);
    const l = { kasseSol: 10, offen: 0, heuteSol: 0, haeltSchon: false, notaus: false };
    expect(gate(e, l, 0.5).erlaubt).toBe(true);
    expect(gate(e, { ...l, notaus: true }, 0.5).grund).toContain('Not-Aus');
    expect(gate(e, { ...l, haeltSchon: true }, 0.5).erlaubt).toBe(false);
    expect(gate(e, { ...l, offen: 3 }, 0.5).grund).toContain('3/3');
    expect(gate(e, { ...l, heuteSol: -2 }, 0.5).grund).toContain('Tagesverlust');
    expect(gate(e, { ...l, kasseSol: 0.5 }, 0.5).erlaubt).toBe(false);
  });
});

describe('Kryptowerk (Paper Trading)', () => {
  it('kauft nach der Verzögerung zum späteren Kurs, mit Gebühren; Take-Profit, Trailing Stop, Kennzahlen', async () => {
    const x = aufbau();
    const bot = x.werk.anlegen(einstellung());
    expect(bot.status).toBe('laeuft');
    x.neu();
    x.kurs(4e-8);
    await x.schritt(70_000); // Kurs + RugCheck
    await x.schritt(1000); // bewerten → Kauf-Auftrag
    const e1 = x.werk.protokoll(bot.id).entscheidungen;
    expect(e1[0]).toMatchObject({ aktion: 'buy', quelle: 'regeln' });
    // Kurs steigt, bevor der Auftrag ausgeführt wird → teurer Einstieg (keine geschönte Füllung)
    x.kurs(4.4e-8);
    await x.schritt(2000);
    let p = x.werk.terminal(bot.id);
    expect(p.lage).toBe('LONG');
    expect(p.positionen[0]!.einstiegPreis).toBeCloseTo(4.4e-8, 12);
    const kauf = p.trades.find((t) => t.art === 'kauf')!;
    expect(kauf.verzoegerungMs).toBeGreaterThanOrEqual(1500);
    expect(kauf.sol).toBeCloseTo(0.5);
    expect(kauf.gebuehrSol).toBeCloseTo(0.5 * 0.0125 + 0.000005 + 0.0005, 6);
    expect(kauf.slippageProzent).toBeGreaterThan(1.25);
    expect(p.bot.kennzahlen.kapitalSol).toBeLessThan(10); // schon beim Einstieg im Minus (Gebühren)
    // +60 % → Take-Profit 1 (50 %)
    x.kurs(4.4e-8 * 1.6);
    await x.schritt(2000);
    await x.schritt(2000);
    p = x.werk.terminal(bot.id);
    expect(p.trades.filter((t) => t.art === 'verkauf')).toHaveLength(1);
    expect(p.trades[0]!.grund).toContain('Take-Profit 1');
    // Hoch bei +100 %, dann −25 % vom Hoch → Trailing Stop verkauft den Rest
    x.kurs(4.4e-8 * 2);
    await x.schritt(2000);
    x.kurs(4.4e-8 * 1.5);
    await x.schritt(2000);
    await x.schritt(2000);
    p = x.werk.terminal(bot.id);
    expect(p.lage).toBe('FLAT');
    const letzter = p.trades.find((t) => t.art === 'verkauf')!;
    expect(letzter.grund).toContain('Trailing');
    expect(letzter.gewinnSol).toBeGreaterThan(0);
    const k = p.bot.kennzahlen;
    expect(k).toMatchObject({ trades: 1, gewonnen: 1, verloren: 0, trefferquote: 1, offen: 0 });
    expect(k.gewinnSol).toBeGreaterThan(0);
    expect(k.gebuehrenSol).toBeGreaterThan(0.01);
    expect(p.pnlStunden.some((v) => v != null && v > 0)).toBe(true);
    expect(p.kerzen.length).toBeGreaterThan(0);
    expect(p.module.find((m) => m.schluessel === 'x')!.an).toBe(false);
  });

  it('Fehlgeschlagene Transaktionen kosten die Netzgebühr', async () => {
    const x = aufbau({ zufall: 0 }); // Zufall 0 < 90 % → schlägt fehl
    const bot = x.werk.anlegen(einstellung({ simulation: { verzoegerungMs: 1500, prioritaetSol: 0.0005, fehlschlagProzent: 90 } }));
    x.neu();
    x.kurs(4e-8);
    await x.schritt(70_000);
    await x.schritt(1000);
    await x.schritt(2000);
    const p = x.werk.terminal(bot.id);
    expect(p.trades[0]).toMatchObject({ art: 'fehlschlag' });
    expect(p.positionen).toHaveLength(0);
    expect(p.bot.kennzahlen.kapitalSol).toBeCloseTo(10 - 0.000505, 6);
  });

  it('Stop-Loss bei −25 %', async () => {
    const x = aufbau();
    const bot = x.werk.anlegen(einstellung());
    x.neu();
    x.kurs(4e-8);
    await x.schritt(70_000);
    await x.schritt(1000);
    await x.schritt(2000);
    x.kurs(2.8e-8);
    await x.schritt(2000);
    await x.schritt(2000);
    const p = x.werk.terminal(bot.id);
    expect(p.lage).toBe('FLAT');
    expect(p.trades[0]!.grund).toContain('Stop-Loss');
    expect(p.bot.kennzahlen).toMatchObject({ trades: 1, verloren: 1 });
    expect(p.bot.kennzahlen.maxDrawdownProzent).toBeGreaterThan(0);
  });

  it('Rugs werden geblockt und gezählt; nichts gekauft', async () => {
    const x = aufbau({ rug: { zeit: 0, scoreNormiert: 80, risiken: [{ name: 'Mint Authority still enabled', wert: '', stufe: 'danger' }] } });
    const bot = x.werk.anlegen(einstellung());
    x.neu();
    x.kurs(4e-8);
    await x.schritt(70_000);
    await x.schritt(1000);
    const p = x.werk.terminal(bot.id);
    expect(p.entscheidungen[0]).toMatchObject({ aktion: 'block' });
    expect(p.entscheidungen[0]!.grund).toContain('RUG');
    expect(p.bot.kennzahlen.geblockteRugs).toBe(1);
    expect(p.positionen).toHaveLength(0);
  });

  it('Not-Aus: alle Bots stoppen, offene Positionen werden verkauft, Start erst nach Aufheben', async () => {
    const x = aufbau();
    const bot = x.werk.anlegen(einstellung());
    x.neu();
    x.kurs(4e-8);
    await x.schritt(70_000);
    await x.schritt(1000);
    await x.schritt(2000);
    expect(x.werk.terminal(bot.id).lage).toBe('LONG');
    x.werk.notausAusloesen();
    expect(x.werk.bot(bot.id).status).toBe('gestoppt');
    await x.schritt(2000);
    const p = x.werk.terminal(bot.id);
    expect(p.lage).toBe('FLAT');
    expect(p.trades[0]!.grund).toBe('Not-Aus');
    expect(() => x.werk.statusSetzen(bot.id, 'laeuft')).toThrow(/Not-Aus/);
    // neuer Bot während Not-Aus startet gestoppt
    expect(x.werk.anlegen(einstellung({ name: 'Zwei' })).status).toBe('gestoppt');
    x.werk.notausAufheben();
    expect(x.werk.bot(bot.id).status).toBe('pausiert');
    expect(x.werk.statusSetzen(bot.id, 'laeuft').status).toBe('laeuft');
  });

  it('Prompt-Bot: LLM schlägt vor, Code entscheidet (Sicherheit, Gate, Tageslimit); Daten ohne Schlüssel', async () => {
    const anfragen: LlmAnfrage[] = [];
    let antwort: LlmAntwort = { action: 'buy', token: MINT, confidence: 0.3, reason: 'zu unsicher' };
    const x = aufbau({ llm: async (a) => (anfragen.push(a), antwort) });
    const bot = x.werk.anlegen(einstellung({ art: 'prompt', prompt: 'Kaufe nur Tokens mit starkem Volumen und sauberem RugCheck.', limits: { ...START.limits, maxLlmProTag: 2 } }));
    x.neu();
    x.kurs(4e-8);
    await x.schritt(70_000);
    await x.schritt(1000);
    await x.schritt(10);
    expect(anfragen).toHaveLength(1);
    expect(anfragen[0]!.prompt).toContain('starkem Volumen');
    expect(JSON.stringify(anfragen[0]!.daten)).not.toMatch(/secret|privat|seed/i);
    expect(x.werk.protokoll(bot.id).entscheidungen[0]).toMatchObject({ aktion: 'hold', quelle: 'llm' });
    // nach 3 min neu bewertet – jetzt sicher genug → Kauf über das Gate
    antwort = { action: 'buy', token: MINT, confidence: 0.9, reason: 'Volumen stark' };
    await x.schritt(3 * 60_000);
    await x.schritt(10);
    expect(x.werk.protokoll(bot.id).entscheidungen[0]).toMatchObject({ aktion: 'buy', quelle: 'llm' });
    await x.schritt(2000);
    expect(x.werk.terminal(bot.id).lage).toBe('LONG');
  });

  it('Bots anlegen/ändern/löschen; Live gibt es noch nicht; Startkapital fest nach dem ersten Trade', async () => {
    const x = aufbau();
    expect(() => x.werk.anlegen(einstellung(), 'live')).toThrow(/Paper/);
    expect(() => x.werk.anlegen({ ...einstellung(), limits: { ...START.limits, maxOffen: 99 } })).toThrow();
    expect(() => x.werk.anlegen({ ...einstellung(), simulation: { ...START.simulation, verzoegerungMs: 0 } })).toThrow();
    expect(() => x.werk.anlegen({ ...einstellung(), art: 'prompt', prompt: '' })).toThrow();
    const b = x.werk.anlegen(einstellung());
    expect(x.werk.aendern(b.id, einstellung({ startkapitalSol: 20 })).kennzahlen.kapitalSol).toBe(20);
    x.neu();
    x.kurs(4e-8);
    await x.schritt(70_000);
    await x.schritt(1000);
    await x.schritt(2000);
    expect(() => x.werk.aendern(b.id, einstellung({ startkapitalSol: 30 }))).toThrow(/Startkapital/);
    expect(x.werk.statusSetzen(b.id, 'pausiert').status).toBe('pausiert');
    x.werk.loeschen(b.id);
    expect(x.werk.uebersicht().bots).toHaveLength(0);
  });
});

describe('Kryptowerk: Schnittstelle und Quellen', () => {
  it('nur mit Geheimnis; Fehler als Text', async () => {
    const x = aufbau();
    const g = 'g'.repeat(40);
    const app = kryptoServer(x.werk, g);
    expect((await app.inject({ url: '/uebersicht' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/uebersicht', headers: { authorization: 'Bearer falsch' } })).statusCode).toBe(401);
    const h = { authorization: `Bearer ${g}` };
    expect((await app.inject({ url: '/uebersicht', headers: h })).json()).toMatchObject({ notaus: false, bots: [] });
    const neu = await app.inject({ method: 'POST', url: '/bots', headers: h, payload: { einstellung: einstellung(), modus: 'live' } });
    expect(neu.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/bots', headers: h, payload: { einstellung: einstellung() } });
    expect(ok.statusCode).toBe(200);
    const id = ok.json().id as string;
    expect((await app.inject({ url: `/bots/${id}/terminal`, headers: h })).json().lage).toBe('FLAT');
    expect((await app.inject({ method: 'POST', url: '/notaus', headers: h, payload: {} })).json().notaus).toBe(true);
    expect(() => kryptoServer(x.werk, 'kurz')).toThrow();
  });

  it('DexScreener: Paar gegen SOL, Pumpfun ohne Pool; RugCheck-Zusammenfassung; PumpPortal-Abos', async () => {
    const dex = new EchterDex({
      holen: (async (url: string) => {
        expect(url).toBe(`https://api.dexscreener.com/tokens/v1/solana/${MINT}`);
        return new Response(
          JSON.stringify([
            { chainId: 'solana', dexId: 'pumpfun', pairAddress: 'X', baseToken: { address: MINT, name: 'ANSEM TRUMP', symbol: 'ANSEMTRUMP' }, quoteToken: { address: 'So11111111111111111111111111111111111111112', name: 'Wrapped SOL', symbol: 'SOL' }, priceNative: '0.00000002806', priceUsd: '0.000001980', txns: { m5: { buys: 1, sells: 0 } }, volume: { h24: 4.18, m5: 4.18 }, priceChange: {}, fdv: 1980.31, marketCap: 1980.31, pairCreatedAt: 1795516560000 },
          ]),
        );
      }) as unknown as typeof fetch,
    });
    const r = await dex.paare([MINT]);
    expect(r.schnappschuesse[0]).toMatchObject({ dex: 'pumpfun', preisSol: 2.806e-8, marktwertUsd: 1980.31, kaeufeM5: 1, poolSol: null });
    expect(r.solUsd).toBeCloseTo(70.56, 1);
    const rug = new EchterRug({
      holen: (async () =>
        new Response(JSON.stringify({ tokenProgram: 'x', risks: [{ name: 'Creator history of rugged tokens', value: '', description: '', score: 28800, level: 'danger' }], score: 34802, score_normalised: 67, lpLockedPct: 100 }))) as unknown as typeof fetch,
    });
    expect(await rug.bericht(MINT)).toMatchObject({ scoreNormiert: 67, risiken: [{ name: 'Creator history of rugged tokens', stufe: 'danger' }] });
    // PumpPortal: eine Verbindung, beide kostenlosen Abos, Ereignis kommt an
    const gesendet: string[] = [];
    const neue: string[] = [];
    let ws!: { onopen: () => void; onmessage: (e: { data: unknown }) => void };
    const portal = new PumpPortal({ fabrik: () => (ws = { onopen: null, onmessage: null, onclose: null, onerror: null, send: (d: string) => gesendet.push(d), close: () => undefined } as never), neu: (t) => neue.push(t.mint) });
    portal.start();
    ws.onopen();
    expect(gesendet.map((g) => JSON.parse(g).method)).toEqual(['subscribeNewToken', 'subscribeMigration']);
    ws.onmessage({ data: JSON.stringify({ signature: 's', mint: MINT, traderPublicKey: 'J8', txType: 'create', initialBuy: 2115327.7, solAmount: 0.059, vTokensInBondingCurve: 1070884672.29, vSolInBondingCurve: 30.05, marketCapSol: 28.06, name: 'ANSEM TRUMP', symbol: 'ANSEMTRUMP', uri: 'https://ipfs.io/x', pool: 'pump' }) });
    ws.onmessage({ data: '{"message":"Successfully subscribed to token creation events."}' });
    expect(neue).toEqual([MINT]);
    portal.stop();
  });
});
