// E235: Verträge zwischen Muster-Kern (merkmale/gbdt/rl/training) und Kryptowerk (motor.ts).
// Alles in diesem Ordner ist reiner Code ohne DB/Netz – testbar mit erfundenen Tick-Reihen.

/** Ein Trade auf der Bonding Curve, wie ihn der Echtzeit-Strom sieht (E232) */
export interface Tick {
  zeit: number;
  /** Kurs in SOL je Token */
  preis: number;
  /** SOL rein (+, Kauf) oder raus (−, Verkauf); 0 = erster Stand ohne Richtung */
  sol: number;
  /** echte SOL in der Kurve nach dem Trade */
  echtSol: number;
}

export interface TokenMeta {
  mint: string;
  erstellt: number;
  devTokens24h?: number;
}

/** Label: erst +zielProzent, bevor −stopProzent, innerhalb horizontMs */
export interface Ziel {
  zielProzent: number;
  stopProzent: number;
  horizontMs: number;
  /** E236: 'ab' = Absturz-Label (erst −zielProzent, bevor +stopProzent); Standard 'auf' */
  richtung?: 'auf' | 'ab';
}
export const STANDARD_ZIEL: Ziel = { zielProzent: 20, stopProzent: 15, horizontMs: 5 * 60_000 };
/** E236 */
export const PUMP_ZIEL: Ziel = { zielProzent: 50, stopProzent: 20, horizontMs: 2 * 60_000 };
export const ABSTURZ_ZIEL: Ziel = { zielProzent: 30, stopProzent: 20, horizontMs: 2 * 60_000, richtung: 'ab' };
/** E236: Früh-Modelle lernen nur auf Zeitpunkten mit Token-Alter ≤ so viel */
export const FRUEH_ALTER_MS = 90_000;

/** E236: alle Signale eines Tokens zu einem Zeitpunkt (null = Modell nicht aktiv / keine Daten) */
export interface MusterSignale {
  p: number | null;
  pump: number | null;
  absturz: number | null;
  hoch1: number | null;
  tief1: number | null;
  hoch5: number | null;
  tief5: number | null;
  /** pump/absturz stammen vom Früh-Modell */
  frueh: boolean;
}

/** Gradient-Boosting-Modell (Regressionsbäume auf Log-Odds), als JSON speicherbar */
export interface GbdtKnoten {
  /** Blatt: Wert; sonst Merkmal-Index, Schwelle, links (<=) / rechts (>) */
  w?: number;
  m?: number;
  s?: number;
  l?: GbdtKnoten;
  r?: GbdtKnoten;
}
export interface GbdtModell {
  version: number;
  /** E236: 'quadratisch' = Wert-Modell (Regression); fehlt = logistisch (Wahrscheinlichkeit) */
  art?: 'logistisch' | 'quadratisch';
  /** E236: Wert-Modell lernt auf log(1 + x/100) (schiefe Verteilungen) – Vorhersage wird zurückgerechnet */
  skala?: 'log';
  merkmale: string[];
  /** Start-Log-Odds */
  basis: number;
  lernrate: number;
  baeume: GbdtKnoten[];
}

export type RlHandlung = 'warten' | 'kaufen' | 'halb' | 'raus';
/** Tabellarischer Q-Agent: Zustandsschlüssel → Q-Werte je Handlung (Reihenfolge RL_HANDLUNGEN) */
export interface RlModell {
  version: number;
  q: Record<string, number[]>;
}
export const RL_HANDLUNGEN: RlHandlung[] = ['warten', 'kaufen', 'halb', 'raus'];

/** Lage, die der RL-Agent sieht (motor.ts füllt sie, rl.ts macht daraus den Zustandsschlüssel) */
export interface RlLage {
  /** Muster-Wahrscheinlichkeit (0–1) */
  p: number;
  /** E236: 🚀/💥-Wahrscheinlichkeit und erwartetes Hoch/Tief in 5 min (%) – null, wenn nicht aktiv */
  pump?: number | null;
  absturz?: number | null;
  hoch5?: number | null;
  tief5?: number | null;
  /** hält der Bot den Token? */
  haelt: boolean;
  /** Kursänderung seit Einstieg in % (0, wenn nicht gehalten) */
  plusProzent: number;
  /** Haltezeit in s */
  haltSek: number;
  /** Kursänderung der letzten 30 s in % */
  trend30Prozent: number;
}
