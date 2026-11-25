// E237: Euro neben jedem SOL-Wert im Hafen – SOL→USD vom Kryptowerk (DexScreener), USD→EUR vom Dorf (EZB-Referenzkurs).
// Kurse je Token (SOL je Token) werden nie umgerechnet, nur Beträge in SOL.
import { createContext, useContext } from 'react';

/** Euro je SOL aus SOL→USD und USD je Euro – null, wenn einer fehlt */
export function eurJeSolAus(solUsd: number | null | undefined, usdJeEur: number | null | undefined): number | null {
  if (!solUsd || !usdJeEur || !Number.isFinite(solUsd) || !Number.isFinite(usdJeEur) || solUsd <= 0 || usdJeEur <= 0) return null;
  return solUsd / usdJeEur;
}

/** Euro-Wert eines SOL-Betrags – null ohne Kurs */
export function eurAusSol(sol: number | null | undefined, solUsd: number | null | undefined, usdJeEur: number | null | undefined): number | null {
  const k = eurJeSolAus(solUsd, usdJeEur);
  return sol == null || !Number.isFinite(sol) || k == null ? null : sol * k;
}

/** „61,20 €“ bzw. mit Vorzeichen „+14,70 €“ / „−3,10 €“; Kleinstbeträge „< 0,01 €“ */
export function eurText(eur: number, vorzeichen = false): string {
  const a = Math.abs(eur);
  const vz = vorzeichen ? (eur >= 0 ? '+' : '−') : eur < 0 ? '−' : '';
  if (a > 0 && a < 0.005) return `${vorzeichen ? vz : ''}< 0,01 €`;
  return `${vz}${a.toLocaleString('de-DE', { minimumFractionDigits: a >= 1000 ? 0 : 2, maximumFractionDigits: a >= 1000 ? 0 : 2 })} €`;
}

/** „ (≈ 61,20 €)“ zum Anhängen an einen SOL-Text – leer ohne Kurs */
export function eurZusatz(sol: number | null | undefined, eurJeSol: number | null, vorzeichen = false): string {
  if (sol == null || !Number.isFinite(sol) || eurJeSol == null) return '';
  return ` (≈ ${eurText(sol * eurJeSol, vorzeichen)})`;
}

/** „0,500 SOL (≈ 61,20 €)“ bzw. „+0,12 SOL (≈ +14,70 €)“ – ohne Kurs nur SOL */
export function solEurText(sol: number | null | undefined, eurJeSol: number | null, o: { stellen?: number; vorzeichen?: boolean } = {}): string {
  if (sol == null || !Number.isFinite(sol)) return '–';
  const stellen = o.stellen ?? 3;
  const a = Math.abs(sol).toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen });
  const s = o.vorzeichen ? `${sol >= 0 ? '+' : '−'}${a}` : `${sol < 0 ? '−' : ''}${a}`;
  return `${s} SOL${eurZusatz(sol, eurJeSol, o.vorzeichen)}`;
}

/** „1 SOL ≈ 123,45 €“ */
export function kursText(eurJeSol: number): string {
  return `1 SOL ≈ ${eurText(eurJeSol)}`;
}
export const KURS_QUELLE = 'SOL in US-Dollar von DexScreener, US-Dollar in Euro nach dem EZB-Referenzkurs – Euro-Werte sind nur ungefähr';

/** Euro je SOL für alle Hafen-Komponenten darunter (Flotte: aus der Übersicht, Terminal: aus dem Terminal) */
export const EuroKurs = createContext<number | null>(null);
export const useEurJeSol = () => useContext(EuroKurs);

/** dezenter Euro-Zusatz hinter einem SOL-Betrag: „ (≈ 61,20 €)“ – nichts ohne Kurs */
export function Eur({ sol, vz = false }: { sol: number | null | undefined; vz?: boolean }) {
  const k = useEurJeSol();
  const z = eurZusatz(sol, k, vz);
  return z ? <span className="hafen-eur">{z}</span> : null;
}
