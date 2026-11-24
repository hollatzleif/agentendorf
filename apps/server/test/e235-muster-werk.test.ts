import { describe, expect, it } from 'vitest';
import { KRYPTO_STANDARD, type KryptoEinstellung, type KryptoMusterStatus } from '@dorf/shared';
import { TestUhr } from '../src/uhr.js';
import { Kryptowerk, kryptoDb, type KDB } from '../src/krypto/motor.js';
import { kryptoServer } from '../src/krypto/server.js';
import { Backtests } from '../src/krypto/backtest.js';
import { einstellungPruefen } from '../src/krypto/einstellung.js';
import { MusterDienst, type Trainer } from '../src/krypto/muster/dienst.js';
import { MERKMAL_NAMEN } from '../src/krypto/muster/merkmale.js';
import type { GbdtModell, RlModell } from '../src/krypto/muster/typen.js';
import { KURVE_DISKRIMINATOR, kurveLesen } from '../src/krypto/strom.js';
import type { DexScreener, RugCheck, Schnappschuss } from '../src/krypto/quellen.js';

/**
 * E235: Aufzeichnung des Echtzeit-Stroms, Muster-Dienst (Training, Status, Übernahme-Regeln), Rat im Terminal,
 * musterGewicht, RL-Bot (kauft/verkauft nach Modell, Stop-Loss bleibt), Nachschuss, nur Paper.
 */
const MINT = 'FNzXkQwLWzRm6Z1jJT9gnVH2pHiKiYLw3Ry1btY5KvLU';
const MINUTE = 60_000;

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

function einstellung(e: Partial<KryptoEinstellung> = {}): KryptoEinstellung {
  return { ...structuredClone(KRYPTO_STANDARD), name: 'E235', ...e };
}
const rlEinstellung = (rl = { minSicherheit: 0.6, erkunden: 0, nachschuss: true }) => einstellung({ name: 'RL', art: 'rl', rl });

function snap(mint: string, zeit: number, preis: number): Schnappschuss {
  return { mint, zeit, symbol: 'ECHT', name: 'Echt', dex: 'pumpfun', preisSol: preis, preisUsd: preis * 140, marktwertUsd: preis * 1e9 * 140, volumenUsdM5: 20_000, kaeufeM5: 80, verkaeufeM5: 30, aenderungM5: 12, aenderungH1: null, poolSol: null, poolToken: null };
}

/** GBDT ohne Bäume: sagt immer p voraus */
const festesModell = (p: number, version = 1): GbdtModell => ({ version, merkmale: MERKMAL_NAMEN, basis: Math.log(p / (1 - p)), lernrate: 1, baeume: [] });
/** RL-Agent, der ohne Position kauft und mit Position immer „warten“ will (Stop-Loss muss dann allein greifen) */
const immerWarten = (): RlModell => ({ version: 1, q: new Proxy({}, { get: (_z, k) => (String(k).startsWith('h|') ? [1, 0, 0, 0] : [0, 1, 0, 0]) }) as Record<string, number[]> });

function aufbau(o: { maxTicks?: number; ohneMuster?: boolean } = {}) {
  const uhr = new TestUhr();
  const db = kryptoDb(':memory:');
  let preis = 4e-8;
  const dex = { async paare(m: string[]) { return { schnappschuesse: m.map((x) => snap(x, uhr.jetzt(), preis)), solUsd: 140 }; } } as unknown as DexScreener;
  const rug = { bereit: () => true, async bericht() { return { zeit: uhr.jetzt(), scoreNormiert: 5, risiken: [] }; } } as unknown as RugCheck;
  const muster = o.ohneMuster ? undefined : new MusterDienst({ db, uhr });
  const werk = new Kryptowerk({ db, uhr, dex, rug, zufall: () => 0.99, ...(muster ? { muster } : {}), ...(o.maxTicks ? { maxTicks: o.maxTicks } : {}) });
  const schritt = async (ms: number) => {
    uhr.vor(ms);
    await werk.takt();
  };
  const neu = (mint = MINT) => werk.neuerToken({ mint, txType: 'create', initialBuy: 20_000_000, solAmount: 0.6, name: 'Echt', symbol: 'ECHT' } as never, uhr.jetzt());
  /** drei Strom-Ticks (Käufe) bis jetzt – genug für die Merkmale */
  const ticks = (vSol = 40) => {
    for (const d of [-0.4, -0.2, 0]) {
      werk.kurveTick(MINT, stand(vSol + d), uhr.jetzt());
      uhr.vor(500);
    }
  };
  return { uhr, db, werk, muster, schritt, neu, ticks, setzePreis: (p: number) => (preis = p) };
}

