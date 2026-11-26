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
  /** E235: rl = handelt nach Muster-Modell + RL-Agent (nur Paper) */
  art: 'regeln' | 'prompt' | 'rl';
  /** E235: nur bei art = rl – Grenzen, die der Hafenmeister alle 5 h nachstellt */
  rl?: KryptoRlGrenzen;
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
    /** E234: höchstens so viele ANDERE Tokens darf derselbe Ersteller in den 24 h davor gestartet haben (Serien-Rugger) */
    maxDevTokens24h?: number;
    /** E234: Käufe ÷ Verkäufe der letzten 60 s aus dem Echtzeit-Strom mindestens (0 = aus; ohne Strom-Daten keine Sperre) */
    minEchtzeitKaufVerhaeltnis?: number;
  };
  regeln: {
    /** Punkte (0–100) ab denen gekauft wird */
    minPunkte: number;
    /** E235: so viele Punkte (0–30) darf der Rat des Muster-Modells beisteuern – 0 = nur anzeigen (Standard, bis es sich bewährt hat) */
    musterGewicht?: number;
    /** E237: Alarm-Schwellen der Kursvorhersage (gilt für RL-Bots und Bots mit musterGewicht > 0):
     *  🚀 vorhergesagt ≥ anstiegProzent in ≤ 2 min → Kauf auch unter minPunkte (Sperren und Risk-Gate gelten weiter);
     *  💥 vorhergesagt ≤ −fallProzent in ≤ 2 min → gehaltene Position sofort verkaufen */
    alarm?: { anstiegProzent: number; fallProzent: number };
    /**
     * E242: Muster-Schicht – kauft und verkauft wie gewohnt (Punkte/LLM unverändert), dazu:
     *  Kauf auch, wenn 🚀 Alarm UND die Vorhersage auf 2–5 min steigt; KEIN Kauf, wenn Fall vorhergesagt
     *  (💥, Absturz ≥ 35 % oder 1/2/5 min ≤ −fallProzent); Verkauf früher bei 💥/Absturz ≥ 70 % oder wenn es kurz (30 s/1 min)
     *  ≤ −fallProzent fallen soll und lang (2/5 min) nicht steigt.
     */
    musterSchicht?: { an: boolean; fallProzent: number };
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
    /** E234: fällt die echte SOL-Liquidität der Kurve in EINEM Trade um so viel %, sofort verkaufen (0 = aus) */
    notausEinzelverkaufProzent?: number;
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
  /** E234: Ergebnis je Tag (Wien, letzte 7 Tage mit geschlossenen Positionen, neuester zuerst) */
  tage?: { tag: string; gewinnSol: number; trades: number }[];
  /** E235: frisches Spielgeld für RL-Bots nach Pleite – zählt zum Startkapital, nie als Gewinn */
  nachschussSol?: number;
  nachschuesse?: number;
}

// ---- E235: Muster-Modell (überwacht) + RL-Agent ------------------------------------------------------

export interface KryptoRlGrenzen {
  /** Kauf nur, wenn das Muster-Modell mindestens diese Wahrscheinlichkeit für „erst +Ziel, dann −Stop“ sieht (0–1) */
  minSicherheit: number;
  /** so oft probiert der Agent im Paper eine zufällige Handlung (0–0,3) – zum Lernen */
  erkunden: number;
  /** Nachschuss nach Pleite (Paper-Spielgeld, zählt nie als Gewinn) */
  nachschuss: boolean;
  /** E236: kein Kauf, wenn der Absturz-Erkenner mindestens so viel sieht (0–1); gehalten ab 0,7 sofort raus (harte Sicherung) */
  maxAbsturz?: number;
}

export const KRYPTO_RL_STANDARD: KryptoRlGrenzen = { minSicherheit: 0.6, erkunden: 0.05, nachschuss: true, maxAbsturz: 0.35 };

