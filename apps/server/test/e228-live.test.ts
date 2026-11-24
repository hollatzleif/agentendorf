import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { KRYPTO_STANDARD, type KryptoEinstellung } from '@dorf/shared';
import { TestUhr } from '../src/uhr.js';
import { WalletTresor, istAdresse } from '../src/krypto/wallet.js';
import { LiveAusfuehrer, type LiveErgebnis, type Rpc, type TxInfo } from '../src/krypto/ausfuehrung.js';
import { Kryptowerk, kryptoDb } from '../src/krypto/motor.js';
import { Backtests } from '../src/krypto/backtest.js';
import type { DexScreener, RugCheck, Schnappschuss } from '../src/krypto/quellen.js';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';

/** E228: Wallets, echte Ausführung (Nachbau von PumpPortal und RPC – nie echtes Geld im Test), scharf schalten, Backtest */
const HAUPT = 'ab'.repeat(32);
const MINT = 'AbCdEfGhJkLmNoPqRsTuVwXyZ123456789pump';

function einstellung(e: Partial<KryptoEinstellung> = {}): KryptoEinstellung {
  return { ...structuredClone(KRYPTO_STANDARD), name: 'Testbot', ...e };
}

function snap(zeit: number, preis: number): Schnappschuss {
  return { mint: MINT, zeit, symbol: 'TEST', name: 'Test', dex: 'pumpfun', preisSol: preis, preisUsd: preis * 140, marktwertUsd: preis * 1e9 * 140, volumenUsdM5: 20_000, kaeufeM5: 80, verkaeufeM5: 30, aenderungM5: 12, aenderungH1: null, poolSol: null, poolToken: null };
}

describe('Wallets (E228)', () => {
  it('je Bot neu erzeugt, verschlüsselt, nur mit dem richtigen Hauptschlüssel lesbar; Export im Phantom-Format; Archiv', () => {
    const db = kryptoDb(':memory:');
    const t = new WalletTresor(db, HAUPT);
    const a = t.erzeugen('bot-1')!;
    const b = t.erzeugen('bot-2')!;
    expect(istAdresse(a)).toBe(true);
    expect(a).not.toBe(b);
    // in der Datenbank steht kein Klartext-Schlüssel
    const roh = db.prepare('SELECT geheim FROM wallets WHERE adresse = ?').get(a) as { geheim: Buffer };
    const kp = t.keypair(a);
    expect(Buffer.from(kp.secretKey).includes(roh.geheim)).toBe(false);
    expect(kp.publicKey.toBase58()).toBe(a);
    const exp = t.exportieren(a);
    expect(Keypair.fromSecretKey(bs58.decode(exp)).publicKey.toBase58()).toBe(a);
    // falscher Hauptschlüssel → nicht lesbar
    expect(() => new WalletTresor(db, 'cd'.repeat(32)).keypair(a)).toThrow();
    // ohne Hauptschlüssel: kein Wallet
    expect(new WalletTresor(db, undefined).erzeugen('bot-3')).toBeNull();
    t.archivieren('bot-1');
    expect(t.adresse('bot-1')).toBeNull();
    expect(t.liste().find((w) => w.adresse === a)!.botId).toBe('archiv:bot-1');
  });
});

/** RPC-Nachbau: nimmt signierte Transaktionen an und meldet Saldenänderungen wie Solana (meta) */
function rpcNachbau(adresse: string, o: { solDelta: number; tokenDelta: number; err?: unknown; guthaben?: number }) {
  const gesendet: VersionedTransaction[] = [];
  const rpc: Rpc = {
    async sendRawTransaction(b) {
      const tx = VersionedTransaction.deserialize(b);
      gesendet.push(tx);
      return bs58.encode(tx.signatures[0]!);
    },
    async getSignatureStatuses() {
      return { value: [{ err: o.err ?? null, confirmationStatus: 'confirmed' }] };
    },
    async getTransaction(): Promise<TxInfo> {
      const vorher = 5_000_000_000;
      return {
        meta: {
          err: o.err ?? null,
          fee: 105_000,
          preBalances: [vorher],
          postBalances: [vorher + o.solDelta * 1e9],
          preTokenBalances: [{ mint: MINT, owner: adresse, uiTokenAmount: { uiAmount: o.tokenDelta < 0 ? -o.tokenDelta : 0 } }],
          postTokenBalances: [{ mint: MINT, owner: adresse, uiTokenAmount: { uiAmount: o.tokenDelta > 0 ? o.tokenDelta : 0 } }],
        },
      };
    },
    async getBalance() {
      return (o.guthaben ?? 5) * 1e9;
    },
    async getLatestBlockhash() {
      return { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1 };
    },
  };
  return { rpc, gesendet };
}

