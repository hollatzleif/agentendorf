import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTEN_WERKZEUGE, werkzeugprofil } from '../src/agenten/leine.js';
import { noteAusText } from '../src/uni/noten.js';
import { testDorf } from './hilfen.js';

/**
 * E221: Agenten pflegen Leifs Notenliste (Uni/noten.md, Ansicht Uni → Noten) über noten_* – vorher kam der
 * Bürgermeister nicht an die Datei (vault_schreiben: nur neue Dateien mit Datum im eigenen Gebäude).
 */
const w = (n: string, e: unknown) => `<<werkzeug ${n} ${JSON.stringify(e)}>>`;

describe('Notenliste für Agenten (E221)', () => {
  it('Bezeichnungen → Zahl', () => {
    expect(noteAusText('sehr gut')).toBe(1);
    expect(noteAusText('Gut')).toBe(2);
    expect(noteAusText('befriedigend')).toBe(3);
    expect(noteAusText('genügend')).toBe(4);
    expect(noteAusText('nicht genügend')).toBe(5);
    expect(noteAusText('Nicht Genügend')).toBe(5);
    expect(noteAusText('mit Erfolg teilgenommen')).toBe('bestanden');
    expect(noteAusText('2 (gut)')).toBe(2);
    expect(noteAusText(3)).toBe(3);
    expect(noteAusText(null)).toBe(null);
    expect(noteAusText('')).toBe(null);
    expect(noteAusText(6)).toBeUndefined();
    expect(noteAusText(1.5)).toBeUndefined();
    expect(noteAusText('super')).toBeUndefined();
  });

  it('jeder Agent hat noten_*, auch ohne vault_schreiben', () => {
    const p = werkzeugprofil({ werkzeuge: [], fremdinhalte: false });
    for (const n of NOTEN_WERKZEUGE) expect(p.dorf).toContain(n);
  });

  it('eintragen (Bezeichnungen, mehrere auf einmal), lesen, ändern, Unbekanntes verweigern, entfernen, zurücknehmen', async () => {
    const d = await testDorf();
    // Leif hat in der App schon ein Fach angelegt – bleibt erhalten, eigene Felder auch
    await d.noten.setzen({ fach: 'Num opt', ects: 3, note: 1 });
    fs.writeFileSync(
      path.join(d.vault.wurzel, 'Bibliothek/aktionen/noten.md'),
      `---\nname: noten\nwerkzeuge: [vault_lesen]\n---\n${[
        w('noten_eintragen', {
          faecher: [
            { fach: 'Hands-on AI I UE', ects: 1.5, note: 'sehr gut', semester: 'WS 2025' },
            { fach: 'Mathematik für AI I', ects: 6, note: 'befriedigend' },
            { fach: 'Programming in Python I UE', ects: 3, note: 'nicht genügend' },
            { fach: 'Englisch', ects: 2, note: 'mit Erfolg teilgenommen', semester: 'anerkannt' },
            { fach: 'Visualization UE', ects: 1.5, note: null },
          ],
          ziel_ects: 180,
        }),
        w('noten_eintragen', { faecher: [{ fach: 'Hands-on AI I UE', ects: 1.5, note: 'super' }] }),
        w('noten_lesen', {}),
        w('noten_eintragen', { faecher: [{ fach: 'mathematik für ai i', ects: 6, note: 'gut' }] }),
        w('noten_entfernen', { fach: 'Visualization UE' }),
        w('noten_entfernen', { fach: 'Gibts nicht' }),
      ].join('\n')}\n`,
    );
    const r = await d.agenten.aktionStarten('Bibliothek/noten', {});
    await d.agenten.leerlauf();
    const t = d.agenten.chatDetail(r.chatId).nachrichten.filter((n) => n.rolle === 'werkzeug').map((n) => n.text);
    expect(t[0]).toMatch(/^noten_eintragen: 5 Fächer in der Notenliste eingetragen\. Leif sieht es unter Uni → Noten/);
    expect(t[1]).toMatch(/^noten_eintragen: \(verweigert\) Nichts eingetragen – diese Noten verstehe ich nicht: Hands-on AI I UE: „super“/);
    expect(t[2]).toContain('- Hands-on AI I UE · 1.5 ECTS · Note 1 · WS 2025');
    expect(t[2]).toContain('- Englisch · 2 ECTS · bestanden (ohne Note) · anerkannt');
    expect(t[2]).toContain('- Visualization UE · 1.5 ECTS · offen');
    expect(t[2]).toContain('- Num opt · 3 ECTS · Note 1');
    expect(t[3]).toMatch(/^noten_eintragen: Note eingetragen: mathematik für ai i/);
    expect(t[4]).toMatch(/^noten_entfernen: Aus der Notenliste gestrichen: Visualization UE/);
    expect(t[5]).toMatch(/^noten_entfernen: \(verweigert\).*steht nicht in der Notenliste/);

    const s = await d.noten.stand();
    expect(s.faecher.map((f) => [f.fach, f.ects, f.note])).toEqual([
      ['Num opt', 3, 1],
      ['Hands-on AI I UE', 1.5, 1],
      ['mathematik für ai i', 6, 2],
      ['Programming in Python I UE', 3, 5],
      ['Englisch', 2, 'bestanden'],
    ]);
    // Schnitt nur über benotete, bestandene: (3·1 + 1,5·1 + 6·2) / 10,5
    expect(s.schnitt).toBe(Math.round((16.5 / 10.5) * 100) / 100);
    expect(s.ectsBestanden).toBe(12.5);
    expect(s.zielEcts).toBe(180);

    // jede Änderung mit Rückweg (leise, nur in der App-Liste); die letzte zurücknehmen → Visualization wieder da
    const liste = d.agenten.rueckgaengig.liste();
    expect(liste.map((x) => x.titel)).toEqual(
      expect.arrayContaining(['5 Fächer in der Notenliste eingetragen', 'Note eingetragen: mathematik für ai i', 'Aus der Notenliste gestrichen: Visualization UE']),
    );
    const letzte = liste.find((x) => x.titel.startsWith('Aus der Notenliste'))!;
    expect((await d.agenten.rueckgaengig.zuruecknehmen(letzte.id)).status).toBe('zurueckgenommen');
    expect((await d.noten.stand()).faecher.some((f) => f.fach === 'Visualization UE')).toBe(true);
    // die erste Änderung lässt sich jetzt nicht mehr blind zurücknehmen (Datei seither geändert)
    const erste = d.agenten.rueckgaengig.liste().find((x) => x.titel.startsWith('5 Fächer'))!;
    expect((await d.agenten.rueckgaengig.zuruecknehmen(erste.id)).status).toBe('fehlgeschlagen');
  });

  it('leere Liste: Rückgängig nach dem ersten Eintrag leert sie wieder', async () => {
    const d = await testDorf();
    fs.writeFileSync(path.join(d.vault.wurzel, 'Bibliothek/aktionen/noten.md'), `---\nname: noten\nwerkzeuge: [vault_lesen]\n---\n${w('noten_eintragen', { faecher: [{ fach: 'Statistik', ects: 4, note: 'gut' }] })}\n`);
    await d.agenten.aktionStarten('Bibliothek/noten', {});
    await d.agenten.leerlauf();
    expect((await d.noten.stand()).faecher).toHaveLength(1);
    const r = d.agenten.rueckgaengig.liste()[0]!;
    expect((await d.agenten.rueckgaengig.zuruecknehmen(r.id)).status).toBe('zurueckgenommen');
    expect((await d.noten.stand()).faecher).toEqual([]);
  });
});
