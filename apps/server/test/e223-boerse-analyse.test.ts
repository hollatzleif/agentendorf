import { describe, expect, it } from 'vitest';
import type { BoerseAnalyse } from '@dorf/shared';
import { ABRUFE_PRO_TAG, saxoZuEodhd, waehrungVon, type BoerseKlient } from '../src/boerse.js';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';

/** E223: Kursverläufe (EODHD) im Tageslimit, Saxo-Symbol → Kürzel, Analyse-Endpunkt */
function klient() {
  const abrufe: string[] = [];
  const k: BoerseKlient = {
    async eod(symbol) {
      abrufe.push(`eod ${symbol}`);
      return [
        { datum: '2026-11-16', kurs: 110 },
        { datum: '2026-11-13', kurs: 100 },
      ];
    },
    async suche() {
      return null;
    },
    async historie(symbol, von) {
      abrufe.push(`historie ${symbol} ${von}`);
      if (symbol === 'GIBTS.NICHT') throw new Error('EODHD antwortet mit 404.');
      return [
        { datum: '2025-11-17', kurs: 80 },
        { datum: '2026-06-01', kurs: 95 },
        { datum: '2026-11-13', kurs: 100 },
      ];
    },
  };
  return { k, abrufe };
}

describe('Börse-Analyse (E223)', () => {
  it('Saxo-Symbol → EODHD-Kürzel und Währung', () => {
    expect(saxoZuEodhd('NESN:xswx')).toBe('NESN.SW');
    expect(saxoZuEodhd('VWCE:xetr')).toBe('VWCE.XETRA');
    expect(saxoZuEodhd('AAPL:xnas')).toBe('AAPL.US');
    expect(saxoZuEodhd('BRK.B:xnys')).toBe('BRK-B.US');
    expect(saxoZuEodhd('XYZ:xxxx')).toBeNull();
    expect(saxoZuEodhd('Unsinn')).toBeNull();
    expect(waehrungVon('NESN.SW')).toBe('CHF');
    expect(waehrungVon('SHEL.LSE')).toBe('GBP');
  });

  it('Kursverläufe: nebenbei nach den Tageskursen, Tageskurse verlängern den Verlauf, Fehler kosten nicht jeden Tag', async () => {
    const x = klient();
    const d = await testDorf({ boerse: x.k });
    const h = await kopf(d);
    const neu = (data: Record<string, unknown>) => d.app.inject({ method: 'POST', url: '/api/boerse/wert', headers: h, payload: data });
    await neu({ art: 'positionen', neu: { name: 'Vanguard', symbol: 'VWCE.XETRA', stueck: 10, einstand: 90 } });
    await neu({ art: 'watchlist', neu: { name: 'Gibts nicht', symbol: 'GIBTS.NICHT' } });
    await d.boerse.aktualisieren();
    expect(x.abrufe).toEqual(['eod VWCE.XETRA', 'eod GIBTS.NICHT', 'historie VWCE.XETRA 2021-11-17', 'historie GIBTS.NICHT 2021-11-17']);
    expect(d.boerse.historie('VWCE.XETRA')!.punkte).toEqual([
      ['2025-11-17', 80],
      ['2026-06-01', 95],
      ['2026-11-13', 100],
    ]);
    expect(d.boerse.historie('GIBTS.NICHT')!.punkte).toEqual([]);
    // E226: der Grund bleibt je Kürzel stehen (App zeigt ihn bei der Zuordnung)
    expect(d.boerse.historieFehler()).toEqual({ 'GIBTS.NICHT': 'EODHD antwortet mit 404.' });
    expect(d.boerse.letzterKurs('VWCE.XETRA')).toEqual({ kurs: 110, datum: '2026-11-16', waehrung: 'EUR' });
    // nächster Tag: Tageskurs verlängert den Verlauf; der Fehlschlag wird erst nach 7 Tagen neu versucht
    d.uhr.vor(86_400_000);
    x.abrufe.length = 0;
    await d.boerse.aktualisieren();
    expect(x.abrufe).toEqual(['eod VWCE.XETRA', 'eod GIBTS.NICHT']);
    expect(d.boerse.historie('VWCE.XETRA')!.punkte.at(-1)).toEqual(['2026-11-16', 110]);
    // Analyse: eigenes Depot + Verlauf (leere Verläufe fehlen)
    const a = (await d.app.inject({ url: '/api/boerse/analyse', headers: h })).json() as BoerseAnalyse;
    expect(a.eigen.map((p) => p.name)).toEqual(['Vanguard']);
    // der Fehlschlag hat jetzt nur die Tageskurse – sein voller Verlauf wird nach 7 Tagen erneut versucht
    expect(Object.keys(a.historien).sort()).toEqual(['GIBTS.NICHT', 'VWCE.XETRA']);
    d.uhr.vor(7 * 86_400_000);
    x.abrufe.length = 0;
    await d.boerse.aktualisieren();
    expect(x.abrufe).toContain('historie GIBTS.NICHT 2026-11-16');
    expect(a.saxo).toBeNull();
  });

  it('Leifs Klick lädt gezielt; Tageslimit wird nie überschritten; Kürzel prüfen und zuordnen', async () => {
    const x = klient();
    const d = await testDorf({ boerse: x.k });
    const h = await kopf(d);
    for (let i = 0; i < ABRUFE_PRO_TAG - 1; i++) d.db.prepare('INSERT INTO boerse_abrufe (tag, anzahl) VALUES (?, 1) ON CONFLICT(tag) DO UPDATE SET anzahl = anzahl + 1').run('2026-11-16');
    // E226: Umrechnung über EZB-Kurse (Einheiten je Euro)
    d.db.prepare('INSERT INTO boerse_wechselkurse (waehrung, datum, je_eur, abgerufen) VALUES (?, ?, ?, ?)').run('CHF', '2026-11-13', 0.93, 0);
    expect(d.boerse.umrechnung('EUR', 'CHF')).toBeCloseTo(0.93);
    expect(d.boerse.umrechnung('CHF', 'EUR')).toBeCloseTo(1 / 0.93);
    expect(d.boerse.umrechnung('USD', 'CHF')).toBeUndefined();
    const r = (await d.app.inject({ method: 'POST', url: '/api/boerse/historie', headers: h, payload: { kuerzel: ['AAA.US', 'BBB.US', 'kaputt'] } })).json();
    expect(r).toMatchObject({ geholt: 1, offen: 1 });
    expect(x.abrufe).toEqual(['historie AAA.US 2021-11-17']);
    expect((await d.app.inject({ method: 'PUT', url: '/api/boerse/kuerzel', headers: h, payload: { saxo: 'X:xxxx', kuerzel: 'nicht gut' } })).statusCode).toBe(400);
    expect((await d.app.inject({ method: 'PUT', url: '/api/boerse/kuerzel', headers: h, payload: { saxo: 'NESN:xswx', kuerzel: 'nesn.vx' } })).statusCode).toBe(200);
    expect(d.boerse.zuordnung(['NESN:xswx', 'VWCE:xetr', 'Q:zzzz'])).toEqual({ 'NESN:xswx': { kuerzel: 'NESN.VX', eigen: true }, 'VWCE:xetr': { kuerzel: 'VWCE.XETRA', eigen: false } });
    await d.app.inject({ method: 'PUT', url: '/api/boerse/kuerzel', headers: h, payload: { saxo: 'NESN:xswx', kuerzel: '' } });
    expect(d.boerse.zuordnung(['NESN:xswx'])['NESN:xswx']).toEqual({ kuerzel: 'NESN.SW', eigen: false });
  });
});

