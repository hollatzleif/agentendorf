import { describe, expect, it } from 'vitest';
import { passwortSetzen } from '../src/auth/passwort.js';
import { cookieAus, ORIGIN, testDorf } from './hilfen.js';

const PW = 'ein-langes-test-passwort-1';
export async function kopf(d: Awaited<ReturnType<typeof testDorf>>) {
  await passwortSetzen(d.db, d.uhr, PW);
  const r = await d.app.inject({ method: 'POST', url: '/api/anmeldung', headers: { origin: ORIGIN }, payload: { passwort: PW } });
  return { origin: ORIGIN, cookie: cookieAus(r.headers['set-cookie']) };
}

describe('Etappe 7a: Gebäude anlegen und eröffnen', () => {
  it('neues Gebäude: Ordner + gebaeude.md + aktionen/, erscheint in der Liste und im Dorfplan; doppelt → 409', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    const r = await d.app.inject({ method: 'POST', url: '/api/gebaeude', headers: h, payload: { name: 'Fitness Studio', symbol: '🏋️', beschreibung: 'Training und Ernährung' } });
    expect(r.json()).toEqual({ id: 'Fitness-Studio' });
    expect(await d.vault.existiert('Fitness-Studio/aktionen')).toBe(true);
    const g = ((await d.app.inject({ url: '/api/gebaeude', headers: h })).json() as { id: string; status: string; symbol: string; name: string }[]).find((x) => x.id === 'Fitness-Studio');
    expect(g).toMatchObject({ name: 'Fitness Studio', symbol: '🏋️', status: 'offen' });
    const plan = (await d.app.inject({ url: '/api/dorf', headers: h })).json() as { layout: { gebaeude: Record<string, unknown> } };
    expect(plan.layout.gebaeude['Fitness-Studio']).toBeTruthy();
    expect((await d.app.inject({ method: 'POST', url: '/api/gebaeude', headers: h, payload: { name: 'fitness studio' } })).statusCode).toBe(409);
    expect((await d.app.inject({ method: 'POST', url: '/api/gebaeude', headers: h, payload: { name: '..' } })).statusCode).toBe(400);
  });

  it('eröffnen, umbenennen, schließen; Rathaus bleibt offen; Text der Arbeitsanweisung bleibt erhalten', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    await d.vault.schreiben('Werkstatt/gebaeude.md', '---\nname: Werkstatt\nstatus: geschlossen\nbeschreibung: Noch nicht eröffnet\n---\n# Werkstatt\n\nMein Text.\n');
    const r = await d.app.inject({ method: 'PATCH', url: '/api/gebaeude/Werkstatt', headers: h, payload: { status: 'offen', symbol: '🔧' } });
    expect(r.json()).toMatchObject({ id: 'Werkstatt', status: 'offen', symbol: '🔧', beschreibung: '' });
    expect((await d.vault.lesen('Werkstatt/gebaeude.md')).inhalt).toContain('Mein Text.');
    expect((await d.app.inject({ method: 'PATCH', url: '/api/gebaeude/Rathaus', headers: h, payload: { status: 'geschlossen' } })).statusCode).toBe(400);
    expect((await d.app.inject({ method: 'PATCH', url: '/api/gebaeude/Gibtsnicht', headers: h, payload: { status: 'offen' } })).statusCode).toBe(404);
  });
});

describe('Etappe 7b: Einkaufsladen', () => {
  it('ist offen; Skills Essensplan (so 17:00, Ablage) und Preisvergleich (Internet, ohne Fremdinhalte) sind fehlerfrei', async () => {
    const d = await testDorf();
    const { gebaeudeListe } = await import('../src/vault/gebaeude.js');
    const { aktionenListe } = await import('../src/agenten/aktionen.js');
    expect((await gebaeudeListe(d.vault)).find((g) => g.id === 'Einkaufsladen')).toMatchObject({ status: 'offen' });
    const a = await aktionenListe(d.vault);
    expect(a.find((x) => x.id === 'Einkaufsladen/essensplan')).toMatchObject({ zeitplan: 'so 17:00', ablage: 'Einkaufsladen/00_Essensplan.md', fremdinhalte: true });
    expect(a.find((x) => x.id === 'Einkaufsladen/essensplan')!.fehler).toBeUndefined();
    const p = a.find((x) => x.id === 'Einkaufsladen/preisvergleich')!;
    expect(p.fehler).toBeUndefined();
    expect(p).toMatchObject({ fremdinhalte: false });
    expect(p.werkzeuge).toContain('web');
    expect(await d.vault.existiert('Einkaufsladen/einstellungen.md')).toBe(true);
  });
});

