import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { KryptoMusterModellInfo, KryptoMusterStatus } from '@dorf/shared';
import { aktionLaden } from '../src/agenten/aktionen.js';
import { WERKZEUG_DEFINITIONEN } from '../src/agenten/werkzeuge.js';
import { HAFEN_AGENT_MAX_BOTS, HAFEN_AGENT_MAX_PROMPT, HAFEN_AGENT_MAX_RL, HAFEN_FLOTTE_MAX, musterText } from '../src/agenten/werkzeuge-hafen.js';
import { testDorf } from './hilfen.js';

/**
 * E237: Kursvorhersage (verlauf5s … verlauf5m) mit asymmetrischem Fehler + Alarm – hafen_muster zeigt Fehler vs. Konstante,
 * Richtung und Alarm-Treffer; Beschreibungen kennen regeln.alarm; Vorlagen erklären es; alte Fassungen werden ersetzt.
 * Dazu Leifs Wunsch: 10 eigene Regel-/Prompt-Bots, RL-Bot mit eigenem Platz, Flotte 20.
 */
const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../../..');

function info(schluessel: KryptoMusterModellInfo['schluessel'], aktiv: boolean, t: Partial<KryptoMusterModellInfo['test']>, gruende: string[] = []): KryptoMusterModellInfo {
  return {
    schluessel,
    version: 6,
    trainiert: '2026-11-25T10:00:00.000Z',
    aktiv,
    gruende,
    beispiele: 60_000,
    test: { beispiele: 12_000, tokens: 400, auc: null, aucUntergrenze: null, praezision: null, basis: null, fehler: null, fehlerBasis: null, ...t },
    merkmale: [],
  };
}

function status(modelle: KryptoMusterModellInfo[]): KryptoMusterStatus {
  return {
    ziel: { zielProzent: 20, stopProzent: 15, horizontMin: 5 },
    modell: null,
    rl: null,
    training: { laeuft: true, fortschritt: 37, letzter: null, naechster: null, fehler: null, dauerMs: null },
    daten: { ticks: 1_000_000, tokens: 3_000, von: null, bis: null },
    bericht: '',
    modelle,
  } as unknown as KryptoMusterStatus;
}

describe('hafen_muster mit Kursvorhersage (E237)', () => {
  it('je Horizont: Fehler ±x vs. Konstante ±y, Richtung NN %, Alarm 🚀 t/n, 💥 t/n – nach den übrigen Modellen, in fester Reihenfolge', () => {
    const t = musterText(
      status([
        info('verlauf5m', true, { fehler: 21.34, fehlerBasis: 25, richtung: 0.664, alarmAnstieg: { n: 25, treffer: 11 }, alarmFall: { n: 52, treffer: 37 } }),
        info('verlauf1m', false, { fehler: 9.8, fehlerBasis: 10.1, richtung: 0.5, alarmAnstieg: null, alarmFall: { n: 3, treffer: 1 } }, ['Fehler nicht ≥ 5 % besser als die Konstante']),
        info('hoch5', true, { fehler: 18.44, fehlerBasis: 23.9 }),
        info('verlauf5s', true, { fehler: 2.06, fehlerBasis: 2.6 }),
      ]),
    );
    const zeilen = t.split('\n');
    const i = (s: string) => zeilen.findIndex((z) => z.includes(s));
    expect(t).toContain('verpasster Absturz zählt 3× – bewusst vorsichtig');
    expect(zeilen[i('Kurs in 5 min')]).toMatch(/^- 📈 Kurs in 5 min \(%\) v6: AKTIV · Fehler ±21,3 %-Punkte vs\. Konstante ±25, Richtung 66 %, Alarm 🚀 11\/25, 💥 37\/52 · Test 12000 Beispiele\/400 Tokens$/);
    expect(zeilen[i('Kurs in 1 min')]).toMatch(/nicht aktiv \(Fehler nicht ≥ 5 % besser als die Konstante\) · Fehler ±9,8 %-Punkte vs\. Konstante ±10,1, Richtung 50 %, Alarm 🚀 –, 💥 1\/3/);
    // ohne Richtung/Alarm-Felder (älteres Kryptowerk): nur Fehler vs. Konstante
    expect(zeilen[i('Kurs in 5 s')]).toMatch(/AKTIV · Fehler ±2,1 %-Punkte vs\. Konstante ±2,6 · Test/);
    // Wert-Modelle von früher unverändert gegen den Median
    expect(zeilen[i('Hoch in 5 min')]).toContain('Fehler ±18,4 %-Punkte vs. Median ±23,9');
    expect(i('Hoch in 5 min')).toBeLessThan(i('Kurs in 5 s'));
    expect(i('Kurs in 5 s')).toBeLessThan(i('Kurs in 1 min'));
    expect(i('Kurs in 1 min')).toBeLessThan(i('Kurs in 5 min'));
    // Fortschritt kommt seit E237 in Prozent (0–100)
    expect(t).toContain('Training: läuft (37 %)');
  });

  it('Beschreibungen: regeln.alarm (Standard 15/10) – Wirkung bei musterGewicht > 0 und RL-Bots; hafen_muster kennt die Kursvorhersage', () => {
    for (const n of ['hafen_bot_anlegen', 'hafen_bot_aendern'] as const) {
      const d = WERKZEUG_DEFINITIONEN[n] as unknown as { input_schema: { properties: { einstellung: { description: string } } } };
      const b = d.input_schema.properties.einstellung.description;
      expect(b).toMatch(/alarm: \{anstiegProzent, fallProzent\} \(E237, Standard 15\/10/);
      expect(b).toMatch(/wirkt bei RL-Bots immer, bei Regel-\/Prompt-Bots nur mit musterGewicht > 0/);
      expect(b).toMatch(/🚀 kauft auch unter minPunkte bzw\. ohne LLM-Zustimmung – Rug-\/Dev-\/Bundle-Sperren, Filter und Risk-Gate gelten weiter/);
      expect(b).toMatch(/💥 verkauft eine gehaltene Position sofort, auch live/);
    }
    expect((WERKZEUG_DEFINITIONEN.hafen_muster as { description: string }).description).toMatch(/Kursvorhersage.*verpasster Absturz zählt 3×.*Alarm/);
    const anlegen = (WERKZEUG_DEFINITIONEN.hafen_bot_anlegen as { description: string }).description;
    expect(anlegen).toContain('höchstens 10 eigene Regel-/Prompt-Bots, davon höchstens 2 Prompt-Bots');
    expect(anlegen).toMatch(/1 RL-Bot .*zählt nicht zu den 10\)\. Die ganze Flotte hat höchstens 20 Bots/);
    expect([HAFEN_AGENT_MAX_BOTS, HAFEN_AGENT_MAX_PROMPT, HAFEN_AGENT_MAX_RL, HAFEN_FLOTTE_MAX]).toEqual([10, 2, 1, 20]);
  });
});

