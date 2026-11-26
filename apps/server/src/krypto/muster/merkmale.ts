// E235: Merkmale aus den Ticks der letzten 2 min (die „Augen“ des Muster-Modells) und das Label „erst +Ziel, dann −Stop“.
// Reiner Code: nur die übergebenen Ticks, nur Ticks mit zeit <= t (keine Zukunftsdaten in den Merkmalen).
// E236: dazu Früh-Merkmale „seit Start“ (für junge Tokens), größter Einzelkauf/-verkauf, Label in beide Richtungen,
// Hoch/Tief im Horizont (extreme) und der Rat aus allen Signalen.
// E237: Kursänderung nach h Sekunden (rendite – Label der Kursvorhersage) und der Alarm (alarmAus) für alle Bots.
import { KRYPTO_STANDARD, KRYPTO_VERLAUF_SEK, type KryptoEinstellung } from "@dorf/shared";
import { GRUNDGEBUEHR_SOL, kaufen, kurveAusKurs, verkaufen } from "../kurve.js";
import type { MusterSignale, Tick, TokenMeta, Ziel } from "./typen.js";

const FENSTER_MS = 120_000;
/** E236: „seit Start“ = seit dem ersten Tick, höchstens die letzten 10 min – so viel hält das Kryptowerk live je Token
 *  (motor.ts musterTicks); im Training gilt dieselbe Grenze, sonst sähe das Modell dort mehr als im Betrieb. */
export const LANG_FENSTER_MS = 600_000;
const KERZE_MS = 5_000;
const KERZEN = FENSTER_MS / KERZE_MS;

export const MERKMAL_NAMEN: string[] = [
  "rendite5s",
  "rendite15s",
  "rendite30s",
  "rendite60s",
  "rendite120s",
  "volatilitaet60s",
  "volatilitaet120s",
  "koerper1",
  "koerper2",
  "koerper3",
  "oberDocht1",
  "oberDocht2",
  "oberDocht3",
  "unterDocht1",
  "grueneFolge",
  "kaeufe30s",
  "verkaeufe30s",
  "nettoSol30s",
  "kaeufe60s",
  "verkaeufe60s",
  "nettoSol60s",
  "tickrate60s",
  "echtSol",
  "echtSolAenderung60s",
  "abstandHoch120s",
  "alterSek",
  "devTokens24h",
  // E236: Früh-Merkmale (seit dem ersten Tick, höchstens 10 min) und Einzel-Trades
  "kaeufeSeitStart",
  "verkaeufeSeitStart",
  "nettoSolSeitStart",
  "renditeSeitStart",
  "hoechsteRenditeSeitStart",
  "sekSeitErstemTick",
  "groessterKauf30s",
  "groessterVerkauf30s",
  // E244: Hype-Signale (boost: log(1 + Menge), 0 = keiner; Links/Smart: −1 = bei t noch nicht bekannt)
  "boost",
  "socialsAnzahl",
  "smartKaeufer",
];

/** Index des letzten Ticks mit zeit <= t (−1, wenn keiner) – binäre Suche, Ticks aufsteigend nach zeit */
export function letzterIndex(ticks: Tick[], t: number): number {
  let lo = 0;
  let hi = ticks.length - 1;
  let erg = -1;
  while (lo <= hi) {
    const mitte = (lo + hi) >> 1;
    if (ticks[mitte]!.zeit <= t) {
      erg = mitte;
      lo = mitte + 1;
    } else hi = mitte - 1;
  }
  return erg;
}

function endlich(x: number) {
  return Number.isFinite(x) ? x : 0;
}

function prozent(a: number, b: number) {
  return b > 0 ? (a / b - 1) * 100 : 0;
}