describe('Etappe 7d: Corpshaus', () => {
  it('Termine aus dem Hauptkalender per Stichwort; Absenderliste; Skills fehlerfrei', async () => {
    const ics = (titel: string, start: string) => `BEGIN:VEVENT\r\nUID:${titel}\r\nDTSTART:${start}\r\nDTEND:${start}\r\nSUMMARY:${titel}\r\nEND:VEVENT\r\n`;
    const d = await testDorf({
      google: { termine: { laden: async () => `BEGIN:VCALENDAR\r\n${ics('Kneipe im Haus', '20261120T190000Z')}${ics('Zahnarzt', '20261121T080000Z')}${ics('Corps-Convent', '20261125T180000Z')}END:VCALENDAR\r\n` } },
    });
    const h = await kopf(d);
    const u = (await d.app.inject({ url: '/api/corps', headers: h })).json();
    expect(u.termine.map((t: { titel: string }) => t.titel)).toEqual(['Kneipe im Haus', 'Corps-Convent']);
    expect(u.absender).toEqual([]);
    await d.vault.schreiben('Corpshaus/einstellungen.md', '---\nabsender: ["@mein-corps.example"]\nstichworte: [Kneipe]\n---\n');
    expect(await d.corps.istCorpsAbsender('Senior <senior@mein-corps.example>')).toBe(true);
    expect(await d.corps.istCorpsAbsender('prof@jku.at')).toBe(false);
    const { aktionenListe } = await import('../src/agenten/aktionen.js');
    const a = (await aktionenListe(d.vault)).filter((x) => x.gebaeude === 'Corpshaus');
    expect(a.map((x) => x.id).sort()).toEqual(['Corpshaus/termine-aus-mails', 'Corpshaus/uebergabe', 'Corpshaus/veranstaltung-planen']);
    expect(a.every((x) => !x.fehler)).toBe(true);
    expect(a.find((x) => x.id === 'Corpshaus/termine-aus-mails')).toMatchObject({ zeitplan: 'mo, do 07:00', ablage: 'Corpshaus/00_Termine.md' });
  });
});

