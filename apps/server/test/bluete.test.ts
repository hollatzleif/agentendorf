import { describe, expect, it } from 'vitest';
import { bluete } from '../src/bluete.js';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';

const tag = (i: number, x: Partial<{ erledigt: number; fokusMin: number; gewohnheitenFaellig: number; gewohnheitenErledigt: number }> = {}) => ({
  tag: `2026-11-${String(10 + i).padStart(2, '0')}`,
  erledigt: 0,
  fokusMin: 0,
  gewohnheitenFaellig: 0,
  gewohnheitenErledigt: 0,
  stimmung: null,
  ...x,
});
const summen = (o: Partial<{ erledigtWoche: number; fokusMinWoche: number; gewohnheitenQuote: number | null }> = {}) => ({
  erledigt: 0,
  erledigtWoche: 0,
  fokusMin: 0,
  fokusMinWoche: 0,
  gewohnheitenQuote: null,
  stimmungSchnitt: null,
  aktiveTage: 0,
  ...o,
});

describe('Das Dorf blüht (E112)', () => {
  it('nichts getan → karg; ein starker Tag → Feuerwerk; jeden Tag etwas mit Fokus und Gewohnheiten → prächtig', () => {
    expect(bluete({ tage: Array.from({ length: 7 }, (_, i) => tag(i)), summen: summen() })).toMatchObject({ wert: 0, stufe: 'karg', fahne: false, feuerwerk: false });
    const stark = bluete({ tage: [...Array.from({ length: 6 }, (_, i) => tag(i)), tag(6, { erledigt: 5 })], summen: summen({ erledigtWoche: 5 }) });
    expect(stark).toMatchObject({ feuerwerk: true, stufe: 'karg' });
    const voll = bluete(
      { tage: Array.from({ length: 7 }, (_, i) => tag(i, { erledigt: 2, fokusMin: 50, gewohnheitenFaellig: 1, gewohnheitenErledigt: 1 })), summen: summen({ erledigtWoche: 14, fokusMinWoche: 350, gewohnheitenQuote: 100 }) },
      { ziele: [{ erledigt: true }, { erledigt: true }] },
    );
    expect(voll).toMatchObject({ wert: 1, stufe: 'praechtig', fahne: true });
    expect(voll.gruende[0]).toBe('7 von 7 Tagen aktiv');
  });

  it('steht im Dorfstatus', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    const a = await d.todos.anlegen({ titel: 'A' }, 'Leif');
    await d.todos.aendern(a.pfad, { erledigt: true });
    const s = (await d.app.inject({ url: '/api/dorf/status', headers: h })).json();
    expect(s.bluete).toMatchObject({ stufe: 'karg', fahne: false, feuerwerk: false });
    expect(s.bluete.wert).toBeGreaterThan(0);
  });
});
