import { describe, expect, it } from 'vitest';
import type { KryptoKonsoleZeile } from '@dorf/shared';
import { TestUhr } from '../src/uhr.js';
import { Kryptowerk, kryptoDb, type KDB } from '../src/krypto/motor.js';
import { MusterDienst, type Trainer } from '../src/krypto/muster/dienst.js';
import { ARCHIV_KENNUNG, musterTrainieren } from '../src/krypto/muster/training.js';
import type { DexScreener, RugCheck } from '../src/krypto/quellen.js';

/**
 * E241: Beispiel-Archiv – jedes Training legt die fertigen Zeitpunkte (Merkmale + Labels) in muster_archiv; spätere Trainings
 * nehmen sie dazu, auch wenn die Ticks nach 7 Tagen gelöscht sind. Fairer Vergleich (altes Modell auf denselben Testdaten,
 * e236-muster-ziele), Status zeigt Archiv und neuesten Lauf, „🧠 Muster-RL“ läuft von selbst auf Paper.
 */
const MINUTE = 60_000;
const TAG = 86_400_000;

function datenEinspielen(db: KDB, o: { tokens: number; start: number; dauerMs: number; saat: number }) {
  let s = o.saat;
  const zufall = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const tok = db.prepare('INSERT OR IGNORE INTO tokens (mint, symbol, name, erstellt, creator) VALUES (?, ?, ?, ?, ?)');
  const tick = db.prepare('INSERT INTO strom_ticks (mint, zeit, preis, sol, echt_sol) VALUES (?, ?, ?, ?, ?)');
  db.transaction(() => {
    for (let i = 0; i < o.tokens; i++) {
      const mint = `Ar${o.saat}x${i}x`.padEnd(44, 'A');
      const erstellt = o.start + i * MINUTE;
      tok.run(mint, `A${i}`, 'Arch', erstellt, `Dev${i % 5}`);
      const hoch = i % 2 === 0;
      let preis = 3e-8;
      let echt = 5;
      for (let t = erstellt; t < erstellt + o.dauerMs; t += 2000) {
        preis *= Math.exp(hoch ? 0.0016 : -0.0013);
        const sol = hoch ? 0.3 + zufall() * 0.1 : -0.3 - zufall() * 0.1;
        echt = Math.max(0.1, echt + sol);
        tick.run(mint, t, preis, sol, echt);
      }
    }
  })();
}
const anzahl = (db: KDB, sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { n: number }).n;
const fertig = async (m: MusterDienst) => {
  for (let i = 0; i < 200_000 && m.status().training.laeuft; i++) await new Promise((r) => setImmediate(r));
  expect(m.status().training.laeuft).toBe(false);
};

