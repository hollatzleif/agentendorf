import { describe, expect, it } from 'vitest';
import type { KalenderTermin, TodoInfo } from '@dorf/shared';
import { belegtMs, jetztDran, tagesBudget } from '@dorf/shared';

const todo = (titel: string, o: Partial<TodoInfo> = {}): TodoInfo => ({ pfad: `Marktplatz/todos/${titel}.md`, version: 'v', titel, erledigt: false, ...o });
const termin = (titel: string, start: string, ende: string): KalenderTermin => ({ id: titel, kalenderId: 'k', titel, start, ende, ganztags: false, quelle: 'google', schreibbar: false }) as KalenderTermin;
// Mi 18.11.2026, 10:00 Wien = 09:00Z
const jetzt = Date.parse('2026-11-18T09:00:00Z');
const basis = { jetzt, jetztMin: 600, heute: '2026-11-18' };

describe('Tagesbudget und „Jetzt dran“ (E120/E123)', () => {
  it('Budget: Schätzungen gegen freie Zeit bis 22 Uhr minus Termine', () => {
    const b = tagesBudget({ ...basis, todos: [todo('a', { faellig: '2026-11-18', dauer: 120 }), todo('b', { faellig: '2026-11-17' }), todo('c', { faellig: '2026-11-19', dauer: 600 })], termine: [termin('V', '2026-11-18T10:00:00Z', '2026-11-18T12:00:00Z')] });
    expect(b).toEqual({ anzahl: 2, geschaetztMin: 120, ohneSchaetzung: 1, freiMin: 600, zuViel: false });
  });

  it('Überlappende Termine zählen einmal; nachts beginnt der freie Tag um 8 Uhr (Review)', () => {
    expect(belegtMs([[13, 18], [14, 16], [17, 20], [21, 22]], 0, 100)).toBe(8);
    expect(belegtMs([[0, 5], [3, 4]], 2, 4)).toBe(2);
    const doppelt = [termin('Uni', '2026-11-18T12:00:00Z', '2026-11-18T17:00:00Z'), termin('Tutorium', '2026-11-18T13:00:00Z', '2026-11-18T15:00:00Z')];
    expect(tagesBudget({ ...basis, todos: [], termine: doppelt }).freiMin).toBe(7 * 60);
    // 0:07 Uhr: frei sind 8–22 Uhr = 14 h, nicht 21 h 53
    expect(tagesBudget({ ...basis, jetzt: Date.parse('2026-11-17T23:07:00Z'), jetztMin: 7, todos: [], termine: [] }).freiMin).toBe(14 * 60);
    expect(jetztDran({ ...basis, jetztMin: 7, todos: [todo('x', { faellig: '2026-11-17' })], termine: [] })).toBeNull();
  });

  it('Jetzt dran: das erste To-do, das in die Lücke bis zum nächsten Termin passt, mit nächstem Schritt', () => {
    const termine = [termin('Vorlesung', '2026-11-18T10:00:00Z', '2026-11-18T12:00:00Z')]; // Lücke 60 min
    const todos = [
      todo('Gross', { faellig: '2026-11-17', dauer: 120 }),
      todo('Klein', { faellig: '2026-11-18', dauer: 45, schritte: [{ text: 'a', erledigt: true }, { text: 'b', erledigt: false }] }),
      todo('Später', { faellig: '2026-11-30', dauer: 10 }),
    ];
    const d = jetztDran({ ...basis, todos, termine })!;
    expect(d.todo.titel).toBe('Klein');
    expect(d).toMatchObject({ schritt: 'b', luecke: 60, passt: true, bis: { titel: 'Vorlesung' } });
    // schon Fokus auf „Gross“ → Rest 50 min passt, und überfällig kommt zuerst
    expect(jetztDran({ ...basis, todos: [{ ...todos[0]!, fokusMin: 70 }, todos[1]!], termine })!.todo.titel).toBe('Gross');
  });

  it('nichts passt ganz: ab 25 min das erste für einen Pomodoro; während eines Termins oder unter 10 min: nichts', () => {
    const t = [todo('Gross', { faellig: '2026-11-18', dauer: 180 })];
    expect(jetztDran({ ...basis, todos: t, termine: [termin('X', '2026-11-18T09:30:00Z', '2026-11-18T10:00:00Z')] })).toMatchObject({ passt: false, luecke: 30 });
    expect(jetztDran({ ...basis, todos: t, termine: [termin('X', '2026-11-18T09:20:00Z', '2026-11-18T10:00:00Z')] })).toBeNull();
    expect(jetztDran({ ...basis, todos: t, termine: [termin('läuft', '2026-11-18T08:30:00Z', '2026-11-18T09:30:00Z')] })).toBeNull();
    expect(jetztDran({ ...basis, todos: t, termine: [termin('bald', '2026-11-18T09:05:00Z', '2026-11-18T10:00:00Z')] })).toBeNull();
    // nach 22 Uhr: Feierabend
    expect(jetztDran({ ...basis, jetztMin: 22 * 60 + 5, todos: t, termine: [] })).toBeNull();
    // nur ohne Datum und nicht wichtig → kein Vorschlag
    expect(jetztDran({ ...basis, todos: [todo('irgendwann')], termine: [] })).toBeNull();
  });
});

