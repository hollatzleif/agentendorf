import { describe, expect, it } from 'vitest';
import { KRYPTO_STANDARD, type KryptoBacktest, type KryptoEinstellung } from '@dorf/shared';
import { TestUhr } from '../src/uhr.js';
import { Kryptowerk, kryptoDb, type KDB } from '../src/krypto/motor.js';
import { Backtests } from '../src/krypto/backtest.js';
import { K } from '../src/krypto/kurve.js';
import type { DexScreener, RugCheck, Schnappschuss } from '../src/krypto/quellen.js';

/**
 * E237: Backtest ≈ Paper auf denselben Daten. Vorher lief der Backtest auseinander (4 statt ~60 Trades im Betrieb): Positionen
 * hingen nach dem Ende der Kurse, Schnappschüsse galten mit der Backtest-Uhr als frisch, RugCheck sperrte Tokens nach drei
 * Fehlversuchen, der Echtzeit-Strom fehlte, devTokens24h sah nur das Fenster, aenderungM5 wurde nicht aufgezeichnet und das
 * Ergebnis zählte nur die letzten 500 Entscheidungen.
 */

const T0 = Date.UTC(2026, 10, 20, 8, 0, 0);
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function mintAus(i: number) {
  let x = (i * 2654435761 + 12345) >>> 0 || 1;
  let s = '';
  for (let k = 0; k < 40; k++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    s += B58[(x >>> 0) % 58];
  }
  return `${s}pump`;
}
function zufall(saat: number) {
  let x = (saat * 2654435761) >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}
const hash = (a: number, b: number) => zufall(a * 100003 + b * 7919 + 17)();

function einstellung(e: Partial<KryptoEinstellung> = {}): KryptoEinstellung {
  const s = structuredClone(KRYPTO_STANDARD);
  return { ...s, name: 'Gleichlauf', ...e, simulation: { ...s.simulation, fehlschlagProzent: 0, ...(e.simulation ?? {}) } };
}

/** Handgemachte Aufzeichnung (wie sie das Kryptowerk schreibt) */
function token(db: KDB, mint: string, erstellt: number, o: { creator?: string; dev?: number } = {}) {
  db.prepare('INSERT INTO tokens (mint, symbol, name, erstellt, creator, dev_token) VALUES (?, ?, ?, ?, ?, ?)').run(mint, mint.slice(0, 4), mint.slice(0, 4), erstellt, o.creator ?? `C-${mint.slice(0, 6)}`, o.dev ?? 1e7);
}
function kurs(db: KDB, mint: string, zeit: number, preis: number, o: { vol?: number; kaeufe?: number; verkaeufe?: number; m5?: number } = {}) {
  const spalten = o.m5 != null ? ', aenderung_m5' : '';
  db.prepare(`INSERT OR REPLACE INTO kurse (mint, zeit, preis_sol, marktwert_usd, vol_m5, kaeufe_m5, verkaeufe_m5, dex${spalten}) VALUES (?, ?, ?, ?, ?, ?, ?, ?${o.m5 != null ? ', ?' : ''})`).run(
    mint,
    zeit,
    preis,
    preis * 1e9 * 140,
    o.vol ?? 9000,
    o.kaeufe ?? 60,
    o.verkaeufe ?? 20,
    'pumpfun',
    ...(o.m5 != null ? [o.m5] : []),
  );
}
function rug(db: KDB, mint: string, zeit: number, score = 5) {
  const b = { zeit, scoreNormiert: score, risiken: [] };
  db.prepare('INSERT INTO rug_verlauf (mint, zeit, json) VALUES (?, ?, ?)').run(mint, zeit, JSON.stringify(b));
}
async function backtest(db: KDB, e: KryptoEinstellung, o: { von?: number; bis?: number } = {}): Promise<KryptoBacktest> {
  const bt = new Backtests({ db, jetzt: () => T0 });
  const j = bt.starten(e, o);
  const f = await bt.fertig(j.id);
  if (f.status !== 'fertig') throw new Error(f.fehler);
  return f;
}
const kaeufe = (f: KryptoBacktest) => f.ergebnis!.trades.filter((t) => t.art === 'kauf');

