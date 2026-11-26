import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KRYPTO_RL_STANDARD, KRYPTO_STANDARD, kryptoBotVon, type KryptoBot, type KryptoKonsoleZeile, type KryptoTerminal, type KryptoUebersicht, type KryptoMusterKonsole, type KryptoMusterModellInfo, type KryptoMusterSchluessel } from '@dorf/shared';
import { TestUhr } from '../src/uhr.js';
import { Kryptowerk, kryptoDb } from '../src/krypto/motor.js';
import { kryptoServer } from '../src/krypto/server.js';
import { KONSOLE_MAX, MusterDienst, type Trainer } from '../src/krypto/muster/dienst.js';
import { MERKMAL_NAMEN } from '../src/krypto/muster/merkmale.js';
import { rlZeitraffer, zufallAus, type RlEpisode, type RlTradeBeispiel } from '../src/krypto/muster/rl.js';
import { musterTrainieren, type TrainingsDaten, type TrainingsErgebnis } from '../src/krypto/muster/training.js';
import type { GbdtModell, RlModell, Tick, TokenMeta } from '../src/krypto/muster/typen.js';
import type { DexScreener, RugCheck } from '../src/krypto/quellen.js';
import { WERKZEUG_DEFINITIONEN } from '../src/agenten/werkzeuge.js';
import { HAFEN_KONSOLE_ZEILEN, konsoleText } from '../src/agenten/werkzeuge-hafen.js';
import { aktionLaden } from '../src/agenten/aktionen.js';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';

/**
 * E238: Trainings-Konsole des Muster-Modells – musterTrainieren erklärt mit `log`, was es tut und WARUM (Daten, Trennzeit,
 * je Modell Test + Entscheidung, RL mit Beispiel-Trades und Q-Werten, Laufzeit); ohne log alles wie vorher. Der Dienst
 * sammelt die Zeilen (live abrufbar mit ab=, höchstens KONSOLE_MAX, Fehlerzeile), speichert sie in muster_modelle.konsole_json;
 * Kryptowerk-API /muster/konsole, Dorf-Durchreiche, hafen_muster {konsole: true}, Vorlage Muster-Meister.
 */
const T0 = Date.UTC(2026, 10, 24, 12, 0, 0);
const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../../..');

/** wie in e235-muster-kern: Zufallsweg, bei `muster` Pump-Schwälle mit echtem Nachlauf */
function markt(tokens: number, z: () => number, muster: boolean, minuten = 25, abstand = 45_000): TrainingsDaten {
  const ticks = new Map<string, Tick[]>();
  const meta = new Map<string, TokenMeta>();
  for (let k = 0; k < tokens; k++) {
    const mint = `T${k}pump`;
    const start = T0 + k * abstand;
    meta.set(mint, { mint, erstellt: start - 10_000, devTokens24h: Math.floor(z() * 3) });
    const liste: Tick[] = [];
    let preis = 1e-7;
    let echt = 3;
    let pumpBis = 0;
    let nachlauf = 0;
    for (let t = start; t < start + minuten * 60_000; t += 1000) {
      if (muster && pumpBis < t && nachlauf <= 0 && z() < 0.002) pumpBis = t + 20_000;
      let sol: number;
      let r: number;
      if (t < pumpBis) {
        sol = 1 + z() * 2;
        r = 0.004 + z() * 0.004;
        if (pumpBis - t <= 1000) nachlauf = 90;
      } else if (nachlauf > 0) {
        nachlauf--;
        sol = (z() - 0.3) * 1.2;
        r = 0.0045 + (z() - 0.5) * 0.01;
      } else {
        sol = (z() - 0.5) * 1.2;
        r = (z() - 0.5) * 0.016;
      }
      preis *= 1 + r;
      echt = Math.max(0.1, echt + sol);
      liste.push({ zeit: t, preis, sol, echtSol: echt });
    }
    ticks.set(mint, liste);
  }
  return { ticks, meta };
}

const ZIEL = { zielProzent: 10, stopProzent: 10, horizontMs: 60_000 };
const JETZT = T0 + 60 * 45_000 + 30 * 60_000;
const text = (zeilen: KryptoKonsoleZeile[]) => zeilen.map((z) => `${z.stufe} [${z.bereich}] ${z.text}`).join('\n');

