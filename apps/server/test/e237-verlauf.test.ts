import { describe, expect, it } from "vitest";
import { KRYPTO_RL_STANDARD, KRYPTO_VERLAUF_SEK } from "@dorf/shared";
import {
  asymVerlust,
  expektil,
  gbdtArt,
  gbdtTrainieren,
  gbdtVorbereiten,
  gbdtVorhersagen,
  type GbdtModellMitArt,
} from "../src/krypto/muster/gbdt.js";
import {
  MERKMAL_NAMEN,
  alarmAus,
  ratAus,
  rendite,
} from "../src/krypto/muster/merkmale.js";
import {
  rlErlaubt,
  rlHandlung,
  rlZustand,
  zufallAus,
  type RlLageMitAlarm,
} from "../src/krypto/muster/rl.js";
import {
  VERLAUF_SCHLUESSEL,
  alarmAus as alarmAusSignale,
  musterSignale,
} from "../src/krypto/muster/signale.js";
import {
  musterTrainieren,
  type TrainingsDaten,
} from "../src/krypto/muster/training.js";
import {
  VERLAUF_GEWICHT_FALL,
  type GbdtModell,
  type MusterSignale,
  type Tick,
  type TokenMeta,
} from "../src/krypto/muster/typen.js";

/** E237: Kursvorhersage (verlauf5s … verlauf5m) mit asymmetrischem Fehler + Alarm. Ohne Netz, Zufall fest. */

const T0 = Date.UTC(2026, 10, 25, 12, 0, 0);

const mit = (preise: [number, number][]): Tick[] =>
  preise.map(([dt, p]) => ({ zeit: T0 + dt, preis: p, sol: 0, echtSol: 1 }));

const ohneVerlauf = [null, null, null, null, null, null];
const signale = (o: Partial<MusterSignale>): MusterSignale => ({
  p: null,
  pump: null,
  absturz: null,
  hoch1: null,
  tief1: null,
  hoch5: null,
  tief5: null,
  frueh: false,
  verlauf: ohneVerlauf,
  ...o,
});
/** verlauf aus Teilangaben je Sekunden-Horizont */
const verlauf = (o: Partial<Record<(typeof KRYPTO_VERLAUF_SEK)[number], number>>) =>
  KRYPTO_VERLAUF_SEK.map((s) => o[s] ?? null);

/** Normalverteilung (Box-Muller) aus festem Zufall */
function normal(z: () => number) {
  return () =>
    Math.sqrt(-2 * Math.log(Math.max(1e-12, z()))) * Math.cos(2 * Math.PI * z());
}

describe("E237 rendite()", () => {
  const ticks = mit([
    [0, 100],
    [10_000, 110],
    [30_000, 90],
    [70_000, 120],
  ]);
  it("Kurs (letzter Tick ≤ t + h) gegen Kurs bei t, null wenn nicht abgedeckt", () => {
    expect(rendite(ticks, T0, 5_000)).toBeCloseTo(0, 9); // noch kein neuer Tick
    expect(rendite(ticks, T0, 15_000)).toBeCloseTo(10, 9);
    expect(rendite(ticks, T0, 30_000)).toBeCloseTo(-10, 9); // Tick genau am Horizont zählt
    expect(rendite(ticks, T0, 60_000)).toBeCloseTo(-10, 9);
    expect(rendite(ticks, T0, 70_000)).toBeCloseTo(20, 9);
    expect(rendite(ticks, T0 + 5_000, 25_000)).toBeCloseTo(-10, 9); // Kurs bei t = letzter Tick davor
    expect(rendite(ticks, T0, 80_000)).toBeNull(); // Aufzeichnung reicht nicht
    expect(rendite(ticks, T0 - 1, 1_000)).toBeNull(); // vor dem ersten Tick
    // begrenzt auf [−95, +500]
    expect(rendite(mit([[0, 100], [5_000, 1]]), T0, 5_000)).toBe(-95);
    expect(rendite(mit([[0, 1], [5_000, 100]]), T0, 5_000)).toBe(500);
  });
});

