// E235: Training des Muster-Modells (GBDT) und des RL-Agenten aus aufgezeichneten Ticks – reiner Code ohne DB/Netz.
// Beispiele alle 5 s je Token, zeitlich getrennt: die ältesten 80 % lernen, die neuesten 20 % testen. Zwischen beiden
// liegt eine Lücke von einem Horizont (die Labels der Lernbeispiele dürfen nicht in die Testzeit schauen).
import { KRYPTO_RL_STANDARD, type KryptoMusterStatus } from "@dorf/shared";
import { auc, gbdtTrainieren, gbdtVorhersagen, takt } from "./gbdt.js";
import { MERKMAL_NAMEN, label, letzterIndex, merkmale } from "./merkmale.js";
import { rlTrainieren, rlZeitraffer, type RlEpisode } from "./rl.js";
import {
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
  gbdt: GbdtModell | null;
  rl: RlModell | null;
  modell: KryptoMusterStatus["modell"];
  rlInfo: KryptoMusterStatus["rl"];
  bericht: string;
}

export const MIN_LERNBEISPIELE = 500;
export const MIN_TESTBEISPIELE = 200;
export const MIN_AUC = 0.55;
/** E235 (Nachschärfung): Labels kommen in Klumpen je Token – darum mindestens so viele Test-Tokens und
 *  ein Bootstrap über TOKENS: die untere 5-%-Grenze der Test-AUC muss über 0,5 (Raten) liegen. */
export const MIN_TESTTOKENS = 10;
export const BOOTSTRAP_RUNDEN = 200;