describe('musterTrainieren mit Konsole (E238)', () => {
  it('erklärt Daten, Trennzeit, je Modell Test und Entscheidung, RL mit Q-Werten, Laufzeit – Ergebnis gleich wie ohne log', async () => {
    const d = markt(60, zufallAus(21), true);
    const zeilen: KryptoKonsoleZeile[] = [];
    const mit = await musterTrainieren(d, { jetzt: JETZT, version: 3, ziel: ZIEL, abgeben: async () => {}, log: (z) => zeilen.push(z) });
    const ohne = await musterTrainieren(d, { jetzt: JETZT, version: 3, ziel: ZIEL, abgeben: async () => {} });
    // ohne log alles wie vorher
    expect(mit.bericht).toBe(ohne.bericht);
    expect(JSON.stringify(mit.modelle)).toBe(JSON.stringify(ohne.modelle));
    expect(JSON.stringify(mit.rl)).toBe(JSON.stringify(ohne.rl));
    expect(mit.rlInfo).toEqual(ohne.rlInfo);

    const t = text(zeilen);
    // Zeit: ms seit Trainingsstart, nie rückwärts
    for (let i = 1; i < zeilen.length; i++) expect(zeilen[i]!.t).toBeGreaterThanOrEqual(zeilen[i - 1]!.t);
    expect(zeilen[0]!.t).toBeGreaterThanOrEqual(0);
    // Daten
    expect(t).toMatch(/info \[Daten\] Lese 60 Tokens mit aufgezeichneten Ticks/);
    expect(t).toMatch(/\[Daten\] 90\.000 Ticks gelesen, 2026-11-24 12:00:00 UTC bis .* \(1,2 h\)/);
    expect(t).toMatch(/\[Daten\] Zeitpunkte alle 5 s .* nicht ausgedünnt/);
    expect(t).toMatch(/\[Daten\] \d[\d.]* Beispiele mit mindestens einem Label/);
    expect(t).toMatch(/\[Daten\] Labels je Spalte: basis \d[\d.]* · pump/);
    // Trennung
    expect(t).toMatch(/\[Trennung\] Lernen bis 2026-11-24 \d\d:\d\d:\d\d UTC, Test ab/);
    expect(t).toMatch(/\[Trennung\] Lücke je Horizont: .*Grundsignal 1 min, Pump\/Absturz 2 min/);
    expect(t).toMatch(/\[Trennung\] Grundsignal: [\d.]+ Lernbeispiele, [\d.]+ Testbeispiele aus \d+ Tokens/);
    // je Modell: Aufbau, Basisrate/Median/Expektil, Test, Merkmale, Entscheidung
    expect(t).toMatch(/\[basis\] 80 Bäume, Tiefe ≤ 3, Lernrate 0,10, Verlust logistisch/);
    expect(t).toMatch(/\[basis\] Basisrate in den Lerndaten: \d+,\d % positiv/);
    expect(t).toMatch(/gut \[basis\] Test: Test-AUC 0,\d\d .*AUC-Untergrenze \(Token-Bootstrap 5 %\) 0,\d\d/);
    expect(t).toMatch(/\[basis\] wichtigste Merkmale: \w+ \d+,\d %, \w+ \d+,\d %, \w+ \d+,\d %/);
    expect(t).toMatch(/entscheidung \[basis\] AKTIV, weil Test-AUC 0,\d\d ≥ 0,55, Untergrenze 0,\d\d > 0,50; [\d.]+ Testbeispiele\/\d+ Tokens/);
    expect(t).toMatch(/\[hoch1\] Vergleich: Median der Lerndaten/);
    expect(t).toMatch(/\[verlauf1m\] 40 Bäume.*asymmetrisch \(verpasster Fall zählt 3×\)/);
    expect(t).toMatch(/\[verlauf1m\] Vergleich: beste Konstante unter demselben Verlust \(Expektil der Lerndaten\)/);
    expect(t).toMatch(/entscheidung \[absturz\] nicht aktiv, weil Test-AUC 0,50 < 0,55/);
    expect(t).toMatch(/entscheidung \[fruehPump\] nicht aktiv, weil nur 0 Testbeispiele/);
    // jedes trainierte Modell hat genau eine Entscheidung
    for (const k of Object.keys(mit.modelle)) expect(zeilen.filter((z) => z.bereich === k && z.stufe === 'entscheidung')).toHaveLength(1);
    // RL: Signale (und was fehlt), Parameter, Durchläufe, Q-Tabelle, Zeitraffer, Beispiel-Trades mit Q-Werten
    expect(t).toMatch(/\[RL\] Signale im Zustand: basis, pump/);
    expect(t).toMatch(/warnung \[RL\] fehlen \(nicht aktiv.*\): absturz/);
    expect(t).toMatch(/\[RL\] \d+ Lern-Episoden .* 10 Durchläufe, Lernrate α 0,10, γ 0,99, Erkunden 0,30 → 0,05/);
    expect(zeilen.filter((z) => /^Durchlauf \d+\/10: erkunden 0,\d\d · [\d.]+ Trades · [+−][\d,]+ SOL/.test(z.text))).toHaveLength(10);
    expect(t).toMatch(/\[RL\] Q-Tabelle: \d+ Zustände \(\d+ ohne, \d+ mit Position\)/);
    expect(t).toMatch(/\[RL\] Zeitraffer auf allen Testdaten .*: \d+ Trades · [+−][\d,]+ SOL nach Gebühren/);
    expect(t).toMatch(/\[RL\] Beispiel-Trades aus dem Zeitraffer \(15 von \d+\)/);
    const kaeufe = zeilen.filter((z) => z.bereich === 'RL' && / KAUFEN · /.test(z.text));
    expect(kaeufe).toHaveLength(15);
    expect(kaeufe[0]!.text).toMatch(/^\d\d\.11\. \d\d:\d\d:\d\d UTC T\d+pump KAUFEN · p \d,\d\d · 🚀 \S+ · 💥 \S+ · v1m \S+/);
    // E243: Einstiege nach Regel (Ertrags-Modell bzw. Signale) – keine Q-Werte
    expect(kaeufe.every((z) => /warum: Einstieg nach Regel/.test(z.text))).toBe(true);
    const ausgaenge = zeilen.filter((z) => z.bereich === 'RL' && z.text.startsWith('   → '));
    expect(ausgaenge).toHaveLength(15);
    expect(ausgaenge.some((z) => /RAUS nach \d+ s · .*Plus [+−][\d,]+ % · \d+ s gehalten · warum: raus -?\d,\d{3}/.test(z.text))).toBe(true);
    for (const z of ausgaenge) expect(z.text).toMatch(/Ergebnis [+−]\d,\d{4} SOL nach Gebühren$/);
    // Laufzeit
    expect(t).toMatch(/\[Laufzeit\] Abschnitte: Merkmale und Labels \d+ ms · Stufen \d+ ms · basis \d+ ms .* RL-Training \d+ ms · Einstieg \d+ ms · Zeitraffer \d+ ms/);
    expect(t).toMatch(/\[Laufzeit\] gesamt [\d.]+ ms · [\d.]+× Rechenzeit abgegeben/);

    // Entscheidungen gegen das bisherige Modell: behält (besseres altes), ersetzt (schwächeres altes), bleibt gültig (neues inaktiv)
    const altZeilen: KryptoKonsoleZeile[] = [];
    const aucBasis = mit.modelle.basis!.info.test.auc!;
    const aucPump = mit.modelle.pump!.info.test.auc!;
    await musterTrainieren(d, {
      jetzt: JETZT,
      version: 4,
      ziel: ZIEL,
      alt: { basis: { auc: aucBasis + 0.05, version: 3 }, pump: { auc: aucPump - 0.02, version: 2 }, hoch5: { fehler: 1000, version: 1 } },
      log: (z) => altZeilen.push(z),
    });
    const ent = (k: string) => altZeilen.find((z) => z.bereich === k && z.stufe === 'entscheidung')!.text;
    const f = (x: number) => x.toFixed(2).replace('.', ',');
    expect(ent('basis')).toBe(`behält v3, neues ist schlechter (AUC ${f(aucBasis + 0.05)} → ${f(aucBasis)})`);
    expect(ent('pump')).toMatch(new RegExp(`^AKTIV – ersetzt v2 \\(AUC ${f(aucPump - 0.02)} → ${f(aucPump)}\\), weil Test-AUC`));
    expect(ent('hoch5')).toMatch(/^nicht aktiv, weil .* – v1 bleibt gültig$/);
  }, 120_000);

  it('zu wenig Daten: Warnung + Entscheidung „kein Modell trainiert, weil …“ + Laufzeit', async () => {
    const zeilen: KryptoKonsoleZeile[] = [];
    const e = await musterTrainieren(markt(2, zufallAus(23), true, 8), { jetzt: T0 + 3_600_000, version: 1, log: (z) => zeilen.push(z) });
    expect(e.modell).toBeNull();
    const t = text(zeilen);
    expect(t).toMatch(/warnung \[Daten\] zu wenig Daten: \d+ Grundsignal-Lernbeispiele, braucht ≥ 500/);
    expect(t).toMatch(/entscheidung \[Dienst\] kein Modell trainiert, weil zu wenig Daten \(\d+ < 500 Lernbeispiele\)/);
    expect(t).toMatch(/\[Laufzeit\] gesamt/);
    // Tokens mit < 3 Ticks und ohne Metadaten werden genannt
    const d: TrainingsDaten = { ticks: new Map([['kurz', [{ zeit: T0, preis: 1, sol: 0, echtSol: 1 }]], ...markt(1, zufallAus(2), false, 5).ticks]), meta: new Map() };
    const z2: KryptoKonsoleZeile[] = [];
    await musterTrainieren(d, { jetzt: T0 + 3_600_000, version: 1, log: (z) => z2.push(z) });
    expect(text(z2)).toMatch(/warnung \[Daten\] 1 Tokens übersprungen – weniger als 3 Ticks/);
    expect(text(z2)).toMatch(/warnung \[Daten\] 1 Tokens ohne Metadaten/);
  });
});

