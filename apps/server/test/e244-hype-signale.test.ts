import { describe, expect, it } from 'vitest';
import { KRYPTO_STANDARD, type KryptoEinstellung } from '@dorf/shared';
import { TestUhr } from '../src/uhr.js';
import { Kryptowerk, kryptoDb, type KDB } from '../src/krypto/motor.js';
import { HYPE_PUNKTE, pruefen, type TokenInfo } from '../src/krypto/bewertung.js';
import { einstellungPruefen } from '../src/krypto/einstellung.js';
import { DexScreener, Metadaten, ipfsCid, linkArten, type RugCheck, type Schnappschuss } from '../src/krypto/quellen.js';
import { SmartMoney, kaeuferAus, FRUEHE_TX, GEWINNER_FAKTOR, ERGEBNIS_NACH_MS } from '../src/krypto/smart.js';
import { MERKMAL_NAMEN, merkmale } from '../src/krypto/muster/merkmale.js';

/**
 * E244: Hype-Signale je Bot an-/abhakbar – DexScreener-Boost/Profil, Socials (Pump.fun-Metadaten über IPFS + DexScreener-Links),
 * Smart Money (frühe Käufer über Helius, Ergebnisse aus den eigenen Kursen); Punkte, LLM-Daten, Terminal-Module, Muster-Merkmale.
 */
const MINT = 'FNzXkQwLWzRm6Z1jJT9gnVH2pHiKiYLw3Ry1btY5KvLU';
const T0 = Date.UTC(2026, 10, 26, 12, 0, 0);

const einstellung = (e: Partial<KryptoEinstellung> = {}): KryptoEinstellung => ({ ...structuredClone(KRYPTO_STANDARD), name: 'E244', ...e });
const mitSignalen = (signale: { boost: boolean; socials: boolean; smart: boolean }) => einstellung({ regeln: { ...KRYPTO_STANDARD.regeln, signale } });
function snap(mint: string, zeit: number, o: Partial<Schnappschuss> = {}): Schnappschuss {
  return { mint, zeit, symbol: 'ECHT', name: 'Echt', dex: 'pumpfun', preisSol: 4e-8, preisUsd: 4e-8 * 140, marktwertUsd: 4e-8 * 1e9 * 140, volumenUsdM5: 20_000, kaeufeM5: 80, verkaeufeM5: 30, aenderungM5: 12, aenderungH1: null, poolSol: null, poolToken: null, ...o };
}
const antwort = (daten: unknown, status = 200) => ({ ok: status < 400, status, json: async () => daten, text: async () => JSON.stringify(daten) }) as unknown as Response;

