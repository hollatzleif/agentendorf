import { describe, expect, it } from "vitest";
import { KRYPTO_RL_STANDARD } from "@dorf/shared";
import {
  auc,
  gbdtTrainieren,
  gbdtVorhersagen,
} from "../src/krypto/muster/gbdt.js";
import {
  MERKMAL_NAMEN,
  label,
  merkmale,
  ratAus,
} from "../src/krypto/muster/merkmale.js";
import {
  rlErlaubt,
  rlHandlung,
  rlTrainieren,
  rlZeitraffer,
  rlZustand,
  zufallAus,
  type RlEpisode,
} from "../src/krypto/muster/rl.js";
import {
  musterTrainieren,
  type TrainingsDaten,
} from "../src/krypto/muster/training.js";
import {
  STANDARD_ZIEL,
  type RlLage,
  type Tick,
  type TokenMeta,
} from "../src/krypto/muster/typen.js";

/** E235: Muster-Kern – Merkmale, Label, GBDT, AUC, RL, Training. Alles ohne Netz, Zufall fest. */

const T0 = Date.UTC(2026, 10, 24, 12, 0, 0);
const META: TokenMeta = { mint: "TESTpump", erstellt: T0 - 60_000 };

function reihe(n: number, z: () => number, start = T0, abstand = 1000): Tick[] {
  const ticks: Tick[] = [];
  let preis = 1e-7;
  let echt = 5;
  for (let i = 0; i < n; i++) {
    const sol = (z() - 0.45) * 2;
    preis *= 1 + (z() - 0.5) * 0.02;
    echt = Math.max(0, echt + sol);
    ticks.push({ zeit: start + i * abstand, preis, sol, echtSol: echt });
  }
  return ticks;
}

describe("E235 Merkmale", () => {
  it("liefert endliche Zahlen in der Länge von MERKMAL_NAMEN", () => {
    const ticks = reihe(300, zufallAus(1));
    const x = merkmale(ticks, T0 + 200_000, META)!;
    expect(x).toHaveLength(MERKMAL_NAMEN.length);
    expect(MERKMAL_NAMEN.length).toBeGreaterThanOrEqual(20);
    for (const v of x) expect(Number.isFinite(v)).toBe(true);
    expect(x[MERKMAL_NAMEN.indexOf("devTokens24h")]).toBe(-1);
    expect(
      merkmale(ticks, T0 + 200_000, { ...META, devTokens24h: 4 })![
        MERKMAL_NAMEN.indexOf("devTokens24h")
      ],
    ).toBe(4);
    expect(x[MERKMAL_NAMEN.indexOf("alterSek")]).toBe(260);
    expect(x[MERKMAL_NAMEN.indexOf("abstandHoch120s")]).toBeLessThanOrEqual(0);
  });

  it("NaN/Unendlich werden 0, null bei zu wenig Ticks", () => {
    const ticks: Tick[] = [
      { zeit: T0, preis: 1e-7, sol: 0, echtSol: NaN },
      { zeit: T0 + 1000, preis: 1.1e-7, sol: 1, echtSol: NaN },
      { zeit: T0 + 2000, preis: 1.2e-7, sol: 1, echtSol: Infinity },
    ];
    const x = merkmale(ticks, T0 + 2000, META)!;
    for (const v of x) expect(Number.isFinite(v)).toBe(true);
    expect(merkmale(ticks, T0 + 1000, META)).toBeNull(); // nur 2 Ticks bis dahin
    expect(merkmale(ticks, T0 + 200_000, META)).toBeNull(); // nichts in den letzten 120 s
    expect(merkmale([], T0, META)).toBeNull();
  });

  it("benutzt keine Zukunftsdaten", () => {
    const z = zufallAus(7);
    const ticks = reihe(400, z);
    const t = T0 + 150_500;
    const vorher = merkmale(
      ticks.filter((k) => k.zeit <= t),
      t,
      META,
    );
    const mitZukunft = merkmale(ticks, t, META);
    expect(mitZukunft).toEqual(vorher);
    // ein riesiger Sprung NACH t ändert nichts
    const sprung = [
      ...ticks,
      { zeit: t + 1, preis: 1, sol: 50, echtSol: 80 },
    ].sort((a, b) => a.zeit - b.zeit);
    expect(merkmale(sprung, t, META)).toEqual(vorher);
  });

  it("erkennt Kerzen und Käufe", () => {
    const ticks: Tick[] = [];
    for (let i = 0; i < 60; i++)
      ticks.push({
        zeit: T0 + i * 1000,
        preis: 1e-7 * (1 + i * 0.01),
        sol: 0.5,
        echtSol: 5 + i * 0.5,
      });
    const x = merkmale(ticks, T0 + 59_000, META)!;
    const n = (name: string) => x[MERKMAL_NAMEN.indexOf(name)]!;
    expect(n("grueneFolge")).toBeGreaterThanOrEqual(10);
    expect(n("kaeufe30s")).toBe(30);
    expect(n("verkaeufe30s")).toBe(0);
    expect(n("nettoSol60s")).toBeCloseTo(30, 5);
    expect(n("rendite30s")).toBeGreaterThan(0);
    expect(n("koerper1")).toBeGreaterThan(0);
    expect(n("abstandHoch120s")).toBe(0);
  });
});

