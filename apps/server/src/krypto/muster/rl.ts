// E235: RL-Agent (die „Hände“) – tabellarisches Q-Learning über diskretisierte Lagen, Training im Zeitraffer über
// aufgezeichnete Ticks mit derselben Marktmechanik wie Paper (kurve.ts).
//
// Simulation (bewusst wie Paper, siehe motor.ts): Entscheidung bei Schritt i, ausgeführt zum Kurs des NÄCHSTEN Schritts
// (5 s Verzögerung, nie zum gesehenen Kurs), Bonding-Curve-Gebühr 1,25 % + eigene Slippage über kaufen()/verkaufen(),
// PumpPortal 0,5 % je Seite, Netzgebühr je Transaktion. Einsatz fest 0,5 SOL je Kauf, Startkapital 10 SOL;
// fällt das Kapital ohne Position unter den Einsatz → Pleite: Strafe −2 (nur Lernsignal) und Nachschuss 10 SOL
// (zählt nie als Gewinn). Belohnung = realisierter Gewinn in SOL beim (Teil-)Verkauf.
//
// E236: Der Agent sieht auch 🚀 Pump, 💥 Absturz und das erwartete Hoch/Tief in 5 min (grob gestuft, nur wenn das jeweilige
// Modell aktiv ist – sonst bleibt der Zustandsschlüssel wie in E235, alte Q-Tabellen gelten weiter). Harte Sicherungen im
// Code: kein Kauf ab 💥 ≥ maxAbsturz (Standard 0,35); gehalten und 💥 ≥ 0,7 → nur noch „raus“. Kauf mit p ≥ minSicherheit
// oder 🚀 ≥ 0,3 (dann auch ohne aktives Grundsignal – p ist dann 0).
//
// E237: Die Kursvorhersage ist sein Auge: v1m/v5m (erwartete Kursänderung in 1 und 5 min) grob in Stufen im Zustand –
// nur, wenn eines davon aktiv ist (sonst bleibt der Schlüssel wie bisher). Die Belohnung bleibt der echte Gewinn nach
// Gebühren (er soll Geld lernen, nicht Vorhersagen). Harte Sicherung: Alarm 'absturz' → ohne Position nie kaufen,
// gehalten nur noch raus; Alarm 'anstieg' erlaubt den Kauf auch ohne p ≥ minSicherheit (💥-Sperre gilt weiter).
//
// E243 (Reparatur): Der Agent hatte gelernt, nie zu kaufen – jeder zufällige Einstieg kostet Gebühren, „warten“ bringt immer
// 0. Jetzt entscheidet er NUR noch über den Ausstieg (halten / halb / raus – dort gibt es dichte Rückmeldung). Den Einstieg
// bestimmt eine Regel: ist das Ertrags-Modell aktiv, kauft er ab dessen Kaufschwelle (Meta-Labeling: „lohnt sich der Kauf
// nach Gebühren?“), sonst wie bisher (p ≥ minSicherheit, 🚀 ≥ 0,3 oder Alarm 'anstieg'); 💥-Sperren gelten immer.
// Im Training kauft er bei jedem erlaubten Zeitpunkt (viele Einstiege → viel Ausstiegs-Übung), im Zeitraffer und live
// nur nach der Regel mit den Grenzen des Bots.
//
// E246: Ohne aktives Ertrags-Modell kaufte er wieder nie – p ≥ 0,6 und 🚀 ≥ 0,3 sind fest gewählte Grenzen, die das Modell
// praktisch nie erreicht (Zeitraffer v27: 0 Trades). Jetzt lernt das Training die Einstiegs-Regel selbst: Signal und Schwelle
// („kaufen, wenn 📈 Kurs in 1 min ≥ 4 %“), gewählt im Zeitraffer auf der ersten Hälfte der Testdaten mit dem gelernten Ausstieg,
// geprüft auf der zweiten (rlEinstiegWaehlen). Sie steht im Modell (RlModell.einstieg) und gilt im Zeitraffer und live;
// minSicherheit/🚀 ≥ 0,3 bleiben nur Rückfall (Modell ohne Regel oder Signal gerade nicht da). 💥-Sperren gelten immer.
import {
  KRYPTO_RL_EINSTIEG_NAMEN,
  type KryptoRlEinstieg,
  type KryptoRlEinstiegSignal,
  type KryptoRlGrenzen,
} from "@dorf/shared";
import { GRUNDGEBUEHR_SOL, kaufen, kurveAusKurs, verkaufen } from "../kurve.js";
import { takt } from "./gbdt.js";
import { ALARM_STANDARD } from "./merkmale.js";
import {
  RL_HANDLUNGEN,
  type RlHandlung,
  type RlLage,
  type RlModell,
} from "./typen.js";

