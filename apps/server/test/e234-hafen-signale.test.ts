import { describe, expect, it } from 'vitest';
import { KRYPTO_STANDARD, type KryptoEinstellung } from '@dorf/shared';
import { TestUhr } from '../src/uhr.js';
import { Kryptowerk, kryptoDb } from '../src/krypto/motor.js';
import { pruefen, type TokenInfo } from '../src/krypto/bewertung.js';
import { einstellungPruefen } from '../src/krypto/einstellung.js';
import { KURVE_DISKRIMINATOR, kurveLesen } from '../src/krypto/strom.js';
import type { DexScreener, RugCheck, Schnappschuss } from '../src/krypto/quellen.js';

/**
 * E234: Dev-Historie (Serien-Ersteller), Notausstieg bei großem Einzelverkauf, Kaufdruck der letzten 60 s aus dem Strom,
 * Ergebnis je Tag („Tage im Plus“).
 */
const MINT = 'FNzXkQwLWzRm6Z1jJT9gnVH2pHiKiYLw3Ry1btY5KvLU';
const DEV = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

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
  return { ...structuredClone(KRYPTO_STANDARD), name: 'E234', ...e };
}
function snap(mint: string, zeit: number, preis: number): Schnappschuss {
  return { mint, zeit, symbol: 'ECHT', name: 'Echt', dex: 'pumpfun', preisSol: preis, preisUsd: preis * 140, marktwertUsd: preis * 1e9 * 140, volumenUsdM5: 20_000, kaeufeM5: 80, verkaeufeM5: 30, aenderungM5: 12, aenderungH1: null, poolSol: null, poolToken: null };
}

function aufbau(nurMint = false) {
  const uhr = new TestUhr();
  const db = kryptoDb(':memory:');
  const dex = { async paare(m: string[]) { return { schnappschuesse: m.filter((x) => !nurMint || x === MINT).map((x) => snap(x, uhr.jetzt(), 4e-8)), solUsd: 140 }; } } as unknown as DexScreener;
  const rug = { bereit: () => true, async bericht() { return { zeit: uhr.jetzt(), scoreNormiert: 5, risiken: [] }; } } as unknown as RugCheck;
  const werk = new Kryptowerk({ db, uhr, dex, rug, zufall: () => 0.99 });
  const schritt = async (ms: number) => {
    uhr.vor(ms);
    await werk.takt();
  };
  const neu = (mint = MINT, dev?: string) => werk.neuerToken({ mint, txType: 'create', initialBuy: 20_000_000, solAmount: 0.6, name: 'Echt', symbol: 'ECHT', traderPublicKey: dev } as never, uhr.jetzt());
  /** Bot anlegen, Token neu, kaufen lassen → Einstieg */
  const kaufen = async (e = einstellung()) => {
    const bot = werk.anlegen(e);
    neu();
    await schritt(70_000);
    await schritt(1000);
    await schritt(2000);
    const t = werk.terminal(bot.id);
    expect(t.lage).toBe('LONG');
    return { bot, einstieg: t.positionen[0]!.einstiegPreis };
  };
  return { uhr, db, werk, schritt, neu, kaufen };
}

describe('Einstellung (E234)', () => {
  it('alte Einstellungen ohne die neuen Felder bekommen die Standards; Grenzen gelten', () => {
    const alt = structuredClone(KRYPTO_STANDARD) as unknown as { filter: Record<string, unknown>; ausstieg: Record<string, unknown> };
    delete alt.filter.maxDevTokens24h;
    delete alt.filter.minEchtzeitKaufVerhaeltnis;
    delete alt.ausstieg.notausEinzelverkaufProzent;
    const e = einstellungPruefen(alt);
    expect(e.filter.maxDevTokens24h).toBe(3);
    expect(e.filter.minEchtzeitKaufVerhaeltnis).toBe(0);
    expect(e.ausstieg.notausEinzelverkaufProzent).toBe(15);
    expect(() => einstellungPruefen({ ...KRYPTO_STANDARD, ausstieg: { ...KRYPTO_STANDARD.ausstieg, notausEinzelverkaufProzent: 150 } })).toThrow();
  });

  it('Bots aus der Zeit vor E234 (rohes JSON in der DB) laufen mit den Standards weiter', () => {
    const x = aufbau();
    const bot = x.werk.anlegen(einstellung());
    const roh = JSON.parse((x.db.prepare('SELECT einstellung_json AS j FROM bots WHERE id = ?').get(bot.id) as { j: string }).j);
    delete roh.ausstieg.notausEinzelverkaufProzent;
    delete roh.filter.maxDevTokens24h;
    x.db.prepare('UPDATE bots SET einstellung_json = ? WHERE id = ?').run(JSON.stringify(roh), bot.id);
    const e = x.werk.bot(bot.id).einstellung;
    expect(e.ausstieg.notausEinzelverkaufProzent).toBe(15);
    expect(e.filter.maxDevTokens24h).toBe(3);
    x.werk.beenden();
  });
});

