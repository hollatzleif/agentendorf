// E235: Training des Muster-Modells (GBDT) und des RL-Agenten aus aufgezeichneten Ticks – reiner Code ohne DB/Netz.
// Beispiele alle 5 s je Token, zeitlich getrennt: die ältesten 80 % lernen, die neuesten 20 % testen. Zwischen beiden
// liegt eine Lücke von einem Horizont (die Labels der Lernbeispiele dürfen nicht in die Testzeit schauen).
//
// E236: neun Modelle aus denselben Merkmalen (KRYPTO_MUSTER_MODELLE): Grundsignal, 🚀 Pump, 💥 Absturz, Hoch/Tief in 1 und
// 5 min (Werte in %, L2-Regression), Früh-Pump/-Absturz (nur Zeitpunkte mit Token-Alter ≤ 90 s). Die Beispiele (Merkmale)
// entstehen EINMAL, die Matrix liegt einmal im Speicher, die Stufen werden einmal berechnet; jedes Modell nimmt seine
// Zeilen (eigene Labels, eigene Lücke je Horizont), hat einen eigenen ehrlichen Test und wird einzeln aktiv.
//
// E237: dazu die Kursvorhersage – sechs Wert-Modelle verlauf5s … verlauf5m (KRYPTO_VERLAUF_SEK): Kursänderung in % nach h,
// gelernt auf log(1 + x/100) mit dem asymmetrischen Fehler (gbdt.ts, 'asymmetrisch': ein verpasster Fall kostet
// VERLAUF_GEWICHT_FALL-fach). Ehrlicher Test je Horizont: mittlerer asymmetrischer Fehler (Wurzel daraus = fehler, in
// %-Punkten) gegen die beste KONSTANTE unter demselben Verlust (Expektil der Lerndaten = fehlerBasis); aktiv wie die
// Wert-Modelle (≥ 5 % besser, Token-Bootstrap ≥ 95 %, ≥ 200 Testbeispiele, ≥ 10 Tokens, nicht schlechter als das alte × 1,01).
// Dazu Richtung bei großen Bewegungen und Treffer der Alarme. Das RL-Training sieht v1m/v5m und den Alarm.
import {
  KRYPTO_MUSTER_MODELLE,
  KRYPTO_RL_STANDARD,
  KRYPTO_VERLAUF_SEK,
  type KryptoMusterModellInfo,
  type KryptoMusterSchluessel,
  type KryptoMusterStatus,
} from "@dorf/shared";
import {
  asymVerlust,
  auc,
  expektil,
  gbdtTrainieren,
  gbdtVorbereiten,
  gbdtVorhersagen,
  takt,
} from "./gbdt.js";
import {
  ALARM_STANDARD,
  EXTREM_MAX,
  EXTREM_MIN,
  MERKMAL_NAMEN,
  alarmAus,
  extreme,
  label,
  letzterIndex,
  merkmale,
  rendite,
} from "./merkmale.js";
import { rlTrainieren, rlZeitraffer, type RlEpisode } from "./rl.js";
import {
  VERLAUF_SCHLUESSEL,
  signaleAusMerkmalen,
  type MusterModelle,
} from "./signale.js";
import {
  ABSTURZ_ZIEL,
  FRUEH_ALTER_MS,
  PUMP_ZIEL,
  STANDARD_ZIEL,
  type GbdtModell,
  type RlModell,
  type Tick,
  type TokenMeta,
  type Ziel,
} from "./typen.js";

export interface TrainingsDaten {
  ticks: Map<string, Tick[]>;
  meta: Map<string, TokenMeta>;
}
export interface TrainingsErgebnis {
  /** = modelle.basis.gbdt (Abwärtskompatibilität E235) */
  gbdt: GbdtModell | null;
  rl: RlModell | null;
  /** = modelle.basis.info im Format von E235 */
  modell: KryptoMusterStatus["modell"];
  rlInfo: KryptoMusterStatus["rl"];
  bericht: string;
  /** E236: alle trainierten Modelle, auch nicht aktive (info.aktiv/gruende sagt warum) */
  modelle: Partial<
    Record<
      KryptoMusterSchluessel,
      { gbdt: GbdtModell; info: KryptoMusterModellInfo }
    >
  >;
}

export const MIN_LERNBEISPIELE = 500;
export const MIN_TESTBEISPIELE = 200;
export const MIN_AUC = 0.55;
/** E235 (Nachschärfung): Labels kommen in Klumpen je Token – darum mindestens so viele Test-Tokens und
 *  ein Bootstrap über TOKENS: die untere 5-%-Grenze der Test-AUC muss über 0,5 (Raten) liegen. */
