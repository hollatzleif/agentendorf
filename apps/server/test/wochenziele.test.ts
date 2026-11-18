import { describe, expect, it } from 'vitest';
import { zieleLesen } from '../src/wochenziele.js';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';

describe('Wochenziele (E91)', () => {
  it('liest Obsidian-Checkboxen, lässt anderen Text stehen', () => {
    expect(zieleLesen('# KW\nNotiz\n- [ ] A\n- [x] B\n* [X] C\n- kein Ziel\n')).toEqual([
      { text: 'A', erledigt: false, zeile: 2 },
      { text: 'B', erledigt: true, zeile: 3 },
      { text: 'C', erledigt: true, zeile: 4 },
    ]);
  });

  it('API: anlegen (Datei je KW), abhaken, entfernen, höchstens 7, Doppeltes abgelehnt; Notizen bleiben', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    // TestUhr: Mo 16.11.2026 = KW 47
    let r = await d.app.inject({ method: 'POST', url: '/api/wochenziele', headers: h, payload: { text: 'Blatt 6 abgeben' } });
    expect(r.json()).toMatchObject({ woche: '2026-KW47', pfad: 'Rathaus/wochenziele/2026-KW47.md', ziele: [{ text: 'Blatt 6 abgeben', erledigt: false }], letzte: { woche: '2026-KW46', ziele: [] } });
    await d.app.inject({ method: 'POST', url: '/api/wochenziele', headers: h, payload: { text: '3x Sport' } });
    expect((await d.app.inject({ method: 'POST', url: '/api/wochenziele', headers: h, payload: { text: '3X SPORT' } })).statusCode).toBe(409);
    // Leif schreibt in Obsidian eine Notiz dazu
    const v = await d.vault.lesen('Rathaus/wochenziele/2026-KW47.md');
    await d.vault.schreiben('Rathaus/wochenziele/2026-KW47.md', `${v.inhalt}\nNotiz: Montag Uni lang.\n`, { basisVersion: v.version });
    r = await d.app.inject({ method: 'POST', url: '/api/wochenziele/haken', headers: h, payload: { nr: 1, erledigt: true } });
    expect(r.json().ziele).toEqual([
      { text: 'Blatt 6 abgeben', erledigt: false },
      { text: '3x Sport', erledigt: true },
    ]);
    await d.app.inject({ method: 'POST', url: '/api/wochenziele', headers: h, payload: { text: 'Bewerbung' } });
    const inhalt = (await d.vault.lesen('Rathaus/wochenziele/2026-KW47.md')).inhalt;
    expect(inhalt).toBe('# Wochenziele 2026 · KW 47\n- [ ] Blatt 6 abgeben\n- [x] 3x Sport\n- [ ] Bewerbung\n\nNotiz: Montag Uni lang.\n');
    expect(await d.wochenziele.zeitungsZeilen()).toEqual(['1/3 erreicht · offen: Blatt 6 abgeben; Bewerbung']);
    expect(await d.wochenziele.rueckblickZeilen()).toEqual(['**1/3** erreicht', '✗ Blatt 6 abgeben', '✓ 3x Sport', '✗ Bewerbung']);
    r = await d.app.inject({ method: 'DELETE', url: '/api/wochenziele?nr=0', headers: h });
    expect(r.json().ziele.map((z: { text: string }) => z.text)).toEqual(['3x Sport', 'Bewerbung']);
    for (let i = 0; i < 5; i++) await d.app.inject({ method: 'POST', url: '/api/wochenziele', headers: h, payload: { text: `Z${i}` } });
    expect((await d.app.inject({ method: 'POST', url: '/api/wochenziele', headers: h, payload: { text: 'zu viel' } })).statusCode).toBe(409);
    expect((await d.app.inject({ method: 'POST', url: '/api/wochenziele/haken', headers: h, payload: { nr: 9, erledigt: true } })).statusCode).toBe(404);
    // nächste Woche: neue Datei, letzte Woche als Bilanz
    d.uhr.vor(7 * 86_400_000);
    const s = (await d.app.inject({ url: '/api/wochenziele', headers: h })).json();
    expect(s).toMatchObject({ woche: '2026-KW48', ziele: [], letzte: { woche: '2026-KW47' } });
    expect(s.letzte.ziele).toHaveLength(7);
    // am Sonntag für nächste Woche planen
    r = await d.app.inject({ method: 'POST', url: '/api/wochenziele', headers: h, payload: { text: 'Vorgeplant', naechsteWoche: true } });
    expect(r.json()).toMatchObject({ woche: '2026-KW48', naechste: { woche: '2026-KW49', ziele: [{ text: 'Vorgeplant', erledigt: false }] } });
    // Montag ohne Ziele: Anstoß in der Morgenzeitung
    expect((await d.morgenzeitung.fakten()).abschnitte[0]).toMatchObject({ titel: '🎯 Wochenziele', zeilen: [expect.stringMatching(/Noch keine Wochenziele/)] });
  });
});