export const RL_EINSATZ_SOL = 0.5;
export const RL_STARTKAPITAL_SOL = 10;
export const RL_PLEITE_STRAFE = -2;
export const RL_PORTAL_SATZ = 0.005;
/** Netzgebühr je Transaktion (Grundgebühr + Priorität wie im Paper-Standard grob) */
export const RL_NETZ_SOL = GRUNDGEBUEHR_SOL + 0.0001;

export const RL_GAMMA = 0.99;
const GAMMA = RL_GAMMA;
export const RL_ALPHA = 0.1;
const ALPHA = RL_ALPHA;
/** E236: Kauf auch ohne Grundsignal, wenn der Pump-Erkenner so viel sieht */
export const RL_PUMP_KAUF = 0.3;
/** E236: gehalten und Absturz-Erkenner ≥ so viel → nur noch raus (harte Sicherung) */
export const RL_ABSTURZ_RAUS = 0.7;
const MAX_ABSTURZ_STANDARD = 0.35;

export type RlAlarm = "anstieg" | "absturz" | null;
/** E237: Lage mit Alarm – motor.ts gibt alarmAus(Signale, regeln.alarm) mit (das Training ebenso); fehlt das Feld
 *  (undefined), leitet rl.ts ihn nur aus v1m ab (≤ −10 % → absturz, ≥ +15 % → anstieg) – 🚀/💥 wirken dann wie in E236 */
export type RlLageMitAlarm = RlLage & { alarm?: RlAlarm };

function stufeVon(x: number, grenzen: number[]) {
  let i = 0;
  while (i < grenzen.length && x >= grenzen[i]!) i++;
  return i;
}

const zahlOderNull = (x: number | null | undefined) =>
  x != null && Number.isFinite(x) ? x : null;

/** Wahrscheinlichkeit in 4 Stufen: n (nicht aktiv), < 0,15, < 0,35, ≥ 0,35 */
function wStufe(x: number | null | undefined): string {
  const v = zahlOderNull(x);
  return v === null ? "n" : String(stufeVon(v, [0.15, 0.35]));
}

/** E237: Kursvorhersage in 4 Stufen: n (nicht aktiv), < −5 %, −5 … +10 %, > +10 % */
function verlaufStufe(x: number | null | undefined): string {
  const v = zahlOderNull(x);
  return v === null ? "n" : v < -5 ? "0" : v <= 10 ? "1" : "2";
}

/** E237: Alarm der Lage (ausdrücklich übergeben oder grob abgeleitet) */
export function rlAlarm(l: RlLageMitAlarm): RlAlarm {
  if (l.alarm !== undefined) return l.alarm;
  const v1m = zahlOderNull(l.v1m);
  if (v1m !== null && v1m <= -ALARM_STANDARD.fallProzent) return "absturz";
  if (v1m !== null && v1m >= ALARM_STANDARD.anstiegProzent) return "anstieg";
  return null;
}

/** Hoch/Tief grob in 3 Stufen (n = nicht aktiv): Hoch < 10 / < 30 / ≥ 30 %, Tief > −10 / > −25 / ≤ −25 % */
function hochStufe(x: number | null | undefined): string {
  const v = zahlOderNull(x);
  return v === null ? "n" : String(stufeVon(v, [10, 30]));
}
function tiefStufe(x: number | null | undefined): string {
  const v = zahlOderNull(x);
  return v === null ? "n" : String(2 - stufeVon(v, [-25, -10]));
}

/**
 * Zustandsschlüssel: p in 10 Stufen, hält?, Plus-Stufe, Haltezeit-Stufe, Trend-Stufe. E236: dazu – nur wenn mindestens
 * ein Signal aktiv ist – ohne Position Pump/Absturz/Hoch5/Tief5, mit Position Absturz/Hoch5 (Zustandsraum klein halten).
 * E237: dazu – nur wenn v1m oder v5m aktiv ist – die Kursvorhersage in 1/5 min (je 4 Stufen).
 */
