import { describe, expect, it } from 'vitest';
import type { DorfStatus } from '@dorf/shared';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';

const STD = 3_600_000;

describe('Das Dorf spiegelt den Tag (E131)', () => {
  // TestUhr: Mo, 16.11.2026 12:00 UTC = 13:00 in Wien
  it('Tafel: offene To-dos bis heute und heute Erledigtes – nach dem Wiener Kalendertag', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    const status = async () => (await d.app.inject({ url: '/api/dorf/status', headers: h })).json() as DorfStatus;
    expect((await status()).tag).toEqual({ dran: 0, erledigt: 0 });

    const heute = await d.todos.anlegen({ titel: 'Heute', faellig: '2026-11-16' }, 'Leif');
    await d.todos.anlegen({ titel: 'Überfällig', faellig: '2026-11-10' }, 'Leif');
    await d.todos.anlegen({ titel: 'Morgen', faellig: '2026-11-17' }, 'Leif');
    const ohne = await d.todos.anlegen({ titel: 'Ohne Datum' }, 'Leif');
    expect((await status()).tag).toEqual({ dran: 2, erledigt: 0 });

    await d.todos.aendern(heute.pfad, { erledigt: true });
    expect((await status()).tag).toEqual({ dran: 1, erledigt: 1 });
    // Erledigtes ohne Fälligkeit zählt als heute geschafft, war aber nie „dran“
    d.uhr.vor(10.5 * STD); // 23:30 in Wien (22:30 UTC)
    await d.todos.aendern(ohne.pfad, { erledigt: true });
    expect((await status()).tag).toEqual({ dran: 1, erledigt: 2 });
    // wieder geöffnet → zurück auf die offene Seite
    await d.todos.aendern(heute.pfad, { erledigt: false });
    expect((await status()).tag).toEqual({ dran: 2, erledigt: 1 });

    // 00:30 in Wien am 17.11. (in UTC noch der 16.): neuer Tag – gestern Erledigtes fällt weg, „Morgen“ ist dran
    d.uhr.vor(STD);
    expect((await status()).tag).toEqual({ dran: 3, erledigt: 0 });
    expect(await d.dorfplan.tag()).toEqual({ dran: 3, erledigt: 0 });
  });

  it('Fokus: nur solange ein Pomodoro in der Arbeitsphase läuft', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    const fokus = async () => ((await d.app.inject({ url: '/api/dorf/status', headers: h })).json() as DorfStatus).fokus;
    const b = (x: Record<string, unknown>) => d.kirchturm.ausfuehren(x);
    expect(await fokus()).toBe(false);
    expect(d.dorfplan.status().fokus).toBe(false);

    // auch ohne „Nicht stören“ ist es Fokus
    b({ befehl: 'pomodoro_einstellen', einstellungen: { ...d.kirchturm.zustand().pomodoro.einstellungen, nichtStoeren: false, autoWeiter: true } });
    b({ befehl: 'pomodoro', aktion: 'start' });
    expect(d.kirchturm.zustand().pomodoro).toMatchObject({ phase: 'arbeit', status: 'laeuft' });
    expect(await fokus()).toBe(true);

    b({ befehl: 'pomodoro', aktion: 'pause' });
    expect(await fokus()).toBe(false);
    b({ befehl: 'pomodoro', aktion: 'weiter' });
    expect(await fokus()).toBe(true);

    // Arbeitsphase läuft ab → Pause: kein Fokus
    d.uhr.vor(d.kirchturm.zustand().pomodoro.einstellungen.arbeitMin * 60_000 + 1000);
    d.kirchturm.pruefen();
    expect(d.kirchturm.zustand().pomodoro.phase).toBe('kurz');
    expect(await fokus()).toBe(false);

    b({ befehl: 'pomodoro', aktion: 'ueberspringen' });
    expect(await fokus()).toBe(true);
    b({ befehl: 'pomodoro', aktion: 'stopp' });
    expect(await fokus()).toBe(false);
  });
});