export const MIN_TESTTOKENS = 10;
export const BOOTSTRAP_RUNDEN = 200;
/** E236: seltene Ereignisse (Pump) brauchen so viele positive Testbeispiele */
export const MIN_POSITIVE_SELTEN = 30;
/** E236: Wert-Modelle müssen den Median der Lerndaten um mindestens 5 % schlagen … */
export const WERT_FAKTOR = 0.95;
/** … und in so vielen Bootstrap-Runden (über Tokens) besser sein als der Median */
export const WERT_BOOTSTRAP_ANTEIL = 0.95;
/** E236: Bäume je Modell – das Grundsignal wie in E235, die übrigen weniger (Laufzeit: 9 Modelle) */
export const BAEUME_BASIS = 80;
export const BAEUME_NEBEN = 50;
/** E237: Bäume je Kursvorhersage-Modell (Laufzeit: jetzt 15 Modelle) */
export const BAEUME_VERLAUF = 40;
/** E237: Richtung zählt nur bei großen Bewegungen (|echt| ≥ so viel %) */
export const RICHTUNG_AB_PROZENT = 10;

/** zufällige Ganzzahlen fest geseedet – Bootstrap reproduzierbar */
function bootstrapZufall() {
  let z = 0x9e3779b9;
  return () => (
    (z = (Math.imul(z ^ (z >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0),
    z / 4294967296
  );
}

function gruppierenNachToken(token: string[]): number[][] {
  const gruppen = new Map<string, number[]>();
  token.forEach((t, i) =>
    (gruppen.get(t) ?? gruppen.set(t, []).get(t)!).push(i),
  );
  return [...gruppen.values()];
}

/**
 * untere 5-%-Grenze der AUC, wenn man ganze Tokens mit Zurücklegen neu zieht (fester Zufall – reproduzierbar).
 * E236: je Runde gewichtete AUC über einer einmal sortierten Reihenfolge (Gewicht = wie oft der Token gezogen wurde) –
 * gleiches Ergebnis wie das Duplizieren, aber ohne Sortieren je Runde.
 */
export function aucUntergrenze(
  p: number[],
  y: number[],
  token: string[],
  runden = BOOTSTRAP_RUNDEN,
): number {
  const b = aucBootstrap(p, y, token);
  if (!b) return 0;
  const werte: number[] = [];
  for (let r = 0; r < runden; r++) werte.push(b());
  werte.sort((x, z) => x - z);
  return werte[Math.floor(runden * 0.05)]!;
}

/** dasselbe kooperativ (gibt zwischen den Runden ab) */
async function aucUntergrenzeKooperativ(
  p: number[],
  y: number[],
  token: string[],
  warte: () => Promise<void>,
  runden = BOOTSTRAP_RUNDEN,
): Promise<number> {
  const b = aucBootstrap(p, y, token);
  if (!b) return 0;
  const werte: number[] = [];
  for (let r = 0; r < runden; r++) {
    werte.push(b());
    await warte();
  }
  werte.sort((x, z) => x - z);
  return werte[Math.floor(runden * 0.05)]!;
}

/** eine Bootstrap-Runde je Aufruf (null bei weniger als 2 Tokens) */
function aucBootstrap(
  p: number[],
  y: number[],
  token: string[],
): (() => number) | null {
  const liste = gruppierenNachToken(token);
  if (liste.length < 2) return null;
  const n = Math.min(p.length, y.length);
  const tokenVon = new Int32Array(n);
  liste.forEach((g, k) => {
    for (const i of g) tokenVon[i] = k;
  });
  const reihe = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => p[a]! - p[b]!,
  );
  const zufall = bootstrapZufall();
  const gewicht = new Float64Array(liste.length);
  return () => {
    gewicht.fill(0);
    for (let k = 0; k < liste.length; k++)
      gewicht[Math.floor(zufall() * liste.length)]! += 1;
    // gewichtete Mann-Whitney-Statistik: je Gleichstand-Block zählen positive gegen alle negativen davor, halb im Block
    let neg = 0;
    let pos = 0;
    let summe = 0;
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && p[reihe[j + 1]!] === p[reihe[i]!]) j++;
      let blockPos = 0;
      let blockNeg = 0;
      for (let k = i; k <= j; k++) {
        const w = gewicht[tokenVon[reihe[k]!]!]!;
        if (y[reihe[k]!]! > 0.5) blockPos += w;
        else blockNeg += w;
      }
      summe += blockPos * (neg + blockNeg / 2);
      pos += blockPos;
      neg += blockNeg;
      i = j + 1;
    }
    return pos === 0 || neg === 0 ? 0.5 : summe / (pos * neg);
  };
}

/** E236: Anteil der Bootstrap-Runden (Tokens mit Zurücklegen), in denen das Modell einen kleineren absoluten Fehler hat
 *  als die Median-Schätzung */
export function wertBootstrapAnteil(
  fehlerModell: number[],
  fehlerBasis: number[],
  token: string[],
  runden = BOOTSTRAP_RUNDEN,
): number {
  const liste = gruppierenNachToken(token);
  if (liste.length < 2) return 0;
  const sm = liste.map((g) => g.reduce((s, i) => s + fehlerModell[i]!, 0));
  const sb = liste.map((g) => g.reduce((s, i) => s + fehlerBasis[i]!, 0));
  const zufall = bootstrapZufall();
  let besser = 0;
  for (let r = 0; r < runden; r++) {
    let a = 0;
    let b = 0;
    for (let k = 0; k < liste.length; k++) {
      const j = Math.floor(zufall() * liste.length);
      a += sm[j]!;
      b += sb[j]!;
    }
    if (a < b) besser++;
  }
  return besser / runden;
}

