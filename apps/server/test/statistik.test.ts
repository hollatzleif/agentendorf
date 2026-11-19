import { describe, expect, it } from 'vitest';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';

describe('Statistik (E93)', () => {
  it('zählt je Tag erledigte To-dos, Fokusminuten und Gewohnheiten; Summen für 28 und 7 Tage', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    const TAG = 86_400_000;
    // Mo 16.11.: 2 erledigt, 25 min Fokus, Lesen abgehakt
    const a = await d.todos.anlegen({ titel: 'A' }, 'Leif');
    const b = await d.todos.anlegen({ titel: 'B' }, 'Leif');
    await d.todos.aendern(a.pfad, { erledigt: true });
    await d.todos.aendern(b.pfad, { erledigt: true });
    d.db.prepare('INSERT INTO fokus_sitzungen (start, ende, minuten, thema, gruppe, todo, vollstaendig) VALUES (?, ?, ?, NULL, NULL, NULL, 1)').run(d.uhr.jetzt() - 25 * 60_000, d.uhr.jetzt(), 25);
    await d.gewohnheiten.anlegen({ name: 'Lesen' });
    await d.gewohnheiten.haken('Lesen', true);
    expect((await d.app.inject({ method: 'POST', url: '/api/stimmung', headers: h, payload: { wert: 2 } })).json()).toEqual({ ok: true });
    await d.app.inject({ method: 'POST', url: '/api/stimmung', headers: h, payload: { wert: 4 } }); // überschreibt
    expect((await d.app.inject({ method: 'POST', url: '/api/stimmung', headers: h, payload: { wert: 6 } })).statusCode).toBe(400);
    expect((await d.app.inject({ method: 'POST', url: '/api/stimmung', headers: h, payload: { wert: 3, tag: '2026-12-01' } })).statusCode).toBe(400);
    // Di 17.11.: nichts
    d.uhr.vor(TAG);
    const r = (await d.app.inject({ url: '/api/statistik', headers: h })).json();
    expect(r.tage).toHaveLength(28);
    expect(r.tage.at(-2)).toEqual({ tag: '2026-11-16', erledigt: 2, fokusMin: 25, gewohnheitenFaellig: 1, gewohnheitenErledigt: 1, stimmung: 4 });
    expect(r.tage.at(-1)).toEqual({ tag: '2026-11-17', erledigt: 0, fokusMin: 0, gewohnheitenFaellig: 1, gewohnheitenErledigt: 0, stimmung: null });
    expect(r.summen).toEqual({ erledigt: 2, erledigtWoche: 2, fokusMin: 25, fokusMinWoche: 25, gewohnheitenQuote: 50, stimmungSchnitt: 4, aktiveTage: 1 });
    expect((await d.app.inject({ url: '/api/statistik?tage=3', headers: h })).statusCode).toBe(400);
  }, 60_000); // auf der CI teils langsam (viele Vault-Lesezugriffe über 28 Tage)

  it('E144: Fokus nach Tageszeit (Wien) und beste 2-Stunden-Spanne; erst ab 2 h insgesamt', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    const ins = d.db.prepare('INSERT INTO fokus_sitzungen (start, ende, minuten, thema, gruppe, todo, vollstaendig) VALUES (?, ?, ?, NULL, NULL, NULL, 1)');
    // Mo 16.11. (Winterzeit, Wien = UTC+1): 9:00–9:50, 10:00–10:50 und 15:30–15:55
    ins.run(Date.parse('2026-11-16T08:00:00Z'), Date.parse('2026-11-16T08:50:00Z'), 50);
    let r = (await d.app.inject({ url: '/api/statistik', headers: h })).json();
    expect(r.fokusJeStunde[9]).toBe(50);
    expect(r.besteZeit).toBeNull(); // noch keine 2 h
    ins.run(Date.parse('2026-11-16T09:00:00Z'), Date.parse('2026-11-16T09:50:00Z'), 50);
    ins.run(Date.parse('2026-11-15T14:30:00Z'), Date.parse('2026-11-15T14:55:00Z'), 25);
    // über die Stundengrenze: 20:50–21:10 → je 10 min
    ins.run(Date.parse('2026-11-14T19:50:00Z'), Date.parse('2026-11-14T20:10:00Z'), 20);
    r = (await d.app.inject({ url: '/api/statistik', headers: h })).json();
    expect(r.fokusJeStunde.slice(9, 11)).toEqual([50, 50]);
    expect(r.fokusJeStunde[15]).toBe(25);
    expect(r.fokusJeStunde.slice(20, 22)).toEqual([10, 10]);
    expect(r.besteZeit).toEqual({ von: 9, bis: 11, min: 100 });
    const f = (await d.wochenrueckblick.fakten()).abschnitte.find((a) => a.titel === 'Fokus')!;
    expect(f.zeilen).toContain('Am konzentriertesten (4 Wochen): **9–11 Uhr** – leg Wichtiges in diese Zeit');
  });
});
