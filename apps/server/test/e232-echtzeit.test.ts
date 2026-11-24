import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { KRYPTO_STANDARD, type KryptoEinstellung } from '@dorf/shared';
import { TestUhr } from '../src/uhr.js';
import { Kryptowerk, kryptoDb } from '../src/krypto/motor.js';
import type { DexScreener, RugCheck, Schnappschuss, WsLike } from '../src/krypto/quellen.js';
import { KURVE_DISKRIMINATOR, KurveStrom, kurveAdresse, kurveLesen, wssAusRpc } from '../src/krypto/strom.js';

/**
 * E232: Echtzeit-Kurse über den Solana-WebSocket (accountSubscribe auf Bonding-Curve-Konten).
 * Dekoder und Adressen gegen ECHTE Mainnet-Daten (test/fixtures/pump/bonding-curves.json, echte PumpPortal-Paare);
 * der WebSocket ist nachgebaut, mit Nachrichten im Format, das das echte Mainnet geliefert hat (live geprüft 24.11.2026).
 */
const FIX = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures/pump/bonding-curves.json'), 'utf8')) as { konten: { adresse: string; data_b64: string }[] };

/** echte Paare aus PumpPortal-„create“-Ereignissen: mint → bondingCurveKey */
const PAARE: [string, string][] = [
  ['FNzXkQwLWzRm6Z1jJT9gnVH2pHiKiYLw3Ry1btY5KvLU', '43qMNRPVo1oB8XYc9YZRuN9fKYSn782X5TnreNKWgS5b'],
  ['5XJ77H59Ws9SpEiMj2BjX7fFEcbbGzPowyJBi8ar7i62', '4A3nTFQ3n81tN3mhSy8uzhZoBzUiEsKi11m8JbnwSqGS'],
  ['473DBX5kbuYe8s9Z1ycRJo6y84cCeFEgYp4JcPtJyR4U', '5uVSe536fjF52w3mK5kmVD5rr4kDPAZAdc3aA2fKo7wc'],
  ['CYJz5KPs5drvJVzfregbQ2e8wLUdARq6x6ipPQN1NC9c', '3xDUW6so9ASWS6e1W2nmD4LheBMX6mSabg6d3dDzimZZ'],
  ['FboZUGzat39UewgwBFfQHdBEBiLdKEi2AVnFAbeXrfmh', 'BcuB53qRAJJqKQuYVqxKzWSv5SdK37wRDz2NAJCpmNfF'],
];
const MINT = PAARE[0]![0];
const MINT2 = PAARE[1]![0];

/** Bonding-Curve-Konto wie auf der Kette (Layout laut IDL): Reserven in Token bzw. SOL */
function konto(vToken: number, vSol: number, o: { komplett?: boolean; laenge?: number; quote?: Buffer } = {}) {
  const d = Buffer.alloc(o.laenge ?? 151);
  Buffer.from(KURVE_DISKRIMINATOR).copy(d, 0);
  d.writeBigUInt64LE(BigInt(Math.round(vToken * 1e6)), 8);
  d.writeBigUInt64LE(BigInt(Math.round(vSol * 1e9)), 16);
  d.writeBigUInt64LE(BigInt(Math.round(Math.max(0, vToken - 279_900_000) * 1e6)), 24);
  d.writeBigUInt64LE(BigInt(Math.round(Math.max(0, vSol - 30) * 1e9)), 32);
  d.writeBigUInt64LE(1_000_000_000_000_000n, 40);
  d[48] = o.komplett ? 1 : 0;
  o.quote?.copy(d, 83);
  return d.toString('base64');
}

