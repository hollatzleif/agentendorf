import { describe, expect, it } from 'vitest';
import { KRYPTO_STANDARD, type KryptoEinstellung, type KryptoMusterModellInfo, type KryptoMusterSchluessel } from '@dorf/shared';
import { TestUhr } from '../src/uhr.js';
import { Kryptowerk, kryptoDb, type KDB } from '../src/krypto/motor.js';
import { einstellungPruefen } from '../src/krypto/einstellung.js';
import { MusterDienst, type Trainer } from '../src/krypto/muster/dienst.js';
import { MERKMAL_NAMEN, ertragLabel, ERTRAG_MIN_NACHLAUF_MS } from '../src/krypto/muster/merkmale.js';
import { rlHandlung } from '../src/krypto/muster/rl.js';
import { musterTrainieren } from '../src/krypto/muster/training.js';
import { zufallAus } from '../src/krypto/muster/rl.js';
import type { Tick } from '../src/krypto/muster/typen.js';
import type { GbdtModell, RlModell } from '../src/krypto/muster/typen.js';
import type { TrainingsErgebnis } from '../src/krypto/muster/training.js';
import { KURVE_DISKRIMINATOR, kurveLesen } from '../src/krypto/strom.js';
import type { DexScreener, RugCheck, Schnappschuss } from '../src/krypto/quellen.js';

/**
 * E243: Ertrags-Modell (Meta-Labeling) + reparierter RL – Label, Kaufschwelle, Einstieg nach Regel, Kauf über die
 * Muster-Schicht und den RL-Bot. (Aufbau wie e237-alarm-werk.)
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

const einstellung = (e: Partial<KryptoEinstellung> = {}): KryptoEinstellung => ({ ...structuredClone(KRYPTO_STANDARD), name: 'E243', ...e });
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


const T0 = Date.UTC(2026, 10, 26, 10, 0, 0);
/** Ticks jede Sekunde ab T0 mit Kurs f(s) */
const reihe = (sek: number, f: (s: number) => number): Tick[] => Array.from({ length: sek }, (_, s) => ({ zeit: T0 + s * 1000, preis: f(s), sol: 0.1, echtSol: 5 }));
const ertragFest = (p: number, schwelle: number, version = 1): GbdtModell => ({ ...fest(p, version), schwelle });

describe('ertragLabel (E243)', () => {
  it('Gewinn mit Take-Profit, Verlust mit Stop-Loss, Gebühren bei flachem Kurs, null ohne genug Nachlauf', () => {
    // steigt bis +200 % und bleibt: TP1 bei +50 % (Hälfte), TP2 bei +150 % (Rest) → deutlich im Plus
    const hoch = ertragLabel(reihe(900, (s) => 1e-7 * Math.min(3, 1 + s * 0.01)), T0);
    expect(hoch).toBeGreaterThan(60);
    // fällt stetig → Stop-Loss −25 % (+ Gebühren, Verzögerung)
    const runter = ertragLabel(reihe(900, (s) => 1e-7 * Math.max(0.3, 1 - s * 0.005)), T0)!;
    expect(runter).toBeLessThan(-25);
    expect(runter).toBeGreaterThan(-35);
    // flach, 10 min Aufzeichnung → Verkauf zum letzten Kurs: nur Gebühren (wenige %)
    const flach = ertragLabel(reihe(600, () => 1e-7), T0)!;
    expect(flach).toBeLessThan(0);
    expect(flach).toBeGreaterThan(-6);
    // flach, aber Aufzeichnung endet nach 3 min → Ausgang unbekannt
    expect(ERTRAG_MIN_NACHLAUF_MS).toBe(300_000);
    expect(ertragLabel(reihe(180, () => 1e-7), T0)).toBeNull();
    // Trailing: +40 % (unter TP1), dann −20 % vom Hoch → raus mit Gewinn
    const trail = ertragLabel(reihe(900, (s) => 1e-7 * (s < 60 ? 1 + s * 0.0067 : Math.max(1.0, 1.4 - (s - 60) * 0.01))), T0)!;
    expect(trail).toBeGreaterThan(runter); // früher raus als der Stop-Loss
    expect(trail).toBeLessThan(20);
  });
});

describe('Ertrags-Modell im Training (E243)', () => {
  it('trainiert ertrag/ertragWert; Schwelle auf Test-Hälfte 1 gewählt, auf Hälfte 2 geprüft – Konsole erklärt es', async () => {
    // Markt: Tokens mit Kaufdruck steigen nachhaltig, andere fallen – das Modell kann „lohnt sich“ lernen
    const z = zufallAus(5);
    const ticks = new Map<string, Tick[]>();
    const meta = new Map<string, { mint: string; erstellt: number }>();
    for (let k = 0; k < 140; k++) {
      const mint = `E${k}pump`;
      const start = T0 + k * 120_000;
      const gut = k % 2 === 0;
      meta.set(mint, { mint, erstellt: start - 5000 });
      let preis = 1e-7;
      let echt = 3;
      const l: Tick[] = [];
      for (let t = start; t < start + 20 * 60_000; t += 2000) {
        const sol = gut ? 0.4 + z() * 0.3 : -0.4 - z() * 0.3;
        preis *= 1 + (gut ? 0.0025 : -0.0025) + (z() - 0.5) * 0.004;
        echt = Math.max(0.1, echt + sol);
        l.push({ zeit: t, preis, sol, echtSol: echt });
      }
      ticks.set(mint, l);
    }
    const zeilen: string[] = [];
    const erg = await musterTrainieren({ ticks, meta }, { jetzt: T0 + 400 * 60_000, version: 1, log: (x) => zeilen.push(`${x.bereich}: ${x.text}`) });
    const e = erg.modelle.ertrag!;
    expect(e).toBeDefined();
    expect(e.info.test.auc).toBeGreaterThan(0.6);
    expect(e.info.test.schwelle).not.toBeNull();
    expect(e.gbdt.schwelle).toBe(e.info.test.schwelle);
    expect(e.info.test.trades).toBeGreaterThan(0);
    expect(e.info.test.ertragJeTrade).toBeGreaterThan(e.info.test.ertragAlle!);
    expect(e.info.aktiv).toBe(true);
    expect(erg.modelle.ertragWert).toBeDefined();
    expect(zeilen.join('\n')).toMatch(/ertrag: .*Schwelle \d,\d+ \(gewählt auf Hälfte 1: [+−][\d,]+ %\/Trade, \d+ Tokens\) → Hälfte 2: \d+ Käufe/);
    // RL: Einstiege nach Regel (Ertrags-Modell) – der Zeitraffer handelt
    expect(erg.rlInfo!.zeitraffer.trades).toBeGreaterThan(0);
  }, 240_000);
});

