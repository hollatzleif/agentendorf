import { describe, expect, it } from "vitest";
import { KRYPTO_RL_STANDARD } from "@dorf/shared";
import {
  auc,
  gbdtArt,
  gbdtTrainieren,
  gbdtVorbereiten,
  gbdtVorhersagen,
} from "../src/krypto/muster/gbdt.js";
import {
  MERKMAL_NAMEN,
  extreme,
  label,
  merkmale,
  ratAus,
} from "../src/krypto/muster/merkmale.js";
import {
  rlErlaubt,
  rlHandlung,
  rlZustand,
  zufallAus,
} from "../src/krypto/muster/rl.js";
import { musterSignale } from "../src/krypto/muster/signale.js";
import {
  musterTrainieren,
  wertBootstrapAnteil,
  type TrainingsDaten,
} from "../src/krypto/muster/training.js";
import {
  ABSTURZ_ZIEL,
  FRUEH_ALTER_MS,
  PUMP_ZIEL,
  type GbdtModell,
  type MusterSignale,
  type RlLage,
  type Tick,
  type TokenMeta,
} from "../src/krypto/muster/typen.js";

/** E236: Muster-Modell sieht mehr – Pump/Absturz, Hoch/Tief, Früh-Modell, RL mit allen Signalen. Ohne Netz, Zufall fest. */

const T0 = Date.UTC(2026, 10, 24, 12, 0, 0);

const mit = (preise: [number, number][]): Tick[] =>
  preise.map(([dt, p]) => ({ zeit: T0 + dt, preis: p, sol: 0, echtSol: 1 }));

const signale = (o: Partial<MusterSignale>): MusterSignale => ({
  p: null,
  pump: null,
  absturz: null,
  hoch1: null,
  tief1: null,
  hoch5: null,
  tief5: null,
  frueh: false,
  ...o,
});