class FalscheWs implements WsLike {
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code?: number }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  gesendet: { id: number; method: string; params: unknown[] }[] = [];
  zu = false;
  send(d: string) {
    this.gesendet.push(JSON.parse(d));
  }
  close() {
    this.zu = true;
    this.onclose?.({});
  }
  /** Server bestätigt alle offenen Abos (Nummern ab 700) */
  bestaetigen() {
    for (const m of this.gesendet.filter((x) => x.method === 'accountSubscribe' && !('_ok' in x))) {
      (m as unknown as { _ok: boolean })._ok = true;
      this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', result: 700 + m.id, id: m.id }) });
    }
  }
  melden(sub: number, b64: string) {
    this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', method: 'accountNotification', params: { result: { context: { slot: 473399203 }, value: { data: [b64, 'base64'], executable: false, lamports: 1231929, owner: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', rentEpoch: 18446744073709551615, space: 151 } }, subscription: sub } }) });
  }
}

describe('Bonding Curve lesen (E232)', () => {
  it('echte Mainnet-Konten (49 und 151 Byte): Startreserven = 1,073 Mrd. Token / 30 SOL; nicht-Kurven abgelehnt', () => {
    for (const k of FIX.konten) {
      const s = kurveLesen(k.data_b64)!;
      expect(s, k.adresse).not.toBeNull();
      expect(s.vToken).toBeGreaterThan(1e9);
      expect(s.vToken).toBeLessThanOrEqual(1.073e9);
      expect(s.vSol).toBeGreaterThanOrEqual(30);
      expect(s.preisSol).toBeCloseTo(s.vSol / s.vToken, 18);
      expect(s.komplett).toBe(false);
    }
    expect(kurveLesen(FIX.konten[0]!.data_b64)!.preisSol).toBeCloseTo(30 / 1.073e9, 15);
    // anderer Diskriminator, zu kurz, Müll
    const falsch = Buffer.from(FIX.konten[0]!.data_b64, 'base64');
    falsch[0] = 1;
    expect(kurveLesen(falsch.toString('base64'))).toBeNull();
    expect(kurveLesen(Buffer.alloc(20).toString('base64'))).toBeNull();
    // Kurve gegen einen anderen Quote-Token (gibt es live) → keine SOL-Reserven → verworfen; SOL-Mint und Nullen gelten
    expect(kurveLesen(konto(1e9, 40, { quote: Buffer.alloc(32, 7) }))).toBeNull();
    expect(kurveLesen(konto(1e9, 40))).not.toBeNull();
    expect(kurveLesen(konto(1e9, 40, { laenge: 49 }))!.preisSol).toBeCloseTo(40 / 1e9, 15);
  });

  it('Adresse = PDA ["bonding-curve", mint] – stimmt mit echten PumpPortal-Paaren; https → wss', () => {
    for (const [m, k] of PAARE) expect(kurveAdresse(m)).toBe(k);
    expect(wssAusRpc('https://mainnet.helius-rpc.com/?api-key=abc')).toBe('wss://mainnet.helius-rpc.com/?api-key=abc');
    expect(wssAusRpc('http://unsicher')).toBeNull();
  });
});

