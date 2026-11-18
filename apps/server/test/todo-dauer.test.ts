import { describe, expect, it } from 'vitest';
import { dauerAusText } from '../src/todos.js';
import { tagPlanen } from '../src/tagesplan.js';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';

describe('Zeitschätzung für To-dos (E120)', () => {
  it('Dauer aus Text: nur am Ende, nur mit Einheit, 5–600 min', () => {
    expect(dauerAusText('Referat üben 30 min')).toEqual({ titel: 'Referat üben', dauer: 30 });
    expect(dauerAusText('Referat üben 30min')).toEqual({ titel: 'Referat üben', dauer: 30 });
    expect(dauerAusText('Zusammenfassung 1,5 h')).toEqual({ titel: 'Zusammenfassung', dauer: 90 });
    expect(dauerAusText('Lernen 2 Std.')).toEqual({ titel: 'Lernen', dauer: 120 });
    expect(dauerAusText('Kapitel 3 lesen')).toEqual({ titel: 'Kapitel 3 lesen' });
    expect(dauerAusText('Laufen 10 m')).toEqual({ titel: 'Laufen 10 m' });
    expect(dauerAusText('Pause 2 min')).toEqual({ titel: 'Pause 2 min' });
    expect(dauerAusText('Projekt 20 h')).toEqual({ titel: 'Projekt 20 h' });
    expect(dauerAusText('30 min')).toEqual({ titel: '30 min' });
  });

  it('API: anlegen, ändern, entfernen; Nachfolger übernimmt die Schätzung; Tag planen nutzt sie', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    let t = (await d.app.inject({ method: 'POST', url: '/api/todos', headers: h, payload: { titel: 'Lesen', dauer: 25, wiederholen: 'täglich', faellig: '2026-11-16' } })).json();
    expect(t.dauer).toBe(25);
    expect((await d.vault.lesen(t.pfad)).inhalt).toMatch(/^dauer: 25$/m);
    expect((await d.app.inject({ method: 'POST', url: '/api/todos', headers: h, payload: { titel: 'x', dauer: 2 } })).statusCode).toBe(400);
    t = (await d.app.inject({ method: 'PATCH', url: '/api/todos', headers: h, payload: { pfad: t.pfad, basisVersion: t.version, dauer: 50 } })).json();
    expect(t.dauer).toBe(50);
    t = (await d.app.inject({ method: 'PATCH', url: '/api/todos', headers: h, payload: { pfad: t.pfad, basisVersion: t.version, erledigt: true } })).json();
    const nf = (await d.todos.liste()).find((x) => !x.erledigt && x.titel === 'Lesen')!;
    expect(nf.dauer).toBe(50);
    const n2 = (await d.app.inject({ method: 'PATCH', url: '/api/todos', headers: h, payload: { pfad: nf.pfad, basisVersion: nf.version, dauer: 0 } })).json();
    expect(n2.dauer).toBeUndefined();
    const ein = Date.UTC(2026, 10, 16, 8);
    const bloecke = tagPlanen({ todos: [{ ...nf, dauer: 20, faellig: '2026-11-16' }], heute: '2026-11-16', frei: [[ein, ein + 4 * 3600_000]] });
    expect(bloecke[0]!.ende - bloecke[0]!.start).toBe(20 * 60_000);
  });
});
