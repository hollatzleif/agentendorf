import { KRYPTO_MODULE, KRYPTO_MUSTER_MODELLE, KRYPTO_STANDARD, type KryptoBot, type KryptoKonsoleZeile, type KryptoMusterKonsole, type KryptoMusterModellInfo, type KryptoMusterSchluessel, type KryptoMusterStatus, type KryptoMusterVerlauf, type KryptoMusterVerlaufLauf, type KryptoMusterVerlaufModell, type KryptoRlBeispielTrade, type KryptoTerminal, type KryptoUebersicht } from '@dorf/shared';

/** E227: nachgebaute Daten für den Hafen – fest, ohne Zufall */
export const BOT_ID = '11111111-2222-4333-8444-555555555555';
export const BOT2_ID = '66666666-7777-4888-8999-000000000000';

function bot(id: string, name: string, avatar: string, faktor: number, art: 'regeln' | 'prompt' | 'rl' = 'regeln'): KryptoBot {
  const jetzt = Date.now();
  const kurve: [number, number][] = Array.from({ length: 24 }, (_, i) => [jetzt - (24 - i) * 3_600_000, 10 * (1 + ((faktor - 1) * i) / 23 + Math.sin(i / 2) * 0.03)]);
  const kapital = 10 * faktor;
  return {
    id,
    einstellung: { ...structuredClone(KRYPTO_STANDARD), name, avatar, art, prompt: art === 'prompt' ? 'Kaufe nur bei starkem Volumen und sauberem RugCheck.' : '' },
    modus: 'paper',
    status: 'laeuft',
    erstellt: new Date(jetzt - 26 * 3_600_000).toISOString(),
    kennzahlen: { kapitalSol: kapital, startSol: 10, faktor, gewinnSol: kapital - 10, gewinnProzent: (faktor - 1) * 100, trades: 21, gewonnen: 13, verloren: 8, trefferquote: 13 / 21, maxDrawdownProzent: 18.4, offen: 1, gebuehrenSol: 0.412, gebuehrenArt: { pumpSol: 0.25, portalSol: 0.1, netzSol: 0.062 }, umsatzSol: 20.4, geblockteRugs: 37, heuteSol: 0.61, tage: [{ tag: '2026-11-24', gewinnSol: 0.61, trades: 6 }, { tag: '2026-11-23', gewinnSol: -0.2, trades: 9 }, { tag: '2026-11-22', gewinnSol: 0.4, trades: 6 }] },
    kurve: [...kurve, [jetzt, kapital]],
    wallet: { adresse: id === BOT_ID ? '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU' : '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', guthabenSol: 1.25 },
    live: null,
    paperBilanz: null,
    abschnittSeit: new Date(jetzt - 26 * 3_600_000).toISOString(),
  };
}