describe('RL-Einstieg nach Regel (E243)', () => {
  const lage = (o: object) => ({ p: 0.9, haelt: false, plusProzent: 0, haltSek: 0, trend30Prozent: 0, ...o });
  const g = { ...KRYPTO_STANDARD, minSicherheit: 0.6, erkunden: 1, nachschuss: true, maxAbsturz: 0.35 } as never;
  it('mit Ertrags-Modell entscheidet nur es; ohne wie bisher; Erkunden betrifft nur gehaltene Lagen; 💥 sperrt', () => {
    const q: RlModell = { version: 1, q: new Proxy({}, { get: () => [5, 0, 0, 0] }) as Record<string, number[]> };
    expect(rlHandlung(q, lage({ ertrag: 0.7, ertragSchwelle: 0.6 }), g, () => 0)).toBe('kaufen');
    expect(rlHandlung(q, lage({ ertrag: 0.5, ertragSchwelle: 0.6 }), g, () => 0)).toBe('warten'); // p 0,9 zählt dann nicht
    expect(rlHandlung(q, lage({}), g, () => 0)).toBe('kaufen'); // ohne Ertrags-Modell: p ≥ minSicherheit
    expect(rlHandlung(q, lage({ p: 0.2 }), g, () => 0)).toBe('warten');
    expect(rlHandlung(q, lage({ ertrag: 0.9, ertragSchwelle: 0.6, absturz: 0.5 }), g, () => 0)).toBe('warten');
  });
});

describe('Ertrags-Modell im Kryptowerk (E243)', () => {
  it('Muster-Schicht kauft ab der Kaufschwelle – nicht bei negativem erwarteten Ertrag, nicht darunter', async () => {
    const ja = aufbau();
    ja.muster.modelleSetzen({ ertrag: ertragFest(0.8, 0.6), ertragWert: wert(4) });
    const b1 = await ja.start(einstellung({ regeln: { minPunkte: 100, musterGewicht: 0, musterSchicht: { an: true, fallProzent: 5 } } }));
    expect(ja.entscheidungen(b1.id, 'buy')[0]).toMatchObject({ quelle: 'modell', grund: '💰 Ertrag 80 % ≥ Schwelle 60 % (erwartet +4,0 %)' });

    const minus = aufbau();
    minus.muster.modelleSetzen({ ertrag: ertragFest(0.8, 0.6), ertragWert: wert(-2) });
    const b2 = await minus.start(einstellung({ regeln: { minPunkte: 100, musterGewicht: 0, musterSchicht: { an: true, fallProzent: 5 } } }));
    await minus.schritt(2000);
    expect(minus.entscheidungen(b2.id, 'buy')).toEqual([]);

    const unter = aufbau();
    unter.muster.modelleSetzen({ ertrag: ertragFest(0.5, 0.6) });
    const b3 = await unter.start(einstellung({ regeln: { minPunkte: 100, musterGewicht: 0, musterSchicht: { an: true, fallProzent: 5 } } }));
    await unter.schritt(2000);
    expect(unter.entscheidungen(b3.id, 'buy')).toEqual([]);
    for (const x of [ja, minus, unter]) x.werk.beenden();
  });

  it('RL-Bot kauft über das Ertrags-Modell (auch ohne Grundsignal) und nie darunter', async () => {
    const ja = aufbau();
    ja.muster.modelleSetzen({ ertrag: ertragFest(0.75, 0.6) }, { version: 1, q: {} });
    const b1 = await ja.start(einstellung({ name: 'RL', art: 'rl', rl: { minSicherheit: 0.6, erkunden: 0, nachschuss: true } }));
    await ja.schritt(11_000);
    const kauf = ja.entscheidungen(b1.id, 'buy');
    expect(kauf).toHaveLength(1);
    expect(kauf[0]!.grund).toMatch(/^RL: kaufen · 💰 Ertrag 75 % ≥ Schwelle 60 %/);

    const nein = aufbau();
    nein.muster.modelleSetzen({ basis: fest(0.9), ertrag: ertragFest(0.4, 0.6) }, { version: 1, q: {} });
    const b2 = await nein.start(einstellung({ name: 'RL', art: 'rl', rl: { minSicherheit: 0.6, erkunden: 0, nachschuss: true } }));
    await nein.schritt(11_000);
    expect(nein.entscheidungen(b2.id, 'buy')).toEqual([]);
    ja.werk.beenden();
    nein.werk.beenden();
  });
});
