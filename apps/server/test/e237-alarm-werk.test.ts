import { describe, expect, it } from 'vitest';
import { KRYPTO_STANDARD, type KryptoEinstellung, type KryptoMusterModellInfo, type KryptoMusterSchluessel } from '@dorf/shared';
import { TestUhr } from '../src/uhr.js';
import { Kryptowerk, kryptoDb, type KDB } from '../src/krypto/motor.js';
import { einstellungPruefen } from '../src/krypto/einstellung.js';
import { MusterDienst, type Trainer } from '../src/krypto/muster/dienst.js';
import { MERKMAL_NAMEN } from '../src/krypto/muster/merkmale.js';
import type { GbdtModell, RlModell } from '../src/krypto/muster/typen.js';
import type { TrainingsErgebnis } from '../src/krypto/muster/training.js';
import { KURVE_DISKRIMINATOR, kurveLesen } from '../src/krypto/strom.js';
import type { DexScreener, RugCheck, Schnappschuss } from '../src/krypto/quellen.js';

/**
 * E237: Kursvorhersage (verlauf5s … verlauf5m) im Kryptowerk – Rat und Prognose im Terminal, Alarm 🚀 → Kauf (auch unter
 * minPunkte; Sperren, RugCheck und Risk-Gate gelten weiter; einmal je Bot und Token), Alarm 💥 → Verkauf (einmal je Position);
 * wirkt nur bei RL-Bots und musterGewicht > 0; eigene Schwellen aus regeln.alarm; Status mit den 6 neuen Modellen.
 */
const MINT = 'FNzXkQwLWzRm6Z1jJT9gnVH2pHiKiYLw3Ry1btY5KvLU';
type S = KryptoMusterSchluessel;

function konto(vToken: number, vSol: number) {
  const d = Buffer.alloc(151);
  Buffer.from(KURVE_DISKRIMINATOR).copy(d, 0);
  d.writeBigUInt64LE(BigInt(Math.round(vToken * 1e6)), 8);
  d.writeBigUInt64LE(BigInt(Math.round(vSol * 1e9)), 16);
  d.writeBigUInt64LE(BigInt(Math.round(Math.max(0, vToken - 279_900_000) * 1e6)), 24);
  d.writeBigUInt64LE(BigInt(Math.round(Math.max(0, vSol - 30) * 1e9)), 32);
  d.writeBigUInt64LE(1_000_000_000_000_000n, 40);
  return d.toString('base64');
}
const stand = (vSol: number) => kurveLesen(konto(1e9, vSol))!;

const einstellung = (e: Partial<KryptoEinstellung> = {}): KryptoEinstellung => ({ ...structuredClone(KRYPTO_STANDARD), name: 'E237', ...e });
const regel = (musterGewicht: number, alarm?: { anstiegProzent: number; fallProzent: number }, e: Partial<KryptoEinstellung> = {}) =>
  einstellung({ regeln: { minPunkte: 100, musterGewicht, ...(alarm ? { alarm } : {}) }, ...e });

function snap(mint: string, zeit: number, preis: number): Schnappschuss {
  return { mint, zeit, symbol: 'ECHT', name: 'Echt', dex: 'pumpfun', preisSol: preis, preisUsd: preis * 140, marktwertUsd: preis * 1e9 * 140, volumenUsdM5: 20_000, kaeufeM5: 80, verkaeufeM5: 30, aenderungM5: 12, aenderungH1: null, poolSol: null, poolToken: null };
}

const fest = (p: number, version = 1): GbdtModell => ({ version, merkmale: MERKMAL_NAMEN, basis: Math.log(p / (1 - p)), lernrate: 1, baeume: [] });
/** Wert-Modell ohne Bäume: sagt immer w (%) voraus */
const wert = (w: number, version = 1): GbdtModell => ({ version, merkmale: MERKMAL_NAMEN, basis: w, lernrate: 1, baeume: [], art: 'quadratisch' }) as GbdtModell;
const immerWarten = (): RlModell => ({ version: 1, q: new Proxy({}, { get: (_z, k) => (String(k).startsWith('h|') ? [1, 0, 0, 0] : [0, 1, 0, 0]) }) as Record<string, number[]> });

