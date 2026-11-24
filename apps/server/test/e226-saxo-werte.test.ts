import { describe, expect, it } from 'vitest';
import { saxoWertWaehlen, werteErgaenzen } from '../src/saxo.js';

/** E226: Saxo meldet MarketValueInBaseCurrency bei manchen ETFs als 0 → Wert aus Stück × Kurs × Umrechnung */
describe('E226 Saxo-Positionswerte', () => {
  it('nimmt den ersten Wert ungleich 0', () => {
    expect(saxoWertWaehlen({ MarketValueInBaseCurrency: 0, ExposureInBaseCurrency: 4321 }, 'EUR', 'CHF').wert).toBe(4321);
    expect(saxoWertWaehlen({ MarketValueInBaseCurrency: 0, MarketValue: 500 }, 'CHF', 'CHF').wert).toBe(500);
    // MarketValue in fremder Währung ist kein Wert in Kontowährung
    expect(saxoWertWaehlen({ MarketValueInBaseCurrency: 0, MarketValue: 500 }, 'EUR', 'CHF').wert).toBeUndefined();
    // Umrechnung aus Gewinn/Verlust in beiden Währungen
    expect(saxoWertWaehlen({ ProfitLossOnTradeInBaseCurrency: 93, ProfitLossOnTrade: 100 }, 'EUR', 'CHF').fx).toBeCloseTo(0.93);
  });

  it('rechnet mit bekannter Umrechnung nach und markiert es', () => {
    const r = werteErgaenzen([{ name: 'ETF', waehrung: 'EUR', stueck: 10, kurs: 100, wert: 0, einstand: 80, fx: 0.93 } as never], 'CHF', null);
    expect(r[0]).toMatchObject({ wert: 930, geschaetzt: true, gewinn: 186 });
  });

  it('verteilt sonst Kontowert − Bargeld anteilig (wie bei Leifs Depot: alle ETFs in EUR, Konto in CHF)', () => {
    const r = werteErgaenzen(
      [
        { name: 'A', waehrung: 'EUR', stueck: 10, kurs: 300, wert: 0 },
        { name: 'B', waehrung: 'EUR', stueck: 20, kurs: 50, wert: 0 },
      ],
      'CHF',
      3720,
    );
    expect(r.map((p) => p.wert)).toEqual([2790, 930]);
    expect(r.every((p) => p.geschaetzt)).toBe(true);
  });

  it('lässt echte Werte und Positionen ohne Kurs in Ruhe', () => {
    const r = werteErgaenzen([{ name: 'A', waehrung: 'CHF', stueck: 1, kurs: 10, wert: 12 }, { name: 'B', wert: 0 }], 'CHF', 100);
    expect(r[0]).toEqual({ name: 'A', waehrung: 'CHF', stueck: 1, kurs: 10, wert: 12 });
    expect(r[1]!.wert).toBe(0);
  });

  it('gleiche Währung wie das Konto: Stück × Kurs', () => {
    expect(werteErgaenzen([{ name: 'A', waehrung: 'CHF', stueck: 3, kurs: 10, wert: 0 }], 'CHF', null)[0]!.wert).toBe(30);
  });
});
