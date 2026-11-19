import { describe, expect, it } from 'vitest';
import type { TodoInfo } from '@dorf/shared';
import { projekteAus } from '@dorf/shared';

const t = (titel: string, o: Partial<TodoInfo> = {}): TodoInfo => ({ pfad: `Marktplatz/todos/${titel}.md`, version: 'v', titel, erledigt: false, ...o });

describe('Projekte (E161)', () => {
  it('Gruppen ab 3 To-dos oder 2 offenen; Fortschritt, nächster Schritt, Ruhe, Fokus', () => {
    const jetzt = Date.parse('2026-11-16T12:00:00Z');
    const p = projekteAus(
      [
        t('Gliederung', { gruppe: 'Bachelorarbeit', erledigt: true, erledigtAm: '2026-11-14T10:00:00Z', erstellt: '2026-11-01T10:00:00Z' }),
        t('Kapitel 1', { gruppe: 'Bachelorarbeit', faellig: '2026-11-20', erstellt: '2026-11-01T10:00:00Z', fokusMin: 50, schritte: [{ text: 'Quellen sammeln', erledigt: false }] }),
        t('Kapitel 2', { gruppe: 'Bachelorarbeit', erstellt: '2026-11-01T10:00:00Z' }),
        t('Kisten', { gruppe: 'Umzug', erstellt: '2026-11-01T10:00:00Z' }),
        t('Ummelden', { gruppe: 'Umzug', erstellt: '2026-11-02T10:00:00Z' }),
        t('Einzeln', { gruppe: 'Solo' }),
        t('Ohne Gruppe'),
      ],
      jetzt,
    );
    expect(p.map((x) => x.name)).toEqual(['Bachelorarbeit', 'Umzug']);
    expect(p[0]).toMatchObject({ gesamt: 3, erledigt: 1, offen: 2, dieseWoche: 1, fokusMin: 50, ruhtTage: 2, naechster: { titel: 'Kapitel 1', faellig: '2026-11-20', schritt: 'Quellen sammeln' } });
    expect(p[1]).toMatchObject({ offen: 2, ruhtTage: 14 });
  });
});

describe('Projekte im Wochenrückblick (E161)', () => {
  it('Zeile mit Fortschritt', async () => {
    const { testDorf } = await import('./hilfen.js');
    const d = await testDorf();
    for (const x of ['A', 'B', 'C']) await d.todos.anlegen({ titel: `Kapitel ${x}`, gruppe: 'Bachelorarbeit' }, 'Leif');
    const t = (await d.todos.liste())[0]!;
    await d.todos.aendern(t.pfad, { erledigt: true });
    const r = await d.wochenrueckblick.fakten();
    expect(r.abschnitte.find((x) => x.titel === 'Erledigt und offen')!.zeilen.join('\n')).toContain('📁 Projekte: Bachelorarbeit 1/3 (+1)');
  });
});