/** Was das Modell gerade zu einem Token rät */
export interface KryptoMusterRat {
  mint: string;
  symbol: string;
  /** Wahrscheinlichkeit, dass der Kurs erst um +zielProzent steigt, bevor er um −stopProzent fällt (im Horizont); E236: null, wenn das Grundsignal nicht aktiv ist */
  wahrscheinlichkeit: number | null;
  rat: 'kaufen' | 'halten' | 'raus';
  zeit: number;
  /** E236: 🚀 P(+50 % in 2 min, bevor −20 %) – null ohne aktives Modell */
  pump?: number | null;
  /** E236: 💥 P(−30 % in 2 min, bevor +20 %) – null ohne aktives Modell */
  absturz?: number | null;
  /** E236: erwartetes Hoch/Tief in % gegenüber jetzt (1 und 5 min) – Felder null, wenn das jeweilige Modell nicht aktiv ist */
  ausblick?: { hoch1: number | null; tief1: number | null; hoch5: number | null; tief5: number | null } | null;
  /** E236: Pump/Absturz kamen vom Früh-Modell (Token ≤ 90 s alt) */
  frueh?: boolean;
  /** E237: vorhergesagte Kursänderung in % je Horizont (KRYPTO_VERLAUF_SEK), null = Modell nicht aktiv */
  verlauf?: (number | null)[] | null;
  /** E237: Alarm – starker Anstieg oder Absturz steht bevor (aus Kursvorhersage oder Pump-/Absturz-Erkenner) */
  alarm?: 'anstieg' | 'absturz' | null;
}

/** E236: Schlüssel der einzelnen Muster-Modelle */
export type KryptoMusterSchluessel =
  | 'basis'
  | 'pump'
  | 'absturz'
  | 'hoch1'
  | 'tief1'
  | 'hoch5'
  | 'tief5'
  | 'fruehPump'
  | 'fruehAbsturz'
  // E237: Kursvorhersage – Kursänderung in % nach 5 s … 5 min (asymmetrischer Fehler: verpasster Absturz zählt mehr)
  | 'verlauf5s'
  | 'verlauf15s'
  | 'verlauf30s'
  | 'verlauf1m'
  | 'verlauf2m'
  | 'verlauf5m';
/** E237: Horizonte der Kursvorhersage in Sekunden (Reihenfolge = MusterSignale.verlauf, KryptoMusterRat.verlauf) */
export const KRYPTO_VERLAUF_SEK = [5, 15, 30, 60, 120, 300] as const;
export const KRYPTO_MUSTER_MODELLE: { schluessel: KryptoMusterSchluessel; name: string; art: 'wahrscheinlichkeit' | 'wert' }[] = [
  { schluessel: 'basis', name: 'Grundsignal (+20 % vor −15 %, 5 min)', art: 'wahrscheinlichkeit' },
  { schluessel: 'pump', name: '🚀 Pump (+50 % vor −20 %, 2 min)', art: 'wahrscheinlichkeit' },
  { schluessel: 'absturz', name: '💥 Absturz (−30 % vor +20 %, 2 min)', art: 'wahrscheinlichkeit' },
  { schluessel: 'hoch1', name: 'Hoch in 1 min (%)', art: 'wert' },
  { schluessel: 'tief1', name: 'Tief in 1 min (%)', art: 'wert' },
  { schluessel: 'hoch5', name: 'Hoch in 5 min (%)', art: 'wert' },
  { schluessel: 'tief5', name: 'Tief in 5 min (%)', art: 'wert' },
  { schluessel: 'fruehPump', name: '🚀 Pump – Früh-Modell (Token ≤ 90 s)', art: 'wahrscheinlichkeit' },
  { schluessel: 'fruehAbsturz', name: '💥 Absturz – Früh-Modell (Token ≤ 90 s)', art: 'wahrscheinlichkeit' },
  { schluessel: 'verlauf5s', name: '📈 Kurs in 5 s (%)', art: 'wert' },
  { schluessel: 'verlauf15s', name: '📈 Kurs in 15 s (%)', art: 'wert' },
  { schluessel: 'verlauf30s', name: '📈 Kurs in 30 s (%)', art: 'wert' },
  { schluessel: 'verlauf1m', name: '📈 Kurs in 1 min (%)', art: 'wert' },
  { schluessel: 'verlauf2m', name: '📈 Kurs in 2 min (%)', art: 'wert' },
  { schluessel: 'verlauf5m', name: '📈 Kurs in 5 min (%)', art: 'wert' },
];