describe('Muster-Archiv (E241)', () => {
  it('legt fertige Zeitpunkte ab und nimmt sie nach dem Löschen der Ticks wieder dazu', async () => {
    const uhr = new TestUhr();
    const db = kryptoDb(':memory:');
    datenEinspielen(db, { tokens: 24, start: uhr.jetzt() - 2 * TAG, dauerMs: 10 * MINUTE, saat: 3 });
    // junge Ticks (< 30 min alt) kommen noch nicht ins Archiv – ihre Labels sind evtl. noch nicht vollständig
    datenEinspielen(db, { tokens: 2, start: uhr.jetzt() - 12 * MINUTE, dauerMs: 10 * MINUTE, saat: 4 });
    const gelesen: number[] = [];
    const zeilen: KryptoKonsoleZeile[] = [];
    const trainer: Trainer = async (d, o) =>
      musterTrainieren(d, {
        ...o,
        archiv: async (n) => {
          const r = await o.archiv!(n);
          gelesen.push(r.length);
          return r;
        },
        log: (z) => {
          zeilen.push(z);
          o.log?.(z);
        },
      });
    const m = new MusterDienst({ db, uhr, trainer });
    m.trainingStarten();
    await fertig(m);
    const n1 = anzahl(db, 'SELECT COUNT(*) AS n FROM muster_archiv');
    expect(n1).toBeGreaterThan(1000);
    expect(anzahl(db, 'SELECT COUNT(*) AS n FROM muster_archiv WHERE zeit > ?', uhr.jetzt() - 30 * MINUTE)).toBe(0);
    expect(anzahl(db, 'SELECT COUNT(*) AS n FROM muster_archiv WHERE kennung != ?', ARCHIV_KENNUNG)).toBe(0);
    // 1. Lauf: nichts vor dem Fenster
    expect(gelesen).toEqual([0]);
    const s1 = m.status();
    expect(s1.archiv?.beispiele).toBe(n1);
    expect(s1.letzterLauf?.version).toBe(1);
    expect(s1.letzterLauf!.beispiele).toBeGreaterThan(0);

    // 8 Tage später: alte Ticks sind weg (motor.ts löscht nach 7 Tagen), dazu neue Aufzeichnung
    uhr.vor(8 * TAG);
    db.prepare('DELETE FROM strom_ticks').run();
    datenEinspielen(db, { tokens: 24, start: uhr.jetzt() - 1 * TAG, dauerMs: 10 * MINUTE, saat: 5 });
    m.trainingStarten();
    await fertig(m);
    // das Archiv aus Lauf 1 ist dabei – alles, was je aufgezeichnet wurde
    expect(gelesen[1]).toBe(n1);
    expect(zeilen.map((z) => z.text).join('\n')).toMatch(/[\d.]+ ältere Beispiele aus dem Archiv dazu/);
    const s2 = m.status();
    expect(s2.letzterLauf!.version).toBe(2);
    expect(s2.letzterLauf!.beispiele + s2.letzterLauf!.testBeispiele).toBeGreaterThan(s1.letzterLauf!.beispiele + s1.letzterLauf!.testBeispiele);
    expect(anzahl(db, 'SELECT COUNT(*) AS n FROM muster_archiv')).toBeGreaterThan(n1);
  }, 240_000);

  it('Archiv mit alter Kennung wird geleert; Grenze kürzt die ältesten', async () => {
    const uhr = new TestUhr();
    const db = kryptoDb(':memory:');
    datenEinspielen(db, { tokens: 6, start: uhr.jetzt() - 3 * TAG, dauerMs: 6 * MINUTE, saat: 7 });
    const x = Buffer.from(new Float32Array(3).buffer);
    db.prepare('INSERT INTO muster_archiv (mint, zeit, alter_ms, preis, x, y, kennung) VALUES (?, ?, ?, ?, ?, ?, ?)').run('Alt', uhr.jetzt() - 20 * TAG, 1, 1, x, x, 'veraltet');
    const m = new MusterDienst({ db, uhr, archivHoechstens: 100 });
    m.trainingStarten();
    await fertig(m);
    expect(anzahl(db, "SELECT COUNT(*) AS n FROM muster_archiv WHERE kennung = 'veraltet'")).toBe(0);
    const n = anzahl(db, 'SELECT COUNT(*) AS n FROM muster_archiv');
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(100);
    const konsole = m.konsoleLesen().zeilen.map((z) => z.text).join('\n');
    expect(konsole).toContain('Archiv-Beispiele gelöscht');
    expect(konsole).toContain('Archiv gekürzt');
  }, 120_000);
});

describe('Muster-RL läuft von selbst auf Paper (E241)', () => {
  const aufbau = (db = kryptoDb(':memory:')) => {
    const uhr = new TestUhr();
    const dex = { async paare() { return { schnappschuesse: [], solUsd: 140 }; } } as unknown as DexScreener;
    const rug = { bereit: () => false } as unknown as RugCheck;
    const muster = new MusterDienst({ db, uhr });
    return { db, werk: new Kryptowerk({ db, uhr, dex, rug, muster }) };
  };

  it('legt einmal „Muster-RL“ an (Paper, RL) – gelöscht bleibt er weg', async () => {
    const { werk } = aufbau();
    await werk.takt();
    await werk.takt();
    const rl = werk.uebersicht().bots.filter((b) => b.einstellung.art === 'rl');
    expect(rl).toHaveLength(1);
    expect(rl[0]!.einstellung.name).toBe('Muster-RL');
    expect(rl[0]!.modus).toBe('paper');
    werk.loeschen(rl[0]!.id);
    await werk.takt();
    expect(werk.uebersicht().bots.filter((b) => b.einstellung.art === 'rl')).toHaveLength(0);
    werk.beenden();
  });

  it('gibt es schon einen RL-Bot, kommt kein zweiter', async () => {
    const { werk } = aufbau();
    werk.anlegen({ ...(await import('@dorf/shared')).KRYPTO_STANDARD, name: 'Eigener RL', art: 'rl' });
    await werk.takt();
    expect(werk.uebersicht().bots.filter((b) => b.einstellung.art === 'rl').map((b) => b.einstellung.name)).toEqual(['Eigener RL']);
    werk.beenden();
  });
});