describe('Quellen (E244)', () => {
  it('DexScreener: Boosts und Profil-Links aus dem Paar; Boost-Listen nur Solana, Top markiert', async () => {
    const paar = {
      chainId: 'solana', dexId: 'pumpfun', pairAddress: 'P', baseToken: { address: MINT, name: 'Echt', symbol: 'ECHT' }, quoteToken: { address: 'So11111111111111111111111111111111111111112', symbol: 'SOL' },
      priceNative: '4e-8', priceUsd: '0.0000056', volume: { m5: 100, h24: 1000 }, txns: { m5: { buys: 5, sells: 1 } },
      boosts: { active: 30 }, info: { websites: [{ url: 'https://echt.xyz', label: 'Website' }], socials: [{ type: 'twitter', url: 'https://x.com/echt' }, { type: 'telegram', url: 'https://t.me/echt' }] },
    };
    const urls: string[] = [];
    const dex = new DexScreener({
      holen: (async (u: string) => {
        urls.push(u);
        if (u.includes('/token-boosts/latest/')) return antwort([{ chainId: 'solana', tokenAddress: MINT, amount: 10, totalAmount: 30 }, { chainId: 'base', tokenAddress: '0xabc', amount: 99 }]);
        if (u.includes('/token-boosts/top/')) return antwort([{ chainId: 'solana', tokenAddress: 'TOP', totalAmount: 500 }]);
        return antwort([paar]);
      }) as unknown as typeof fetch,
    });
    const { schnappschuesse } = await dex.paare([MINT]);
    expect(schnappschuesse[0]).toMatchObject({ boostAktiv: 30, links: ['twitter', 'telegram', 'website'] });
    const b = await dex.boosts();
    expect(urls.filter((u) => u.includes('token-boosts'))).toEqual(['https://api.dexscreener.com/token-boosts/latest/v1', 'https://api.dexscreener.com/token-boosts/top/v1']);
    expect([...b]).toEqual([[MINT, { amount: 30, top: false }], ['TOP', { amount: 500, top: true }]]);
    expect(linkArten(['X', 'Twitter', 'discord', 'böse<script>'], false)).toEqual(['twitter', 'discord']);
  });

  it('Pump.fun-Metadaten nur über IPFS (nie beliebige Adressen – der Container erreicht das Dorf)', async () => {
    expect(ipfsCid('https://ipfs.io/ipfs/bafkreig7puylkk6o2endu4g6obnoghbfos5ysmqc5567tgyvvkvwtcyzhq')).toBe('bafkreig7puylkk6o2endu4g6obnoghbfos5ysmqc5567tgyvvkvwtcyzhq');
    expect(ipfsCid('ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG')).toBe('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG');
    for (const boese of ['http://dorf:3001/intern/krypto/bewerten', 'https://useanonpad.fun/api/m/381ad8da677b4d03a153.json', 'https://ipfs.io/ipfs/../../x', 'http://ipfs.io/ipfs/bafkreig7puylkk6o2endu4g6obnoghbfos5ysmqc5567tgyvvkvwtcyzhq', 'file:///etc/passwd', ''])
      expect(ipfsCid(boese)).toBeNull();
    const urls: string[] = [];
    const m = new Metadaten({
      holen: (async (u: string) => {
        urls.push(u);
        return antwort({ name: 'Echt', twitter: 'https://x.com/echt', telegram: '', website: 'https://echt.xyz', description: 'gm' });
      }) as unknown as typeof fetch,
    });
    expect(await m.links('https://ipfs.io/ipfs/bafkreig7puylkk6o2endu4g6obnoghbfos5ysmqc5567tgyvvkvwtcyzhq')).toEqual(['twitter', 'website']);
    expect(urls).toEqual(['https://gateway.pinata.cloud/ipfs/bafkreig7puylkk6o2endu4g6obnoghbfos5ysmqc5567tgyvvkvwtcyzhq']);
    expect(await m.links('http://dorf:3001/x')).toBeNull();
    expect(urls).toHaveLength(1);
  });
});