describe("E235 Label", () => {
  const ziel = STANDARD_ZIEL;
  const mit = (preise: [number, number][]): Tick[] =>
    preise.map(([dt, p]) => ({ zeit: T0 + dt, preis: p, sol: 0, echtSol: 1 }));

  it("Ziel zuerst → 1, Stop zuerst → 0", () => {
    expect(
      label(
        mit([
          [0, 100],
          [10_000, 110],
          [20_000, 121],
          [30_000, 80],
          [400_000, 100],
        ]),
        T0,
        ziel,
      ),
    ).toBe(1);
    expect(
      label(
        mit([
          [0, 100],
          [10_000, 90],
          [20_000, 84],
          [30_000, 130],
          [400_000, 100],
        ]),
        T0,
        ziel,
      ),
    ).toBe(0);
  });

  it("Horizont ohne Ziel → 0, nicht abgedeckt → null", () => {
    expect(
      label(
        mit([
          [0, 100],
          [10_000, 110],
          [400_000, 150],
        ]),
        T0,
        ziel,
      ),
    ).toBe(0); // +50 % erst nach 5 min
    expect(
      label(
        mit([
          [0, 100],
          [10_000, 110],
          [60_000, 105],
        ]),
        T0,
        ziel,
      ),
    ).toBeNull();
    expect(
      label(
        mit([
          [0, 100],
          [10_000, 110],
          [60_000, 125],
        ]),
        T0,
        ziel,
      ),
    ).toBeNull(); // Ziel erreicht, Horizont aber nicht abgedeckt
    expect(
      label(
        mit([
          [0, 100],
          [10_000, 110],
          [60_000, 125],
          [300_000, 90],
        ]),
        T0,
        ziel,
      ),
    ).toBe(1); // Tick genau am Horizont
    expect(label(mit([[10_000, 100]]), T0, ziel)).toBeNull();
  });

  it("ratAus (nur Grundsignal – E236: Signatur mit allen Signalen)", () => {
    const nur = (p: number) => ({
      p,
      pump: null,
      absturz: null,
      hoch1: null,
      tief1: null,
      hoch5: null,
      tief5: null,
      frueh: false,
      verlauf: [null, null, null, null, null, null],
    });
    expect(ratAus(nur(0.6), false)).toBe("kaufen");
    expect(ratAus(nur(0.59), false)).toBe("halten");
    expect(ratAus(nur(0.2), false)).toBe("halten");
    expect(ratAus(nur(0.29), true)).toBe("raus");
    expect(ratAus(nur(0.9), true)).toBe("halten");
  });
});

describe("E235 AUC", () => {
  it("bekannte Fälle", () => {
    expect(auc([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1])).toBe(1);
    expect(auc([0.9, 0.8, 0.2, 0.1], [0, 0, 1, 1])).toBe(0);
    expect(auc([0.5, 0.5, 0.5, 0.5], [0, 1, 0, 1])).toBe(0.5);
    // Gleichstand zwischen einem positiven und einem negativen zählt halb
    expect(auc([0.1, 0.5, 0.5, 0.9], [0, 0, 1, 1])).toBeCloseTo(0.875, 10);
    expect(auc([0.1, 0.4, 0.35, 0.8], [0, 0, 1, 1])).toBe(0.75);
    expect(auc([0.3, 0.4], [1, 1])).toBe(0.5);
  });
});