describe('RL-Zeitraffer erklärt Trades (E238)', () => {
  const modell = (w: number[], h: number[]): RlModell => ({ version: 1, q: new Proxy({}, { get: (_z, k) => (String(k).startsWith('h|') ? h : w) }) as Record<string, number[]> });
  const schritt = (i: number, preis: number, o: Partial<RlEpisode[number]> = {}): RlEpisode[number] => ({ zeit: T0 + i * 5000, mint: 'ABCDEFGHIJKLMNOP', preis, p: 0.9, trend30Prozent: 0, ...o });

  it('Kauf und Verkauf mit Q-Werten (beste zuerst), Sicherung bei 💥 ≥ 0,7, Regel ohne Q-Werte, Ende der Aufzeichnung', async () => {
    const trades: RlTradeBeispiel[] = [];
    const ep: RlEpisode[] = [
      [schritt(0, 1e-7), schritt(1, 1.2e-7), schritt(2, 1.3e-7, { p: 0 })],
      [schritt(10, 1e-7), schritt(11, 0.9e-7, { absturz: 0.8 }), schritt(12, 0.8e-7, { p: 0 })],
    ];
    const m = modell([0.03, 0.12, 0, 0], [0.05, 0, 0.01, 0.2]);
    const erg = await rlZeitraffer(m, ep, KRYPTO_RL_STANDARD, undefined, (t) => trades.push(t));
    expect(erg.trades).toBe(2);
    expect(trades).toHaveLength(2);
    const [a, b] = trades;
    expect(a!.mint).toBe('ABCDEFGHIJKLMNOP');
    // E243: der Einstieg kommt aus der Regel (p 0,9 ≥ minSicherheit), nicht aus Q-Werten
    expect(a!.kauf).toMatchObject({ handlung: 'kaufen', grund: 'regel', q: null, zeit: T0, preis: 1.2e-7 });
    expect(a!.verkauf).toMatchObject({ handlung: 'raus', grund: 'q', q: [{ handlung: 'raus', wert: 0.2 }, { handlung: 'warten', wert: 0.05 }, { handlung: 'halb', wert: 0.01 }] });
    expect(a!.verkauf!.lage).toMatchObject({ haelt: true, haltSek: 0 });
    expect(a!.haltSek).toBe(5);
    expect(a!.gewinnSol).toBeCloseTo(erg.gewinnSol - b!.gewinnSol, 10);
    expect(b!.verkauf).toMatchObject({ handlung: 'raus', grund: 'sicherung', sicherung: '💥 0,80 ≥ 0,7 → nur raus', q: [{ handlung: 'raus', wert: 0.2 }] });
    // ohne Beobachter dasselbe Ergebnis
    expect(await rlZeitraffer(m, ep, KRYPTO_RL_STANDARD)).toEqual(erg);
    // Regel (Lage nie geübt) und Ende der Aufzeichnung
    const leer: RlModell = { version: 1, q: {} };
    const t2: RlTradeBeispiel[] = [];
    await rlZeitraffer(leer, [[schritt(0, 1e-7), schritt(1, 1.1e-7)]], KRYPTO_RL_STANDARD, undefined, (t) => t2.push(t));
    expect(t2).toHaveLength(1);
    expect(t2[0]!.kauf).toMatchObject({ grund: 'regel', q: null });
    expect(t2[0]!.verkauf).toBeNull();
  });
});

