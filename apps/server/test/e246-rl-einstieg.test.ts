import { describe, expect, it } from 'vitest';
import { KRYPTO_STANDARD, type KryptoEinstellung, type KryptoRlEinstieg } from '@dorf/shared';
import { TestUhr } from '../src/uhr.js';
import { Kryptowerk, kryptoDb, type KDB } from '../src/krypto/motor.js';
import { rlEinstiegErfuellt, rlEinstiegText, rlEinstiegWaehlen, rlHandlung, type RlEpisode } from '../src/krypto/muster/rl.js';
import { MusterDienst } from '../src/krypto/muster/dienst.js';
import { MERKMAL_NAMEN } from '../src/krypto/muster/merkmale.js';
import type { GbdtModell, RlModell } from '../src/krypto/muster/typen.js';
import { KURVE_DISKRIMINATOR, kurveLesen } from '../src/krypto/strom.js';
import type { DexScreener, RugCheck, Schnappschuss } from '../src/krypto/quellen.js';

/**
 * E246: Der RL-Agent lernt seine Einstiegs-Regel (Signal + Schwelle) – gewählt auf Hälfte 1 der Testdaten, geprüft auf Hälfte 2.
 */
const MINT = 'FNzXkQwLWzRm6Z1jJT9gnVH2pHiKiYLw3Ry1btY5KvLU';

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

function snap(mint: string, zeit: number, preis: number): Schnappschuss {
  return { mint, zeit, symbol: 'ECHT', name: 'Echt', dex: 'pumpfun', preisSol: preis, preisUsd: preis * 140, marktwertUsd: preis * 1e9 * 140, volumenUsdM5: 20_000, kaeufeM5: 80, verkaeufeM5: 30, aenderungM5: 12, aenderungH1: null, poolSol: null, poolToken: null };
}

const fest = (p: number, version = 1): GbdtModell => ({ version, merkmale: MERKMAL_NAMEN, basis: Math.log(p / (1 - p)), lernrate: 1, baeume: [] });

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
const halten = (): RlModell => ({ version: 1, q: new Proxy({}, { get: (_z, k) => (String(k).startsWith('h|') ? [1, 0, 0, 0] : [0, 0, 0, 0]) }) as Record<string, number[]> });
const einstieg = (o: Partial<KryptoRlEinstieg> = {}): KryptoRlEinstieg => ({ signal: 'pump', schwelle: 0.1, anteil: 0.1, wahl: { trades: 20, gewinnSol: 0.2 }, pruef: { trades: 12, gewinnSol: 0.1 }, bestaetigt: true, ...o });