function aufbau(o: { rugScore?: number; rugBereit?: boolean } = {}) {
  const uhr = new TestUhr();
  const db: KDB = kryptoDb(':memory:');
  const dex = { async paare(m: string[]) { return { schnappschuesse: m.map((x) => snap(x, uhr.jetzt(), 4e-8)), solUsd: 140 }; } } as unknown as DexScreener;
  const rug = { bereit: () => o.rugBereit ?? true, async bericht() { return { zeit: uhr.jetzt(), scoreNormiert: o.rugScore ?? 5, risiken: [] }; } } as unknown as RugCheck;
  const muster = new MusterDienst({ db, uhr });
  const werk = new Kryptowerk({ db, uhr, dex, rug, zufall: () => 0.99, muster });
  const schritt = async (ms: number) => {
    uhr.vor(ms);
    await werk.takt();
  };
  const neu = () => werk.neuerToken({ mint: MINT, txType: 'create', initialBuy: 20_000_000, solAmount: 0.6, name: 'Echt', symbol: 'ECHT' } as never, uhr.jetzt());
  const ticks = (vSol = 40) => {
    for (const d of [-0.4, -0.2, 0]) {
      werk.kurveTick(MINT, stand(vSol + d), uhr.jetzt());
      uhr.vor(500);
    }
  };
  /** Bot anlegen, Token 68 s alt, Ticks, ein Takt (RugCheck + Bewertung) */
  const start = async (e: KryptoEinstellung) => {
    const bot = werk.anlegen(e);
    neu();
    uhr.vor(68_000);
    ticks();
    await schritt(1000);
    return bot;
  };
  const entscheidungen = (id: string, aktion: string) => werk.protokoll(id).entscheidungen.filter((z) => z.aktion === aktion);
  return { uhr, db, werk, muster, schritt, neu, ticks, start, entscheidungen };
}

describe('Rat und Prognose im Terminal (E237)', () => {
  it('musterRat: verlauf je Horizont (null = nicht aktiv) und alarm; Rat nur mit Kursvorhersage', async () => {
    const x = aufbau();
    const bot = x.werk.anlegen(einstellung());
    x.neu();
    x.ticks();
    x.muster.modelleSetzen({ verlauf5s: wert(2), verlauf1m: wert(20) });
    const rat = x.werk.terminal(bot.id).musterRat!;
    expect(rat).toHaveLength(1);
    expect(rat[0]).toMatchObject({ mint: MINT, alarm: 'anstieg', rat: 'kaufen', wahrscheinlichkeit: null, pump: null, absturz: null });
    expect(rat[0]!.verlauf).toEqual([2, null, null, 20, null, null]);
    // Absturz in 30 s hat Vorrang
    x.muster.modelleSetzen({ verlauf30s: wert(-12) });
    x.uhr.vor(2000);
    const r2 = x.werk.terminal(bot.id).musterRat![0]!;
    expect(r2).toMatchObject({ alarm: 'absturz', rat: 'halten' });
    // 5 min zählt nicht für den Alarm
    x.muster.modelleSetzen({ verlauf5s: null, verlauf30s: null, verlauf1m: null, verlauf5m: wert(80) });
    x.uhr.vor(2000);
    expect(x.werk.terminal(bot.id).musterRat![0]).toMatchObject({ alarm: null, verlauf: [null, null, null, null, null, 80] });
    x.werk.beenden();
  });

  it('Alarm in der Anzeige mit den Schwellen des Bots', async () => {
    const x = aufbau();
    const streng = x.werk.anlegen(regel(0, { anstiegProzent: 25, fallProzent: 30 }));
    const normal = x.werk.anlegen(regel(0));
    x.neu();
    x.ticks();
    x.muster.modelleSetzen({ verlauf1m: wert(20), verlauf30s: wert(-12) });
    expect(x.werk.terminal(normal.id).musterRat![0]!.alarm).toBe('absturz');
    expect(x.werk.terminal(streng.id).musterRat![0]!.alarm).toBeNull();
    expect(x.werk.terminal(streng.id).tokenKerzen![0]!.alarm).toBeNull();
    x.werk.beenden();
  });

  it('tokenKerzen.prognose: Punkte bei letzter Kerze + h mit Kurs × (1 + v/100), nur aktive Horizonte; dazu alarm', async () => {
    const x = aufbau();
    const bot = x.werk.anlegen(einstellung());
    x.neu();
    x.ticks();
    // ohne Modell: keine Prognose
    const ohne = x.werk.terminal(bot.id).tokenKerzen![0]!;
    expect(ohne.prognose).toBeUndefined();
    x.muster.modelleSetzen({ verlauf5s: wert(2), verlauf1m: wert(20), verlauf5m: wert(-30) });
    const k = x.werk.terminal(bot.id).tokenKerzen![0]!;
    const letzte = k.kerzen.at(-1)!;
    expect(k.prognose).toHaveLength(3);
    expect(k.prognose!.map((p) => p.zeit)).toEqual([letzte.zeit + 5000, letzte.zeit + 60_000, letzte.zeit + 300_000]);
    expect(k.prognose![0]!.c).toBeCloseTo(letzte.c * 1.02, 15);
    expect(k.prognose![1]!.c).toBeCloseTo(letzte.c * 1.2, 15);
    expect(k.prognose![2]!.c).toBeCloseTo(letzte.c * 0.7, 15);
    expect(k.alarm).toBe('anstieg');
    x.werk.beenden();
  });
});

