import { describe, expect, it } from 'vitest';
import type { KirchturmKlingel } from '@dorf/shared';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';

const MIN = 60_000;

async function aufbau() {
  const d = await testDorf();
  const klingeln: KirchturmKlingel[] = [];
  d.kirchturm.beiKlingeln.push((k) => klingeln.push(k));
  const b = (x: Record<string, unknown>) => d.kirchturm.ausfuehren(x);
  // Sekunde für Sekunde vorspulen wäre langsam: in Schritten springen und dabei prüfen
  const spulen = (ms: number, schritt = 1000) => {
    for (let t = 0; t < ms; t += schritt) {
      d.uhr.vor(Math.min(schritt, ms - t));
      d.kirchturm.pruefen();
    }
  };
  return { d, klingeln, b, spulen };
}

describe('Kirchturm (E74)', () => {
  // TestUhr: Mo, 16.11.2026 12:00 UTC = 13:00 in Linz/Konstanz
  it('Wecker: Ortszeit, Wochentage, einmalig geht danach aus, Schlummern, Löschen', async () => {
    const x = await aufbau();
    const z = x.b({ befehl: 'wecker_speichern', name: 'Aufstehen', zeit: '13:05', tage: [1, 2, 3, 4, 5] });
    expect(z.wecker[0]).toMatchObject({ name: 'Aufstehen', aktiv: true, naechster: '2026-11-16T12:05:00.000Z' });
    x.spulen(4 * MIN);
    expect(x.klingeln).toHaveLength(0);
    x.spulen(1 * MIN);
    expect(x.klingeln).toEqual([expect.objectContaining({ quelle: 'wecker', titel: '⏰ Aufstehen', ton: 'gelaeut', schlummern: true })]);
    const s = x.d.kirchturm.zustand();
    expect(s.klingelt).toHaveLength(1);
    expect(s.wecker[0]!.naechster).toBe('2026-11-17T12:05:00.000Z'); // Dienstag
    // Schlummern: 9 min später nochmal
    x.b({ befehl: 'klingel', id: s.klingelt[0]!.id, aktion: 'schlummern' });
    expect(x.d.kirchturm.zustand().wecker[0]!.naechster).toBe('2026-11-16T12:14:00.000Z');
    x.spulen(9 * MIN, 30_000);
    expect(x.klingeln).toHaveLength(2);
    expect(x.d.kirchturm.zustand().wecker[0]!.naechster).toBe('2026-11-17T12:05:00.000Z');
    // Freitag → nächster Montag (Wochenende übersprungen)
    x.b({ befehl: 'alle_aus' });
    x.d.uhr.vor(4 * 86_400_000); // Fr 13:14
    x.d.kirchturm.pruefen(); // Di–Do verpasst (> 15 min) → kein Klingeln, aber weitergerückt
    expect(x.klingeln).toHaveLength(2);
    expect(x.d.kirchturm.zustand().wecker[0]!.naechster).toBe('2026-11-23T12:05:00.000Z');

    // einmaliger Wecker
    const e = x.b({ befehl: 'wecker_speichern', name: 'Pizza', zeit: '13:20', tage: [] });
    const pizza = e.wecker.find((w) => w.name === 'Pizza')!;
    expect(pizza.naechster).toBe('2026-11-20T12:20:00.000Z');
    x.spulen(6 * MIN, 30_000);
    expect(x.klingeln.at(-1)).toMatchObject({ titel: '⏰ Pizza' });
    expect(x.d.kirchturm.zustand().wecker.find((w) => w.id === pizza.id)).toMatchObject({ aktiv: false, naechster: null });
    x.b({ befehl: 'wecker_loeschen', id: pizza.id });
    expect(x.d.kirchturm.zustand().wecker.map((w) => w.name)).toEqual(['Aufstehen']);
  });

  it('Wecker über die Zeitumstellung: 07:00 bleibt 07:00 Ortszeit', async () => {
    const x = await aufbau();
    // Sommerzeit-Beginn 2027: So 28.03. → 07:00 MESZ = 05:00 UTC; Sa 27.03. 07:00 MEZ = 06:00 UTC
    x.d.uhr.vor(Date.UTC(2027, 2, 27, 0, 0) - x.d.uhr.jetzt());
    const z = x.b({ befehl: 'wecker_speichern', name: 'W', zeit: '07:00', tage: [0, 6] });
    expect(z.wecker[0]!.naechster).toBe('2027-03-27T06:00:00.000Z');
    x.d.uhr.vor(Date.UTC(2027, 2, 27, 6, 0) - x.d.uhr.jetzt());
    x.d.kirchturm.pruefen();
    expect(x.d.kirchturm.zustand().wecker[0]!.naechster).toBe('2027-03-28T05:00:00.000Z');
  });

  it('Timer: mehrere gleichzeitig, Pause/Weiter, +1 min, Neustart; Vorlagen', async () => {
    const x = await aufbau();
    x.b({ befehl: 'timer_start', name: 'Tee', dauerMs: 4 * MIN });
    x.b({ befehl: 'timer_start', dauerMs: 10 * MIN });
    let z = x.d.kirchturm.zustand();
    expect(z.timer.map((t) => t.name)).toEqual(['Tee', 'Timer 10 min']);
    const nudeln = z.timer[1]!.id;
    x.spulen(2 * MIN);
    x.b({ befehl: 'timer', id: nudeln, aktion: 'pause' });
    expect(x.d.kirchturm.zustand().timer[1]).toMatchObject({ status: 'pause', restMs: 8 * MIN, ende: null });
    x.spulen(2 * MIN);
    expect(x.klingeln.map((k) => k.titel)).toEqual(['⏳ Tee']);
    expect(x.klingeln[0]).toMatchObject({ ton: 'schlag', text: '4 min sind um.' });
    x.b({ befehl: 'timer', id: nudeln, aktion: 'weiter' });
    x.b({ befehl: 'timer', id: nudeln, aktion: 'plus_minute' });
    x.spulen(8 * MIN);
    expect(x.klingeln).toHaveLength(1);
    x.spulen(1 * MIN);
    expect(x.klingeln.map((k) => k.titel)).toEqual(['⏳ Tee', '⏳ Timer 10 min']);
    z = x.d.kirchturm.zustand();
    expect(z.timer[1]!.status).toBe('fertig');
    x.b({ befehl: 'timer', id: nudeln, aktion: 'neu' });
    expect(x.d.kirchturm.zustand().timer[1]).toMatchObject({ status: 'laeuft' });
    x.b({ befehl: 'timer', id: nudeln, aktion: 'loeschen' });
    expect(x.d.kirchturm.zustand().timer).toHaveLength(1);
    x.b({ befehl: 'vorlagen', vorlagen: [{ name: 'Ei', dauerMs: 7 * MIN }] });
    expect(x.d.kirchturm.zustand().vorlagen).toEqual([{ name: 'Ei', dauerMs: 7 * MIN }]);
    expect(() => x.b({ befehl: 'timer_start', dauerMs: 25 * 3600_000 })).toThrow();
  });

  it('Pomodoro voll einstellbar: Runden, lange Pause nach n, warten oder automatisch weiter, Pause, Überspringen', async () => {
    const x = await aufbau();
    x.b({ befehl: 'pomodoro_einstellen', einstellungen: { arbeitMin: 50, kurzMin: 10, langMin: 30, langNach: 2, runden: 3, autoWeiter: false, thema: 'Mathe III' } });
    x.b({ befehl: 'pomodoro', aktion: 'start' });
    expect(x.d.kirchturm.zustand().pomodoro).toMatchObject({ phase: 'arbeit', status: 'laeuft', erledigt: 0, einstellungen: { thema: 'Mathe III' } });
    x.spulen(50 * MIN, 30_000);
    expect(x.klingeln.at(-1)).toMatchObject({ titel: '🍅 Pause!', text: expect.stringMatching(/Runde 1 von 3 fertig – kurze Pause \(10 min\): Start drücken/) });
    expect(x.d.kirchturm.zustand().pomodoro).toMatchObject({ phase: 'kurz', status: 'wartet', restMs: 10 * MIN, erledigt: 1 });
    // wartet, bis Leif startet
    x.spulen(30 * MIN, 60_000);
    expect(x.klingeln).toHaveLength(1);
    x.b({ befehl: 'pomodoro', aktion: 'start' });
    x.spulen(10 * MIN, 30_000);
    expect(x.d.kirchturm.zustand().pomodoro).toMatchObject({ phase: 'arbeit', status: 'wartet' });
    // ab jetzt automatisch weiter
    x.b({ befehl: 'pomodoro_einstellen', einstellungen: { arbeitMin: 50, kurzMin: 10, langMin: 30, langNach: 2, runden: 3, autoWeiter: true } });
    x.b({ befehl: 'pomodoro', aktion: 'start' });
    x.spulen(20 * MIN, 30_000);
    x.b({ befehl: 'pomodoro', aktion: 'pause' });
    expect(x.d.kirchturm.zustand().pomodoro).toMatchObject({ status: 'pause', restMs: 30 * MIN });
    x.spulen(60 * MIN, 60_000);
    x.b({ befehl: 'pomodoro', aktion: 'weiter' });
    x.spulen(30 * MIN, 30_000);
    // Runde 2 fertig → lange Pause (nach 2), läuft von selbst
    expect(x.d.kirchturm.zustand().pomodoro).toMatchObject({ phase: 'lang', status: 'laeuft', erledigt: 2 });
    x.b({ befehl: 'pomodoro', aktion: 'ueberspringen' });
    expect(x.d.kirchturm.zustand().pomodoro).toMatchObject({ phase: 'arbeit', status: 'laeuft' });
    x.spulen(50 * MIN, 30_000);
    expect(x.d.kirchturm.zustand().pomodoro).toMatchObject({ phase: 'aus', status: 'aus', erledigt: 3 });
    expect(x.klingeln.at(-1)!.text).toMatch(/Geschafft – 3 Runden fertig/);
  });

  it('Stoppuhr mit Runden; Klingeln verschwindet nach 10 min; Zustand übersteht einen Neustart; API mit Prüfung', async () => {
    const x = await aufbau();
    x.b({ befehl: 'stoppuhr', aktion: 'start' });
    x.d.uhr.vor(65_000);
    x.b({ befehl: 'stoppuhr', aktion: 'runde' });
    x.d.uhr.vor(5000);
    x.b({ befehl: 'stoppuhr', aktion: 'stopp' });
    x.d.uhr.vor(60_000);
    expect(x.d.kirchturm.zustand().stoppuhr).toEqual({ start: null, bisherMs: 70_000, runden: [65_000] });
    x.b({ befehl: 'timer_start', dauerMs: 1000 });
    x.spulen(1000);
    expect(x.d.kirchturm.zustand().klingelt).toHaveLength(1);
    x.spulen(10 * MIN, 60_000);
    expect(x.d.kirchturm.zustand().klingelt).toHaveLength(0);

    const { Kirchturm } = await import('../src/kirchturm.js');
    const neu = new Kirchturm({ db: x.d.db, uhr: x.d.uhr, hub: x.d.hub });
    expect(neu.zustand().stoppuhr.bisherMs).toBe(70_000);

    const h = await kopf(x.d);
    expect((await x.d.app.inject({ method: 'POST', url: '/api/kirchturm', headers: h, payload: { befehl: 'wecker_speichern', zeit: '25:00' } })).statusCode).toBe(400);
    expect((await x.d.app.inject({ method: 'POST', url: '/api/kirchturm', headers: h, payload: { befehl: 'toene', mitteilungen: false, weckerWiederholen: 3 } })).json().toene).toEqual({
      mitteilungen: false,
      weckerWiederholen: 3,
    });
    expect((await x.d.app.inject({ url: '/api/kirchturm' })).statusCode).toBe(401);
    // Gebäude ist da
    expect(await x.d.vault.existiert('Kirchturm/gebaeude.md')).toBe(true);
  });
});