export function uebersicht(): KryptoUebersicht {
  return { verbunden: true, liveMoeglich: true, auszahlung: 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy', notaus: false, datenOnline: true, beobachtet: 214, solUsd: 70.2, usdJeEur: 1.08, bots: [bot(BOT_ID, 'Schwarm', '🦈', 1.184), bot(BOT2_ID, 'Grübler', '🐙', 0.93, 'prompt')] };
}

/** E235: Stand des Muster-Modells */
export function muster(laeuft = false): KryptoMusterStatus {
  const jetzt = Date.now();
  return {
    ziel: { zielProzent: 20, stopProzent: 15, horizontMin: 5 },
    modell: {
      version: 4,
      trainiert: new Date(jetzt - 2 * 3_600_000).toISOString(),
      beispiele: 48_210,
      positivAnteil: 0.18,
      test: { beispiele: 12_050, auc: 0.612, praezision: 0.31, basis: 0.17 },
      aktiv: true,
      merkmale: [
        { name: 'kaufVerhaeltnis60s', wichtigkeit: 0.21 },
        { name: 'rendite30s', wichtigkeit: 0.14 },
        { name: 'ticks60s', wichtigkeit: 0.1 },
        { name: 'abstandHoch120s', wichtigkeit: 0.08 },
        { name: 'solImPool', wichtigkeit: 0.07 },
        { name: 'alterSek', wichtigkeit: 0.05 },
      ],
    },
    rl: { version: 3, trainiert: new Date(jetzt - 2 * 3_600_000).toISOString(), episoden: 4000, zeitraffer: { trades: 57, gewinnSol: 0.84, trefferquote: 0.42, pleiten: 1 } },
    training: { laeuft, fortschritt: laeuft ? 40 : 0, letzter: new Date(jetzt - 2 * 3_600_000).toISOString(), naechster: new Date(jetzt + 3 * 3_600_000).toISOString(), fehler: null, dauerMs: 61_000 },
    daten: { ticks: 1_204_000, tokens: 3_100, von: new Date(jetzt - 72 * 3_600_000).toISOString(), bis: new Date(jetzt).toISOString() },
    bericht: '## Muster-Modell v4\nTest-AUC 0,61 – besser als Raten.',
    // E236: alle Modelle
    modelle: [
      modellInfo('basis', true, { auc: 0.612, aucUntergrenze: 0.57, praezision: 0.31, basis: 0.17 }),
      modellInfo('pump', false, { auc: 0.58, aucUntergrenze: 0.49, praezision: null, basis: 0.01 }, ['zu wenige Pumps im Test (12 < 30)']),
      modellInfo('absturz', true, { auc: 0.664, aucUntergrenze: 0.62, praezision: 0.44, basis: 0.21 }),
      modellInfo('hoch5', true, { fehler: 18.4, fehlerBasis: 23.9 }),
      modellInfo('tief5', false, { fehler: 14.9, fehlerBasis: 15.1 }, ['Fehler nicht ≥ 5 % besser als der Median']),
      // E237: Kursvorhersage (asymmetrischer Fehler) – einige aktiv
      modellInfo('verlauf5s', true, { fehler: 2.1, fehlerBasis: 2.6, richtung: 0.58, alarmAnstieg: { n: 4, treffer: 1 }, alarmFall: { n: 9, treffer: 6 } }),
      modellInfo('verlauf15s', false, { fehler: 4.4, fehlerBasis: 4.5, richtung: 0.52, alarmAnstieg: null, alarmFall: null }, ['Fehler nicht ≥ 5 % besser als die Konstante']),
      modellInfo('verlauf30s', true, { fehler: 6.2, fehlerBasis: 7.4, richtung: 0.61, alarmAnstieg: { n: 12, treffer: 7 }, alarmFall: { n: 31, treffer: 22 } }),
      modellInfo('verlauf1m', true, { fehler: 9.8, fehlerBasis: 11.9, richtung: 0.64, alarmAnstieg: { n: 18, treffer: 9 }, alarmFall: { n: 40, treffer: 27 } }),
      modellInfo('verlauf2m', false, { fehler: 14.1, fehlerBasis: 14.3, richtung: 0.55, alarmAnstieg: { n: 2, treffer: 0 }, alarmFall: { n: 14, treffer: 8 } }, ['Token-Bootstrap nur 81 % (< 95 %)']),
      modellInfo('verlauf5m', true, { fehler: 21.3, fehlerBasis: 25.0, richtung: 0.66, alarmAnstieg: { n: 25, treffer: 11 }, alarmFall: { n: 52, treffer: 37 } }),
    ],
  };
}

function modellInfo(schluessel: KryptoMusterModellInfo['schluessel'], aktiv: boolean, t: Partial<KryptoMusterModellInfo['test']>, gruende: string[] = []): KryptoMusterModellInfo {
  return {
    schluessel,
    version: 4,
    trainiert: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    aktiv,
    gruende,
    beispiele: 48_210,
    test: { beispiele: 12_050, tokens: 412, auc: null, aucUntergrenze: null, praezision: null, basis: null, fehler: null, fehlerBasis: null, ...t },
    merkmale: [],
  };
}

export function terminal(): KryptoTerminal {
  const jetzt = Date.now();
  const b = bot(BOT_ID, 'Schwarm', '🦈', 1.184);
  b.kennzahlen.nachschussSol = 10; // E235
  b.kennzahlen.nachschuesse = 1;
  const kerzen = Array.from({ length: 60 }, (_, i) => {
    const o = 10 + i * 0.03 + Math.sin(i / 3) * 0.25;
    const c = 10 + (i + 1) * 0.03 + Math.sin((i + 1) / 3) * 0.25;
    // auf 15-min-Grenzen wie vom Server (die Marker suchen ihre Kerze über die Slot-Zeit)
    return { zeit: Math.floor(jetzt / 900_000) * 900_000 - (59 - i) * 900_000, o, c, h: Math.max(o, c) + 0.08, l: Math.min(o, c) - 0.06 };
  });
  const module = KRYPTO_MODULE.map((m, i) => ({
    ...m,
    an: m.schluessel !== 'kol' && m.schluessel !== 'x',
    zeile: m.schluessel === 'kol' ? 'aus – braucht PumpPortal-Schlüssel' : m.schluessel === 'x' ? 'aus – braucht Grok-Schlüssel' : ['MOONCAT: Score 4', 'MOONCAT: Dev 1,9 %', 'keine Bundles gemeldet', '', '', 'Top-Halter 6,2 %', 'MOONCAT: $18,4k/5m · 140↑ 52↓', '3m · MC $41k · 22,0 SOL · +18 %', '0.500 SOL je Trade', 'MOONCAT → +50 %', '−25 % · Trail 20 %', 'frei · 9.10 SOL frei'][i]!,
    zuletzt: i % 3 === 0 ? jetzt : jetzt - 60_000,
    ton: (i % 2 ? 'gut' : 'neutral') as 'gut' | 'neutral',
  }));
  return {
    bot: b,
    jetzt,
    datenOnline: true,
    solUsd: 70.2,
    usdJeEur: 1.08, // E237: 1 SOL ≈ 65,00 €
    kerzen,
    lage: 'LONG',
    positionen: [{ id: 'p1', mint: 'MOONCATmint1111111111111111111111111pump', symbol: 'MOONCAT', name: 'Moon Cat', geoeffnet: jetzt - 300_000, einsatzSol: 0.5005, einstiegPreis: 4.1e-8, preis: 4.8e-8, wertSol: 0.57, prozent: 17.1, tpStufe: 0 }],
    trades: [
      { id: 3, zeit: jetzt - 600_000, art: 'verkauf', symbol: 'PEPEZ', mint: 'p', sol: 0.83, preis: 6e-8, gebuehrSol: 0.0109, slippageProzent: 2.1, verzoegerungMs: 1612, grund: 'Trailing Stop −21,0 % vom Hoch', gewinnSol: 0.29, gewinnProzent: 58.2 },
      { id: 2, zeit: jetzt - 900_000, art: 'kauf', symbol: 'MOONCAT', mint: 'm', sol: 0.5, preis: 4.1e-8, gebuehrSol: 0.0068, slippageProzent: 2.4, verzoegerungMs: 1540, grund: '74 Punkte' },
      { id: 1, zeit: jetzt - 1_200_000, art: 'fehlschlag', symbol: 'DOGGO', mint: 'd', sol: 0, preis: 3e-8, gebuehrSol: 0.000505, slippageProzent: 0, verzoegerungMs: 1700, grund: 'Kauf-Transaktion fehlgeschlagen (simuliert) – Netzgebühr bezahlt' },
    ],
    entscheidungen: [
      { id: 9, zeit: jetzt - 5_000, mint: 'r', symbol: 'RUGME', aktion: 'block', sicherheit: null, grund: 'RUG · Rug-Filter: Score 81 · 2× danger > 40', quelle: 'code' },
      { id: 8, zeit: jetzt - 900_000, mint: 'm', symbol: 'MOONCAT', aktion: 'buy', sicherheit: 0.74, grund: '74 Punkte', quelle: 'regeln' },
      { id: 7, zeit: jetzt - 950_000, mint: 'h', symbol: 'HOLDME', aktion: 'hold', sicherheit: 0.41, grund: '41 Punkte < 60', quelle: 'regeln' },
    ],
    module,
    status: 'scoring …',
    pillen: [
      { mint: 'MOONCATmint1111111111111111111111111pump', symbol: 'MOONCAT', prozent: 17.1, gehalten: true },
      { mint: 'a', symbol: 'FROGGY', prozent: 42.3, gehalten: false },
      { mint: 'b', symbol: 'SADCAT', prozent: -12.8, gehalten: false },
      { mint: 'c', symbol: 'WIFHAT2', prozent: 5.2, gehalten: false },
      { mint: 'd', symbol: 'BONKER', prozent: -3.1, gehalten: false },
    ],
    topVolumen: [
      { symbol: 'FROGGY', usd: 48_200, kaeufe: 310, verkaeufe: 140 },
      { symbol: 'MOONCAT', usd: 18_400, kaeufe: 140, verkaeufe: 52 },
      { symbol: 'SADCAT', usd: 9_100, kaeufe: 61, verkaeufe: 88 },
    ],
    volumenBalken: Array.from({ length: 30 }, (_, i) => ({ zeit: jetzt - (30 - i) * 60_000, kaeufe: 200 + ((i * 37) % 120), verkaeufe: 120 + ((i * 53) % 90) })),
    xFeed: [],
    xHinweis: 'X-Sentiment braucht einen Grok-Schlüssel (xAI) – noch nicht eingerichtet.',
    pnlStunden: Array.from({ length: 24 }, (_, i) => (i < 6 ? null : i % 4 === 0 ? -0.08 : i % 3 === 0 ? 0.21 : null)),
    besterTradeSol: 0.29,
    // E235: Rat des Muster-Modells
    musterRat: [
      { mint: 'MOONCATmint1111111111111111111111111pump', symbol: 'MOONCAT', wahrscheinlichkeit: 0.72, rat: 'kaufen', zeit: jetzt - 4000, pump: 0.34, absturz: 0.08, ausblick: { hoch1: 9, tief1: -4, hoch5: 27, tief5: -12 }, frueh: true, verlauf: [1.2, null, 4.4, 9.1, null, -3.2], alarm: 'anstieg' },
      { mint: 'b', symbol: 'SADCAT', wahrscheinlichkeit: 0.18, rat: 'raus', zeit: jetzt - 6000, pump: 0.02, absturz: 0.61, ausblick: { hoch1: null, tief1: null, hoch5: 3, tief5: -38 }, frueh: false, verlauf: [-2, null, -12, -19, null, -31], alarm: 'absturz' },
    ],
    // E232: Echtzeit-Kurse
    echtzeit: { an: true, online: true, abos: 7, ticksMinute: 42, mbHeute: 12.4, grenzeMb: 800, grenzeErreicht: false, fehler: null },
    tokenKerzen: [
      {
        mint: 'MOONCATmint1111111111111111111111111pump',
        symbol: 'MOONCAT',
        gehalten: true,
        kaeufe: 31,
        verkaeufe: 12,
        kerzen: Array.from({ length: 60 }, (_, i) => {
          const o = 4.1e-8 * (1 + i * 0.003 + Math.sin(i / 4) * 0.01);
          const c = 4.1e-8 * (1 + (i + 1) * 0.003 + Math.sin((i + 1) / 4) * 0.01);
          return { zeit: jetzt - (60 - i) * 5000, o, c, h: Math.max(o, c) * 1.002, l: Math.min(o, c) * 0.998 };
        }),
        // E237: Kursvorhersage (aktive Horizonte 5 s, 30 s, 1 min, 5 min) ab der letzten Kerze + Alarm
        prognose: [
          { zeit: jetzt - 5000 + 5_000, c: 4.1e-8 * 1.19 * 1.012 },
          { zeit: jetzt - 5000 + 30_000, c: 4.1e-8 * 1.19 * 1.044 },
          { zeit: jetzt - 5000 + 60_000, c: 4.1e-8 * 1.19 * 1.091 },
          { zeit: jetzt - 5000 + 300_000, c: 4.1e-8 * 1.19 * 0.968 },
        ],
        alarm: 'anstieg',
      },
    ],
  };
}

/** E238: Flotte mit Bots der Agenten (Hafenmeister, Muster-Meister) */
export const HM_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
export const RL_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
export function uebersichtMitAgenten(): KryptoUebersicht {
  const u = uebersicht();
  return { ...u, bots: [...u.bots, bot(HM_ID, 'HM Momentum 3', '⚓', 1.05), bot(RL_ID, 'HM Muster-RL', '🧠', 0.97, 'rl')], agentenBots: [{ id: HM_ID, von: 'hafenmeister' }, { id: RL_ID, von: 'muster-meister' }] };
}

/** E238: Trainings-Konsole – v5 fertig (mit Entscheidungen/Warnungen), v4 älter, v6 läuft (live nachladen) */
export function konsole(version: number | null, ab: number, laeuftZeilen = 3): KryptoMusterKonsole {
  const jetzt = Date.now();
  const laeufe: KryptoMusterKonsole['laeufe'] = [
    { version: 5, erstellt: new Date(jetzt - 2 * 3_600_000).toISOString(), dauerMs: 61_000, fehler: null, aktivGeworden: ['basis', 'pump', 'rl'] },
    { version: 4, erstellt: new Date(jetzt - 7 * 3_600_000).toISOString(), dauerMs: 58_000, fehler: null, aktivGeworden: [] },
  ];
  const v5: KryptoKonsoleZeile[] = [
    { t: 0, stufe: 'info', bereich: 'Dienst', text: 'Training v5 gestartet (Zeitplan) – Daten der letzten 7 Tage' },
    { t: 1200, stufe: 'info', bereich: 'Daten', text: '1.204.000 Ticks gelesen, 2026-11-22 08:00:00 UTC bis 2026-11-25 08:00:00 UTC (72,0 h)' },
    { t: 1300, stufe: 'warnung', bereich: 'Daten', text: '12 Tokens übersprungen – weniger als 3 Ticks, daraus lassen sich keine Merkmale rechnen' },
    { t: 1400, stufe: 'info', bereich: 'Trennung', text: 'Lernen bis 2026-11-24 18:00:00 UTC, Test ab 2026-11-24 18:00:00 UTC' },
    { t: 9800, stufe: 'gut', bereich: 'basis', text: 'Test: Test-AUC 0,61 (Raten 0,50), positiv 17,0 %' },
    { t: 9810, stufe: 'entscheidung', bereich: 'basis', text: 'AKTIV – ersetzt v3 (AUC 0,59 → 0,61), weil Test-AUC 0,61 ≥ 0,55, Untergrenze 0,57 > 0,50' },
    { t: 14_500, stufe: 'entscheidung', bereich: 'absturz', text: 'nicht aktiv, weil Test-AUC 0,52 < 0,55' },
    { t: 30_000, stufe: 'info', bereich: 'RL', text: '24.11. 19:02:15 UTC 7xKX…gAsU KAUFEN · p 0,72 · 🚀 0,31 · 💥 0,04 · v1m +3,2 % · warum: kaufen 0,124 > warten 0,031' },
    { t: 61_000, stufe: 'info', bereich: 'Dienst', text: 'Lauf beendet nach 61,0 s' },
  ];
  const v4: KryptoKonsoleZeile[] = [{ t: 0, stufe: 'entscheidung', bereich: 'Dienst', text: 'kein Modell trainiert, weil zu wenig Daten (312 < 500 Lernbeispiele)' }];
  if (version === 6 || (version === null && laeuftZeilen > 0)) {
    const alle: KryptoKonsoleZeile[] = Array.from({ length: laeuftZeilen }, (_, i) => ({ t: i * 700, stufe: 'info', bereich: 'Daten', text: `Live-Zeile ${i + 1}` }));
    return { laeufe: [{ version: 6, erstellt: new Date(jetzt).toISOString(), dauerMs: null, fehler: null, aktivGeworden: [], laeuft: true }, ...laeufe], version: 6, laeuft: true, zeilen: alle.slice(ab), gesamt: alle.length };
  }
  const alle = version === 4 ? v4 : v5;
  return { laeufe, version: version ?? 5, laeuft: false, zeilen: alle.slice(ab), gesamt: alle.length };
}

/** E239: Verlauf über die Trainings – v3, v4 (ohne Lernkurve/Kurve, wie vor E239), v5 (mit allem); optional v6 läuft */
export function musterVerlauf(version: number | null, laeuft = false): KryptoMusterVerlauf {
  const jetzt = Date.now();
  const erstellt = (v: number) => new Date(jetzt - (6 - v) * 5 * 3_600_000).toISOString();
  const auc: Record<number, Partial<Record<KryptoMusterSchluessel, number>>> = {
    3: { basis: 0.57, pump: 0.53, absturz: 0.6, fruehPump: 0.5, fruehAbsturz: 0.52 },
    4: { basis: 0.59, pump: 0.55, absturz: 0.63, fruehPump: 0.51, fruehAbsturz: 0.54 },
    5: { basis: 0.612, pump: 0.58, absturz: 0.664, fruehPump: 0.49, fruehAbsturz: 0.53 },
  };
  const modelle = (v: number): KryptoMusterModellInfo[] =>
    KRYPTO_MUSTER_MODELLE.map((d, i) => {
      const p = d.art === 'wahrscheinlichkeit';
      const a = auc[v]![d.schluessel] ?? 0.5;
      const fehlerBasis = 5 + i;
      const fehler = fehlerBasis * (1 - (0.02 * v + (i % 3) * 0.02));
      const aktiv = p ? a >= 0.55 : fehler <= fehlerBasis * 0.95;
      const info = modellInfo(d.schluessel, aktiv, p ? { auc: a, aucUntergrenze: a - 0.04, basis: 0.17 } : { fehler, fehlerBasis }, aktiv ? [] : [p ? `Test-AUC ${a.toFixed(2).replace('.', ',')} < 0,55` : 'Fehler nicht ≥ 5 % besser als die Konstante']);
      info.version = v;
      info.merkmale = ['kaufVerhaeltnis60s', 'rendite30s', 'ticks60s', 'abstandHoch120s', 'solImPool', 'alterSek', 'groessterKauf30s', 'nettoSol60s', 'volatilitaet60s', 'gruenInFolge', 'devTokens24h', 'rendite5s'].map((name, j) => ({ name: d.schluessel === 'pump' ? `${name}` : name, wichtigkeit: (d.schluessel === 'pump' ? (j === 2 ? 0.3 : 0.05) : 0.2 / (j + 1)) }));
      if (d.schluessel === 'pump') info.merkmale.sort((x, y) => y.wichtigkeit - x.wichtigkeit);
      if (v === 5)
        info.lernkurve = Array.from({ length: 17 }, (_, k) => {
          const baum = k === 0 ? 1 : Math.min(80, k * 5);
          const lern = 0.5 * Math.exp(-baum / (d.schluessel === 'pump' ? 15 : 30)) + 0.2;
          // pump passt sich an: Test steigt ab Baum 30 wieder
          const test = d.schluessel === 'pump' ? 0.62 - 0.004 * Math.min(baum, 30) + 0.003 * Math.max(0, baum - 30) : lern + 0.03 + 0.01 * Math.exp(-baum / 20);
          return { baum, lern, test };
        });
      return info;
    });
  const t0 = jetzt - 30 * 3_600_000;
  const beispiele: KryptoRlBeispielTrade[] = Array.from({ length: 6 }, (_, i) => {
    const zeit = t0 + (i + 1) * 3_600_000;
    const gewinnSol = i % 3 === 2 ? -0.08 : 0.06 + i * 0.01;
    const lage = { p: 0.72, pump: 0.31, absturz: 0.04, v1m: 3.2, v5m: 6.1, alarm: null, plusProzent: null, haltSek: null };
    return {
      mint: `7xKX${i}tg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU`,
      kauf: { zeit, preis: 1.2e-7, handlung: 'kaufen', grund: 'q', q: [{ handlung: 'kaufen', wert: 0.124 }, { handlung: 'warten', wert: 0.031 }], lage },
      verkauf: i === 4 ? null : { zeit: zeit + 45_000, preis: 1.3e-7, handlung: i === 2 ? 'raus' : 'raus', grund: i === 2 ? 'sicherung' : 'q', q: i === 2 ? [{ handlung: 'raus', wert: 0.2 }] : [{ handlung: 'raus', wert: 0.2 }, { handlung: 'warten', wert: 0.05 }], ...(i === 2 ? { sicherung: '💥 0,80 ≥ 0,7 → nur raus' } : {}), lage: { ...lage, absturz: i === 2 ? 0.8 : 0.04, plusProzent: i === 2 ? -9.5 : 12.4, haltSek: 45 } },
      ende: zeit + 50_000,
      halbVerkaeufe: 0,
      haltSek: 50,
      gewinnSol,
    };
  });
  let kap = 10;
  const kurve = Array.from({ length: 40 }, (_, i) => ({ zeit: t0 + i * 900_000 + 600_000, kapitalSol: (kap += Math.sin(i / 3) * 0.05 + 0.025) }));
  const rl = (v: number): KryptoMusterVerlaufLauf['rl'] => ({ trades: 50 + v, gewinnSol: v === 5 ? kurve.at(-1)!.kapitalSol - 10 : 0.2, trefferquote: 0.42, pleiten: v === 5 ? 1 : 0 });
  const zusammen = (v: number): KryptoMusterVerlaufLauf => {
    const ms = modelle(v);
    const geworden = ms.filter((x) => x.aktiv).map((x) => x.schluessel as string);
    const eintraege = ms.map((x) => {
      const e: KryptoMusterVerlaufModell = {
        aktiv: x.aktiv,
        auc: x.test.auc,
        aucUntergrenze: x.test.aucUntergrenze,
        fehler: x.test.fehler,
        fehlerBasis: x.test.fehlerBasis,
        entscheidung: x.aktiv ? 'uebernommen' : v > 3 && x.schluessel === 'fruehAbsturz' ? 'behaelt' : 'nicht_aktiv',
        ...(x.schluessel === 'fruehAbsturz' && !x.aktiv && v > 3 ? { behaeltVersion: 2 } : {}),
        grund: x.aktiv ? 'Test bestanden' : x.gruende.join('; '),
      };
      return [x.schluessel, e] as const;
    });
    return { version: v, erstellt: erstellt(v), dauerMs: 60_000 + v * 1000, fehler: null, aktivGeworden: [...geworden, 'rl'], modelle: Object.fromEntries(eintraege), rl: rl(v) };
  };
  const laeufe: KryptoMusterVerlaufLauf[] = [zusammen(5), zusammen(4), zusammen(3)];
  if (laeuft) laeufe.unshift({ version: 6, erstellt: new Date(jetzt).toISOString(), dauerMs: null, fehler: null, laeuft: true, aktivGeworden: [], modelle: {}, rl: null });
  const v = version ?? 5;
  return {
    laeufe,
    lauf: {
      version: v,
      erstellt: erstellt(v),
      modelle: modelle(v),
      rl: { version: v, trainiert: erstellt(v), episoden: 4000, zeitraffer: rl(v)!, ...(v === 5 ? { startSol: 10, einsatzSol: 0.5, kurve, beispiele } : {}) },
    },
  };
}
