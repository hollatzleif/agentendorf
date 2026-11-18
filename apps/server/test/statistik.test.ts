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
    // Di 17.11.: nichts
    d.uhr.vor(TAG);
    const r = (await d.app.inject({ url: '/api/statistik', headers: h })).json();
    expect(r.tage).toHaveLength(28);
    expect(r.tage.at(-2)).toEqual({ tag: '2026-11-16', erledigt: 2, fokusMin: 25, gewohnheitenFaellig: 1, gewohnheitenErledigt: 1 });
    expect(r.tage.at(-1)).toEqual({ tag: '2026-11-17', erledigt: 0, fokusMin: 0, gewohnheitenFaellig: 1, gewohnheitenErledigt: 0 });
    expect(r.summen).toEqual({ erledigt: 2, erledigtWoche: 2, fokusMin: 25, fokusMinWoche: 25, gewohnheitenQuote: 50, aktiveTage: 1 });
    expect((await d.app.inject({ url: '/api/statistik?tage=3', headers: h })).statusCode).toBe(400);
  });
});