/** wie PumpPortal: eine unsignierte Transaktion mit dem Bot-Wallet (oder einem fremden) als Zahler */
function portalNachbau(zahler: string) {
  const anfragen: Record<string, unknown>[] = [];
  const holen = (async (_url: string, init: RequestInit) => {
    anfragen.push(JSON.parse(String(init.body)));
    const msg = new TransactionMessage({ payerKey: new PublicKey(zahler), recentBlockhash: '11111111111111111111111111111111', instructions: [SystemProgram.transfer({ fromPubkey: new PublicKey(zahler), toPubkey: Keypair.generate().publicKey, lamports: 1 })] }).compileToV0Message();
    return new Response(Buffer.from(new VersionedTransaction(msg).serialize()), { status: 200 });
  }) as unknown as typeof fetch;
  return { holen, anfragen };
}

describe('Live-Ausführung (E228, Nachbau)', () => {
  it('Kauf: Anfrage wie in der PumpPortal-Doku, selbst signiert, Ergebnis aus der bestätigten Transaktion', async () => {
    const db = kryptoDb(':memory:');
    const t = new WalletTresor(db, HAUPT);
    const adr = t.erzeugen('b')!;
    const p = portalNachbau(adr);
    const r = rpcNachbau(adr, { solDelta: -0.5061, tokenDelta: 9_000_000 });
    const live = new LiveAusfuehrer({ tresor: t, rpc: r.rpc, holen: p.holen, warten: async () => undefined });
    const e = await live.kaufen(adr, MINT, 0.5, 15, 0.0005);
    expect(p.anfragen[0]).toEqual({ publicKey: adr, mint: MINT, pool: 'auto', action: 'buy', amount: 0.5, denominatedInSol: 'true', slippage: 15, priorityFee: 0.0005 });
    expect(e.fehler).toBeUndefined();
    expect(e.solDelta).toBeCloseTo(-0.5061, 6);
    expect(e.tokenDelta).toBe(9_000_000);
    expect(e.netzSol).toBeCloseTo(0.000105, 9);
    // wirklich mit dem Bot-Schlüssel signiert
    const tx = r.gesendet[0]!;
    expect(tx.signatures[0]!.some((x) => x !== 0)).toBe(true);
    expect(tx.message.staticAccountKeys[0]!.toBase58()).toBe(adr);
    // Verkauf von allem: "100%"
    await live.verkaufen(adr, MINT, 'alles', 20, 0.001);
    expect(p.anfragen[1]).toMatchObject({ action: 'sell', amount: '100%', denominatedInSol: 'false', slippage: 20 });
  });

  it('signiert nie eine Transaktion, die nicht das Bot-Wallet bezahlt; Fehlschlag kommt als Fehler zurück', async () => {
    const db = kryptoDb(':memory:');
    const t = new WalletTresor(db, HAUPT);
    const adr = t.erzeugen('b')!;
    const fremd = portalNachbau(Keypair.generate().publicKey.toBase58());
    const r = rpcNachbau(adr, { solDelta: -0.001, tokenDelta: 0 });
    const e = await new LiveAusfuehrer({ tresor: t, rpc: r.rpc, holen: fremd.holen, warten: async () => undefined }).kaufen(adr, MINT, 0.5, 15, 0.0005);
    expect(e.fehler).toContain('nicht vom Bot-Wallet');
    expect(r.gesendet).toHaveLength(0);
    const r2 = rpcNachbau(adr, { solDelta: -0.0001, tokenDelta: 0, err: { InstructionError: [0, 'Custom'] } });
    const e2 = await new LiveAusfuehrer({ tresor: t, rpc: r2.rpc, holen: portalNachbau(adr).holen, warten: async () => undefined }).kaufen(adr, MINT, 0.5, 15, 0.0005);
    expect(e2.fehler).toContain('fehlgeschlagen');
  });
});

function liveStub() {
  const aufrufe: string[] = [];
  let guthaben = 3;
  const stub = {
    async guthabenSol() {
      return guthaben;
    },
    async kaufen(_a: string, _m: string, sol: number): Promise<LiveErgebnis> {
      aufrufe.push(`kauf ${sol}`);
      return { signatur: 'sigK', solDelta: -(sol + 0.0031), tokenDelta: 10_000_000, netzSol: 0.0006 };
    },
    async verkaufen(_a: string, _m: string, menge: number | 'alles'): Promise<LiveErgebnis> {
      aufrufe.push(`verkauf ${menge}`);
      return { signatur: 'sigV', solDelta: 0.3, tokenDelta: -10_000_000, netzSol: 0.0006 };
    },
    async auszahlen(): Promise<LiveErgebnis> {
      aufrufe.push('auszahlen');
      return { signatur: 'sigA', solDelta: -guthaben, tokenDelta: 0, netzSol: 0.000005 };
    },
  };
  return { stub, aufrufe, setzen: (g: number) => (guthaben = g) };
}

