import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { KryptoMusterModellInfo, KryptoMusterStatus } from '@dorf/shared';
import { aktionLaden } from '../src/agenten/aktionen.js';
import { zeitplanLesen } from '../src/agenten/zeitplan.js';
import { WERKZEUG_DEFINITIONEN } from '../src/agenten/werkzeuge.js';
import { musterText } from '../src/agenten/werkzeuge-hafen.js';
import { testDorf } from './hilfen.js';

/**
 * E236: Muster-Modell sieht mehr – hafen_muster zeigt jedes Modell (aktiv/nicht aktiv mit Gründen, AUC bzw. Fehler vs. Median),
 * Beschreibungen kennen rl.maxAbsturz, Vorlage Muster-Meister kennt die neuen Signale, alte Fassungen werden ersetzt.
 */
const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../../..');

function info(schluessel: KryptoMusterModellInfo['schluessel'], aktiv: boolean, t: Partial<KryptoMusterModellInfo['test']>, gruende: string[] = []): KryptoMusterModellInfo {
  return {
    schluessel,
    version: 5,
    trainiert: '2026-11-24T10:00:00.000Z',
    aktiv,
    gruende,
    beispiele: 40_000,
    test: { beispiele: 9_000, tokens: 321, auc: null, aucUntergrenze: null, praezision: null, basis: null, fehler: null, fehlerBasis: null, ...t },
    merkmale: [],
  };
}

function status(o: Partial<KryptoMusterStatus> = {}): KryptoMusterStatus {
  return {
    ziel: { zielProzent: 20, stopProzent: 15, horizontMin: 5 },
    modell: {
      version: 5,
      trainiert: '2026-11-24T10:00:00.000Z',
      beispiele: 40_000,
      positivAnteil: 0.18,
      test: { beispiele: 9_000, auc: 0.601, praezision: 0.3, basis: 0.17 },
      aktiv: true,
      merkmale: [{ name: 'kaufVerhaeltnis60s', wichtigkeit: 0.2 }],
    },
    rl: { version: 4, trainiert: '2026-11-24T10:01:00.000Z', episoden: 5000, zeitraffer: { trades: 40, gewinnSol: 0.5, trefferquote: 0.45, pleiten: 0 } },
    training: { laeuft: false, fortschritt: 0, letzter: '2026-11-24T10:01:00.000Z', naechster: '2026-11-24T15:01:00.000Z', fehler: null, dauerMs: 90_000 },
    daten: { ticks: 900_000, tokens: 2_000, von: '2026-11-21T08:00:00.000Z', bis: '2026-11-24T10:00:00.000Z' },
    bericht: '## Muster-Modelle v5\n- basis aktiv',
    ...o,
  };
}