describe('Alarm bei Regel-Bots (E237)', () => {
  it('musterGewicht 0: Alarm wird nur angezeigt – kein Kauf, kein Verkauf', async () => {
    const x = aufbau();
    x.muster.modelleSetzen({ verlauf1m: wert(20) });
    const bot = await x.start(regel(0));
    await x.schritt(2000);
    expect(x.entscheidungen(bot.id, 'buy')).toEqual([]);
    expect(x.werk.terminal(bot.id).musterRat![0]).toMatchObject({ alarm: 'anstieg' });
    // gehalten (über minPunkte 0) und 💥 Alarm → kein Verkauf
    const y = aufbau();
    const bot2 = await y.start(regel(0, undefined, { regeln: { minPunkte: 0, musterGewicht: 0 } }));
    await y.schritt(2000);
    expect(y.werk.terminal(bot2.id).lage).toBe('LONG');
    y.muster.modelleSetzen({ verlauf30s: wert(-20) });
    y.uhr.vor(2000);
    y.ticks();
    await y.schritt(2000);
    expect(y.entscheidungen(bot2.id, 'sell')).toEqual([]);
    expect(y.werk.terminal(bot2.id).lage).toBe('LONG');
    x.werk.beenden();
    y.werk.beenden();
  });

  it('musterGewicht > 0: 🚀 Alarm kauft unter minPunkte; 💥 Alarm verkauft genau einmal; danach kein zweiter Alarm-Kauf', async () => {
    const x = aufbau();
    x.muster.modelleSetzen({ verlauf5s: wert(3), verlauf1m: wert(20) });
    const bot = await x.start(regel(10));
    const kaeufe = x.entscheidungen(bot.id, 'buy');
    expect(kaeufe).toHaveLength(1);
    expect(kaeufe[0]).toMatchObject({ quelle: 'modell', mint: MINT, grund: '🚀 Alarm: +20 % in 1 min erwartet' });
    expect(kaeufe[0]!.sicherheit).toBeCloseTo(0.2, 6);
    await x.schritt(2000);
    expect(x.werk.terminal(bot.id).lage).toBe('LONG');
    // 💥: Kurs in 30 s −15 % erwartet → raus (einmal, auch über mehrere Ticks/Takte)
    x.muster.modelleSetzen({ verlauf30s: wert(-15) });
    x.uhr.vor(2000);
    x.ticks();
    x.ticks();
    const sell = x.entscheidungen(bot.id, 'sell');
    expect(sell).toHaveLength(1);
    expect(sell[0]).toMatchObject({ quelle: 'modell' });
    expect(sell[0]!.grund).toMatch(/^💥 Alarm: −15 % in 30 s erwartet/);
    await x.schritt(2000);
    await x.schritt(2000);
    expect(x.werk.terminal(bot.id).lage).toBe('FLAT');
    expect(x.entscheidungen(bot.id, 'sell')).toHaveLength(1);
    // wieder 🚀 – aber höchstens ein Alarm-Kauf je Bot und Token
    x.muster.modelleSetzen({ verlauf30s: null });
    x.uhr.vor(2000);
    x.ticks();
    for (let i = 0; i < 5; i++) await x.schritt(2000);
    expect(x.entscheidungen(bot.id, 'buy')).toHaveLength(1);
    expect(x.werk.terminal(bot.id).lage).toBe('FLAT');
    x.werk.beenden();
  });

  it('Pump-Erkenner ≥ 40 % löst den Alarm ebenfalls aus', async () => {
    const x = aufbau();
    x.muster.modelleSetzen({ pump: fest(0.45) });
    const bot = await x.start(regel(10));
    expect(x.entscheidungen(bot.id, 'buy')[0]!.grund).toBe('🚀 Alarm: Pump-Erkenner 45 %');
    x.werk.beenden();
  });

  it('kein Alarm-Kauf bei Rug-Sperre, ohne RugCheck-Bericht, bei vollem Gate oder bei 💥 (Vorrang)', async () => {
    const rugSperre = aufbau({ rugScore: 90 });
    rugSperre.muster.modelleSetzen({ verlauf1m: wert(20) });
    const b1 = await rugSperre.start(regel(10));
    await rugSperre.schritt(2000);
    expect(rugSperre.entscheidungen(b1.id, 'buy')).toEqual([]);
    expect(rugSperre.werk.terminal(b1.id).module.find((m) => m.schluessel === 'gate')!.zeile).toMatch(/Alarm.*gesperrt/);

    const ohneRug = aufbau({ rugBereit: false });
    ohneRug.muster.modelleSetzen({ verlauf1m: wert(20) });
    const b2 = await ohneRug.start(regel(10));
    await ohneRug.schritt(2000);
    expect(ohneRug.entscheidungen(b2.id, 'buy')).toEqual([]);
    expect(ohneRug.werk.terminal(b2.id).module.find((m) => m.schluessel === 'gate')!.zeile).toMatch(/warte auf RugCheck/);

    // Gate: zu wenig Kapital (0,1 SOL × 5 % < 0,01 SOL)
    const gate = aufbau();
    gate.muster.modelleSetzen({ verlauf1m: wert(20) });
    const b3 = await gate.start(regel(10, undefined, { startkapitalSol: 0.1 }));
    await gate.schritt(2000);
    expect(gate.entscheidungen(b3.id, 'buy')).toEqual([]);
    expect(gate.werk.terminal(b3.id).module.find((m) => m.schluessel === 'gate')!.zeile).toMatch(/Alarm.*zu wenig Kapital/);

    // 🚀 in 1 min, aber 💥 in 30 s → Absturz hat Vorrang: kein Kauf, auch nicht über die Punkte (minPunkte 0)
    const sturz = aufbau();
    sturz.muster.modelleSetzen({ verlauf1m: wert(20), verlauf30s: wert(-12) });
    const b4 = await sturz.start(regel(10, undefined, { regeln: { minPunkte: 0, musterGewicht: 10 } }));
    await sturz.schritt(2000);
    expect(sturz.entscheidungen(b4.id, 'buy')).toEqual([]);
    expect(sturz.entscheidungen(b4.id, 'hold')[0]!.grund).toMatch(/^💥 Alarm: −12 % in 30 s erwartet – kein Kauf/);

    for (const x of [rugSperre, ohneRug, gate, sturz]) x.werk.beenden();
  });

  it('eigene Schwellen aus regeln.alarm wirken (25 % statt 15 %)', async () => {
    const x = aufbau();
    x.muster.modelleSetzen({ verlauf1m: wert(20) });
    const bot = await x.start(regel(10, { anstiegProzent: 25, fallProzent: 10 }));
    await x.schritt(2000);
    expect(x.entscheidungen(bot.id, 'buy')).toEqual([]);
    x.muster.modelleSetzen({ verlauf1m: wert(30) });
    await x.schritt(2000);
    expect(x.entscheidungen(bot.id, 'buy')[0]!.grund).toBe('🚀 Alarm: +30 % in 1 min erwartet');
    x.werk.beenden();
  });

  it('Prompt-Bot mit musterGewicht > 0 kauft bei 🚀 ohne LLM', async () => {
    const x = aufbau();
    const anfragen: unknown[] = [];
    const werk = new Kryptowerk({
      db: x.db,
      uhr: x.uhr,
      dex: { async paare(m: string[]) { return { schnappschuesse: m.map((y) => snap(y, x.uhr.jetzt(), 4e-8)), solUsd: 140 }; } } as unknown as DexScreener,
      rug: { bereit: () => true, async bericht() { return { zeit: x.uhr.jetzt(), scoreNormiert: 5, risiken: [] }; } } as unknown as RugCheck,
      muster: x.muster,
      llm: async (a) => (anfragen.push(a), { action: 'hold', token: MINT, confidence: 0.1, reason: 'nein' }),
    });
    x.muster.modelleSetzen({ verlauf2m: wert(40) });
    const bot = werk.anlegen(einstellung({ art: 'prompt', prompt: 'Kaufe nur starke Tokens mit viel Volumen.', regeln: { minPunkte: 60, musterGewicht: 5 } }));
    werk.neuerToken({ mint: MINT, txType: 'create', initialBuy: 20_000_000, solAmount: 0.6, name: 'Echt', symbol: 'ECHT' } as never, x.uhr.jetzt());
    x.uhr.vor(68_000);
    for (const d of [-0.4, -0.2, 0]) {
      werk.kurveTick(MINT, stand(40 + d), x.uhr.jetzt());
      x.uhr.vor(500);
    }
    x.uhr.vor(1000);
    await werk.takt();
    await new Promise((r) => setImmediate(r));
    expect(anfragen).toEqual([]);
    expect(werk.protokoll(bot.id).entscheidungen.find((z) => z.aktion === 'buy')).toMatchObject({ quelle: 'modell', grund: '🚀 Alarm: +40 % in 2 min erwartet' });
    werk.beenden();
    x.werk.beenden();
  });
});

