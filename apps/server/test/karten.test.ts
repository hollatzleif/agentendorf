import { describe, expect, it } from 'vitest';
import { kartenLesen, naechsteWiederholung } from '../src/karten.js';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';

const TEXT = `---
titel: Karten
---
# Mathe III

Was ist eine Eigenwert? :: Ein λ mit Av = λv für ein v ≠ 0.
- Spur einer Matrix :: Summe der Diagonalelemente

### Satz von Cayley-Hamilton
Jede quadratische Matrix erfüllt ihr eigenes
charakteristisches Polynom.

### Leere Frage

## Notizen
Das hier ist keine Karte.
Spur einer Matrix :: doppelt – zählt nicht
`;

describe('Karteikarten (Nacht 18./19.11.)', () => {
  it('liest einzeilige und mehrzeilige Karten, ohne Leeres und Doppeltes; Id hängt nur an der Frage', () => {
    const k = kartenLesen('Mathe III', TEXT);
    expect(k.map((x) => [x.frage, x.antwort])).toEqual([
      ['Was ist eine Eigenwert?', 'Ein λ mit Av = λv für ein v ≠ 0.'],
      ['Spur einer Matrix', 'Summe der Diagonalelemente'],
      ['Satz von Cayley-Hamilton', 'Jede quadratische Matrix erfüllt ihr eigenes\ncharakteristisches Polynom.'],
    ]);
    expect(kartenLesen('Mathe III', 'Spur einer Matrix :: anders')[0]!.id).toBe(k[1]!.id);
    expect(kartenLesen('Andere', 'Spur einer Matrix :: x')[0]!.id).not.toBe(k[1]!.id);
  });

  it('Abstände wachsen mit „gut“/„leicht“, „nochmal“ setzt zurück (10 min)', () => {
    let s = { intervall: 0, leichtigkeit: 2.5, wiederholungen: 0 };
    const folge: number[] = [];
    for (let i = 0; i < 4; i++) {
      const n = naechsteWiederholung(s, 'gut');
      folge.push(n.intervall);
      s = n;
    }
    expect(folge).toEqual([1, 3, 7.5, 18.8]);
    expect(naechsteWiederholung(s, 'nochmal')).toMatchObject({ intervall: 0, wiederholungen: 0, inMs: 600_000, leichtigkeit: 2.3 });
    expect(naechsteWiederholung({ intervall: 0, leichtigkeit: 2.5, wiederholungen: 0 }, 'leicht').intervall).toBe(4);
    expect(naechsteWiederholung({ intervall: 10, leichtigkeit: 1.3, wiederholungen: 5 }, 'schwer')).toMatchObject({ intervall: 12, leichtigkeit: 1.3 });
  });

  it('API: Übersicht je Fach, fällige Karten (neue bis zum Tageslimit), antworten verschiebt die Fälligkeit', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    await d.uni.fachAnlegen('Mathe III');
    await d.vault.schreiben('Uni/faecher/Mathe III/karten.md', TEXT);
    expect((await d.app.inject({ url: '/api/karten', headers: h })).json()).toEqual([{ fach: 'Mathe III', gesamt: 3, faellig: 3, neu: 3, gelernt: 0 }]);
    const f = (await d.app.inject({ url: '/api/karten/faellig?fach=Mathe%20III', headers: h })).json();
    expect(f).toHaveLength(3);
    expect(f[0]).toMatchObject({ neu: true, frage: 'Was ist eine Eigenwert?' });
    const r = await d.app.inject({ method: 'POST', url: '/api/karten/antwort', headers: h, payload: { fach: 'Mathe III', id: f[0].id, bewertung: 'gut' } });
    expect(r.json()).toMatchObject({ intervall: 1, naechste: '2026-11-17T12:00:00.000Z' });
    await d.app.inject({ method: 'POST', url: '/api/karten/antwort', headers: h, payload: { fach: 'Mathe III', id: f[1].id, bewertung: 'nochmal' } });
    // jetzt: Karte 1 morgen, Karte 2 in 10 min, Karte 3 noch neu
    expect((await d.app.inject({ url: '/api/karten/faellig?fach=Mathe%20III', headers: h })).json().map((x: { frage: string }) => x.frage)).toEqual(['Satz von Cayley-Hamilton']);
    d.uhr.vor(11 * 60_000);
    expect((await d.app.inject({ url: '/api/karten/faellig?fach=Mathe%20III', headers: h })).json().map((x: { frage: string }) => x.frage)).toEqual(['Spur einer Matrix', 'Satz von Cayley-Hamilton']);
    expect((await d.app.inject({ url: '/api/karten/faellig?fach=Gibts%20nicht', headers: h })).statusCode).toBe(404);
    expect((await d.app.inject({ method: 'POST', url: '/api/karten/antwort', headers: h, payload: { fach: 'Mathe III', id: 'x', bewertung: 'gut' } })).statusCode).toBe(400);
  });
});

describe('Aktion „Karteikarten erstellen“', () => {
  it('ist gültig: Fach aus uni.faecher, schreibt nur im Uni-Gebäude, Fremdinhalte ohne Internet', async () => {
    const d = await testDorf();
    const { aktionenListe } = await import('../src/agenten/aktionen.js');
    const a = (await aktionenListe(d.vault)).find((x) => x.id === 'Uni/karten-erstellen')!;
    expect(a.fehler).toBeUndefined();
    expect(a).toMatchObject({ motor: 'claude-code', stufe: 'mittel', fremdinhalte: true });
    expect(a.eingaben.map((e) => e.name)).toEqual(['fach', 'thema']);
  });
});