// ---- Dienst ---------------------------------------------------------------------------------------------------------

const fest = (p: number, version: number): GbdtModell => ({ version, merkmale: MERKMAL_NAMEN, basis: Math.log(p / (1 - p)), lernrate: 1, baeume: [] });
function info(schluessel: KryptoMusterSchluessel, version: number, aktiv: boolean): KryptoMusterModellInfo {
  return { schluessel, version, trainiert: '', aktiv, gruende: aktiv ? [] : ['zu schwach'], beispiele: 1000, test: { beispiele: 300, tokens: 20, auc: 0.6, aucUntergrenze: 0.55, praezision: null, basis: 0.3, fehler: null, fehlerBasis: null }, merkmale: [] };
}
function ergebnis(version: number, aktiv: Partial<Record<KryptoMusterSchluessel, boolean>>, rl = true): TrainingsErgebnis {
  const modelle: TrainingsErgebnis['modelle'] = {};
  for (const [k, a] of Object.entries(aktiv) as [KryptoMusterSchluessel, boolean][]) modelle[k] = { gbdt: fest(0.5, version), info: info(k, version, a) };
  const b = modelle.basis;
  return {
    gbdt: b?.gbdt ?? null,
    rl: rl ? { version, q: {} } : null,
    modell: b ? { version, trainiert: '', beispiele: 1000, positivAnteil: 0.3, test: { beispiele: 300, auc: 0.6, praezision: null, basis: 0.3 }, aktiv: b.info.aktiv, merkmale: [] } : null,
    rlInfo: rl ? { version, trainiert: '', episoden: 10, zeitraffer: { trades: 1, gewinnSol: 0, trefferquote: null, pleiten: 0 } } : null,
    modelle,
    bericht: `Lauf ${version}`,
  };
}
const bisZutrifft = async (f: () => boolean) => {
  for (let i = 0; i < 1000 && !f(); i++) await new Promise((r) => setImmediate(r));
  expect(f()).toBe(true);
};

