import { describe, expect, it } from 'vitest';
import { type KryptoMusterModellInfo, type KryptoMusterSchluessel, type KryptoMusterStatus, type KryptoMusterVerlauf } from '@dorf/shared';
import { TestUhr } from '../src/uhr.js';
import { Kryptowerk, kryptoDb } from '../src/krypto/motor.js';
import { kryptoServer } from '../src/krypto/server.js';
import { MusterDienst, type Trainer } from '../src/krypto/muster/dienst.js';
import { gbdtTrainieren } from '../src/krypto/muster/gbdt.js';
import { MERKMAL_NAMEN } from '../src/krypto/muster/merkmale.js';
import { zufallAus } from '../src/krypto/muster/rl.js';
import { RL_BEISPIELE_APP, RL_KURVE_PUNKTE, kapitalKurve, musterTrainieren, type TrainingsDaten, type TrainingsErgebnis } from '../src/krypto/muster/training.js';
import type { GbdtModell, Tick, TokenMeta } from '../src/krypto/muster/typen.js';
import type { DexScreener, RugCheck } from '../src/krypto/quellen.js';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';

/**
 * E239: Muster-Kielwasser – Lernkurve je Modell (gbdtTrainieren mit `kurve`, ohne das Modell zu ändern), RL-Zeitraffer mit
 * Kapitalkurve und strukturierten Beispiel-Trades, Verlauf über die Trainings (GET /muster/verlauf) und die Dorf-Durchreiche.
 */
const T0 = Date.UTC(2026, 10, 24, 12, 0, 0);

/** wie in e238: Zufallsweg, bei `muster` Pump-Schwälle mit echtem Nachlauf */
function markt(tokens: number, z: () => number, minuten = 25, abstand = 45_000): TrainingsDaten {
  const ticks = new Map<string, Tick[]>();
  const meta = new Map<string, TokenMeta>();
  for (let k = 0; k < tokens; k++) {
    const mint = `T${k}pump`;
    const start = T0 + k * abstand;
    meta.set(mint, { mint, erstellt: start - 10_000, devTokens24h: Math.floor(z() * 3) });
    const liste: Tick[] = [];
    let preis = 1e-7;
    let echt = 3;
    let pumpBis = 0;
    let nachlauf = 0;
    for (let t = start; t < start + minuten * 60_000; t += 1000) {
      if (pumpBis < t && nachlauf <= 0 && z() < 0.002) pumpBis = t + 20_000;
      let sol: number;
      let r: number;
      if (t < pumpBis) {
        sol = 1 + z() * 2;
        r = 0.004 + z() * 0.004;
        if (pumpBis - t <= 1000) nachlauf = 90;
      } else if (nachlauf > 0) {
        nachlauf--;
        sol = (z() - 0.3) * 1.2;
        r = 0.0045 + (z() - 0.5) * 0.01;
      } else {
        sol = (z() - 0.5) * 1.2;
        r = (z() - 0.5) * 0.016;
      }
      preis *= 1 + r;
      echt = Math.max(0.1, echt + sol);
      liste.push({ zeit: t, preis, sol, echtSol: echt });
    }
    ticks.set(mint, liste);
  }
  return { ticks, meta };
}
const ZIEL = { zielProzent: 10, stopProzent: 10, horizontMs: 60_000 };
const JETZT = T0 + 60 * 45_000 + 30 * 60_000;

