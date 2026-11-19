import { describe, expect, it } from 'vitest';
import { etappenPlan } from '@dorf/shared';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';

describe('In Etappen planen (E170)', () => {
  it('verteilt gleich große Etappen auf die Tage vor der Frist', () => {
    expect(etappenPlan({ titel: 'Referat', faellig: '2026-11-26', dauer: 480 }, '2026-11-16')).toEqual([
      { titel: 'Referat – Etappe 1/8', faellig: '2026-11-16', dauer: 60 },
      { titel: 'Referat – Etappe 2/8', faellig: '2026-11-17', dauer: 60 },
      { titel: 'Referat – Etappe 3/8', faellig: '2026-11-18', dauer: 60 },
      { titel: 'Referat – Etappe 4/8', faellig: '2026-11-19', dauer: 60 },
      { titel: 'Referat – Etappe 5/8', faellig: '2026-11-21', dauer: 60 },
      { titel: 'Referat – Etappe 6/8', faellig: '2026-11-22', dauer: 60 },
      { titel: 'Referat – Etappe 7/8', faellig: '2026-11-23', dauer: 60 },
      { titel: 'Referat – Etappe 8/8', faellig: '2026-11-24', dauer: 60 },
    ]);
    // wenige Tage → so viele Etappen wie Tage; ohne Schätzung 2 h
    expect(etappenPlan({ titel: 'Bericht', faellig: '2026-11-19' }, '2026-11-16').map((e) => [e.faellig, e.dauer])).toEqual([
      ['2026-11-16', 60],
      ['2026-11-17', 60],
    ]);
    // Frist morgen oder ohne Frist → nichts
    expect(etappenPlan({ titel: 'X', faellig: '2026-11-17', dauer: 300 }, '2026-11-16')).toEqual([]);
    expect(etappenPlan({ titel: 'X', dauer: 300 }, '2026-11-16')).toEqual([]);
  });

  it('API: legt die Etappen mit gemeinsamer Gruppe an; das Original bekommt die Gruppe; Wiederkehrendes abgelehnt', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    const t = (await d.app.inject({ method: 'POST', url: '/api/todos', headers: h, payload: { titel: 'Referat', faellig: '2026-11-20', dauer: 180 } })).json();
    const r = await d.app.inject({ method: 'POST', url: '/api/todos/etappen', headers: h, payload: { pfad: t.pfad, basisVersion: t.version } });
    expect(r.statusCode).toBe(200);
    const alle = await d.todos.liste();
    const etappen = alle.filter((x) => x.titel.startsWith('Referat – Etappe'));
    expect(etappen.map((x) => [x.titel, x.faellig, x.dauer, x.gruppe])).toEqual([
      ['Referat – Etappe 1/3', '2026-11-16', 60, 'Referat'],
      ['Referat – Etappe 2/3', '2026-11-17', 60, 'Referat'],
      ['Referat – Etappe 3/3', '2026-11-18', 60, 'Referat'],
    ]);
    expect(alle.find((x) => x.pfad === t.pfad)!.gruppe).toBe('Referat');
    // veraltete Version → 409, nichts doppelt
    expect((await d.app.inject({ method: 'POST', url: '/api/todos/etappen', headers: h, payload: { pfad: t.pfad, basisVersion: t.version } })).statusCode).toBe(409);
    const w = (await d.app.inject({ method: 'POST', url: '/api/todos', headers: h, payload: { titel: 'Sport', faellig: '2026-11-20', wiederholen: 'täglich' } })).json();
    expect((await d.app.inject({ method: 'POST', url: '/api/todos/etappen', headers: h, payload: { pfad: w.pfad, basisVersion: w.version } })).statusCode).toBe(400);
  });
});

describe('Review 9 (E173)', () => {
  it('fremd bleibt fremd; Original behält 15 min; zweites Planen → 409, auch bei schon gesetzter Gruppe', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    const t = await d.todos.anlegen({ titel: 'Abgabe: Blatt 5', faellig: '2026-11-20', dauer: 180, gruppe: 'Mathe III' }, 'Uni', { fremd: true });
    expect((await d.app.inject({ method: 'POST', url: '/api/todos/etappen', headers: h, payload: { pfad: t.pfad, basisVersion: t.version } })).statusCode).toBe(200);
    const alle = await d.todos.liste();
    const etappen = alle.filter((x) => x.titel.includes('– Etappe'));
    expect(etappen).toHaveLength(3);
    expect(etappen.every((x) => x.fremd === true && x.gruppe === 'Mathe III')).toBe(true);
    const o = alle.find((x) => x.pfad === t.pfad)!;
    expect(o.dauer).toBe(15);
    expect((await d.app.inject({ method: 'POST', url: '/api/todos/etappen', headers: h, payload: { pfad: o.pfad, basisVersion: o.version } })).statusCode).toBe(409);
    expect((await d.todos.liste()).filter((x) => x.titel.includes('– Etappe'))).toHaveLength(3);
  });
});

describe('Etappen-Sperre genauer (E176)', () => {
  it('erledigte gleichnamige Etappen sperren nicht; eine Etappe selbst lässt sich nicht weiter planen', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    const alt = await d.todos.anlegen({ titel: 'Abgabe: Hausübung – Etappe 1/2', gruppe: 'Abgabe: Hausübung', faellig: '2026-11-10' }, 'Leif');
    await d.todos.aendern(alt.pfad, { erledigt: true });
    const t = await d.todos.anlegen({ titel: 'Abgabe: Hausübung', faellig: '2026-11-20', dauer: 120 }, 'Leif');
    expect((await d.app.inject({ method: 'POST', url: '/api/todos/etappen', headers: h, payload: { pfad: t.pfad, basisVersion: t.version } })).statusCode).toBe(200);
    const e = (await d.todos.liste()).find((x) => x.titel === 'Abgabe: Hausübung – Etappe 1/2' && !x.erledigt)!;
    expect((await d.app.inject({ method: 'POST', url: '/api/todos/etappen', headers: h, payload: { pfad: e.pfad, basisVersion: e.version } })).statusCode).toBe(400);
  });
});