describe('Muster-Dienst: Konsole (E238)', () => {
  it('live während des Trainings (ab=), danach in muster_modelle.konsole_json; Dienst-Zeilen zu Start, Daten, Übernahme; nach Neustart lesbar', async () => {
    const uhr = new TestUhr();
    const db = kryptoDb(':memory:');
    let los: (() => void) | null = null;
    let lauf = 0;
    const trainer: Trainer = async (_d, o) => {
      lauf++;
      o.log?.({ t: 5, stufe: 'info', bereich: 'Daten', text: 'Zeile A' });
      o.log?.({ t: 6, stufe: 'entscheidung', bereich: 'basis', text: 'AKTIV, weil Test-AUC 0,60 ≥ 0,55' });
      if (lauf === 1) await new Promise<void>((r) => (los = r));
      o.log?.({ t: 7, stufe: 'gut', bereich: 'RL', text: 'Zeile C' });
      return lauf === 1 ? ergebnis(o.version, { basis: true, pump: false }) : ergebnis(o.version, { basis: false, pump: true });
    };
    const m = new MusterDienst({ db, uhr, trainer });
    // vor dem ersten Training: leer
    expect(m.konsoleLesen()).toEqual({ laeufe: [], version: null, laeuft: false, zeilen: [], gesamt: 0 });
    m.trainingStarten();
    await bisZutrifft(() => los !== null);
    const live = m.konsoleLesen();
    expect(live.laeuft).toBe(true);
    expect(live.version).toBe(1);
    expect(live.laeufe).toEqual([{ version: 1, erstellt: new Date(uhr.jetzt()).toISOString(), dauerMs: null, fehler: null, aktivGeworden: [], laeuft: true }]);
    expect(live.zeilen.map((z) => `${z.bereich}: ${z.text}`)).toEqual([
      'Dienst: Training v1 gestartet (auf Wunsch) – Daten der letzten 7 Tage',
      'Dienst: noch kein gültiges Modell – jedes neue, das den Test besteht, wird übernommen',
      expect.stringMatching(/^Daten: 0 Ticks aus strom_ticks gelesen/),
      'Daten: Zeile A',
      'basis: AKTIV, weil Test-AUC 0,60 ≥ 0,55',
    ]);
    // Zeit des Trainers wird auf den Laufbeginn verschoben, nie rückwärts
    for (let i = 1; i < live.zeilen.length; i++) expect(live.zeilen[i]!.t).toBeGreaterThanOrEqual(live.zeilen[i - 1]!.t);
    // ab = nur das Neue
    const ab = m.konsoleLesen({ ab: 3 });
    expect(ab).toMatchObject({ version: 1, laeuft: true, gesamt: 5 });
    expect(ab.zeilen.map((z) => z.text)).toEqual(['Zeile A', 'AKTIV, weil Test-AUC 0,60 ≥ 0,55']);
    expect(m.konsoleLesen({ ab: 99 }).zeilen).toEqual([]);
    los!();
    await m.fertig();
    const fertig = m.konsoleLesen({ ab: 5 });
    expect(fertig.laeuft).toBe(false);
    const neu = fertig.zeilen.map((z) => `${z.stufe} ${z.bereich}: ${z.text}`);
    expect(neu[0]).toBe('gut RL: Zeile C');
    expect(neu).toContain('entscheidung basis: übernommen: v1 (vorher keins gültig)');
    expect(neu).toContain('entscheidung pump: keins gültig – das neue ist nicht aktiv');
    expect(neu).toContain('entscheidung RL: RL-Agent v1 übernommen – mindestens ein Wahrscheinlichkeits-Modell ist gültig (basis)');
    expect(neu).toContain('info Dienst: gespeichert: Lauf v1 in muster_modelle, 2 Modelle in muster_einzel; aktiv geworden: basis');
    expect(neu.at(-1)).toMatch(/^info Dienst: Lauf beendet nach \d+,\d s – nächstes Training/);
    const zeile = db.prepare('SELECT konsole_json, dauer_ms, fehler, aktiv_geworden FROM muster_modelle WHERE version = 1').get() as { konsole_json: string; dauer_ms: number; fehler: string | null; aktiv_geworden: string };
    expect(JSON.parse(zeile.konsole_json)).toHaveLength(fertig.gesamt);
    expect(zeile.dauer_ms).toBeGreaterThanOrEqual(0);
    expect(zeile.fehler).toBeNull();
    expect(JSON.parse(zeile.aktiv_geworden)).toEqual(['basis', 'rl']);

    // zweiter Lauf: pump übernommen, basis behalten; Läufe neueste zuerst
    m.trainingStarten();
    await m.fertig();
    const k2 = m.konsoleLesen();
    expect(k2.version).toBe(2);
    expect(k2.laeufe.map((l) => [l.version, l.aktivGeworden])).toEqual([
      [2, ['pump', 'rl']],
      [1, ['basis', 'rl']],
    ]);
    expect(text(k2.zeilen)).toMatch(/Maßstab – derzeit gültig: basis v1 \(AUC 0,60\)/);
    expect(text(k2.zeilen)).toContain('entscheidung [basis] behalten: v1 (das neue ist nicht aktiv)');
    expect(text(k2.zeilen)).toContain('entscheidung [pump] übernommen: v2 (vorher keins gültig)');

    // Neustart: aus der DB, auch ältere Läufe
    const m2 = new MusterDienst({ db, uhr });
    expect(m2.konsoleLesen()).toMatchObject({ version: 2, laeuft: false, gesamt: k2.gesamt });
    const v1 = m2.konsoleLesen({ version: 1, ab: 3 });
    expect(v1.version).toBe(1);
    expect(v1.zeilen[0]!.text).toBe('Zeile A');
    expect(() => m2.konsoleLesen({ version: 99 })).toThrow(/nicht \(mehr\) im Protokoll/);
  });

  it('höchstens KONSOLE_MAX Zeilen: Training gekürzt („… gekürzt“), die Zeilen des Dienstes am Ende bleiben', async () => {
    const uhr = new TestUhr();
    const db = kryptoDb(':memory:');
    const trainer: Trainer = async (_d, o) => {
      for (let i = 0; i < 5000; i++) o.log?.({ t: i, stufe: 'info', bereich: 'Daten', text: `Zeile ${i} ${'x'.repeat(i === 0 ? 5000 : 0)}` });
      return ergebnis(o.version, { basis: true });
    };
    const m = new MusterDienst({ db, uhr, trainer });
    m.trainingStarten();
    await m.fertig();
    const k = m.konsoleLesen();
    expect(k.gesamt).toBeLessThanOrEqual(KONSOLE_MAX);
    expect(k.gesamt).toBeGreaterThan(KONSOLE_MAX - 60);
    expect(k.zeilen.filter((z) => /^… gekürzt – mehr als \d+ Zeilen/.test(z.text))).toHaveLength(1);
    expect(k.zeilen.find((z) => z.text.startsWith('Zeile 0'))!.text.length).toBeLessThanOrEqual(1000);
    expect(k.zeilen.some((z) => z.text.startsWith('Zeile 4999'))).toBe(false);
    expect(k.zeilen.some((z) => z.text === 'übernommen: v1 (vorher keins gültig)')).toBe(true);
    expect(k.zeilen.at(-1)!.text).toMatch(/^Lauf beendet/);
    expect(JSON.parse((db.prepare('SELECT konsole_json FROM muster_modelle').get() as { konsole_json: string }).konsole_json)).toHaveLength(k.gesamt);
  });

  it('Fehler: Zeile mit Meldung, Lauf mit fehler im Protokoll; Bericht/Modelle bleiben, nächste Version zählt weiter', async () => {
    const uhr = new TestUhr();
    const db = kryptoDb(':memory:');
    let fehler = false;
    const trainer: Trainer = async (_d, o) => {
      o.log?.({ t: 1, stufe: 'info', bereich: 'Daten', text: 'vor dem Fehler' });
      if (fehler) throw new Error('Speicher voll');
      return ergebnis(o.version, { basis: true });
    };
    const m = new MusterDienst({ db, uhr, trainer });
    m.trainingStarten();
    await m.fertig();
    fehler = true;
    m.trainingStarten();
    await m.fertig();
    expect(m.status().training.fehler).toBe('Speicher voll');
    const k = m.konsoleLesen();
    expect(k.version).toBe(2);
    expect(k.laeufe[0]).toMatchObject({ version: 2, fehler: 'Speicher voll', aktivGeworden: [] });
    expect(k.laeufe[1]).toMatchObject({ version: 1, fehler: null, aktivGeworden: ['basis', 'rl'] });
    expect(text(k.zeilen)).toContain('info [Daten] vor dem Fehler');
    expect(text(k.zeilen)).toContain('warnung [Dienst] Fehler: Speicher voll');
    expect(text(k.zeilen)).toContain('entscheidung [Dienst] nichts übernommen – die bisherigen Modelle bleiben gültig');
    // Neustart: Bericht und Modelle vom letzten gelungenen Lauf
    const m2 = new MusterDienst({ db, uhr, trainer });
    expect(m2.status().bericht).toBe('Lauf 1');
    expect(m2.aktiv).toBe(true);
    expect(m2.status().modell).toMatchObject({ version: 1, aktiv: true });
    fehler = false;
    m2.trainingStarten();
    await m2.fertig();
    expect(m2.konsoleLesen().version).toBe(3);
  });

  it('Läufe-Liste: höchstens die letzten 20 (wie das Lauf-Protokoll), fehlgeschlagene werden mit aufgeräumt', async () => {
    const uhr = new TestUhr();
    const db = kryptoDb(':memory:');
    let n = 0;
    const trainer: Trainer = async (_d, o) => {
      n++;
      if (n % 2 === 0) throw new Error(`kaputt ${n}`);
      return ergebnis(o.version, { basis: false }, false);
    };
    const m = new MusterDienst({ db, uhr, trainer });
    for (let i = 0; i < 26; i++) {
      m.trainingStarten();
      await m.fertig();
    }
    const k = m.konsoleLesen();
    expect(k.laeufe).toHaveLength(20);
    expect(k.laeufe[0]!.version).toBe(26);
    expect(k.laeufe.map((l) => l.version)).toEqual(Array.from({ length: 20 }, (_, i) => 26 - i));
    expect(k.laeufe[0]!.fehler).toBe('kaputt 26');
    expect((db.prepare('SELECT COUNT(*) AS n FROM muster_modelle').get() as { n: number }).n).toBeLessThanOrEqual(21);
  });

  it('Kryptowerk-API GET /muster/konsole: Bearer, version/ab, 404 unbekannt, 400 falsch, 503 ohne Dienst', async () => {
    const uhr = new TestUhr();
    const db = kryptoDb(':memory:');
    const trainer: Trainer = async (_d, o) => {
      for (let i = 0; i < 4; i++) o.log?.({ t: i, stufe: 'info', bereich: 'Daten', text: `Z${i}` });
      return ergebnis(o.version, { basis: true });
    };
    const muster = new MusterDienst({ db, uhr, trainer });
    const werk = new Kryptowerk({ db, uhr, dex: {} as DexScreener, rug: { bereit: () => false } as unknown as RugCheck, muster });
    const geheim = 'g'.repeat(40);
    const app = kryptoServer(werk, geheim, undefined, muster);
    const auth = { authorization: `Bearer ${geheim}` };
    expect((await app.inject({ url: '/muster/konsole' })).statusCode).toBe(401);
    muster.trainingStarten();
    await muster.fertig();
    muster.trainingStarten();
    await muster.fertig();
    const a = (await app.inject({ url: '/muster/konsole', headers: auth })).json() as KryptoMusterKonsole;
    expect(a.version).toBe(2);
    expect(a.laeufe.map((l) => l.version)).toEqual([2, 1]);
    expect(a.zeilen).toHaveLength(a.gesamt);
    const b = (await app.inject({ url: '/muster/konsole?version=1&ab=4', headers: auth })).json() as KryptoMusterKonsole;
    expect(b.version).toBe(1);
    expect(b.zeilen[0]!.text).toBe('Z1');
    expect(b.gesamt - b.zeilen.length).toBe(4);
    expect((await app.inject({ url: '/muster/konsole?version=9', headers: auth })).statusCode).toBe(404);
    expect((await app.inject({ url: '/muster/konsole?ab=-1', headers: auth })).statusCode).toBe(400);
    expect((await app.inject({ url: '/muster/konsole?version=abc', headers: auth })).statusCode).toBe(400);
    const ohne = kryptoServer(werk, geheim);
    expect((await ohne.inject({ url: '/muster/konsole', headers: auth })).statusCode).toBe(503);
    await app.close();
    await ohne.close();
    werk.beenden();
  });
});