function datensatz(n: number, F: number, z: () => number, regel: boolean) {
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = Array.from({ length: F }, () => z() * 2 - 1);
    X.push(x);
    const echt = (x[0]! > 0.2 && x[3]! < 0.5) || x[5]! > 0.8;
    y.push(regel ? (z() < (echt ? 0.92 : 0.08) ? 1 : 0) : z() < 0.3 ? 1 : 0);
  }
  return { X, y };
}

describe("E235 GBDT", () => {
  it("lernt eine Regel (Test-AUC > 0,9), auf Rauschen ≈ 0,5", async () => {
    const z = zufallAus(42);
    const lern = datensatz(8000, 10, z, true);
    const test = datensatz(3000, 10, z, true);
    const { modell, wichtigkeit } = await gbdtTrainieren(lern.X, lern.y);
    expect(modell.baeume).toHaveLength(80);
    const p = test.X.map((x) => gbdtVorhersagen(modell, x));
    expect(auc(p, test.y)).toBeGreaterThan(0.9);
    for (const v of p)
      (expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(1));
    // wichtig sind die Merkmale der Regel
    const rang = wichtigkeit
      .map((w, i) => [w, i] as const)
      .sort((a, b) => b[0] - a[0])
      .slice(0, 3)
      .map(([, i]) => i);
    expect(new Set(rang)).toEqual(new Set([0, 3, 5]));
    expect(wichtigkeit.reduce((s, w) => s + w, 0)).toBeCloseTo(1, 6);
    // JSON-fähig
    const kopie = JSON.parse(JSON.stringify(modell));
    expect(gbdtVorhersagen(kopie, test.X[0]!)).toBeCloseTo(p[0]!, 12);

    const rLern = datensatz(8000, 10, z, false);
    const rTest = datensatz(3000, 10, z, false);
    const r = await gbdtTrainieren(rLern.X, rLern.y);
    const a = auc(
      rTest.X.map((x) => gbdtVorhersagen(r.modell, x)),
      rTest.y,
    );
    expect(Math.abs(a - 0.5)).toBeLessThan(0.05);
  });

  it("schafft 100 000 × 25 in wenigen Sekunden und gibt nach jedem Baum ab", async () => {
    const z = zufallAus(3);
    const { X, y } = datensatz(100_000, 25, z, true);
    let abgaben = 0;
    const start = Date.now();
    const { modell } = await gbdtTrainieren(X, y, {}, async () => {
      abgaben++;
    });
    const dauer = Date.now() - start;
    console.log(`GBDT 100000×25, 80 Bäume: ${dauer} ms, ${abgaben} Abgaben`);
    expect(modell.baeume).toHaveLength(80);
    expect(abgaben).toBeGreaterThanOrEqual(80);
    expect(dauer).toBeLessThan(20_000);
  }, 60_000);

  it("kommt mit NaN in den Merkmalen zurecht", async () => {
    const z = zufallAus(5);
    const { X, y } = datensatz(500, 4, z, true);
    X[0]![0] = NaN;
    const { modell } = await gbdtTrainieren(X, y, { baeume: 5 });
    expect(
      Number.isFinite(gbdtVorhersagen(modell, [NaN, Infinity, 0, 0])),
    ).toBe(true);
  });
});