describe('Aufzeichnung der Strom-Ticks (E235)', () => {
  it('jeder Tick landet (gesammelt im Takt) in strom_ticks – mit echten SOL; nach 7 Tagen weg; höchstens maxTicks (älteste zuerst)', async () => {
    const x = aufbau({ maxTicks: 5 });
    x.werk.kurveTick(MINT, stand(40), x.uhr.jetzt());
    x.uhr.vor(1000);
    x.werk.kurveTick(MINT, stand(42), x.uhr.jetzt());
    expect((x.db.prepare('SELECT COUNT(*) AS n FROM strom_ticks').get() as { n: number }).n).toBe(0);
    await x.schritt(1000);
    const zeilen = x.db.prepare('SELECT * FROM strom_ticks ORDER BY zeit').all() as { mint: string; preis: number; sol: number; echt_sol: number }[];
    expect(zeilen).toHaveLength(2);
    expect(zeilen[0]).toMatchObject({ mint: MINT, sol: 0, echt_sol: 10 });
    expect(zeilen[1]!.sol).toBeCloseTo(2, 6);
    expect(zeilen[1]!.echt_sol).toBeCloseTo(12, 6);
    expect(zeilen[1]!.preis).toBeCloseTo(42 / 1e9, 15);
    // Obergrenze: 8 Ticks, nach einer Stunde räumt der Takt auf → die neuesten 5 bleiben
    for (let i = 0; i < 6; i++) {
      x.uhr.vor(1000);
      x.werk.kurveTick(MINT, stand(43 + i), x.uhr.jetzt());
    }
    await x.schritt(3_600_000);
    const rest = x.db.prepare('SELECT preis FROM strom_ticks ORDER BY rowid').all() as { preis: number }[];
    expect(rest).toHaveLength(5);
    expect(rest.at(-1)!.preis).toBeCloseTo(48 / 1e9, 15);
    // 7 Tage später ist alles weg
    await x.schritt(7 * 86_400_000 + MINUTE);
    expect((x.db.prepare('SELECT COUNT(*) AS n FROM strom_ticks').get() as { n: number }).n).toBe(0);
    x.werk.beenden();
  });
});

/** synthetische Aufzeichnung: abwechselnd steigende (Kaufdruck) und fallende (Verkaufsdruck) Tokens, zeitlich versetzt */
function datenEinspielen(db: KDB, o: { tokens: number; start: number; dauerMs: number; zufaellig?: boolean; saat?: number }) {
  let s = o.saat ?? 7;
  const zufall = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const tok = db.prepare('INSERT OR IGNORE INTO tokens (mint, symbol, name, erstellt, creator) VALUES (?, ?, ?, ?, ?)');
  const tick = db.prepare('INSERT INTO strom_ticks (mint, zeit, preis, sol, echt_sol) VALUES (?, ?, ?, ?, ?)');
  db.transaction(() => {
    for (let i = 0; i < o.tokens; i++) {
      const mint = `Syn${o.saat ?? 0}x${i}x`.padEnd(44, 'A');
      const erstellt = o.start + i * 60_000;
      tok.run(mint, `S${i}`, 'Syn', erstellt, `Dev${i % 7}`);
      const hoch = i % 2 === 0;
      let preis = 3e-8;
      let echt = 5;
      for (let t = erstellt; t < erstellt + o.dauerMs; t += 2000) {
        const schritt = o.zufaellig ? (zufall() - 0.5) * 0.02 : hoch ? 0.0016 : -0.0013;
        const sol = o.zufaellig ? (zufall() - 0.5) * 0.6 : hoch ? 0.3 + zufall() * 0.1 : -0.3 - zufall() * 0.1;
        preis *= Math.exp(schritt);
        echt = Math.max(0.1, echt + sol);
        tick.run(mint, t, preis, sol, echt);
      }
    }
  })();
}