// ---- Dorf -----------------------------------------------------------------------------------------------------------

const G = 'k'.repeat(40);
const w = (n: string, e: unknown) => `<<werkzeug ${n} ${JSON.stringify(e)}>>`;

function konsole(n = 100): KryptoMusterKonsole {
  const zeilen: KryptoKonsoleZeile[] = Array.from({ length: n }, (_, i) => ({ t: i * 1500, stufe: i === n - 2 ? 'entscheidung' : i === n - 3 ? 'warnung' : 'info', bereich: i === n - 2 ? 'basis' : 'Daten', text: i === n - 2 ? 'AKTIV – ersetzt v6 (AUC 0,60 → 0,63), weil …' : `Zeile ${i}` }));
  return { laeufe: [{ version: 7, erstellt: '2026-11-25T10:00:00.000Z', dauerMs: 91_000, fehler: null, aktivGeworden: ['basis', 'rl'] }], version: 7, laeuft: false, zeilen, gesamt: n };
}

function kryptowerk(k: KryptoMusterKonsole = konsole()) {
  const anfragen: { methode: string; pfad: string; suche: string; auth: string | null }[] = [];
  const holen = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    anfragen.push({ methode: init.method ?? 'GET', pfad: u.pathname, suche: u.search, auth: new Headers(init.headers).get('authorization') });
    if (u.pathname === '/muster/konsole') return Response.json(k);
    return Response.json({ ok: true });
  }) as unknown as typeof fetch;
  return { holen, anfragen };
}