describe("E237 asymmetrischer Fehler und GBDT 'asymmetrisch'", () => {
  it("zu optimistisch kostet 3× mehr als zu vorsichtig", () => {
    expect(VERLAUF_GEWICHT_FALL).toBe(3);
    expect(asymVerlust(0, 10)).toBe(300); // vorhergesagt +10, passiert 0 → Fall verpasst
    expect(asymVerlust(10, 0)).toBe(100); // Anstieg verpasst
    expect(asymVerlust(-20, 10)).toBe(3 * 900);
    expect(asymVerlust(5, 5)).toBe(0);
    expect(asymVerlust(0, 10, 5)).toBe(500);
    // Expektil: τ = 1/4 – bei symmetrischer Verteilung unter dem Mittelwert, bei Gewicht 1 = Mittelwert
    expect(expektil([1, 2, 3, 4], 1)).toBeCloseTo(2.5, 9);
    expect(expektil([-1, 1])).toBeCloseTo(-0.5, 9); // 3·(e+1) = (1−e) → e = −0,5
    expect(expektil([])).toBe(0);
  });

  it("auf symmetrischem Rauschen liegt die Vorhersage unter dem Mittelwert und schlägt L2 unter dem asymmetrischen Maß", async () => {
    const z = zufallAus(2371);
    const nz = normal(z);
    const n = 6000;
    const X = Array.from({ length: n }, () => [z(), z(), z()]);
    // Ziel hängt von x0 ab (2·x0) plus symmetrisches Rauschen (σ = 1)
    const y = X.map((x) => 2 * x[0]! + nz());
    const lern = X.slice(0, 5000);
    const yl = y.slice(0, 5000);
    const asym = await gbdtTrainieren(lern, yl, { art: "asymmetrisch", baeume: 60 });
    const l2 = await gbdtTrainieren(lern, yl, { art: "quadratisch", baeume: 60 });
    expect(gbdtArt(asym.modell)).toBe("asymmetrisch");
    expect((asym.modell as GbdtModellMitArt).gewichtFall).toBe(3);
    // Start = Expektil der Ziele
    expect(asym.modell.basis).toBeCloseTo(expektil(yl), 9);
    let unter = 0;
    let vAsym = 0;
    let vL2 = 0;
    let abstand = 0;
    for (let i = 5000; i < n; i++) {
      const a = gbdtVorhersagen(asym.modell, X[i]!);
      const q = gbdtVorhersagen(l2.modell, X[i]!);
      const mittel = 2 * X[i]![0]!;
      if (a < mittel) unter++;
      abstand += mittel - a;
      vAsym += asymVerlust(y[i]!, a);
      vL2 += asymVerlust(y[i]!, q);
    }
    // Expektil τ = 0,25 von N(0, 1) ≈ −0,43: deutlich unter dem Mittelwert
    expect(unter / 1000).toBeGreaterThan(0.95);
    expect(abstand / 1000).toBeGreaterThan(0.25);
    expect(abstand / 1000).toBeLessThan(0.65);
    expect(vAsym).toBeLessThan(vL2 * 0.95);
    // gewichtFall wird gespeichert, Vorhersage mit skala 'log' wie quadratisch zurückgerechnet
    const fuenf = await gbdtTrainieren(lern, yl, { art: "asymmetrisch", gewichtFall: 5, baeume: 5 });
    expect((fuenf.modell as GbdtModellMitArt).gewichtFall).toBe(5);
    expect(fuenf.modell.basis).toBeLessThan(asym.modell.basis);
    const log = { ...asym.modell, baeume: [], basis: Math.log1p(0.2), skala: "log" } as GbdtModell;
    expect(gbdtVorhersagen(log, [0, 0, 0])).toBeCloseTo(20, 9);
    // JSON-Weg (gespeichert/geladen) ändert nichts
    const zurueck = JSON.parse(JSON.stringify(asym.modell)) as GbdtModell;
    expect(gbdtArt(zurueck)).toBe("asymmetrisch");
    expect(gbdtVorhersagen(zurueck, X[5001]!)).toBe(gbdtVorhersagen(asym.modell, X[5001]!));
  });
});