export function rlZustand(l: RlLage): string {
  const p = Math.max(
    0,
    Math.min(9, Math.floor((Number.isFinite(l.p) ? l.p : 0) * 10)),
  );
  const trend = stufeVon(l.trend30Prozent, [-5, -1, 1, 5]);
  const signale =
    zahlOderNull(l.pump) !== null ||
    zahlOderNull(l.absturz) !== null ||
    zahlOderNull(l.hoch5) !== null ||
    zahlOderNull(l.tief5) !== null;
  const verlauf =
    zahlOderNull(l.v1m) !== null || zahlOderNull(l.v5m) !== null
      ? `|v${verlaufStufe(l.v1m)}${verlaufStufe(l.v5m)}`
      : "";
  if (!l.haelt) {
    const basis = `w|${p}|${trend}`;
    return (
      (signale
        ? `${basis}|p${wStufe(l.pump)}a${wStufe(l.absturz)}h${hochStufe(l.hoch5)}t${tiefStufe(l.tief5)}`
        : basis) + verlauf
    );
  }
  const plus = stufeVon(l.plusProzent, [-10, 0, 10, 20]);
  const halt = stufeVon(l.haltSek, [30, 60, 120, 300]);
  const basis = `h|${p}|${plus}|${halt}|${trend}`;
  return (
    (signale ? `${basis}|a${wStufe(l.absturz)}h${hochStufe(l.hoch5)}` : basis) +
    verlauf
  );
}

/** E246: Wert des Einstiegs-Signals in der Lage (null = Modell nicht da) */
export function rlEinstiegWert(
  l: Partial<Record<KryptoRlEinstiegSignal, number | null>>,
  signal: KryptoRlEinstiegSignal,
): number | null {
  return zahlOderNull(l[signal]);
}

/** E246: erfüllt die Lage die gelernte Einstiegs-Regel? (null = Signal fehlt → Rückfall auf die alte Regel) */
export function rlEinstiegErfuellt(
  l: RlLage,
  e: KryptoRlEinstieg,
): boolean | null {
  const w = rlEinstiegWert(l, e.signal);
  return w === null ? null : w >= e.schwelle;
}

/** E246: „📈 Kurs in 1 min +5,2 % ≥ +4,0 %“ bzw. „🚀 Pump 31 % ≥ 12 %“ */
export function rlEinstiegText(e: KryptoRlEinstieg, wert?: number | null) {
  const n = KRYPTO_RL_EINSTIEG_NAMEN[e.signal];
  const f = (x: number) =>
    n.prozent
      ? `${x >= 0 ? "+" : ""}${x.toFixed(1).replace(".", ",")} %`
      : `${Math.round(x * 100)} %`;
  return `${n.name} ${wert != null ? `${f(wert)} ` : ""}≥ ${f(e.schwelle)}`;
}

/** E236: Kauf erlaubt? (p ≥ minSicherheit oder 🚀 ≥ 0,3) und nicht 💥 ≥ maxAbsturz;
 *  E237: nie bei Alarm 'absturz', bei Alarm 'anstieg' auch ohne p/🚀; E246: gelernte Einstiegs-Regel vor allem anderen */
function kaufErlaubt(
  l: RlLageMitAlarm,
  g: KryptoRlGrenzen,
  einstieg?: KryptoRlEinstieg | null,
): boolean {
  const alarm = rlAlarm(l);
  if (alarm === "absturz") return false;
  const absturz = zahlOderNull(l.absturz);
  if (absturz !== null && absturz >= (g.maxAbsturz ?? MAX_ABSTURZ_STANDARD))
    return false;
  // Training: minSicherheit 0 → jeder erlaubte Zeitpunkt (viel Ausstiegs-Übung)
  if (g.minSicherheit <= 0) return true;
  if (einstieg) {
    const ok = rlEinstiegErfuellt(l, einstieg);
    if (ok !== null) return ok || alarm === "anstieg";
  }
  // E243: Ertrags-Modell aktiv → nur es entscheidet
  const ertrag = zahlOderNull(l.ertrag);
  const schwelle = zahlOderNull(l.ertragSchwelle);
  if (ertrag !== null && schwelle !== null) return ertrag >= schwelle;
  const pump = zahlOderNull(l.pump);
  return (
    alarm === "anstieg" ||
    l.p >= g.minSicherheit ||
    (pump !== null && pump >= RL_PUMP_KAUF)
  );
}

/** erlaubte Handlungen: ohne Position warten/kaufen (kaufen nur nach kaufErlaubt), mit Position warten/halb/raus –
 *  E236: gehalten und 💥 ≥ 0,7 → nur raus; E237: gehalten und Alarm 'absturz' → nur raus */