async function lauf(d: Awaited<ReturnType<typeof testDorf>>, zeilen: string[]) {
  fs.writeFileSync(path.join(d.vault.wurzel, 'Hafen/aktionen/test.md'), `---\nname: test\nwerkzeuge: [vault_lesen, hafen]\n---\n${zeilen.join('\n')}\n`);
  const r = await d.agenten.aktionStarten('Hafen/test', {});
  await d.agenten.leerlauf();
  return d.agenten.chatDetail(r.chatId).nachrichten.filter((n) => n.rolle === 'werkzeug').map((n) => n.text);
}

describe('Dorf: Konsole (E238)', () => {
  it('Durchreiche GET /api/krypto/muster/konsole mit Bearer, version/ab geprüft; ohne Sitzung nichts', async () => {
    const k = kryptowerk();
    const d = await testDorf({ env: { KRYPTO_GEHEIMNIS: G }, hafenHolen: k.holen });
    const h = await kopf(d);
    expect((await d.app.inject({ url: '/api/krypto/muster/konsole' })).statusCode).toBe(401);
    expect(k.anfragen).toHaveLength(0);
    const a = await d.app.inject({ url: '/api/krypto/muster/konsole', headers: h });
    expect(a.statusCode).toBe(200);
    expect((a.json() as KryptoMusterKonsole).version).toBe(7);
    expect(k.anfragen[0]).toMatchObject({ methode: 'GET', pfad: '/muster/konsole', suche: '', auth: `Bearer ${G}` });
    await d.app.inject({ url: '/api/krypto/muster/konsole?version=7&ab=40', headers: h });
    expect(k.anfragen[1]).toMatchObject({ pfad: '/muster/konsole', suche: '?version=7&ab=40' });
    expect((await d.app.inject({ url: '/api/krypto/muster/konsole?ab=-3', headers: h })).statusCode).toBe(400);
    expect((await d.app.inject({ url: '/api/krypto/muster/konsole?version=1%26x%3D1', headers: h })).statusCode).toBe(400);
    expect(k.anfragen).toHaveLength(2);
  });

  it('hafen_muster {konsole: true}: Kopf + die letzten 80 Zeilen, Entscheidungen markiert; Beschreibung kennt es', async () => {
    const k = kryptowerk();
    const d = await testDorf({ env: { KRYPTO_GEHEIMNIS: G }, hafenHolen: k.holen });
    const [t] = await lauf(d, [w('hafen_muster', { konsole: true })]);
    expect(t).toContain('Trainings-Konsole v7 (2026-11-25 10:00 UTC, 91 s) · aktiv geworden: basis, rl');
    expect(t).toContain(`(die letzten ${HAFEN_KONSOLE_ZEILEN} von 100 Zeilen)`);
    expect(t).toContain('+2:27 » [basis] AKTIV – ersetzt v6 (AUC 0,60 → 0,63), weil …');
    expect(t).toContain('! [Daten] Zeile 97');
    expect(t).not.toContain('Zeile 19\n');
    expect(t).toContain('[Daten] Zeile 20');
    expect(k.anfragen.map((a) => a.pfad)).toEqual(['/muster/konsole']);
    const def = WERKZEUG_DEFINITIONEN.hafen_muster as { description: string; input_schema: { properties: Record<string, unknown> } };
    expect(Object.keys(def.input_schema.properties)).toEqual(['training', 'konsole']);
    expect(def.description).toMatch(/\{"konsole": true\}.*WARUM/);
    // ohne Training / Lauf vor E238 / laufend / fehlgeschlagen
    expect(konsoleText({ laeufe: [], version: null, laeuft: false, zeilen: [], gesamt: 0 })).toBe('Noch kein Training gelaufen – keine Konsole.');
    expect(konsoleText({ ...konsole(0), zeilen: [], gesamt: 0 })).toMatch(/keine Zeilen – Lauf vor E238/);
    expect(konsoleText({ ...konsole(3), laeuft: true, laeufe: [{ version: 7, erstellt: '2026-11-25T10:00:00.000Z', dauerMs: null, fehler: null, aktivGeworden: [], laeuft: true }] })).toMatch(/^Trainings-Konsole v7 \(2026-11-25 10:00 UTC\) – läuft noch\n/);
    expect(konsoleText({ ...konsole(3), laeufe: [{ version: 7, erstellt: '2026-11-25T10:00:00.000Z', dauerMs: 2000, fehler: 'Speicher voll', aktivGeworden: [] }] })).toContain('FEHLGESCHLAGEN: Speicher voll');
  });

  it('Vorlage Muster-Meister nennt die Konsole; die E237-Fassung steht in VORLAGE_FRUEHERE_FASSUNGEN, die jetzige nicht', async () => {
    const d = await testDorf();
    const a = await aktionLaden(d.vault, 'Hafen/muster-meister');
    expect(a?.fehler).toBeUndefined();
    const inhalt = (await d.vault.lesen('Hafen/aktionen/muster-meister.md')).inhalt;
    expect(inhalt).toMatch(/`hafen_muster` `\{"konsole": true\}` in der Trainings-Konsole nach/);
    expect(inhalt).toMatch(/WARUM ein Modell \(nicht\) aktiv wurde/);
    const quelle = fs.readFileSync(path.join(wurzel, 'apps/server/src/dorf.ts'), 'utf8');
    const block = quelle.slice(quelle.indexOf("'Hafen/aktionen/muster-meister.md': ["), quelle.indexOf('],', quelle.indexOf("'Hafen/aktionen/muster-meister.md': [")));
    expect(block).toContain('974a889d98a76e55a11e5aca35acee0304783df58772f9c38407916b0a594c97'); // E237
    const jetzt = crypto.createHash('sha256').update(fs.readFileSync(path.join(wurzel, 'vault-vorlage/Hafen/aktionen/muster-meister.md'))).digest('hex');
    expect(block).not.toContain(jetzt);
  });
});