describe('Vorlagen (E237)', () => {
  it('Muster-Meister parst und erklärt Kursvorhersage und Alarm; gebaeude.md und Hafenmeister kennen die neuen Grenzen', async () => {
    const d = await testDorf();
    const a = await aktionLaden(d.vault, 'Hafen/muster-meister');
    expect(a?.fehler).toBeUndefined();
    expect(a).toMatchObject({ name: 'Muster-Meister', motor: 'claude-code', ablage: 'Hafen/00_Musterbericht.md' });
    const text = (await d.vault.lesen('Hafen/aktionen/muster-meister.md')).inhalt;
    for (const s of ['Kursvorhersage', 'verpasster Absturz zählt 3×', 'Alarm-Trefferquote', 'regeln.alarm', 'anstiegProzent', 'fallProzent', '🚀 2/25']) expect(text).toContain(s);
    expect(text).toMatch(/`regeln.alarm` \*\*nur beim eigenen RL-Bot\*\*/);
    expect(text).toMatch(/musterGewicht.*nie/);
    const geb = (await d.vault.lesen('Hafen/gebaeude.md')).inhalt;
    expect(geb).toContain('Kursvorhersage');
    expect(geb).toContain('regeln.alarm');
    expect(geb).toContain('10 eigene Regel-/Prompt-Bots');
    const hm = await aktionLaden(d.vault, 'Hafen/hafenmeister');
    expect(hm?.fehler).toBeUndefined();
    const hmText = (await d.vault.lesen('Hafen/aktionen/hafenmeister.md')).inhalt;
    expect(hmText).toContain('Höchstens 10 eigene Regel-/Prompt-Bots');
    expect(hmText).not.toMatch(/6 eigene/);
  });

  it('die E236-Fassungen stehen in VORLAGE_FRUEHERE_FASSUNGEN, die jetzigen nicht', () => {
    const dorf = fs.readFileSync(path.join(wurzel, 'apps/server/src/dorf.ts'), 'utf8');
    const block = (datei: string) => {
      const start = dorf.indexOf(`'${datei}': [`);
      expect(start).toBeGreaterThan(0);
      return dorf.slice(start, dorf.indexOf(']', start));
    };
    const hash = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(path.join(wurzel, 'vault-vorlage', p))).digest('hex');
    expect(block('Hafen/aktionen/muster-meister.md')).toContain('72e809280b0067ecea0530111313727ed8e768a835e6836e1562fefd4da21929'); // E236
    expect(block('Hafen/gebaeude.md')).toContain('f0efb548fedca203cc9391bf49e6d22692597bfc761e2bc75602749266a45393'); // E236
    expect(block('Hafen/aktionen/hafenmeister.md')).toContain('47918450a391ebc15934415de003e83f4aae0f15c7502a80c30b17f4682576a2'); // E235 (6 Bots)
    for (const p of ['Hafen/aktionen/muster-meister.md', 'Hafen/gebaeude.md', 'Hafen/aktionen/hafenmeister.md']) expect(block(p)).not.toContain(hash(p));
  });
});
