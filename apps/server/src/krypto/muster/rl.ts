// E235: RL-Agent (die „Hände“) – tabellarisches Q-Learning über diskretisierte Lagen, Training im Zeitraffer über
// aufgezeichnete Ticks mit derselben Marktmechanik wie Paper (kurve.ts).
//
// Simulation (bewusst wie Paper, siehe motor.ts): Entscheidung bei Schritt i, ausgeführt zum Kurs des NÄCHSTEN Schritts
// (5 s Verzögerung, nie zum gesehenen Kurs), Bonding-Curve-Gebühr 1,25 % + eigene Slippage über kaufen()/verkaufen(),
// PumpPortal 0,5 % je Seite, Netzgebühr je Transaktion. Einsatz fest 0,5 SOL je Kauf, Startkapital 10 SOL;
// fällt das Kapital ohne Position unter den Einsatz → Pleite: Strafe −2 (nur Lernsignal) und Nachschuss 10 SOL
// (zählt nie als Gewinn). Belohnung = realisierter Gewinn in SOL beim (Teil-)Verkauf.
import type { KryptoRlGrenzen } from "@dorf/shared";
import { GRUNDGEBUEHR_SOL, kaufen, kurveAusKurs, verkaufen } from "../kurve.js";
import { takt } from "./gbdt.js";
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

const GAMMA = 0.99;
const ALPHA = 0.1;

function stufeVon(x: number, grenzen: number[]) {
  let i = 0;
  while (i < grenzen.length && x >= grenzen[i]!) i++;
  return i;
}

/** Zustandsschlüssel: p in 10 Stufen, hält?, Plus-Stufe, Haltezeit-Stufe, Trend-Stufe */
export function rlZustand(l: RlLage): string {
  const p = Math.max(
    0,
    Math.min(9, Math.floor((Number.isFinite(l.p) ? l.p : 0) * 10)),
  );
  const trend = stufeVon(l.trend30Prozent, [-5, -1, 1, 5]);
  if (!l.haelt) return `w|${p}|${trend}`;
  const plus = stufeVon(l.plusProzent, [-10, 0, 10, 20]);
  const halt = stufeVon(l.haltSek, [30, 60, 120, 300]);
  return `h|${p}|${plus}|${halt}|${trend}`;
}

/** erlaubte Handlungen: ohne Position warten/kaufen (kaufen nur ab minSicherheit), mit Position warten/halb/raus */
export function rlErlaubt(l: RlLage, g: KryptoRlGrenzen): RlHandlung[] {
  if (l.haelt) return ["warten", "halb", "raus"];
  return l.p >= g.minSicherheit ? ["warten", "kaufen"] : ["warten"];
}

function regel(l: RlLage, g: KryptoRlGrenzen): RlHandlung {
  if (!l.haelt) return l.p >= g.minSicherheit ? "kaufen" : "warten";
  return l.p < 0.3 || l.plusProzent <= -10 ? "raus" : "warten";
}

export function rlHandlung(
  m: RlModell | null,
  l: RlLage,
  g: KryptoRlGrenzen,
  zufall: () => number,
): RlHandlung {
  const erlaubt = rlErlaubt(l, g);
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

/** Ein Zeitschritt einer Episode (alle 5 s): Kurs = letzter Tick, p = Muster-Vorhersage */
export interface RlSchritt {
  zeit: number;
  preis: number;
  p: number;
  trend30Prozent: number;
}
export type RlEpisode = RlSchritt[];

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
}

async function simulieren(
  m: RlModell,
  episoden: RlEpisode[],
  g: KryptoRlGrenzen,
  zufall: () => number,
  lernen: boolean,
  warte: (erzwingen?: boolean) => Promise<void>,
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
  const abschliessen = (pos: Position) => {
    const g2 = pos.erloes - pos.einsatzGesamt;
    erg.trades++;
    erg.gewinnSol += g2;
    if (g2 > 0) treffer++;
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
    }[] = [];
    for (let i = 0; i < ep.length; i++) {
      const schritt = ep[i]!;
      const lage: RlLage = {
        p: schritt.p,
        haelt: pos !== null,
        plusProzent: pos ? (schritt.preis / pos.einstieg - 1) * 100 : 0,
        haltSek: pos ? (schritt.zeit - pos.seit) / 1000 : 0,
        trend30Prozent: schritt.trend30Prozent,
      };
      const s = rlZustand(lage);
      if (lernen) {
        qVon(s);
        const vorher = pfad[pfad.length - 1];
        if (vorher) {
          vorher.weiter = s;
          vorher.erlaubt = rlErlaubt(lage, g).map((a) =>
            RL_HANDLUNGEN.indexOf(a),
          );
        }
      }
      let a = rlHandlung(m, lage, g, zufall);
      // Ausführung zum Kurs des nächsten Schritts (Verzögerung); am Ende der Episode zum letzten Kurs
      const preis = (ep[i + 1] ?? schritt).preis;
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
          };
        }
      } else if (pos && (a === "raus" || (a === "halb" && pos.einsatz < 0.1))) {
        r += verkauf(pos, preis, 1);
        abschliessen(pos);
        pos = null;
        r += pleitePruefen();
      } else if (pos && a === "halb") {
        r += verkauf(pos, preis, 0.5);
      }
      if (lernen)
        pfad.push({
          s,
          a: RL_HANDLUNGEN.indexOf(a),
          r,
          weiter: null,
          erlaubt: [],
        });
      await warte();
    }
    // Ende der Aufzeichnung: offene Position zum letzten Kurs schließen (Endzustand, ohne Ausblick)
    const letzter = ep[ep.length - 1];
    if (pos && letzter) {
      const r = verkauf(pos, letzter.preis, 1);
      abschliessen(pos);
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

/** Q-Learning über mehrere Durchläufe (epsilon-greedy, abnehmend); Kauf ist im Training überall erlaubt */
export async function rlTrainieren(
  episoden: RlEpisode[],
  o: { version?: number; epochen?: number; seed?: number } = {},
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
    await simulieren(
      modell,
      reihe,
      { minSicherheit: 0, erkunden, nachschuss: true },
      zufall,
      true,
      warte,
    );
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
): Promise<RlZeitraffer> {
  return simulieren(
    m,
    episoden,
    { ...g, erkunden: 0, nachschuss: true },
    zufallAus(1),
    false,
    takt(abgeben),
  );
}