describe('Börse-Rechnungen (E223, shared)', async () => {
  const b = await import('@dorf/shared');
  it('Zeiträume und Ausschnitt mit Startwert', () => {
    expect(b.zeitraumVon('1M', '2026-03-31')).toBe('2026-03-03');
    expect(b.zeitraumVon('YTD', '2026-11-24')).toBe('2025-12-31');
    expect(b.zeitraumVon('MAX', '2026-11-24')).toBeNull();
    const p: [string, number][] = [['2026-01-01', 1], ['2026-01-05', 2], ['2026-01-10', 3]];
    expect(b.schneiden(p, '2026-01-06')).toEqual([['2026-01-05', 2], ['2026-01-10', 3]]);
    expect(b.schneiden(p, null, '2026-01-05')).toEqual(p.slice(0, 2));
  });
  it('Kennzahlen: Änderung, Hoch/Tief, größter Rückgang, beste/schlechteste Tage; TWR statt Wert bei Einzahlungen', () => {
    const p: [string, number][] = [['2026-01-01', 100], ['2026-01-02', 110], ['2026-01-03', 88], ['2026-01-04', 99], ['2026-01-05', 120]];
    const k = b.kennzahlen(p)!;
    expect(k.differenz).toBe(20);
    expect(k.prozent).toBeCloseTo(0.2);
    expect(k.hoch).toEqual({ wert: 120, datum: '2026-01-05' });
    expect(k.maxRueckgang).toEqual({ anteil: expect.closeTo(-0.2, 5), von: '2026-01-02', bis: '2026-01-03' });
    expect(k.besterTag!.datum).toBe('2026-01-05');
    expect(k.schlechtesterTag!.datum).toBe('2026-01-03');
    expect(k.plusTage).toBe(0.75);
    // 1000 € eingezahlt am 3.: Wert springt, Rendite nicht
    const r: [string, number][] = [['2026-01-01', 0], ['2026-01-02', 0.1], ['2026-01-03', 0.1]];
    const k2 = b.kennzahlen([['2026-01-01', 100], ['2026-01-02', 110], ['2026-01-03', 1110]], r)!;
    expect(k2.prozent).toBeCloseTo(0.1);
    expect(k2.besterTag!.anteil).toBeCloseTo(0.1);
  });
  it('Monatsrenditen, Summe, auf 100', () => {
    const m = b.monatsRenditen([['2025-12-31', 100], ['2026-01-15', 105], ['2026-01-31', 110], ['2026-02-28', 99]]);
    expect(m[2026]![1]).toBeCloseTo(0.1);
    expect(m[2026]![2]).toBeCloseTo(-0.1);
    expect(b.jahresRendite(m[2026]!)).toBeCloseTo(-0.01);
    expect(b.summieren([[['2026-01-01', 1], ['2026-01-03', 2]], [['2026-01-02', 10]]])).toEqual([['2026-01-01', 1], ['2026-01-02', 11], ['2026-01-03', 12]]);
    expect(b.aufHundert([['a', 50], ['b', 75]])).toEqual([['a', 100], ['b', 150]]);
  });
  it('Rechner: Sparplan, Entnahme, Rebalancing, Kosten, Konzentration', () => {
    const s = b.sparplan({ start: 0, monatlich: 100, jahre: 1, rendite: 0 });
    expect(s[0]).toMatchObject({ eingezahlt: 1200, wert: 1200, ertrag: 0 });
    expect(b.sparplan({ start: 1000, monatlich: 0, jahre: 2, rendite: 0.1 })[1]!.wert).toBeCloseTo(1210);
    expect(b.entnahme({ kapital: 1200, monatlich: 100, rendite: 0 }).monate).toBe(12);
    expect(b.entnahme({ kapital: 1_000_000, monatlich: 100, rendite: 0.05 }).monate).toBeNull();
    const rb = b.rebalancing([{ name: 'A', wert: 80, ziel: 50 }, { name: 'B', wert: 20, ziel: 50 }]);
    expect(rb.map((x) => x.aenderung)).toEqual([-30, 30]);
    const nk = b.rebalancing([{ name: 'A', wert: 80, ziel: 50 }, { name: 'B', wert: 20, ziel: 50 }], 40, true);
    expect(nk.map((x) => x.aenderung)).toEqual([0, 40]);
    expect(b.kostenEffekt({ betrag: 10000, jahre: 10, rendite: 0.06, ter: 0.01 }).kosten).toBeGreaterThan(1000);
    expect(b.konzentration([50, 25, 25])).toMatchObject({ groesste: 0.5, top3: 1 });
    expect(b.verdopplungJahre(0.07)).toBeCloseTo(10.24, 1);
  });
});