/** Merkmale bei t (Reihenfolge = MERKMAL_NAMEN); null, wenn weniger als 3 Ticks in den letzten 120 s */
export function merkmale(
  ticks: Tick[],
  t: number,
  meta: TokenMeta,
): number[] | null {
  const iT = letzterIndex(ticks, t);
  if (iT < 0) return null;
  const iStart = letzterIndex(ticks, t - FENSTER_MS) + 1;
  if (iT - iStart + 1 < 3) return null;
  const jetzt = ticks[iT]!;
  const preis = jetzt.preis;
  // Kurs zu einem früheren Zeitpunkt: letzter Tick davor; vor dem ersten Tick gilt der erste
  const preisBei = (x: number) => {
    const j = letzterIndex(ticks, x);
    return (j >= 0 ? ticks[j]! : ticks[0]!).preis;
  };
  const echtSolBei = (x: number) => {
    const j = letzterIndex(ticks, x);
    return (j >= 0 ? ticks[j]! : ticks[0]!).echtSol;
  };

  const renditen = [5, 15, 30, 60, 120].map((s) =>
    prozent(preis, preisBei(t - s * 1000)),
  );

  const vol = (ab: number) => {
    const werte: number[] = [];
    for (let i = Math.max(iStart, 1); i <= iT; i++) {
      const a = ticks[i - 1]!;
      const b = ticks[i]!;
      if (b.zeit <= ab || a.preis <= 0 || b.preis <= 0) continue;
      werte.push(Math.log(b.preis / a.preis) * 100);
    }
    if (werte.length < 2) return 0;
    const m = werte.reduce((s, w) => s + w, 0) / werte.length;
    return Math.sqrt(
      werte.reduce((s, w) => s + (w - m) ** 2, 0) / (werte.length - 1),
    );
  };

  // 5-s-Kerzen: k = 0 ist die jüngste und deckt (t − 5 s, t] ab
  const hoch = new Array<number>(KERZEN).fill(-Infinity);
  const tief = new Array<number>(KERZEN).fill(Infinity);
  const schluss = new Array<number | null>(KERZEN).fill(null);
  let kaeufe30 = 0;
  let verkaeufe30 = 0;
  let netto30 = 0;
  let kaeufe60 = 0;
  let verkaeufe60 = 0;
  let netto60 = 0;
  let ticks60 = 0;
  let hoechster = 0;
  let groessterKauf30 = 0;
  let groessterVerkauf30 = 0;
  for (let i = iStart; i <= iT; i++) {
    const k = ticks[i]!;
    const idx = Math.min(KERZEN - 1, Math.floor((t - k.zeit) / KERZE_MS));
    hoch[idx] = Math.max(hoch[idx]!, k.preis);
    tief[idx] = Math.min(tief[idx]!, k.preis);
    schluss[idx] = k.preis;
    if (k.preis > hoechster) hoechster = k.preis;
    if (k.zeit > t - 60_000) {
      ticks60++;
      if (k.sol > 0) kaeufe60++;
      else if (k.sol < 0) verkaeufe60++;
      netto60 += k.sol;
      if (k.zeit > t - 30_000) {
        if (k.sol > 0) kaeufe30++;
        else if (k.sol < 0) verkaeufe30++;
        netto30 += k.sol;
        if (k.sol > groessterKauf30) groessterKauf30 = k.sol;
        if (-k.sol > groessterVerkauf30) groessterVerkauf30 = -k.sol;
      }
    }
  }
  const auf = new Array<number>(KERZEN);
  const zu = new Array<number>(KERZEN);
  let vorher = preisBei(t - FENSTER_MS);
  for (let k = KERZEN - 1; k >= 0; k--) {
    auf[k] = vorher;
    zu[k] = schluss[k] ?? vorher;
    hoch[k] = Math.max(hoch[k]!, auf[k]!, zu[k]!);
    tief[k] = Math.min(tief[k]!, auf[k]!, zu[k]!);
    vorher = zu[k]!;
  }
  const koerper = (k: number) => prozent(zu[k]!, auf[k]!);
  const oberDocht = (k: number) => prozent(hoch[k]!, Math.max(auf[k]!, zu[k]!));
  const unterDocht = (k: number) => {
    const basis = Math.min(auf[k]!, zu[k]!);
    return basis > 0 ? (1 - tief[k]! / basis) * 100 : 0;
  };
  let gruen = 0;
  for (let k = 0; k < KERZEN && zu[k]! > auf[k]!; k++) gruen++;

  // E236: seit dem ersten Tick (höchstens LANG_FENSTER_MS zurück, Grenze wie live: zeit > t − 10 min)
  const iLang = letzterIndex(ticks, t - LANG_FENSTER_MS) + 1;
  const erster = ticks[iLang]!;
  let kaeufeStart = 0;
  let verkaeufeStart = 0;
  let nettoStart = 0;
  let hoechsterStart = 0;
  for (let i = iLang; i <= iT; i++) {
    const k = ticks[i]!;
    if (k.sol > 0) kaeufeStart++;
    else if (k.sol < 0) verkaeufeStart++;
    nettoStart += k.sol;
    if (k.preis > hoechsterStart) hoechsterStart = k.preis;
  }

  const roh = [
    ...renditen,
    vol(t - 60_000),
    vol(t - FENSTER_MS),
    koerper(0),
    koerper(1),
    koerper(2),
    oberDocht(0),
    oberDocht(1),
    oberDocht(2),
    unterDocht(0),
    gruen,
    kaeufe30,
    verkaeufe30,
    netto30,
    kaeufe60,
    verkaeufe60,
    netto60,
    ticks60,
    jetzt.echtSol,
    jetzt.echtSol - echtSolBei(t - 60_000),
    prozent(preis, hoechster),
    (t - meta.erstellt) / 1000,
    meta.devTokens24h ?? -1,
    kaeufeStart,
    verkaeufeStart,
    nettoStart,
    prozent(preis, erster.preis),
    prozent(hoechsterStart, erster.preis),
    (t - erster.zeit) / 1000,
    groessterKauf30,
    groessterVerkauf30,
    meta.boostZeit != null && t >= meta.boostZeit ? Math.log1p(meta.boost ?? 0) : 0,
    meta.linksZeit != null && t >= meta.linksZeit ? (meta.links?.length ?? 0) : -1,
    meta.smartZeit != null && t >= meta.smartZeit ? (meta.smartKaeufer ?? 0) : -1,
  ];
  return roh.map(endlich);
}

