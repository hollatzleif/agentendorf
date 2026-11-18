import { describe, expect, it } from 'vitest';
import { testDorf } from './hilfen.js';
import { zeitpunktAus, zeitpunktMs } from '../src/todo-erinnerungen.js';

const MIN = 60_000;

describe('Erinnerungen an To-dos (E94)', () => {
  it('Ortszeit ↔ ms (Winterzeit Wien)', () => {
    expect(zeitpunktMs('2026-11-16T13:00')).toBe(Date.UTC(2026, 10, 16, 12, 0));
    expect(zeitpunktAus(Date.UTC(2026, 10, 16, 12, 0))).toBe('2026-11-16T13:00');
  });

  it('läutet genau einmal zur Zeit im Kirchturm; Schlummern verschiebt um 10 min; Erledigt lässt verstummen', async () => {
    const d = await testDorf();
    // TestUhr: 16.11. 13:00 Wien
    const t = await d.todos.anlegen({ titel: 'Mama anrufen', erinnerung: '2026-11-16T13:30' }, 'Leif');
    expect(t.erinnerung).toBe('2026-11-16T13:30');
    expect(await d.erinnerungen.pruefen()).toBe(0);
    d.uhr.vor(30 * MIN);
    expect(await d.erinnerungen.pruefen()).toBe(1);
    expect(await d.erinnerungen.pruefen()).toBe(0);
    const k = d.kirchturm.zustand().klingelt;
    expect(k).toEqual([expect.objectContaining({ quelle: 'erinnerung', bezugId: t.pfad, titel: '🔔 Mama anrufen', schlummern: true })]);
    // Schlummern im Kirchturm → neue Zeit +10 min, läutet dann wieder
    d.kirchturm.ausfuehren({ befehl: 'klingel', id: k[0]!.id, aktion: 'schlummern' });
    await new Promise((r) => setTimeout(r, 20));
    expect((await d.todos.holen(t.pfad)).erinnerung).toBe('2026-11-16T13:40');
    d.uhr.vor(10 * MIN);
    expect(await d.erinnerungen.pruefen()).toBe(1);
    await d.todos.aendern(t.pfad, { erledigt: true });
    await d.erinnerungen.pruefen();
    expect(d.kirchturm.zustand().klingelt).toEqual([]);
  });

  it('länger als 12 h verpasst → kein Läuten mehr; ungültiges Format abgelehnt', async () => {
    const d = await testDorf();
    await d.todos.anlegen({ titel: 'Alt', erinnerung: '2026-11-15T09:00' }, 'Leif');
    expect(await d.erinnerungen.pruefen()).toBe(0);
    expect(d.kirchturm.zustand().klingelt).toEqual([]);
    await expect(d.todos.anlegen({ titel: 'X', erinnerung: '16.11. 9 Uhr' }, 'Leif')).rejects.toThrow();
  });

  it('wiederkehrend: das nächste To-do erinnert zur gleichen Uhrzeit am neuen Tag', async () => {
    const d = await testDorf();
    const t = await d.todos.anlegen({ titel: 'Vokabeln', faellig: '2026-11-16', wiederholen: 'täglich', erinnerung: '2026-11-16T18:00' }, 'Leif');
    await d.todos.aendern(t.pfad, { erledigt: true });
    const neu = (await d.todos.liste()).find((x) => !x.erledigt)!;
    expect(neu).toMatchObject({ faellig: '2026-11-17', erinnerung: '2026-11-17T18:00' });
  });
});

describe('Erinnerungen in allen Listen (Review)', () => {
  it('läutet auch für die Einkaufsliste; Verschieben trifft die richtige Liste', async () => {
    const d = await testDorf();
    const t = await d.listen.einkauf.anlegen({ titel: 'Milch', erinnerung: '2026-11-16T13:10' }, 'Leif');
    d.uhr.vor(11 * 60_000);
    expect(await d.erinnerungen.pruefen()).toBe(1);
    const neu = await d.erinnerungen.verschieben(t.pfad, { minuten: 60 });
    expect(neu).toMatchObject({ pfad: t.pfad, erinnerung: '2026-11-16T14:11' });
  });
});