describe("E235 RL", () => {
  const g = { ...KRYPTO_RL_STANDARD, erkunden: 0 };
  const lage = (o: Partial<RlLage>): RlLage => ({
    p: 0.5,
    haelt: false,
    plusProzent: 0,
    haltSek: 0,
    trend30Prozent: 0,
    ...o,
  });

  it("Zustand diskretisiert", () => {
    expect(rlZustand(lage({ p: 0.65, trend30Prozent: 3 }))).toBe("w|6|3");
    expect(
      rlZustand(
        lage({
          p: 1,
          haelt: true,
          plusProzent: 25,
          haltSek: 400,
          trend30Prozent: -9,
        }),
      ),
    ).toBe("h|9|4|4|0");
    expect(
      rlZustand(
        lage({
          p: 0.05,
          haelt: true,
          plusProzent: -12,
          haltSek: 10,
          trend30Prozent: 0,
        }),
      ),
    ).toBe("h|0|0|0|2");
  });

  it("hält die Grenzen ein – auch mit Erkunden und einem Modell, das anderes will", () => {
    const boese = { version: 1, q: {} as Record<string, number[]> };
    // Modell will überall kaufen bzw. raus
    for (let p = 0; p < 10; p++)
      for (let t = 0; t < 5; t++) boese.q[`w|${p}|${t}`] = [0, 100, 50, 50];
    const z = zufallAus(9);
    for (let i = 0; i < 2000; i++) {
      const l = lage({ p: z(), trend30Prozent: z() * 20 - 10 });
      const a = rlHandlung(
        boese,
        l,
        { ...KRYPTO_RL_STANDARD, erkunden: 0.3 },
        z,
      );
      expect(["warten", "kaufen"]).toContain(a);
      if (a === "kaufen")
        expect(l.p).toBeGreaterThanOrEqual(KRYPTO_RL_STANDARD.minSicherheit);
      const b = rlHandlung(
        null,
        l,
        { ...KRYPTO_RL_STANDARD, erkunden: 0.3 },
        z,
      );
      if (b === "kaufen")
        expect(l.p).toBeGreaterThanOrEqual(KRYPTO_RL_STANDARD.minSicherheit);
      const h = rlHandlung(
        boese,
        { ...l, haelt: true },
        { ...KRYPTO_RL_STANDARD, erkunden: 0.3 },
        z,
      );
      expect(["warten", "halb", "raus"]).toContain(h);
    }
    expect(rlErlaubt(lage({ p: 0.1 }), g)).toEqual(["warten"]);
  });

  it("erkunden = 0 ist deterministisch; ohne Modell gilt die Regel", () => {
    const q = {
      version: 1,
      q: { "w|7|2": [1, 2, 0, 0], "h|7|2|1|2": [0, 0, 0.5, 0.4] },
    };
    for (let i = 0; i < 50; i++) {
      expect(rlHandlung(q, lage({ p: 0.75 }), g, Math.random)).toBe("kaufen");
      expect(
        rlHandlung(
          q,
          lage({ p: 0.75, haelt: true, plusProzent: 5, haltSek: 40 }),
          g,
          Math.random,
        ),
      ).toBe("halb");
    }
    expect(rlHandlung(null, lage({ p: 0.7 }), g, Math.random)).toBe("kaufen");
    expect(rlHandlung(null, lage({ p: 0.5 }), g, Math.random)).toBe("warten");
    expect(
      rlHandlung(null, lage({ p: 0.25, haelt: true }), g, Math.random),
    ).toBe("raus");
    expect(
      rlHandlung(
        null,
        lage({ p: 0.8, haelt: true, plusProzent: -10 }),
        g,
        Math.random,
      ),
    ).toBe("raus");
    expect(
      rlHandlung(
        null,
        lage({ p: 0.8, haelt: true, plusProzent: 3 }),
        g,
        Math.random,
      ),
    ).toBe("warten");
  });

  it("lernt im Zeitraffer: hohes p kaufen lohnt, niedriges nicht; Pleite kostet Nachschuss", async () => {
    const z = zufallAus(11);
    const episoden: RlEpisode[] = [];
    for (let e = 0; e < 200; e++) {
      const gut = z() < 0.5;
      const ep: RlEpisode = [];
      let preis = 1e-7;
      for (let i = 0; i < 40; i++) {
        ep.push({
          zeit: T0 + e * 1e6 + i * 5000,
          preis,
          p: gut ? 0.85 : 0.15,
          trend30Prozent: 0,
        });
        preis *= gut ? 1.02 : 0.98;
      }
      episoden.push(ep);
    }
    let abgaben = 0;
    const { modell, episoden: n } = await rlTrainieren(
      episoden,
      { epochen: 6, seed: 1 },
      async () => {
        abgaben++;
      },
    );
    expect(n).toBe(1200);
    expect(abgaben).toBeGreaterThanOrEqual(6);
    // E243: Einstiege macht die Regel – gelernt werden nur gehaltene Lagen (warten/halb/raus)
    expect(Object.keys(modell.q).some((k) => k.startsWith("w|"))).toBe(false);
    const mehrheit = (p: number, besser: (q: number[]) => boolean) => {
      const zeilen = Object.entries(modell.q).filter(([k]) => k.startsWith(`h|${p}|`)).map(([, q]) => q);
      return zeilen.filter(besser).length / zeilen.length;
    };
    // steigender Kurs (p 0,85): halten schlägt raus (der Zeitraffer unten kauft nur dort – p 0,15 < minSicherheit)
    expect(mehrheit(8, (q) => q[0]! >= q[3]!)).toBeGreaterThan(0.5);
    const zr = await rlZeitraffer(modell, episoden, {
      ...KRYPTO_RL_STANDARD,
      erkunden: 0,
    });
    expect(zr.trades).toBeGreaterThan(50);
    expect(zr.gewinnSol).toBeGreaterThan(0);
    expect(zr.trefferquote).toBeGreaterThan(0.9);

    // immer kaufen und halten, Kurs fällt stark → Kapital weg → Pleiten mit Nachschuss
    const crash: RlEpisode[] = Array.from({ length: 60 }, (_, e) =>
      Array.from({ length: 10 }, (_, i) => ({
        zeit: T0 + e * 1e6 + i * 5000,
        preis: 1e-7 * 0.5 ** i,
        p: 0.9,
        trend30Prozent: 0,
      })),
    );
    const zc = await rlZeitraffer({ version: 0, q: {} }, crash, {
      ...KRYPTO_RL_STANDARD,
      erkunden: 0,
    });
    expect(zc.pleiten).toBeGreaterThan(0);
    expect(zc.nachschussSol).toBe(zc.pleiten * 10);
    expect(zc.gewinnSol).toBeLessThan(0);
  });
});