/**
 * Label bei t: 1, wenn der Kurs danach (bis t + horizont) zuerst +zielProzent erreicht; 0, wenn zuerst −stopProzent oder
 * der Horizont ohne Ziel vergeht (E236, richtung 'ab': 1, wenn zuerst −zielProzent; 0, wenn zuerst +stopProzent oder der
 * Horizont ohne Absturz vergeht); null, wenn die Aufzeichnung den Horizont nicht abdeckt (kein Tick bei/nach t + horizont) –
 * auch dann, wenn Ziel oder Stop schon vorher erreicht wären (sonst Auswahlverzerrung am Ende der Aufzeichnung).
 */
export function label(ticks: Tick[], t: number, ziel: Ziel): 0 | 1 | null {
  const i = letzterIndex(ticks, t);
  if (i < 0) return null;
  const p0 = ticks[i]!.preis;
  if (!(p0 > 0)) return null;
  const ab = ziel.richtung === "ab";
  const oben = p0 * (1 + (ab ? ziel.stopProzent : ziel.zielProzent) / 100);
  const unten = p0 * (1 - (ab ? ziel.zielProzent : ziel.stopProzent) / 100);
  const ende = t + ziel.horizontMs;
  // erst prüfen, ob die Aufzeichnung den Horizont abdeckt: sonst kämen am Ende nur „schnell entschiedene“ Fälle durch
  // (Auswahlverzerrung – das Modell lernte „kurz vor dem Ende steigt es oft“)
  if (ticks[ticks.length - 1]!.zeit < ende) return null;
  for (let j = i + 1; j < ticks.length; j++) {
    const k = ticks[j]!;
    if (k.zeit > ende) return 0;
    if (k.preis >= oben) return ab ? 0 : 1;
    if (k.preis <= unten) return ab ? 1 : 0;
  }
  return 0;
}

/** E236: Grenzen für Hoch/Tief in % (Kurs kann nicht unter −100 %; Ausreißer über +500 % kappen) */
export const EXTREM_MIN = -95;
export const EXTREM_MAX = 500;

/**
 * E236: höchster und tiefster Kurs in (t, t + horizont] gegenüber dem Kurs bei t, in % (tief ≤ 0 ≤ hoch, der Kurs bei t
 * zählt mit), begrenzt auf [EXTREM_MIN, EXTREM_MAX]; null, wenn die Aufzeichnung den Horizont nicht abdeckt (wie label).
 */
export function extreme(
  ticks: Tick[],
  t: number,
  horizontMs: number,
): { hoch: number; tief: number } | null {
  const i = letzterIndex(ticks, t);
  if (i < 0) return null;
  const p0 = ticks[i]!.preis;
  if (!(p0 > 0)) return null;
  const ende = t + horizontMs;
  if (ticks[ticks.length - 1]!.zeit < ende) return null;
  let hoch = p0;
  let tief = p0;
  for (let j = i + 1; j < ticks.length; j++) {
    const k = ticks[j]!;
    if (k.zeit > ende) break;
    if (!(k.preis > 0)) continue;
    if (k.preis > hoch) hoch = k.preis;
    if (k.preis < tief) tief = k.preis;
  }
  const begrenzt = (x: number) =>
    Math.max(EXTREM_MIN, Math.min(EXTREM_MAX, endlich(x)));
  return { hoch: begrenzt(prozent(hoch, p0)), tief: begrenzt(prozent(tief, p0)) };
}

