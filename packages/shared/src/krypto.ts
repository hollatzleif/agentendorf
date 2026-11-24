// E227: Hafen – Krypto-Trading-Bots (Paper Trading). Typen für Kryptowerk, Dorf und App.
// Beträge in SOL, wenn nicht anders angegeben. Es gibt keinen Hebel.

export type KryptoModus = 'paper' | 'live';
export type KryptoBotStatus = 'laeuft' | 'pausiert' | 'gestoppt';

export interface KryptoTakeProfit {
  /** Kursgewinn seit Einstieg in % */
  beiProzent: number;
  /** so viel % der ursprünglichen Menge verkaufen */
  verkaufProzent: number;
}

export interface KryptoEinstellung {
  name: string;
  /** ein Emoji als Avatar */
  avatar: string;
  art: 'regeln' | 'prompt';
  /** nur bei art = prompt: die Strategie in eigenen Worten */
  prompt: string;
  startkapitalSol: number;
  filter: {
    /** RugCheck score_normalised (0–100, höher = riskanter) – höchstens */
    maxRugScore: number;
    /** keine Risiken der Stufe „danger“ */
    keineGefahr: boolean;
    minVolumenUsdM5: number;
    minKaeufeM5: number;
    /** Käufe ÷ Verkäufe der letzten 5 min mindestens */
    minKaufVerhaeltnis: number;
    minAlterSek: number;
    maxAlterSek: number;
    minMarketCapUsd: number;
    maxMarketCapUsd: number;
    /** Anteil des Entwicklers am Angebot beim Start (initialBuy) höchstens, in % */
    maxDevProzent: number;
    /** größter einzelner Halter höchstens, in % (RugCheck) */
    maxTopHalterProzent: number;
    /** SOL in der Bonding Curve bzw. im Pool mindestens */
    minLiquiditaetSol: number;
  };
  regeln: {
    /** Punkte (0–100) ab denen gekauft wird */
    minPunkte: number;
  };
  /** nur bei art = prompt: Kauf erst ab dieser Sicherheit des LLM (0–1) */
  minSicherheit: number;
  limits: {
    /** höchstens so viel SOL je Trade */
    einsatzProTradeSol: number;
    /** Positionsgröße in % des freien Kapitals (der kleinere Wert gilt) */
    positionProzent: number;
    /** ist der Tagesverlust (Wien) erreicht, kauft der Bot bis morgen nichts mehr */
    maxTagesverlustSol: number;
    maxOffen: number;
    /** höchstens so viele LLM-Bewertungen am Tag (nur Prompt-Bots) */
    maxLlmProTag: number;
  };
  ausstieg: {
    takeProfit: KryptoTakeProfit[];
    /** Verlust seit Einstieg in % */
    stopLossProzent: number;
    /** Rückgang vom Höchstkurs seit Einstieg in % (0 = aus) */
    trailingProzent: number;
    maxHaltMinuten: number;
  };
  simulation: {
    /** Zeit zwischen Entscheidung und Ausführung */
    verzoegerungMs: number;
    /** Priority Fee je Transaktion */
    prioritaetSol: number;
    /** so viel % der Transaktionen schlagen fehl (Gebühr ist trotzdem weg) */
    fehlschlagProzent: number;
    /** Gebühr des Ausführungswegs (PumpPortal Local: 0,5 %) – auch im Paper Trading, damit Paper = Live */
    portalGebuehrProzent?: number;
  };
  /** nur Live: erlaubte Abweichung beim Ausführen in % (an PumpPortal) */
  slippageProzent?: number;
}

export interface KryptoKennzahlen {
  kapitalSol: number;
  startSol: number;
  /** Kapital ÷ Startkapital */
  faktor: number;
  gewinnSol: number;
  gewinnProzent: number;
  trades: number;
  gewonnen: number;
  verloren: number;
  trefferquote: number | null;
  /** größter Rückgang der Equity in % (0–100) */
  maxDrawdownProzent: number;
  offen: number;
  gebuehrenSol: number;
  /** Gebühren nach Art */
  gebuehrenArt: { pumpSol: number; portalSol: number; netzSol: number };
  /** gehandeltes Volumen (Käufe + Verkäufe) */
  umsatzSol: number;
  geblockteRugs: number;
  heuteSol: number;
}

export interface KryptoWallet {
  adresse: string;
  /** null = ohne RPC nicht abrufbar */
  guthabenSol: number | null;
}

export interface KryptoLive {
  seit: string;
  /** so viel SOL darf der Bot höchstens einsetzen (Budget beim Scharfschalten) */
  budgetSol: number;
}