// ---- synthetischer Markt für den Gleichlauf --------------------------------------------------------------

interface Tok {
  mint: string;
  erstellt: number;
  i: number;
  laeufer: boolean;
  spitzeMin: number;
  faktor: number;
  rugScore: number;
  creator: string;
}

function markt(minuten: number, abstandMs: number) {
  const toks: Tok[] = [];
  for (let t = T0 - 10 * 60_000, i = 0; t < T0 + minuten * 60_000; t += abstandMs, i++) {
    const r = zufall(i + 99);
    toks.push({ mint: mintAus(i), erstellt: t, i, laeufer: r() < 0.4, spitzeMin: 3 + r() * 8, faktor: 1.5 + r() * 2, rugScore: Math.floor(r() * 55), creator: `C${Math.floor(r() * 40)}` });
  }
  const preis = (x: Tok, zeit: number) => {
    const a = (zeit - x.erstellt) / 60_000;
    const f = x.laeufer ? (a < x.spitzeMin ? 1 + (x.faktor - 1) * (a / x.spitzeMin) : Math.max(0.3, x.faktor * Math.exp(-(a - x.spitzeMin) / 4))) : Math.max(0.5, 1.05 - a / 30);
    return 4.2e-8 * f * (1 + (hash(x.i, Math.floor(zeit / 1000)) - 0.5) * 0.06);
  };
  const schnapp = (x: Tok, zeit: number): Schnappschuss => {
    const p = preis(x, zeit);
    const p5 = preis(x, Math.max(x.erstellt, zeit - 300_000));
    const a = (zeit - x.erstellt) / 60_000;
    const lebhaft = x.laeufer && a < x.spitzeMin + 6;
    const r = hash(x.i, Math.floor(zeit / 10_000) + 5);
    return {
      mint: x.mint,
      zeit,
      symbol: `T${x.i}`,
      name: `T${x.i}`,
      dex: 'pumpfun',
      preisSol: p,
      preisUsd: p * 140,
      marktwertUsd: p * 1e9 * 140,
      volumenUsdM5: lebhaft ? 5000 + r * 20000 : 800 + r * 4000,
      kaeufeM5: lebhaft ? 30 + Math.floor(r * 60) : 5 + Math.floor(r * 20),
      verkaeufeM5: lebhaft ? 15 + Math.floor(r * 20) : 8 + Math.floor(r * 15),
      aenderungM5: (p / p5 - 1) * 100,
      aenderungH1: null,
      poolSol: null,
      poolToken: null,
    };
  };
  return { toks, preis, schnapp, nach: new Map(toks.map((x) => [x.mint, x])) };
}