describe('Lernkurve im GBDT (E239)', () => {
  const z = zufallAus(5);
  const X = Array.from({ length: 3000 }, () => [z(), z(), z()]);
  const y = X.map((x) => (x[0]! + 0.3 * z() > 0.65 ? 1 : 0));
  const lern = Array.from({ length: 2400 }, (_, i) => i);
  const test = Array.from({ length: 600 }, (_, i) => 2400 + i);

  it('schreibt Lern-/Test-Verlust nach Baum 1, alle 5 Bäume und nach dem letzten – Modell bleibt gleich', async () => {
    const ohne = await gbdtTrainieren(X, y, { baeume: 23, auswahl: lern });
    const mit = await gbdtTrainieren(X, y, { baeume: 23, auswahl: lern, kurve: { auswahl: test, y: test.map((i) => y[i]!), alle: 5 } });
    expect(JSON.stringify(mit.modell)).toBe(JSON.stringify(ohne.modell));
    expect(mit.wichtigkeit).toEqual(ohne.wichtigkeit);
    expect(ohne.lernkurve).toBeUndefined();
    expect(mit.lernkurve!.map((p) => p.baum)).toEqual([1, 5, 10, 15, 20, 23]);
    const k = mit.lernkurve!;
    // Lernverlust sinkt (logistisch), Test hat Werte
    expect(k.at(-1)!.lern).toBeLessThan(k[0]!.lern);
    expect(k.every((p) => p.test != null && p.test > 0)).toBe(true);
    expect(k.at(-1)!.test!).toBeLessThan(k[0]!.test!);
  });

  it('asymmetrisch: Verlust wie asymVerlust, ohne Testzeilen test = null', async () => {
    const yw = X.map((x) => x[1]! * 10 - 5);
    const r = await gbdtTrainieren(X, yw, { baeume: 6, art: 'asymmetrisch', auswahl: lern, kurve: { auswahl: [], y: [] } });
    expect(r.lernkurve!.map((p) => p.baum)).toEqual([1, 5, 6]);
    expect(r.lernkurve!.every((p) => p.test === null && p.lern > 0)).toBe(true);
  });
});

describe('Training: Lernkurve + RL-Zeitraffer strukturiert (E239)', () => {
  it('jedes trainierte Modell hat eine Lernkurve, rlInfo eine Kapitalkurve und Beispiel-Trades; mit und ohne log gleich', async () => {
    const d = markt(60, zufallAus(21));
    const erg = await musterTrainieren(d, { jetzt: JETZT, version: 3, ziel: ZIEL, abgeben: async () => {} });
    const basis = erg.modelle.basis!.info;
    expect(basis.lernkurve!.length).toBeGreaterThan(5);
    expect(basis.lernkurve![0]!.baum).toBe(1);
    expect(basis.lernkurve!.at(-1)!.baum).toBe(80);
    expect(basis.lernkurve!.at(-1)!.lern).toBeLessThan(basis.lernkurve![0]!.lern);
    expect(basis.lernkurve!.every((p) => typeof p.test === 'number')).toBe(true);
    expect(erg.modelle.verlauf1m!.info.lernkurve!.at(-1)!.baum).toBe(40);

    const rl = erg.rlInfo!;
    expect(rl.startSol).toBe(10);
    expect(rl.einsatzSol).toBe(0.5);
    const kurve = rl.kurve!;
    expect(kurve.length).toBe(Math.min(rl.zeitraffer.trades, RL_KURVE_PUNKTE));
    expect(rl.zeitraffer.trades).toBeGreaterThan(0);
    for (let i = 1; i < kurve.length; i++) expect(kurve[i]!.zeit).toBeGreaterThanOrEqual(kurve[i - 1]!.zeit);
    expect(kurve.at(-1)!.kapitalSol).toBeCloseTo(10 + rl.zeitraffer.gewinnSol, 2);
    const b = rl.beispiele!;
    expect(b.length).toBe(Math.min(RL_BEISPIELE_APP, rl.zeitraffer.trades));
    expect(b[0]!.kauf).toMatchObject({ handlung: 'kaufen', grund: expect.stringMatching(/^(q|regel|sicherung)$/) });
    expect(b[0]!.kauf.lage.p).toEqual(expect.any(Number));
    expect(b[0]!.kauf.lage.haltSek).toBeNull();
    expect(b[0]!.ende).toBeGreaterThanOrEqual(b[0]!.kauf.zeit);
    expect(b[0]!.mint).toMatch(/^T\d+pump$/);
    expect(b.some((t) => t.verkauf && t.verkauf.lage.haltSek != null)).toBe(true);

    // mit Konsole: dasselbe Ergebnis (Lernkurve und Kurve hängen nicht am log)
    const mitLog = await musterTrainieren(d, { jetzt: JETZT, version: 3, ziel: ZIEL, abgeben: async () => {}, log: () => {} });
    expect(mitLog.rlInfo).toEqual(erg.rlInfo);
    expect(JSON.stringify(mitLog.modelle)).toBe(JSON.stringify(erg.modelle));
  }, 120_000);

  it('kapitalKurve: zeitlich sortiert, kumuliert, ausgedünnt mit dem letzten Punkt', () => {
    const a = [
      { zeit: 30, gewinnSol: 1 },
      { zeit: 10, gewinnSol: -0.5 },
      { zeit: 20, gewinnSol: 0.25 },
    ];
    expect(kapitalKurve(a, 10, 300)).toEqual([
      { zeit: 10, kapitalSol: 9.5 },
      { zeit: 20, kapitalSol: 9.75 },
      { zeit: 30, kapitalSol: 10.75 },
    ]);
    const viele = Array.from({ length: 1000 }, (_, i) => ({ zeit: i, gewinnSol: 0.01 }));
    const k = kapitalKurve(viele, 10, 300);
    expect(k).toHaveLength(300);
    expect(k.at(-1)).toEqual({ zeit: 999, kapitalSol: 20 });
  });
});