export interface KryptoBot {
  id: string;
  einstellung: KryptoEinstellung;
  modus: KryptoModus;
  status: KryptoBotStatus;
  erstellt: string;
  kennzahlen: KryptoKennzahlen;
  /** Equity je Stunde (für die Vergleichskurve) */
  kurve: [number, number][];
  /** eigenes, neu erzeugtes Wallet (null = Hauptschlüssel fehlt) */
  wallet: KryptoWallet | null;
  live: KryptoLive | null;
  /** Bilanz des letzten Paper-Abschnitts vor dem Scharfschalten */
  paperBilanz: KryptoKennzahlen | null;
  /** seit wann der aktuelle Abschnitt (Paper oder Live) läuft */
  abschnittSeit: string;
}

export interface KryptoBacktest {
  id: string;
  status: 'laeuft' | 'fertig' | 'fehler';
  fortschritt: number;
  von: string;
  bis: string;
  name: string;
  erstellt: string;
  fehler?: string;
  /** wie viele Tokens und Kurse in den Aufzeichnungen lagen */
  daten?: { tokens: number; kurse: number; rug: number };
  ergebnis?: {
    kennzahlen: KryptoKennzahlen;
    kurve: [number, number][];
    trades: KryptoTrade[];
    entscheidungen: { buy: number; hold: number; block: number };
  };
}