describe("E237 Alarm und Rat", () => {
  it("alarmAus: Absturz hat Vorrang, null zählt nicht, Pump-/Absturz-Erkenner, nur bis 2 min", () => {
    expect(alarmAusSignale).toBe(alarmAus);
    expect(alarmAus(signale({}))).toBeNull();
    expect(alarmAus(signale({ verlauf: verlauf({ 30: -10 }) }))).toBe("absturz");
    expect(alarmAus(signale({ verlauf: verlauf({ 30: -9.9 }) }))).toBeNull();
    expect(alarmAus(signale({ verlauf: verlauf({ 60: 15 }) }))).toBe("anstieg");
    expect(alarmAus(signale({ verlauf: verlauf({ 60: 14.9 }) }))).toBeNull();
    // Vorrang Absturz – auch wenn ein anderer Horizont stark steigt
    expect(alarmAus(signale({ verlauf: verlauf({ 5: -12, 120: 40 }) }))).toBe("absturz");
    expect(alarmAus(signale({ pump: 0.9, absturz: 0.6 }))).toBe("absturz");
    expect(alarmAus(signale({ pump: 0.9, absturz: 0.59 }))).toBe("anstieg");
    expect(alarmAus(signale({ pump: 0.4 }))).toBe("anstieg");
    expect(alarmAus(signale({ pump: 0.39 }))).toBeNull();
    // 5 min zählt nicht (Alarm nur bis 2 min)
    expect(alarmAus(signale({ verlauf: verlauf({ 300: -50 }) }))).toBeNull();
    expect(alarmAus(signale({ verlauf: verlauf({ 300: 80 }) }))).toBeNull();
    // eigene Schwellen
    const a = { anstiegProzent: 30, fallProzent: 5 };
    expect(alarmAus(signale({ verlauf: verlauf({ 60: 20 }) }), a)).toBeNull();
    expect(alarmAus(signale({ verlauf: verlauf({ 15: -5 }) }), a)).toBe("absturz");
    // NaN/fehlendes verlauf zählt nicht
    expect(alarmAus(signale({ verlauf: [Number.NaN, null, null, null, null, null] }))).toBeNull();
    expect(alarmAus({ ...signale({}), verlauf: undefined } as unknown as MusterSignale)).toBeNull();
  });

  it("ratAus mit Alarm: absturz → raus bzw. nie kaufen; anstieg → kaufen", () => {
    const fall = verlauf({ 60: -15 });
    const hoch = verlauf({ 30: 25 });
    expect(ratAus(signale({ p: 0.9, verlauf: fall }), false)).toBe("halten");
    expect(ratAus(signale({ p: 0.9, verlauf: fall }), true)).toBe("raus");
    expect(ratAus(signale({ verlauf: hoch }), false)).toBe("kaufen"); // ohne Grundsignal
    expect(ratAus(signale({ p: 0.1, verlauf: hoch }), false)).toBe("kaufen");
    expect(ratAus(signale({ p: 0.9, verlauf: hoch }), true)).toBe("halten");
    expect(ratAus(signale({ pump: 0.5, verlauf: fall }), false)).toBe("halten");
    // eigene Schwellen
    expect(ratAus(signale({ verlauf: hoch }), false, { anstiegProzent: 30, fallProzent: 10 })).toBe("halten");
    // ohne Alarm wie E236
    expect(ratAus(signale({ p: 0.6 }), false)).toBe("kaufen");
    expect(ratAus(signale({ p: 0.29 }), true)).toBe("raus");
  });
});