export const MAX_BEISPIELE = 200_000;
const SCHRITT_MS = 5_000;
const FENSTER_MS = 120_000;
/** Index von rendite30s in MERKMAL_NAMEN (= Trend 30 s für den RL-Agenten) */
const TREND30 = MERKMAL_NAMEN.indexOf("rendite30s");

/** Label-Spalten je Schritt (NaN = Horizont nicht abgedeckt) */
const SPALTE = {
  basis: 0,
  pump: 1,
  absturz: 2,
  hoch1: 3,
  tief1: 4,
  hoch5: 5,
  tief5: 6,
  /** E237: verlauf je Horizont KRYPTO_VERLAUF_SEK ab hier */
  verlauf: 7,
} as const;
const SPALTEN = 7 + KRYPTO_VERLAUF_SEK.length;

interface Schritt {
  mint: string;
  zeit: number;
  preis: number;
  /** Token-Alter bei zeit (ms) */
  alter: number;
  x: number[];
  y: number[];
}

interface ModellDef {
  schluessel: KryptoMusterSchluessel;
  name: string;
  wert: boolean;
  spalte: number;
  horizontMs: number;
  frueh: boolean;
  baeume: number;
  /** Präzision ab dieser Wahrscheinlichkeit (so nutzt ratAus/RL das Signal) */
  schwelle: number;
  selten: boolean;
  /** E237: Kursvorhersage mit asymmetrischem Fehler */
  asym: boolean;
}

const zahl = (x: number, stellen = 2) => x.toFixed(stellen).replace(".", ",");
const prozent = (x: number) => `${zahl(x * 100, 1)} %`;

function modellDefs(ziel: Ziel): ModellDef[] {
  const name = (k: KryptoMusterSchluessel) =>
    KRYPTO_MUSTER_MODELLE.find((m) => m.schluessel === k)?.name ?? k;
  const w = (
    schluessel: KryptoMusterSchluessel,
    spalte: number,
    horizontMs: number,
    o: Partial<ModellDef> = {},
  ): ModellDef => ({
    schluessel,
    name: name(schluessel),
    wert: false,
    spalte,
    horizontMs,
    frueh: false,
    baeume: BAEUME_NEBEN,
    schwelle: 0.5,
    selten: false,
    asym: false,
    ...o,
  });
  return [
    w("basis", SPALTE.basis, ziel.horizontMs, {
      baeume: BAEUME_BASIS,
      schwelle: 0.6,
      // der Name aus KRYPTO_MUSTER_MODELLE nennt das Standard-Ziel – bei anderem Ziel die echten Zahlen
      name: `Grundsignal (+${ziel.zielProzent} % vor −${ziel.stopProzent} %, ${Math.round(ziel.horizontMs / 60_000)} min)`,
    }),
    w("pump", SPALTE.pump, PUMP_ZIEL.horizontMs, {
      schwelle: 0.3,
      selten: true,
    }),
    w("absturz", SPALTE.absturz, ABSTURZ_ZIEL.horizontMs),
    w("hoch1", SPALTE.hoch1, 60_000, { wert: true }),
    w("tief1", SPALTE.tief1, 60_000, { wert: true }),
    w("hoch5", SPALTE.hoch5, 300_000, { wert: true }),
    w("tief5", SPALTE.tief5, 300_000, { wert: true }),
    w("fruehPump", SPALTE.pump, PUMP_ZIEL.horizontMs, {
      frueh: true,
      schwelle: 0.3,
      selten: true,
    }),
    w("fruehAbsturz", SPALTE.absturz, ABSTURZ_ZIEL.horizontMs, {
      frueh: true,
    }),
    ...KRYPTO_VERLAUF_SEK.map((sek, i) =>
      w(VERLAUF_SCHLUESSEL[i]!, SPALTE.verlauf + i, sek * 1000, {
        wert: true,
        asym: true,
        baeume: BAEUME_VERLAUF,
      }),
    ),
  ];
}

function quantil(sortiert: Float64Array | number[], q: number) {
  if (!sortiert.length) return 0;
  return sortiert[
    Math.min(sortiert.length - 1, Math.max(0, Math.floor(q * sortiert.length)))
  ]!;
}

