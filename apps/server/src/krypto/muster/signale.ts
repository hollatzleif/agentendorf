// E236: alle Signale eines Tokens zu einem Zeitpunkt aus den aktiven Muster-Modellen (reiner Code).
// Früh-Modelle (🚀/💥 nur auf jungen Tokens gelernt) gelten, wenn der Token höchstens FRUEH_ALTER_MS alt ist und das
// jeweilige Früh-Modell da ist; sonst die allgemeinen Pump-/Absturz-Modelle.
// E237: dazu die Kursvorhersage (verlauf, Reihenfolge KRYPTO_VERLAUF_SEK) – der Alarm daraus steht in merkmale.ts (alarmAus).
import { KRYPTO_VERLAUF_SEK, type KryptoMusterSchluessel } from "@dorf/shared";
import { gbdtVorhersagen } from "./gbdt.js";
import { EXTREM_MAX, EXTREM_MIN, merkmale } from "./merkmale.js";
import {
  FRUEH_ALTER_MS,
  type GbdtModell,
  type MusterSignale,
  type Tick,
  type TokenMeta,
} from "./typen.js";

export {
  ALARM_STANDARD,
  alarmAus,
  type AlarmSchwellen,
} from "./merkmale.js";

export type MusterModelle = Partial<Record<KryptoMusterSchluessel, GbdtModell>>;

/** E237: Schlüssel der Kursvorhersage je Horizont (Reihenfolge = KRYPTO_VERLAUF_SEK = MusterSignale.verlauf) */
export const VERLAUF_SCHLUESSEL: KryptoMusterSchluessel[] = KRYPTO_VERLAUF_SEK.map(
  (sek) =>
    (sek < 60 ? `verlauf${sek}s` : `verlauf${sek / 60}m`) as KryptoMusterSchluessel,
);

function vorhersage(
  m: GbdtModell | undefined,
  x: number[],
  wert: boolean,
): number | null {
  // ein Modell mit anderer Merkmalsliste (veraltet) sagt nichts
  if (!m || m.merkmale.length !== x.length) return null;
  const v = gbdtVorhersagen(m, x);
  if (!Number.isFinite(v)) return null;
  return wert
    ? Math.max(EXTREM_MIN, Math.min(EXTREM_MAX, v))
    : Math.max(0, Math.min(1, v));
}

/** Signale aus einem fertigen Merkmals-Vektor (alterMs = Alter des Tokens bei t) – auch fürs RL-Training */
export function signaleAusMerkmalen(
  modelle: MusterModelle,
  x: number[],
  alterMs: number,
): MusterSignale {
  const jung = alterMs <= FRUEH_ALTER_MS;
  const fruehPump = jung ? vorhersage(modelle.fruehPump, x, false) : null;
  const fruehAbsturz = jung
    ? vorhersage(modelle.fruehAbsturz, x, false)
    : null;
  return {
    p: vorhersage(modelle.basis, x, false),
    pump: fruehPump ?? vorhersage(modelle.pump, x, false),
    absturz: fruehAbsturz ?? vorhersage(modelle.absturz, x, false),
    hoch1: vorhersage(modelle.hoch1, x, true),
    tief1: vorhersage(modelle.tief1, x, true),
    hoch5: vorhersage(modelle.hoch5, x, true),
    tief5: vorhersage(modelle.tief5, x, true),
    frueh: fruehPump !== null || fruehAbsturz !== null,
    verlauf: VERLAUF_SCHLUESSEL.map((k) => vorhersage(modelle[k], x, true)),
    // E243: Ertrags-Modell (Meta-Labeling) mit seiner Kaufschwelle
    ertrag: vorhersage(modelle.ertrag, x, false),
    ertragSchwelle: modelle.ertrag?.schwelle ?? null,
    ertragWert: vorhersage(modelle.ertragWert, x, true),
  };
}

/**
 * Signale bei t (übergeben werden NUR aktive Modelle; fehlende Schlüssel → null); null, wenn merkmale() null ist
 * (zu wenig Ticks in den letzten 120 s).
 */
export function musterSignale(
  modelle: MusterModelle,
  ticks: Tick[],
  t: number,
  meta: TokenMeta,
): MusterSignale | null {
  const x = merkmale(ticks, t, meta);
  if (!x) return null;
  return signaleAusMerkmalen(modelle, x, t - meta.erstellt);
}