describe('Smart Money (E244)', () => {
  const tx = (signer: string, mint: string, vorher: number, nachher: number, zeit = T0 / 1000) => ({
    blockTime: zeit,
    meta: { err: null, preTokenBalances: vorher ? [{ mint, owner: signer, uiTokenAmount: { amount: String(vorher) } }] : [], postTokenBalances: [{ mint, owner: signer, uiTokenAmount: { amount: String(nachher) } }] },
    transaction: { message: { accountKeys: [{ pubkey: signer, signer: true }, { pubkey: mint, signer: false }] } },
  });

  it('Käufer = Unterzeichner mit steigendem Saldo dieses Mints; Verkäufe, fremde Mints und Fehler zählen nicht', () => {
    expect(kaeuferAus(tx('W1', MINT, 0, 500), MINT)).toEqual({ wallet: 'W1', zeit: T0 });
    expect(kaeuferAus(tx('W1', MINT, 500, 100), MINT)).toBeNull();
    expect(kaeuferAus(tx('W1', 'ANDERER', 0, 500), MINT)).toBeNull();
    expect(kaeuferAus({ ...tx('W1', MINT, 0, 500), meta: { err: { x: 1 } } }, MINT)).toBeNull();
    expect(kaeuferAus('müll', MINT)).toBeNull();
  });

  function smartAufbau(db: KDB, uhr: TestUhr, kaeufer: Record<string, string[]>) {
    const aufrufe: string[] = [];
    const sm = new SmartMoney({
      db,
      rpcUrl: 'https://rpc.example/?api-key=x',
      jetzt: () => uhr.jetzt(),
      proSekunde: 1000,
      creditsTag: 1000,
      holen: (async (_u: string, init: RequestInit) => {
        const { method, params } = JSON.parse(String(init.body)) as { method: string; params: [string] };
        aufrufe.push(method);
        if (method === 'getSignaturesForAddress') return antwort({ result: (kaeufer[params[0]] ?? []).map((w, i) => ({ signature: `${params[0]}:${w}:${i}`, blockTime: 1 })).reverse() });
        const [mint, w] = params[0].split(':');
        return antwort({ result: tx(w!, mint!, 0, 100) });
      }) as unknown as typeof fetch,
    });
    return { sm, aufrufe };
  }

  it('frühe Käufer speichern, Ergebnisse aus eigenen Kursen nach 60 min, Smart = ≥ 3 Ergebnisse, ≥ 40 % und ≥ 2× Grundrate', async () => {
    const uhr = new TestUhr(T0);
    const db = kryptoDb(':memory:');
    // 6 Tokens: WAL kauft früh in 4 (3 Gewinner), NORM kauft in allen 6 (3 Gewinner von 6 = Grundrate)
    const tokens = ['A', 'B', 'C', 'D', 'E', 'F'];
    const gewinner = new Set(['A', 'B', 'C']);
    const kaeufer: Record<string, string[]> = {};
    for (const [i, t] of tokens.entries()) {
      db.prepare('INSERT INTO tokens (mint, symbol, name, erstellt, start_marktwert_sol) VALUES (?, ?, ?, ?, ?)').run(t, t, t, T0 + i * 1000, 28);
      kaeufer[t] = i < 3 || i === 3 ? ['WAL', 'NORM', `X${i}`] : ['NORM', `X${i}`];
      // eigener Kurs: Gewinner erreichen 4× den Startkurs (28 SOL / 1 Mrd.), andere 1,5×
      db.prepare('INSERT INTO kurse (mint, zeit, preis_sol, dex) VALUES (?, ?, ?, ?)').run(t, T0 + i * 1000 + 10 * 60_000, (28 / 1e9) * (gewinner.has(t) ? 4 : 1.5), 'pumpfun');
    }
    // Grundrate nur aus diesen 6: 3/6 = 50 % → Smart braucht ≥ 100 %? Nein: ≥ 40 % UND ≥ 2 × Grundrate – mit Verlierern verdünnen
    for (let k = 0; k < 6; k++) {
      const t = `V${k}`;
      db.prepare('INSERT INTO tokens (mint, symbol, name, erstellt, start_marktwert_sol) VALUES (?, ?, ?, ?, ?)').run(t, t, t, T0, 28);
      db.prepare('INSERT INTO kurse (mint, zeit, preis_sol, dex) VALUES (?, ?, ?, ?)').run(t, T0 + 60_000, 28 / 1e9, 'pumpfun');
      kaeufer[t] = ['NORM'];
    }
    const { sm, aufrufe } = smartAufbau(db, uhr, kaeufer);
    for (const t of Object.keys(kaeufer)) expect(await sm.pruefen(t)).toMatchObject({ smart: 0 });
    expect(aufrufe.filter((x) => x === 'getSignaturesForAddress')).toHaveLength(12);
    // vor 60 min: keine Ergebnisse
    expect(sm.ergebnisseFesthalten()).toBe(0);
    uhr.vor(ERGEBNIS_NACH_MS + 10_000);
    expect(sm.ergebnisseFesthalten()).toBe(12);
    expect((db.prepare('SELECT SUM(gewinner) AS g FROM token_ergebnis').get() as { g: number }).g).toBe(3);
    // Grundrate 3/12 = 25 %: WAL 3/4 = 75 % → smart; NORM 3/12 = 25 % → nicht; X* nur 1 Ergebnis → nicht
    expect([...sm.smartAlle()]).toEqual(['WAL']);
    expect(sm.stand()).toMatchObject({ smart: 1, tokens: 12, ergebnisse: 12 });
    // neuer Token mit WAL unter den ersten Käufern → 1 Smart-Wallet
    db.prepare('INSERT INTO tokens (mint, symbol, name, erstellt, start_marktwert_sol) VALUES (?, ?, ?, ?, ?)').run('NEU', 'NEU', 'NEU', uhr.jetzt(), 28);
    kaeufer.NEU = ['X9', 'WAL'];
    expect(await sm.pruefen('NEU')).toEqual({ kaeufer: 2, smart: 1 });
    // Tagesgrenze: kein Abruf mehr, wenn sie nicht für einen ganzen Token reicht
    const knapp = new SmartMoney({ db, rpcUrl: 'https://rpc.example', jetzt: () => uhr.jetzt(), creditsTag: FRUEHE_TX });
    expect(await knapp.pruefen('NEU')).toBeNull();
    // ohne https-RPC aus
    expect(new SmartMoney({ db, rpcUrl: null }).eingerichtet).toBe(false);
    expect(new SmartMoney({ db, rpcUrl: 'http://rpc.example' }).eingerichtet).toBe(false);
    expect(GEWINNER_FAKTOR).toBe(3);
  });
});

