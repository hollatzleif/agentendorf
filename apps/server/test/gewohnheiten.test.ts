import { describe, expect, it } from 'vitest';
import { faelligAm, GEWOHNHEITEN_PFAD } from '../src/gewohnheiten.js';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';
import type { TestUhr } from '../src/uhr.js';

const TAG = 86_400_000;

describe('Gewohnheiten (Nacht 18./19.11.)', () => {
  it('fällig: täglich, werktags, wochenende, Liste', () => {
    // 16.11.2026 = Montag, 21.11. = Samstag
    expect(faelligAm({ tage: 'täglich' }, '2026-11-21')).toBe(true);
    expect(faelligAm({ tage: 'werktags' }, '2026-11-16')).toBe(true);
    expect(faelligAm({ tage: 'werktags' }, '2026-11-21')).toBe(false);
    expect(faelligAm({ tage: 'wochenende' }, '2026-11-22')).toBe(true);
    expect(faelligAm({ tage: ['mo', 'mi', 'fr'] }, '2026-11-18')).toBe(true);
    expect(faelligAm({ tage: ['mo', 'mi', 'fr'] }, '2026-11-17')).toBe(false);
  });

  it('API: anlegen schreibt gewohnheiten.md, abhaken, Serie über nicht fällige Tage hinweg, Lücke bricht ab', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    const uhr = d.uhr as TestUhr;
    let r = await d.app.inject({ method: 'POST', url: '/api/gewohnheiten', headers: h, payload: { name: 'Sport', symbol: '🏃', tage: ['mo', 'mi', 'fr'] } });
    expect(r.statusCode).toBe(200);
    await d.app.inject({ method: 'POST', url: '/api/gewohnheiten', headers: h, payload: { name: 'Lesen' } });
    expect((await d.app.inject({ method: 'POST', url: '/api/gewohnheiten', headers: h, payload: { name: 'lesen' } })).statusCode).toBe(409);
    expect((await d.vault.lesen(GEWOHNHEITEN_PFAD)).inhalt).toMatch(/name: Sport[\s\S]*- mo/);

    // Mo 16., Mi 18. Sport; Lesen Mo–Mi
    await d.app.inject({ method: 'POST', url: '/api/gewohnheiten/haken', headers: h, payload: { name: 'Sport', erledigt: true } });
    await d.app.inject({ method: 'POST', url: '/api/gewohnheiten/haken', headers: h, payload: { name: 'Lesen', erledigt: true } });
    uhr.vor(TAG);
    await d.app.inject({ method: 'POST', url: '/api/gewohnheiten/haken', headers: h, payload: { name: 'Lesen', erledigt: true } });
    uhr.vor(TAG);
    await d.app.inject({ method: 'POST', url: '/api/gewohnheiten/haken', headers: h, payload: { name: 'Sport', erledigt: true } });
    r = await d.app.inject({ method: 'POST', url: '/api/gewohnheiten/haken', headers: h, payload: { name: 'Lesen', erledigt: true } });
    let s = r.json().gewohnheiten;
    expect(s.find((g: { name: string }) => g.name === 'Sport')).toMatchObject({ serie: 2, heuteFaellig: true, heuteErledigt: true, symbol: '🏃' });
    expect(s.find((g: { name: string }) => g.name === 'Lesen')).toMatchObject({ serie: 3, symbol: '✅' });

    // Donnerstag: Sport nicht fällig, Serie bleibt; Lesen heute noch offen → Serie bis gestern
    uhr.vor(TAG);
    s = (await d.app.inject({ url: '/api/gewohnheiten', headers: h })).json().gewohnheiten;
    expect(s.find((g: { name: string }) => g.name === 'Sport')).toMatchObject({ serie: 2, heuteFaellig: false });
    expect(s.find((g: { name: string }) => g.name === 'Lesen')).toMatchObject({ serie: 3, heuteErledigt: false });
    expect(s[0].woche).toHaveLength(7);
    // Freitag ohne Lesen am Donnerstag → Serie 0
    uhr.vor(TAG);
    s = (await d.app.inject({ url: '/api/gewohnheiten', headers: h })).json().gewohnheiten;
    expect(s.find((g: { name: string }) => g.name === 'Lesen').serie).toBe(0);
    // nachträglich abhaken (gestern) erlaubt, Zukunft nicht
    await d.app.inject({ method: 'POST', url: '/api/gewohnheiten/haken', headers: h, payload: { name: 'Lesen', erledigt: true, tag: '2026-11-19' } });
    s = (await d.app.inject({ url: '/api/gewohnheiten', headers: h })).json().gewohnheiten;
    expect(s.find((g: { name: string }) => g.name === 'Lesen').serie).toBe(4);
    expect((await d.app.inject({ method: 'POST', url: '/api/gewohnheiten/haken', headers: h, payload: { name: 'Lesen', erledigt: true, tag: '2026-12-01' } })).statusCode).toBe(400);
    expect((await d.app.inject({ method: 'POST', url: '/api/gewohnheiten/haken', headers: h, payload: { name: 'Gibtsnicht', erledigt: true } })).statusCode).toBe(404);

    expect(await d.gewohnheiten.wochenZeile()).toMatch(/🏃 Sport 2\/3 · ✅ Lesen 4\/7 \(🔥 4\)/);

    // Morgenzeitung: Freitag – Sport (fällig) und Lesen
    expect(await d.gewohnheiten.heuteZeilen()).toEqual(['🏃 Sport (🔥 2) · ✅ Lesen (🔥 4)']);
    expect((await d.morgenzeitung.fakten()).abschnitte.find((a) => a.titel === 'Gewohnheiten heute')?.zeilen).toEqual(['🏃 Sport (🔥 2) · ✅ Lesen (🔥 4)']);

    // entfernen
    r = await d.app.inject({ method: 'DELETE', url: '/api/gewohnheiten?name=Sport', headers: h });
    expect(r.json().gewohnheiten.map((g: { name: string }) => g.name)).toEqual(['Lesen']);
  });

  it('fehlerhafte Datei wird gemeldet, nicht verschluckt', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    await d.vault.schreiben(GEWOHNHEITEN_PFAD, '---\ngewohnheiten:\n  - name: Sport\n    tage: montags\n---\n');
    const s = (await d.app.inject({ url: '/api/gewohnheiten', headers: h })).json();
    expect(s.fehler).toMatch(/fehlerhaft/);
    expect((await d.app.inject({ method: 'POST', url: '/api/gewohnheiten', headers: h, payload: { name: 'Lesen' } })).statusCode).toBe(409);
  });
});

