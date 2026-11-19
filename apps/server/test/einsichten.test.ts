import { describe, expect, it } from 'vitest';
import { guteTage } from '@dorf/shared';

const tag = (i: number, o: { fokusMin?: number; erledigt?: number; gf?: number; ge?: number; stimmung: number | null }) => ({
  tag: `2026-11-${String(i).padStart(2, '0')}`,
  erledigt: o.erledigt ?? 0,
  fokusMin: o.fokusMin ?? 0,
  gewohnheitenFaellig: o.gf ?? 0,
  gewohnheitenErledigt: o.ge ?? 0,
  stimmung: o.stimmung,
});

describe('Was gute Tage ausmacht (E162)', () => {
  it('vergleicht nur mit genug Tagen und deutlichem Unterschied', () => {
    const tage = [
      tag(1, { fokusMin: 90, stimmung: 4 }),
      tag(2, { fokusMin: 120, stimmung: 5 }),
      tag(3, { fokusMin: 60, stimmung: 4 }),
      tag(4, { fokusMin: 0, stimmung: 2 }),
      tag(5, { fokusMin: 10, stimmung: 3 }),
      tag(6, { fokusMin: 0, stimmung: 2 }),
      tag(7, { fokusMin: 0, stimmung: null }),
    ];
    expect(guteTage(tage)).toEqual([{ text: 'An Tagen mit mindestens 1 h Fokus: Stimmung ⌀ 4,3 – sonst 2,3', mit: 4.3, ohne: 2.3, tageMit: 3, tageOhne: 3 }]);
    // zu wenige Tage → nichts
    expect(guteTage(tage.slice(0, 5))).toEqual([]);
    // kein Unterschied → nichts
    expect(guteTage(tage.map((t) => ({ ...t, stimmung: t.stimmung == null ? null : 3 })))).toEqual([]);
  });
});

describe('Gute Tage im Wochenrückblick (E162)', () => {
  it('erscheint mit genug Stimmungs-Tagen', async () => {
    const { testDorf } = await import('./hilfen.js');
    const { stimmungSetzen } = await import('../src/statistik.js');
    const d = await testDorf();
    const ins = d.db.prepare('INSERT INTO fokus_sitzungen (start, ende, minuten, thema, gruppe, todo, vollstaendig) VALUES (?, ?, ?, NULL, NULL, NULL, 1)');
    for (let i = 1; i <= 6; i++) {
      const ende = d.uhr.jetzt() - i * 86_400_000;
      const tag = new Date(ende).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
      if (i <= 3) ins.run(ende - 90 * 60_000, ende, 90);
      stimmungSetzen(d.db, tag, i <= 3 ? 5 : 2, ende);
    }
    const r = await d.wochenrueckblick.fakten();
    expect(r.abschnitte.find((x) => x.titel === 'Gute Tage')!.zeilen[0]).toBe('An Tagen mit mindestens 1 h Fokus: Stimmung ⌀ 5 – sonst 2');
  });
});
