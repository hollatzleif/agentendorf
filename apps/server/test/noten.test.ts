import { describe, expect, it } from 'vitest';
import { notenStand, NOTEN_PFAD } from '../src/uni/noten.js';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';

describe('Noten & ECTS (E98)', () => {
  it('Schnitt ECTS-gewichtet über 1–4; 5 zählt nicht; „bestanden“ bringt ECTS ohne Schnitt; offene ECTS', () => {
    const s = notenStand({
      faecher: [
        { fach: 'Mathe', ects: 6, note: 1 },
        { fach: 'Statistik', ects: 3, note: 4 },
        { fach: 'Recht', ects: 3, note: 5 },
        { fach: 'Seminar', ects: 2, note: 'bestanden' },
        { fach: 'Neu', ects: 6 },
      ],
    });
    expect(s.schnitt).toBe(2); // (6·1 + 3·4) / 9
    expect(s.ectsBestanden).toBe(11);
    expect(s.ectsOffen).toBe(6);
    expect(notenStand({ faecher: [] }).schnitt).toBeNull();
  });

  it('API: setzen (Groß-/Kleinschreibung egal), Vorschläge aus den Fächern, Ziel, entfernen; Datei bleibt Obsidian-lesbar', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    await d.uni.fachAnlegen('Mathe III');
    await d.uni.fachAnlegen('Statistik');
    let r = (await d.app.inject({ url: '/api/uni/noten', headers: h })).json();
    expect(r).toMatchObject({ faecher: [], schnitt: null, vorschlaege: ['Mathe III', 'Statistik'] });
    await d.app.inject({ method: 'PUT', url: '/api/uni/noten', headers: h, payload: { fach: 'Mathe III', ects: 6, note: 2, semester: 'WS 2026' } });
    r = (await d.app.inject({ method: 'PUT', url: '/api/uni/noten', headers: h, payload: { fach: 'mathe iii', ects: 6, note: 1, semester: 'WS 2026' } })).json();
    expect(r.faecher).toEqual([{ fach: 'mathe iii', ects: 6, note: 1, semester: 'WS 2026' }]);
    expect(r.vorschlaege).toEqual(['Statistik']);
    expect((await d.app.inject({ method: 'PUT', url: '/api/uni/noten', headers: h, payload: { fach: 'X', ects: 6, note: 7 } })).statusCode).toBe(400);
    r = (await d.app.inject({ method: 'PUT', url: '/api/uni/noten/ziel', headers: h, payload: { ects: 180 } })).json();
    expect(r).toMatchObject({ zielEcts: 180, ectsBestanden: 6, schnitt: 1 });
    expect((await d.vault.lesen(NOTEN_PFAD)).inhalt).toMatch(/faecher:\n  - fach: mathe iii\n    ects: 6\n    note: 1\n    semester: WS 2026\nziel_ects: 180/);
    r = (await d.app.inject({ method: 'PUT', url: '/api/uni/noten/ziel', headers: h, payload: { ects: null } })).json();
    expect(r.zielEcts).toBeNull();
    expect((await d.vault.lesen(NOTEN_PFAD)).inhalt).not.toContain('ziel_ects');
    r = (await d.app.inject({ method: 'DELETE', url: '/api/uni/noten?fach=Mathe%20III', headers: h })).json();
    expect(r.faecher).toEqual([]);
    expect((await d.app.inject({ method: 'DELETE', url: '/api/uni/noten?fach=Gibtsnicht', headers: h })).statusCode).toBe(404);
  });
});