/**
 * Synthetischer Markt: Tokens mit Zufallsweg; bei `muster` gibt es Pump-Ereignisse – ein Schwall großer Käufe mit
 * steigenden Kerzen, danach steigt der Kurs wirklich weiter. Ohne Muster sind Käufe und Kurs unabhängig.
 */
function markt(
  tokens: number,
  z: () => number,
  muster: boolean,
  minuten = 25,
  abstand = 45_000,
  pumpRate = 0.002,
  vol = 0.016,
): TrainingsDaten {
  const ticks = new Map<string, Tick[]>();
  const meta = new Map<string, TokenMeta>();
  for (let k = 0; k < tokens; k++) {
    const mint = `T${k}pump`;
    const start = T0 + k * abstand;
    meta.set(mint, {
      mint,
      erstellt: start - 10_000,
      devTokens24h: Math.floor(z() * 3),
    });
    const liste: Tick[] = [];
    let preis = 1e-7;
    let echt = 3;
    let pumpBis = 0;
    let nachlauf = 0;
    for (let t = start; t < start + minuten * 60_000; t += 1000) {
      if (muster && pumpBis < t && nachlauf <= 0 && z() < pumpRate)
        pumpBis = t + 20_000;
      let sol: number;
      let r: number;
      if (t < pumpBis) {
        sol = 1 + z() * 2;
        r = 0.004 + z() * 0.004;
        if (pumpBis - t <= 1000) nachlauf = 90;
      } else if (nachlauf > 0) {
        nachlauf--;
        sol = (z() - 0.3) * 1.2;
        r = 0.0045 + (z() - 0.5) * 0.01;
      } else {
        sol = (z() - 0.5) * 1.2;
        r = (z() - 0.5) * vol;
      }
      preis *= 1 + r;
      echt = Math.max(0.1, echt + sol);
      liste.push({ zeit: t, preis, sol, echtSol: echt });
    }
    ticks.set(mint, liste);
  }
  return { ticks, meta };
}