describe("E237 RL mit Kursvorhersage und Alarm", () => {
  const g = { ...KRYPTO_RL_STANDARD, erkunden: 0 };
  const lage = (o: Partial<RlLageMitAlarm>): RlLageMitAlarm => ({
    p: 0,
    haelt: false,
    plusProzent: 0,
    haltSek: 0,
    trend30Prozent: 0,
    ...o,
  });

  it("Zustand: ohne v1m/v5m unverändert, mit grob in 4 Stufen", () => {
    expect(rlZustand(lage({ p: 0.65, trend30Prozent: 3 }))).toBe("w|6|3");
    expect(rlZustand(lage({ p: 0.65, trend30Prozent: 3, v1m: null, v5m: null }))).toBe("w|6|3");
    expect(rlZustand(lage({ p: 0.65, trend30Prozent: 3, pump: 0.1, absturz: 0.4, hoch5: 35, tief5: -5 }))).toBe(
      "w|6|3|p0a2h2t0",
    );
    expect(rlZustand(lage({ p: 0.65, trend30Prozent: 3, v1m: -6, v5m: null }))).toBe("w|6|3|v0n");
    expect(rlZustand(lage({ p: 0.65, trend30Prozent: 3, v1m: -5, v5m: 10 }))).toBe("w|6|3|v11");
    expect(rlZustand(lage({ p: 0.65, trend30Prozent: 3, v1m: 10.1, v5m: 50 }))).toBe("w|6|3|v22");
    expect(rlZustand(lage({ p: 0.2, haelt: true, absturz: 0.2, hoch5: 12, tief5: -30, v5m: -20 }))).toBe(
      "h|2|2|0|2|a1h1|vn0",
    );
    expect(rlZustand(lage({ p: 0.2, haelt: true }))).toBe("h|2|2|0|2");
    // der Alarm selbst ist kein Teil des Zustands
    expect(rlZustand(lage({ p: 0.2, alarm: "absturz" }))).toBe("w|2|2");
  });

  it("Alarm 'absturz' → nie kaufen, gehalten nur raus – auch mit Erkunden oder Modell, das anders will", () => {
    const boese = { version: 1, q: {} as Record<string, number[]> };
    const z = zufallAus(2372);
    for (let i = 0; i < 2000; i++) {
      const frei = lage({ p: z(), pump: z() * 0.3, trend30Prozent: z() * 20 - 10, alarm: "absturz" });
      boese.q[rlZustand(frei)] = [0, 100, 0, 0];
      expect(rlHandlung(boese, frei, { ...g, erkunden: 0.3 }, z)).toBe("warten");
      expect(rlHandlung(null, frei, g, z)).toBe("warten");
      const drin = lage({ p: 0.9, haelt: true, plusProzent: z() * 40, haltSek: 30, alarm: "absturz" });
      boese.q[rlZustand(drin)] = [100, 0, 50, -100];
      expect(rlHandlung(boese, drin, { ...g, erkunden: 0.3 }, z)).toBe("raus");
    }
    expect(rlErlaubt(lage({ p: 0.99, alarm: "absturz" }), g)).toEqual(["warten"]);
    expect(rlErlaubt(lage({ haelt: true, p: 0.99, alarm: "absturz" }), g)).toEqual(["raus"]);
    // ohne Alarm-Feld: aus v1m abgeleitet
    expect(rlErlaubt(lage({ p: 0.99, v1m: -10 }), g)).toEqual(["warten"]);
    expect(rlErlaubt(lage({ haelt: true, v1m: -12 }), g)).toEqual(["raus"]);
    // ausdrücklich kein Alarm übersteuert die Ableitung
    expect(rlErlaubt(lage({ p: 0.99, v1m: -12, alarm: null }), g)).toEqual(["warten", "kaufen"]);
  });

  it("Alarm 'anstieg' erlaubt den Kauf ohne Grundsignal – die 💥-Sperre gilt weiter", () => {
    expect(rlErlaubt(lage({ alarm: "anstieg" }), g)).toEqual(["warten", "kaufen"]);
    expect(rlHandlung(null, lage({ alarm: "anstieg" }), g, Math.random)).toBe("kaufen");
    expect(rlErlaubt(lage({ v1m: 20 }), g)).toEqual(["warten", "kaufen"]);
    expect(rlErlaubt(lage({ alarm: "anstieg", absturz: 0.4 }), g)).toEqual(["warten"]);
    expect(rlErlaubt(lage({}), g)).toEqual(["warten"]);
  });
});