describe('Dev-Historie (E234)', () => {
  const info = (n?: number): TokenInfo => ({ mint: MINT, symbol: 'X', name: 'X', erstellt: 0, devToken: 20_000_000, creator: DEV, devTokens24h: n });
  const s = snap(MINT, 70_000, 4e-8);

  it('pruefen: mehr andere Tokens als erlaubt → Dev gesperrt, Zeile nennt die Zahl; ohne Ersteller keine Sperre', () => {
    const dev = (n?: number, e = einstellung()) => pruefen(e, info(n), s, null, 70_000).find((x) => x.schluessel === 'dev')!;
    expect(dev(3)).toMatchObject({ sperre: false });
    expect(dev(3).zeile).toMatch(/3 Tokens\/24h/);
    expect(dev(4)).toMatchObject({ sperre: true, ton: 'schlecht' });
    expect(dev(undefined)).toMatchObject({ sperre: false });
    expect(dev(10, einstellung({ filter: { ...KRYPTO_STANDARD.filter, maxDevTokens24h: 20 } }))).toMatchObject({ sperre: false });
  });

  it('Motor zählt die Tokens desselben Erstellers in den 24 h davor (nicht ältere, nicht andere) und blockt den Kauf', async () => {
    const x = aufbau(true);
    const bot = x.werk.anlegen(einstellung());
    // ein alter Token (> 24 h) und einer eines anderen Erstellers zählen nicht
    x.neu('Alt1111111111111111111111111111111111111111', DEV);
    x.uhr.vor(25 * 3_600_000);
    x.neu('Fremd111111111111111111111111111111111111111', 'AnderER1111111111111111111111111111111111111');
    for (let i = 0; i < 4; i++) x.neu(`Serie${i}111111111111111111111111111111111111111`.slice(0, 44), DEV);
    x.neu(MINT, DEV);
    await x.schritt(70_000);
    await x.schritt(1000);
    await x.schritt(2000);
    expect(x.werk.terminal(bot.id).lage).toBe('FLAT');
    // fällt schon in der Vorprüfung durch (kein RugCheck-Abruf, kein Kauf) – das Terminal zeigt den Grund
    expect(x.werk.protokoll(bot.id).entscheidungen.some((e) => e.mint === MINT && e.aktion === 'buy')).toBe(false);
    expect(x.werk.terminal(bot.id).module.find((m) => m.schluessel === 'dev')).toMatchObject({ ton: 'schlecht' });
    expect(x.werk.terminal(bot.id).module.find((m) => m.schluessel === 'dev')!.zeile).toMatch(/4 Tokens\/24h/);
    x.werk.beenden();
  });
});

describe('Kaufdruck der letzten 60 s (E234)', () => {
  const info: TokenInfo = { mint: MINT, symbol: 'X', name: 'X', erstellt: 0, devToken: 20_000_000, creator: DEV };
  const s = snap(MINT, 70_000, 4e-8);
  const vol = (e: KryptoEinstellung, ez: Parameters<typeof pruefen>[5]) => pruefen(e, info, s, null, 70_000, ez).find((x) => x.schluessel === 'volumen')!;

  it('mehr Punkte bei Kaufdruck, weniger bei Abverkauf; Filter nur, wenn eingeschaltet und genug Trades', () => {
    const e = einstellung();
    const ohne = vol(e, null).punkte;
    expect(vol(e, { kaeufe: 12, verkaeufe: 2, nettoSol: 3 }).punkte).toBeGreaterThan(ohne);
    expect(vol(e, { kaeufe: 2, verkaeufe: 12, nettoSol: -3 }).punkte).toBeLessThan(ohne);
    expect(vol(e, { kaeufe: 12, verkaeufe: 2, nettoSol: 3 }).zeile).toMatch(/60s 12↑ 2↓ \+3\.00 SOL/);
    const streng = einstellung({ filter: { ...KRYPTO_STANDARD.filter, minEchtzeitKaufVerhaeltnis: 2 } });
    expect(vol(streng, { kaeufe: 3, verkaeufe: 3, nettoSol: 0 }).sperre).toBe(true);
    expect(vol(streng, { kaeufe: 6, verkaeufe: 2, nettoSol: 1 }).sperre).toBe(false);
    // keine Strom-Daten oder zu wenig Trades → keine Aussage, keine Sperre
    expect(vol(streng, null).sperre).toBe(false);
    expect(vol(streng, { kaeufe: 0, verkaeufe: 2, nettoSol: -1 }).sperre).toBe(false);
  });

  it('Motor: Käufe/Verkäufe/Netto-SOL nur aus den letzten 60 s des Stroms', () => {
    const x = aufbau();
    expect(x.werk.echtzeit60(MINT)).toBeNull();
    x.werk.kurveTick(MINT, stand(40), x.uhr.jetzt()); // erster Stand: keine Richtung
    x.uhr.vor(1000);
    x.werk.kurveTick(MINT, stand(42), x.uhr.jetzt()); // +2 Kauf
    x.uhr.vor(70_000);
    x.werk.kurveTick(MINT, stand(43), x.uhr.jetzt()); // +1 Kauf
    x.uhr.vor(1000);
    x.werk.kurveTick(MINT, stand(42.5), x.uhr.jetzt()); // −0,5 Verkauf
    const ez = x.werk.echtzeit60(MINT)!;
    expect(ez.kaeufe).toBe(1);
    expect(ez.verkaeufe).toBe(1);
    expect(ez.nettoSol).toBeCloseTo(0.5, 6);
    x.werk.beenden();
  });
});