/** Paper-Betrieb mit Takt 2 s und Echtzeit-Strom (1 Tick/s für die abonnierten Tokens) – schreibt die Aufzeichnung */
async function paperLauf(minuten: number, abstandMs: number, e: KryptoEinstellung) {
  const m = markt(minuten, abstandMs);
  const uhr = new TestUhr(T0 - 10 * 60_000);
  const db = kryptoDb(':memory:');
  const dex = {
    async paare(mints: string[]) {
      const t = uhr.jetzt();
      return { schnappschuesse: mints.map((x) => m.nach.get(x)).filter((x): x is Tok => !!x && t - x.erstellt >= 30_000).map((x) => m.schnapp(x, t)), solUsd: 140 };
    },
  } as unknown as DexScreener;
  const rugQuelle = {
    bereit: () => true,
    async bericht(mint: string) {
      return { zeit: uhr.jetzt(), scoreNormiert: m.nach.get(mint)!.rugScore, risiken: [] };
    },
  } as unknown as RugCheck;
  let soll: string[] = [];
  const strom = { setzen: (v: string[], k: string[] = []) => void (soll = [...v, ...k].slice(0, 20)), stop() {} };
  const werk = new Kryptowerk({ db, uhr, dex, rug: rugQuelle, zufall: zufall(3), strom: strom as never });
  let n = 0;
  const ende = T0 + minuten * 60_000;
  let bot: string | null = null;
  for (let t = uhr.jetzt(); t <= ende; t += 1000) {
    uhr.vor(t - uhr.jetzt());
    if (t === T0) bot = werk.anlegen(e).id;
    while (n < m.toks.length && m.toks[n]!.erstellt <= t) {
      const x = m.toks[n++]!;
      werk.neuerToken({ mint: x.mint, txType: 'create', name: `T${x.i}`, symbol: `T${x.i}`, initialBuy: 1e7, traderPublicKey: x.creator } as never, x.erstellt);
    }
    for (const mint of soll) {
      const x = m.nach.get(mint);
      if (!x || t - x.erstellt < 30_000) continue;
      const p = m.preis(x, t);
      const vSol = Math.sqrt(K * p);
      werk.kurveTick(mint, { vSol, vToken: K / vSol, echtSol: vSol - 30, komplett: false, preisSol: p }, t);
    }
    if ((t - T0) % 2000 === 0 && bot) await werk.takt();
  }
  const b = bot!;
  // Gewinn wie in den Kennzahlen (Equity inkl. offener Positionen) – so rechnet auch der Backtest
  const k = werk.bot(b).kennzahlen;
  werk.beenden();
  const kaeufeLive = db.prepare("SELECT mint FROM trades WHERE bot_id = ? AND art = 'kauf'").all(b) as { mint: string }[];
  return { db, ende, kaeufe: kaeufeLive.map((x) => x.mint), geschlossen: k.trades, gewinn: k.gewinnSol };
}

