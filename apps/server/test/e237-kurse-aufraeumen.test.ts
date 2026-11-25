import { describe, expect, it } from 'vitest';
import { TestUhr } from '../src/uhr.js';
import { Kryptowerk, kryptoDb } from '../src/krypto/motor.js';
import type { DexScreener, RugCheck } from '../src/krypto/quellen.js';

/** E237: alte Kurse werden in Portionen gelöscht (höchstens 20 000 je Takt) – kein Riesen-DELETE nach dem Kürzen auf 5 Tage */
describe('Kurse aufräumen in Portionen (E237)', () => {
  it('je Takt höchstens 20 000 alte Zeilen, neue bleiben', async () => {
    const uhr = new TestUhr();
    const db = kryptoDb(':memory:');
    const dex = { async paare() { return { schnappschuesse: [], solUsd: 140 }; } } as unknown as DexScreener;
    const rug = { bereit: () => false, async bericht() { throw new Error('nicht gebraucht'); } } as unknown as RugCheck;
    const werk = new Kryptowerk({ db, uhr, dex, rug, zufall: () => 0.5 });
    const alt = uhr.jetzt() - 9 * 86_400_000;
    const ein = db.prepare("INSERT INTO kurse (mint, zeit, preis_sol, dex) VALUES (?, ?, 1, 'pumpfun')");
    db.transaction(() => {
      for (let i = 0; i < 45_000; i++) ein.run(`M${i % 50}`, alt + i);
      ein.run('NEU', uhr.jetzt() - 60_000);
    })();
    const zaehlen = () => (db.prepare('SELECT COUNT(*) AS n FROM kurse').get() as { n: number }).n;
    uhr.vor(2000);
    await werk.takt();
    expect(zaehlen()).toBe(25_001);
    uhr.vor(2000);
    await werk.takt();
    expect(zaehlen()).toBe(5_001);
    uhr.vor(2000);
    await werk.takt();
    expect(zaehlen()).toBe(1);
    werk.beenden();
  });
});