export async function musterTrainieren(
  d: TrainingsDaten,
  o: {
    jetzt: number;
    ziel?: Ziel;
    version: number;
    /** E235: Test-AUC des derzeit aktiven Grundsignals (Alias für alt.basis.auc) */
    altAuc?: number | null;
    /** E236: Testwerte der derzeit aktiven Modelle je Schlüssel (fehlt = keins aktiv) */
    alt?: Partial<
      Record<
        KryptoMusterSchluessel,
        { auc?: number | null; fehler?: number | null }
      >
    >;
    /** E236: die derzeit gültigen (aktiven) Modelle – das RL-Training nimmt sie für Schlüssel ohne neues aktives Modell */
    aktuelle?: MusterModelle;
    abgeben?: () => Promise<void>;
    fortschritt?: (x: number) => void;
  },
): Promise<TrainingsErgebnis> {
  const ziel = o.ziel ?? STANDARD_ZIEL;
  const warte = takt(o.abgeben);
  const melde = (x: number) => o.fortschritt?.(Math.max(0, Math.min(1, x)));
  const trainiert = new Date(o.jetzt).toISOString();
  const alt = { ...(o.alt ?? {}) };
  if (o.altAuc != null && !alt.basis) alt.basis = { auc: o.altAuc };
  melde(0);

  // Schrittweite: alle 5 s, bei sehr vielen Daten gleichmäßig ausgedünnt (höchstens ~MAX_BEISPIELE Schritte);
  // junge Tokens (≤ 90 s) immer alle 5 s – sonst hätten die Früh-Modelle zu wenig Beispiele
  let schaetzung = 0;
  for (const ticks of d.ticks.values()) {
    if (ticks.length)
      schaetzung +=
        (Math.min(o.jetzt, ticks[ticks.length - 1]!.zeit) - ticks[0]!.zeit) /
        SCHRITT_MS;
  }
  const schrittMs =
    SCHRITT_MS * Math.max(1, Math.ceil(schaetzung / MAX_BEISPIELE));

  // 1. Schritte je Token (Merkmale + alle Labels) – einmal für alle Modelle
  const jeToken = new Map<string, Schritt[]>();
  let tokenNr = 0;
  for (const [mint, roh] of d.ticks) {
    tokenNr++;
    const ticks = roh.filter((t) => t.zeit <= o.jetzt);
    if (ticks.length < 3) continue;
    const meta = d.meta.get(mint) ?? { mint, erstellt: ticks[0]!.zeit };
    const liste: Schritt[] = [];
    const ende = ticks[ticks.length - 1]!.zeit;
    let t = Math.ceil(ticks[0]!.zeit / SCHRITT_MS) * SCHRITT_MS;
    while (t <= ende) {
      const i = letzterIndex(ticks, t);
      if (i >= 0 && ticks[i]!.zeit <= t - FENSTER_MS) {
        // Lücke ohne Ticks: zum nächsten Tick springen
        const naechster = ticks[i + 1];
        if (!naechster) break;
        t = Math.ceil(naechster.zeit / schrittMs) * schrittMs;
        continue;
      }
      const alter = t - meta.erstellt;
      // ausgedünnt nur auf dem Raster der Schrittweite; jung immer
      if (alter <= FRUEH_ALTER_MS || t % schrittMs === 0) {
        const x = merkmale(ticks, t, meta);
        if (x) {
          const y = new Array<number>(SPALTEN).fill(NaN);
          const lb = label(ticks, t, ziel);
          if (lb !== null) y[SPALTE.basis] = lb;
          const lp = label(ticks, t, PUMP_ZIEL);
          if (lp !== null) y[SPALTE.pump] = lp;
          const la = label(ticks, t, ABSTURZ_ZIEL);
          if (la !== null) y[SPALTE.absturz] = la;
          const e1 = extreme(ticks, t, 60_000);
          if (e1) ((y[SPALTE.hoch1] = e1.hoch), (y[SPALTE.tief1] = e1.tief));
          const e5 = extreme(ticks, t, 300_000);
          if (e5) ((y[SPALTE.hoch5] = e5.hoch), (y[SPALTE.tief5] = e5.tief));
          KRYPTO_VERLAUF_SEK.forEach((sek, k) => {
            const r = rendite(ticks, t, sek * 1000);
            if (r !== null) y[SPALTE.verlauf + k] = r;
          });
          liste.push({ mint, zeit: t, preis: ticks[i]!.preis, alter, x, y });
        }
      }
      t += SCHRITT_MS;
      await warte();
    }
    if (liste.length) jeToken.set(mint, liste);
    melde((0.35 * tokenNr) / Math.max(1, d.ticks.size));
  }

  // 2. Beispiele (mit mindestens einem Label), zeitlich sortiert; Trennzeit wie E235 aus den Grundsignal-Beispielen
  const beispiele: Schritt[] = [];
  // E237: nur Schritte mit mindestens einem Label der E236-Modelle (Horizont ≥ 1 min abgedeckt) – so bleiben Beispiele,
  // Stufen und Trennzeit genau wie in E236 (die Modelle von dort ändern sich nicht); den kurzen Kursvorhersagen fehlen
  // nur die letzten < 60 s jeder Aufzeichnung
  for (const l of jeToken.values())
    for (const s of l)
      if (s.y.some((v, k) => k < SPALTE.verlauf && !Number.isNaN(v)))
        beispiele.push(s);
  await warte();
  beispiele.sort((a, b) => a.zeit - b.zeit);
  await warte();
  const mitBasis = beispiele.filter(
    (b) => !Number.isNaN(b.y[SPALTE.basis]!),
  );
  const trennZeit =
    (mitBasis.length
      ? mitBasis[Math.floor(mitBasis.length * 0.8)]?.zeit
      : beispiele[Math.floor(beispiele.length * 0.8)]?.zeit) ?? Infinity;
  await warte();
  const basisLern = mitBasis.filter(
    (b) => b.zeit < trennZeit - ziel.horizontMs,
  ).length;

  if (basisLern < MIN_LERNBEISPIELE) {
    melde(1);
    return {
      gbdt: null,
      rl: null,
      modell: null,
      rlInfo: null,
      modelle: {},
      bericht: `### Muster-Modell\nzu wenig Daten (${basisLern} Beispiele, braucht ≥ ${MIN_LERNBEISPIELE}) – ${d.ticks.size} Tokens aufgezeichnet. Training später erneut.`,
    };
  }

  // 3. Matrix einmal (Verweise auf die Merkmals-Vektoren der Schritte – keine Kopie), Stufen einmal (aus der Lernzeit)
  await warte();
  const X = beispiele.map((b) => b.x);
  let lernzeitEnde = 0;
  while (lernzeitEnde < beispiele.length && beispiele[lernzeitEnde]!.zeit < trennZeit)
    lernzeitEnde++;
  await warte();
  const vorbereitung = await gbdtVorbereiten(
    X,
    async () => {
      await o.abgeben?.();
    },
    Math.max(1, lernzeitEnde),
  );
  melde(0.4);

  const defs = modellDefs(ziel);
  const modelle: TrainingsErgebnis["modelle"] = {};
  const berichtModelle: string[] = [];
  let basisZusatz: {
    praezision: number | null;
    sicherN: number;
    basisRate: number;
    positivAnteil: number;
    lern: number;
    test: number;
    gruende: string[];
  } | null = null;
  const yVoll = new Float64Array(beispiele.length);

  for (let mi = 0; mi < defs.length; mi++) {
    const def = defs[mi]!;
    const passt = (b: Schritt) =>
      !Number.isNaN(b.y[def.spalte]!) &&
      (!def.frueh || b.alter <= FRUEH_ALTER_MS);
    const lernIdx: number[] = [];
    const testIdx: number[] = [];
    for (let i = 0; i < beispiele.length; i++) {
      const b = beispiele[i]!;
      if (!passt(b)) continue;
      if (b.zeit < trennZeit - def.horizontMs) lernIdx.push(i);
      else if (b.zeit >= trennZeit) testIdx.push(i);
    }
    await warte();
    if (lernIdx.length < MIN_LERNBEISPIELE) {
      berichtModelle.push(
        `- ${def.name}: nicht trainiert – zu wenig Daten (${lernIdx.length} Lernbeispiele, braucht ≥ ${MIN_LERNBEISPIELE})`,
      );
      melde(0.4 + (0.45 * (mi + 1)) / defs.length);
      continue;
    }

    // Labels dieses Modells; Wert-Modelle: Ausreißer der Lerndaten auf das 1-/99-%-Quantil kappen (L2 ist empfindlich)
    yVoll.fill(NaN);
    for (const i of lernIdx) yVoll[i] = beispiele[i]!.y[def.spalte]!;
    let median = 0;
    // E237: beste Konstante unter dem asymmetrischen Fehler (aus den ungekappten Lerndaten in %)
    const konstante = def.asym
      ? expektil(Float64Array.from(lernIdx, (i) => yVoll[i]!))
      : 0;
    if (def.wert) {
      const sortiert = Float64Array.from(lernIdx, (i) => yVoll[i]!).sort();
      median = quantil(sortiert, 0.5);
      const unten = quantil(sortiert, 0.01);
      const oben = quantil(sortiert, 0.99);
      // auf log(1 + x/100) lernen: Hoch/Tief sind stark schief (wenige riesige Pumps) – L2 auf der %-Skala schätzt den
      // Mittelwert und verliert gegen den Median; auf der Log-Skala liegt die Schätzung nahe am typischen Wert
      for (const i of lernIdx)
        yVoll[i] = Math.log1p(Math.max(unten, Math.min(oben, yVoll[i]!)) / 100);
    }
    const { modell: gbdt, wichtigkeit } = await gbdtTrainieren(
      X,
      yVoll,
      {
        baeume: def.baeume,
        art: def.asym
          ? "asymmetrisch"
          : def.wert
            ? "quadratisch"
            : "logistisch",
        vorbereitung,
        auswahl: lernIdx,
      },
      async () => {
        await o.abgeben?.();
      },
    );
    gbdt.version = o.version;

    // ehrlicher Test auf den neuesten, nie gesehenen Daten
    const test = testIdx.map((i) => beispiele[i]!);
    if (def.wert) gbdt.skala = "log";
    const vorhersage: number[] = [];
    for (const b of test) {
      const v = gbdtVorhersagen(gbdt, b.x);
      vorhersage.push(
        def.asym ? Math.max(EXTREM_MIN, Math.min(EXTREM_MAX, v)) : v,
      );
      if ((vorhersage.length & 4095) === 0) await warte();
    }
    const yTest = test.map((b) => b.y[def.spalte]!);
    const tokens = test.map((b) => b.mint);
    const testTokens = new Set(tokens).size;
    const gruende: string[] = [];
    if (test.length < MIN_TESTBEISPIELE)
      gruende.push(
        `nur ${test.length} Testbeispiele (braucht ≥ ${MIN_TESTBEISPIELE})`,
      );
    if (testTokens < MIN_TESTTOKENS)
      gruende.push(
        `nur ${testTokens} Tokens im Test (braucht ≥ ${MIN_TESTTOKENS})`,
      );
    const info: KryptoMusterModellInfo = {
      schluessel: def.schluessel,
      version: o.version,
      trainiert,
      aktiv: false,
      gruende,
      beispiele: lernIdx.length + testIdx.length,
      test: {
        beispiele: test.length,
        tokens: testTokens,
        auc: null,
        aucUntergrenze: null,
        praezision: null,
        basis: null,
        fehler: null,
        fehlerBasis: null,
      },
      merkmale: gbdt.merkmale
        .map((name, i) => ({ name, wichtigkeit: wichtigkeit[i] ?? 0 }))
        .sort((a, b) => b.wichtigkeit - a.wichtigkeit),
    };
    let zeile: string;
    if (!def.wert) {
      const testAuc = auc(vorhersage, yTest);
      const positiv = yTest.reduce((s, v) => s + v, 0);
      const basisRate = test.length ? positiv / test.length : 0;
      let sicherN = 0;
      let sicherTreffer = 0;
      vorhersage.forEach((p, i) => {
        if (p >= def.schwelle) {
          sicherN++;
          sicherTreffer += yTest[i]!;
        }
      });
      const praezision = sicherN ? sicherTreffer / sicherN : null;
      info.test.auc = testAuc;
      info.test.basis = basisRate;
      info.test.praezision = praezision;
      if (def.selten && positiv < MIN_POSITIVE_SELTEN)
        gruende.push(
          `zu wenige Pumps im Test (${positiv}, braucht ≥ ${MIN_POSITIVE_SELTEN})`,
        );
      if (!test.length) {
        // keine Testbeispiele – Grund steht schon oben
      } else if (testAuc < MIN_AUC)
        gruende.push(`Test-AUC ${zahl(testAuc)} < ${zahl(MIN_AUC)}`);
      else if (testTokens >= MIN_TESTTOKENS) {
        const unten = await aucUntergrenzeKooperativ(
          vorhersage,
          yTest,
          tokens,
          warte,
        );
        info.test.aucUntergrenze = unten;
        if (unten <= 0.5)
          gruende.push(
            `nicht sicher besser als Raten (AUC-Untergrenze ${zahl(unten)} ≤ 0,50 über Tokens)`,
          );
      }
      const altAuc = alt[def.schluessel]?.auc;
      if (altAuc != null && testAuc < altAuc - 0.01)
        gruende.push(`schlechter als das aktive Modell (AUC ${zahl(altAuc)})`);
      zeile = `Test-AUC ${zahl(testAuc)} (Raten 0,50), positiv ${prozent(basisRate)}, Präzision bei p ≥ ${zahl(def.schwelle, 1)}: ${praezision === null ? "–" : `${prozent(praezision)} (${sicherN})`}`;
      if (def.schluessel === "basis") {
        let posAlle = 0;
        for (const i of lernIdx) posAlle += beispiele[i]!.y[def.spalte]!;
        basisZusatz = {
          praezision,
          sicherN,
          basisRate,
          positivAnteil: (posAlle + positiv) / (lernIdx.length + test.length),
          lern: lernIdx.length,
          test: test.length,
          gruende,
        };
      }
    } else if (def.asym) {
      // E237: asymmetrischer Fehler je Beispiel (%-Punkte²) – Modell gegen die beste Konstante (Expektil der Lerndaten)
      const fehlerModell = vorhersage.map((v, i) => asymVerlust(yTest[i]!, v));
      const fehlerBasis = yTest.map((v) => asymVerlust(v, konstante));
      const fehler = test.length
        ? Math.sqrt(fehlerModell.reduce((s, v) => s + v, 0) / test.length)
        : 0;
      const fehlerKonst = test.length
        ? Math.sqrt(fehlerBasis.reduce((s, v) => s + v, 0) / test.length)
        : 0;
      info.test.fehler = fehler;
      info.test.fehlerBasis = fehlerKonst;
      // Richtung bei großen Bewegungen; Alarme (Schwellen wie der Standard-Alarm), Treffer = halbe Schwelle erreicht
      let gross = 0;
      let richtig = 0;
      const auf = { n: 0, treffer: 0 };
      const ab = { n: 0, treffer: 0 };
      vorhersage.forEach((v, i) => {
        const echt = yTest[i]!;
        if (Math.abs(echt) >= RICHTUNG_AB_PROZENT) {
          gross++;
          if (Math.sign(v) === Math.sign(echt)) richtig++;
        }
        if (v >= ALARM_STANDARD.anstiegProzent) {
          auf.n++;
          if (echt >= ALARM_STANDARD.anstiegProzent / 2) auf.treffer++;
        }
        if (v <= -ALARM_STANDARD.fallProzent) {
          ab.n++;
          if (echt <= -ALARM_STANDARD.fallProzent / 2) ab.treffer++;
        }
      });
      info.test.richtung = gross ? richtig / gross : null;
      info.test.alarmAnstieg = auf;
      info.test.alarmFall = ab;
      if (!test.length) {
        // keine Testbeispiele – Grund steht schon oben
      } else if (!(fehler <= WERT_FAKTOR * fehlerKonst))
        gruende.push(
          `Fehler ${zahl(fehler, 1)} nicht ≥ 5 % besser als die Konstante (${zahl(fehlerKonst, 1)})`,
        );
      else if (testTokens >= MIN_TESTTOKENS) {
        const anteil = wertBootstrapAnteil(fehlerModell, fehlerBasis, tokens);
        if (anteil < WERT_BOOTSTRAP_ANTEIL)
          gruende.push(
            `nicht sicher besser als die Konstante (nur in ${prozent(anteil)} der Token-Stichproben)`,
          );
      }
      const altFehler = alt[def.schluessel]?.fehler;
      if (altFehler != null && fehler > altFehler * 1.01)
        gruende.push(
          `schlechter als das aktive Modell (Fehler ${zahl(altFehler, 1)})`,
        );
      const quote = (a: { n: number; treffer: number }) =>
        a.n ? `${a.treffer}/${a.n} (${prozent(a.treffer / a.n)})` : "keine";
      zeile =
        `asym. Fehler ${zahl(fehler, 1)} %-Punkte vs. Konstante ${zahl(fehlerKonst, 1)} (${zahl(konstante, 1)} %), ` +
        `Richtung bei |Δ| ≥ ${RICHTUNG_AB_PROZENT} %: ${info.test.richtung == null ? "–" : `${prozent(info.test.richtung)} (${gross})`}, ` +
        `Alarm 🚀 ${quote(auf)}, 💥 ${quote(ab)}`;
    } else {
      const fehlerModell = vorhersage.map((v, i) => Math.abs(v - yTest[i]!));
      const fehlerBasis = yTest.map((v) => Math.abs(median - v));
      const mae = test.length
        ? fehlerModell.reduce((s, v) => s + v, 0) / test.length
        : 0;
      const maeBasis = test.length
        ? fehlerBasis.reduce((s, v) => s + v, 0) / test.length
        : 0;
      info.test.fehler = mae;
      info.test.fehlerBasis = maeBasis;
      if (!test.length) {
        // keine Testbeispiele – Grund steht schon oben
      } else if (!(mae <= WERT_FAKTOR * maeBasis))
        gruende.push(
          `Fehler ${zahl(mae, 1)} nicht ≥ 5 % besser als der Median (${zahl(maeBasis, 1)})`,
        );
      else if (testTokens >= MIN_TESTTOKENS) {
        const anteil = wertBootstrapAnteil(fehlerModell, fehlerBasis, tokens);
        if (anteil < WERT_BOOTSTRAP_ANTEIL)
          gruende.push(
            `nicht sicher besser als der Median (nur in ${prozent(anteil)} der Token-Stichproben)`,
          );
      }
      const altFehler = alt[def.schluessel]?.fehler;
      if (altFehler != null && mae > altFehler * 1.01)
        gruende.push(
          `schlechter als das aktive Modell (Fehler ${zahl(altFehler, 1)})`,
        );
      zeile = `mittlerer Fehler ${zahl(mae, 1)} %-Punkte vs. Median-Schätzung ${zahl(maeBasis, 1)} (Median ${zahl(median, 1)} %)`;
    }
    info.aktiv = gruende.length === 0;
    modelle[def.schluessel] = { gbdt, info };
    berichtModelle.push(
      `- ${def.name}: ${info.aktiv ? "**aktiv**" : `nicht aktiv (${gruende.join("; ")})`} – ${zeile}; ${test.length} Test/${testTokens} Tokens`,
    );
    melde(0.4 + (0.45 * (mi + 1)) / defs.length);
    await warte(true);
  }

  const basis = modelle.basis!;
  const bz = basisZusatz!;
  const modell: NonNullable<KryptoMusterStatus["modell"]> = {
    version: o.version,
    trainiert,
    beispiele: basis.info.beispiele,
    positivAnteil: bz.positivAnteil,
    test: {
      beispiele: basis.info.test.beispiele,
      auc: basis.info.test.auc ?? 0.5,
      praezision: bz.praezision,
      basis: bz.basisRate,
    },
    aktiv: basis.info.aktiv,
    merkmale: basis.info.merkmale,
  };

  // 4. RL: Signale aller aktiven Modelle (neu aktiv, sonst das derzeit gültige); Episoden je Token,
  //    Schritte vor der Trennzeit lernen, danach Zeitraffer
  const rlModelle: MusterModelle = {};
  const genutzt: string[] = [];
  for (const k of [
    "basis",
    "pump",
    "absturz",
    "hoch5",
    "tief5",
    "fruehPump",
    "fruehAbsturz",
    ...VERLAUF_SCHLUESSEL,
  ] as KryptoMusterSchluessel[]) {
    const neu = modelle[k];
    const m =
      neu?.info.aktiv
        ? neu.gbdt
        : o.aktuelle?.[k]?.merkmale.length === MERKMAL_NAMEN.length
          ? o.aktuelle[k]
          : undefined;
    if (m) {
      rlModelle[k] = m;
      genutzt.push(neu?.info.aktiv ? k : `${k} (bisheriges)`);
    }
  }
  const lernEp: RlEpisode[] = [];
  const testEp: RlEpisode[] = [];
  for (const liste of jeToken.values()) {
    const a: RlEpisode = [];
    const b: RlEpisode = [];
    for (const s of liste) {
      const sig = signaleAusMerkmalen(rlModelle, s.x, s.alter);
      const schritt: RlEpisode[number] = {
        zeit: s.zeit,
        preis: s.preis,
        p: sig.p ?? 0,
        trend30Prozent: s.x[TREND30] ?? 0,
        pump: sig.pump,
        absturz: sig.absturz,
        hoch5: sig.hoch5,
        tief5: sig.tief5,
        v1m: sig.verlauf[KRYPTO_VERLAUF_SEK.indexOf(60)] ?? null,
        v5m: sig.verlauf[KRYPTO_VERLAUF_SEK.indexOf(300)] ?? null,
        alarm: alarmAus(sig),
      };
      (s.zeit < trennZeit ? a : b).push(schritt);
    }
    if (a.length > 1) lernEp.push(a);
    if (b.length > 1) testEp.push(b);
    await warte();
  }
  melde(0.87);
  const { modell: rl, episoden } = await rlTrainieren(
    lernEp,
    { version: o.version, epochen: 10 },
    o.abgeben,
  );
  melde(0.95);
  const zeitraffer = await rlZeitraffer(
    rl,
    testEp,
    { ...KRYPTO_RL_STANDARD, erkunden: 0 },
    o.abgeben,
  );
  const rlInfo: NonNullable<KryptoMusterStatus["rl"]> = {
    version: o.version,
    trainiert,
    episoden,
    zeitraffer: {
      trades: zeitraffer.trades,
      gewinnSol: zeitraffer.gewinnSol,
      trefferquote: zeitraffer.trefferquote,
      pleiten: zeitraffer.pleiten,
    },
  };

  const aktivAnzahl = Object.values(modelle).filter((m) => m.info.aktiv).length;
  const bericht = [
    `### Muster-Modell v${o.version} (${trainiert.slice(0, 16).replace("T", " ")} UTC)`,
    `- Ziel: erst +${ziel.zielProzent} %, bevor −${ziel.stopProzent} %, innerhalb ${Math.round(ziel.horizontMs / 60_000)} min`,
    `- Beispiele: ${bz.lern} lernen (ältere), ${bz.test} testen (neueste, nie gesehen); positiv ${prozent(bz.positivAnteil)}`,
    `- Test-AUC ${zahl(modell.test.auc)} (Raten = 0,50) → ${modell.aktiv ? "**aktiv** (gibt Rat)" : `**nicht aktiv**: ${bz.gruende.join("; ")}`}`,
    `- Präzision bei p ≥ 0,6: ${bz.praezision === null ? "keine solchen Fälle" : `${prozent(bz.praezision)} (${bz.sicherN} Fälle)`} vs. Basisrate ${prozent(bz.basisRate)}`,
    `- Wichtigste Merkmale: ${modell.merkmale
      .slice(0, 5)
      .map((m) => `${m.name} (${prozent(m.wichtigkeit)})`)
      .join(", ")}`,
    `#### Alle Modelle (${aktivAnzahl} aktiv)`,
    ...berichtModelle,
    `#### RL-Agent`,
    `- Signale im Training: ${genutzt.length ? genutzt.join(", ") : "keine aktiven (p = 0)"}`,
    `- RL-Zeitraffer auf den Testdaten (Einsatz ${zahl(0.5, 1)} SOL, Gebühren wie Paper, minSicherheit ${zahl(KRYPTO_RL_STANDARD.minSicherheit, 1)}): ${zeitraffer.trades} Trades, ` +
      `${zeitraffer.gewinnSol >= 0 ? "+" : ""}${zahl(zeitraffer.gewinnSol, 3)} SOL, Trefferquote ${zeitraffer.trefferquote === null ? "–" : prozent(zeitraffer.trefferquote)}, Pleiten ${zeitraffer.pleiten}`,
    `- RL gelernt aus ${lernEp.length} Token-Episoden × 10 Durchläufe (${Object.keys(rl.q).length} Zustände)`,
  ].join("\n");
  melde(1);
  return { gbdt: basis.gbdt, rl, modell, rlInfo, bericht, modelle };
}
