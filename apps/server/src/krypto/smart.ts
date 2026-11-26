// E244: Smart Money – welche Wallets waren unter den ersten Käufern eines Tokens, und welche davon lagen früher oft richtig?
//
// Quelle: Leifs Helius-RPC (KRYPTO_RPC_URL, https). Geprüft am 26.11.2026 (helius.dev/docs/billing/credits):
// getSignaturesForAddress und getTransaction kosten je 1 Credit, der kostenlose Tarif hat 1 Mio. Credits im Monat, 10 Anfragen/s.
// Je Token: 1× getSignaturesForAddress(mint, limit 100) + höchstens FRUEHE_TX× getTransaction (jsonParsed) → ≈ 26 Credits.
// Eigene Tagesgrenze (Standard 8 000 Credits ≈ 300 Tokens/Tag) und höchstens 4 Anfragen/s.
//
// Käufer = Unterzeichner (erster Signer) einer Transaktion, dessen Token-Saldo dieses Mints steigt (pre/postTokenBalances).
// Ergebnis eines Tokens (60 min nach dem Start, aus den eigenen Kursen): Gewinner, wenn der höchste Kurs in dieser Zeit
// ≥ GEWINNER_FAKTOR × Startkurs (Startmarktwert aus dem newToken-Ereignis / 1 Mrd.) war.
// Smart = mindestens MIN_TOKENS bekannte Ergebnisse, Trefferquote ≥ MIN_QUOTE und ≥ 2× die Grundrate aller Tokens.
// Nur Ergebnisse, die zum Zeitpunkt schon bekannt waren, zählen – das Signal je Token wird beim Abruf festgehalten (kein Blick in die Zukunft).
import { z } from 'zod';
import type { KDB } from './motor.js';

export const FRUEHE_TX = 25;
export const SMART_CREDITS_TAG = 8000;
export const GEWINNER_FAKTOR = 3;
export const ERGEBNIS_NACH_MS = 60 * 60_000;
export const SMART_MIN_TOKENS = 3;
export const SMART_MIN_QUOTE = 0.4;

const Signatur = z.object({ signature: z.string(), blockTime: z.number().nullable().optional(), err: z.unknown().optional() }).passthrough();
const Saldo = z.object({ mint: z.string(), owner: z.string().optional(), uiTokenAmount: z.object({ uiAmount: z.number().nullable().optional(), amount: z.string().optional() }).passthrough() }).passthrough();
const Tx = z
  .object({
    blockTime: z.number().nullable().optional(),
    meta: z.object({ err: z.unknown().optional(), preTokenBalances: z.array(Saldo).optional(), postTokenBalances: z.array(Saldo).optional() }).passthrough().nullable(),
    transaction: z.object({ message: z.object({ accountKeys: z.array(z.union([z.string(), z.object({ pubkey: z.string(), signer: z.boolean().optional() }).passthrough()])) }).passthrough() }).passthrough(),
  })
  .passthrough();

export interface FruehKauf {
  wallet: string;
  zeit: number;
}

/** E244: Käufer aus einer getTransaction-Antwort (jsonParsed) – null, wenn kein Kauf dieses Mints durch den Unterzeichner */
export function kaeuferAus(roh: unknown, mint: string): FruehKauf | null {
  const t = Tx.safeParse(roh);
  if (!t.success || !t.data.meta || t.data.meta.err) return null;
  const k = t.data.transaction.message.accountKeys[0];
  const wallet = typeof k === 'string' ? k : k?.pubkey;
  if (!wallet) return null;
  const menge = (l: z.infer<typeof Saldo>[] | undefined) =>
    (l ?? []).filter((b) => b.mint === mint && b.owner === wallet).reduce((s, b) => s + Number(b.uiTokenAmount.amount ?? 0), 0);
  const plus = menge(t.data.meta.postTokenBalances) - menge(t.data.meta.preTokenBalances);
  if (!(plus > 0)) return null;
  return { wallet, zeit: (t.data.blockTime ?? 0) * 1000 };
}

export class SmartMoney {
  private zeiten: number[] = [];
  private credits = { tag: '', n: 0 };
  fehler: string | null = null;