/**
 * Synthetischer Markt (wie E236): 🚀 Kaufwelle (20 s große Käufe, steigende Kerzen) → danach steigt der Kurs weiter;
 * 💥 ein großer Einzelverkauf → der Kurs fällt in der Minute danach um ~40 %. Ohne Muster: Zufallsweg.
 */
function markt(
  tokens: number,
  z: () => number,
  o: { muster: boolean; minuten?: number; abstand?: number; rate?: number; vol?: number },
): TrainingsDaten {
  const minuten = o.minuten ?? 20;
  const abstand = o.abstand ?? 30_000;
  const rate = o.rate ?? 0.004;
  const vol = o.vol ?? 0.012;
  const ticks = new Map<string, Tick[]>();
  const meta = new Map<string, TokenMeta>();
  for (let k = 0; k < tokens; k++) {
    const mint = `V${k}pump`;
    const start = T0 + k * abstand;
    meta.set(mint, { mint, erstellt: start - 5_000 });
    const liste: Tick[] = [];
    let preis = 1e-7;
    let echt = 3;
    let art: "pump" | "crash" | null = null;
    let phase = 0;
    let ruhe = 20;
    for (let t = start; t < start + minuten * 60_000; t += 1000) {
      if (o.muster && !art && ruhe <= 0) {
        const r = z();
        if (r < rate) art = "pump";
        else if (r < 2 * rate) art = "crash";
        phase = 0;
      }
      let sol: number;
      let r: number;
      if (art === "pump") {
        if (phase < 20) {
          sol = 1.5 + z();
          r = 0.006 + z() * 0.004;
        } else {
          sol = z() - 0.2;
          r = 0.007 + (z() - 0.5) * 0.006;
        }
        if (++phase >= 80) ((art = null), (ruhe = 60));
      } else if (art === "crash") {
        if (phase === 0) {
          sol = -(6 + z() * 2);
          r = -0.06;
        } else {
          sol = -(0.3 + z() * 0.5);
          r = -0.008 + (z() - 0.5) * 0.006;
        }
        if (++phase >= 60) ((art = null), (ruhe = 60));
      } else {
        ruhe--;
        sol = (z() - 0.5) * 1.0;
        r = (z() - 0.5) * vol;
      }
      preis *= 1 + r;
      echt = Math.max(0.1, echt + sol * 0.5 - (echt - 3) * 0.01);
      liste.push({ zeit: t, preis, sol, echtSol: echt });
    }
    ticks.set(mint, liste);
  }
  return { ticks, meta };
}
const ende = (tokens: number, abstand: number, minuten: number) =>
  T0 + tokens * abstand + minuten * 60_000 + 60_000;

/** Anteil der 5-s-Zeitpunkte, an denen der Kurs nach h um mindestens `ab` % fiel (Zufallstreffer eines Alarms) */
function basisRateFall(d: TrainingsDaten, horizontMs: number, ab: number) {
  let n = 0;
  let fall = 0;
  for (const ticks of d.ticks.values())
    for (let t = ticks[0]!.zeit + 120_000; t < ticks[ticks.length - 1]!.zeit; t += 5_000) {
      const r = rendite(ticks, t, horizontMs);
      if (r === null) continue;
      n++;
      if (r <= ab) fall++;
    }
  return fall / n;
}