describe('Fokus (Nacht 18./19.11.)', () => {
  it('Pomodoro für ein To-do: Fokuszeit je Fach, abgebrochene Phasen zählen ab 1 min, Statistik und Serie', async () => {
    const x = await aufbau();
    x.b({ befehl: 'pomodoro_einstellen', einstellungen: { arbeitMin: 25, kurzMin: 5, langMin: 15, langNach: 4, runden: 4, autoWeiter: false } });
    x.b({ befehl: 'pomodoro_fuer', titel: 'Abgabe: Blatt 5', gruppe: 'Mathe III', pfad: 'Marktplatz/todos/a.md' });
    expect(x.d.kirchturm.zustand().pomodoro).toMatchObject({ phase: 'arbeit', status: 'laeuft', einstellungen: { thema: 'Abgabe: Blatt 5', gruppe: 'Mathe III' } });
    x.spulen(25 * MIN, 60_000);
    // zweite Phase nach 10 min abgebrochen
    x.b({ befehl: 'pomodoro', aktion: 'start' }); // kurze Pause
    x.spulen(5 * MIN, 60_000);
    x.b({ befehl: 'pomodoro', aktion: 'start' }); // Arbeit
    x.spulen(10 * MIN, 60_000);
    x.b({ befehl: 'pomodoro', aktion: 'stopp' });
    // 30 s zählen nicht
    x.b({ befehl: 'pomodoro_fuer', titel: 'Lesen' });
    x.d.uhr.vor(30_000);
    x.b({ befehl: 'pomodoro', aktion: 'stopp' });
    let s = x.d.kirchturm.fokusStatistik();
    expect(s).toMatchObject({ heuteMin: 35, wocheMin: 35, heutePomodoros: 1, serie: 1 });
    expect(s.themen).toEqual([{ thema: 'Mathe III', min: 35 }]);
    expect(s.tage).toHaveLength(7);
    expect(s.tage.at(-1)).toMatchObject({ tag: '2026-11-16', min: 35 });
    // nächster Tag ohne fertige Phase: Serie bleibt (zählt bis gestern), übermorgen ist sie weg
    x.d.uhr.vor(86_400_000);
    expect(x.d.kirchturm.fokusStatistik()).toMatchObject({ heuteMin: 0, serie: 1, wocheMin: 35 });
    x.d.uhr.vor(86_400_000);
    s = x.d.kirchturm.fokusStatistik();
    expect(s.serie).toBe(0);
    const h = await kopf(x.d);
    expect((await x.d.app.inject({ url: '/api/kirchturm/fokus', headers: h })).json()).toMatchObject({ wocheMin: 35 });
  });

  it('Nicht stören: während der Arbeitsphase sammelt Telegram, danach kommt alles in einer Nachricht', async () => {
    const aufrufe: { m: string; p: Record<string, unknown> }[] = [];
    const api = {
      async aufruf<T>(m: string, p: Record<string, unknown> = {}) {
        aufrufe.push({ m, p });
        return { message_id: aufrufe.length } as T;
      },
      async dateiLaden() {
        return { name: 'x', inhalt: Buffer.from('') };
      },
    };
    const d = await testDorf({ telegram: api, env: { TELEGRAM_CHAT_ID: '1' } });
    const gesendet = () => aufrufe.filter((a) => a.m === 'sendMessage').map((a) => String(a.p.text));
    d.kirchturm.ausfuehren({ befehl: 'pomodoro_fuer', titel: 'Mathe' });
    expect(d.kirchturm.fokusAktiv()).toBe(true);
    await d.telegram!.bankMelden('Budget Essen fast aufgebraucht');
    expect(gesendet()).toEqual([]);
    // Phase zu Ende → Nachricht kommt gesammelt
    d.uhr.vor(25 * MIN);
    d.kirchturm.pruefen();
    await expect.poll(() => gesendet().length).toBe(1);
    expect(gesendet()[0]).toMatch(/Während deiner Fokuszeit.*\n\nBudget Essen fast aufgebraucht/s);
    // mit „Nicht stören“ aus kommt alles sofort
    d.kirchturm.ausfuehren({ befehl: 'pomodoro_einstellen', einstellungen: { arbeitMin: 25, kurzMin: 5, langMin: 15, langNach: 4, runden: 4, autoWeiter: false, nichtStoeren: false } });
    d.kirchturm.ausfuehren({ befehl: 'pomodoro', aktion: 'start' });
    expect(d.kirchturm.fokusAktiv()).toBe(false);
    await d.telegram!.bankMelden('Zweite Meldung');
    expect(gesendet().at(-1)).toMatch(/Zweite Meldung/);
  });
});
