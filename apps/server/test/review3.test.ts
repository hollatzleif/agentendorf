import { describe, expect, it } from 'vitest';
import type { TodoInfo } from '@dorf/shared';
import { tagPlanen } from '../src/tagesplan.js';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';

describe('Drittes Review (E124)', () => {
  it('Idempotenz: dieselbe Eintrags-ID legt To-do und Notiz nur einmal an', async () => {
    const d = await testDorf();
    const h = { ...(await kopf(d)), 'x-dorf-id': 'a1b2c3d4-e5f6-4711-8888-123456789abc' };
    const r1 = (await d.app.inject({ method: 'POST', url: '/api/todos', headers: h, payload: { titel: 'Milch' } })).json();
    const r2 = (await d.app.inject({ method: 'POST', url: '/api/todos', headers: h, payload: { titel: 'Milch' } })).json();
    expect(r2.pfad).toBe(r1.pfad);
    expect((await d.todos.liste()).filter((t) => t.titel === 'Milch')).toHaveLength(1);
    // andere ID → neuer Eintrag; ohne ID wie bisher
    await d.app.inject({ method: 'POST', url: '/api/todos', headers: { ...h, 'x-dorf-id': 'zweite-id-12345' }, payload: { titel: 'Milch' } });
    expect((await d.todos.liste()).filter((t) => t.titel === 'Milch')).toHaveLength(2);
    // Notiz
    const hn = { ...(await kopf(d)), 'x-dorf-id': 'notiz-id-0000001' };
    await d.app.inject({ method: 'POST', url: '/api/notiz', headers: hn, payload: { text: 'einmal' } });
    await d.app.inject({ method: 'POST', url: '/api/notiz', headers: hn, payload: { text: 'einmal' } });
    expect((await d.notizen.heute()).zeilen.filter((z) => z.includes('einmal'))).toHaveLength(1);
    // ungültige ID wird ignoriert (kein Schlüssel)
    const hx = { ...(await kopf(d)), 'x-dorf-id': 'kurz' };
    await d.app.inject({ method: 'POST', url: '/api/notiz', headers: hx, payload: { text: 'zweimal' } });
    await d.app.inject({ method: 'POST', url: '/api/notiz', headers: hx, payload: { text: 'zweimal' } });
    expect((await d.notizen.heute()).zeilen.filter((z) => z.includes('zweimal'))).toHaveLength(2);
    // nach 7 Tagen vergessen
    d.uhr.vor(8 * 86_400_000);
    await d.app.inject({ method: 'POST', url: '/api/todos', headers: { ...h, 'x-dorf-id': 'aufraeumen-0001' }, payload: { titel: 'X' } });
    expect(d.db.prepare('SELECT COUNT(*) AS n FROM idempotenz').get()).toEqual({ n: 1 });
  });

  it('Tag planen: große Schätzung ohne passende Lücke → Teilblock in der größten Lücke statt gar nichts', () => {
    const t: TodoInfo = { pfad: 'Marktplatz/todos/a.md', version: 'v', titel: 'Abgabe: Bericht', erledigt: false, faellig: '2026-11-15', dauer: 240 };
    const a = Date.UTC(2026, 10, 16, 8);
    const b = tagPlanen({ todos: [t], heute: '2026-11-16', frei: [[a, a + 30 * 60_000], [a + 3600_000, a + 3600_000 + 100 * 60_000]] });
    expect(b).toHaveLength(1);
    expect(b[0]!.ende - b[0]!.start).toBe(100 * 60_000);
    expect(b[0]!.grund).toBe('überfällig · Teil von ⏱ 4 h');
    // keine Lücke ab 30 min → nichts
    expect(tagPlanen({ todos: [t], heute: '2026-11-16', frei: [[a, a + 20 * 60_000]] })).toHaveLength(0);
  });
});