describe("E237 musterTrainieren mit Kursvorhersage", () => {
  it("vorhersagbarer Anstieg/Fall → Kursvorhersage aktiv, Richtung stimmt, Alarme treffen besser als Zufall; RL sieht sie", async () => {
    const d = markt(60, zufallAus(2373), { muster: true });
    const jetzt = ende(60, 30_000, 20);
    const start = Date.now();
    const e = await musterTrainieren(d, { jetzt, version: 3 });
    console.log(`musterTrainieren E237 (60 Tokens × 20 min): ${Date.now() - start} ms\n${e.bericht}`);
    const m = e.modelle;
    expect(VERLAUF_SCHLUESSEL).toEqual(["verlauf5s", "verlauf15s", "verlauf30s", "verlauf1m", "verlauf2m", "verlauf5m"]);
    for (const k of VERLAUF_SCHLUESSEL) {
      const v = m[k]!;
      expect(v).toBeDefined();
      expect(gbdtArt(v.gbdt)).toBe("asymmetrisch");
      expect(v.gbdt.skala).toBe("log");
      expect(v.info.test.auc).toBeNull();
      expect(v.info.test.fehler).not.toBeNull();
      expect(v.info.test.fehlerBasis).not.toBeNull();
      expect(v.info.aktiv).toBe(v.info.gruende.length === 0);
    }
    for (const k of ["verlauf30s", "verlauf1m"] as const) {
      const i = m[k]!.info;
      expect({ k, aktiv: i.aktiv, gruende: i.gruende }).toEqual({ k, aktiv: true, gruende: [] });
      expect(i.test.fehler!).toBeLessThan(0.95 * i.test.fehlerBasis!);
      expect(i.test.richtung!).toBeGreaterThan(0.6);
    }
    // Alarm 💥 (Vorhersage ≤ −10 %) trifft deutlich öfter als der Zufall (Anteil aller Zeitpunkte mit ≤ −5 %)
    const f = m.verlauf30s!.info.test.alarmFall!;
    expect(f.n).toBeGreaterThan(5);
    const zufall = basisRateFall(d, 30_000, -5);
    expect(f.treffer / f.n).toBeGreaterThan(Math.max(0.5, 2 * zufall));
    const a = m.verlauf1m!.info.test.alarmAnstieg!;
    if (a.n > 0) expect(a.treffer / a.n).toBeGreaterThan(0.3);
    // Bericht: je Horizont eine Zeile
    for (const sek of ["5 s", "15 s", "30 s", "1 min", "2 min", "5 min"])
      expect(e.bericht).toContain(`📈 Kurs in ${sek} (%)`);
    expect(e.bericht).toMatch(/Kurs in 30 s \(%\): \*\*aktiv\*\* – asym\. Fehler .* vs\. Konstante .*Richtung .*Alarm/);
    expect(e.bericht).toMatch(/Signale im Training: .*verlauf1m/);
    // musterSignale mit den aktiven Modellen: verlauf in fester Reihenfolge, Alarm nach einem Absturz-Beginn
    const aktive = Object.fromEntries(
      Object.entries(m).filter(([, v]) => v.info.aktiv).map(([k, v]) => [k, v.gbdt]),
    );
    let absturzAlarme = 0;
    let geprueft = 0;
    for (const [mint, ticks] of d.ticks) {
      for (let i = 130; i < ticks.length - 1; i++) {
        // Beginn eines Absturzes: großer Einzelverkauf mit −6 %
        if (ticks[i]!.sol > -6) continue;
        const s = musterSignale(aktive, ticks, ticks[i]!.zeit + 2_000, d.meta.get(mint)!)!;
        expect(s.verlauf).toHaveLength(KRYPTO_VERLAUF_SEK.length);
        geprueft++;
        if (alarmAus(s) === "absturz") absturzAlarme++;
      }
    }
    expect(geprueft).toBeGreaterThan(10);
    expect(absturzAlarme / geprueft).toBeGreaterThan(0.8);
  }, 240_000);

  it("Rauschen → keine Kursvorhersage aktiv", async () => {
    const d = markt(60, zufallAus(2374), { muster: false, vol: 0.03 });
    const e = await musterTrainieren(d, { jetzt: ende(60, 30_000, 20), version: 1 });
    for (const k of VERLAUF_SCHLUESSEL) {
      const v = e.modelle[k]!;
      expect(v).toBeDefined();
      expect({ k, aktiv: v.info.aktiv }).toEqual({ k, aktiv: false });
    }
    expect(e.bericht).not.toMatch(/Signale im Training: .*verlauf/);
  }, 120_000);

  it("Ersetzen je Schlüssel: schlechter als das alte Verlauf-Modell → nicht aktiv", async () => {
    const d = markt(40, zufallAus(2375), { muster: true });
    const jetzt = ende(40, 30_000, 20);
    const e = await musterTrainieren(d, { jetzt, version: 1 });
    const f = e.modelle.verlauf1m!.info.test.fehler!;
    const e2 = await musterTrainieren(d, { jetzt, version: 2, alt: { verlauf1m: { fehler: f * 0.9 } } });
    expect(e2.modelle.verlauf1m!.info.aktiv).toBe(false);
    expect(e2.modelle.verlauf1m!.info.gruende.join()).toContain("schlechter als das aktive Modell");
  }, 240_000);
});