describe('Alarm bei RL-Bots (E237)', () => {
  it('RL-Bot kauft bei 🚀 (auch wenn der Agent warten will) und verkauft bei 💥 genau einmal', async () => {
    const x = aufbau();
    // Grundsignal schwach (p 10 % < minSicherheit) – kaufen würde er nur über den Alarm
    x.muster.modelleSetzen({ basis: fest(0.1), verlauf15s: wert(18) }, immerWarten());
    const bot = await x.start(einstellung({ name: 'RL', art: 'rl', rl: { minSicherheit: 0.6, erkunden: 0, nachschuss: true } }));
    const kauf = x.entscheidungen(bot.id, 'buy');
    expect(kauf).toHaveLength(1);
    expect(kauf[0]).toMatchObject({ quelle: 'modell', grund: '🚀 Alarm: +18 % in 15 s erwartet' });
    await x.schritt(2000);
    expect(x.werk.terminal(bot.id).lage).toBe('LONG');
    x.muster.modelleSetzen({ verlauf5s: wert(-11) });
    x.uhr.vor(2000);
    x.ticks();
    x.ticks();
    const sell = x.entscheidungen(bot.id, 'sell');
    expect(sell).toHaveLength(1);
    expect(sell[0]!.grund).toMatch(/^💥 Alarm: −11 % in 5 s erwartet/);
    await x.schritt(2000);
    expect(x.werk.terminal(bot.id).lage).toBe('FLAT');
    x.werk.beenden();
  });

  it('RL-Bot kauft bei 💥 Alarm nie (auch nicht über das Grundsignal)', async () => {
    const x = aufbau();
    x.muster.modelleSetzen({ basis: fest(0.9), verlauf1m: wert(-12) });
    const bot = await x.start(einstellung({ name: 'RL', art: 'rl', rl: { minSicherheit: 0.6, erkunden: 0, nachschuss: true } }));
    await x.schritt(2000);
    expect(x.entscheidungen(bot.id, 'buy')).toEqual([]);
    expect(x.werk.terminal(bot.id).module.find((m) => m.schluessel === 'volumen')!.zeile).toMatch(/💥 Alarm: −12 % in 1 min erwartet – kein Kauf/);
    x.werk.beenden();
  });
});