  constructor(
    private o: {
      db: KDB;
      rpcUrl: string | null;
      holen?: typeof fetch;
      jetzt?: () => number;
      creditsTag?: number;
      proSekunde?: number;
    },
  ) {}

  get eingerichtet() {
    return !!this.o.rpcUrl && /^https:\/\//.test(this.o.rpcUrl);
  }

  private jetzt() {
    return this.o.jetzt?.() ?? Date.now();
  }

  /** noch Credits heute? (UTC-Tag – Helius rechnet monatlich, die eigene Grenze verteilt sie gleichmäßig) */
  private creditsFrei(n: number) {
    const tag = new Date(this.jetzt()).toISOString().slice(0, 10);
    if (this.credits.tag !== tag) this.credits = { tag, n: 0 };
    return this.credits.n + n <= (this.o.creditsTag ?? SMART_CREDITS_TAG);
  }

  get creditsHeute() {
    return this.credits.n;
  }

  private async rpc(methode: string, params: unknown[]): Promise<unknown> {
    // höchstens proSekunde Anfragen je Sekunde
    for (;;) {
      const jetzt = this.jetzt();
      this.zeiten = this.zeiten.filter((t) => jetzt - t < 1000);
      if (this.zeiten.length < (this.o.proSekunde ?? 4)) break;
      await new Promise((r) => setTimeout(r, 260));
    }
    this.zeiten.push(this.jetzt());
    this.credits.n++;
    const holen = this.o.holen ?? fetch;
    const r = await holen(this.o.rpcUrl!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: methode, params }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`RPC ${methode} antwortet mit ${r.status}`);
    const j = (await r.json()) as { result?: unknown; error?: { message?: string } };
    if (j.error) throw new Error(`RPC ${methode}: ${String(j.error.message ?? 'Fehler').slice(0, 120)}`);
    return j.result;
  }

  /** Die ersten Käufer eines Tokens holen und speichern; gibt die Zahl der Smart-Wallets darunter zurück (null = nicht möglich) */
  async pruefen(mint: string): Promise<{ kaeufer: number; smart: number } | null> {
    if (!this.eingerichtet || !this.creditsFrei(1 + FRUEHE_TX)) return null;
    try {
      const sig = z.array(Signatur).parse(await this.rpc('getSignaturesForAddress', [mint, { limit: 100 }]));
      // neueste zuerst → die ältesten FRUEHE_TX ohne Fehler (beim jungen Token: der Anfang der Geschichte)
      const fruehe = sig.filter((x) => !x.err).reverse().slice(0, FRUEHE_TX);
      const kaeufe: FruehKauf[] = [];
      for (const x of fruehe) {
        const tx = await this.rpc('getTransaction', [x.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
        const k = kaeuferAus(tx, mint);
        if (k && !kaeufe.some((y) => y.wallet === k.wallet)) kaeufe.push(k);
      }
      const ein = this.o.db.prepare('INSERT OR IGNORE INTO fruehe_kaeufer (mint, wallet, zeit) VALUES (?, ?, ?)');
      this.o.db.transaction(() => {
        for (const k of kaeufe) ein.run(mint, k.wallet, k.zeit || this.jetzt());
      })();
      const smart = this.smartWallets(new Set(kaeufe.map((k) => k.wallet)));
      this.fehler = null;
      return { kaeufer: kaeufe.length, smart: smart.size };
    } catch (e) {
      this.fehler = (e as Error).message.slice(0, 200);
      return null;
    }
  }

  /**
   * Ergebnisse festhalten: Tokens mit frühen Käufern, deren Start ≥ 60 min her ist und die noch kein Ergebnis haben – Gewinner, wenn
   * der höchste eigene Kurs in den ersten 60 min ≥ GEWINNER_FAKTOR × Startkurs war (ohne Kurse: kein Ergebnis).
   */
  ergebnisseFesthalten(): number {
    const db = this.o.db;
    const jetzt = this.jetzt();
    const offen = db
      .prepare(
        `SELECT t.mint, t.erstellt, t.start_marktwert_sol FROM tokens t WHERE t.erstellt <= ? AND t.start_marktwert_sol > 0
           AND EXISTS (SELECT 1 FROM fruehe_kaeufer f WHERE f.mint = t.mint) AND NOT EXISTS (SELECT 1 FROM token_ergebnis e WHERE e.mint = t.mint) LIMIT 200`,
      )
      .all(jetzt - ERGEBNIS_NACH_MS) as { mint: string; erstellt: number; start_marktwert_sol: number }[];
    const hoch = db.prepare('SELECT MAX(preis_sol) AS p FROM kurse WHERE mint = ? AND zeit <= ?');
    const ein = db.prepare('INSERT OR REPLACE INTO token_ergebnis (mint, gewinner, faktor, zeit) VALUES (?, ?, ?, ?)');
    let n = 0;
    for (const t of offen) {
      const p = (hoch.get(t.mint, t.erstellt + ERGEBNIS_NACH_MS) as { p: number | null }).p;
      const start = t.start_marktwert_sol / 1e9;
      // ohne eigene Kurse kein Ergebnis – aber auch nicht ewig wieder versuchen (faktor null)
      const faktor = p != null && start > 0 ? p / start : null;
      ein.run(t.mint, faktor != null && faktor >= GEWINNER_FAKTOR ? 1 : 0, faktor, t.erstellt + ERGEBNIS_NACH_MS);
      n++;
    }
    if (n) this.vergessen();
    return n;
  }

  private cache: { zeit: number; smart: Set<string> } | null = null;

  /** alle Smart-Wallets (eine gruppierte Abfrage, 5 min zwischengespeichert) – nur Ergebnisse, die jetzt schon bekannt sind */
  smartAlle(): Set<string> {
    const jetzt = this.jetzt();
    if (this.cache && jetzt - this.cache.zeit < 5 * 60_000) return this.cache.smart;
    const db = this.o.db;
    const grund = db.prepare('SELECT COUNT(*) AS n, SUM(gewinner) AS g FROM token_ergebnis WHERE faktor IS NOT NULL AND zeit <= ?').get(jetzt) as { n: number; g: number | null };
    const basis = grund.n ? (grund.g ?? 0) / grund.n : 0;
    const zeilen = db
      .prepare(
        `SELECT f.wallet AS w, COUNT(*) AS n, SUM(e.gewinner) AS g FROM fruehe_kaeufer f JOIN token_ergebnis e ON e.mint = f.mint
           WHERE e.faktor IS NOT NULL AND e.zeit <= ? GROUP BY f.wallet HAVING COUNT(*) >= ?`,
      )
      .all(jetzt, SMART_MIN_TOKENS) as { w: string; n: number; g: number | null }[];
    const smart = new Set<string>();
    for (const z2 of zeilen) {
      const quote = (z2.g ?? 0) / z2.n;
      if (quote >= SMART_MIN_QUOTE && quote >= 2 * basis) smart.add(z2.w);
    }
    this.cache = { zeit: jetzt, smart };
    return smart;
  }

  /** Smart-Wallets unter `wallets` */
  smartWallets(wallets: Set<string>): Set<string> {
    const alle = this.smartAlle();
    return new Set([...wallets].filter((w) => alle.has(w)));
  }

  /** nach neuen Ergebnissen neu rechnen */
  vergessen() {
    this.cache = null;
  }

  /** Überblick für das Terminal */
  stand(): { wallets: number; smart: number; tokens: number; ergebnisse: number; creditsHeute: number } {
    const db = this.o.db;
    const tokens = (db.prepare('SELECT COUNT(DISTINCT mint) AS n FROM fruehe_kaeufer').get() as { n: number }).n;
    const ergebnisse = (db.prepare('SELECT COUNT(*) AS n FROM token_ergebnis WHERE faktor IS NOT NULL').get() as { n: number }).n;
    const wallets = (db.prepare('SELECT COUNT(DISTINCT wallet) AS n FROM fruehe_kaeufer').get() as { n: number }).n;
    return { wallets, smart: this.smartAlle().size, tokens, ergebnisse, creditsHeute: this.credits.n };
  }
}
