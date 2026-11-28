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
