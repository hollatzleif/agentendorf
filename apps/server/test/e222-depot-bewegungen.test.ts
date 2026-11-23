import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEPOT_WERKZEUGE, werkzeugprofil } from '../src/agenten/leine.js';
import { aktionLaden } from '../src/agenten/aktionen.js';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';

/**
 * E222: Tagesstände des Saxo-Depots, Bewegungen je Tag (Kurse, Wert, Käufe/Verkäufe), Werkzeuge depot_* für Agenten und
 * „📈 Saxo gestern“ ganz unten in der Morgenzeitung (Zahlen vom Code, „Warum“ aus dem Tagesbericht des Börsen-Helfers).
 * TestUhr: Mo, 16.11.2026 12:00 UTC.
 */
const AUTH = 'https://live.logonvalidation.net';
const API = 'https://gateway.saxobank.com/openapi';
const TAG = 86_400_000;
type Pos = { id: string; name: string; symbol: string; stueck: number; kurs: number; wert: number; tag?: number };

function saxo() {
  const depot: { gesamt: number; pos: Pos[] } = {
    gesamt: 12500,
    pos: [
      { id: 'NESN', name: 'Nestlé SA', symbol: 'NESN:xswx', stueck: 50, kurs: 80, wert: 4000, tag: -1.2 },
      { id: 'VWCE', name: 'Vanguard FTSE All-World', symbol: 'VWCE:xetr', stueck: 60, kurs: 125, wert: 7500, tag: 0.5 },
    ],
  };
  let n = 0;
  const holen = (async (eingabe: string | URL | Request, init: RequestInit = {}) => {
    const url = String(eingabe);
    const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url === `${AUTH}/token`) {
      n++;
      return json({ access_token: `a${n}`, expires_in: 1200, refresh_token: `r${n}`, refresh_token_expires_in: 2400 });
    }
    void init;
    const pfad = new URL(url).pathname.replace('/openapi', '');
    if (pfad === '/port/v1/clients/me') return json({ ClientKey: 'CK', DefaultCurrency: 'EUR' });
    if (pfad === '/port/v1/balances/me') return json({ TotalValue: depot.gesamt, CashBalance: 1000, Currency: 'EUR' });
    if (pfad === '/port/v1/netpositions/me')
      return json({
        Data: depot.pos.map((p) => ({
          NetPositionId: p.id,
          NetPositionBase: { Amount: p.stueck, AssetType: 'Stock' },
          NetPositionView: { CurrentPrice: p.kurs, MarketValueInBaseCurrency: p.wert, InstrumentPriceDayPercentChange: p.tag },
          DisplayAndFormat: { Description: p.name, Symbol: p.symbol, Currency: 'EUR' },
        })),
      });
    if (pfad === '/hist/v4/performance/timeseries') return json({ Balance: { AccountValue: [{ Date: '2026-11-13T00:00:00Z', Value: 12400 }] }, TimeWeighted: { Accumulated: [] } });
    if (url.startsWith(API)) return new Response('{}', { status: 404 });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { holen, depot };
}

async function aufbau() {
  const s = saxo();
  const d = await testDorf({ saxoHolen: s.holen, env: { SAXO_APP_KEY: 'APPKEY', SAXO_APP_SECRET: 'APPSECRET' } });
  const h = await kopf(d);
  const { url } = (await d.app.inject({ method: 'POST', url: '/api/boerse/saxo/anmelden', headers: h })).json() as { url: string };
  await d.app.inject({ url: `/api/boerse/saxo/rueckruf?code=CODE1&state=${encodeURIComponent(new URL(url).searchParams.get('state')!)}` });
  await d.saxo.aktualisieren(true);
  return { d, s };
}

/** Zeit vorstellen wie auf dem Server: das Dorf erneuert die Saxo-Sitzung laufend (sonst verfällt das Refresh-Token) */
async function vor(x: Awaited<ReturnType<typeof aufbau>>, ms: number) {
  for (let r = ms; r > 0; r -= 10 * 60_000) {
    x.d.uhr.vor(Math.min(r, 10 * 60_000));
    await x.d.saxo.erneuern();
  }
}

/** Montag (16.) wie oben; Dienstag (17.): Nestlé +5 %, 10 VWCE gekauft, Apple neu */
async function zweiTage(x: Awaited<ReturnType<typeof aufbau>>) {
  await vor(x, TAG);
  x.s.depot.gesamt = 14000;
  x.s.depot.pos = [
    { id: 'NESN', name: 'Nestlé SA', symbol: 'NESN:xswx', stueck: 50, kurs: 84, wert: 4200 },
    { id: 'VWCE', name: 'Vanguard FTSE All-World', symbol: 'VWCE:xetr', stueck: 70, kurs: 124, wert: 8680 },
    { id: 'AAPL', name: 'Apple Inc.', symbol: 'AAPL:xnas', stueck: 5, kurs: 200, wert: 1000 },
  ];
  await x.d.saxo.aktualisieren(true);
}

describe('Saxo-Bewegungen (E222)', () => {
  it('jeder Agent hat depot_*', () => {
    const p = werkzeugprofil({ werkzeuge: [], fremdinhalte: false });
    for (const n of DEPOT_WERKZEUGE) expect(p.dorf).toContain(n);
  });

  it('Tagesstände je Tag; Bewegung gegen den Vortag; erster Tag aus Saxos Tagesänderung + Performance-Reihe', async () => {
    const x = await aufbau();
    // zweiter Abruf am selben Tag ersetzt den Tagesstand (letzter Stand des Tages zählt)
    x.s.depot.gesamt = 12600;
    await vor(x, 60 * 60_000);
    await x.d.saxo.aktualisieren(true);
    expect(x.d.saxo.tagesstaende().map((t) => [t.tag, t.gesamt])).toEqual([['2026-11-16', 12600]]);

    const erster = x.d.saxo.bewegung('2026-11-16')!;
    expect(erster).toMatchObject({ vorher: null, gesamtVorher: 12400, gesamt: 12600, gesamtDelta: 200 });
    const nestle = erster.positionen.find((p) => p.name === 'Nestlé SA')!;
    expect(nestle.prozent).toBe(-1.2);
    expect(nestle.delta).toBeCloseTo(4000 - 4000 / 0.988, 1);

    await zweiTage(x);
    const b = x.d.saxo.bewegung('2026-11-17')!;
    expect(b).toMatchObject({ vorher: '2026-11-16', gesamtVorher: 12600, gesamt: 14000, gesamtDelta: 1400 });
    expect(b.positionen.find((p) => p.name === 'Nestlé SA')).toMatchObject({ delta: 200, prozent: 5 });
    expect(b.positionen.find((p) => p.name.startsWith('Vanguard'))).toMatchObject({ delta: 1180, prozent: -0.8, stueckVorher: 60, stueck: 70 });
    expect(b.positionen.find((p) => p.name === 'Apple Inc.')).toMatchObject({ neu: true, stueck: 5 });
    // größter Ausschlag zuerst
    expect(b.positionen[0]!.name).toMatch(/Vanguard/);
    expect(x.d.saxo.bewegung('2026-11-15')).toBeNull();
    expect(x.d.saxo.bewegungen('2026-11-01', '2026-11-30').map((y) => y.tag)).toEqual(['2026-11-16', '2026-11-17']);
  });

  it('Werkzeuge: depot_lesen und depot_bewegungen (Standard gestern, Zeitraum, nichts gespeichert)', async () => {
    const x = await aufbau();
    await zweiTage(x);
    await vor(x, TAG); // Mi, 18.11. – gestern = 17.11.
    fs.writeFileSync(
      path.join(x.d.vault.wurzel, 'Boerse/aktionen/depot-test.md'),
      `---\nname: depot-test\nwerkzeuge: [vault_lesen]\n---\n<<werkzeug depot_lesen {}>>\n<<werkzeug depot_bewegungen {}>>\n<<werkzeug depot_bewegungen {"von":"2026-11-16","bis":"2026-11-17"}>>\n<<werkzeug depot_bewegungen {"von":"2026-10-01"}>>\n`,
    );
    const r = await x.d.agenten.aktionStarten('Boerse/depot-test', {});
    await x.d.agenten.leerlauf();
    const t = x.d.agenten.chatDetail(r.chatId).nachrichten.filter((n) => n.rolle === 'werkzeug').map((n) => n.text);
    expect(t[0]).toContain('Kontowert 14.000,00 €');
    expect(t[0]).toContain('- Apple Inc. [AAPL:xnas] (Stock): 5 Stück');
    expect(t[1]).toContain('## 2026-11-17');
    expect(t[1]).toContain('Kontowert 14.000,00 € (+1.500,00 €, +12,0 %)');
    expect(t[1]).toContain('Neu im Depot: Apple Inc. (5 Stück)');
    expect(t[1]).toContain('Vanguard FTSE All-World: 60 → 70 Stück');
    expect(t[1]).toContain('Nestlé SA: +200,00 € (+5,0 %)');
    expect(t[1]).not.toContain('## 2026-11-16');
    expect(t[2]).toContain('## 2026-11-16');
    expect(t[2]).toContain('erster gespeicherter Tag');
    expect(t[3]).toMatch(/keinen gespeicherten Depotstand \(das Dorf merkt sich die Tagesstände seit 2026-11-16/);
  });

  it('Morgenzeitung: „📈 Saxo gestern“ ganz unten, „Warum“ nur aus dem Bericht für gestern; ruhiges Wochenende fehlt', async () => {
    const x = await aufbau();
    await zweiTage(x);
    await vor(x, TAG - 7 * 60 * 60_000); // Mi, 18.11. 05:00 UTC = 06:00 Wien
    let z = await x.d.morgenzeitung.fakten();
    const letzter = z.abschnitte.at(-1)!;
    expect(letzter.titel).toBe('📈 Saxo gestern');
    expect(letzter.zeilen[0]).toBe('Kontowert 14.000,00 € (+1.500,00 €, +12,0 %)');
    expect(letzter.zeilen).toContain('Neu im Depot: Apple Inc. (5 Stück)');
    expect(letzter.zeilen.some((l) => l.startsWith('Warum'))).toBe(false);

    // Bericht des Helfers: für einen anderen Tag → nicht übernommen; für gestern → „Warum: …“
    const bericht = (tag: string) =>
      `---\ntag: ${tag}\n---\n## Für die Zeitung\nNestlé stieg nach starken Quartalszahlen (Reuters, 17.11.).\nDu hast 10 VWCE nachgekauft.\n\n## Im Detail\n| Wert | … |\n`;
    fs.writeFileSync(path.join(x.d.vault.wurzel, 'Boerse/00_Tagesbericht.md'), bericht('2026-11-16'));
    z = await x.d.morgenzeitung.fakten();
    expect(z.abschnitte.at(-1)!.zeilen.some((l) => l.startsWith('Warum'))).toBe(false);
    fs.writeFileSync(path.join(x.d.vault.wurzel, 'Boerse/00_Tagesbericht.md'), bericht('2026-11-17'));
    z = await x.d.morgenzeitung.fakten();
    expect(z.abschnitte.at(-1)!.zeilen.slice(-2)).toEqual(['Warum: Nestlé stieg nach starken Quartalszahlen (Reuters, 17.11.).', 'Du hast 10 VWCE nachgekauft.']);
    expect(z.abschnitte.at(-1)!.zeilen.join(' ')).not.toContain('Im Detail');

    // Sa + So ohne Bewegung → Montag früh kein Abschnitt
    for (let i = 0; i < 4; i++) {
      await vor(x, TAG);
      await x.d.saxo.aktualisieren(true);
    }
    // jetzt So, 22.11. 06:00 Wien; ein Tag weiter = Mo
    await vor(x, TAG);
    expect(x.d.saxo.gesternZeilen()).toEqual([]);
    expect((await x.d.morgenzeitung.fakten()).abschnitte.some((a) => a.titel === '📈 Saxo gestern')).toBe(false);
  });

  it('Vorlage: Aktion Depot-Tagesbericht ist gültig (Zeitplan Di–Sa, Ablage für die Morgenzeitung)', async () => {
    const x = await aufbau();
    const a = await aktionLaden(x.d.vault, 'Boerse/tagesbericht');
    expect(a).toMatchObject({ zeitplan: 'di, mi, do, fr, sa 05:00', ablage: 'Boerse/00_Tagesbericht.md', motor: 'claude-code' });
    expect(a?.fehler).toBeUndefined();
  });
});