describe('Woche verteilen (E126)', () => {
  it('⭐ und Überfälliges zuerst, frühester Tag mit Platz (70 % Puffer), nichts in die Vergangenheit', async () => {
    const { wocheVerteilen } = await import('@dorf/shared');
    const tage = [
      { tag: '2026-11-16', freiMin: 600, geplantMin: 0 }, // Vergangenheit
      { tag: '2026-11-18', freiMin: 100, geplantMin: 0 }, // 70 min Platz
      { tag: '2026-11-19', freiMin: 600, geplantMin: 400 }, // 20 min Platz
      { tag: '2026-11-20', freiMin: 600, geplantMin: 0 }, // 420 min Platz
    ];
    const eingang = [
      todo('alt ohne Datum', { erstellt: '2026-11-01' }),
      todo('neu ohne Datum', { erstellt: '2026-11-10', dauer: 15 }),
      todo('überfällig', { faellig: '2026-11-10', dauer: 60 }),
      todo('wichtig', { wichtig: true, dauer: 300 }),
    ];
    const v = wocheVerteilen({ eingang, tage, heute: '2026-11-18' });
    expect(v.map((x) => [x.titel, x.tag])).toEqual([
      ['wichtig', '2026-11-20'],
      ['überfällig', '2026-11-18'],
      ['alt ohne Datum', '2026-11-20'],
      ['neu ohne Datum', '2026-11-19'],
    ]);
  });
});

describe('Wartet auf … (E147)', () => {
  it('ruht bis zum Nachfass-Tag: nicht in Jetzt dran, Woche verteilen, Tag planen; am Tag wieder normal', async () => {
    const { ruht, wocheVerteilen } = await import('@dorf/shared');
    const { tagPlanen } = await import('../src/tagesplan.js');
    const heute = '2026-11-16';
    const w = todo('Antwort Prof', { wartet: 'Prof. Müller', faellig: '2026-11-20', wichtig: true, dauer: 15 });
    const ohne = todo('Paket', { wartet: 'DHL', wichtig: true, dauer: 15 });
    expect(ruht(w, heute)).toBe(true);
    expect(ruht(ohne, heute)).toBe(true);
    expect(ruht(w, '2026-11-20')).toBe(false);
    expect(ruht(todo('x'), heute)).toBe(false);
    const jetzt = Date.parse('2026-11-16T09:00:00Z');
    expect(jetztDran({ todos: [w, ohne], termine: [], jetzt, jetztMin: 10 * 60, heute })).toBeNull();
    expect(jetztDran({ todos: [w], termine: [], jetzt, jetztMin: 10 * 60, heute: '2026-11-20' })?.todo.titel).toBe('Antwort Prof');
    expect(wocheVerteilen({ eingang: [ohne], tage: [{ tag: heute, freiMin: 600, geplantMin: 0 }], heute })).toEqual([]);
    expect(tagPlanen({ todos: [w, ohne], heute, frei: [[jetzt, jetzt + 4 * 3600_000]] })).toEqual([]);
  });
});