describe('Notausstieg bei großem Einzelverkauf (E234)', () => {
  it('ein Trade senkt die echte Liquidität um ≥ Schwelle → sofort Verkauf, auch wenn der Stop-Loss noch nicht greift', async () => {
    const x = aufbau();
    const { bot, einstieg } = await x.kaufen();
    const vSol = einstieg * 1e9;
    x.werk.kurveTick(MINT, stand(vSol), x.uhr.jetzt());
    x.uhr.vor(400);
    // echte SOL: vSol−30 = ~10 → ~6,5 (−35 %), Kurs nur ~−9 %: Stop-Loss (−25 %) greift nicht
    x.werk.kurveTick(MINT, stand(vSol - 3.5), x.uhr.jetzt());
    const e = x.werk.protokoll(bot.id).entscheidungen[0]!;
    expect(e).toMatchObject({ aktion: 'sell', quelle: 'code' });
    expect(e.grund).toMatch(/Großer Einzelverkauf: Liquidität −3\d % in einem Trade/);
    await x.schritt(2000);
    expect(x.werk.terminal(bot.id).lage).toBe('FLAT');
    // nur EIN Verkaufsauftrag, auch wenn danach weitere Ticks kommen
    expect(x.werk.protokoll(bot.id).entscheidungen.filter((z) => z.aktion === 'sell')).toHaveLength(1);
    x.werk.beenden();
  });

  it('kleiner Einzelverkauf unter der Schwelle oder Schwelle 0 → kein Notausstieg', async () => {
    for (const schwelle of [15, 0]) {
      const x = aufbau();
      const { bot, einstieg } = await x.kaufen(einstellung({ ausstieg: { ...KRYPTO_STANDARD.ausstieg, notausEinzelverkaufProzent: schwelle } }));
      const vSol = einstieg * 1e9;
      x.werk.kurveTick(MINT, stand(vSol), x.uhr.jetzt());
      x.uhr.vor(400);
      x.werk.kurveTick(MINT, stand(vSol - (schwelle ? 1 : 3.5)), x.uhr.jetzt()); // −10 % bzw. −35 % der echten SOL
      expect(x.werk.protokoll(bot.id).entscheidungen.some((z) => /Einzelverkauf/.test(z.grund))).toBe(false);
      x.werk.beenden();
    }
  });
});

describe('Ergebnis je Tag (E234)', () => {
  it('kennzahlen.tage: geschlossene Positionen je Wiener Tag, neuester zuerst', async () => {
    const x = aufbau();
    const { bot, einstieg } = await x.kaufen();
    x.werk.kurveTick(MINT, stand(einstieg * 1e9), x.uhr.jetzt());
    x.uhr.vor(400);
    x.werk.kurveTick(MINT, stand(einstieg * 1e9 - 3.5), x.uhr.jetzt());
    await x.schritt(2000);
    const k = x.werk.kennzahlen(bot.id);
    expect(k.tage).toHaveLength(1);
    expect(k.tage![0]!.trades).toBe(1);
    expect(k.tage![0]!.gewinnSol).toBeCloseTo(k.gewinnSol, 6);
    expect(k.tage![0]!.tag).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    x.werk.beenden();
  });
});
