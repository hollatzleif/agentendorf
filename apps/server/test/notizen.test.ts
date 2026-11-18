import { describe, expect, it } from 'vitest';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';

describe('Schnelle Notizen (E95)', () => {
  it('hängt an die Tagesnotiz an (Uhrzeit Wien), lässt Obsidian-Text stehen, neuer Tag = neue Datei', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    let r = await d.app.inject({ method: 'POST', url: '/api/notiz', headers: h, payload: { text: 'Idee: Lernplan für Statistik' } });
    expect(r.json()).toEqual({ pfad: 'Rathaus/notizen/2026-11-16.md', zeile: '- 13:00 Idee: Lernplan für Statistik' });
    const v = await d.vault.lesen('Rathaus/notizen/2026-11-16.md');
    await d.vault.schreiben('Rathaus/notizen/2026-11-16.md', `${v.inhalt}Von Hand dazu.\n`, { basisVersion: v.version });
    d.uhr.vor(5 * 60_000);
    await d.app.inject({ method: 'POST', url: '/api/notiz', headers: h, payload: { text: 'zweite\nZeile' } });
    expect((await d.vault.lesen('Rathaus/notizen/2026-11-16.md')).inhalt).toBe('# Notizen Montag, 16. November 2026\n\n- 13:00 Idee: Lernplan für Statistik\nVon Hand dazu.\n- 13:05 zweite ⏎ Zeile\n');
    expect((await d.app.inject({ url: '/api/notizen/heute', headers: h })).json().zeilen).toEqual(['- 13:00 Idee: Lernplan für Statistik', '- 13:05 zweite ⏎ Zeile']);
    expect((await d.app.inject({ method: 'POST', url: '/api/notiz', headers: h, payload: { text: '   ' } })).statusCode).toBe(400);
    d.uhr.vor(86_400_000);
    r = await d.app.inject({ method: 'POST', url: '/api/notiz', headers: h, payload: { text: 'morgen' } });
    expect(r.json().pfad).toBe('Rathaus/notizen/2026-11-17.md');
    const l = (await d.app.inject({ url: '/api/notizen?tage=7', headers: h })).json();
    expect(l.map((x: { tag: string }) => x.tag)).toEqual(['2026-11-17', '2026-11-16']);
    expect(l[1].zeilen).toHaveLength(2);
  });
});