describe('Muster-Dienst: Training (E235)', () => {
  it('zu wenig Daten → Bericht sagt es, kein Modell, kein Rat; Status zeigt Daten und Zeiten', async () => {
    const uhr = new TestUhr();
    const db = kryptoDb(':memory:');
    datenEinspielen(db, { tokens: 2, start: uhr.jetzt() - 30 * MINUTE, dauerMs: 3 * MINUTE });
    const m = new MusterDienst({ db, uhr, stunden: 5 });
    expect(m.status()).toMatchObject({ modell: null, rl: null, training: { laeuft: false, letzter: null, fehler: null } });
    expect(m.status().training.naechster).toBe(new Date(uhr.jetzt() + 10 * MINUTE).toISOString());
    expect(m.faelligPruefen()).toBe(false);
    uhr.vor(10 * MINUTE);
    expect(m.faelligPruefen()).toBe(true);
    expect(m.status().training.laeuft).toBe(true);
    await m.fertig();
    const st = m.status();
    expect(st.bericht).toMatch(/zu wenig Daten/);
    expect(st.modell).toBeNull();
    expect(m.aktiv).toBe(false);
    expect(st.training).toMatchObject({ laeuft: false, fortschritt: 100, fehler: null, letzter: new Date(uhr.jetzt()).toISOString(), naechster: new Date(uhr.jetzt() + 5 * 3_600_000).toISOString() });
    expect(st.training.dauerMs).toBeGreaterThanOrEqual(0);
    expect(st.daten).toMatchObject({ ticks: 180, tokens: 2 });
    expect(st.ziel).toEqual({ zielProzent: 20, stopProzent: 15, horizontMin: 5 });
  });

  it('genug Daten mit Muster → aktives Modell gespeichert (Version, Test-AUC); nach Neustart geladen; schlechteres ersetzt es nicht', async () => {
    const uhr = new TestUhr();
    const db = kryptoDb(':memory:');
    datenEinspielen(db, { tokens: 40, start: uhr.jetzt() - 60 * MINUTE, dauerMs: 14 * MINUTE });
    const m = new MusterDienst({ db, uhr, stueckGroesse: 3000 });
    m.trainingStarten();
    await m.fertig();
    let st = m.status();
    expect(st.training.fehler).toBeNull();
    expect(st.modell).toMatchObject({ version: 1, aktiv: true });
    expect(st.modell!.test.auc).toBeGreaterThanOrEqual(0.55);
    expect(st.modell!.test.beispiele).toBeGreaterThanOrEqual(200);
    expect(st.rl).toMatchObject({ version: 1 });
    expect(m.aktiv).toBe(true);
    expect(m.rl).not.toBeNull();
    expect(st.daten.tokens).toBe(40);
    const zeile = db.prepare('SELECT version, aktiv, gbdt_json IS NOT NULL AS g, rl_json IS NOT NULL AS r FROM muster_modelle').all();
    expect(zeile).toEqual([{ version: 1, aktiv: 1, g: 1, r: 1 }]);
    // Neustart: das aktive Modell ist sofort wieder da
    const m2 = new MusterDienst({ db, uhr });
    expect(m2.aktiv).toBe(true);
    expect(m2.status().modell!.version).toBe(1);
    // neue Daten ohne Muster (Zufall) → neues Modell nicht aktiv → altes Paar bleibt
    db.prepare('DELETE FROM strom_ticks').run();
    datenEinspielen(db, { tokens: 40, start: uhr.jetzt() - 60 * MINUTE, dauerMs: 14 * MINUTE, zufaellig: true, saat: 3 });
    const rlAlt = m2.rl;
    m2.trainingStarten();
    await m2.fertig();
    st = m2.status();
    expect(st.modell!.version).toBe(1);
    expect(m2.aktiv).toBe(true);
    expect(m2.rl).toBe(rlAlt);
    expect(st.bericht).toMatch(/nicht aktiv/);
    expect(st.bericht).toMatch(/bisherige Modell v1 .* bleibt aktiv/);
    expect(db.prepare('SELECT version, aktiv FROM muster_modelle ORDER BY version').all()).toEqual([
      { version: 1, aktiv: 1 },
      { version: 2, aktiv: 0 },
    ]);
  }, 120_000);

  it('altAuc geht an den Trainer; Fehler stehen im Status statt verschluckt zu werden', async () => {
    const uhr = new TestUhr();
    const db = kryptoDb(':memory:');
    const aufrufe: (number | null | undefined)[] = [];
    let fehler = true;
    const trainer: Trainer = async (_d, o) => {
      aufrufe.push(o.altAuc);
      if (fehler) throw new Error('Speicher voll');
      return { gbdt: festesModell(0.7, o.version), rl: null, modell: { version: o.version, trainiert: '', beispiele: 1, positivAnteil: 0.5, test: { beispiele: 300, auc: 0.6, praezision: null, basis: 0.5 }, aktiv: true, merkmale: [] }, rlInfo: null, bericht: 'ok' };
    };
    const m = new MusterDienst({ db, uhr, trainer });
    m.trainingStarten();
    await m.fertig();
    expect(m.status().training.fehler).toBe('Speicher voll');
    expect(m.aktiv).toBe(false);
    fehler = false;
    m.trainingStarten();
    await m.fertig();
    expect(m.status().training.fehler).toBeNull();
    expect(m.aktiv).toBe(true);
    m.trainingStarten();
    await m.fertig();
    expect(aufrufe).toEqual([null, null, 0.6]);
  });
});