describe("E236 Label in beide Richtungen und extreme()", () => {
  it("richtung 'ab': erst −30 % → 1, erst +20 % → 0, Horizont ohne Absturz → 0, nicht abgedeckt → null", () => {
    expect(
      label(
        mit([
          [0, 100],
          [10_000, 85],
          [20_000, 69],
          [30_000, 130],
          [130_000, 100],
        ]),
        T0,
        ABSTURZ_ZIEL,
      ),
    ).toBe(1);
    expect(
      label(
        mit([
          [0, 100],
          [10_000, 121],
          [20_000, 50],
          [130_000, 100],
        ]),
        T0,
        ABSTURZ_ZIEL,
      ),
    ).toBe(0);
    expect(
      label(
        mit([
          [0, 100],
          [10_000, 80],
          [125_000, 50],
        ]),
        T0,
        ABSTURZ_ZIEL,
      ),
    ).toBe(0); // −50 % erst nach 2 min
    expect(
      label(
        mit([
          [0, 100],
          [10_000, 60],
        ]),
        T0,
        ABSTURZ_ZIEL,
      ),
    ).toBeNull();
    // gleiche Reihe, Pump-Ziel: +50 % vor −20 %
    expect(
      label(
        mit([
          [0, 100],
          [30_000, 151],
          [120_000, 90],
        ]),
        T0,
        PUMP_ZIEL,
      ),
    ).toBe(1);
  });

  it("extreme: Hoch/Tief in % gegenüber dem Kurs bei t, Kurs bei t zählt mit, begrenzt; null ohne Abdeckung", () => {
    const ticks = mit([
      [-5_000, 100],
      [10_000, 130],
      [20_000, 70],
      [50_000, 110],
      [70_000, 300], // nach 1 min – zählt nur für längere Horizonte
      [400_000, 100],
    ]);
    const e1 = extreme(ticks, T0, 60_000)!;
    expect(e1.hoch).toBeCloseTo(30, 8);
    expect(e1.tief).toBeCloseTo(-30, 8);
    const e5 = extreme(ticks, T0, 300_000)!;
    expect(e5.hoch).toBeCloseTo(200, 8);
    expect(e5.tief).toBeCloseTo(-30, 8);
    // nur steigend: tief = 0 (Kurs bei t zählt mit)
    expect(
      extreme(
        mit([
          [0, 100],
          [10_000, 120],
          [60_000, 110],
        ]),
        T0,
        60_000,
      ),
    ).toEqual({ hoch: expect.closeTo(20, 8), tief: 0 });
    // Ausreißer begrenzt
    const wild = extreme(
      mit([
        [0, 1],
        [10_000, 100],
        [20_000, 0.001],
        [60_000, 1],
      ]),
      T0,
      60_000,
    )!;
    expect(wild).toEqual({ hoch: 500, tief: -95 });
    // nicht abgedeckt
    expect(extreme(ticks, T0 + 350_000, 60_000)).toBeNull();
    expect(extreme([], T0, 60_000)).toBeNull();
  });

  it("Früh-Merkmale: seit dem ersten Tick (höchstens 10 min), größter Einzelkauf/-verkauf", () => {
    const meta: TokenMeta = { mint: "F", erstellt: T0 - 2000 };
    const ticks: Tick[] = [];
    for (let i = 0; i < 40; i++)
      ticks.push({
        zeit: T0 + i * 1000,
        preis: 100 * (1 + i * 0.01),
        sol: i === 30 ? -4 : i % 4 === 0 ? -0.2 : 0.5 + (i === 35 ? 2 : 0),
        echtSol: 5,
      });
    const x = merkmale(ticks, T0 + 39_000, meta)!;
    const n = (name: string) => x[MERKMAL_NAMEN.indexOf(name)]!;
    expect(MERKMAL_NAMEN.length).toBe(35);
    expect(x).toHaveLength(MERKMAL_NAMEN.length);
    expect(n("sekSeitErstemTick")).toBe(39);
    expect(n("kaeufeSeitStart")).toBe(29);
    expect(n("verkaeufeSeitStart")).toBe(11);
    expect(n("renditeSeitStart")).toBeCloseTo(39, 6);
    expect(n("hoechsteRenditeSeitStart")).toBeCloseTo(39, 6);
    expect(n("groessterVerkauf30s")).toBe(4);
    expect(n("groessterKauf30s")).toBe(2.5);
    // nach mehr als 10 min zählt nur das Fenster (wie live im Kryptowerk)
    const lang: Tick[] = Array.from({ length: 800 }, (_, i) => ({
      zeit: T0 + i * 1000,
      preis: 100,
      sol: 1,
      echtSol: 5,
    }));
    const y = merkmale(lang, T0 + 799_000, meta)!;
    expect(y[MERKMAL_NAMEN.indexOf("sekSeitErstemTick")]).toBe(599);
    expect(y[MERKMAL_NAMEN.indexOf("kaeufeSeitStart")]).toBe(600);
  });
});

describe("E236 ratAus mit allen Signalen", () => {
  it("kaufen/halten/raus nach den Regeln", () => {
    expect(ratAus(signale({ p: 0.6 }), false)).toBe("kaufen");
    expect(ratAus(signale({ p: 0.6, absturz: 0.35 }), false)).toBe("halten");
    expect(ratAus(signale({ p: 0.6, absturz: 0.34 }), false)).toBe("kaufen");
    expect(ratAus(signale({ pump: 0.3 }), false)).toBe("kaufen"); // ohne Grundsignal
    expect(ratAus(signale({ p: 0.2, pump: 0.31 }), false)).toBe("kaufen");
    expect(ratAus(signale({ p: 0.5, pump: 0.29 }), false)).toBe("halten");
    expect(ratAus(signale({}), false)).toBe("halten");
    expect(ratAus(signale({ absturz: 0.5 }), true)).toBe("raus");
    expect(ratAus(signale({ p: 0.9, absturz: 0.49 }), true)).toBe("halten");
    expect(ratAus(signale({ p: 0.29 }), true)).toBe("raus");
    expect(ratAus(signale({ pump: 0.9 }), true)).toBe("halten");
    expect(ratAus(signale({ p: 0.95 }), true)).toBe("halten");
  });
});

