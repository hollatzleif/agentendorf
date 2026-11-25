import { describe, expect, it } from 'vitest';
import { KRYPTO_STANDARD, type KryptoEinstellung, type KryptoMusterModellInfo, type KryptoMusterSchluessel } from '@dorf/shared';
import { TestUhr } from '../src/uhr.js';
import { Kryptowerk, kryptoDb, musterPunkte, type KDB } from '../src/krypto/motor.js';
import { einstellungPruefen } from '../src/krypto/einstellung.js';
import { MusterDienst, type Trainer } from '../src/krypto/muster/dienst.js';
import { MERKMAL_NAMEN } from '../src/krypto/muster/merkmale.js';
import type { GbdtModell, RlModell } from '../src/krypto/muster/typen.js';
import type { TrainingsErgebnis } from '../src/krypto/muster/training.js';
import { KURVE_DISKRIMINATOR, kurveLesen } from '../src/krypto/strom.js';
import type { DexScreener, RugCheck, Schnappschuss } from '../src/krypto/quellen.js';

/**
 * E236: Modelle je Schlüssel (Speichern/Laden, veraltete Merkmalsliste, einzeln ersetzen, RL-Übernahme, Status), Rat mit
 * 🚀/💥/Ausblick/Früh, RL-Bot über den Pump-Erkenner, Absturz-Sperre und -Ausstieg, musterGewicht mit allen Signalen.
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

const einstellung = (e: Partial<KryptoEinstellung> = {}): KryptoEinstellung => ({ ...structuredClone(KRYPTO_STANDARD), name: 'E236', ...e });
const rlEinstellung = (rl: KryptoEinstellung['rl'] = { minSicherheit: 0.6, erkunden: 0, nachschuss: true }) => einstellung({ name: 'RL', art: 'rl', rl });

function snap(mint: string, zeit: number, preis: number): Schnappschuss {
  return { mint, zeit, symbol: 'ECHT', name: 'Echt', dex: 'pumpfun', preisSol: preis, preisUsd: preis * 140, marktwertUsd: preis * 1e9 * 140, volumenUsdM5: 20_000, kaeufeM5: 80, verkaeufeM5: 30, aenderungM5: 12, aenderungH1: null, poolSol: null, poolToken: null };
}

/** GBDT ohne Bäume: Wahrscheinlichkeit p bzw. (quadratisch) Wert w */
const fest = (p: number, version = 1, merkmale = MERKMAL_NAMEN): GbdtModell => ({ version, merkmale, basis: Math.log(p / (1 - p)), lernrate: 1, baeume: [] });
const wert = (w: number, version = 1): GbdtModell => ({ version, merkmale: MERKMAL_NAMEN, basis: w, lernrate: 1, baeume: [], art: 'quadratisch' }) as GbdtModell;
const immerWarten = (): RlModell => ({ version: 1, q: new Proxy({}, { get: (_z, k) => (String(k).startsWith('h|') ? [1, 0, 0, 0] : [0, 1, 0, 0]) }) as Record<string, number[]> });

function info(schluessel: S, version: number, aktiv: boolean, o: { auc?: number; fehler?: number } = {}): KryptoMusterModellInfo {
  return { schluessel, version, trainiert: new Date(version * 1000).toISOString(), aktiv, gruende: aktiv ? [] : ['zu schwach'], beispiele: 1000, test: { beispiele: 300, tokens: 20, auc: o.auc ?? (o.fehler != null ? null : 0.6), aucUntergrenze: null, praezision: null, basis: 0.3, fehler: o.fehler ?? null, fehlerBasis: o.fehler != null ? o.fehler * 2 : null }, merkmale: [] };
}