export function rlErlaubt(
  l: RlLageMitAlarm,
  g: KryptoRlGrenzen,
  einstieg?: KryptoRlEinstieg | null,
): RlHandlung[] {
  if (l.haelt) {
    const absturz = zahlOderNull(l.absturz);
    if (
      (absturz !== null && absturz >= RL_ABSTURZ_RAUS) ||
      rlAlarm(l) === "absturz"
    )
      return ["raus"];
    return ["warten", "halb", "raus"];
  }
  return kaufErlaubt(l, g, einstieg) ? ["warten", "kaufen"] : ["warten"];
}

/** Regel ohne Q-Werte: kaufen, wenn erlaubt; raus bei 💥 ≥ 0,5, Minus ≥ 10 % oder schwachem Signal (p < 0,3 – ist nur
 *  das Pump-Signal aktiv (p = 0), dann 🚀 < 0,3) */
function regel(l: RlLageMitAlarm, g: KryptoRlGrenzen): RlHandlung {
  if (!l.haelt) return kaufErlaubt(l, g) ? "kaufen" : "warten";
  // (gehalten – die Einstiegs-Regel spielt hier keine Rolle)
  const absturz = zahlOderNull(l.absturz);
  const pump = zahlOderNull(l.pump);
  const schwach =
    l.p < 0.3 && (pump === null || pump < RL_PUMP_KAUF);
  return (absturz !== null && absturz >= 0.5) || schwach || l.plusProzent <= -10
    ? "raus"
    : "warten";
}

export function rlHandlung(
  m: RlModell | null,
  l: RlLageMitAlarm,
  g: KryptoRlGrenzen,
  zufall: () => number,
): RlHandlung {
  const erlaubt = rlErlaubt(l, g, m?.einstieg);
  // E243: Einstieg nach Regel (kein Q-Wert, kein Erkunden) – gelernt wird nur der Ausstieg
  if (!l.haelt) return erlaubt.includes("kaufen") ? "kaufen" : "warten";
  if (g.erkunden > 0 && zufall() < g.erkunden)
    return erlaubt[
      Math.min(erlaubt.length - 1, Math.floor(zufall() * erlaubt.length))
    ]!;
  const q = m?.q[rlZustand(l)];
  if (!q) return regel(l, g);
  let beste = erlaubt[0]!;
  let besterWert = -Infinity;
  for (const a of erlaubt) {
    const w = q[RL_HANDLUNGEN.indexOf(a)] ?? 0;
    if (w > besterWert) {
      besterWert = w;
      beste = a;
    }
  }
  return beste;
}

/** Ein Zeitschritt einer Episode (alle 5 s): Kurs = letzter Tick, p = Muster-Vorhersage (0 ohne aktives Grundsignal);
 *  E236: die übrigen Signale (null/fehlt = Modell nicht aktiv) */
export interface RlSchritt {
  zeit: number;
  /** E238: Token (nur für die Beispiel-Trades der Konsole) */
  mint?: string;
  preis: number;
  p: number;
  trend30Prozent: number;
  pump?: number | null;
  absturz?: number | null;
  hoch5?: number | null;
  tief5?: number | null;
  /** E237: Kursvorhersage 1/5 min (%) und Alarm (null = keiner / Modelle nicht aktiv) */
  v1m?: number | null;
  v5m?: number | null;
  alarm?: RlAlarm;
  /** E243: Ertrags-Modell und seine Kaufschwelle (null = nicht aktiv) */
  ertrag?: number | null;
  ertragSchwelle?: number | null;
}
export type RlEpisode = RlSchritt[];

/** E238: wie und warum der Agent an einer Stelle entschieden hat (für die Trainings-Konsole) */
export interface RlEntscheidung {
  zeit: number;
  /** Ausführungskurs (nächster Schritt) */
  preis: number;
  handlung: RlHandlung;
  lage: RlLageMitAlarm;
  /** q = beste erlaubte Handlung nach Q-Werten; regel = Zustand nie gesehen (Regel ohne Q-Werte); sicherung = nur eine
   *  Handlung erlaubt (harte Sicherung) */
  grund: "q" | "regel" | "sicherung";
  /** Q-Werte der erlaubten Handlungen, beste zuerst (null ohne Q-Werte) */
  q: { handlung: RlHandlung; wert: number }[] | null;
  /** Text der Sicherung (nur grund 'sicherung') */
  sicherung?: string;
  /** E246: Kauf nach der gelernten Einstiegs-Regel (Text) */
  regel?: string;
}
/** E238: ein abgeschlossener Trade aus dem Zeitraffer mit beiden Entscheidungen */
export interface RlTradeBeispiel {
  mint: string;
  kauf: RlEntscheidung;
  /** null = Ende der Aufzeichnung (zum letzten Kurs geschlossen) */
  verkauf: RlEntscheidung | null;
  halbVerkaeufe: number;
  haltSek: number;
  /** Ergebnis nach allen Gebühren (SOL) */
  gewinnSol: number;
  /** E239: Zeitpunkt des Abschlusses */
  ende?: number;
}