// ---- Dienst + API ----------------------------------------------------------------------------------------------------

const fest = (version: number): GbdtModell => ({ version, merkmale: MERKMAL_NAMEN, basis: 0, lernrate: 1, baeume: [] });
function info(schluessel: KryptoMusterSchluessel, version: number, aktiv: boolean, auc = 0.6): KryptoMusterModellInfo {
  const wert = !['basis', 'pump', 'absturz', 'fruehPump', 'fruehAbsturz'].includes(schluessel);
  return {
    schluessel,
    version,
    trainiert: '',
    aktiv,
    gruende: aktiv ? [] : ['zu schwach'],
    beispiele: 1000,
    test: { beispiele: 300, tokens: 20, auc: wert ? null : auc, aucUntergrenze: wert ? null : auc - 0.05, praezision: null, basis: 0.3, fehler: wert ? 4 : null, fehlerBasis: wert ? 5 : null },
    merkmale: [{ name: 'rendite_30s', wichtigkeit: 0.4 }],
    lernkurve: [
      { baum: 1, lern: 0.6, test: 0.62 },
      { baum: 5, lern: 0.5, test: 0.58 },
    ],
  };
}
function ergebnis(version: number, aktiv: Partial<Record<KryptoMusterSchluessel, boolean>>): TrainingsErgebnis {
  const modelle: TrainingsErgebnis['modelle'] = {};
  for (const [k, a] of Object.entries(aktiv) as [KryptoMusterSchluessel, boolean][]) modelle[k] = { gbdt: fest(version), info: info(k, version, a, 0.55 + version / 100) };
  const rlInfo: NonNullable<KryptoMusterStatus['rl']> = {
    version,
    trainiert: '',
    episoden: 10,
    zeitraffer: { trades: 2, gewinnSol: 0.3, trefferquote: 0.5, pleiten: 0 },
    startSol: 10,
    einsatzSol: 0.5,
    kurve: [
      { zeit: T0, kapitalSol: 9.9 },
      { zeit: T0 + 60_000, kapitalSol: 10.3 },
    ],
    beispiele: [],
  };
  return { gbdt: null, rl: { version, q: {} }, modell: null, rlInfo, modelle, bericht: `Lauf ${version}` };
}