function werkAufbau(o: { live?: ReturnType<typeof liveStub>; auszahlung?: string } = {}) {
  const uhr = new TestUhr();
  const db = kryptoDb(':memory:');
  let preis = 4e-8;
  const dex = { async paare(m: string[]) { return { schnappschuesse: m.filter((x) => x === MINT).map(() => snap(uhr.jetzt(), preis)), solUsd: 140 }; } } as unknown as DexScreener;
  const rug = { bereit: () => true, async bericht() { return { zeit: uhr.jetzt(), scoreNormiert: 5, risiken: [] }; } } as unknown as RugCheck;
  const tresor = new WalletTresor(db, HAUPT);
  const werk = new Kryptowerk({ db, uhr, dex, rug, zufall: () => 0.99, tresor, paperMindestMs: 3_600_000, ...(o.live ? { live: o.live.stub as never } : {}), ...(o.auszahlung ? { auszahlung: o.auszahlung } : {}) });
  const neu = () => werk.neuerToken({ mint: MINT, txType: 'create', initialBuy: 20_000_000, name: 'Test', symbol: 'TEST' } as never, uhr.jetzt());
  const schritt = async (ms: number) => {
    uhr.vor(ms);
    await werk.takt();
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  };
  return { uhr, db, werk, neu, schritt, kurs: (p: number) => (preis = p) };
}

describe('Scharf schalten und Live-Handel (E228)', () => {
  it('jeder Bot hat ein Wallet; scharf nur nach Paper-Mindestzeit, flach, mit Guthaben ≥ Budget; dann echte Käufe/Verkäufe über die Ausführung', async () => {
    const l = liveStub();
    const x = werkAufbau({ live: l, auszahlung: Keypair.generate().publicKey.toBase58() });
    const b = x.werk.anlegen(einstellung());
    expect(istAdresse(b.wallet!.adresse)).toBe(true);
    await expect(x.werk.scharfSchalten(b.id, { budgetSol: 1 })).rejects.toThrow(/Paper/);
    x.uhr.vor(3_600_000);
    l.setzen(0.5);
    await expect(x.werk.scharfSchalten(b.id, { budgetSol: 1 })).rejects.toThrow(/mindestens 1,02|1.02/);
    l.setzen(3);
    const scharf = await x.werk.scharfSchalten(b.id, { budgetSol: 1 });
    expect(scharf).toMatchObject({ modus: 'live', live: { budgetSol: 1 } });
    expect(scharf.paperBilanz).not.toBeNull();
    expect(scharf.kennzahlen).toMatchObject({ startSol: 1, trades: 0 });
    // Kauf ohne künstliche Verzögerung über die echte Ausführung
    x.neu();
    await x.schritt(70_000);
    await x.schritt(1000);
    await x.schritt(10);
    expect(l.aufrufe).toEqual(['kauf 0.05']); // 5 % von 1 SOL Budget
    let t = x.werk.terminal(b.id);
    expect(t.lage).toBe('LONG');
    expect(t.trades[0]).toMatchObject({ art: 'kauf', signatur: 'sigK' });
    // Stop-Loss → echter Verkauf von allem
    x.kurs(2.8e-8);
    await x.schritt(2000);
    await x.schritt(10);
    expect(l.aufrufe).toEqual(['kauf 0.05', 'verkauf alles']);
    t = x.werk.terminal(b.id);
    expect(t.lage).toBe('FLAT');
    expect(t.trades[0]).toMatchObject({ art: 'verkauf', signatur: 'sigV' });
    // löschen geht nicht, solange scharf; auszahlen nicht, solange er läuft
    expect(() => x.werk.loeschen(b.id)).toThrow(/scharf/);
    await expect(x.werk.auszahlen(b.id)).rejects.toThrow(/entschärfen|pausieren/);
    // entschärfen → neuer Paper-Abschnitt, Auszahlen an die feste Adresse
    expect(x.werk.entschaerfen(b.id)).toMatchObject({ modus: 'paper', live: null });
    expect(await x.werk.auszahlen(b.id)).toMatchObject({ signatur: 'sigA' });
  });

  it('Not-Aus verkauft auch echte Positionen; ohne RPC oder Auszahlungsadresse geht nichts', async () => {
    const l = liveStub();
    const x = werkAufbau({ live: l });
    const b = x.werk.anlegen(einstellung());
    x.uhr.vor(3_600_000);
    await x.werk.scharfSchalten(b.id, { budgetSol: 1 });
    x.neu();
    await x.schritt(70_000);
    await x.schritt(1000);
    await x.schritt(10);
    x.werk.notausAusloesen();
    await x.schritt(10);
    await x.schritt(10);
    expect(l.aufrufe.at(-1)).toBe('verkauf alles');
    await expect(x.werk.auszahlen(b.id)).rejects.toThrow(/Auszahlungsadresse/);
    const ohne = werkAufbau();
    const b2 = ohne.werk.anlegen(einstellung());
    ohne.uhr.vor(3_600_000);
    await expect(ohne.werk.scharfSchalten(b2.id, { budgetSol: 1 })).rejects.toThrow(/RPC/);
    // alte Bots ohne Wallet bekommen beim Start eines
    const db = kryptoDb(':memory:');
    const uhr = new TestUhr();
    const alt = new Kryptowerk({ db, uhr, dex: {} as never, rug: {} as never });
    const id = alt.anlegen(einstellung()).id;
    expect(alt.bot(id).wallet).toBeNull();
    const neu = new Kryptowerk({ db, uhr, dex: {} as never, rug: {} as never, tresor: new WalletTresor(db, HAUPT) });
    neu.starten(60_000);
    neu.beenden();
    expect(istAdresse(neu.bot(id).wallet!.adresse)).toBe(true);
  });
});

