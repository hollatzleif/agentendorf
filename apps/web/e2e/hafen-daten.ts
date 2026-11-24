import { KRYPTO_MODULE, KRYPTO_STANDARD, type KryptoBot, type KryptoMusterStatus, type KryptoTerminal, type KryptoUebersicht } from '@dorf/shared';

/** E227: nachgebaute Daten für den Hafen – fest, ohne Zufall */
export const BOT_ID = '11111111-2222-4333-8444-555555555555';
export const BOT2_ID = '66666666-7777-4888-8999-000000000000';

function bot(id: string, name: string, avatar: string, faktor: number, art: 'regeln' | 'prompt' = 'regeln'): KryptoBot {
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
  return { verbunden: true, liveMoeglich: true, auszahlung: 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy', notaus: false, datenOnline: true, beobachtet: 214, solUsd: 70.2, bots: [bot(BOT_ID, 'Schwarm', '🦈', 1.184), bot(BOT2_ID, 'Grübler', '🐙', 0.93, 'prompt')] };
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
    training: { laeuft, fortschritt: laeuft ? 0.4 : 0, letzter: new Date(jetzt - 2 * 3_600_000).toISOString(), naechster: new Date(jetzt + 3 * 3_600_000).toISOString(), fehler: null, dauerMs: 61_000 },
    daten: { ticks: 1_204_000, tokens: 3_100, von: new Date(jetzt - 72 * 3_600_000).toISOString(), bis: new Date(jetzt).toISOString() },
    bericht: '## Muster-Modell v4\nTest-AUC 0,61 – besser als Raten.',
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
      { mint: 'MOONCATmint1111111111111111111111111pump', symbol: 'MOONCAT', wahrscheinlichkeit: 0.72, rat: 'kaufen', zeit: jetzt - 4000 },
      { mint: 'b', symbol: 'SADCAT', wahrscheinlichkeit: 0.18, rat: 'raus', zeit: jetzt - 6000 },
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
      },
    ],
  };
}