describe('Kryptowerk-API /muster (E235)', () => {
  it('GET zeigt den Status, POST startet das Training, ein zweites POST während des Laufs → 409', async () => {
    const uhr = new TestUhr();
    const db = kryptoDb(':memory:');
    let loslassen!: () => void;
    const trainer: Trainer = async () => {
      await new Promise<void>((r) => (loslassen = r));
      return { gbdt: null, rl: null, modell: null, rlInfo: null, bericht: 'zu wenig Daten' };
    };
    const muster = new MusterDienst({ db, uhr, trainer });
    const werk = new Kryptowerk({ db, uhr, dex: {} as DexScreener, rug: { bereit: () => false } as unknown as RugCheck, muster });
    const geheim = 'g'.repeat(40);
    const app = kryptoServer(werk, geheim, undefined, muster);
    const auth = { authorization: `Bearer ${geheim}` };
    expect((await app.inject({ method: 'GET', url: '/muster' })).statusCode).toBe(401);
    const a = await app.inject({ method: 'GET', url: '/muster', headers: auth });
    expect(a.statusCode).toBe(200);
    expect((a.json() as KryptoMusterStatus).training.laeuft).toBe(false);
    const b = await app.inject({ method: 'POST', url: '/muster/training', headers: auth });
    expect(b.statusCode).toBe(200);
    expect(b.json()).toEqual({ ok: true });
    expect(((await app.inject({ method: 'GET', url: '/muster', headers: auth })).json() as KryptoMusterStatus).training.laeuft).toBe(true);
    const c = await app.inject({ method: 'POST', url: '/muster/training', headers: auth });
    expect(c.statusCode).toBe(409);
    expect(c.json().fehler).toMatch(/läuft schon/);
    await new Promise((r) => setImmediate(r));
    loslassen();
    await muster.fertig();
    const d = (await app.inject({ method: 'GET', url: '/muster', headers: auth })).json() as KryptoMusterStatus;
    expect(d.training.laeuft).toBe(false);
    expect(d.bericht).toBe('zu wenig Daten');
    // ohne Dienst: 503
    const ohne = kryptoServer(werk, geheim);
    expect((await ohne.inject({ method: 'GET', url: '/muster', headers: auth })).statusCode).toBe(503);
    await app.close();
    await ohne.close();
    werk.beenden();
  });
});