/** Trainer, der je Lauf vorgegebene Modelle liefert und die Übergaben mitschreibt */
function trainerAus(laeufe: { aktiv: Partial<Record<S, boolean>>; rl?: boolean; merkmale?: string[] }[]) {
  const uebergaben: { alt: unknown; aktuelle: string[]; altAuc: unknown }[] = [];
  let n = 0;
  const trainer: Trainer = async (_d, o) => {
    const lauf = laeufe[n++]!;
    uebergaben.push({ alt: structuredClone(o.alt), aktuelle: Object.keys(o.aktuelle ?? {}).sort(), altAuc: o.altAuc });
    const modelle: TrainingsErgebnis['modelle'] = {};
    for (const [k, aktiv] of Object.entries(lauf.aktiv) as [S, boolean][]) {
      const wertModell = k.startsWith('hoch') || k.startsWith('tief');
      const g = wertModell ? { ...wert(10, o.version), ...(lauf.merkmale ? { merkmale: lauf.merkmale } : {}) } : fest(0.5, o.version, lauf.merkmale);
      modelle[k] = { gbdt: g, info: info(k, o.version, aktiv, wertModell ? { fehler: 5 + o.version } : { auc: 0.6 + o.version / 100 }) };
    }
    const b = modelle.basis;
    return {
      gbdt: b?.gbdt ?? null,
      rl: lauf.rl ? { version: o.version, q: {} } : null,
      modell: b ? { version: o.version, trainiert: b.info.trainiert, beispiele: 1000, positivAnteil: 0.3, test: { beispiele: 300, auc: b.info.test.auc!, praezision: null, basis: 0.3 }, aktiv: b.info.aktiv, merkmale: [] } : null,
      rlInfo: lauf.rl ? { version: o.version, trainiert: '', episoden: 10, zeitraffer: { trades: 1, gewinnSol: 0, trefferquote: null, pleiten: 0 } } : null,
      modelle,
      bericht: `Lauf ${o.version}`,
    } as TrainingsErgebnis;
  };
  return { trainer, uebergaben };
}

async function lauf(m: MusterDienst) {
  m.trainingStarten();
  await m.fertig();
  expect(m.status().training.fehler).toBeNull();
}
const schluessel = (m: MusterDienst) => Object.keys(m.gueltigeModelle()).sort();