export interface KryptoKerze {
  zeit: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface KryptoPosition {
  id: string;
  mint: string;
  symbol: string;
  name: string;
  geoeffnet: number;
  einsatzSol: number;
  einstiegPreis: number;
  preis: number | null;
  wertSol: number | null;
  prozent: number | null;
  tpStufe: number;
}

export interface KryptoTrade {
  id: number;
  zeit: number;
  art: 'kauf' | 'verkauf' | 'fehlschlag';
  symbol: string;
  mint: string;
  sol: number;
  preis: number;
  gebuehrSol: number;
  slippageProzent: number;
  verzoegerungMs: number;
  grund: string;
  /** echte Transaktion (Live) */
  signatur?: string;
  /** nur Verkäufe: Gewinn der ganzen Position, wenn sie damit geschlossen ist */
  gewinnSol?: number;
  gewinnProzent?: number;
}

export interface KryptoEntscheidung {
  id: number;
  zeit: number;
  mint: string;
  symbol: string;
  aktion: 'buy' | 'hold' | 'block' | 'sell';
  sicherheit: number | null;
  grund: string;
  quelle: 'regeln' | 'llm' | 'code';
}

export type KryptoModulSchluessel =
  | 'rug'
  | 'dev'
  | 'bundle'
  | 'kol'
  | 'x'
  | 'holder'
  | 'volumen'
  | 'sniper'
  | 'groesse'
  | 'tp'
  | 'sl'
  | 'gate';

export interface KryptoModul {
  schluessel: KryptoModulSchluessel;
  name: string;
  buchstabe: string;
  an: boolean;
  zeile: string;
  /** letztes Signal (ms) */
  zuletzt: number | null;
  /** gut / schlecht / neutral – Farbe des Aufleuchtens */
  ton: 'gut' | 'schlecht' | 'neutral';
}

export interface KryptoTokenPille {
  mint: string;
  symbol: string;
  prozent: number | null;
  gehalten: boolean;
}

export interface KryptoTerminal {
  bot: KryptoBot;
  jetzt: number;
  datenOnline: boolean;
  solUsd: number | null;
  kerzen: KryptoKerze[];
  /** FLAT = keine offene Position */
  lage: 'FLAT' | 'LONG';
  positionen: KryptoPosition[];
  trades: KryptoTrade[];
  entscheidungen: KryptoEntscheidung[];
  module: KryptoModul[];
  status: string;
  pillen: KryptoTokenPille[];
  /** Volumen (USD, 5 min) der meistgehandelten beobachteten Tokens */
  topVolumen: { symbol: string; usd: number; kaeufe: number; verkaeufe: number }[];
  /** Käufe/Verkäufe je Minute der letzten 30 min (aus beobachteten Tokens) */
  volumenBalken: { zeit: number; kaeufe: number; verkaeufe: number }[];
  /** X-Feed (nur mit Grok-Schlüssel) */
  xFeed: { zeit: number; account: string; symbol: string; text: string; stimmung: number }[];
  xHinweis: string | null;
  /** Gewinn je Stunde (Wien) heute, Index 0–23 */
  pnlStunden: (number | null)[];
  besterTradeSol: number | null;
  /** E232 */
  echtzeit?: KryptoEchtzeit | null;
  tokenKerzen?: KryptoTokenKerzen[];
  /** E233: Takt der Equity-Kerzen in `kerzen` */
  kerzenTakt?: KryptoKerzenTakt;
}

/** E233: Kerzen-Takt der Bot-Equity im Terminal */
export const KRYPTO_KERZEN_TAKTE = ['5s', '15s', '1m', '5m', '15m'] as const;
export type KryptoKerzenTakt = (typeof KRYPTO_KERZEN_TAKTE)[number];
export const KRYPTO_KERZEN_MS: Record<KryptoKerzenTakt, number> = { '5s': 5_000, '15s': 15_000, '1m': 60_000, '5m': 300_000, '15m': 900_000 };

/** E232: Echtzeit-Kurse (Bonding Curve über den Solana-WebSocket von Leifs RPC) */
export interface KryptoEchtzeit {
  an: boolean;
  online: boolean;
  /** abonnierte Tokens */
  abos: number;
  /** Änderungen (≈ Trades) in der letzten Minute */
  ticksMinute: number;
  mbHeute: number;
  grenzeMb: number;
  grenzeErreicht: boolean;
  fehler: string | null;
}

/** E232: Kurs-Kerzen eines gehaltenen Tokens aus dem Echtzeit-Strom (5-Sekunden-Kerzen, letzte 10 min) */
export interface KryptoTokenKerzen {
  mint: string;
  symbol: string;
  kerzen: KryptoKerze[];
  kaeufe: number;
  verkaeufe: number;
  /** gehalten (offene Position dieses Bots) – sonst nur beobachtet */
  gehalten?: boolean;
}

export interface KryptoUebersicht {
  verbunden: boolean;
  /** Live möglich: RPC und Hauptschlüssel eingerichtet */
  liveMoeglich?: boolean;
  /** feste Auszahlungsadresse (am Server eingetragen) */
  auszahlung?: string | null;
  notaus: boolean;
  datenOnline: boolean;
  beobachtet: number;
  solUsd: number | null;
  bots: KryptoBot[];
  fehler?: string;
  /** E232: null = kein RPC eingerichtet */
  echtzeit?: KryptoEchtzeit | null;
}

/** Vorgaben für einen neuen Bot – Paper Trading, vorsichtige Limits */
export const KRYPTO_STANDARD: KryptoEinstellung = {
  name: 'Neuer Bot',
  avatar: '🐟',
  art: 'regeln',
  prompt: '',
  startkapitalSol: 10,
  filter: {
    maxRugScore: 40,
    keineGefahr: true,
    minVolumenUsdM5: 3000,
    minKaeufeM5: 15,
    minKaufVerhaeltnis: 1.2,
    minAlterSek: 60,
    maxAlterSek: 1800,
    minMarketCapUsd: 5000,
    maxMarketCapUsd: 150000,
    maxDevProzent: 10,
    maxTopHalterProzent: 20,
    minLiquiditaetSol: 5,
  },
  regeln: { minPunkte: 60 },
  minSicherheit: 0.65,
  limits: { einsatzProTradeSol: 0.5, positionProzent: 5, maxTagesverlustSol: 2, maxOffen: 3, maxLlmProTag: 150 },
  ausstieg: {
    takeProfit: [
      { beiProzent: 50, verkaufProzent: 50 },
      { beiProzent: 150, verkaufProzent: 50 },
    ],
    stopLossProzent: 25,
    trailingProzent: 20,
    maxHaltMinuten: 120,
  },
  simulation: { verzoegerungMs: 1500, prioritaetSol: 0.0005, fehlschlagProzent: 5, portalGebuehrProzent: 0.5 },
  slippageProzent: 15,
};

/** so lange muss ein Bot im Paper Trading gelaufen sein, bevor er scharf geschaltet werden darf */
export const KRYPTO_PAPER_MINDESTENS_STUNDEN = 24;

/** Die zwölf Prüfmodule im Kreis um den Kern */
export const KRYPTO_MODULE: { schluessel: KryptoModulSchluessel; name: string; buchstabe: string }[] = [
  { schluessel: 'rug', name: 'Rug-Filter', buchstabe: 'R' },
  { schluessel: 'dev', name: 'Dev-Check', buchstabe: 'D' },
  { schluessel: 'bundle', name: 'Bundle-Scan', buchstabe: 'B' },
  { schluessel: 'kol', name: 'KOL-Watch', buchstabe: 'K' },
  { schluessel: 'x', name: 'X-Sentiment', buchstabe: 'X' },
  { schluessel: 'holder', name: 'Holder-Map', buchstabe: 'H' },
  { schluessel: 'volumen', name: 'Volume-Flow', buchstabe: 'V' },
  { schluessel: 'sniper', name: 'Sniper', buchstabe: 'S' },
  { schluessel: 'groesse', name: 'Positionsgröße', buchstabe: 'P' },
  { schluessel: 'tp', name: 'Take-Profit', buchstabe: 'T' },
  { schluessel: 'sl', name: 'Stop-Loss', buchstabe: 'L' },
  { schluessel: 'gate', name: 'Risk-Gate', buchstabe: 'G' },
];