describe('Börse-Berater (E223): Vorlagen-Aktionen sind gültig', () => {
  it('Aktie analysieren, ETF vergleichen, Depot-Check, Frag den Berater – mit Web, über das Abo', async () => {
    const { aktionLaden } = await import('../src/agenten/aktionen.js');
    const d = await testDorf();
    for (const id of ['Boerse/aktie-analysieren', 'Boerse/etf-vergleichen', 'Boerse/depot-check', 'Boerse/berater-frage']) {
      const a = await aktionLaden(d.vault, id);
      expect(a.fehler, id).toBeUndefined();
      expect(a).toMatchObject({ motor: 'claude-code', stufe: 'gross' });
      expect(a.werkzeuge).toContain('web');
    }
  });
});

describe('Börse-Rechnungen 2 (E224)', async () => {
  const b = await import('@dorf/shared');
  const tage = Array.from({ length: 60 }, (_, i) => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
  it('Korrelation: gleich = 1, gespiegelt = −1, zu wenig Tage = null', () => {
    const a: [string, number][] = tage.map((d, i) => [d, 100 + Math.sin(i) * 5 + i]);
    const gespiegelt: [string, number][] = a.map(([d, v], i) => [d, i ? 2 * a[0]![1] * (a[i - 1]![1] / a[0]![1]) * 0 + (200 - v) : 200 - v]);
    expect(b.korrelation(a, a)).toBeCloseTo(1);
    expect(b.korrelation(a, gespiegelt)!).toBeLessThan(-0.9);
    expect(b.korrelation(a.slice(0, 10), a.slice(0, 10))).toBeNull();
  });
  it('Was wäre wenn: Einmalbetrag und monatlich', () => {
    const p: [string, number][] = [['2026-01-02', 10], ['2026-01-15', 12], ['2026-02-02', 20], ['2026-03-02', 40]];
    const r = b.wasWaereWenn(p, { von: '2026-01-01', einmal: 100, monatlich: 0 })!;
    expect(r).toMatchObject({ start: '2026-01-02', ende: '2026-03-02', eingezahlt: 100, wert: 400, gewinn: 300 });
    const m = b.wasWaereWenn(p, { von: '2026-01-01', einmal: 0, monatlich: 40 })!;
    // Jan: 4 Stück, Feb: 2, Mär: 1 → 7 × 40 = 280
    expect(m.eingezahlt).toBe(120);
    expect(m.wert).toBeCloseTo(280);
    expect(b.wasWaereWenn(p, { von: '2027-01-01', einmal: 1, monatlich: 0 })).toBeNull();
  });
});