describe('Backtest (E228)', () => {
  it('spielt die Aufzeichnung mit derselben Maschine ab – kauft, verkauft, zählt Gebühren; nur Regel-Bots', async () => {
    // Aufzeichnung erzeugen: Paper-Bot läuft gegen den Nachbau, Kurs steigt und fällt
    const x = werkAufbau();
    x.werk.anlegen(einstellung());
    x.neu();
    for (const [ms, p] of [[70_000, 4e-8], [1000, 4e-8], [5000, 4.2e-8], [30_000, 6.5e-8], [30_000, 9e-8], [30_000, 6.6e-8], [30_000, 6e-8], [600_000, 6e-8]] as const) {
      x.kurs(p);
      await x.schritt(ms);
    }
    const bt = new Backtests({ db: x.db, schrittMs: 2000 });
    expect(() => bt.starten(einstellung({ art: 'prompt', prompt: 'Kaufe nur bei starkem Volumen.' }))).toThrow(/Regel-Bots/);
    const job = bt.starten(einstellung({ name: 'Variante' }));
    const fertig = await bt.fertig(job.id);
    expect(fertig.status).toBe('fertig');
    expect(fertig.daten!.kurse).toBeGreaterThan(3);
    const k = fertig.ergebnis!.kennzahlen;
    expect(k.trades).toBeGreaterThanOrEqual(1);
    expect(k.gebuehrenArt.portalSol).toBeGreaterThan(0);
    expect(fertig.ergebnis!.trades.some((t) => t.art === 'kauf')).toBe(true);
  });
});

describe('Dorf: scharf schalten nur mit Passwort (E228)', () => {
  it('ohne SCHARF, mit falschem Passwort → abgelehnt; richtig → weiter ans Kryptowerk', async () => {
    const anfragen: string[] = [];
    const holen = (async (url: string) => {
      anfragen.push(new URL(url).pathname);
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;
    const d = await testDorf({ env: { KRYPTO_GEHEIMNIS: 'k'.repeat(40) }, hafenHolen: holen });
    const h = await kopf(d);
    const url = '/api/krypto/bots/11111111-2222-4333-8444-555555555555/scharf';
    expect((await d.app.inject({ method: 'POST', url, headers: h, payload: { budgetSol: 1, passwort: 'ein-langes-test-passwort-1' } })).statusCode).toBe(400);
    expect((await d.app.inject({ method: 'POST', url, headers: h, payload: { budgetSol: 1, bestaetigung: 'SCHARF', passwort: 'falsch' } })).statusCode).toBe(401);
    expect(anfragen).toHaveLength(0);
    expect((await d.app.inject({ method: 'POST', url, headers: h, payload: { budgetSol: 1, bestaetigung: 'SCHARF', passwort: 'ein-langes-test-passwort-1' } })).statusCode).toBe(200);
    expect(anfragen).toEqual(['/bots/11111111-2222-4333-8444-555555555555/scharf']);
    // Auszahlen ebenso nur mit Passwort
    expect((await d.app.inject({ method: 'POST', url: url.replace('scharf', 'auszahlen'), headers: h, payload: { passwort: 'falsch' } })).statusCode).toBe(401);
  });
});