/**
 * E237: Kursänderung in % vom Kurs bei t (letzter Tick ≤ t) zum Kurs nach horizontMs (letzter Tick ≤ t + horizont),
 * begrenzt auf [EXTREM_MIN, EXTREM_MAX]; null, wenn die Aufzeichnung t + horizont nicht abdeckt (wie label/extreme).
 */
export function rendite(
  ticks: Tick[],
  t: number,
  horizontMs: number,
): number | null {
  const i = letzterIndex(ticks, t);
  if (i < 0) return null;
  const p0 = ticks[i]!.preis;
  if (!(p0 > 0)) return null;
  const ende = t + horizontMs;
  if (ticks[ticks.length - 1]!.zeit < ende) return null;
  const p1 = ticks[letzterIndex(ticks, ende)]!.preis;
  if (!(p1 > 0)) return EXTREM_MIN;
  return Math.max(EXTREM_MIN, Math.min(EXTREM_MAX, endlich(prozent(p1, p0))));
}

/** E237: Alarm-Schwellen (Standard wie KRYPTO_STANDARD.regeln.alarm) */
export interface AlarmSchwellen {
  anstiegProzent: number;
  fallProzent: number;
}
export const ALARM_STANDARD: AlarmSchwellen = { anstiegProzent: 15, fallProzent: 10 };
/** E237: Alarm schaut nur auf die Kursvorhersage bis 2 min (Indizes in KRYPTO_VERLAUF_SEK) */
const ALARM_BIS_SEK = 120;
/** E237: Pump-/Absturz-Erkenner lösen ab dieser Wahrscheinlichkeit aus */
export const ALARM_PUMP = 0.4;
export const ALARM_ABSTURZ = 0.6;

/**
 * E237: Alarm aus den Signalen (null-Werte = Modell nicht aktiv, zählen nicht). Absturz hat Vorrang:
 * 'absturz', wenn die Kursvorhersage bis 2 min irgendwo ≤ −fallProzent liegt oder 💥 ≥ 0,6;
 * sonst 'anstieg', wenn sie irgendwo ≥ +anstiegProzent liegt oder 🚀 ≥ 0,4; sonst null.
 */
export function alarmAus(
  s: MusterSignale,
  a: AlarmSchwellen = ALARM_STANDARD,
): "anstieg" | "absturz" | null {
  let min = Infinity;
  let max = -Infinity;
  const v = s.verlauf ?? [];
  KRYPTO_VERLAUF_SEK.forEach((sek, i) => {
    const x = v[i];
    if (sek > ALARM_BIS_SEK || x == null || !Number.isFinite(x)) return;
    if (x < min) min = x;
    if (x > max) max = x;
  });
  if (min <= -a.fallProzent || (s.absturz != null && s.absturz >= ALARM_ABSTURZ))
    return "absturz";
  if (max >= a.anstiegProzent || (s.pump != null && s.pump >= ALARM_PUMP))
    return "anstieg";
  return null;
}

/**
 * E236: Rat aus allen Signalen (null = Modell nicht aktiv):
 * kaufen – nicht gehalten und (p ≥ 0,6 oder 🚀 ≥ 0,3) und kein 💥 ≥ 0,35;
 * raus – gehalten und (💥 ≥ 0,5 oder p < 0,3); sonst halten.
 * E237: Alarm geht vor – 'absturz': gehalten → raus, sonst nie kaufen; 'anstieg' → kaufen (wenn nicht gehalten).
 */
export function ratAus(
  s: MusterSignale,
  haelt: boolean,
  a: AlarmSchwellen = ALARM_STANDARD,
): "kaufen" | "halten" | "raus" {
  const alarm = alarmAus(s, a);
  if (haelt)
    return alarm === "absturz" ||
      (s.absturz != null && s.absturz >= 0.5) ||
      (s.p != null && s.p < 0.3)
      ? "raus"
      : "halten";
  if (alarm === "absturz") return "halten";
  if (alarm === "anstieg") return "kaufen";
  const auf = (s.p != null && s.p >= 0.6) || (s.pump != null && s.pump >= 0.3);
  const sicher = s.absturz == null || s.absturz < 0.35;
  return auf && sicher ? "kaufen" : "halten";
}

