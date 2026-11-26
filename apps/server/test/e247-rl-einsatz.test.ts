import { describe, expect, it } from 'vitest';
import { RL_EINSATZ_MIN_ANTEIL, RL_EINSATZ_SOL, rlEinsatz, rlZeitraffer, type RlEpisode } from '../src/krypto/muster/rl.js';
import type { KryptoRlEinstieg } from '@dorf/shared';
import type { RlModell } from '../src/krypto/muster/typen.js';

/** E247: Einsatz des RL-Agenten nach Sicherheit und vorhergesagtem Kurs – 20 … 100 % (live: des Bot-Limits) */
const lage = (o: object) => ({ p: 0, haelt: false, plusProzent: 0, haltSek: 0, trend30Prozent: 0, ...o });
const einstieg = (o: Partial<KryptoRlEinstieg> = {}): KryptoRlEinstieg => ({ signal: 'pump', schwelle: 0.2, anteil: 0.1, wahl: { trades: 20, gewinnSol: 0.2 }, pruef: { trades: 12, gewinnSol: 0.1 }, bestaetigt: true, ...o });

describe('rlEinsatz (E247)', () => {
  it('mehr Einsatz bei hoher Sicherheit und gutem Kurs, weniger bei 💥 oder schwachem Kurs, immer 20–100 %', () => {
    const e = einstieg();
    const voll = rlEinsatz(lage({ pump: 1, v5m: 30 }), e);
    expect(voll.anteil).toBeCloseTo(1, 5);
    expect(voll.text).toBe('Einsatz 100 % (sicher 100 %, Kurs +30,0 %)');
    // knapp über der Schwelle, Kurs unter den Gebühren → Minimum
    expect(rlEinsatz(lage({ pump: 0.2, v5m: 1 }), e).anteil).toBeCloseTo(RL_EINSATZ_MIN_ANTEIL, 5);
    // ohne Kursmodell neutral (0,5)
    expect(rlEinsatz(lage({ pump: 1 }), e).anteil).toBeCloseTo(0.2 + 0.8 * 0.75, 5);
    // 💥 senkt die Sicherheit
    expect(rlEinsatz(lage({ pump: 1, v5m: 30, absturz: 0.5 }), e).anteil).toBeCloseTo(0.2 + 0.8 * 0.75, 5);
    // Ertrag je Trade geht vor der Kursvorhersage
    expect(rlEinsatz(lage({ pump: 1, v5m: 30, ertragWert: 3.5 }), e).erwartetProzent).toBe(3.5);
    // Prozent-Signal: je 10 %-Punkte über der Schwelle
    expect(rlEinsatz(lage({ v1m: 9 }), einstieg({ signal: 'v1m', schwelle: 4 })).sicherheit).toBeCloseTo(5 / 14, 5);
    // ohne Regel: stärkstes Signal
    expect(rlEinsatz(lage({ p: 0.3, pump: 0.6 }), null).sicherheit).toBeCloseTo(0.6, 5);
    for (const x of [lage({}), lage({ pump: 5, v5m: 999 }), lage({ pump: -1, v5m: -999, absturz: 2 })]) {
      const a = rlEinsatz(x, e).anteil;
      expect(a).toBeGreaterThanOrEqual(RL_EINSATZ_MIN_ANTEIL);
      expect(a).toBeLessThanOrEqual(1);
    }
  });

  it('Zeitraffer staffelt den Einsatz (Regelwahl/Vergleich gleich groß)', async () => {
    const halten: RlModell = { version: 1, q: new Proxy({}, { get: (_z, k) => (String(k).startsWith('h|') ? [1, 0, 0, 0] : [0, 0, 0, 0]) }) as Record<string, number[]>, einstieg: einstieg({ signal: 'v1m', schwelle: 4 }) };
    const ep: RlEpisode[] = [0, 1].map((k) =>
      Array.from({ length: 30 }, (_, i) => ({ zeit: k * 1e6 + i * 5000, mint: `M${k}`, preis: 1e-7 * (1 + 0.01 * i), p: 0, trend30Prozent: 0, v1m: k ? 24 : 5 })),
    );
    const g = { minSicherheit: 0.6, erkunden: 0, nachschuss: true };
    const gestaffelt = await rlZeitraffer(halten, ep, g);
    const flach = await rlZeitraffer(halten, ep, g, undefined, undefined, false);
    expect(gestaffelt.trades).toBe(2);
    expect(flach.eingesetztSol).toBeCloseTo(2 * RL_EINSATZ_SOL, 6);
    // v1m 5 → wenig, v1m 24 → viel (Sicherheit und Kurs)
    const a = rlEinsatz(lage({ v1m: 5 }), halten.einstieg).anteil;
    const b = rlEinsatz(lage({ v1m: 24 }), halten.einstieg).anteil;
    expect(b).toBeGreaterThan(a);
    expect(gestaffelt.eingesetztSol).toBeCloseTo(RL_EINSATZ_SOL * (a + b), 6);
  });
});
