// E227: Marktmechanik für das Paper Trading – Bonding Curve von Pump.fun, Pool auf PumpSwap, Gebühren.
//
// Bonding Curve: konstantes Produkt aus virtuellen Reserven. Start 30 SOL / 1 073 000 000 Token – nachgeprüft an echten
// „create“-Ereignissen von PumpPortal (z. B. vSolInBondingCurve 30,0593 × vTokensInBondingCurve 1 070 884 672 ≈ 3,219·10¹⁰).
// Aus einem Kurs (SOL je Token) folgen die Reserven: vSol = √(K·p), vTok = √(K/p).
//
// Gebühren laut pump.fun/docs/fees (abgerufen 24.11.2026): Bonding Curve 1,25 % (Creator 0,30 + Protokoll 0,95);
// PumpSwap (kanonischer Pool, SOL) gestaffelt nach Marktwert in SOL (Kurs × 1 Mrd. Token).

export const START_SOL = 30;
export const START_TOKEN = 1_073_000_000;
export const K = START_SOL * START_TOKEN;
export const ANGEBOT = 1_000_000_000;
/** Solana-Grundgebühr je Signatur (5000 Lamports) */
export const GRUNDGEBUEHR_SOL = 0.000005;

export const GEBUEHR_KURVE = 0.0125;
/** [Marktwert bis (SOL), Gebühr gesamt] – PumpSwap, SOL-Paare */
const PUMPSWAP_STUFEN: [number, number][] = [
  [420, 0.0125],
  [1470, 0.012],
  [2460, 0.0115],
  [3440, 0.011],
  [4420, 0.0105],
  [9820, 0.01],
  [14740, 0.0095],
  [19650, 0.009],
  [24560, 0.0085],
  [29470, 0.008],
  [34380, 0.0075],
  [39300, 0.007],
  [44210, 0.0065],
  [49120, 0.006],
  [54030, 0.0055],
  [58940, 0.00525],
  [63860, 0.005],
  [68770, 0.00475],
  [73681, 0.0045],
  [78590, 0.00425],
  [83500, 0.004],
  [88400, 0.00375],
  [93330, 0.0035],
  [98240, 0.00325],
];

export function gebuehrSatz(markt: 'kurve' | 'pool', marktwertSol: number): number {
  if (markt === 'kurve') return GEBUEHR_KURVE;
  for (const [bis, satz] of PUMPSWAP_STUFEN) if (marktwertSol < bis) return satz;
  return 0.003;
}

/** Zustand eines Marktes zum Zeitpunkt der Ausführung */
export interface Markt {
  art: 'kurve' | 'pool';
  /** Reserven: SOL und Token (Kurve: virtuell; Pool: echt) */
  sol: number;
  token: number;
}

export function kurveAusKurs(preisSol: number): Markt {
  return { art: 'kurve', sol: Math.sqrt(K * preisSol), token: Math.sqrt(K / preisSol) };
}

export function preisVon(m: Markt) {
  return m.sol / m.token;
}

/** SOL, die wirklich in der Kurve liegen (Liquidität) */
export function liquiditaetSol(m: Markt) {
  return m.art === 'kurve' ? Math.max(0, m.sol - START_SOL) : m.sol;
}

export interface Fuellung {
  /** bezahlte bzw. erhaltene SOL (ohne Netzgebühr) */
  sol: number;
  token: number;
  gebuehrSol: number;
  /** Durchschnittskurs (SOL je Token, nach Gebühr) */
  preis: number;
  /** Abweichung des Durchschnittskurses vom Kurs vor dem Trade, in % (positiv = schlechter) */
  slippageProzent: number;
}

/** Kauf für `sol` SOL: Gebühr geht vorab ab, der Rest läuft durch die Kurve bzw. den Pool */
export function kaufen(m: Markt, sol: number): Fuellung {
  const vorher = preisVon(m);
  const satz = gebuehrSatz(m.art, vorher * ANGEBOT);
  const gebuehr = sol * satz;
  const rein = sol - gebuehr;
  const token = m.token - (m.sol * m.token) / (m.sol + rein);
  const preis = sol / token;
  return { sol, token, gebuehrSol: gebuehr, preis, slippageProzent: (preis / vorher - 1) * 100 };
}

/** Verkauf von `token`: SOL aus der Kurve bzw. dem Pool, davon geht die Gebühr ab */
export function verkaufen(m: Markt, token: number): Fuellung {
  const vorher = preisVon(m);
  const satz = gebuehrSatz(m.art, vorher * ANGEBOT);
  const brutto = m.sol - (m.sol * m.token) / (m.token + token);
  const gebuehr = brutto * satz;
  const sol = brutto - gebuehr;
  const preis = sol / token;
  return { sol, token, gebuehrSol: gebuehr, preis, slippageProzent: (1 - preis / vorher) * 100 };
}

/** Wert einer Menge Token, wenn man sie jetzt verkaufte (inkl. Gebühr und Slippage) */
export function verkaufsWert(m: Markt, token: number) {
  return token > 0 ? verkaufen(m, token).sol : 0;
}