describe('Einstiegs-Regel (E246)', () => {
  const lage = (o: object) => ({ p: 0, haelt: false, plusProzent: 0, haltSek: 0, trend30Prozent: 0, ...o });
  const g = { minSicherheit: 0.6, erkunden: 0, nachschuss: true, maxAbsturz: 0.35 };
  it('gelernte Regel entscheidet vor p/🚀/Ertrag; 💥 sperrt weiter; fehlt das Signal → alte Regel; Training kauft überall', () => {
    const m: RlModell = { ...halten(), einstieg: einstieg({ signal: 'v1m', schwelle: 4 }) };
    expect(rlHandlung(m, lage({ v1m: 5 }), g, () => 0)).toBe('kaufen');
    expect(rlHandlung(m, lage({ v1m: 3, p: 0.9, pump: 0.9 }), g, () => 0)).toBe('warten');
    expect(rlHandlung(m, lage({ v1m: 3, ertrag: 0.9, ertragSchwelle: 0.5 }), g, () => 0)).toBe('warten');
    expect(rlHandlung(m, lage({ v1m: 9, absturz: 0.5 }), g, () => 0)).toBe('warten');
    // Signal nicht da → Rückfall auf p ≥ minSicherheit
    expect(rlHandlung(m, lage({ p: 0.7 }), g, () => 0)).toBe('kaufen');
    expect(rlHandlung(m, lage({ p: 0.5 }), g, () => 0)).toBe('warten');
    // Training (minSicherheit 0): jeder Zeitpunkt
    expect(rlHandlung(m, lage({ v1m: -5 }), { ...g, minSicherheit: 0 }, () => 0)).toBe('kaufen');
    expect(rlEinstiegErfuellt(lage({}), m.einstieg!)).toBeNull();
    expect(rlEinstiegText(m.einstieg!, 5.24)).toBe('📈 Kurs in 1 min +5,2 % ≥ +4,0 %');
    expect(rlEinstiegText(einstieg({ schwelle: 0.12 }), 0.31)).toBe('🚀 Pump 31 % ≥ 12 %');
  });

  it('wählt Signal und Schwelle auf Hälfte 1 (bester Gewinn), prüft auf Hälfte 2', async () => {
    // gute Tokens: 📈 Kurs in 1 min sagt +8 % und der Kurs steigt; schlechte: −2 % und der Kurs fällt; p ist überall 0 (nicht aktiv)
    const ep: RlEpisode[] = [];
    for (let k = 0; k < 40; k++) {
      const gut = k % 2 === 0;
      const start = T0 + k * 600_000;
      ep.push(
        Array.from({ length: 60 }, (_, i) => ({
          zeit: start + i * 5000,
          mint: `M${k}`,
          preis: 1e-7 * (gut ? 1 + 0.01 * i : 1 - 0.008 * i),
          p: 0,
          trend30Prozent: 0,
          v1m: gut ? 8 : -2,
        })),
      );
    }
    const { einstieg: e, kandidaten } = await rlEinstiegWaehlen(halten(), ep, { minSicherheit: 0.6, erkunden: 0, nachschuss: true, maxAbsturz: 0.35 });
    // p (immer 0) ist kein Kandidat, nur v1m
    expect(new Set(kandidaten.map((x) => x.signal))).toEqual(new Set(['v1m']));
    expect(e).toMatchObject({ signal: 'v1m', schwelle: 8, bestaetigt: true });
    expect(e!.wahl.trades).toBe(10);
    expect(e!.pruef.trades).toBe(10);
    expect(e!.pruef.gewinnSol).toBeGreaterThan(0);
    // zu wenig Episoden → keine Regel
    expect((await rlEinstiegWaehlen(halten(), ep.slice(0, 3), { minSicherheit: 0.6, erkunden: 0, nachschuss: true })).einstieg).toBeNull();
  });
});

describe('RL-Bot im Kryptowerk mit gelernter Regel (E246)', () => {
  it('kauft ab der gelernten 🚀-Schwelle (unter den alten 30 %), ohne Regel nicht', async () => {
    const ja = aufbau();
    ja.muster.modelleSetzen({ pump: fest(0.15) }, { version: 1, q: {}, einstieg: einstieg({ signal: 'pump', schwelle: 0.1 }) });
    const b1 = await ja.start(einstellung({ name: 'RL', art: 'rl', rl: { minSicherheit: 0.6, erkunden: 0, nachschuss: true } }));
    await ja.schritt(11_000);
    const kauf = ja.entscheidungen(b1.id, 'buy');
    expect(kauf).toHaveLength(1);
    expect(kauf[0]!.grund).toMatch(/^RL: kaufen · gelernt: 🚀 Pump 15 % ≥ 10 %/);

    const nein = aufbau();
    nein.muster.modelleSetzen({ pump: fest(0.15) }, { version: 1, q: {} });
    const b2 = await nein.start(einstellung({ name: 'RL', art: 'rl', rl: { minSicherheit: 0.6, erkunden: 0, nachschuss: true } }));
    await nein.schritt(11_000);
    expect(nein.entscheidungen(b2.id, 'buy')).toEqual([]);

    const unter = aufbau();
    unter.muster.modelleSetzen({ pump: fest(0.05) }, { version: 1, q: {}, einstieg: einstieg({ signal: 'pump', schwelle: 0.1 }) });
    const b3 = await unter.start(einstellung({ name: 'RL', art: 'rl', rl: { minSicherheit: 0.6, erkunden: 0, nachschuss: true } }));
    await unter.schritt(11_000);
    expect(unter.entscheidungen(b3.id, 'buy')).toEqual([]);
    for (const x of [ja, nein, unter]) x.werk.beenden();
  });
});
