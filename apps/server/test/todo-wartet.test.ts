import { describe, expect, it } from 'vitest';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';

describe('Wartet auf … (E147)', () => {
  it('API: anlegen mit wartet, ändern, entfernen; steht in der Datei und in der Textzeile', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    let t = (await d.app.inject({ method: 'POST', url: '/api/todos', headers: h, payload: { titel: 'Note Mathe', wartet: 'Prof. Müller', faellig: '2026-11-20' } })).json();
    expect(t.wartet).toBe('Prof. Müller');
    expect((await d.vault.lesen(t.pfad)).inhalt).toMatch(/^wartet: Prof\. Müller$/m);
    expect((await d.app.inject({ method: 'POST', url: '/api/todos', headers: h, payload: { titel: 'x', wartet: 'y'.repeat(81) } })).statusCode).toBe(400);
    t = (await d.app.inject({ method: 'PATCH', url: '/api/todos', headers: h, payload: { pfad: t.pfad, basisVersion: t.version, wartet: 'Sekretariat' } })).json();
    expect(t.wartet).toBe('Sekretariat');
    const { todoZeile } = await import('../src/todos.js');
    expect(todoZeile(t)).toContain('⏳ wartet auf Sekretariat');
    t = (await d.app.inject({ method: 'PATCH', url: '/api/todos', headers: h, payload: { pfad: t.pfad, basisVersion: t.version, wartet: '' } })).json();
    expect(t.wartet).toBeUndefined();
    expect((await d.vault.lesen(t.pfad)).inhalt).not.toMatch(/wartet/);
    // Leine: setzt ein Fremdinhalt-Lauf „wartet“, wird das To-do fremd (Review)
    const f = await d.todos.aendern(t.pfad, { wartet: 'irgendwer' }, undefined, { fremd: true });
    expect(f.fremd).toBe(true);
  });
});

describe('Wartet auf … aus Text (E147)', () => {
  it('nur am Ende, mit Titel davor; verträgt Dauer und Klammern', async () => {
    const { todoAusText } = await import('@dorf/shared');
    const h = '2026-11-16';
    expect(todoAusText('Note Mathe wartet auf Prof. Müller', h)).toEqual({ titel: 'Note Mathe', wartet: 'Prof. Müller' });
    expect(todoAusText('Zimmer-Antwort (wartet auf Sekretariat)', h)).toEqual({ titel: 'Zimmer-Antwort', wartet: 'Sekretariat' });
    expect(todoAusText('Rechnung – wartet auf Corps 15 min', h)).toEqual({ titel: 'Rechnung', wartet: 'Corps', dauer: 15 });
    expect(todoAusText('wartet auf Godot', h)).toEqual({ titel: 'wartet auf Godot' });
    // nur als eigenes Wort (Review)
    expect(todoAusText('Zahlung erwartet auf Konto', h)).toEqual({ titel: 'Zahlung erwartet auf Konto' });
  });
});

describe('Energie am To-do (E151)', () => {
  it('setzen, entfernen, Nachfolger übernimmt sie, Textzeile zeigt 🧠', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    let t = (await d.app.inject({ method: 'POST', url: '/api/todos', headers: h, payload: { titel: 'Beweis', energie: 'hoch', wiederholen: 'täglich', faellig: '2026-11-16' } })).json();
    expect(t.energie).toBe('hoch');
    const { todoZeile } = await import('../src/todos.js');
    expect(todoZeile(t)).toContain('🧠');
    expect((await d.app.inject({ method: 'POST', url: '/api/todos', headers: h, payload: { titel: 'x', energie: 'mittel' } })).statusCode).toBe(400);
    t = (await d.app.inject({ method: 'PATCH', url: '/api/todos', headers: h, payload: { pfad: t.pfad, basisVersion: t.version, erledigt: true } })).json();
    expect((await d.todos.liste()).find((x) => !x.erledigt && x.titel === 'Beweis')!.energie).toBe('hoch');
    t = (await d.app.inject({ method: 'PATCH', url: '/api/todos', headers: h, payload: { pfad: t.pfad, basisVersion: t.version, energie: '' } })).json();
    expect(t.energie).toBeUndefined();
  });
});