describe('Einstellung (E235)', () => {
  it('art rl mit Standard-Grenzen, Grenzen geprüft, leerer Prompt erlaubt; musterGewicht 0–30, Standard 0', () => {
    const e = einstellungPruefen({ ...KRYPTO_STANDARD, art: 'rl', prompt: '' });
    expect(e.rl).toEqual({ minSicherheit: 0.6, erkunden: 0.05, nachschuss: true });
    expect(() => einstellungPruefen({ ...KRYPTO_STANDARD, art: 'rl', rl: { minSicherheit: 0.6, erkunden: 0.5, nachschuss: true } })).toThrow();
    expect(() => einstellungPruefen({ ...KRYPTO_STANDARD, art: 'rl', rl: { minSicherheit: 1.2, erkunden: 0, nachschuss: true } })).toThrow();
    const alt = structuredClone(KRYPTO_STANDARD) as unknown as { regeln: Record<string, unknown> };
    delete alt.regeln.musterGewicht;
    expect(einstellungPruefen(alt).regeln.musterGewicht).toBe(0);
    expect(() => einstellungPruefen({ ...KRYPTO_STANDARD, regeln: { minPunkte: 60, musterGewicht: 31 } })).toThrow();
  });
});

describe('Rat und musterGewicht (E235)', () => {
  it('Terminal: musterRat nur mit aktivem Modell; Rat nach Wahrscheinlichkeit', async () => {
    const x = aufbau();
    const bot = x.werk.anlegen(einstellung());
    x.neu();
    x.ticks();
    expect(x.werk.terminal(bot.id).musterRat).toEqual([]);
    x.muster!.modellSetzen(festesModell(0.8), null);
    const rat = x.werk.terminal(bot.id).musterRat!;
    expect(rat).toHaveLength(1);
    expect(rat[0]).toMatchObject({ mint: MINT, symbol: 'ECHT', rat: 'kaufen' });
    expect(rat[0]!.wahrscheinlichkeit).toBeCloseTo(0.8, 6);
    // je Token höchstens alle 2 s neu gerechnet
    x.muster!.modellSetzen(festesModell(0.2), null);
    expect(x.werk.musterP(MINT)).toBeCloseTo(0.8, 6);
    x.uhr.vor(2000);
    expect(x.werk.musterP(MINT)).toBeCloseTo(0.2, 6);
    expect(x.werk.terminal(bot.id).musterRat![0]!.rat).toBe('halten');
    x.werk.beenden();
  });

  it('musterGewicht 0 ändert nichts; > 0 verschiebt die Punkte um round((p − 0,5)·2·Gewicht)', async () => {
    const lauf = async (gewicht: number, p: number | null) => {
      const x = aufbau();
      if (p != null) x.muster!.modellSetzen(festesModell(p), null);
      const bot = x.werk.anlegen(einstellung({ regeln: { minPunkte: 101 - 1, musterGewicht: gewicht } }));
      x.neu();
      x.uhr.vor(68_000);
      x.ticks();
      await x.schritt(1000);
      const e = x.werk.protokoll(bot.id).entscheidungen.find((z) => z.mint === MINT)!;
      const vol = x.werk.terminal(bot.id).module.find((m) => m.schluessel === 'volumen')!.zeile;
      x.werk.beenden();
      return { punkte: Math.round(e.sicherheit! * 100), vol };
    };
    const ohne = await lauf(0, null);
    const null0 = await lauf(0, 0.25);
    expect(null0).toEqual(ohne);
    const mit = await lauf(30, 0.25);
    expect(mit.punkte).toBe(ohne.punkte - 15);
    expect(mit.vol).toMatch(/Muster 25 % -15/);
    const begrenzt = await lauf(10, 0.01);
    expect(begrenzt.punkte).toBe(ohne.punkte - 10);
  });
});