describe('Strom (E232)', () => {
  function strom(o: { grenzeMb?: number; maxAbos?: number } = {}) {
    const uhr = new TestUhr();
    const ticks: { mint: string; preis: number }[] = [];
    const sockets: FalscheWs[] = [];
    const s = new KurveStrom({ url: 'wss://rpc.test/?api-key=x', fabrik: () => (sockets.push(new FalscheWs()), sockets.at(-1)!), jetzt: () => uhr.jetzt(), tick: (mint, st) => ticks.push({ mint, preis: st.preisSol }), ...o });
    return { s, uhr, ticks, sockets, ws: () => sockets.at(-1)! };
  }

  it('abonniert die Kurven-Konten, liefert Kurse, meldet ab, was nicht mehr gebraucht wird', () => {
    const x = strom();
    x.s.setzen([MINT], [MINT2]);
    expect(x.sockets).toHaveLength(1);
    x.ws().onopen!();
    expect(x.ws().gesendet.map((m) => [m.method, (m.params as [string])[0], m.params[1]])).toEqual([
      ['accountSubscribe', PAARE[0]![1], { encoding: 'base64', commitment: 'processed' }],
      ['accountSubscribe', PAARE[1]![1], { encoding: 'base64', commitment: 'processed' }],
    ]);
    x.ws().bestaetigen();
    expect(x.s.status()).toMatchObject({ online: true, abos: 2 });
    x.ws().melden(701, konto(1e9, 45));
    x.ws().melden(999, konto(1e9, 50)); // unbekanntes Abo → nichts
    x.ws().melden(702, Buffer.alloc(30).toString('base64')); // kein Kurven-Konto → nichts
    expect(x.ticks).toEqual([{ mint: MINT, preis: 45 / 1e9 }]);
    expect(x.s.status().ticksMinute).toBe(1);
    // MINT2 fällt weg → Abmeldung mit der Abo-Nummer des Servers
    x.s.setzen([MINT]);
    expect(x.ws().gesendet.at(-1)).toMatchObject({ method: 'accountUnsubscribe', params: [702] });
    // nichts mehr zu beobachten: Verbindung bleibt eine Minute, dann zu (spart Credits)
    x.s.setzen([]);
    expect(x.ws().zu).toBe(false);
    x.uhr.vor(61_000);
    x.s.setzen([]);
    expect(x.ws().zu).toBe(true);
    x.s.stop();
  });

  it('höchstens maxAbos; schon abonnierte Kandidaten behalten Vorrang (kein ständiges Ab-/Anmelden)', () => {
    const x = strom({ maxAbos: 2 });
    x.s.setzen([MINT], [PAARE[2]![0], PAARE[3]![0]]);
    x.ws().onopen!();
    x.ws().bestaetigen();
    expect(x.ws().gesendet.map((m) => (m.params as [string])[0])).toEqual([PAARE[0]![1], PAARE[2]![1]]);
    // Reihenfolge der Kandidaten dreht sich → der schon abonnierte bleibt
    const vorher = x.ws().gesendet.length;
    x.s.setzen([MINT], [PAARE[3]![0], PAARE[2]![0]]);
    expect(x.ws().gesendet.length).toBe(vorher);
    // ungültige Mint wird übersprungen statt zu werfen
    expect(() => x.s.setzen(['kein-gueltiger-schluessel'])).not.toThrow();
    x.s.stop();
  });

  it('Tagesgrenze: Verbindung zu, bis morgen kein Neuaufbau; danach wieder', () => {
    const x = strom({ grenzeMb: 0.002 }); // ≈ 2 KB → nach wenigen Meldungen erreicht (TestUhr: 16.11. 12:00 UTC)
    x.s.setzen([MINT]);
    x.ws().onopen!();
    x.ws().bestaetigen();
    for (let i = 0; i < 10; i++) x.ws().melden(701, konto(1e9, 40 + i));
    expect(x.ws().zu).toBe(true);
    expect(x.s.status()).toMatchObject({ grenzeErreicht: true, online: false });
    expect(x.s.status().fehler).toMatch(/Tagesgrenze/);
    const n = x.sockets.length;
    x.s.setzen([MINT]);
    expect(x.sockets.length).toBe(n); // heute nicht mehr
    x.uhr.vor(12 * 3_600_000 + 60_000); // 17.11. 00:01 UTC – neuer Tag
    x.s.setzen([MINT]);
    expect(x.sockets.length).toBe(n + 1);
    x.s.stop();
  });
});