describe('hafen_muster mit allen Modellen (E236)', () => {
  it('je Modell eine Zeile: AKTIV bzw. nicht aktiv mit Gründen, AUC vs. 0,5 mit Untergrenze, MAE vs. Median, Test-Tokens – in fester Reihenfolge', () => {
    const t = musterText(
      status({
        modelle: [
          // absichtlich durcheinander – Anzeige folgt KRYPTO_MUSTER_MODELLE
          info('hoch5', true, { fehler: 18.44, fehlerBasis: 23.9 }),
          info('pump', false, { auc: 0.58, aucUntergrenze: 0.49, basis: 0.01 }, ['zu wenige Pumps im Test (12 < 30)', 'Untergrenze ≤ 0,5']),
          info('basis', true, { auc: 0.601, aucUntergrenze: 0.57, praezision: 0.3, basis: 0.17 }),
          info('absturz', true, { auc: 0.664, aucUntergrenze: 0.62, praezision: 0.44, basis: 0.21 }),
          info('tief5', false, { fehler: 14.9, fehlerBasis: 15.1 }, ['Fehler nicht ≥ 5 % besser als der Median']),
          info('fruehAbsturz', false, { beispiele: 120, tokens: 8 }, ['zu wenige Testbeispiele (120 < 200)']),
        ],
      }),
    );
    const zeilen = t.split('\n');
    const i = (s: string) => zeilen.findIndex((z) => z.includes(s));
    expect(t).toContain('Modelle (je eigens getestet, nur aktive geben Rat):');
    expect(zeilen[i('Grundsignal')]).toMatch(/^- Grundsignal \(\+20 % vor −15 %, 5 min\) v5: AKTIV · AUC 0,601 vs\. 0,5 \(Raten\), Untergrenze 0,570 · Präzision 30 % vs\. Basisrate 17 % · Test 9000 Beispiele\/321 Tokens$/);
    expect(zeilen[i('🚀 Pump (')]).toContain('nicht aktiv (zu wenige Pumps im Test (12 < 30); Untergrenze ≤ 0,5)');
    expect(zeilen[i('🚀 Pump (')]).toContain('AUC 0,580 vs. 0,5 (Raten), Untergrenze 0,490 · Basisrate 1 %');
    expect(zeilen[i('💥 Absturz (')]).toMatch(/AKTIV · AUC 0,664/);
    expect(zeilen[i('Hoch in 5 min')]).toMatch(/AKTIV · Fehler ±18,4 %-Punkte vs\. Median ±23,9 · Test 9000 Beispiele\/321 Tokens/);
    expect(zeilen[i('Tief in 5 min')]).toMatch(/nicht aktiv \(Fehler nicht ≥ 5 % besser als der Median\) · Fehler ±14,9 %-Punkte vs\. Median ±15,1/);
    expect(zeilen[i('Früh-Modell')]).toMatch(/💥 Absturz – Früh-Modell .* nicht aktiv \(zu wenige Testbeispiele \(120 < 200\)\) · Test 120 Beispiele\/8 Tokens$/);
    // Reihenfolge wie KRYPTO_MUSTER_MODELLE, danach RL-Zeitraffer und Bericht
    expect(i('Grundsignal (')).toBeLessThan(i('🚀 Pump ('));
    expect(i('🚀 Pump (')).toBeLessThan(i('💥 Absturz ('));
    expect(i('💥 Absturz (')).toBeLessThan(i('Hoch in 5 min'));
    expect(i('Tief in 5 min')).toBeLessThan(i('Früh-Modell'));
    expect(i('Früh-Modell')).toBeLessThan(i('RL-Agent v4'));
    expect(i('RL-Agent v4')).toBeLessThan(i('Bericht:'));
    expect(t).toContain('## Muster-Modelle v5');
  });

  it('ohne `modelle` (altes Kryptowerk) genau wie bisher', () => {
    const alt = musterText(status());
    expect(alt).not.toContain('Modelle (je eigens');
    expect(alt).toContain('Modell v5 (2026-11-24 10:00 UTC): AKTIV – gibt Rat');
    expect(alt).toMatch(/Wichtigste Merkmale: kaufVerhaeltnis60s 20 %\nRL-Agent v4/);
    expect(musterText(status({ modelle: [] }))).toBe(alt);
  });

  it('Beschreibungen: rl.maxAbsturz und Absturz-Verkauf bei musterGewicht > 0', () => {
    for (const n of ['hafen_bot_anlegen', 'hafen_bot_aendern'] as const) {
      const d = WERKZEUG_DEFINITIONEN[n] as unknown as { input_schema: { properties: { einstellung: { description: string } } } };
      const b = d.input_schema.properties.einstellung.description;
      expect(b).toMatch(/maxAbsturz 0–1 \(kein Kauf, wenn der Absturz-Erkenner mindestens so viel sieht; Standard 0,35/);
      expect(b).toMatch(/musterGewicht 0–30 .*> 0 heißt auch: sieht der aktive Absturz-Erkenner ≥ 70 %, verkauft auch ein Regel-\/Prompt-Bot/);
    }
    expect((WERKZEUG_DEFINITIONEN.hafen_muster as { description: string }).description).toMatch(/Pump- und 💥 Absturz-Erkenner.*Früh-Modelle/);
  });
});

describe('Vorlagen (E236)', () => {
  it('Muster-Meister parst samt Zeitplan und kennt die neuen Signale', async () => {
    const d = await testDorf();
    const a = await aktionLaden(d.vault, 'Hafen/muster-meister');
    expect(a?.fehler).toBeUndefined();
    expect(a).toMatchObject({ name: 'Muster-Meister', motor: 'claude-code', zeitplan: 'täglich 00:35, 05:35, 10:35, 15:35, 20:35', ablage: 'Hafen/00_Musterbericht.md' });
    expect(zeitplanLesen(a!.zeitplan!).zeiten).toHaveLength(5);
    const text = (await d.vault.lesen('Hafen/aktionen/muster-meister.md')).inhalt;
    for (const s of ['Pump-Erkenner', 'Absturz-Erkenner', 'Ausblick', 'Früh-Modelle', 'rl.maxAbsturz', '±0,05', 'zu wenige Pumps im Test', 'welche Modelle aktiv']) expect(text).toContain(s);
    expect(text).toMatch(/musterGewicht.*nie/);
    expect(text).toMatch(/Grundsignal ODER der Absturz-Erkenner seit mindestens 5 Tagen aktiv/);
    expect((await d.vault.lesen('Hafen/gebaeude.md')).inhalt).toContain('rl.maxAbsturz');
  });

  it('frühere Fassungen von muster-meister.md und Hafen/gebaeude.md stehen in VORLAGE_FRUEHERE_FASSUNGEN, die jetzige nicht', () => {
    const dorf = fs.readFileSync(path.join(wurzel, 'apps/server/src/dorf.ts'), 'utf8');
    const block = (datei: string) => {
      const start = dorf.indexOf(`'${datei}': [`);
      expect(start).toBeGreaterThan(0);
      return dorf.slice(start, dorf.indexOf(']', start));
    };
    const hash = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(path.join(wurzel, 'vault-vorlage', p))).digest('hex');
    expect(block('Hafen/aktionen/muster-meister.md')).toContain('5bc10bdc2be0f0f5467b8f6e86efe51ab5edf5235826e50c120527b440797d0f'); // E235
    expect(block('Hafen/gebaeude.md')).toContain('34a24bdd934bdbb46a5751ce8fc52a0fff5a5b2cb1c0b579f2dd3e46126ce8a7'); // E235
    expect(block('Hafen/aktionen/muster-meister.md')).not.toContain(hash('Hafen/aktionen/muster-meister.md'));
    expect(block('Hafen/gebaeude.md')).not.toContain(hash('Hafen/gebaeude.md'));
  });
});