/** E238: Entscheidung nachvollziehen (gleiche Logik wie rlHandlung ohne Erkunden) */
export function rlErklaeren(
  m: RlModell | null,
  l: RlLageMitAlarm,
  g: KryptoRlGrenzen,
  handlung: RlHandlung,
  zeit: number,
  preis: number,
): RlEntscheidung {
  const erlaubt = rlErlaubt(l, g, m?.einstieg);
  // E243: Einstiege entscheidet die Regel (Ertrags-Modell bzw. Signale) – keine Q-Werte
  const q = l.haelt ? m?.q[rlZustand(l)] : undefined;
  const werte = q
    ? erlaubt
        .map((a) => ({ handlung: a, wert: q[RL_HANDLUNGEN.indexOf(a)] ?? 0 }))
        .sort((a, b) => b.wert - a.wert)
    : null;
  let sicherung: string | undefined;
  if (l.haelt && erlaubt.length === 1) {
    const absturz = zahlOderNull(l.absturz);
    sicherung =
      absturz !== null && absturz >= RL_ABSTURZ_RAUS
        ? `💥 ${absturz.toFixed(2).replace(".", ",")} ≥ ${String(RL_ABSTURZ_RAUS).replace(".", ",")} → nur raus`
        : "Alarm 💥 → nur raus";
  }
  const regelText =
    !l.haelt && handlung === "kaufen" && m?.einstieg && rlEinstiegErfuellt(l, m.einstieg)
      ? `gelernt: ${rlEinstiegText(m.einstieg, rlEinstiegWert(l, m.einstieg.signal))}`
      : undefined;
  return {
    zeit,
    preis,
    handlung,
    lage: { ...l },
    grund: sicherung ? "sicherung" : werte ? "q" : "regel",
    q: werte,
    ...(sicherung ? { sicherung } : {}),
    ...(regelText ? { regel: regelText } : {}),
  };
}

export interface RlZeitraffer {
  trades: number;
  gewinnSol: number;
  trefferquote: number | null;
  pleiten: number;
  nachschussSol: number;
}