describe('Muster-Dienst: Modelle je Schlüssel (E236)', () => {
  it('speichert jedes Modell einzeln, lädt nach Neustart die gültigen; Status.modelle in fester Reihenfolge; modell bleibt basis', async () => {
    const uhr = new TestUhr();
    const db = kryptoDb(':memory:');
    const { trainer } = trainerAus([{ aktiv: { hoch5: true, absturz: false, pump: true, basis: true }, rl: true }]);
    const m = new MusterDienst({ db, uhr, trainer });
    await lauf(m);
    expect(schluessel(m)).toEqual(['basis', 'hoch5', 'pump']);
    expect(m.aktiv).toBe(true);
    expect(m.rl).toMatchObject({ version: 1 });
    const st = m.status();
    expect(st.modelle!.map((x) => [x.schluessel, x.aktiv])).toEqual([
      ['basis', true],
      ['pump', true],
      ['absturz', false],
      ['hoch5', true],
    ]);
    expect(st.modell).toMatchObject({ version: 1, aktiv: true });
    expect(db.prepare('SELECT schluessel, version, aktiv FROM muster_einzel ORDER BY schluessel').all()).toEqual([
      { schluessel: 'absturz', version: 1, aktiv: 0 },
      { schluessel: 'basis', version: 1, aktiv: 1 },
      { schluessel: 'hoch5', version: 1, aktiv: 1 },
      { schluessel: 'pump', version: 1, aktiv: 1 },
    ]);
    const m2 = new MusterDienst({ db, uhr });
    expect(schluessel(m2)).toEqual(['basis', 'hoch5', 'pump']);
    expect(m2.rl).toMatchObject({ version: 1 });
    expect(m2.status().modelle!.map((x) => [x.schluessel, x.aktiv])).toEqual(st.modelle!.map((x) => [x.schluessel, x.aktiv]));
    expect(m2.status().modell).toMatchObject({ version: 1, aktiv: true, positivAnteil: 0.3 });
    expect(m2.status().bericht).toBe('Lauf 1');
  });

  it('veraltete Merkmalsliste wird nicht geladen (auch nicht aus dem Altbestand E235); passende Altbestände schon', () => {
    const uhr = new TestUhr();
    const db = kryptoDb(':memory:');
    const alt = fest(0.7, 1, ['rendite10s', 'rendite30s']);
    db.prepare('INSERT INTO muster_einzel (schluessel, version, erstellt, gbdt_json, info_json, aktiv) VALUES (?, ?, ?, ?, ?, 1)').run('pump', 1, 0, JSON.stringify(alt), JSON.stringify(info('pump', 1, true)));
    const basisInfo = { version: 1, trainiert: '', beispiele: 1, positivAnteil: 0.2, test: { beispiele: 300, auc: 0.6, praezision: null, basis: 0.2 }, aktiv: true, merkmale: [] };
    db.prepare("INSERT INTO muster_modelle (version, erstellt, gbdt_json, rl_json, modell_json, rl_info_json, bericht, aktiv) VALUES (1, 0, ?, ?, ?, NULL, 'alt', 1)").run(JSON.stringify(alt), JSON.stringify({ version: 1, q: {} }), JSON.stringify(basisInfo));
    const m = new MusterDienst({ db, uhr });
    expect(m.signaleAktiv).toBe(false);
    expect(m.aktiv).toBe(false);
    // RL-Agent ohne gültiges Wahrscheinlichkeits-Modell wird nicht geladen
    expect(m.rl).toBeNull();
    expect(m.status().modelle).toEqual([{ ...info('pump', 1, true), aktiv: false }]);
    expect(m.status().modell).toMatchObject({ version: 1, aktiv: false });
    // E235-Altbestand mit passender Merkmalsliste gilt weiter als basis (samt RL-Agent, Migration: rl_aktiv = aktiv)
    const db2 = kryptoDb(':memory:');
    db2.prepare("INSERT INTO muster_modelle (version, erstellt, gbdt_json, rl_json, modell_json, rl_info_json, bericht, aktiv, rl_aktiv) VALUES (1, 0, ?, ?, ?, NULL, 'alt', 1, 1)").run(JSON.stringify(fest(0.7)), JSON.stringify({ version: 1, q: {} }), JSON.stringify(basisInfo));
    const m2 = new MusterDienst({ db: db2, uhr });
    expect(m2.aktiv).toBe(true);
    expect(m2.rl).toMatchObject({ version: 1 });
    expect(m2.status().modell).toMatchObject({ version: 1, aktiv: true, positivAnteil: 0.2 });
    expect(m2.status().modelle!.map((x) => x.schluessel)).toEqual(['basis']);
  });

  it('ersetzt einzeln: pump neu aktiv, basis bleibt alt; alt/aktuelle gehen an den Trainer', async () => {
    const uhr = new TestUhr();
    const db = kryptoDb(':memory:');
    const { trainer, uebergaben } = trainerAus([
      { aktiv: { basis: true, pump: false, tief5: true } },
      { aktiv: { basis: false, pump: true, tief5: false } },
    ]);
    const m = new MusterDienst({ db, uhr, trainer });
    await lauf(m);
    await lauf(m);
    const g = m.gueltigeModelle();
    expect(g.basis!.version).toBe(1);
    expect(g.pump!.version).toBe(2);
    expect(g.tief5!.version).toBe(1);
    expect(uebergaben[0]).toEqual({ alt: {}, aktuelle: [], altAuc: null });
    expect(uebergaben[1]).toEqual({ alt: { basis: { auc: 0.61, fehler: null, version: 1 }, tief5: { auc: null, fehler: 6, version: 1 } }, aktuelle: ['basis', 'tief5'], altAuc: 0.61 }); // E238: mit version (Konsole: „ersetzt v1“)
    const st = m.status();
    expect(st.modell).toMatchObject({ version: 1, aktiv: true });
    expect(st.modelle!.map((x) => [x.schluessel, x.version, x.aktiv])).toEqual([
      ['basis', 1, true],
      ['pump', 2, true],
      ['tief5', 1, true],
    ]);
    expect(st.bericht).toMatch(/bisherige Modell v1 .* bleibt aktiv/);
    expect(st.bericht).toMatch(/Weiter gültig .*Tief in 5 min.* v1/);
    // nach Neustart dieselben
    const m2 = new MusterDienst({ db, uhr });
    expect(Object.fromEntries(Object.entries(m2.gueltigeModelle()).map(([k, v]) => [k, v.version]))).toEqual({ basis: 1, pump: 2, tief5: 1 });
  });

  it('RL-Agent nur, wenn danach ein Wahrscheinlichkeits-Modell gültig ist; aufgeräumt wird je Schlüssel auf 10 + das gültige', async () => {
    const uhr = new TestUhr();
    const db = kryptoDb(':memory:');
    const laeufe: { aktiv: Partial<Record<S, boolean>>; rl?: boolean }[] = [
      { aktiv: { hoch5: true, basis: false }, rl: true },
      { aktiv: { pump: true }, rl: true },
      ...Array.from({ length: 12 }, () => ({ aktiv: { pump: false, basis: false }, rl: true })),
    ];
    const { trainer } = trainerAus(laeufe);
    const m = new MusterDienst({ db, uhr, trainer });
    await lauf(m);
    expect(m.rl).toBeNull();
    expect(m.signaleAktiv).toBe(true);
    expect(m.rlBereit).toBe(false);
    await lauf(m);
    expect(m.rl).toMatchObject({ version: 2 });
    expect(m.rlBereit).toBe(true);
    expect(m.aktiv).toBe(false);
    // weitere Läufe: pump bleibt gültig (v2), RL wechselt (ein Wahrscheinlichkeits-Modell ist ja gültig)
    for (let i = 0; i < 12; i++) await lauf(m);
    expect(m.gueltigeModelle().pump!.version).toBe(2);
    expect(m.rl).toMatchObject({ version: 14 });
    const pumpVersionen = (db.prepare("SELECT version FROM muster_einzel WHERE schluessel = 'pump' ORDER BY version").all() as { version: number }[]).map((z) => z.version);
    expect(pumpVersionen).toEqual([2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect((db.prepare("SELECT COUNT(*) AS n FROM muster_einzel WHERE schluessel = 'basis'").get() as { n: number }).n).toBe(10);
    const m2 = new MusterDienst({ db, uhr });
    expect(m2.rl).toMatchObject({ version: 14 });
    expect(m2.status().modelle!.map((x) => [x.schluessel, x.version, x.aktiv])).toEqual([
      ['basis', 14, false],
      ['pump', 2, true],
      ['hoch5', 1, true],
    ]);
  });
});

function aufbau() {
  const uhr = new TestUhr();
  const db: KDB = kryptoDb(':memory:');
  const dex = { async paare(m: string[]) { return { schnappschuesse: m.map((x) => snap(x, uhr.jetzt(), 4e-8)), solUsd: 140 }; } } as unknown as DexScreener;
  const rug = { bereit: () => true, async bericht() { return { zeit: uhr.jetzt(), scoreNormiert: 5, risiken: [] }; } } as unknown as RugCheck;
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
  return { uhr, db, werk, muster, schritt, neu, ticks };
}

describe('Rat im Terminal (E236)', () => {
  it('Rat auch nur mit 🚀/💥: pump, absturz, Ausblick, rat über ratAus; Früh-Modell bei jungen Tokens', async () => {
    const x = aufbau();
    const bot = x.werk.anlegen(einstellung());
    x.neu();
    x.ticks();
    x.muster.modelleSetzen({ pump: fest(0.4), absturz: fest(0.1), hoch5: wert(30), tief5: wert(-12) });
    expect(x.muster.aktiv).toBe(false);
    const rat = x.werk.terminal(bot.id).musterRat!;
    expect(rat).toHaveLength(1);
    expect(rat[0]).toMatchObject({ mint: MINT, rat: 'kaufen', wahrscheinlichkeit: null, frueh: false, ausblick: { hoch1: null, tief1: null, hoch5: 30, tief5: -12 } });
    expect(rat[0]!.pump).toBeCloseTo(0.4, 6);
    expect(rat[0]!.absturz).toBeCloseTo(0.1, 6);
    expect(x.werk.musterP(MINT)).toBeNull();
    // Absturz hoch → kein Kauf-Rat; Früh-Modell übernimmt bei jungem Token (E237: 🚀 unter 40 %, sonst wäre es ein Alarm)
    x.muster.modelleSetzen({ absturz: fest(0.5), fruehPump: fest(0.35) });
    x.uhr.vor(2000);
    const r2 = x.werk.terminal(bot.id).musterRat![0]!;
    expect(r2.rat).toBe('halten');
    expect(r2.alarm).toBeNull();
    expect(r2.frueh).toBe(true);
    expect(r2.pump).toBeCloseTo(0.35, 6);
    // ohne jedes Modell: kein Rat
    x.muster.modelleSetzen({ pump: null, absturz: null, hoch5: null, tief5: null, fruehPump: null });
    x.uhr.vor(2000);
    expect(x.werk.terminal(bot.id).musterRat).toEqual([]);
    x.werk.beenden();
  });
});

describe('RL-Bot mit allen Signalen (E236)', () => {
  async function rlStart(x: ReturnType<typeof aufbau>, e = rlEinstellung()) {
    const bot = x.werk.anlegen(e);
    x.neu();
    x.uhr.vor(68_000);
    x.ticks();
    await x.schritt(1000);
    return bot;
  }

  it('kauft über den Pump-Erkenner ohne Grundsignal (p zählt als 0)', async () => {
    const x = aufbau();
    // E237: 🚀 unter 40 % – ab 40 % kauft schon der Alarm (e237-alarm-werk.test.ts)
    x.muster.modelleSetzen({ pump: fest(0.35) });
    const bot = await rlStart(x);
    const kauf = x.werk.protokoll(bot.id).entscheidungen.find((z) => z.aktion === 'buy')!;
    expect(kauf).toMatchObject({ quelle: 'modell', mint: MINT });
    expect(kauf.grund).toMatch(/^RL: kaufen · 🚀 Pump 35 % ≥ 30 %/);
    expect(kauf.sicherheit).toBeCloseTo(0.35, 6);
    await x.schritt(2000);
    expect(x.werk.terminal(bot.id).lage).toBe('LONG');
    x.werk.beenden();
  });

  it('kauft nicht bei 💥 ≥ maxAbsturz (Standard 0,35; eigene Grenze aus der Einstellung)', async () => {
    const x = aufbau();
    x.muster.modelleSetzen({ basis: fest(0.9), absturz: fest(0.4) });
    const bot = await rlStart(x);
    await x.schritt(2000);
    expect(x.werk.protokoll(bot.id).entscheidungen.some((z) => z.aktion === 'buy')).toBe(false);
    expect(x.werk.terminal(bot.id).module.find((m) => m.schluessel === 'volumen')!.zeile).toMatch(/💥 40 % ≥ 35 % – kein Kauf/);
    // Grenze 0,5 → 40 % reicht nicht zum Sperren
    const y = aufbau();
    y.muster.modelleSetzen({ basis: fest(0.9), absturz: fest(0.4) });
    const bot2 = await rlStart(y, rlEinstellung({ minSicherheit: 0.6, erkunden: 0, nachschuss: true, maxAbsturz: 0.5 }));
    const kauf = y.werk.protokoll(bot2.id).entscheidungen.find((z) => z.aktion === 'buy')!;
    expect(kauf.grund).toMatch(/^RL: kaufen · Muster 90 % ≥ 60 % · 💥 40 %/);
    x.werk.beenden();
    y.werk.beenden();
  });

  it('gehalten und 💥 ≥ 70 % → sofort raus („Absturz-Erkenner 75 %“, quelle modell), auch wenn der Agent warten will', async () => {
    const x = aufbau();
    x.muster.modelleSetzen({ basis: fest(0.9) }, immerWarten());
    const bot = await rlStart(x);
    await x.schritt(2000);
    expect(x.werk.terminal(bot.id).lage).toBe('LONG');
    x.muster.modelleSetzen({ absturz: fest(0.75) });
    x.uhr.vor(2000);
    x.ticks();
    const sell = x.werk.protokoll(bot.id).entscheidungen.filter((z) => z.aktion === 'sell');
    expect(sell).toHaveLength(1);
    expect(sell[0]).toMatchObject({ quelle: 'modell' });
    expect(sell[0]!.grund).toMatch(/^Absturz-Erkenner 75 %/);
    await x.schritt(2000);
    expect(x.werk.terminal(bot.id).lage).toBe('FLAT');
    x.werk.beenden();
  });
});

describe('Andere Bots: Absturz-Ausstieg nur mit musterGewicht > 0, Punkte mit allen Signalen (E236)', () => {
  async function regelLauf(gewicht: number) {
    const x = aufbau();
    const bot = x.werk.anlegen(einstellung({ regeln: { minPunkte: 0, musterGewicht: gewicht } }));
    x.neu();
    x.uhr.vor(68_000);
    x.ticks();
    await x.schritt(1000);
    await x.schritt(2000);
    expect(x.werk.terminal(bot.id).lage).toBe('LONG');
    x.muster.modelleSetzen({ absturz: fest(0.75) });
    x.uhr.vor(2000);
    x.ticks();
    await x.schritt(1000);
    const sell = x.werk.protokoll(bot.id).entscheidungen.filter((z) => z.aktion === 'sell');
    const rat = x.werk.terminal(bot.id).musterRat!;
    x.werk.beenden();
    return { sell, rat };
  }

  it('musterGewicht 0: 💥 wird nur angezeigt, kein Verkauf', async () => {
    const r = await regelLauf(0);
    expect(r.sell).toEqual([]);
    expect(r.rat[0]).toMatchObject({ rat: 'raus' });
  });

  it('musterGewicht > 0: 💥 ≥ 70 % verkauft', async () => {
    const r = await regelLauf(10);
    expect(r.sell).toHaveLength(1);
    expect(r.sell[0]).toMatchObject({ quelle: 'modell' });
    expect(r.sell[0]!.grund).toMatch(/^Absturz-Erkenner 75 %/);
  });

  it('Punkte: Gewicht × clamp((p − 0,5)·2 + 🚀 − 💥, −1, 1); fehlende Signale neutral; Zeile mit allen aktiven', async () => {
    expect(musterPunkte({ p: 0.25, pump: null, absturz: null }, 30)).toBe(-15);
    expect(musterPunkte({ p: 0.25, pump: 0.4, absturz: 0.1 }, 30)).toBe(-6);
    expect(musterPunkte({ p: null, pump: 0.4, absturz: null }, 20)).toBe(8);
    expect(musterPunkte({ p: null, pump: null, absturz: 0.9 }, 10)).toBe(-9);
    expect(musterPunkte({ p: 0.95, pump: 0.8, absturz: 0 }, 10)).toBe(10);
    expect(musterPunkte({ p: 0.5, pump: null, absturz: null }, 30)).toBe(0);
    const lauf = async (gewicht: number, modelle?: Partial<Record<S, GbdtModell>>) => {
      const x = aufbau();
      if (modelle) x.muster.modelleSetzen(modelle);
      const bot = x.werk.anlegen(einstellung({ regeln: { minPunkte: 100, musterGewicht: gewicht } }));
      x.neu();
      x.uhr.vor(68_000);
      x.ticks();
      await x.schritt(1000);
      const e = x.werk.protokoll(bot.id).entscheidungen.find((z) => z.mint === MINT)!;
      const vol = x.werk.terminal(bot.id).module.find((m) => m.schluessel === 'volumen')!.zeile;
      x.werk.beenden();
      return { punkte: Math.round(e.sicherheit! * 100), vol };
    };
    const ohne = await lauf(0);
    // E237: 🚀 unter 40 % – ab 40 % kauft bei musterGewicht > 0 der Alarm (e237-alarm-werk.test.ts)
    const mit = await lauf(30, { basis: fest(0.25), pump: fest(0.38), absturz: fest(0.1) });
    expect(mit.punkte).toBe(ohne.punkte - 7);
    // die Terminal-Zeile ist auf 60 Zeichen gekürzt – die Punkte stehen oben
    expect(mit.vol).toMatch(/Muster p 25 % · 🚀 38 % · 💥 10 %/);
    const nurPump = await lauf(20, { pump: fest(0.38) });
    expect(nurPump.punkte).toBe(ohne.punkte + 8);
    expect(nurPump.vol).toMatch(/Muster 🚀 38 % \+8/);
  });
});

describe('LLM-Daten und Einstellung (E236)', () => {
  it('Prompt-Bots bekommen die Muster-Signale mit, wenn vorhanden', async () => {
    const x = aufbau();
    const anfragen: Record<string, unknown>[] = [];
    const werk = new Kryptowerk({
      db: x.db,
      uhr: x.uhr,
      dex: { async paare(m: string[]) { return { schnappschuesse: m.map((y) => snap(y, x.uhr.jetzt(), 4e-8)), solUsd: 140 }; } } as unknown as DexScreener,
      rug: { bereit: () => true, async bericht() { return { zeit: x.uhr.jetzt(), scoreNormiert: 5, risiken: [] }; } } as unknown as RugCheck,
      muster: x.muster,
      llm: async (a) => (anfragen.push(a.daten), { action: 'hold', token: MINT, confidence: 0.1, reason: 'nein' }),
    });
    x.muster.modelleSetzen({ pump: fest(0.4) });
    werk.anlegen(einstellung({ art: 'prompt', prompt: 'Kaufe nur starke Tokens mit viel Volumen.' }));
    werk.neuerToken({ mint: MINT, txType: 'create', initialBuy: 20_000_000, solAmount: 0.6, name: 'Echt', symbol: 'ECHT' } as never, x.uhr.jetzt());
    x.uhr.vor(68_000);
    for (const d of [-0.4, -0.2, 0]) {
      werk.kurveTick(MINT, stand(40 + d), x.uhr.jetzt());
      x.uhr.vor(500);
    }
    x.uhr.vor(1000);
    await werk.takt();
    await new Promise((r) => setImmediate(r));
    expect(anfragen).toHaveLength(1);
    expect(anfragen[0]!.muster).toMatchObject({ p: null, absturz: null, frueh: false });
    expect((anfragen[0]!.muster as { pump: number }).pump).toBeCloseTo(0.4, 6);
    werk.beenden();
    x.werk.beenden();
  });

  it('rl.maxAbsturz 0–1 (optional, alte rl-Objekte ohne Feld gültig)', () => {
    expect(einstellungPruefen({ ...KRYPTO_STANDARD, art: 'rl', rl: { minSicherheit: 0.6, erkunden: 0, nachschuss: true } }).rl).toEqual({ minSicherheit: 0.6, erkunden: 0, nachschuss: true });
    expect(einstellungPruefen({ ...KRYPTO_STANDARD, art: 'rl', rl: { minSicherheit: 0.6, erkunden: 0, nachschuss: true, maxAbsturz: 0.5 } }).rl!.maxAbsturz).toBe(0.5);
    expect(() => einstellungPruefen({ ...KRYPTO_STANDARD, art: 'rl', rl: { minSicherheit: 0.6, erkunden: 0, nachschuss: true, maxAbsturz: 1.2 } })).toThrow();
  });
});
