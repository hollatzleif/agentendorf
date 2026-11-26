import { describe, expect, it } from 'vitest';
import { KRYPTO_STANDARD, type KryptoEinstellung, type KryptoMusterModellInfo, type KryptoMusterSchluessel } from '@dorf/shared';
import { TestUhr } from '../src/uhr.js';
import { Kryptowerk, kryptoDb, type KDB } from '../src/krypto/motor.js';
import { einstellungPruefen } from '../src/krypto/einstellung.js';
import { MusterDienst, type Trainer } from '../src/krypto/muster/dienst.js';
import { MERKMAL_NAMEN, schichtUrteil } from '../src/krypto/muster/merkmale.js';
import type { GbdtModell, RlModell } from '../src/krypto/muster/typen.js';
import type { TrainingsErgebnis } from '../src/krypto/muster/training.js';
import { KURVE_DISKRIMINATOR, kurveLesen } from '../src/krypto/strom.js';
import type { DexScreener, RugCheck, Schnappschuss } from '../src/krypto/quellen.js';

/**
 * E242: Muster-Schicht – Regel-/Prompt-Bots kaufen und verkaufen wie gewohnt; dazu 🚀-Kauf nur mit steigender 2–5-min-Vorhersage,
 * Kauf-Sperre bei vorhergesagtem Fall, früher raus, wenn es kurz fällt und lang nicht steigt. (Aufbau wie e237-alarm-werk.)
 * Vorher (E237): Kursvorhersage (verlauf5s … verlauf5m) im Kryptowerk – Rat und Prognose im Terminal, Alarm 🚀 → Kauf (auch unter
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

const einstellung = (e: Partial<KryptoEinstellung> = {}): KryptoEinstellung => ({ ...structuredClone(KRYPTO_STANDARD), name: 'E242', ...e });
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


const schicht = (minPunkte: number, fallProzent = 5, e: Partial<KryptoEinstellung> = {}) =>
  einstellung({ regeln: { minPunkte, musterGewicht: 0, musterSchicht: { an: true, fallProzent } }, ...e });
const v = (werte: (number | null)[]) => ({ p: null, pump: null, absturz: null, hoch5: null, tief5: null, frueh: false, verlauf: werte }) as never;

describe('schichtUrteil (E242)', () => {
  it('Fall, Steigen und Früher-raus aus den Vorhersagen', () => {
    // 5 s, 15 s, 30 s, 1 min, 2 min, 5 min
    expect(schichtUrteil(v([null, null, null, 3, 4, 12]), 5)).toEqual({ fall: null, steigt: true, raus: null, kauf: null });
    expect(schichtUrteil(v([null, null, null, 3, null, -6]), 5).fall).toBe('Vorhersage −6,0 % (≤ −5 %)');
    expect(schichtUrteil(v([null, null, -6, null, null, 0]), 5)).toMatchObject({ steigt: false, raus: 'kurz −6,0 %, lang +0,0 %' });
    // kurz fällt, lang steigt → bleibt drin
    expect(schichtUrteil(v([null, null, -6, -2, null, 8]), 5).raus).toBeNull();
    // 💥 und Absturz-Erkenner
    expect(schichtUrteil(v([null, null, -12, null, null, 30]), 5)).toMatchObject({ fall: '💥 Alarm', raus: '💥 Alarm' });
    expect(schichtUrteil({ ...(v([]) as object), absturz: 0.4 } as never, 5)).toMatchObject({ fall: 'Absturz-Risiko 40 %', raus: null });
    expect(schichtUrteil({ ...(v([]) as object), absturz: 0.75 } as never, 5).raus).toBe('Absturz-Risiko 75 %');
    // ohne aktive Modelle entscheidet die Schicht nichts
    expect(schichtUrteil(v([null, null, null, null, null, null]), 5)).toEqual({ fall: null, steigt: false, raus: null, kauf: null });
  });
});

describe('Muster-Schicht im Kryptowerk (E242)', () => {
  it('🚀 kauft nur, wenn es auch auf 2–5 min steigt', async () => {
    const ja = aufbau();
    ja.muster.modelleSetzen({ verlauf1m: wert(20), verlauf5m: wert(10) });
    const b1 = await ja.start(schicht(100));
    expect(ja.entscheidungen(b1.id, 'buy')[0]).toMatchObject({ quelle: 'modell', grund: '🚀 Alarm: +20 % in 1 min erwartet' });

    const nein = aufbau();
    nein.muster.modelleSetzen({ verlauf1m: wert(20), verlauf5m: wert(-2) });
    const b2 = await nein.start(schicht(100));
    await nein.schritt(2000);
    expect(nein.entscheidungen(b2.id, 'buy')).toEqual([]);
    expect(nein.werk.terminal(b2.id).module.find((m) => m.schluessel === 'gate')!.zeile).toMatch(/^ECHT: Schicht: kein Anstieg in 2–5 min/);
    ja.werk.beenden();
    nein.werk.beenden();
  });

  it('vorhergesagter Fall sperrt den gewohnten Kauf – ohne Schicht kauft derselbe Bot', async () => {
    const mit = aufbau();
    mit.muster.modelleSetzen({ verlauf5m: wert(-8) });
    const b1 = await mit.start(schicht(0));
    expect(mit.entscheidungen(b1.id, 'buy')).toEqual([]);
    expect(mit.entscheidungen(b1.id, 'hold')[0]!.grund).toBe('Muster-Schicht: Vorhersage −8,0 % (≤ −5 %) – kein Kauf');

    const ohne = aufbau();
    ohne.muster.modelleSetzen({ verlauf5m: wert(-8) });
    const b2 = await ohne.start(einstellung({ regeln: { minPunkte: 0, musterGewicht: 0 } }));
    expect(ohne.entscheidungen(b2.id, 'buy')).toHaveLength(1);
    mit.werk.beenden();
    ohne.werk.beenden();
  });

  it('verkauft früher, wenn es kurz fällt und lang nicht steigt – nicht, wenn lang ein Anstieg kommt; Schicht aus: nie', async () => {
    const lauf = async (an: boolean, lang: number) => {
      const x = aufbau();
      const bot = await x.start(an ? schicht(0) : einstellung({ regeln: { minPunkte: 0, musterGewicht: 0 } }));
      await x.schritt(2000);
      expect(x.werk.terminal(bot.id).lage).toBe('LONG');
      x.muster.modelleSetzen({ verlauf30s: wert(-6), verlauf5m: wert(lang) });
      x.uhr.vor(2000);
      x.ticks();
      await x.schritt(2000);
      const sell = x.entscheidungen(bot.id, 'sell');
      x.werk.beenden();
      return sell;
    };
    const raus = await lauf(true, 0);
    expect(raus).toHaveLength(1);
    expect(raus[0]!.grund).toMatch(/^Muster-Schicht: kurz −6,0 %, lang \+0,0 %/);
    expect(await lauf(true, 8)).toEqual([]);
    expect(await lauf(false, 0)).toEqual([]);
  });

  it('Einstellung: Standard aus, fallProzent 1–50', () => {
    expect(einstellungPruefen(structuredClone(KRYPTO_STANDARD)).regeln.musterSchicht).toEqual({ an: false, fallProzent: 5 });
    const roh = structuredClone(KRYPTO_STANDARD) as KryptoEinstellung;
    roh.regeln.musterSchicht = { an: true, fallProzent: 80 };
    expect(() => einstellungPruefen(roh)).toThrow();
  });
});