describe('Bewertung mit Häkchen (E244)', () => {
  const info = (o: Partial<TokenInfo> = {}): TokenInfo => ({ mint: MINT, symbol: 'ECHT', name: 'Echt', erstellt: T0 - 120_000, devToken: 1e7, creator: null, ...o });
  const rug = { zeit: T0, scoreNormiert: 5, risiken: [] };
  const zeilen = (e: KryptoEinstellung, i: TokenInfo) => pruefen(e, i, snap(MINT, T0), rug, T0).filter((s) => ['hype', 'socials', 'kol'].includes(s.schluessel));

  it('ohne Häkchen keine Signale; mit Häkchen Punkte, nie sperrend', () => {
    const voll = info({ boost: 30, boostTop: true, boostZeit: T0, links: ['twitter', 'telegram', 'website'], linksZeit: T0, smartKaeufer: 5, smartZeit: T0 });
    expect(zeilen(einstellung(), voll)).toEqual([]);
    const alle = zeilen(mitSignalen({ boost: true, socials: true, smart: true }), voll);
    expect(alle.map((s) => [s.schluessel, s.punkte, s.sperre, s.zeile])).toEqual([
      ['hype', HYPE_PUNKTE.boost + HYPE_PUNKTE.boostTop, false, 'Boost 30 · Top-Liste'],
      ['socials', 7, false, 'twitter · telegram · website'],
      ['kol', HYPE_PUNKTE.smartMax, false, '5 Smart-Wallets unter den ersten Käufern'],
    ]);
    const leer = zeilen(mitSignalen({ boost: true, socials: true, smart: true }), info());
    expect(leer.map((s) => [s.punkte, s.zeile])).toEqual([[0, 'kein Boost'], [0, 'noch keine Daten'], [0, 'noch nicht geprüft']]);
    expect(einstellungPruefen(structuredClone(KRYPTO_STANDARD)).regeln.signale).toEqual({ boost: false, socials: false, smart: false });
  });

  it('Muster-Merkmale: boost/socialsAnzahl/smartKaeufer erst ab ihrem Bekannt-Zeitpunkt (kein Blick in die Zukunft)', () => {
    expect(MERKMAL_NAMEN.slice(-3)).toEqual(['boost', 'socialsAnzahl', 'smartKaeufer']);
    const ticks = Array.from({ length: 10 }, (_, i) => ({ zeit: T0 + i * 1000, preis: 1e-7, sol: 0.1, echtSol: 3 }));
    const meta = { mint: MINT, erstellt: T0 - 5000, boost: 30, boostZeit: T0 + 5000, links: ['twitter', 'website'], linksZeit: T0 + 5000, smartKaeufer: 2, smartZeit: T0 + 5000 };
    expect(merkmale(ticks, T0 + 3000, meta)!.slice(-3)).toEqual([0, -1, -1]);
    const nach = merkmale(ticks, T0 + 8000, meta)!.slice(-3);
    expect(nach[0]).toBeCloseTo(Math.log1p(30), 10);
    expect(nach.slice(1)).toEqual([2, 2]);
  });
});