describe('Bots der Agenten sichtbar (E238, Leifs Wunsch)', () => {
  const bot = (nr: number, name: string, art: 'regeln' | 'rl' | 'prompt' = 'regeln') =>
    ({ id: `00000000-0000-4000-8000-${String(nr).padStart(12, '0')}`, einstellung: { ...structuredClone(KRYPTO_STANDARD), name, art }, modus: 'paper', status: 'laeuft', kennzahlen: {}, kurve: [] }) as unknown as KryptoBot;
  const bots = [bot(1, 'Leifs Sniper'), bot(2, 'HM Momentum 3'), bot(3, 'HM Muster-RL', 'rl'), bot(4, 'Agent Test', 'prompt'), bot(5, 'HM Leif kopiert')];

  it('kryptoBotVon: RL → Muster-Meister, „HM “ → Hafenmeister, sonst Agent', () => {
    expect(kryptoBotVon({ art: 'rl', name: 'HM Muster-RL' })).toBe('muster-meister');
    expect(kryptoBotVon({ art: 'regeln', name: 'HM Momentum' })).toBe('hafenmeister');
    expect(kryptoBotVon({ art: 'regeln', name: 'HMX' })).toBe('agent');
    expect(kryptoBotVon({ art: 'prompt', name: 'Späher' })).toBe('agent');
  });

  it('GET /api/krypto ergänzt agentenBots aus dorf_stand (nur Bots, die es gibt); Terminal bekommt `von`, Leifs Bots nicht', async () => {
    const holen = (async (url: string) => {
      const u = new URL(url);
      if (u.pathname === '/uebersicht') return Response.json({ verbunden: true, notaus: false, datenOnline: true, beobachtet: 1, solUsd: 140, bots });
      if (u.pathname.endsWith('/terminal')) return Response.json({ bot: bots.find((b) => u.pathname === `/bots/${b.id}/terminal`), jetzt: 0, datenOnline: true, solUsd: 140 });
      if (u.pathname === '/muster/konsole') return Response.json(konsole());
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;
    const d = await testDorf({ env: { KRYPTO_GEHEIMNIS: G }, hafenHolen: holen });
    const h = await kopf(d);
    const leer = (await d.app.inject({ url: '/api/krypto', headers: h })).json() as KryptoUebersicht;
    expect(leer.agentenBots).toEqual([]);
    // bot 5 heißt „HM …“, ist aber Leifs (nicht in der Liste) → bleibt bei Leif; eine verschwundene ID taucht nicht auf
    d.db.prepare("INSERT OR REPLACE INTO dorf_stand (schluessel, wert) VALUES ('hafen_agentenbots', ?)").run(JSON.stringify([bots[1]!.id, bots[2]!.id, bots[3]!.id, '00000000-0000-4000-8000-000000000099']));
    const u = (await d.app.inject({ url: '/api/krypto', headers: h })).json() as KryptoUebersicht;
    expect(u.agentenBots).toEqual([
      { id: bots[1]!.id, von: 'hafenmeister' },
      { id: bots[2]!.id, von: 'muster-meister' },
      { id: bots[3]!.id, von: 'agent' },
    ]);
    expect(u.bots).toHaveLength(5);
    const t = (await d.app.inject({ url: `/api/krypto/bots/${bots[1]!.id}/terminal`, headers: h })).json() as KryptoTerminal;
    expect(t.von).toBe('hafenmeister');
    const leif = (await d.app.inject({ url: `/api/krypto/bots/${bots[4]!.id}/terminal`, headers: h })).json() as KryptoTerminal;
    expect(leif.von).toBeUndefined();
  });
});