/** untere 5-%-Grenze der AUC, wenn man ganze Tokens mit Zurücklegen neu zieht (fester Zufall – reproduzierbar) */
export function aucUntergrenze(
  p: number[],
  y: number[],
  token: string[],
  runden = BOOTSTRAP_RUNDEN,
): number {
  const gruppen = new Map<string, number[]>();
  token.forEach((t, i) =>
    (gruppen.get(t) ?? gruppen.set(t, []).get(t)!).push(i),
  );
  const liste = [...gruppen.values()];
  if (liste.length < 2) return 0;
  let z = 0x9e3779b9;
  const zufall = () => (
    (z = (Math.imul(z ^ (z >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0),
    z / 4294967296
  );
  const werte: number[] = [];
  for (let r = 0; r < runden; r++) {
    const pp: number[] = [];
    const yy: number[] = [];
    for (let k = 0; k < liste.length; k++)
      for (const i of liste[Math.floor(zufall() * liste.length)]!)
        (pp.push(p[i]!), yy.push(y[i]!));
    const pos = yy.reduce((s, v) => s + v, 0);
    werte.push(pos === 0 || pos === yy.length ? 0.5 : auc(pp, yy));
  }
  werte.sort((a, b) => a - b);
  return werte[Math.floor(runden * 0.05)]!;
}
export const MAX_BEISPIELE = 200_000;
const SCHRITT_MS = 5_000;
const FENSTER_MS = 120_000;
/** Index von rendite30s in MERKMAL_NAMEN (= Trend 30 s für den RL-Agenten) */
const TREND30 = MERKMAL_NAMEN.indexOf("rendite30s");

interface Schritt {
  mint: string;
  zeit: number;
  preis: number;
  x: number[];
  y: 0 | 1 | null;
}

const zahl = (x: number, stellen = 2) => x.toFixed(stellen).replace(".", ",");
const prozent = (x: number) => `${zahl(x * 100, 1)} %`;

export async function musterTrainieren(
  d: TrainingsDaten,
  o: {
    jetzt: number;
    ziel?: Ziel;
    version: number;
    altAuc?: number | null;
    abgeben?: () => Promise<void>;
    fortschritt?: (x: number) => void;
  },
): Promise<TrainingsErgebnis> {
  const ziel = o.ziel ?? STANDARD_ZIEL;
  const warte = takt(o.abgeben);
  const melde = (x: number) => o.fortschritt?.(Math.max(0, Math.min(1, x)));
  const trainiert = new Date(o.jetzt).toISOString();
  melde(0);

  // Schrittweite: alle 5 s, bei sehr vielen Daten gleichmäßig ausgedünnt (höchstens ~MAX_BEISPIELE Schritte)
  let schaetzung = 0;
  for (const ticks of d.ticks.values()) {
    if (ticks.length)
      schaetzung +=
        (Math.min(o.jetzt, ticks[ticks.length - 1]!.zeit) - ticks[0]!.zeit) /
        SCHRITT_MS;
  }
  const schrittMs =
    SCHRITT_MS * Math.max(1, Math.ceil(schaetzung / MAX_BEISPIELE));

  // 1. Schritte je Token (Merkmale + Label)
  const jeToken = new Map<string, Schritt[]>();
  let tokenNr = 0;
  for (const [mint, roh] of d.ticks) {
    tokenNr++;
    const ticks = roh.filter((t) => t.zeit <= o.jetzt);
    if (ticks.length < 3) continue;
    const meta = d.meta.get(mint) ?? { mint, erstellt: ticks[0]!.zeit };
    const liste: Schritt[] = [];
    const ende = ticks[ticks.length - 1]!.zeit;
    let t = Math.ceil(ticks[0]!.zeit / schrittMs) * schrittMs;
    while (t <= ende) {
      const i = letzterIndex(ticks, t);
      if (i >= 0 && ticks[i]!.zeit <= t - FENSTER_MS) {
        // Lücke ohne Ticks: zum nächsten Tick springen
        const naechster = ticks[i + 1];
        if (!naechster) break;
        t = Math.ceil(naechster.zeit / schrittMs) * schrittMs;
        continue;
      }
      const x = merkmale(ticks, t, meta);
      if (x)
        liste.push({
          mint,
          zeit: t,
          preis: ticks[i]!.preis,
          x,
          y: label(ticks, t, ziel),
        });
      t += schrittMs;
      await warte();
    }
    if (liste.length) jeToken.set(mint, liste);
    melde((0.35 * tokenNr) / Math.max(1, d.ticks.size));
  }

  const beispiele: Schritt[] = [];
  for (const l of jeToken.values())
    for (const s of l) if (s.y !== null) beispiele.push(s);
  beispiele.sort((a, b) => a.zeit - b.zeit);
  const trennIndex = Math.floor(beispiele.length * 0.8);
  const trennZeit = beispiele[trennIndex]?.zeit ?? Infinity;
  const lern = beispiele.filter((b) => b.zeit < trennZeit - ziel.horizontMs);
  const test = beispiele.filter((b) => b.zeit >= trennZeit);

  if (lern.length < MIN_LERNBEISPIELE) {
    melde(1);
    return {
      gbdt: null,
      rl: null,
      modell: null,
      rlInfo: null,
      bericht: `### Muster-Modell\nzu wenig Daten (${lern.length} Beispiele, braucht ≥ ${MIN_LERNBEISPIELE}) – ${d.ticks.size} Tokens aufgezeichnet. Training später erneut.`,
    };
  }

  // 2. GBDT
  const { modell: gbdt, wichtigkeit } = await gbdtTrainieren(
    lern.map((b) => b.x),
    lern.map((b) => b.y as number),
    {},
    async () => {
      await o.abgeben?.();
    },
  );
  gbdt.version = o.version;
  melde(0.7);

  // 3. Test auf den neuesten, nie gesehenen Daten
  const pTest = test.map((b) => gbdtVorhersagen(gbdt, b.x));
  const yTest = test.map((b) => b.y as number);
  const testAuc = auc(pTest, yTest);
  const basis = test.length
    ? yTest.reduce((s, v) => s + v, 0) / test.length
    : 0;
  let sicherN = 0;
  let sicherTreffer = 0;
  pTest.forEach((p, i) => {
    if (p >= 0.6) {
      sicherN++;
      sicherTreffer += yTest[i]!;
    }
  });
  const praezision = sicherN ? sicherTreffer / sicherN : null;
  const gruende: string[] = [];
  if (test.length < MIN_TESTBEISPIELE)
    gruende.push(
      `nur ${test.length} Testbeispiele (braucht ≥ ${MIN_TESTBEISPIELE})`,
    );
  if (testAuc < MIN_AUC)
    gruende.push(`Test-AUC ${zahl(testAuc)} < ${zahl(MIN_AUC)}`);
  const testTokens = new Set(test.map((b) => b.mint)).size;
  if (testTokens < MIN_TESTTOKENS)
    gruende.push(
      `nur ${testTokens} Tokens im Test (braucht ≥ ${MIN_TESTTOKENS})`,
    );
  else if (testAuc >= MIN_AUC) {
    const unten = aucUntergrenze(
      pTest,
      yTest,
      test.map((b) => b.mint),
    );
    if (unten <= 0.5)
      gruende.push(
        `nicht sicher besser als Raten (AUC-Untergrenze ${zahl(unten)} ≤ 0,50 über Tokens)`,
      );
  }
  if (o.altAuc != null && testAuc < o.altAuc - 0.01)
    gruende.push(`schlechter als das aktive Modell (AUC ${zahl(o.altAuc)})`);
  const aktiv = gruende.length === 0;
  const positivAnteil = beispiele.length
    ? [...lern, ...test].reduce((s, b) => s + (b.y as number), 0) /
      (lern.length + test.length)
    : 0;
  const merkmalListe = gbdt.merkmale
    .map((name, i) => ({ name, wichtigkeit: wichtigkeit[i] ?? 0 }))
    .sort((a, b) => b.wichtigkeit - a.wichtigkeit);
  const modell: NonNullable<KryptoMusterStatus["modell"]> = {
    version: o.version,
    trainiert,
    beispiele: lern.length + test.length,
    positivAnteil,
    test: { beispiele: test.length, auc: testAuc, praezision, basis },
    aktiv,
    merkmale: merkmalListe,
  };
  await warte(true);

  // 4. RL: Episoden je Token, Schritte vor der Trennzeit lernen, danach Zeitraffer
  const lernEp: RlEpisode[] = [];
  const testEp: RlEpisode[] = [];
  for (const liste of jeToken.values()) {
    const a: RlEpisode = [];
    const b: RlEpisode = [];
    for (const s of liste) {
      const schritt = {
        zeit: s.zeit,
        preis: s.preis,
        p: gbdtVorhersagen(gbdt, s.x),
        trend30Prozent: s.x[TREND30] ?? 0,
      };
      (s.zeit < trennZeit ? a : b).push(schritt);
    }
    if (a.length > 1) lernEp.push(a);
    if (b.length > 1) testEp.push(b);
    await warte();
  }
  melde(0.75);
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

  const bericht = [
    `### Muster-Modell v${o.version} (${trainiert.slice(0, 16).replace("T", " ")} UTC)`,
    `- Ziel: erst +${ziel.zielProzent} %, bevor −${ziel.stopProzent} %, innerhalb ${Math.round(ziel.horizontMs / 60_000)} min`,
    `- Beispiele: ${lern.length} lernen (ältere), ${test.length} testen (neueste, nie gesehen); positiv ${prozent(positivAnteil)}`,
    `- Test-AUC ${zahl(testAuc)} (Raten = 0,50) → ${aktiv ? "**aktiv** (gibt Rat)" : `**nicht aktiv**: ${gruende.join("; ")}`}`,
    `- Präzision bei p ≥ 0,6: ${praezision === null ? "keine solchen Fälle" : `${prozent(praezision)} (${sicherN} Fälle)`} vs. Basisrate ${prozent(basis)}`,
    `- Wichtigste Merkmale: ${merkmalListe
      .slice(0, 5)
      .map((m) => `${m.name} (${prozent(m.wichtigkeit)})`)
      .join(", ")}`,
    `- RL-Zeitraffer auf den Testdaten (Einsatz ${zahl(0.5, 1)} SOL, Gebühren wie Paper, minSicherheit ${zahl(KRYPTO_RL_STANDARD.minSicherheit, 1)}): ${zeitraffer.trades} Trades, ` +
      `${zeitraffer.gewinnSol >= 0 ? "+" : ""}${zahl(zeitraffer.gewinnSol, 3)} SOL, Trefferquote ${zeitraffer.trefferquote === null ? "–" : prozent(zeitraffer.trefferquote)}, Pleiten ${zeitraffer.pleiten}`,
    `- RL gelernt aus ${lernEp.length} Token-Episoden × 10 Durchläufe (${Object.keys(rl.q).length} Zustände)`,
  ].join("\n");
  melde(1);
  return { gbdt, rl, modell, rlInfo, bericht };
}