describe('Motor mit Echtzeit-Kursen (E232)', () => {
  function einstellung(e: Partial<KryptoEinstellung> = {}): KryptoEinstellung {
    return { ...structuredClone(KRYPTO_STANDARD), name: 'Echtzeit', ...e };
  }
  function snap(zeit: number, preis: number): Schnappschuss {
    return { mint: MINT, zeit, symbol: 'ECHT', name: 'Echt', dex: 'pumpfun', preisSol: preis, preisUsd: preis * 140, marktwertUsd: preis * 1e9 * 140, volumenUsdM5: 20_000, kaeufeM5: 80, verkaeufeM5: 30, aenderungM5: 12, aenderungH1: null, poolSol: null, poolToken: null };
  }
  function aufbau() {
    const uhr = new TestUhr();
    const db = kryptoDb(':memory:');
    let dexPreis = 4e-8;
    const dex = { async paare(m: string[]) { return { schnappschuesse: m.filter((x) => x === MINT).map(() => snap(uhr.jetzt(), dexPreis)), solUsd: 140 }; } } as unknown as DexScreener;
    const rug = { bereit: () => true, async bericht() { return { zeit: uhr.jetzt(), scoreNormiert: 5, risiken: [] }; } } as unknown as RugCheck;
    const sockets: FalscheWs[] = [];
    let werk: Kryptowerk;
    const strom = new KurveStrom({ url: 'wss://rpc.test', fabrik: () => (sockets.push(new FalscheWs()), sockets.at(-1)!), jetzt: () => uhr.jetzt(), tick: (m, s, z) => werk.kurveTick(m, s, z) });
    werk = new Kryptowerk({ db, uhr, dex, rug, zufall: () => 0.99, strom });
    const schritt = async (ms: number) => {
      uhr.vor(ms);
      await werk.takt();
    };
    const neu = () => werk.neuerToken({ mint: MINT, txType: 'create', initialBuy: 20_000_000, solAmount: 0.6, name: 'Echt', symbol: 'ECHT' } as never, uhr.jetzt());
    return { uhr, werk, strom, sockets, schritt, neu, dex: (p: number) => (dexPreis = p) };
  }

  it('Kurssturz im Strom → Stop-Loss sofort (ohne auf DexScreener zu warten), verkauft zum Strom-Kurs; Kerzen + Status im Terminal', async () => {
    const x = aufbau();
    const bot = x.werk.anlegen(einstellung());
    x.neu();
    await x.schritt(70_000);
    await x.schritt(1000);
    await x.schritt(2000);
    let t = x.werk.terminal(bot.id);
    expect(t.lage).toBe('LONG');
    const einstieg = t.positionen[0]!.einstiegPreis;
    // der Strom hat das Kurven-Konto des gehaltenen Tokens abonniert (gehalten zuerst)
    const ws = x.sockets.at(-1)!;
    ws.onopen!();
    expect((ws.gesendet[0]!.params as [string])[0]).toBe(PAARE[0]![1]);
    ws.bestaetigen();
    const sub = 700 + ws.gesendet[0]!.id;
    // ein Trade auf der Kette: −40 % → sofort Verkaufs-Entscheidung, noch bevor der nächste Takt läuft
    x.uhr.vor(500);
    const fall = einstieg * 0.6;
    ws.melden(sub, konto(1e9, fall * 1e9));
    expect(x.werk.protokoll(bot.id).entscheidungen[0]).toMatchObject({ aktion: 'sell', quelle: 'code' });
    expect(x.werk.protokoll(bot.id).entscheidungen[0]!.grund).toMatch(/Stop-Loss -40/);
    // DexScreener hinkt hinterher (alter Kurs) – der frischere Strom-Kurs zählt bei der Ausführung
    x.dex(einstieg);
    await x.schritt(2000);
    t = x.werk.terminal(bot.id);
    expect(t.lage).toBe('FLAT');
    const verkauf = t.trades.find((v) => v.art === 'verkauf')!;
    expect(verkauf.preis).toBeLessThan(einstieg * 0.62);
    // Terminal: Echtzeit-Status und Kerzen
    expect(t.echtzeit).toMatchObject({ online: true, ticksMinute: 1 });
    expect(x.werk.uebersicht().echtzeit).toMatchObject({ online: true });
    x.werk.beenden();
  });

  it('Kerzen je gehaltenem Token (5 s) mit Käufen/Verkäufen aus der Richtung der SOL-Reserve', async () => {
    const x = aufbau();
    const bot = x.werk.anlegen(einstellung({ ausstieg: { ...KRYPTO_STANDARD.ausstieg, stopLossProzent: 90, trailingProzent: 0 } }));
    x.neu();
    await x.schritt(70_000);
    await x.schritt(1000);
    await x.schritt(2000);
    const ws = x.sockets.at(-1)!;
    ws.onopen!();
    ws.bestaetigen();
    const sub = 700 + ws.gesendet[0]!.id;
    for (const [ms, sol] of [[0, 40], [1000, 41], [6000, 40.5], [6000, 42]] as const) {
      x.uhr.vor(ms);
      ws.melden(sub, konto(1e9, sol));
    }
    const k = x.werk.terminal(bot.id).tokenKerzen!;
    expect(k).toHaveLength(1);
    expect(k[0]).toMatchObject({ mint: MINT, symbol: 'ECHT', kaeufe: 3, verkaeufe: 1, gehalten: true });
    expect(k[0]!.kerzen.length).toBeGreaterThanOrEqual(2);
    expect(k[0]!.kerzen.at(-1)!.c).toBeCloseTo(42 / 1e9, 15);
    x.werk.beenden();
  });

  it('auch ohne Position: 5-s-Kerzen der lebhaftesten beobachteten Tokens (gehaltene zuerst, höchstens 4)', async () => {
    const x = aufbau();
    const bot = x.werk.anlegen(einstellung());
    expect(x.werk.terminal(bot.id).tokenKerzen).toEqual([]);
    for (const [ms, sol] of [[0, 40], [1000, 41], [6000, 42]] as const) {
      x.uhr.vor(ms);
      x.werk.kurveTick(MINT2, kurveLesen(konto(1e9, sol))!, x.uhr.jetzt());
    }
    x.werk.kurveTick(PAARE[2]![0], kurveLesen(konto(1e9, 35))!, x.uhr.jetzt()); // nur ein Trade → zu wenig für eine Tafel
    const k = x.werk.terminal(bot.id).tokenKerzen!;
    expect(k).toHaveLength(1);
    expect(k[0]).toMatchObject({ mint: MINT2, kaeufe: 3, verkaeufe: 0 });
    expect(k[0]!.gehalten).toBeUndefined();
    x.werk.beenden();
  });

  it('E233: Equity-Kerzen im gewählten Takt (5 s … 15 min) aus feinen Proben; Kryptowerk prüft den Takt', async () => {
    const x = aufbau();
    const bot = x.werk.anlegen(einstellung());
    x.neu();
    for (let i = 0; i < 40; i++) {
      x.dex(4e-8 * (1 + (i % 7) * 0.05));
      await x.schritt(2000);
    }
    const fuenf = x.werk.terminal(bot.id, '5s');
    expect(fuenf.kerzenTakt).toBe('5s');
    expect(fuenf.kerzen.length).toBeGreaterThan(10);
    for (const k of fuenf.kerzen) expect(k.zeit % 5000).toBe(0);
    for (let i = 1; i < fuenf.kerzen.length; i++) expect(fuenf.kerzen[i]!.o).toBeCloseTo(fuenf.kerzen[i - 1]!.c, 12); // lückenlos
    const minute = x.werk.terminal(bot.id, '1m');
    expect(minute.kerzen.length).toBeLessThan(fuenf.kerzen.length);
    for (const k of minute.kerzen) expect(k.zeit % 60_000).toBe(0);
    const standard = x.werk.terminal(bot.id);
    expect(standard.kerzenTakt).toBe('15m');
    for (const k of standard.kerzen) expect(k.zeit % 900_000).toBe(0);
    // über die HTTP-Schnittstelle des Kryptowerks: gültiger Takt ja, Unsinn 400
    const { kryptoServer } = await import('../src/krypto/server.js');
    const app = kryptoServer(x.werk, 'g'.repeat(40));
    const auth = { authorization: `Bearer ${'g'.repeat(40)}` };
    expect((await app.inject({ url: `/bots/${bot.id}/terminal?takt=15s`, headers: auth })).json().kerzenTakt).toBe('15s');
    expect((await app.inject({ url: `/bots/${bot.id}/terminal?takt=1h`, headers: auth })).statusCode).toBe(400);
    x.werk.beenden();
  });

  it('ohne Strom (kein RPC): echtzeit null, alles wie vorher', () => {
    const db = kryptoDb(':memory:');
    const w = new Kryptowerk({ db, uhr: new TestUhr(), dex: {} as never, rug: {} as never });
    expect(w.uebersicht().echtzeit).toBeNull();
  });
});