/** E236: Stand eines einzelnen Muster-Modells */
export interface KryptoMusterModellInfo {
  schluessel: KryptoMusterSchluessel;
  version: number;
  trainiert: string;
  aktiv: boolean;
  /** warum nicht aktiv (leer, wenn aktiv) */
  gruende: string[];
  beispiele: number;
  test: {
    beispiele: number;
    tokens: number;
    /** Wahrscheinlichkeits-Modelle */
    auc: number | null;
    aucUntergrenze: number | null;
    praezision: number | null;
    basis: number | null;
    /** Wert-Modelle: mittlerer absoluter Fehler in %-Punkten gegen den Median als Schätzung */
    fehler: number | null;
    fehlerBasis: number | null;
    /** E237 (nur verlauf*): bei großen Bewegungen (|Änderung| ≥ 10 %) Anteil mit richtiger Richtung der Vorhersage */
    richtung?: number | null;
    /** E237 (nur verlauf*): Alarme im Test – n = ausgelöst, treffer = Kurs bewegte sich danach mindestens halb so stark in diese Richtung */
    alarmAnstieg?: { n: number; treffer: number } | null;
    alarmFall?: { n: number; treffer: number } | null;
  };
  merkmale: { name: string; wichtigkeit: number }[];
  /** E239: Verlust auf Lern- und Testdaten nach `baum` Bäumen (Skala wie im Training; fehlt bei Läufen vor E239) */
  lernkurve?: KryptoLernkurvePunkt[];
}

/** E239: ein Punkt der Lernkurve – sinkt lern weiter, während test steigt, passt sich das Modell zu sehr an */
export interface KryptoLernkurvePunkt {
  baum: number;
  lern: number;
  test: number | null;
}

/** E239: eine Entscheidung des RL-Agenten im Zeitraffer (strukturiert, für Marker und Liste) */
export interface KryptoRlEntscheidungInfo {
  zeit: number;
  /** Ausführungskurs (SOL je Token) */
  preis: number;
  handlung: 'warten' | 'kaufen' | 'halb' | 'raus';
  /** q = beste erlaubte Handlung nach Q-Werten; regel = Lage nie geübt; sicherung = nur eine Handlung erlaubt */
  grund: 'q' | 'regel' | 'sicherung';
  q: { handlung: string; wert: number }[] | null;
  sicherung?: string;
  lage: { p: number | null; pump: number | null; absturz: number | null; v1m: number | null; v5m: number | null; alarm: 'anstieg' | 'absturz' | null; plusProzent: number | null; haltSek: number | null };
}
/** E239: ein abgeschlossener Beispiel-Trade aus dem Zeitraffer */
export interface KryptoRlBeispielTrade {
  mint: string;
  kauf: KryptoRlEntscheidungInfo;
  /** null = Ende der Aufzeichnung (zum letzten Kurs geschlossen) */
  verkauf: KryptoRlEntscheidungInfo | null;
  /** Zeitpunkt des Abschlusses */
  ende: number;
  halbVerkaeufe: number;
  haltSek: number;
  /** nach allen Gebühren */
  gewinnSol: number;
}

export interface KryptoMusterStatus {
  /** Label-Definition, auf die das Modell trainiert ist */
  ziel: { zielProzent: number; stopProzent: number; horizontMin: number };
  modell: null | {
    version: number;
    trainiert: string;
    beispiele: number;
    /** Anteil positiver Beispiele (= Trefferquote, wenn man blind kauft) */
    positivAnteil: number;
    /** zeitlich getrennter Test auf den neuesten, NIE gesehenen Daten */
    test: { beispiele: number; auc: number; praezision: number | null; basis: number };
    /** nur aktive Modelle geben Rat (Test besser als Raten) */
    aktiv: boolean;
    merkmale: { name: string; wichtigkeit: number }[];
  };
  rl: null | {
    version: number;
    trainiert: string;
    episoden: number;
    /** Zeitraffer über die Testdaten (Paper-Maschine mit Gebühren) */
    zeitraffer: { trades: number; gewinnSol: number; trefferquote: number | null; pleiten: number };
    /** E239 (nur /muster/verlauf, nicht im Status): Kapital über die Testdaten nach Abschluss-Zeit (≤ 300 Punkte), Start, Beispiel-Trades */
    kurve?: { zeit: number; kapitalSol: number }[];
    startSol?: number;
    einsatzSol?: number;
    beispiele?: KryptoRlBeispielTrade[];
  };
  training: { laeuft: boolean; /** in Prozent (0–100) */ fortschritt: number; letzter: string | null; naechster: string | null; fehler: string | null; dauerMs: number | null };
  daten: { ticks: number; tokens: number; von: string | null; bis: string | null };
  /** E241: Beispiel-Archiv (Zeitpunkte mit Merkmalen + Labels, bleiben nach dem Löschen der Ticks) */
  archiv?: { beispiele: number; tokens: number; von: string | null };
  /** E241: Beispiele des neuesten Laufs (Grundsignal) – wächst mit jedem Training, auch wenn das gültige Modell bleibt */
  letzterLauf?: { version: number; beispiele: number; testBeispiele: number; uebernommen: boolean } | null;
  /** Kurzbericht in Markdown (für den Hafenmeister) */
  bericht: string;
  /** E236: alle Modelle (basis entspricht `modell`) – das jeweils gültige je Schlüssel */
  modelle?: KryptoMusterModellInfo[];
}