describe('Einstellung und Status (E237)', () => {
  it('regeln.alarm: Standard 15/10, Grenzen 1–500 bzw. 1–95', () => {
    expect(einstellungPruefen({ ...KRYPTO_STANDARD, regeln: { minPunkte: 60, musterGewicht: 0 } }).regeln.alarm).toEqual({ anstiegProzent: 15, fallProzent: 10 });
    expect(einstellungPruefen({ ...KRYPTO_STANDARD, regeln: { minPunkte: 60, alarm: { anstiegProzent: 500, fallProzent: 95 } } }).regeln.alarm).toEqual({ anstiegProzent: 500, fallProzent: 95 });
    for (const alarm of [{ anstiegProzent: 0, fallProzent: 10 }, { anstiegProzent: 501, fallProzent: 10 }, { anstiegProzent: 15, fallProzent: 96 }, { anstiegProzent: 15 }]) {
      expect(() => einstellungPruefen({ ...KRYPTO_STANDARD, regeln: { minPunkte: 60, alarm } })).toThrow();
    }
  });

  it('alte Bots ohne regeln.alarm bekommen den Standard', () => {
    const x = aufbau();
    const bot = x.werk.anlegen(einstellung());
    const e = JSON.parse((x.db.prepare('SELECT einstellung_json FROM bots WHERE id = ?').get(bot.id) as { einstellung_json: string }).einstellung_json) as KryptoEinstellung;
    delete e.regeln.alarm;
    x.db.prepare('UPDATE bots SET einstellung_json = ? WHERE id = ?').run(JSON.stringify(e), bot.id);
    expect(x.werk.bot(bot.id).einstellung.regeln.alarm).toEqual({ anstiegProzent: 15, fallProzent: 10 });
    x.werk.beenden();
  });

  it('Status listet die 6 Verlauf-Modelle (gespeichert, nach Neustart geladen, mit Richtung/Alarm-Treffern)', async () => {
    const uhr = new TestUhr();
    const db = kryptoDb(':memory:');
    const verlauf: S[] = ['verlauf5s', 'verlauf15s', 'verlauf30s', 'verlauf1m', 'verlauf2m', 'verlauf5m'];
    const info = (k: S, version: number, aktiv: boolean): KryptoMusterModellInfo => ({
      schluessel: k,
      version,
      trainiert: new Date(0).toISOString(),
      aktiv,
      gruende: aktiv ? [] : ['zu schwach'],
      beispiele: 1000,
      test: { beispiele: 300, tokens: 20, auc: null, aucUntergrenze: null, praezision: null, basis: null, fehler: 4, fehlerBasis: 6, richtung: 0.7, alarmAnstieg: { n: 12, treffer: 7 }, alarmFall: { n: 9, treffer: 6 } },
      merkmale: [],
    });
    const trainer: Trainer = async (_d, o) => {
      const modelle: TrainingsErgebnis['modelle'] = {};
      verlauf.forEach((k, i) => (modelle[k] = { gbdt: wert(i, o.version), info: info(k, o.version, i !== 5) }));
      return { gbdt: null, rl: null, modell: null, rlInfo: null, modelle, bericht: 'Lauf' } as TrainingsErgebnis;
    };
    const m = new MusterDienst({ db, uhr, trainer });
    m.trainingStarten();
    await m.fertig();
    const st = m.status();
    expect(st.training.fehler).toBeNull();
    expect(st.modelle!.map((x) => [x.schluessel, x.aktiv])).toEqual(verlauf.map((k, i) => [k, i !== 5]));
    expect(st.modelle![0]!.test).toMatchObject({ richtung: 0.7, alarmAnstieg: { n: 12, treffer: 7 }, alarmFall: { n: 9, treffer: 6 } });
    expect(Object.keys(m.gueltigeModelle()).sort()).toEqual(verlauf.slice(0, 5).sort());
    // Verlauf-Modelle machen keinen RL-Agenten gültig und liefern Signale
    expect(m.signaleAktiv).toBe(true);
    expect(m.rlBereit).toBe(false);
    const m2 = new MusterDienst({ db, uhr });
    expect(m2.status().modelle!.map((x) => [x.schluessel, x.aktiv])).toEqual(verlauf.map((k, i) => [k, i !== 5]));
    expect(Object.keys(m2.gueltigeModelle()).sort()).toEqual(verlauf.slice(0, 5).sort());
  });
});
