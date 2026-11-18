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

describe('Fokuszeit je To-do (E122)', () => {
  it('GET /api/todos summiert die Pomodoro-Minuten je To-do', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    const t = await d.todos.anlegen({ titel: 'Referat', dauer: 90 }, 'Leif');
    const andere = await d.todos.anlegen({ titel: 'Anderes' }, 'Leif');
    const ins = d.db.prepare('INSERT INTO fokus_sitzungen (start, ende, minuten, thema, gruppe, todo, vollstaendig) VALUES (0, 0, ?, ?, NULL, ?, 1)');
    ins.run(25, 'Referat', t.pfad);
    ins.run(24.6, 'Referat', t.pfad);
    ins.run(25, 'ohne To-do', null);
    const l = (await d.app.inject({ url: '/api/todos', headers: h })).json() as { pfad: string; fokusMin?: number }[];
    expect(l.find((x) => x.pfad === t.pfad)?.fokusMin).toBe(50);
    expect(l.find((x) => x.pfad === andere.pfad)?.fokusMin).toBeUndefined();
    // die Einkaufsliste bekommt kein Feld
    expect(((await d.app.inject({ url: '/api/listen/einkauf', headers: h })).json() as unknown[]).length).toBe(0);
  });
});

describe('Wochenrückblick: Schätzung gegen Fokus (E122)', () => {
  it('Faktor über die erledigten To-dos mit Schätzung und Fokuszeit', async () => {
    const d = await testDorf();
    const a = await d.todos.anlegen({ titel: 'Referat', dauer: 60 }, 'Leif');
    const b = await d.todos.anlegen({ titel: 'Blatt 3', dauer: 60 }, 'Leif');
    const c = await d.todos.anlegen({ titel: 'Nur Schätzung', dauer: 30 }, 'Leif');
    const ins = d.db.prepare('INSERT INTO fokus_sitzungen (start, ende, minuten, thema, gruppe, todo, vollstaendig) VALUES (0, 0, ?, NULL, NULL, ?, 1)');
    ins.run(100, a.pfad);
    ins.run(80, b.pfad);
    for (const t of [a, b, c]) await d.todos.aendern(t.pfad, { erledigt: true });
    const s = (await d.wochenrueckblick.fakten()).abschnitte.find((x) => x.titel === 'Schätzung')!;
    expect(s.zeilen[0]).toBe('Du hast im Schnitt **1,5×** so lange gebraucht wie geschätzt – nächste Woche großzügiger planen.');
    expect(s.zeilen).toContain('Referat: ⏱ 60 min geschätzt · 🍅 100 min');
    expect(s.zeilen.some((z) => z.includes('Nur Schätzung'))).toBe(false);
  });
});