/** E242: Absturz-Erkenner ab hier → Muster-Schicht kauft nicht */
export const SCHICHT_ABSTURZ_SPERRE = 0.35;
/** E242: Absturz-Erkenner ab hier → Muster-Schicht verkauft (wie ABSTURZ_RAUS im Kryptowerk) */
export const SCHICHT_ABSTURZ_RAUS = 0.7;

const vorhersage = (s: MusterSignale, sek: number): number | null => {
  const x = s.verlauf?.[KRYPTO_VERLAUF_SEK.indexOf(sek as (typeof KRYPTO_VERLAUF_SEK)[number])];
  return x != null && Number.isFinite(x) ? x : null;
};
const pzt = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1).replace(".", ",")} %`;

/**
 * E242: Urteil der Muster-Schicht über einen Token (nur aktive Modelle zählen; fehlt ein Modell, entscheidet es nichts):
 * - fall: Grund, warum NICHT gekauft wird – 💥-Alarm, Absturz ≥ 35 % oder Vorhersage 1/2/5 min ≤ −fallProzent
 * - steigt: die Vorhersage auf lange Sicht (2/5 min, die weiteste vorhandene) liegt über 0 – Bedingung für den 🚀-Zusatzkauf
 * - raus: Grund für einen früheren Verkauf – 💥-Alarm, Absturz ≥ 70 %, oder kurz (30 s/1 min) ≤ −fallProzent und lang nicht > 0
 */
export function schichtUrteil(
  s: MusterSignale,
  fallProzent: number,
  a: AlarmSchwellen = ALARM_STANDARD,
): { fall: string | null; steigt: boolean; raus: string | null; kauf: string | null } {
  const alarm = alarmAus(s, a);
  const kurz = [vorhersage(s, 30), vorhersage(s, 60)].filter((x): x is number => x != null);
  const lang = [vorhersage(s, 120), vorhersage(s, 300)].filter((x): x is number => x != null);
  const mittel = [vorhersage(s, 60), vorhersage(s, 120), vorhersage(s, 300)].filter((x): x is number => x != null);
  const langWert = lang.length ? lang[lang.length - 1]! : null;
  let fall: string | null = null;
  if (alarm === "absturz") fall = "💥 Alarm";
  else if (s.absturz != null && s.absturz >= SCHICHT_ABSTURZ_SPERRE)
    fall = `Absturz-Risiko ${Math.round(s.absturz * 100)} %`;
  else if (mittel.length && Math.min(...mittel) <= -fallProzent)
    fall = `Vorhersage ${pzt(Math.min(...mittel))} (≤ −${fallProzent} %)`;
  let raus: string | null = null;
  if (s.absturz != null && s.absturz >= SCHICHT_ABSTURZ_RAUS)
    raus = `Absturz-Risiko ${Math.round(s.absturz * 100)} %`;
  else if (alarm === "absturz") raus = "💥 Alarm";
  else if (kurz.length && Math.min(...kurz) <= -fallProzent && !(langWert != null && langWert > 0))
    raus = `kurz ${pzt(Math.min(...kurz))}, lang ${langWert == null ? "–" : pzt(langWert)}`;
  // E243: Ertrags-Modell ab seiner Kaufschwelle → Zusatzkauf (nur ohne vorhergesagten Fall und ohne negativen erwarteten Ertrag)
  let kauf: string | null = null;
  if (
    !fall &&
    s.ertrag != null &&
    s.ertragSchwelle != null &&
    s.ertrag >= s.ertragSchwelle &&
    !(s.ertragWert != null && s.ertragWert <= 0)
  )
    kauf = `💰 Ertrag ${Math.round(s.ertrag * 100)} % ≥ Schwelle ${Math.round(s.ertragSchwelle * 100)} %${s.ertragWert != null ? ` (erwartet ${pzt(s.ertragWert)})` : ""}`;
  return { fall, steigt: langWert != null && langWert > 0, raus, kauf };
}

/** E243: Ertrags-Label – Einsatz, Verzögerung und Gebühren wie im Paper/RL-Zeitraffer */
export const ERTRAG_EINSATZ_SOL = 0.5;
export const ERTRAG_VERZOEGERUNG_MS = 5_000;
const ERTRAG_PORTAL = 0.005;
const ERTRAG_NETZ_SOL = GRUNDGEBUEHR_SOL + 0.0001;
/** so lange muss die Aufzeichnung nach dem Einstieg mindestens reichen, wenn kein Ausstieg gegriffen hat */
export const ERTRAG_MIN_NACHLAUF_MS = 5 * 60_000;

/**
 * E243: Was hätte ein Kauf bei t gebracht? Netto-Ertrag in % des Einsatzes nach ALLEN Gebühren (Bonding-Curve-Gebühr,
 * Slippage über kaufen()/verkaufen(), PumpPortal 0,5 % je Seite, Netzgebühr) mit den Ausstiegsregeln `ausstieg`
 * (Standard = KRYPTO_STANDARD: TP-Stufen, Stop-Loss, Trailing, Haltedauer – Reihenfolge wie positionenPflegen im Kryptowerk).
 * Entscheidung bei t → Kauf zum Kurs bei t + 5 s; jeder Verkauf zum Kurs 5 s nach dem auslösenden Tick.
 * Greift kein Ausstieg, bevor die Aufzeichnung endet: Verkauf zum letzten Kurs, wenn sie mindestens 5 min nach dem Einstieg
 * reicht (ein Token, mit dem niemand mehr handelt, bleibt auf diesem Kurs stehen), sonst null (Ausgang unbekannt).
 */
export function ertragLabel(
  ticks: Tick[],
  t: number,
  ausstieg: KryptoEinstellung["ausstieg"] = KRYPTO_STANDARD.ausstieg,
): number | null {
  const kursBei = (zeit: number) => {
    const i = letzterIndex(ticks, zeit);
    return i < 0 ? null : ticks[i]!.preis;
  };
  const start = t + ERTRAG_VERZOEGERUNG_MS;
  const letzte = ticks[ticks.length - 1];
  if (!letzte || letzte.zeit < start) return null;
  const p0 = kursBei(start);
  if (!(p0 != null && p0 > 0)) return null;
  const f = kaufen(kurveAusKurs(p0), ERTRAG_EINSATZ_SOL, ERTRAG_PORTAL);
  const kosten = ERTRAG_EINSATZ_SOL + ERTRAG_NETZ_SOL;
  const tokenGesamt = f.token;
  let rest = f.token;
  let erloes = 0;
  let stufe = 0;
  let hoechst = p0;
  const verkauf = (menge: number, ausloeser: number) => {
    const px = kursBei(ausloeser + ERTRAG_VERZOEGERUNG_MS) ?? p0;
    const v = verkaufen(kurveAusKurs(px > 0 ? px : p0 * 1e-6), menge, ERTRAG_PORTAL);
    erloes += Math.max(0, v.sol - ERTRAG_NETZ_SOL);
    rest -= menge;
  };
  let j = letzterIndex(ticks, start) + 1;
  for (; j < ticks.length && rest > 1e-9; j++) {
    const k = ticks[j]!;
    const kurs = k.preis;
    if (!(kurs > 0)) continue;
    if (kurs > hoechst) hoechst = kurs;
    const plus = (kurs / p0 - 1) * 100;
    if (plus <= -ausstieg.stopLossProzent) verkauf(rest, k.zeit);
    else if (ausstieg.trailingProzent > 0 && hoechst > p0 && kurs <= hoechst * (1 - ausstieg.trailingProzent / 100)) verkauf(rest, k.zeit);
    else if (k.zeit - start >= ausstieg.maxHaltMinuten * 60_000) verkauf(rest, k.zeit);
    else {
      const tp = ausstieg.takeProfit[stufe];
      if (tp && plus >= tp.beiProzent) {
        const letzteStufe = stufe === ausstieg.takeProfit.length - 1;
        stufe++;
        verkauf(letzteStufe ? rest : Math.min(rest, (tokenGesamt * tp.verkaufProzent) / 100), k.zeit);
      }
    }
  }
  if (rest > 1e-9) {
    if (letzte.zeit - start < ERTRAG_MIN_NACHLAUF_MS) return null;
    verkauf(rest, letzte.zeit);
  }
  return Math.max(EXTREM_MIN, Math.min(EXTREM_MAX, ((erloes - kosten) / kosten) * 100));
}