describe('Gewohnheiten mit Uhrzeit (E106)', () => {
  it('läutet einmal am Tag zur Uhrzeit, wenn offen (bis 3 h danach); abgehakt → verstummt; ungültige Uhrzeit abgelehnt', async () => {
    const d = await testDorf();
    // TestUhr: Mo 16.11. 13:00 Wien
    await d.gewohnheiten.anlegen({ name: 'Vitamine', symbol: '💊', uhrzeit: '13:30' });
    await d.gewohnheiten.anlegen({ name: 'Früh', uhrzeit: '08:00' }); // schon > 3 h vorbei
    await expect(d.gewohnheiten.anlegen({ name: 'X', uhrzeit: '25:00' })).rejects.toThrow();
    expect(await d.erinnerungen.pruefen()).toBe(0);
    d.uhr.vor(31 * 60_000);
    expect(await d.erinnerungen.pruefen()).toBe(1);
    expect(await d.erinnerungen.pruefen()).toBe(0);
    expect(d.kirchturm.zustand().klingelt).toEqual([expect.objectContaining({ quelle: 'erinnerung', bezugId: 'gewohnheit:Vitamine', titel: '🔔 💊 Vitamine', schlummern: false })]);
    await d.gewohnheiten.haken('Vitamine', true);
    await d.erinnerungen.pruefen();
    expect(d.kirchturm.zustand().klingelt).toEqual([]);
    // nächster Tag: wieder
    d.uhr.vor(86_400_000);
    expect(await d.erinnerungen.pruefen()).toBe(1);
  });
});

describe('Gewohnheiten „Nx pro Woche“ (E110)', () => {
  it('dran, bis das Wochenziel erreicht ist; Serie in Wochen; Telegram zeigt den Wochenstand', async () => {
    const d = await testDorf();
    const TAG = 86_400_000;
    // TestUhr: Mo 16.11. – Vorwoche (9.–15.11.) 3x erledigt → Serie 1 Woche
    await d.gewohnheiten.anlegen({ name: 'Sport', symbol: '🏃', tage: '3x pro Woche' });
    expect((await d.vault.lesen('Marktplatz/gewohnheiten.md')).inhalt).toContain('tage: 3x pro woche');
    for (const t of ['2026-11-10', '2026-11-12', '2026-11-14']) await d.gewohnheiten.haken('Sport', true, t);
    let g = (await d.gewohnheiten.stand()).gewohnheiten[0]!;
    expect(g).toMatchObject({ heuteFaellig: true, serie: 1, serieEinheit: 'wochen', wocheStand: { erledigt: 0, ziel: 3 } });
    // diese Woche Mo, Di, Mi → Ziel erreicht, Do nicht mehr dran, Serie 2
    for (let i = 0; i < 3; i++) {
      await d.gewohnheiten.haken('Sport', true);
      d.uhr.vor(TAG);
    }
    g = (await d.gewohnheiten.stand()).gewohnheiten[0]!;
    expect(g).toMatchObject({ heuteFaellig: false, serie: 2, wocheStand: { erledigt: 3, ziel: 3 } });
    expect(await d.gewohnheiten.wochenZeile()).toBe('🏃 Sport 3/3 (🔥 2 Wochen)');
    // fehlt das Feld „tage“ für die Tagesquote der Statistik: zählt nicht als fällig
    expect((await d.gewohnheiten.jeTag(['2026-11-19']))[0]).toEqual({ faellig: 0, erledigt: 0 });
    await expect(d.gewohnheiten.anlegen({ name: 'X', tage: '9x pro woche' })).rejects.toThrow();
  });
});