/** y = 3·x0 − 2·x1 + Rauschen, Werte weit außerhalb 0–1 */
function linear(n: number, z: () => number) {
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = Array.from({ length: 6 }, () => z() * 20 - 10);
    X.push(x);
    y.push(3 * x[0]! - 2 * x[1]! + 5 + (z() - 0.5) * 4);
  }
  return { X, y };
}

describe("E236 GBDT quadratisch", () => {
  it("lernt eine lineare Beziehung – Fehler weit unter dem Median-Fehler, Werte statt 0–1", async () => {
    const z = zufallAus(236);
    const lern = linear(6000, z);
    const test = linear(2000, z);
    const { modell, wichtigkeit } = await gbdtTrainieren(lern.X, lern.y, {
      art: "quadratisch",
      baeume: 120,
    });
    expect(gbdtArt(modell)).toBe("quadratisch");
    const v = test.X.map((x) => gbdtVorhersagen(modell, x));
    const median = [...lern.y].sort((a, b) => a - b)[lern.y.length >> 1]!;
    const mae = v.reduce((s, w, i) => s + Math.abs(w - test.y[i]!), 0) / v.length;
    const maeMedian =
      test.y.reduce((s, w) => s + Math.abs(median - w), 0) / test.y.length;
    expect(mae).toBeLessThan(0.3 * maeMedian);
    expect(Math.max(...v)).toBeGreaterThan(20);
    expect(Math.min(...v)).toBeLessThan(-10);
    // wichtig sind x0 und x1
    const rang = wichtigkeit
      .map((w, i) => [w, i] as const)
      .sort((a, b) => b[0] - a[0])
      .slice(0, 2)
      .map(([, i]) => i);
    expect(new Set(rang)).toEqual(new Set([0, 1]));
    // JSON-fähig, Art bleibt
    const kopie = JSON.parse(JSON.stringify(modell)) as GbdtModell;
    expect(gbdtVorhersagen(kopie, test.X[0]!)).toBeCloseTo(v[0]!, 10);
    // logistisch bleibt 0–1 und Modelle ohne art gelten als logistisch (E235-Modelle)
    const l = await gbdtTrainieren(
      lern.X,
      lern.y.map((w) => (w > 5 ? 1 : 0)),
      { baeume: 10 },
    );
    expect(gbdtArt(l.modell)).toBe("logistisch");
    expect("art" in l.modell).toBe(false);
    for (const x of test.X.slice(0, 50)) {
      const p = gbdtVorhersagen(l.modell, x);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it("auswahl + vorbereitung: gleiches Modell wie auf der Teilmenge allein", async () => {
    const z = zufallAus(7);
    const { X, y } = linear(3000, z);
    const auswahl = Array.from({ length: 1500 }, (_, i) => i * 2);
    const v = await gbdtVorbereiten(X);
    const a = await gbdtTrainieren(X, y, {
      art: "quadratisch",
      baeume: 20,
      vorbereitung: v,
      auswahl,
    });
    const b = await gbdtTrainieren(X, y, {
      art: "quadratisch",
      baeume: 20,
      auswahl,
    });
    expect(a.modell).toEqual(b.modell);
    expect(a.modell.basis).toBeCloseTo(
      auswahl.reduce((s, i) => s + y[i]!, 0) / auswahl.length,
      8,
    );
  });

  it("Bootstrap für Wert-Modelle: klar besser → 1, gleich → um 0,5", () => {
    const tok = Array.from({ length: 400 }, (_, i) => `T${i % 20}`);
    const fm = tok.map((_, i) => 1 + (i % 3));
    expect(
      wertBootstrapAnteil(
        fm,
        fm.map((v) => v + 2),
        tok,
      ),
    ).toBe(1);
    const z = zufallAus(3);
    const a = tok.map(() => z());
    const b = tok.map(() => z());
    const anteil = wertBootstrapAnteil(a, b, tok);
    expect(anteil).toBeGreaterThan(0.02);
    expect(anteil).toBeLessThan(0.98);
  });
});

describe("E236 musterSignale", () => {
  const logit = (p: number) => Math.log(p / (1 - p));
  const wModell = (p: number): GbdtModell => ({
    version: 1,
    merkmale: [...MERKMAL_NAMEN],
    basis: logit(p),
    lernrate: 0.1,
    baeume: [],
  });
  const vModell = (w: number): GbdtModell =>
    ({
      version: 1,
      merkmale: [...MERKMAL_NAMEN],
      basis: w,
      lernrate: 0.1,
      baeume: [],
      art: "quadratisch",
    }) as GbdtModell;
  const ticks: Tick[] = Array.from({ length: 300 }, (_, i) => ({
    zeit: T0 + i * 1000,
    preis: 1e-7 * (1 + i * 0.001),
    sol: 0.3,
    echtSol: 3 + i * 0.1,
  }));
  const meta: TokenMeta = { mint: "S", erstellt: T0 - 10_000 };

  it("Früh-Modell nur bei Alter ≤ 90 s (frueh: true), sonst die allgemeinen; fehlende Modelle → null", () => {
    const modelle = {
      basis: wModell(0.7),
      pump: wModell(0.1),
      absturz: wModell(0.2),
      fruehPump: wModell(0.4),
      fruehAbsturz: wModell(0.05),
      hoch5: vModell(42),
      tief1: vModell(-200), // außerhalb → begrenzt
    };
    const jung = musterSignale(modelle, ticks, T0 + 60_000, meta)!; // Alter 70 s
    expect(jung.frueh).toBe(true);
    expect(jung.pump).toBeCloseTo(0.4, 8);
    expect(jung.absturz).toBeCloseTo(0.05, 8);
    expect(jung.p).toBeCloseTo(0.7, 8);
    expect(jung.hoch5).toBeCloseTo(42, 8);
    expect(jung.tief1).toBe(-95);
    expect(jung.hoch1).toBeNull();
    expect(jung.tief5).toBeNull();
    const grenze = musterSignale(
      modelle,
      ticks,
      meta.erstellt + FRUEH_ALTER_MS,
      meta,
    )!;
    expect(grenze.frueh).toBe(true);
    const alt = musterSignale(modelle, ticks, T0 + 200_000, meta)!; // Alter 210 s
    expect(alt.frueh).toBe(false);
    expect(alt.pump).toBeCloseTo(0.1, 8);
    expect(alt.absturz).toBeCloseTo(0.2, 8);
    // jung, aber ohne Früh-Modelle → allgemeine, frueh false
    const ohne = musterSignale(
      { pump: wModell(0.1) },
      ticks,
      T0 + 60_000,
      meta,
    )!;
    expect(ohne).toEqual(signale({ pump: expect.closeTo(0.1, 8) }));
    // keine Modelle → alles null; zu wenig Ticks → null
    expect(musterSignale({}, ticks, T0 + 60_000, meta)).toEqual(signale({}));
    expect(musterSignale(modelle, ticks.slice(0, 2), T0 + 2000, meta)).toBeNull();
    // veraltetes Modell (andere Merkmalsliste) sagt nichts
    const veraltet = { ...wModell(0.9), merkmale: MERKMAL_NAMEN.slice(0, 27) };
    expect(musterSignale({ basis: veraltet }, ticks, T0 + 60_000, meta)!.p).toBeNull();
  });
});

describe("E236 RL mit allen Signalen", () => {
  const g = { ...KRYPTO_RL_STANDARD, erkunden: 0 };
  const lage = (o: Partial<RlLage>): RlLage => ({
    p: 0,
    haelt: false,
    plusProzent: 0,
    haltSek: 0,
    trend30Prozent: 0,
    ...o,
  });

  it("Zustand: ohne Signale wie E235, mit Signalen grob gestuft", () => {
    expect(rlZustand(lage({ p: 0.65, trend30Prozent: 3 }))).toBe("w|6|3");
    expect(
      rlZustand(lage({ p: 0.65, trend30Prozent: 3, pump: null, absturz: null })),
    ).toBe("w|6|3");
    expect(
      rlZustand(
        lage({ p: 0.65, trend30Prozent: 3, pump: 0.1, absturz: 0.4, hoch5: 35, tief5: -5 }),
      ),
    ).toBe("w|6|3|p0a2h2t0");
    expect(rlZustand(lage({ p: 0.2, pump: 0.2 }))).toBe("w|2|2|p1anhntn");
    expect(
      rlZustand(lage({ p: 0.2, haelt: true, absturz: 0.2, hoch5: 12, tief5: -30 })),
    ).toBe("h|2|2|0|2|a1h1");
    // Zustandsraum klein: höchstens 4 Signalstufen je Feld
    const z = zufallAus(5);
    const s = new Set<string>();
    for (let i = 0; i < 20_000; i++)
      s.add(
        rlZustand(
          lage({
            p: z(),
            trend30Prozent: z() * 20 - 10,
            pump: z(),
            absturz: z(),
            hoch5: z() * 100,
            tief5: -z() * 60,
          }),
        ),
      );
    expect(s.size).toBeLessThanOrEqual(10 * 5 * 3 * 3 * 3 * 3);
  });

  it("kein Kauf ab absturz ≥ maxAbsturz – auch nicht mit Erkunden oder Modell, das kaufen will", () => {
    const boese = { version: 1, q: {} as Record<string, number[]> };
    const z = zufallAus(9);
    for (let i = 0; i < 3000; i++) {
      const l = lage({
        p: z(),
        pump: z(),
        absturz: 0.35 + z() * 0.65,
        trend30Prozent: z() * 20 - 10,
      });
      boese.q[rlZustand(l)] = [0, 100, 0, 0];
      expect(rlHandlung(boese, l, { ...g, erkunden: 0.3 }, z)).toBe("warten");
      expect(rlHandlung(null, l, g, z)).toBe("warten");
    }
    expect(rlErlaubt(lage({ p: 0.9, absturz: 0.35 }), g)).toEqual(["warten"]);
    expect(rlErlaubt(lage({ p: 0.9, absturz: 0.34 }), g)).toEqual(["warten", "kaufen"]);
    // eigene Grenze
    expect(rlErlaubt(lage({ p: 0.9, absturz: 0.2 }), { ...g, maxAbsturz: 0.2 })).toEqual(["warten"]);
    // ohne maxAbsturz gilt 0,35
    const { maxAbsturz: _weg, ...ohne } = g;
    expect(rlErlaubt(lage({ p: 0.9, absturz: 0.36 }), ohne)).toEqual(["warten"]);
  });

  it("gehalten und absturz ≥ 0,7 → nur raus (auch wenn das Modell halten will)", () => {
    const l = lage({ p: 0.9, haelt: true, plusProzent: 15, haltSek: 40, absturz: 0.7 });
    expect(rlErlaubt(l, g)).toEqual(["raus"]);
    const q = { version: 1, q: { [rlZustand(l)]: [100, 0, 50, -100] } };
    const z = zufallAus(1);
    for (let i = 0; i < 200; i++)
      expect(rlHandlung(q, l, { ...g, erkunden: 0.3 }, z)).toBe("raus");
    // darunter wieder frei; Regel ohne Modell: raus ab 0,5
    expect(rlErlaubt({ ...l, absturz: 0.69 }, g)).toEqual(["warten", "halb", "raus"]);
    expect(rlHandlung(null, { ...l, absturz: 0.5 }, g, Math.random)).toBe("raus");
    expect(rlHandlung(null, { ...l, absturz: 0.4 }, g, Math.random)).toBe("warten");
  });

  it("Kauf über pump ≥ 0,3 auch ohne Grundsignal (p = 0)", () => {
    expect(rlErlaubt(lage({ pump: 0.3 }), g)).toEqual(["warten", "kaufen"]);
    expect(rlErlaubt(lage({ pump: 0.29 }), g)).toEqual(["warten"]);
    expect(rlHandlung(null, lage({ pump: 0.45 }), g, Math.random)).toBe("kaufen");
    expect(rlHandlung(null, lage({ pump: 0.45, absturz: 0.4 }), g, Math.random)).toBe("warten");
    // gehalten nach Pump-Kauf: bleibt drin, solange 🚀 ≥ 0,3; raus, wenn es nachlässt
    expect(
      rlHandlung(null, lage({ haelt: true, pump: 0.5, plusProzent: 5 }), g, Math.random),
    ).toBe("warten");
    expect(
      rlHandlung(null, lage({ haelt: true, pump: 0.1, plusProzent: 5 }), g, Math.random),
    ).toBe("raus");
  });
});

/**
 * Synthetischer Markt mit zwei echten Mustern:
 * 🚀 Kaufwelle (20 s große Käufe, steigende Kerzen) → danach steigt der Kurs weiter, insgesamt deutlich über +50 %;
 * 💥 ein großer Einzelverkauf mit fallenden echten SOL → der Kurs fällt in der Minute danach um ~40 %.
 * Ohne Muster: Zufallsweg, Käufe und Kurs unabhängig.
 */
function markt(
  tokens: number,
  z: () => number,
  o: {
    muster: boolean;
    minuten?: number;
    abstand?: number;
    rate?: number;
    vol?: number;
    erstelltVorher?: number;
  },
): TrainingsDaten {
  const minuten = o.minuten ?? 20;
  const abstand = o.abstand ?? 30_000;
  const rate = o.rate ?? 0.004;
  const vol = o.vol ?? 0.012;
  const ticks = new Map<string, Tick[]>();
  const meta = new Map<string, TokenMeta>();
  for (let k = 0; k < tokens; k++) {
    const mint = `M${k}pump`;
    const start = T0 + k * abstand;
    meta.set(mint, { mint, erstellt: start - (o.erstelltVorher ?? 5_000) });
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

describe("E236 musterTrainieren mit allen Modellen", () => {
  it("echte Pump-/Absturz-Muster → pump und absturz aktiv, Wert-Modelle besser als der Median; ersetzt je Schlüssel", async () => {
    const d = markt(60, zufallAus(2361), { muster: true });
    const jetzt = ende(60, 30_000, 20);
    let abgaben = 0;
    const fortschritt: number[] = [];
    const start = Date.now();
    const e = await musterTrainieren(d, {
      jetzt,
      version: 7,
      abgeben: async () => {
        abgaben++;
      },
      fortschritt: (x) => fortschritt.push(x),
    });
    console.log(
      `musterTrainieren E236 (60 Tokens × 20 min): ${Date.now() - start} ms, ${abgaben} Abgaben\n${e.bericht}`,
    );
    const m = e.modelle;
    expect(m.pump?.info.aktiv).toBe(true);
    expect(m.absturz?.info.aktiv).toBe(true);
    expect(m.pump!.info.test.auc!).toBeGreaterThan(0.7);
    expect(m.absturz!.info.test.auc!).toBeGreaterThan(0.7);
    expect(m.pump!.info.test.aucUntergrenze!).toBeGreaterThan(0.5);
    // Wert-Modelle: besser als stur der Median
    for (const k of ["hoch1", "tief1"] as const) {
      const i = m[k]!.info;
      expect(i.aktiv).toBe(true);
      expect(i.test.fehler!).toBeLessThan(0.95 * i.test.fehlerBasis!);
      expect(i.test.auc).toBeNull();
      expect(gbdtArt(m[k]!.gbdt)).toBe("quadratisch");
    }
    // vollständige Infos, Abwärtskompatibilität
    for (const [k, v] of Object.entries(m)) {
      expect(v.info.schluessel).toBe(k);
      expect(v.info.version).toBe(7);
      expect(v.gbdt.version).toBe(7);
      expect(v.info.merkmale).toHaveLength(MERKMAL_NAMEN.length);
      expect(v.info.aktiv).toBe(v.info.gruende.length === 0);
      if (!k.startsWith("frueh")) expect(v.info.test.tokens).toBeGreaterThan(0);
    }
    expect(e.gbdt).toBe(m.basis!.gbdt);
    expect(e.modell!.aktiv).toBe(m.basis!.info.aktiv);
    expect(e.modell!.test.auc).toBe(m.basis!.info.test.auc);
    expect(e.rl).not.toBeNull();
    // Bericht: eine Zeile je Modell
    expect(e.bericht).toContain("🚀 Pump (+50 % vor −20 %, 2 min): **aktiv**");
    expect(e.bericht).toContain("💥 Absturz (−30 % vor +20 %, 2 min): **aktiv**");
    expect(e.bericht).toContain("Hoch in 1 min (%)");
    expect(e.bericht).toContain("Median");
    expect(e.bericht).toMatch(/Signale im Training: .*pump.*absturz/);
    // kooperativ und Fortschritt monoton 0 → 1
    expect(abgaben).toBeGreaterThan(50);
    expect(fortschritt[0]).toBe(0);
    expect(fortschritt[fortschritt.length - 1]).toBe(1);
    for (let i = 1; i < fortschritt.length; i++)
      expect(fortschritt[i]).toBeGreaterThanOrEqual(fortschritt[i - 1]!);

    // Ersetzen je Schlüssel: alte Pump-/Hoch1-Modelle besser → nicht aktiv; die übrigen unberührt
    const e2 = await musterTrainieren(d, {
      jetzt,
      version: 8,
      alt: {
        pump: { auc: m.pump!.info.test.auc! + 0.05 },
        hoch1: { fehler: m.hoch1!.info.test.fehler! * 0.9 },
        absturz: { auc: m.absturz!.info.test.auc! + 0.005 }, // fast gleich → ersetzt
      },
    });
    expect(e2.modelle.pump!.info.aktiv).toBe(false);
    expect(e2.modelle.pump!.info.gruende.join()).toContain("schlechter als das aktive Modell");
    expect(e2.modelle.hoch1!.info.aktiv).toBe(false);
    expect(e2.modelle.hoch1!.info.gruende.join()).toContain("schlechter als das aktive Modell");
    expect(e2.modelle.absturz!.info.aktiv).toBe(true);
    expect(e2.modelle.tief1!.info.aktiv).toBe(true);
    // RL nimmt für Pump dann das übergebene bisherige Modell
    const e3 = await musterTrainieren(d, {
      jetzt,
      version: 9,
      alt: { pump: { auc: 0.99 } },
      aktuelle: { pump: m.pump!.gbdt },
    });
    expect(e3.modelle.pump!.info.aktiv).toBe(false);
    expect(e3.bericht).toContain("pump (bisheriges)");
  }, 240_000);

  it("auf Rauschen ist nichts aktiv", async () => {
    const d = markt(60, zufallAus(2362), { muster: false, vol: 0.03 });
    const e = await musterTrainieren(d, {
      jetzt: ende(60, 30_000, 20),
      version: 1,
    });
    console.log(e.bericht);
    for (const [k, v] of Object.entries(e.modelle))
      expect({ k, aktiv: v.info.aktiv }).toEqual({ k, aktiv: false });
    expect(e.modelle.pump!.info.gruende.join()).toContain("zu wenige Pumps im Test");
    expect(e.modell!.aktiv).toBe(false);
    expect(e.bericht).toContain("keine aktiven (p = 0)");
  }, 120_000);

  it("Früh-Modelle lernen nur auf jungen Zeitpunkten; ohne junge Tokens werden sie nicht trainiert", async () => {
    // viele kurze Tokens ab ihrer Erstellung
    const d = markt(160, zufallAus(2363), {
      muster: true,
      minuten: 7,
      abstand: 12_000,
      rate: 0.01,
    });
    const jetzt = ende(160, 12_000, 7);
    const e = await musterTrainieren(d, { jetzt, version: 1 });
    const fp = e.modelle.fruehPump!;
    expect(fp).toBeDefined();
    expect(e.modelle.fruehAbsturz).toBeDefined();
    // höchstens ~17 junge Zeitpunkte (alle 5 s bis 90 s) je Token
    expect(fp.info.beispiele).toBeLessThanOrEqual(160 * (FRUEH_ALTER_MS / 5000 + 1));
    expect(fp.info.beispiele).toBeLessThan(e.modelle.pump!.info.beispiele / 3);
    expect(fp.info.beispiele).toBeGreaterThanOrEqual(500);

    // dieselben Tokens, aber 10 min vor der Aufzeichnung erstellt → keine jungen Zeitpunkte
    const alt = markt(60, zufallAus(2364), {
      muster: true,
      erstelltVorher: 600_000,
    });
    const e2 = await musterTrainieren(alt, {
      jetzt: ende(60, 30_000, 20),
      version: 1,
    });
    expect(e2.modelle.fruehPump).toBeUndefined();
    expect(e2.modelle.fruehAbsturz).toBeUndefined();
    expect(e2.bericht).toMatch(/Früh-Modell.*nicht trainiert – zu wenig Daten \(0 Lernbeispiele/);
    expect(e2.modelle.pump).toBeDefined();
  }, 180_000);
});

describe("E236 Laufzeit: neun GBDTs auf einer Matrix", () => {
  it("100 000 × 35, Stufen einmal, je Modell eigene Zeilen – in moderater Zeit und kooperativ", async () => {
    const z = zufallAus(99);
    const n = 100_000;
    const F = MERKMAL_NAMEN.length;
    const X: number[][] = [];
    for (let i = 0; i < n; i++) X.push(Array.from({ length: F }, () => z() * 2 - 1));
    const yW = X.map((x) => (z() < (x[0]! > 0.3 ? 0.8 : 0.1) ? 1 : 0));
    const yV = X.map((x) => 10 * x[1]! + (z() - 0.5) * 4);
    let abgaben = 0;
    let laengste = 0;
    let letzt = Date.now();
    const abgeben = async () => {
      abgaben++;
      const jetzt = Date.now();
      laengste = Math.max(laengste, jetzt - letzt);
      await new Promise<void>((r) => setImmediate(r));
      letzt = Date.now();
    };
    const start = Date.now();
    const v = await gbdtVorbereiten(X, abgeben, Math.floor(n * 0.8));
    const alle = Array.from({ length: Math.floor(n * 0.8) }, (_, i) => i);
    const jung = alle.filter((i) => i % 12 === 0);
    // wie musterTrainieren: Grundsignal 80 Bäume, 2 weitere Wahrscheinlichkeiten + 4 Werte mit 50, 2 Früh-Modelle auf wenigen Zeilen
    const plan: { y: number[]; art: "logistisch" | "quadratisch"; baeume: number; auswahl: number[] }[] = [
      { y: yW, art: "logistisch", baeume: 80, auswahl: alle },
      { y: yW, art: "logistisch", baeume: 50, auswahl: alle },
      { y: yW, art: "logistisch", baeume: 50, auswahl: alle },
      { y: yV, art: "quadratisch", baeume: 50, auswahl: alle },
      { y: yV, art: "quadratisch", baeume: 50, auswahl: alle },
      { y: yV, art: "quadratisch", baeume: 50, auswahl: alle },
      { y: yV, art: "quadratisch", baeume: 50, auswahl: alle },
      { y: yW, art: "logistisch", baeume: 50, auswahl: jung },
      { y: yW, art: "logistisch", baeume: 50, auswahl: jung },
    ];
    const modelle: GbdtModell[] = [];
    for (const p of plan)
      modelle.push(
        (await gbdtTrainieren(X, p.y, { art: p.art, baeume: p.baeume, vorbereitung: v, auswahl: p.auswahl }, abgeben))
          .modell,
      );
    const dauer = Date.now() - start;
    console.log(`9 GBDTs 100000×${F}: ${dauer} ms, ${abgaben} Abgaben, längste Strecke ohne Abgabe ${laengste} ms`);
    expect(dauer).toBeLessThan(40_000);
    expect(abgaben).toBeGreaterThan(450);
    expect(laengste).toBeLessThan(500);
    // sie haben auch etwas gelernt
    const test = X.slice(80_000, 82_000);
    expect(auc(test.map((x) => gbdtVorhersagen(modelle[0]!, x)), yW.slice(80_000, 82_000))).toBeGreaterThan(0.75);
    const mae =
      test.reduce((s, x, i) => s + Math.abs(gbdtVorhersagen(modelle[3]!, x) - yV[80_000 + i]!), 0) / test.length;
    expect(mae).toBeLessThan(2.5);
  }, 120_000);
});
