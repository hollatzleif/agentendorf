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
}
export const STANDARD_ZIEL: Ziel = { zielProzent: 20, stopProzent: 15, horizontMs: 5 * 60_000 };

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
  /** hält der Bot den Token? */
  haelt: boolean;
  /** Kursänderung seit Einstieg in % (0, wenn nicht gehalten) */
  plusProzent: number;
  /** Haltezeit in s */
  haltSek: number;
  /** Kursänderung der letzten 30 s in % */
  trend30Prozent: number;
}