/** E238: eine Zeile der Trainings-Konsole (t = ms seit Laufbeginn) */
export type KryptoKonsoleStufe = 'info' | 'gut' | 'warnung' | 'entscheidung';
export interface KryptoKonsoleZeile {
  t: number;
  stufe: KryptoKonsoleStufe;
  /** 'Dienst', 'Daten', 'Trennung', ein Modell-Schlüssel (basis, pump …), 'RL' oder 'Laufzeit' */
  bereich: string;
  text: string;
}
/** E238: Trainings-Konsole des Muster-Modells – GET /api/krypto/muster/konsole?version=&ab= */
export interface KryptoMusterKonsole {
  /** neueste zuerst (höchstens 20 + ein laufendes) */
  laeufe: { version: number; erstellt: string; dauerMs: number | null; fehler: string | null; aktivGeworden: string[]; laeuft?: boolean }[];
  /** Lauf dieser Zeilen (null = noch keiner) */
  version: number | null;
  /** läuft dieser Lauf gerade? (dann mit ab= nachladen) */
  laeuft: boolean;
  /** Zeilen ab Index `ab` */
  zeilen: KryptoKonsoleZeile[];
  /** so viele Zeilen hat der Lauf insgesamt (bisher) */
  gesamt: number;
}

/** E239: was ein Lauf mit einem Modell-Schlüssel gemacht hat */
export type KryptoMusterEntscheidung = 'uebernommen' | 'behaelt' | 'nicht_aktiv' | 'nicht_trainiert';
export interface KryptoMusterVerlaufModell {
  /** hat das Modell dieses Laufs den Test bestanden? */
  aktiv: boolean;
  auc: number | null;
  aucUntergrenze: number | null;
  fehler: number | null;
  fehlerBasis: number | null;
  entscheidung: KryptoMusterEntscheidung;
  /** bei 'behaelt': die weiter gültige Version */
  behaeltVersion?: number | null;
  /** Gründe (nicht aktiv) bzw. Testwerte (übernommen) */
  grund: string;
}
/** E239: ein Lauf im Verlauf über die Trainings */
export interface KryptoMusterVerlaufLauf {
  version: number;
  erstellt: string;
  dauerMs: number | null;
  fehler: string | null;
  laeuft?: boolean;
  aktivGeworden: string[];
  modelle: Partial<Record<KryptoMusterSchluessel, KryptoMusterVerlaufModell>>;
  rl: NonNullable<KryptoMusterStatus['rl']>['zeitraffer'] | null;
}
/** E239: GET /api/krypto/muster/verlauf?version= – alle Läufe (neueste zuerst) + Einzelheiten eines Laufs */
export interface KryptoMusterVerlauf {
  laeufe: KryptoMusterVerlaufLauf[];
  /** Einzelheiten des gewählten (bzw. neuesten gespeicherten) Laufs; null ohne gespeicherten Lauf */
  lauf: null | {
    version: number;
    erstellt: string;
    /** Modelle dieses Laufs (Reihenfolge KRYPTO_MUSTER_MODELLE; ältere Läufe können fehlen – je Schlüssel die letzten 10) */
    modelle: KryptoMusterModellInfo[];
    rl: KryptoMusterStatus['rl'];
  };
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
    /** E237: wie gut die Aufzeichnung den Zeitraum abdeckt (fehlt bei Backtests von vor E237) */
    abdeckung?: KryptoBacktestAbdeckung;
    /** E237: Hinweise zur Aussagekraft (z. B. Muster-Rat abgeschaltet, alte Aufzeichnung ohne Kursänderung 5 min) */
    hinweise?: string[];
  };
}

