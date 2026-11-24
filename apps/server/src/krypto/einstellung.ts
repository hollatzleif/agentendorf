// E227: Einstellungen eines Bots – per Zod geprüft. Die Grenzen sind bewusst eng (Paper Trading, kein Hebel).
import { z } from 'zod';
import { KRYPTO_RL_STANDARD, type KryptoEinstellung } from '@dorf/shared';

const zahl = (min: number, max: number) => z.number().finite().min(min).max(max);

export const EinstellungSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    avatar: z.string().trim().min(1).max(8),
    // E235: rl = Muster-Modell + RL-Agent, nur Paper Trading
    art: z.enum(['regeln', 'prompt', 'rl']),
    rl: z.object({ minSicherheit: zahl(0, 1), erkunden: zahl(0, 0.3), nachschuss: z.boolean() }).strict().optional(),
    prompt: z.string().max(4000),
    startkapitalSol: zahl(0.1, 10_000),
    filter: z
      .object({
        maxRugScore: zahl(0, 100),
        keineGefahr: z.boolean(),
        minVolumenUsdM5: zahl(0, 10_000_000),
        minKaeufeM5: zahl(0, 100_000),
        minKaufVerhaeltnis: zahl(0, 100),
        minAlterSek: zahl(0, 7 * 86_400),
        maxAlterSek: zahl(10, 30 * 86_400),
        minMarketCapUsd: zahl(0, 1e10),
        maxMarketCapUsd: zahl(0, 1e10),
        maxDevProzent: zahl(0, 100),
        maxTopHalterProzent: zahl(0, 100),
        minLiquiditaetSol: zahl(0, 1_000_000),
        maxDevTokens24h: zahl(0, 10_000).default(3),
        minEchtzeitKaufVerhaeltnis: zahl(0, 100).default(0),
      })
      .strict(),
    regeln: z.object({ minPunkte: zahl(0, 100), musterGewicht: zahl(0, 30).default(0) }).strict(),
    minSicherheit: zahl(0, 1),
    limits: z
      .object({
        einsatzProTradeSol: zahl(0.01, 1000),
        positionProzent: zahl(0.1, 100),
        maxTagesverlustSol: zahl(0.01, 10_000),
        maxOffen: z.number().int().min(1).max(20),
        maxLlmProTag: z.number().int().min(0).max(2000),
      })
      .strict(),
    ausstieg: z
      .object({
        takeProfit: z.array(z.object({ beiProzent: zahl(1, 100_000), verkaufProzent: zahl(1, 100) }).strict()).max(6),
        stopLossProzent: zahl(1, 99),
        trailingProzent: zahl(0, 99),
        maxHaltMinuten: zahl(1, 30 * 24 * 60),
        notausEinzelverkaufProzent: zahl(0, 100).default(15),
      })
      .strict(),
    simulation: z
      .object({
        // unter 300 ms wäre geschönt – so schnell ist der Weg Server → RPC → Block nicht
        verzoegerungMs: zahl(300, 60_000),
        prioritaetSol: zahl(0, 0.1),
        fehlschlagProzent: zahl(0, 90),
        portalGebuehrProzent: zahl(0, 5).default(0.5),
      })
      .strict(),
    slippageProzent: zahl(1, 50).default(15),
  })
  .strict()
  .refine((e) => e.filter.minAlterSek < e.filter.maxAlterSek, { message: 'Mindestalter muss kleiner als Höchstalter sein' })
  .refine((e) => e.filter.minMarketCapUsd < e.filter.maxMarketCapUsd, { message: 'Mindest-Marktwert muss kleiner als Höchst-Marktwert sein' })
  .refine((e) => e.art !== 'prompt' || e.prompt.trim().length >= 10, { message: 'Ein Prompt-Bot braucht eine Strategie in Textform (mindestens 10 Zeichen)' });

export function einstellungPruefen(roh: unknown): KryptoEinstellung {
  const e = EinstellungSchema.parse(roh) as KryptoEinstellung;
  // E235: RL-Bots ohne eigene Grenzen bekommen die Standards (der Hafenmeister stellt sie später nach)
  if (e.art === 'rl') e.rl ??= { ...KRYPTO_RL_STANDARD };
  return e;
}