describe('Backtest = dieselbe Maschine auf denselben Daten (E237)', () => {
  it('Gleichlauf: Backtest über die Aufzeichnung eines Paper-Laufs trifft dieselben Käufe, Trades und etwa denselben Gewinn', async () => {
    const e = einstellung({ name: 'Gleich' });
    const live = await paperLauf(25, 15_000, e);
    expect(live.kaeufe.length).toBeGreaterThanOrEqual(6);
    const f = await backtest(live.db, e, { von: T0, bis: live.ende });
    const bt = kaeufe(f).map((t) => t.mint);
    const gleich = bt.filter((m) => live.kaeufe.includes(m)).length;
    // dieselben Tokens (≥ 90 %), gleich viele Käufe und geschlossene Positionen (± 10 %), Gewinn auf 0,05 SOL
    // (vor E237: Gewinn um ~1,4 SOL daneben, in größeren Läufen nur 36–70 % gleiche Tokens)
    expect(gleich / live.kaeufe.length).toBeGreaterThanOrEqual(0.9);
    expect(Math.abs(bt.length - live.kaeufe.length)).toBeLessThanOrEqual(Math.max(1, Math.round(live.kaeufe.length * 0.1)));
    expect(Math.abs(f.ergebnis!.kennzahlen.trades - live.geschlossen)).toBeLessThanOrEqual(Math.max(1, Math.round(live.geschlossen * 0.1)));
    expect(Math.abs(f.ergebnis!.kennzahlen.gewinnSol - live.gewinn)).toBeLessThanOrEqual(0.05);
    // Abdeckung: Kurse, Rug-Berichte und Strom-Ticks lagen vor
    const a = f.ergebnis!.abdeckung!;
    expect(a.mitKurs).toBeGreaterThan(0);
    expect(a.mitStrom).toBeGreaterThan(0);
    expect(a.datenende).toBe(0);
  }, 60_000);

  it('Datenende: enden die Kurse eines gehaltenen Tokens, verkauft der Backtest zum letzten Kurs (gezählt) statt ewig offen zu bleiben', async () => {
    const db = kryptoDb(':memory:');
    for (let i = 0; i < 6; i++) {
      const mint = mintAus(1000 + i);
      const erstellt = i === 5 ? T0 + 4 * 3_600_000 : T0 + i * 600_000;
      token(db, mint, erstellt);
      rug(db, mint, erstellt + 60_000);
      // wie früher aufgezeichnet: nur solange der Token im Fenster (≤ 1800 s) lag, Kurs seitwärts
      for (let a = 30_000; a <= 1_800_000; a += 5000) kurs(db, mint, erstellt + a, 5e-8 * (1 + 0.01 * Math.sin(a / 7000)));
    }
    const f = await backtest(db, einstellung());
    const k = f.ergebnis!.kennzahlen;
    expect(f.ergebnis!.trades.filter((t) => t.art === 'verkauf' && /Datenende/.test(t.grund)).length).toBeGreaterThanOrEqual(3);
    expect(f.ergebnis!.abdeckung!.datenende).toBeGreaterThanOrEqual(3);
    expect(f.ergebnis!.hinweise!.join(' ')).toMatch(/Aufzeichnung des Tokens endete/);
    // Plätze werden wieder frei: auch die späteren Tokens werden gekauft
    expect(kaeufe(f).length).toBeGreaterThanOrEqual(5);
    expect(k.offen).toBeLessThanOrEqual(1);
  }, 30_000);

  it('ehrliche Zeit: kommt nach der Entscheidung kein Kurs mehr, verfällt der Kauf – nie Ausführung zum alten Kurs', async () => {
    const db = kryptoDb(':memory:');
    const a = mintAus(2000);
    token(db, a, T0);
    // ein einziger Kurs + Rug-Bericht zur selben Zeit, danach nichts mehr
    kurs(db, a, T0 + 60_000, 5e-8);
    rug(db, a, T0 + 60_000);
    // ein zweiter Token, nur damit der Datenbereich lang genug ist (schlechte Daten, wird nie gekauft)
    const b = mintAus(2001);
    token(db, b, T0);
    for (let t = T0 + 30_000; t <= T0 + 20 * 60_000; t += 10_000) kurs(db, b, t, 5e-8, { vol: 10, kaeufe: 1 });
    const f = await backtest(db, einstellung());
    expect(kaeufe(f).filter((t) => t.mint === a)).toHaveLength(0);
    expect(f.ergebnis!.abdeckung!.kaeufeVerfallen).toBe(1);
  });

  it('RugCheck zeitgenau: vor dem aufgezeichneten Bericht kein Kauf, danach schon – frühe Anfragen sperren den Token nicht', async () => {
    const db = kryptoDb(':memory:');
    const a = mintAus(3000);
    token(db, a, T0);
    for (let t = T0 + 30_000; t <= T0 + 25 * 60_000; t += 2000) kurs(db, a, t, 5e-8);
    const berichtZeit = T0 + 10 * 60_000;
    rug(db, a, berichtZeit);
    const f = await backtest(db, einstellung());
    const k = kaeufe(f);
    expect(k).toHaveLength(1);
    expect(k[0]!.zeit).toBeGreaterThanOrEqual(berichtZeit);
    expect(f.ergebnis!.abdeckung!.mitRug).toBe(1);
    expect(f.ergebnis!.abdeckung!.musterAus).toBe(false);
    // Bots mit Muster-Rat laufen, aber der Rat ist im Backtest aus (markiert)
    const m = await backtest(db, einstellung({ regeln: { ...KRYPTO_STANDARD.regeln, musterGewicht: 10 } }));
    expect(m.ergebnis!.abdeckung!.musterAus).toBe(true);
    expect(m.ergebnis!.hinweise!.join(' ')).toMatch(/Muster-Rat im Backtest aus/);
  });

  it('Strom-Ticks werden abgespielt: großer Einzelverkauf → sofort raus wie im Paper', async () => {
    const db = kryptoDb(':memory:');
    const a = mintAus(4000);
    token(db, a, T0);
    for (let t = T0 + 30_000; t <= T0 + 20 * 60_000; t += 2000) kurs(db, a, t, 5e-8);
    rug(db, a, T0 + 60_000);
    // Strom ab 65 s: Kurve mit 10 SOL echt, bei 3 min fallen die echten SOL in einem Trade um 30 %
    const ein = db.prepare('INSERT INTO strom_ticks (mint, zeit, preis, sol, echt_sol) VALUES (?, ?, ?, ?, ?)');
    for (let t = T0 + 65_000; t <= T0 + 10 * 60_000; t += 1000) {
      const echt = t >= T0 + 180_000 ? 7 : 10;
      const vSol = 30 + echt;
      ein.run(a, t, (vSol * vSol) / K, 0, echt);
    }
    const f = await backtest(db, einstellung());
    expect(kaeufe(f).length).toBeGreaterThanOrEqual(1);
    const v = f.ergebnis!.trades.filter((t) => t.art === 'verkauf');
    expect(v.some((t) => /Einzelverkauf/.test(t.grund))).toBe(true);
    expect(f.ergebnis!.abdeckung!.mitStrom).toBe(1);
  });

  it('devTokens24h zählt die Aufzeichnung der 24 h davor (Serien-Ersteller gesperrt wie im Paper)', async () => {
    const db = kryptoDb(':memory:');
    // 4 andere Tokens desselben Erstellers 20 h vorher (ohne Kurse – lagen nie im Fenster)
    for (let i = 0; i < 4; i++) token(db, mintAus(5100 + i), T0 - 20 * 3_600_000 + i * 60_000, { creator: 'Serie' });
    const a = mintAus(5000);
    token(db, a, T0, { creator: 'Serie' });
    for (let t = T0 + 30_000; t <= T0 + 20 * 60_000; t += 2000) kurs(db, a, t, 5e-8);
    rug(db, a, T0 + 60_000);
    const f = await backtest(db, einstellung());
    expect(kaeufe(f)).toHaveLength(0);
    expect(f.ergebnis!.entscheidungen.block).toBeGreaterThan(0);
  });

  it('aenderungM5 wird aufgezeichnet und zählt im Backtest wie im Paper (Sniper-Punkte)', async () => {
    const db = kryptoDb(':memory:');
    const a = mintAus(6000);
    token(db, a, T0);
    // ohne Schwung: 40 + 15 (Volumen genau am Minimum, 2:1) + 10 = 65 Punkte; mit +60 % in 5 min: 85
    for (let t = T0 + 30_000; t <= T0 + 20 * 60_000; t += 2000) kurs(db, a, t, 5e-8, { vol: 3000, kaeufe: 40, verkaeufe: 20, m5: 60 });
    rug(db, a, T0 + 60_000);
    const f = await backtest(db, einstellung({ regeln: { ...KRYPTO_STANDARD.regeln, minPunkte: 80 } }));
    expect(kaeufe(f)).toHaveLength(1);
  });

  it('Ergebnis zählt ALLE Entscheidungen (nicht nur die letzten 500)', async () => {
    const db = kryptoDb(':memory:');
    const gut = mintAus(7000);
    token(db, gut, T0);
    for (let t = T0 + 30_000; t <= T0 + 4 * 60_000; t += 2000) kurs(db, gut, t, 5e-8);
    rug(db, gut, T0 + 60_000);
    // 70 Tokens mit zu hohem Rug-Score: je ~10 Bewertungen (alle 3 min im 30-min-Fenster) → > 500 Blocks nach dem Kauf
    for (let i = 0; i < 70; i++) {
      const m = mintAus(7100 + i);
      const erstellt = T0 + 5 * 60_000 + i * 1000;
      token(db, m, erstellt);
      for (let t = erstellt + 30_000; t <= erstellt + 30 * 60_000; t += 10_000) kurs(db, m, t, 5e-8);
      rug(db, m, erstellt + 40_000, 90);
    }
    const f = await backtest(db, einstellung());
    expect(f.ergebnis!.entscheidungen.buy).toBe(1);
    expect(f.ergebnis!.entscheidungen.block).toBeGreaterThan(500);
  }, 30_000);

  it('Aufzeichnung: aenderungM5/H1 in kurse, Nicht-Kandidaten alle 10 s, Gekauftes/Kandidaten im Nachlauf nach dem Fenster', async () => {
    const uhr = new TestUhr(T0);
    const db = kryptoDb(':memory:');
    const a = mintAus(8000);
    const b = mintAus(8001);
    let preis = 5e-8;
    const abfragen: string[][] = [];
    const dex = {
      async paare(mints: string[]) {
        abfragen.push(mints);
        return { schnappschuesse: mints.map((m) => ({ mint: m, zeit: uhr.jetzt(), symbol: 'X', name: 'X', dex: 'pumpfun', preisSol: preis, preisUsd: null, marktwertUsd: preis * 1e9 * 140, volumenUsdM5: m === a ? 9000 : 10, kaeufeM5: m === a ? 60 : 1, verkaeufeM5: 20, aenderungM5: 12, aenderungH1: 30, poolSol: null, poolToken: null })), solUsd: 140 };
      },
    } as unknown as DexScreener;
    const rugQuelle = { bereit: () => true, bericht: async () => ({ zeit: uhr.jetzt(), scoreNormiert: 5, risiken: [] }) } as unknown as RugCheck;
    const werk = new Kryptowerk({ db, uhr, dex, rug: rugQuelle, zufall: () => 0.99 });
    werk.anlegen(einstellung({ filter: { ...KRYPTO_STANDARD.filter, maxAlterSek: 600 }, ausstieg: { ...KRYPTO_STANDARD.ausstieg, maxHaltMinuten: 30 } }));
    werk.neuerToken({ mint: a, txType: 'create', name: 'A', symbol: 'A', initialBuy: 1e7, traderPublicKey: 'x' } as never, T0);
    werk.neuerToken({ mint: b, txType: 'create', name: 'B', symbol: 'B', initialBuy: 1e7, traderPublicKey: 'y' } as never, T0);
    for (let t = 0; t < 25 * 60_000; t += 2000) {
      uhr.vor(2000);
      if (t === 3 * 60_000) preis = 1e-7; // Take-Profit 1 (Hälfte)
      if (t === 4 * 60_000) preis = 3e-8; // Stop-Loss → Position zu
      await werk.takt();
    }
    werk.beenden();
    const zeile = db.prepare('SELECT aenderung_m5 AS m5, aenderung_h1 AS h1 FROM kurse WHERE mint = ? LIMIT 1').get(b) as { m5: number; h1: number };
    expect(zeile).toEqual({ m5: 12, h1: 30 });
    // Nicht-Kandidat b: im Fenster (≤ 600 s) höchstens alle 10 s, danach gar nicht mehr
    const zeitenB = (db.prepare('SELECT zeit FROM kurse WHERE mint = ? ORDER BY zeit').all(b) as { zeit: number }[]).map((x) => x.zeit);
    expect(zeitenB.length).toBeGreaterThan(40);
    for (let i = 1; i < zeitenB.length; i++) expect(zeitenB[i]! - zeitenB[i - 1]!).toBeGreaterThanOrEqual(10_000);
    expect(zeitenB.at(-1)!).toBeLessThanOrEqual(T0 + 600_000 + 2000);
    // a wurde gekauft (aufzeichnen) → Nachlauf: Kurse auch nach dem Fenster, bis maxHaltMinuten danach
    const nachFenster = (db.prepare('SELECT COUNT(*) AS n FROM kurse WHERE mint = ? AND zeit > ?').get(a, T0 + 700_000) as { n: number }).n;
    expect(nachFenster).toBeGreaterThan(10);
    // im eigenen Limit: höchstens 45 Abrufe je Minute
    expect(abfragen.length).toBeLessThanOrEqual(Math.ceil((25 * 60_000) / 60_000) * 45);
  });
});
