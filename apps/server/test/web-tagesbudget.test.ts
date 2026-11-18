import { describe, expect, it } from 'vitest';
import type { KalenderTermin, TodoInfo } from '@dorf/shared';
// reine Funktionen der App (keine DOM-Abhängigkeit) – hier mitgetestet
import { jetztDran, tagesBudget } from '../../web/src/tagesbudget.js';

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