describe('Muster-Dienst: Verlauf (E239)', () => {
  it('je Lauf Test-Werte und Entscheidung (übernommen / behält vN / nicht aktiv / nicht trainiert), Einzelheiten eines Laufs; Status ohne Lernkurve/Kurve', async () => {
    const uhr = new TestUhr();
    const db = kryptoDb(':memory:');
    const plan: Partial<Record<KryptoMusterSchluessel, boolean>>[] = [{ basis: true, pump: false }, { basis: false, pump: true, hoch1: false }, { basis: true }];
    let n = 0;
    const trainer: Trainer = async (_d, o) => ergebnis(o.version, plan[n++]!);
    const m = new MusterDienst({ db, uhr, trainer });
    expect(m.verlaufLesen()).toEqual({ laeufe: [], lauf: null });
    for (let i = 0; i < 3; i++) {
      m.trainingStarten();
      await m.fertig();
    }
    const v = m.verlaufLesen();
    expect(v.laeufe.map((l) => l.version)).toEqual([3, 2, 1]);
    const [l3, l2, l1] = v.laeufe;
    expect(l1!.modelle.basis).toMatchObject({ entscheidung: 'uebernommen', aktiv: true, auc: 0.56 });
    expect(l1!.modelle.pump).toMatchObject({ entscheidung: 'nicht_aktiv', aktiv: false });
    expect(l1!.modelle.pump!.grund).toMatch(/zu schwach/);
    expect(l1!.modelle.hoch1).toMatchObject({ entscheidung: 'nicht_trainiert' });
    expect(l2!.modelle.basis).toMatchObject({ entscheidung: 'behaelt', behaeltVersion: 1 });
    expect(l2!.modelle.pump).toMatchObject({ entscheidung: 'uebernommen' });
    expect(l2!.modelle.hoch1).toMatchObject({ entscheidung: 'nicht_aktiv', fehler: 4, fehlerBasis: 5 });
    expect(l3!.modelle.basis).toMatchObject({ entscheidung: 'uebernommen', auc: expect.closeTo(0.58, 6) });
    expect(l3!.modelle.pump).toMatchObject({ entscheidung: 'nicht_trainiert', behaeltVersion: 2 });
    expect(l3!.aktivGeworden).toEqual(['basis', 'rl']);
    expect(l3!.rl).toEqual({ trades: 2, gewinnSol: 0.3, trefferquote: 0.5, pleiten: 0 });
    // Einzelheiten: neuester Lauf; ältere über version
    expect(v.lauf!.version).toBe(3);
    expect(v.lauf!.modelle.map((x) => x.schluessel)).toEqual(['basis']);
    expect(v.lauf!.modelle[0]!.lernkurve).toHaveLength(2);
    expect(v.lauf!.rl!.kurve).toHaveLength(2);
    const v2 = m.verlaufLesen({ version: 2 });
    expect(v2.lauf!.modelle.map((x) => x.schluessel)).toEqual(['basis', 'pump', 'hoch1']);
    expect(() => m.verlaufLesen({ version: 99 })).toThrow(/nicht \(mehr\) im Protokoll/);
    // Status bleibt schlank
    const s = m.status();
    expect(s.rl!.kurve).toBeUndefined();
    expect(s.rl!.beispiele).toBeUndefined();
    expect(s.modelle!.every((x) => x.lernkurve === undefined)).toBe(true);
  });

  it('laufendes Training steht oben (ohne Modelle), fehlgeschlagene mit fehler; alte Läufe ohne neue Felder bleiben lesbar', async () => {
    const uhr = new TestUhr();
    const db = kryptoDb(':memory:');
    let los: (() => void) | null = null;
    let n = 0;
    const trainer: Trainer = async (_d, o) => {
      n++;
      if (n === 2) throw new Error('kaputt');
      if (n === 3) await new Promise<void>((r) => (los = r));
      const e = ergebnis(o.version, { basis: true });
      // wie vor E239: ohne Lernkurve, ohne Kurve
      delete e.modelle.basis!.info.lernkurve;
      e.rlInfo = { version: o.version, trainiert: '', episoden: 1, zeitraffer: { trades: 0, gewinnSol: 0, trefferquote: null, pleiten: 0 } };
      return e;
    };
    const m = new MusterDienst({ db, uhr, trainer });
    m.trainingStarten();
    await m.fertig();
    m.trainingStarten();
    await m.fertig();
    m.trainingStarten();
    for (let i = 0; i < 1000 && !los; i++) await new Promise((r) => setImmediate(r));
    const v = m.verlaufLesen();
    expect(v.laeufe.map((l) => [l.version, !!l.laeuft, l.fehler])).toEqual([
      [3, true, null],
      [2, false, 'kaputt'],
      [1, false, null],
    ]);
    expect(v.laeufe[0]!.modelle).toEqual({});
    expect(v.laeufe[1]!.modelle).toEqual({});
    // Einzelheiten: der neueste gespeicherte (nicht der laufende, nicht der fehlgeschlagene)
    expect(v.lauf!.version).toBe(1);
    expect(v.lauf!.modelle[0]!.lernkurve).toBeUndefined();
    expect(v.lauf!.rl!.kurve).toBeUndefined();
    expect(m.verlaufLesen({ version: 3 }).lauf).toBeNull();
    los!();
    await m.fertig();
  });

  it('Kryptowerk-API GET /muster/verlauf: Bearer, version, 404, 400, 503 ohne Dienst', async () => {
    const uhr = new TestUhr();
    const db = kryptoDb(':memory:');
    const muster = new MusterDienst({ db, uhr, trainer: async (_d, o) => ergebnis(o.version, { basis: true }) });
    const werk = new Kryptowerk({ db, uhr, dex: {} as DexScreener, rug: { bereit: () => false } as unknown as RugCheck, muster });
    const geheim = 'g'.repeat(40);
    const app = kryptoServer(werk, geheim, undefined, muster);
    const auth = { authorization: `Bearer ${geheim}` };
    expect((await app.inject({ url: '/muster/verlauf' })).statusCode).toBe(401);
    muster.trainingStarten();
    await muster.fertig();
    muster.trainingStarten();
    await muster.fertig();
    const a = (await app.inject({ url: '/muster/verlauf', headers: auth })).json() as KryptoMusterVerlauf;
    expect(a.laeufe.map((l) => l.version)).toEqual([2, 1]);
    expect(a.lauf!.version).toBe(2);
    const b = (await app.inject({ url: '/muster/verlauf?version=1', headers: auth })).json() as KryptoMusterVerlauf;
    expect(b.lauf!.version).toBe(1);
    expect((await app.inject({ url: '/muster/verlauf?version=9', headers: auth })).statusCode).toBe(404);
    expect((await app.inject({ url: '/muster/verlauf?version=abc', headers: auth })).statusCode).toBe(400);
    const ohne = kryptoServer(werk, geheim);
    expect((await ohne.inject({ url: '/muster/verlauf', headers: auth })).statusCode).toBe(503);
    await app.close();
    await ohne.close();
    werk.beenden();
  });
});