/** deterministischer Zufall (mulberry32) */
export function zufallAus(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Position {
  token: number;
  /** noch nicht verbuchter Einsatz (SOL) */
  einsatz: number;
  einsatzGesamt: number;
  erloes: number;
  einstieg: number;
  seit: number;
  /** E238: nur mit Beobachter */
  kauf?: RlEntscheidung;
  halb: number;
  mint?: string;
}

async function simulieren(
  m: RlModell,
  episoden: RlEpisode[],
  g: KryptoRlGrenzen,
  zufall: () => number,
  lernen: boolean,
  warte: (erzwingen?: boolean) => Promise<void>,
  beobachter?: (t: RlTradeBeispiel) => void,
): Promise<RlZeitraffer> {
  let kapital = RL_STARTKAPITAL_SOL;
  const erg: RlZeitraffer = {
    trades: 0,
    gewinnSol: 0,
    trefferquote: null,
    pleiten: 0,
    nachschussSol: 0,
  };
  let treffer = 0;
  const qVon = (s: string) => (m.q[s] ??= [0, 0, 0, 0]);

  const verkauf = (pos: Position, preis: number, anteil: number) => {
    const menge = anteil >= 1 ? pos.token : pos.token * anteil;
    const f = verkaufen(kurveAusKurs(preis), menge, RL_PORTAL_SATZ);
    const sol = Math.max(0, f.sol - RL_NETZ_SOL);
    const kosten = anteil >= 1 ? pos.einsatz : pos.einsatz * anteil;
    pos.token -= menge;
    pos.einsatz -= kosten;
    pos.erloes += sol;
    kapital += sol;
    return sol - kosten;
  };
  const abschliessen = (
    pos: Position,
    verkauf: RlEntscheidung | null,
    ende: number,
  ) => {
    const g2 = pos.erloes - pos.einsatzGesamt;
    erg.trades++;
    erg.gewinnSol += g2;
    if (g2 > 0) treffer++;
    if (beobachter && pos.kauf)
      beobachter({
        mint: pos.mint ?? "?",
        kauf: pos.kauf,
        verkauf,
        halbVerkaeufe: pos.halb,
        haltSek: Math.max(0, (ende - pos.seit) / 1000),
        gewinnSol: g2,
        ende,
      });
  };
  const pleitePruefen = () => {
    if (kapital >= RL_EINSATZ_SOL) return 0;
    erg.pleiten++;
    if (g.nachschuss) {
      kapital += RL_STARTKAPITAL_SOL;
      erg.nachschussSol += RL_STARTKAPITAL_SOL;
    }
    return RL_PLEITE_STRAFE;
  };

  for (const ep of episoden) {
    let pos: Position | null = null;
    // Übergänge dieser Episode: (Zustand, Handlung, Belohnung, erlaubte Handlungen im Folgezustand)
    const pfad: {
      s: string;
      a: number;
      r: number;
      weiter: string | null;
      erlaubt: number[];
      /** E243: Verkauf schließt den Trade – kein Folgezustand */
      ende?: boolean;
    }[] = [];
    for (let i = 0; i < ep.length; i++) {
      const schritt = ep[i]!;
      const lage: RlLageMitAlarm = {
        p: schritt.p,
        pump: schritt.pump ?? null,
        absturz: schritt.absturz ?? null,
        hoch5: schritt.hoch5 ?? null,
        tief5: schritt.tief5 ?? null,
        v1m: schritt.v1m ?? null,
        v5m: schritt.v5m ?? null,
        ertrag: schritt.ertrag ?? null,
        ertragSchwelle: schritt.ertragSchwelle ?? null,
        // Alarm wie im Training berechnet (fehlt er im Schritt, leitet rlAlarm ihn aus der Lage ab)
        ...(schritt.alarm !== undefined ? { alarm: schritt.alarm } : {}),
        haelt: pos !== null,
        plusProzent: pos ? (schritt.preis / pos.einstieg - 1) * 100 : 0,
        haltSek: pos ? (schritt.zeit - pos.seit) / 1000 : 0,
        trend30Prozent: schritt.trend30Prozent,
      };
      const s = rlZustand(lage);
      // E243: gelernt wird nur in gehaltenen Lagen; nach dem Verkauf ist die Episode für den Trade zu Ende (Folgewert 0)
      if (lernen && lage.haelt) {
        qVon(s);
        const vorher = pfad[pfad.length - 1];
        if (vorher && vorher.weiter === null && !vorher.ende) {
          vorher.weiter = s;
          vorher.erlaubt = rlErlaubt(lage, g).map((a) =>
            RL_HANDLUNGEN.indexOf(a),
          );
        }
      }
      let a = rlHandlung(m, lage, g, zufall);
      // Ausführung zum Kurs des nächsten Schritts (Verzögerung); am Ende der Episode zum letzten Kurs
      const preis = (ep[i + 1] ?? schritt).preis;
      const erklaerung: RlEntscheidung | undefined =
        beobachter && (a === "kaufen" ? !pos : pos && a !== "warten")
          ? rlErklaeren(m, lage, g, a, schritt.zeit, preis)
          : undefined;
      let r = 0;
      if (a === "kaufen" && !pos) {
        if (kapital < RL_EINSATZ_SOL) a = "warten";
        else {
          const f = kaufen(kurveAusKurs(preis), RL_EINSATZ_SOL, RL_PORTAL_SATZ);
          kapital -= RL_EINSATZ_SOL + RL_NETZ_SOL;
          const einsatz = RL_EINSATZ_SOL + RL_NETZ_SOL;
          pos = {
            token: f.token,
            einsatz,
            einsatzGesamt: einsatz,
            erloes: 0,
            einstieg: preis,
            seit: ep[i + 1]?.zeit ?? schritt.zeit,
            halb: 0,
            ...(erklaerung
              ? { kauf: erklaerung, mint: schritt.mint ?? "?" }
              : {}),
          };
        }
      } else if (pos && (a === "raus" || (a === "halb" && pos.einsatz < 0.1))) {
        r += verkauf(pos, preis, 1);
        abschliessen(pos, erklaerung ?? null, ep[i + 1]?.zeit ?? schritt.zeit);
        pos = null;
        r += pleitePruefen();
      } else if (pos && a === "halb") {
        r += verkauf(pos, preis, 0.5);
        pos.halb++;
      }
      // E243: nur Entscheidungen in gehaltenen Lagen lernen (Einstiege macht die Regel)
      if (lernen && lage.haelt)
        pfad.push({
          s,
          a: RL_HANDLUNGEN.indexOf(a),
          r,
          weiter: null,
          erlaubt: [],
          ende: pos === null,
        });
      await warte();
    }
    // Ende der Aufzeichnung: offene Position zum letzten Kurs schließen (Endzustand, ohne Ausblick)
    const letzter = ep[ep.length - 1];
    if (pos && letzter) {
      const r = verkauf(pos, letzter.preis, 1);
      abschliessen(pos, null, letzter.zeit);
      pos = null;
      const strafe = pleitePruefen();
      const ende = pfad[pfad.length - 1];
      if (ende) ende.r += r + strafe;
    }
    // Q-Learning-Schritte rückwärts über die Episode: die Belohnung am Ende erreicht so in einem Durchlauf den Anfang
    for (let k = pfad.length - 1; k >= 0; k--) {
      const u = pfad[k]!;
      const qa = qVon(u.s);
      const folge = u.weiter ? qVon(u.weiter) : null;
      const max =
        folge && u.erlaubt.length
          ? Math.max(...u.erlaubt.map((j) => folge[j]!))
          : 0;
      qa[u.a] = qa[u.a]! + ALPHA * (u.r + GAMMA * max - qa[u.a]!);
    }
  }
  erg.trefferquote = erg.trades ? treffer / erg.trades : null;
  return erg;
}

/** Q-Learning über mehrere Durchläufe (epsilon-greedy, abnehmend); Kauf ist im Training überall erlaubt (auch bei hohem 💥 –
 *  der Agent soll lernen, dass das teuer ist), nur „gehalten + 💥 ≥ 0,7 → raus“ gilt wie live */
export async function rlTrainieren(
  episoden: RlEpisode[],
  o: {
    version?: number;
    epochen?: number;
    seed?: number;
    /** E238: nach jedem Durchlauf (für die Trainings-Konsole) */
    durchlauf?: (z: {
      nr: number;
      von: number;
      erkunden: number;
      ergebnis: RlZeitraffer;
      zustaende: number;
    }) => void;
  } = {},
  abgeben?: () => Promise<void>,
): Promise<{ modell: RlModell; episoden: number }> {
  const modell: RlModell = { version: o.version ?? 0, q: {} };
  const epochen = o.epochen ?? 10;
  const zufall = zufallAus(o.seed ?? 235);
  const warte = takt(abgeben);
  const reihe = [...episoden];
  for (let e = 0; e < epochen; e++) {
    for (let i = reihe.length - 1; i > 0; i--) {
      const j = Math.floor(zufall() * (i + 1));
      [reihe[i], reihe[j]] = [reihe[j]!, reihe[i]!];
    }
    const erkunden = epochen > 1 ? 0.3 - (0.25 * e) / (epochen - 1) : 0.1;
    const ergebnis = await simulieren(
      modell,
      reihe,
      { minSicherheit: 0, erkunden, nachschuss: true, maxAbsturz: Infinity },
      zufall,
      true,
      warte,
    );
    o.durchlauf?.({
      nr: e + 1,
      von: epochen,
      erkunden,
      ergebnis,
      zustaende: Object.keys(modell.q).length,
    });
    await warte(true);
  }
  return { modell, episoden: episoden.length * epochen };
}

/** Zeitraffer: gieriger Lauf (erkunden 0) mit den Grenzen des Bots über (Test-)Episoden */
export async function rlZeitraffer(
  m: RlModell,
  episoden: RlEpisode[],
  g: KryptoRlGrenzen,
  abgeben?: () => Promise<void>,
  /** E238: jeder abgeschlossene Trade mit Kauf-/Verkaufsentscheidung (für die Trainings-Konsole) */
  trade?: (t: RlTradeBeispiel) => void,
): Promise<RlZeitraffer> {
  return simulieren(
    m,
    episoden,
    { ...g, erkunden: 0, nachschuss: true },
    zufallAus(1),
    false,
    takt(abgeben),
    trade,
  );
}

/** E246: Signale, aus denen die Einstiegs-Regel gewählt wird, und die Schwellen (Anteile der Zeitpunkte darüber) */
export const RL_EINSTIEG_SIGNALE: KryptoRlEinstiegSignal[] = ["ertrag", "p", "pump", "v1m", "v5m", "hoch5"];
const RL_EINSTIEG_QUANTILE = [0.5, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99];
/** so viele Trades braucht eine Regel auf der Wahl-Hälfte bzw. damit die Prüf-Hälfte zählt */
export const RL_EINSTIEG_MIN_WAHL = 10;
export const RL_EINSTIEG_MIN_PRUEF = 8;

export interface RlEinstiegKandidat {
  signal: KryptoRlEinstiegSignal;
  schwelle: number;
  anteil: number;
  trades: number;
  gewinnSol: number;
}

/**
 * E246: Einstiegs-Regel lernen. Die Test-Episoden (nie gesehen) werden nach Startzeit halbiert. Auf der ersten Hälfte läuft
 * für jedes Signal und jede Schwelle (Quantile 50 … 99 % seiner Werte) der Zeitraffer mit dem gelernten Ausstieg; gewählt wird
 * der beste Gewinn nach Gebühren mit ≥ RL_EINSTIEG_MIN_WAHL Trades (gibt es keine, die Regel mit den meisten Trades). Die zweite
 * Hälfte prüft ehrlich. Absichtlich auch dann eine Regel, wenn sie im Minus liegt: der RL-Bot handelt nur auf Paper und soll
 * kaufen, um zu lernen – ob sie trägt, sagt `bestaetigt`.
 */
export async function rlEinstiegWaehlen(
  m: RlModell,
  episoden: RlEpisode[],
  g: KryptoRlGrenzen,
  abgeben?: () => Promise<void>,
): Promise<{ einstieg: KryptoRlEinstieg | null; kandidaten: RlEinstiegKandidat[] }> {
  const reihe = episoden.filter((e) => e.length > 1).sort((a, b) => a[0]!.zeit - b[0]!.zeit);
  if (reihe.length < 4) return { einstieg: null, kandidaten: [] };
  const mitte = Math.floor(reihe.length / 2);
  const wahl = reihe.slice(0, mitte);
  const pruef = reihe.slice(mitte);
  const schritte = wahl.reduce((n, e) => n + e.length, 0);
  // im Zeitraffer gilt die Regel (minSicherheit > 0 – sonst kauft er überall wie im Training)
  const grenzen: KryptoRlGrenzen = { ...g, minSicherheit: Math.max(g.minSicherheit, 0.01) };
  const kandidaten: RlEinstiegKandidat[] = [];
  for (const signal of RL_EINSTIEG_SIGNALE) {
    const werte: number[] = [];
    for (const e of wahl)
      for (const s of e) {
        const w = rlEinstiegWert(s, signal);
        if (w !== null) werte.push(w);
      }
    if (werte.length < 50) continue;
    werte.sort((a, b) => a - b);
    if (werte[0] === werte[werte.length - 1]) continue;
    const schwellen = [...new Set(RL_EINSTIEG_QUANTILE.map((q) => werte[Math.min(werte.length - 1, Math.floor(q * werte.length))]!))];
    for (const schwelle of schwellen) {
      const anteil = werte.filter((w) => w >= schwelle).length / schritte;
      const probe: KryptoRlEinstieg = { signal, schwelle, anteil, wahl: { trades: 0, gewinnSol: 0 }, pruef: { trades: 0, gewinnSol: 0 }, bestaetigt: false };
      const z = await rlZeitraffer({ ...m, einstieg: probe }, wahl, grenzen, abgeben);
      kandidaten.push({ signal, schwelle, anteil, trades: z.trades, gewinnSol: z.gewinnSol });
    }
  }
  const genug = kandidaten.filter((k) => k.trades >= RL_EINSTIEG_MIN_WAHL);
  const beste = genug.length
    ? genug.reduce((a, b) => (b.gewinnSol > a.gewinnSol ? b : a))
    : kandidaten.filter((k) => k.trades > 0).reduce<RlEinstiegKandidat | null>((a, b) => (!a || b.trades > a.trades || (b.trades === a.trades && b.gewinnSol > a.gewinnSol) ? b : a), null);
  if (!beste) return { einstieg: null, kandidaten };
  const einstieg: KryptoRlEinstieg = {
    signal: beste.signal,
    schwelle: beste.schwelle,
    anteil: beste.anteil,
    wahl: { trades: beste.trades, gewinnSol: beste.gewinnSol },
    pruef: { trades: 0, gewinnSol: 0 },
    bestaetigt: false,
  };
  const z2 = await rlZeitraffer({ ...m, einstieg }, pruef, grenzen, abgeben);
  einstieg.pruef = { trades: z2.trades, gewinnSol: z2.gewinnSol };
  einstieg.bestaetigt = z2.trades >= RL_EINSTIEG_MIN_PRUEF && z2.gewinnSol > 0;
  return { einstieg, kandidaten };
}