/** E237: Abdeckung eines Backtests durch die Aufzeichnung */
export interface KryptoBacktestAbdeckung {
  /** Tokens, die im Zeitraum beobachtet werden konnten (entstanden ab Beginn minus maxAlterSek) */
  tokens: number;
  /** … davon mit mindestens einem Kurs, einem RugCheck-Bericht bzw. Echtzeit-Ticks */
  mitKurs: number;
  mitRug: number;
  mitStrom: number;
  /** Median der Abstände zwischen zwei Kursen desselben Tokens (s), null ohne Daten */
  kursAbstandSek: number | null;
  /** Anteil der Kurse ohne Kursänderung 5 min (Aufzeichnung von vor E237) */
  ohneAenderungProzent: number;
  /** Käufe, die zu Kursen mit Echtzeit-Ticks liefen (von allen Käufen) */
  kaeufeMitStrom: number;
  /** Positionen, die geschlossen wurden, weil die Aufzeichnung des Tokens endete (Verkauf zum letzten Kurs) */
  datenende: number;
  /** Käufe, die verfallen sind, weil nach der Verzögerung kein Kurs mehr kam */
  kaeufeVerfallen: number;
  /** Muster-Rat (musterGewicht/Alarm) im Backtest abgeschaltet */
  musterAus: boolean;
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
  quelle: 'regeln' | 'llm' | 'code' | 'modell';
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
  /** E237: US-Dollar je Euro (EZB-Referenzkurs, vom Dorf ergänzt, 6 h zwischengespeichert) – null ohne Kurs */
  usdJeEur?: number | null;
  /** E238: von einem Agenten angelegt (vom Dorf ergänzt; fehlt = Leifs Bot) */
  von?: KryptoBotVon;
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
  /** E233: Käufe/Verkäufe im Zeitraum der Kerzen (für die Marker im Chart, höchstens 500) */
  chartTrades?: KryptoTrade[];
  /** E235: Rat des Muster-Modells zu gehaltenen und beobachteten Tokens (leer ohne aktives Modell) */
  musterRat?: KryptoMusterRat[];
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
  /** E237: Kursvorhersage ab der letzten Kerze (zeit in ms, Kurs in SOL) – leer ohne aktive Verlauf-Modelle */
  prognose?: { zeit: number; c: number }[];
  alarm?: 'anstieg' | 'absturz' | null;
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
  /** E237: US-Dollar je Euro (EZB-Referenzkurs, vom Dorf ergänzt, 6 h zwischengespeichert) – null ohne Kurs */
  usdJeEur?: number | null;
  bots: KryptoBot[];
  fehler?: string;
  /** E232: null = kein RPC eingerichtet */
  echtzeit?: KryptoEchtzeit | null;
  /** E238: Bots, die Agenten angelegt haben (vom Dorf ergänzt) – alle übrigen sind Leifs */
  agentenBots?: { id: string; von: KryptoBotVon }[];
}

/** E238: wer einen Agenten-Bot angelegt hat (RL-Bot → Muster-Meister, Name „HM …“ → Hafenmeister, sonst ein Agent) */
export type KryptoBotVon = 'hafenmeister' | 'muster-meister' | 'agent';
export const KRYPTO_BOT_VON: Record<KryptoBotVon, string> = { hafenmeister: '⚓ Hafenmeister', 'muster-meister': '🧠 Muster-Meister', agent: '🤖 Agent' };
/** E238: Zuordnung eines Agenten-Bots */
export function kryptoBotVon(e: { art?: string; name: string }): KryptoBotVon {
  if (e.art === 'rl') return 'muster-meister';
  if (e.name.startsWith('HM ')) return 'hafenmeister';
  return 'agent';
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
    maxDevTokens24h: 3,
    minEchtzeitKaufVerhaeltnis: 0,
    maxTopHalterProzent: 20,
    minLiquiditaetSol: 5,
  },
  regeln: { minPunkte: 60, musterGewicht: 0, alarm: { anstiegProzent: 15, fallProzent: 10 }, musterSchicht: { an: false, fallProzent: 5 } },
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
    notausEinzelverkaufProzent: 15,
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