describe('Dorf: Verlauf (E239)', () => {
  it('Durchreiche GET /api/krypto/muster/verlauf mit Bearer, version geprüft; ohne Sitzung nichts', async () => {
    const G = 'k'.repeat(40);
    const anfragen: { pfad: string; suche: string; auth: string | null }[] = [];
    const verlauf: KryptoMusterVerlauf = { laeufe: [], lauf: null };
    const holen = (async (url: string, init: RequestInit = {}) => {
      const u = new URL(url);
      anfragen.push({ pfad: u.pathname, suche: u.search, auth: new Headers(init.headers).get('authorization') });
      return Response.json(u.pathname === '/muster/verlauf' ? verlauf : { ok: true });
    }) as unknown as typeof fetch;
    const d = await testDorf({ env: { KRYPTO_GEHEIMNIS: G }, hafenHolen: holen });
    const h = await kopf(d);
    expect((await d.app.inject({ url: '/api/krypto/muster/verlauf' })).statusCode).toBe(401);
    expect(anfragen).toHaveLength(0);
    const a = await d.app.inject({ url: '/api/krypto/muster/verlauf', headers: h });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toEqual(verlauf);
    expect(anfragen[0]).toMatchObject({ pfad: '/muster/verlauf', suche: '', auth: `Bearer ${G}` });
    await d.app.inject({ url: '/api/krypto/muster/verlauf?version=4', headers: h });
    expect(anfragen[1]).toMatchObject({ pfad: '/muster/verlauf', suche: '?version=4' });
    expect((await d.app.inject({ url: '/api/krypto/muster/verlauf?version=0', headers: h })).statusCode).toBe(400);
    expect((await d.app.inject({ url: '/api/krypto/muster/verlauf?version=1%26x%3D1', headers: h })).statusCode).toBe(400);
    expect(anfragen).toHaveLength(2);
  });
});