describe('Im Kryptowerk (E244)', () => {
  function aufbau(o: { boost?: number; links?: string[] } = {}) {
    const uhr = new TestUhr();
    const db = kryptoDb(':memory:');
    const dex = {
      async paare(m: string[]) {
        return { schnappschuesse: m.map((x) => snap(x, uhr.jetzt(), { boostAktiv: o.boost ?? 0, links: o.links ?? [] })), solUsd: 140 };
      },
      async boosts() {
        return new Map([[MINT, { amount: 77, top: true }]]);
      },
    } as unknown as DexScreener;
    const rug = { bereit: () => true, async bericht() { return { zeit: uhr.jetzt(), scoreNormiert: 5, risiken: [] }; } } as unknown as RugCheck;
    const metaUrls: string[] = [];
    const metadaten = new Metadaten({ jetzt: () => uhr.jetzt(), abstandMs: 0, holen: (async (u: string) => (metaUrls.push(u), antwort({ twitter: 'https://x.com/a', telegram: 'https://t.me/a' }))) as unknown as typeof fetch });
    const werk = new Kryptowerk({ db, uhr, dex, rug, zufall: () => 0.99, metadaten });
    return { uhr, db, werk, metaUrls };
  }

  it('Boost + Links aus DexScreener und der Boost-Liste, Metadaten über IPFS – gespeichert mit Zeitpunkt, im Terminal je Häkchen', async () => {
    const x = aufbau({ boost: 20, links: ['website'] });
    const bot = x.werk.anlegen(mitSignalen({ boost: true, socials: true, smart: false }));
    x.werk.neuerToken({ mint: MINT, txType: 'create', initialBuy: 20_000_000, solAmount: 0.6, marketCapSol: 28, name: 'Echt', symbol: 'ECHT', uri: 'https://ipfs.io/ipfs/bafkreig7puylkk6o2endu4g6obnoghbfos5ysmqc5567tgyvvkvwtcyzhq' } as never, x.uhr.jetzt());
    for (let i = 0; i < 4; i++) {
      x.uhr.vor(20_000);
      await x.werk.takt();
      await new Promise((r) => setImmediate(r));
    }
    expect(x.metaUrls).toEqual(['https://gateway.pinata.cloud/ipfs/bafkreig7puylkk6o2endu4g6obnoghbfos5ysmqc5567tgyvvkvwtcyzhq']);
    const z = x.db.prepare('SELECT boost, boost_zeit, links, links_zeit FROM tokens WHERE mint = ?').get(MINT) as { boost: number; boost_zeit: number; links: string; links_zeit: number };
    expect(z.boost).toBe(77);
    expect(z.boost_zeit).toBeGreaterThan(0);
    expect(JSON.parse(z.links).sort()).toEqual(['telegram', 'twitter', 'website']);
    const module = Object.fromEntries(x.werk.terminal(bot.id).module.map((m) => [m.schluessel, m]));
    expect(module.hype!.an).toBe(true);
    expect(module.hype!.zeile).toMatch(/Boost 77 · Top-Liste/);
    expect(module.socials!.zeile).toMatch(/website/);
    expect(module.kol).toMatchObject({ an: false, zeile: 'aus – Häkchen „Smart Money“' });
    // ohne Häkchen: Modul aus
    const ohne = x.werk.anlegen(einstellung());
    expect(x.werk.terminal(ohne.id).module.find((m) => m.schluessel === 'hype')).toMatchObject({ an: false });
    x.werk.beenden();
  });
});
