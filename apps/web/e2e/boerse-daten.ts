import type { BoerseAnalyse } from '@dorf/shared';

/** E223: nachgebaute Analyse-Daten (Saxo-Konto 3 Jahre, 4 Positionen mit Kursverlauf, eigenes Depot, Watchlist) – fest, ohne Zufall */
export function analyseDaten(heute = new Date().toISOString().slice(0, 10)): BoerseAnalyse {
  const tage: string[] = [];
  const ende = Date.parse(`${heute}T12:00:00Z`);
  for (let t = ende - 3 * 365 * 86_400_000; t <= ende; t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) tage.push(d.toISOString().slice(0, 10));
  }
  const welle = (i: number, a: number, f: number, trend: number, start: number) => start * (1 + trend * i + a * Math.sin(i / f) + 0.6 * a * Math.sin(i / (f * 0.37)));
  const kurs = (trend: number, a: number, f: number, start: number) => tage.map((d, i) => [d, Math.round(welle(i, a, f, trend, start) * 100) / 100] as [string, number]);
  const nesn = kurs(-0.0002, 0.05, 30, 100);
  const vwce = kurs(0.0006, 0.04, 45, 95);
  const aapl = kurs(0.0009, 0.07, 25, 150);
  const msft = kurs(0.0008, 0.06, 35, 300);
  const letzter = (r: [string, number][]) => r.at(-1)![1];
  const pos = [
    { name: 'Vanguard FTSE All-World', symbol: 'VWCE:xetr', art: 'Etf', waehrung: 'EUR', stueck: 80, kurs: letzter(vwce), faktor: 1, einstand: 100 },
    { name: 'Apple Inc.', symbol: 'AAPL:xnas', art: 'Stock', waehrung: 'USD', stueck: 12, kurs: letzter(aapl), faktor: 0.92, einstand: 160 },
    { name: 'Microsoft Corp.', symbol: 'MSFT:xnas', art: 'Stock', waehrung: 'USD', stueck: 6, kurs: letzter(msft), faktor: 0.92, einstand: 330 },
    { name: 'Nestlé SA', symbol: 'NESN:xswx', art: 'Stock', waehrung: 'CHF', stueck: 25, kurs: letzter(nesn), faktor: 1.06, einstand: 105 },
  ].map((p) => ({ name: p.name, symbol: p.symbol, art: p.art, waehrung: p.waehrung, stueck: p.stueck, kurs: p.kurs, einstand: p.einstand, wert: Math.round(p.kurs * p.stueck * p.faktor * 100) / 100, gewinn: Math.round((p.kurs - p.einstand) * p.stueck * p.faktor * 100) / 100, tagProzent: p.symbol.startsWith('AAPL') ? 2.4 : -0.6 }));
  const bar = 1250;
  const gesamt = pos.reduce((s, p) => s + p.wert, 0) + bar;
  // Kontowert: Summe der Verläufe × Stück, dazu Einzahlungen (Sprünge) – die Rendite-Reihe bleibt davon unberührt
  const verlauf = tage.map((d, i) => {
    const w = vwce[i]![1] * 80 + aapl[i]![1] * 12 * 0.92 + msft[i]![1] * 6 * 0.92 + nesn[i]![1] * 25 * 1.06 + bar - (i < tage.length / 2 ? 3000 : 0);
    return { datum: d, wert: Math.round(w * 100) / 100 };
  });
  let r = 0;
  const mitRendite = verlauf.map((v, i) => {
    if (i) {
      const ohneSprung = (vwce[i]![1] * 80 + aapl[i]![1] * 11.04 + msft[i]![1] * 5.52 + nesn[i]![1] * 26.5) / (vwce[i - 1]![1] * 80 + aapl[i - 1]![1] * 11.04 + msft[i - 1]![1] * 5.52 + nesn[i - 1]![1] * 26.5);
      r = (1 + r) * ohneSprung - 1;
    }
    return { ...v, rendite: Math.round(r * 10000) / 10000 };
  });
  mitRendite[mitRendite.length - 1]!.wert = Math.round(gesamt * 100) / 100;
  return {
    saxo: { verbunden: true, waehrung: 'EUR', verlauf: mitRendite, tage: [], positionen: pos, bar, gesamt },
    eigen: [{ index: 0, name: 'iShares Core MSCI EM', symbol: 'IS3N.XETRA', stueck: 100, einstand: 28, kurs: 31.2, waehrung: 'EUR', wertEur: 3120, gewinnEur: 320, gewinnProzent: 11.4 }],
    watchlist: [{ index: 0, name: 'ASML', symbol: 'ASML.AS', kurs: 640, waehrung: 'EUR' }],
    historien: {
      'VWCE.XETRA': { waehrung: 'EUR', punkte: vwce, stand: heute },
      'AAPL.US': { waehrung: 'USD', punkte: aapl, stand: heute },
      'MSFT.US': { waehrung: 'USD', punkte: msft, stand: heute },
      'NESN.SW': { waehrung: 'CHF', punkte: nesn, stand: heute },
      'IS3N.XETRA': { waehrung: 'EUR', punkte: kurs(0.0003, 0.05, 40, 26), stand: heute },
      'ASML.AS': { waehrung: 'EUR', punkte: kurs(0.0007, 0.09, 28, 500), stand: heute },
    },
    zuordnung: { 'VWCE:xetr': { kuerzel: 'VWCE.XETRA', eigen: false }, 'AAPL:xnas': { kuerzel: 'AAPL.US', eigen: false }, 'MSFT:xnas': { kuerzel: 'MSFT.US', eigen: false }, 'NESN:xswx': { kuerzel: 'NESN.SW', eigen: false } },
    eodhd: true,
    abrufeHeute: 4,
    abrufeMax: 19,
  };
}