describe('RL-Bot (E235)', () => {
  /** RL-Bot anlegen, Token neu, Kurse + Strom → bewerten */
  async function rlStart(x: ReturnType<typeof aufbau>, e = rlEinstellung()) {
    const bot = x.werk.anlegen(e);
    x.neu();
    x.uhr.vor(68_000);
    x.ticks();
    await x.schritt(1000);
    return bot;
  }

  it('ohne aktives Modell kein Kauf („wartet auf Modell“); unter minSicherheit kein Kauf', async () => {
    const x = aufbau();
    const bot = await rlStart(x);
    await x.schritt(2000);
    expect(x.werk.terminal(bot.id).status).toBe('wartet auf Modell');
    expect(x.werk.terminal(bot.id).lage).toBe('FLAT');
    expect(x.werk.protokoll(bot.id).entscheidungen.some((z) => z.aktion === 'buy')).toBe(false);
    x.muster!.modellSetzen(festesModell(0.5), null);
    x.ticks();
    await x.schritt(11_000);
    await x.schritt(2000);
    expect(x.werk.terminal(bot.id).lage).toBe('FLAT');
    expect(x.werk.terminal(bot.id).status).not.toBe('wartet auf Modell');
    expect(x.werk.protokoll(bot.id).entscheidungen.some((z) => z.aktion === 'buy')).toBe(false);
    x.werk.beenden();
  });

  it('kauft mit aktivem Modell und p ≥ minSicherheit (quelle modell, Risk-Gate), verkauft bei „raus“', async () => {
    const x = aufbau();
    x.muster!.modellSetzen(festesModell(0.8), null);
    const bot = await rlStart(x);
    const kauf = x.werk.protokoll(bot.id).entscheidungen.find((z) => z.aktion === 'buy')!;
    expect(kauf).toMatchObject({ quelle: 'modell', mint: MINT });
    expect(kauf.grund).toMatch(/^RL: kaufen · Muster 80 %/);
    expect(kauf.sicherheit).toBeCloseTo(0.8, 6);
    await x.schritt(2000);
    expect(x.werk.terminal(bot.id).lage).toBe('LONG');
    // Modell kippt (p < 0,3): Agent (Regel ohne Q-Tabelle) → raus
    x.muster!.modellSetzen(festesModell(0.1), null);
    x.uhr.vor(2000);
    x.ticks();
    await x.schritt(500);
    const verkauf = x.werk.protokoll(bot.id).entscheidungen.find((z) => z.aktion === 'sell')!;
    expect(verkauf).toMatchObject({ quelle: 'modell' });
    expect(verkauf.grund).toMatch(/^RL: raus · Muster 10 %/);
    await x.schritt(2000);
    expect(x.werk.terminal(bot.id).lage).toBe('FLAT');
    expect(x.werk.kennzahlen(bot.id).trades).toBe(1);
    x.werk.beenden();
  });

  it('Stop-Loss greift weiter, auch wenn der Agent „warten“ will', async () => {
    const x = aufbau();
    x.muster!.modellSetzen(festesModell(0.9), immerWarten());
    // Notausstieg bei großem Einzelverkauf aus – hier soll der Stop-Loss allein greifen
    const bot = await rlStart(x, { ...rlEinstellung(), ausstieg: { ...KRYPTO_STANDARD.ausstieg, notausEinzelverkaufProzent: 0 } });
    await x.schritt(2000);
    const t = x.werk.terminal(bot.id);
    expect(t.lage).toBe('LONG');
    const vSol = t.positionen[0]!.einstiegPreis * 1e9;
    // Kurs −35 % in kleinen Schritten
    for (let i = 1; i <= 12; i++) {
      x.uhr.vor(300);
      x.werk.kurveTick(MINT, stand(vSol * (1 - (0.35 * i) / 12)), x.uhr.jetzt());
    }
    const sell = x.werk.protokoll(bot.id).entscheidungen.filter((z) => z.aktion === 'sell');
    expect(sell).toHaveLength(1);
    expect(sell[0]).toMatchObject({ quelle: 'code' });
    expect(sell[0]!.grund).toMatch(/Stop-Loss/);
    x.werk.beenden();
  });

  it('Nachschuss: Kasse ≈ 0 → frisches Spielgeld, zählt zum Startkapital, nie als Gewinn; nur einmal; ausgeschaltet → keiner', async () => {
    const x = aufbau();
    const bot = x.werk.anlegen(rlEinstellung());
    const start = bot.einstellung.startkapitalSol;
    expect(x.werk.kennzahlen(bot.id)).toMatchObject({ nachschussSol: 0, nachschuesse: 0, gewinnSol: 0 });
    await x.schritt(MINUTE);
    x.db.prepare('UPDATE bots SET kasse_sol = 0.001 WHERE id = ?').run(bot.id);
    await x.schritt(MINUTE);
    let k = x.werk.kennzahlen(bot.id);
    expect(k.nachschuesse).toBe(1);
    expect(k.nachschussSol).toBe(start);
    expect(k.startSol).toBeCloseTo(2 * start, 9);
    expect(k.kapitalSol).toBeCloseTo(start + 0.001, 9);
    expect(k.gewinnSol).toBeCloseTo(0.001 - start, 9);
    expect(k.faktor).toBeCloseTo((start + 0.001) / (2 * start), 9);
    expect(k.heuteSol).toBeCloseTo(0.001 - start, 6);
    // Drawdown zeigt die Pleite (Nachschuss ist keine Erholung)
    expect(k.maxDrawdownProzent).toBeGreaterThan(99);
    expect(x.werk.protokoll(bot.id).entscheidungen[0]!.grund).toMatch(/Nachschuss \+\d+(\.\d+)? SOL Paper-Spielgeld .* nicht als Gewinn/);
    await x.schritt(MINUTE);
    k = x.werk.kennzahlen(bot.id);
    expect(k.nachschuesse).toBe(1);
    // ausgeschaltet → kein Nachschuss
    const aus = x.werk.anlegen(rlEinstellung({ minSicherheit: 0.6, erkunden: 0, nachschuss: false }));
    x.db.prepare('UPDATE bots SET kasse_sol = 0.001 WHERE id = ?').run(aus.id);
    await x.schritt(MINUTE);
    expect(x.werk.kennzahlen(aus.id)).toMatchObject({ nachschuesse: 0, nachschussSol: 0 });
    // Regel-Bots bekommen nie einen (und keine Nachschuss-Felder)
    const regel = x.werk.anlegen(einstellung());
    x.db.prepare('UPDATE bots SET kasse_sol = 0.001 WHERE id = ?').run(regel.id);
    await x.schritt(MINUTE);
    expect(x.werk.kennzahlen(regel.id).nachschuesse).toBeUndefined();
    expect(x.werk.kennzahlen(regel.id).kapitalSol).toBeCloseTo(0.001, 9);
    x.werk.beenden();
  });

  it('nur Paper: scharf schalten abgelehnt, scharfer Bot wird kein RL-Bot, Backtest lehnt RL ab', async () => {
    const x = aufbau();
    const bot = x.werk.anlegen(rlEinstellung());
    await expect(x.werk.scharfSchalten(bot.id, { budgetSol: 1 })).rejects.toMatchObject({ status: 400, message: 'RL-Bots laufen nur im Paper Trading.' });
    const regel = x.werk.anlegen(einstellung());
    x.db.prepare("UPDATE bots SET modus = 'live' WHERE id = ?").run(regel.id);
    expect(() => x.werk.aendern(regel.id, rlEinstellung())).toThrow(/RL-Bot/);
    const bt = new Backtests({ db: x.db });
    expect(() => bt.starten(rlEinstellung())).toThrow('RL-Bots testet der Zeitraffer im Training.');
    x.werk.beenden();
  });
});