describe("E235 musterTrainieren", () => {
  it("findet ein echtes Muster → aktiv, Zeitraffer läuft, kooperativ", async () => {
    const d = markt(60, zufallAus(21), true);
    const jetzt = T0 + 60 * 45_000 + 30 * 60_000;
    const ziel = { zielProzent: 10, stopProzent: 10, horizontMs: 60_000 };
    let abgaben = 0;
    const fortschritt: number[] = [];
    const start = Date.now();
    const e = await musterTrainieren(d, {
      jetzt,
      version: 3,
      ziel,
      abgeben: async () => {
        abgaben++;
      },
      fortschritt: (x) => fortschritt.push(x),
    });
    console.log(
      `musterTrainieren (60 Tokens × 25 min): ${Date.now() - start} ms, ${abgaben} Abgaben\n${e.bericht}`,
    );
    expect(e.gbdt).not.toBeNull();
    expect(e.gbdt!.version).toBe(3);
    expect(e.modell!.test.beispiele).toBeGreaterThanOrEqual(200);
    expect(e.modell!.test.auc).toBeGreaterThan(0.6);
    expect(e.modell!.aktiv).toBe(true);
    expect(e.modell!.merkmale).toHaveLength(MERKMAL_NAMEN.length);
    expect(e.rl).not.toBeNull();
    expect(e.rlInfo!.episoden).toBeGreaterThan(0);
    expect(e.rlInfo!.zeitraffer.pleiten).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(e.rlInfo!.zeitraffer.gewinnSol)).toBe(true);
    expect(e.bericht).toContain("Test-AUC");
    expect(e.bericht).toContain("aktiv");
    expect(abgaben).toBeGreaterThan(10);
    expect(fortschritt[0]).toBe(0);
    expect(fortschritt[fortschritt.length - 1]).toBe(1);
    for (let i = 1; i < fortschritt.length; i++)
      expect(fortschritt[i]).toBeGreaterThanOrEqual(fortschritt[i - 1]!);

    // ein besseres altes Modell bleibt
    const e2 = await musterTrainieren(d, {
      jetzt,
      ziel,
      version: 4,
      altAuc: e.modell!.test.auc + 0.05,
    });
    expect(e2.modell!.aktiv).toBe(false);
    expect(e2.bericht).toContain("schlechter als das aktive Modell");
    // fast gleich gut → ersetzt
    const e3 = await musterTrainieren(d, {
      jetzt,
      ziel,
      version: 5,
      altAuc: e.modell!.test.auc + 0.005,
    });
    expect(e3.modell!.aktiv).toBe(true);
  }, 120_000);

  it("auf Rauschen nicht aktiv", async () => {
    // gleich viele Bewegungen wie mit Muster, aber Käufe und Kurs unabhängig (positiv ≈ 40 %)
    const d = markt(60, zufallAus(22), false, 25, 45_000, 0, 0.03);
    const e = await musterTrainieren(d, {
      jetzt: T0 + 60 * 45_000 + 30 * 60_000,
      version: 1,
      ziel: { zielProzent: 5, stopProzent: 5, horizontMs: 60_000 },
    });
    expect(e.modell!.test.basis).toBeGreaterThan(0.2);
    expect(e.gbdt).not.toBeNull();
    expect(e.modell!.aktiv).toBe(false);
    expect(Math.abs(e.modell!.test.auc - 0.5)).toBeLessThan(0.05);
  }, 120_000);

  it("zu wenig Daten → kein Modell, Bericht sagt warum", async () => {
    const d = markt(2, zufallAus(23), true, 8);
    const e = await musterTrainieren(d, { jetzt: T0 + 3_600_000, version: 1 });
    expect(e.gbdt).toBeNull();
    expect(e.rl).toBeNull();
    expect(e.modell).toBeNull();
    expect(e.rlInfo).toBeNull();
    expect(e.bericht).toMatch(
      /zu wenig Daten \(\d+ Beispiele, braucht ≥ 500\)/,
    );
    const leer = await musterTrainieren(
      { ticks: new Map(), meta: new Map() },
      { jetzt: T0, version: 1 },
    );
    expect(leer.modell).toBeNull();
  });

  it("Ticks nach „jetzt“ zählen nicht", async () => {
    const d = markt(2, zufallAus(24), true, 30);
    const e = await musterTrainieren(d, { jetzt: T0 + 60_000, version: 1 });
    expect(e.modell).toBeNull();
    expect(e.bericht).toContain("(0 Beispiele");
  });
});

describe('Aktiv-Regel: Bootstrap über Tokens (E235-Nachschärfung)', () => {
  it('klare Trennung → Untergrenze > 0,5; Klumpen-Zufall (ein Token trägt alles) → Untergrenze ≤ 0,5', async () => {
    const { aucUntergrenze } = await import('../src/krypto/muster/training.js');
    const p: number[] = [];
    const y: number[] = [];
    const t: string[] = [];
    for (let k = 0; k < 20; k++) for (let i = 0; i < 30; i++) {
      const pos = (i + k) % 2;
      p.push(pos ? 0.7 + i / 1000 : 0.3 - i / 1000);
      y.push(pos);
      t.push(`T${k}`);
    }
    expect(aucUntergrenze(p, y, t)).toBeGreaterThan(0.9);
    // 20 Tokens, je Token gleiche Vorhersage und gleiches Label (Klumpen); Zufallszuordnung → hohe Unsicherheit
    const p2: number[] = [];
    const y2: number[] = [];
    const t2: string[] = [];
    for (let k = 0; k < 20; k++) for (let i = 0; i < 30; i++) {
      p2.push(((k * 7) % 20) / 20);
      y2.push(k % 3 === 0 ? 1 : 0);
      t2.push(`T${k}`);
    }
    expect(aucUntergrenze(p2, y2, t2)).toBeLessThanOrEqual(0.5);
  });
});
