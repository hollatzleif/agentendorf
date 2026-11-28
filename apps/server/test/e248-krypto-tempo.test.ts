import { describe, expect, it } from 'vitest';
import { kryptoDb } from '../src/krypto/motor.js';

/**
 * E248: Das Kryptowerk antwortete nach 40–50 s (Dorf: „nicht erreichbar“) – jeder Echtzeit-Kurs fragte die offenen Positionen
 * aller Bots ab, und ohne Index las SQLite dafür jedes Mal ALLE Positionen aller Zeiten. Die Abfragen im Takt müssen Indizes nutzen.
 */
const plan = (db: ReturnType<typeof kryptoDb>, sql: string, ...p: unknown[]) =>
  (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...p) as { detail: string }[]).map((z) => z.detail).join(' | ');

describe('Kryptowerk: Abfragen im Takt nutzen Indizes (E248)', () => {
  it('offene Positionen, Trades je Position, Tokens nach Startzeit – kein voller Tabellen-Scan', () => {
    const db = kryptoDb(':memory:');
    expect(plan(db, 'SELECT * FROM positionen WHERE offen = 1')).toMatch(/USING INDEX positionen_offen/);
    expect(plan(db, 'SELECT * FROM positionen WHERE offen = 1 AND bot_id = ?', 'b')).toMatch(/USING INDEX/);
    expect(plan(db, "SELECT MAX(id) AS m FROM trades WHERE position_id = ? AND art = 'verkauf'", 'p1')).toMatch(/USING INDEX trades_position/);
    expect(plan(db, 'SELECT mint FROM tokens WHERE erstellt >= ?', 0)).toMatch(/USING INDEX tokens_erstellt/);
    // und bleibt schnell bei vielen geschlossenen Positionen
    const ein = db.prepare("INSERT INTO positionen (id, bot_id, mint, symbol, name, geoeffnet, token, rest_token, einsatz_sol, einstieg_preis, einstieg_spot, hoechst, offen) VALUES (?, 'b', 'm', 's', 'n', 0, 1, 1, 0.1, 1, 1, 1, ?)");
    db.transaction(() => {
      for (let i = 0; i < 100_000; i++) ein.run(`p${i}`, i % 50_000 === 0 ? 1 : 0);
    })();
    const q = db.prepare('SELECT * FROM positionen WHERE offen = 1');
    const t = performance.now();
    for (let i = 0; i < 1000; i++) expect(q.all()).toHaveLength(2);
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe('Diagnose im Kryptowerk (E249)', () => {
  it('GET /diagnose: CPU-Profil mit Eigenzeit je Funktion + Zähler – nur mit Bearer', async () => {
    const { Kryptowerk } = await import('../src/krypto/motor.js');
    const { kryptoServer } = await import('../src/krypto/server.js');
    const { TestUhr } = await import('../src/uhr.js');
    const db = kryptoDb(':memory:');
    const werk = new Kryptowerk({ db, uhr: new TestUhr(), dex: { async paare() { return { schnappschuesse: [], solUsd: 140 }; } } as never, rug: { bereit: () => true } as never });
    const G = 'g'.repeat(40);
    const app = kryptoServer(werk, G);
    expect((await app.inject({ url: '/diagnose?sek=1' })).statusCode).toBe(401);
    // etwas Last, damit das Profil etwas sieht
    const last = setInterval(() => {
      let x = 0;
      for (let i = 0; i < 2e6; i++) x += Math.sqrt(i);
      void x;
    }, 50);
    const r = await app.inject({ url: '/diagnose?sek=1', headers: { authorization: `Bearer ${G}` } });
    clearInterval(last);
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/plain/);
    expect(r.body).toMatch(/summeTicks: 0 in 1 s/);
    expect(r.body).toMatch(/positionenGesamt: 0/);
    expect(r.body).toMatch(/Profil über \d,\d s – Leerlauf \d+ %/);
    expect(r.body).toMatch(/Eigenzeit je Funktion:\n\s+\d+ ms/);
    expect((await app.inject({ url: '/diagnose?sek=999', headers: { authorization: `Bearer ${G}` } })).statusCode).toBe(400);
    await app.close();
  }, 20_000);
});