describe("E237 Laufzeit: 15 GBDTs auf einer Matrix", () => {
  it("100 000 × 35 wie musterTrainieren (80 + 8 × 50 + 6 × 40 asymmetrisch) – moderat und kooperativ", async () => {
    const z = zufallAus(237);
    const n = 100_000;
    const F = MERKMAL_NAMEN.length;
    const X: number[][] = [];
    for (let i = 0; i < n; i++) X.push(Array.from({ length: F }, () => z() * 2 - 1));
    const yW = X.map((x) => (z() < (x[0]! > 0.3 ? 0.8 : 0.1) ? 1 : 0));
    const yV = X.map((x) => Math.log1p((10 * x[1]! + (z() - 0.5) * 4) / 100));
    let abgaben = 0;
    let laengste = 0;
    let letzt = Date.now();
    const abgeben = async () => {
      abgaben++;
      laengste = Math.max(laengste, Date.now() - letzt);
      await new Promise<void>((r) => setImmediate(r));
      letzt = Date.now();
    };
    const start = Date.now();
    const v = await gbdtVorbereiten(X, abgeben, Math.floor(n * 0.8));
    const alle = Array.from({ length: Math.floor(n * 0.8) }, (_, i) => i);
    const jung = alle.filter((i) => i % 12 === 0);
    const plan: { y: number[]; art: "logistisch" | "quadratisch" | "asymmetrisch"; baeume: number; auswahl: number[] }[] = [
      { y: yW, art: "logistisch", baeume: 80, auswahl: alle },
      { y: yW, art: "logistisch", baeume: 50, auswahl: alle },
      { y: yW, art: "logistisch", baeume: 50, auswahl: alle },
      ...Array.from({ length: 4 }, () => ({ y: yV, art: "quadratisch" as const, baeume: 50, auswahl: alle })),
      { y: yW, art: "logistisch", baeume: 50, auswahl: jung },
      { y: yW, art: "logistisch", baeume: 50, auswahl: jung },
      ...Array.from({ length: 6 }, () => ({ y: yV, art: "asymmetrisch" as const, baeume: 40, auswahl: alle })),
    ];
    const modelle: GbdtModell[] = [];
    for (const p of plan)
      modelle.push(
        (await gbdtTrainieren(X, p.y, { art: p.art, baeume: p.baeume, vorbereitung: v, auswahl: p.auswahl }, abgeben))
          .modell,
      );
    const dauer = Date.now() - start;
    console.log(`15 GBDTs 100000×${F}: ${dauer} ms, ${abgaben} Abgaben, längste Strecke ohne Abgabe ${laengste} ms`);
    expect(dauer).toBeLessThan(40_000);
    expect(laengste).toBeLessThan(500);
    // das asymmetrische Modell hat gelernt (x1 erklärt das Ziel) und liegt vorsichtig darunter
    const test = X.slice(80_000, 82_000);
    const asym = modelle[modelle.length - 1]!;
    let unter = 0;
    let fehler = 0;
    test.forEach((x, i) => {
      const p = gbdtVorhersagen(asym, x);
      fehler += Math.abs(p - yV[80_000 + i]!);
      if (p < Math.log1p((10 * x[1]!) / 100)) unter++;
    });
    expect(fehler / test.length).toBeLessThan(0.03);
    expect(unter / test.length).toBeGreaterThan(0.7);
  }, 120_000);
});