describe('Etappe 7e: Börse', () => {
  function anbieter() {
    const aufrufe: string[] = [];
    const kurse: Record<string, { datum: string; kurs: number }[]> = {
      'VWCE.XETRA': [
        { datum: '2026-11-13', kurs: 132 },
        { datum: '2026-11-12', kurs: 128 },
      ],
      'AAPL.US': [
        { datum: '2026-11-13', kurs: 220 },
        { datum: '2026-11-12', kurs: 220 },
      ],
    };
    return {
      aufrufe,
      klient: {
        async eod(symbol: string) {
          aufrufe.push(`eod ${symbol}`);
          return kurse[symbol] ?? [];
        },
        async suche(isin: string, boerse: string) {
          aufrufe.push(`suche ${isin} ${boerse}`);
          return isin === 'IE00BK5BQT80' ? { symbol: 'VWCE.XETRA', waehrung: 'EUR' } : null;
        },
      },
    };
  }

  it('Depot über die API pflegen; Kurse (ISIN einmal gesucht), Euro aus Dollar, Gewinn; höchstens einmal am Tag; Tageslimit 19', async () => {
    const a = anbieter();
    const d = await testDorf({ boerse: a.klient, boerseFx: async () => ({ datum: '2026-11-13', kurs: 1.1 }) });
    const h = await kopf(d);
    const neu = (art: string, w: unknown) => d.app.inject({ method: 'POST', url: '/api/boerse/wert', headers: h, payload: { art, neu: w } });
    expect((await neu('positionen', { name: 'Vanguard All-World', isin: 'IE00BK5BQT80', stueck: 10, einstand: 120 })).statusCode).toBe(200);
    expect((await neu('positionen', { name: 'Apple', symbol: 'AAPL.US', stueck: 2, einstand: 180 })).statusCode).toBe(200);
    expect((await neu('watchlist', { name: 'Unbekannt', isin: 'DE0000000000' })).statusCode).toBe(200);
    expect((await neu('positionen', { name: 'Ohne alles' })).statusCode).toBe(400);
    expect((await neu('positionen', { name: 'Kaputt', isin: 'xyz' })).statusCode).toBe(400);
    expect((await d.vault.lesen('Boerse/depot.md')).inhalt).toContain('isin: IE00BK5BQT80');

    const r = await d.app.inject({ method: 'POST', url: '/api/boerse/aktualisieren', headers: h });
    expect(r.json()).toMatchObject({ abgerufen: 2 });
    expect(a.aufrufe.sort()).toEqual(['eod AAPL.US', 'eod VWCE.XETRA', 'suche DE0000000000 XETRA', 'suche IE00BK5BQT80 XETRA']);
    const u = (await d.app.inject({ url: '/api/boerse', headers: h })).json();
    expect(u.positionen[0]).toMatchObject({ name: 'Vanguard All-World', symbol: 'VWCE.XETRA', kurs: 132, waehrung: 'EUR', wertEur: 1320, gewinnEur: 120, gewinnProzent: 10, veraenderungProzent: 3.13 });
    expect(u.positionen[1]).toMatchObject({ name: 'Apple', kurs: 220, waehrung: 'USD', wertEur: 400, gewinnEur: 40 });
    expect(u).toMatchObject({ gesamtEur: 1720, einstandEur: 1560, abrufeHeute: 4, abrufeMax: 19, eingerichtet: true });
    // am selben Tag nichts doppelt
    a.aufrufe.length = 0;
    expect((await d.boerse.aktualisieren()).abgerufen).toBe(0);
    expect(a.aufrufe).toEqual([]);
    // Morgenzeitung: Depotwert und große Bewegung (≥ 3 %)
    expect(await d.boerse.zeitungsZeilen()).toEqual(['Depot: 1.720,00 € (+10,3 % seit Kauf)', 'Vanguard All-World: +3,1 % am letzten Handelstag']);
    // Eintrag entfernen
    const weg = await d.app.inject({ method: 'DELETE', url: '/api/boerse/wert?art=watchlist&index=0', headers: h });
    expect(weg.json().watchlist).toEqual([]);
    // Tageslimit: 30 Werte → nur bis 19 Abrufe am Tag
    d.uhr.vor(86_400_000);
    for (let i = 0; i < 30; i++) await d.boerse.wertAendern('watchlist', { neu: { name: `W${i}`, symbol: `W${i}.XETRA` } });
    a.aufrufe.length = 0;
    const r2 = await d.boerse.aktualisieren();
    expect(a.aufrufe).toHaveLength(19);
    expect(r2.offen).toBe(32 - 19);
  });

  it('ohne Schlüssel: Übersicht sagt es, nichts wird abgerufen; Wochenbericht-Skill (Internet, ohne Fremdinhalte) fehlerfrei', async () => {
    const d = await testDorf();
    expect(await d.boerse.aktualisieren()).toMatchObject({ abgerufen: 0, fehler: expect.stringMatching(/dorf boerse-schluessel/) });
    expect((await d.boerse.uebersicht()).eingerichtet).toBe(false);
    const { aktionenListe } = await import('../src/agenten/aktionen.js');
    const w = (await aktionenListe(d.vault)).find((x) => x.id === 'Boerse/wochenbericht')!;
    expect(w.fehler).toBeUndefined();
    expect(w).toMatchObject({ zeitplan: 'so 18:00', fremdinhalte: false, ablage: 'Boerse/00_Wochenbericht.md' });
  });

  it('EODHD-Klient und EZB nach Doku (nachgebauter Server): Pfade, Parameter, Felder', async () => {
    const http = await import('node:http');
    const anfragen: string[] = [];
    const s = http.createServer((req, res) => {
      anfragen.push(req.url!);
      res.setHeader('Content-Type', 'application/json');
      if (req.url!.startsWith('/api/eod/VWCE.XETRA')) return res.end(JSON.stringify([{ date: '2026-11-12', open: 1, high: 1, low: 1, close: 128.5, adjusted_close: 1, volume: 1 }, { date: '2026-11-13', close: 130.25 }]));
      if (req.url!.startsWith('/api/search/IE00BK5BQT80')) return res.end(JSON.stringify([{ Code: 'VWCE', Exchange: 'XETRA', Currency: 'EUR', ISIN: 'IE00BK5BQT80', Name: 'Vanguard' }]));
      if (req.url!.startsWith('/api/eod/BOESE.US')) {
        res.statusCode = 401;
        return res.end('{}');
      }
      if (req.url!.startsWith('/ezb')) {
        res.setHeader('Content-Type', 'text/csv');
        return res.end('KEY,FREQ,TIME_PERIOD,OBS_VALUE\nEXR.D.USD.EUR.SP00.A,D,2026-11-17,1.0989\n');
      }
      res.statusCode = 404;
      res.end('[]');
    });
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    const port = (s.address() as { port: number }).port;
    try {
      const { eodhdKlient, ezbDollarJeEuro } = await import('../src/boerse.js');
      const k = eodhdKlient({ url: `http://127.0.0.1:${port}/api`, schluessel: 'GEHEIM', jetzt: () => Date.UTC(2026, 10, 18) });
      expect(await k.eod('VWCE.XETRA')).toEqual([
        { datum: '2026-11-13', kurs: 130.25 },
        { datum: '2026-11-12', kurs: 128.5 },
      ]);
      expect(await k.suche('IE00BK5BQT80', 'XETRA')).toEqual({ symbol: 'VWCE.XETRA', waehrung: 'EUR', name: 'Vanguard' });
      await expect(k.eod('BOESE.US')).rejects.toThrow(/lehnt den Schlüssel ab/);
      expect(anfragen[0]).toBe('/api/eod/VWCE.XETRA?order=d&from=2026-11-08&api_token=GEHEIM&fmt=json');
      expect(anfragen[1]).toBe('/api/search/IE00BK5BQT80?exchange=XETRA&api_token=GEHEIM&fmt=json');
      expect(await ezbDollarJeEuro(`http://127.0.0.1:${port}/ezb`)).toEqual({ datum: '2026-11-17', kurs: 1.0989 });
    } finally {
      s.close();
    }
  });
});
