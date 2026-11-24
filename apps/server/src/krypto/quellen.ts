// E227: Datenquellen des Kryptowerks – geprüft am 24.11.2026 gegen die echten Schnittstellen:
//  • PumpPortal  wss://pumpportal.fun/api/data – subscribeNewToken/subscribeMigration kostenlos und ohne Schlüssel;
//    EINE Verbindung, Abos darüber (sonst Sperre). Trades je Token kosten Geld (Schlüssel + Wallet) – nutzt das Dorf nicht.
//  • DexScreener GET https://api.dexscreener.com/tokens/v1/solana/{bis zu 30 Adressen} – 300 Anfragen/min, ohne Schlüssel.
//  • RugCheck   GET https://api.rugcheck.xyz/v1/tokens/{mint}/report/summary – ohne Schlüssel (Swagger: keine security).
import { z } from 'zod';

const Zahl = z.coerce.number().optional().catch(undefined);
const Text = z.string().optional().catch(undefined);

// ---- PumpPortal ---------------------------------------------------------------------------------------

export const NeuerToken = z.object({
  signature: Text,
  mint: z.string().min(20).max(60),
  traderPublicKey: Text,
  txType: z.literal('create'),
  initialBuy: Zahl,
  solAmount: Zahl,
  bondingCurveKey: Text,
  vTokensInBondingCurve: Zahl,
  vSolInBondingCurve: Zahl,
  marketCapSol: Zahl,
  name: z.string().max(200).catch(''),
  symbol: z.string().max(60).catch(''),
  uri: Text,
  pool: Text,
});
export type NeuerTokenT = z.infer<typeof NeuerToken>;

export interface WsLike {
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: { code?: number }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  send(d: string): void;
  close(): void;
}
export type WsFabrik = (url: string) => WsLike;

/** Eine Verbindung zu PumpPortal, neue Tokens + Abwanderungen (Migration), Wiederverbinden mit wachsender Pause */
export class PumpPortal {
  private ws: WsLike | null = null;
  private pause = 2000;
  private an = false;
  private zeitgeber: ReturnType<typeof setTimeout> | null = null;
  online = false;
  letzteNachricht = 0;
  fehler: string | null = null;

  constructor(
    private o: {
      url?: string;
      fabrik?: WsFabrik;
      neu: (t: NeuerTokenT, zeit: number) => void;
      migration?: (mint: string) => void;
      jetzt?: () => number;
      log?: (t: string) => void;
    },
  ) {}

  start() {
    if (this.an) return;
    this.an = true;
    this.verbinden();
  }

  stop() {
    this.an = false;
    if (this.zeitgeber) clearTimeout(this.zeitgeber);
    this.ws?.close();
    this.ws = null;
    this.online = false;
  }

  private verbinden() {
    if (!this.an) return;
    const url = this.o.url ?? 'wss://pumpportal.fun/api/data';
    const fabrik = this.o.fabrik ?? ((u: string) => new WebSocket(u) as unknown as WsLike);
    let ws: WsLike;
    try {
      ws = fabrik(url);
    } catch (e) {
      this.fehler = (e as Error).message;
      this.spaeter();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.online = true;
      this.fehler = null;
      this.pause = 2000;
      ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
      ws.send(JSON.stringify({ method: 'subscribeMigration' }));
    };
    ws.onmessage = (e) => {
      this.letzteNachricht = this.o.jetzt?.() ?? Date.now();
      let roh: unknown;
      try {
        roh = JSON.parse(String(e.data));
      } catch {
        return;
      }
      const t = NeuerToken.safeParse(roh);
      if (t.success) return this.o.neu(t.data, this.letzteNachricht);
      const m = z.object({ txType: z.literal('migrate'), mint: z.string() }).safeParse(roh);
      if (m.success) this.o.migration?.(m.data.mint);
    };
    ws.onerror = (e) => {
      this.fehler = (e as { message?: string })?.message ?? 'Verbindungsfehler';
    };
    ws.onclose = () => {
      this.online = false;
      if (this.ws === ws) this.ws = null;
      this.spaeter();
    };
  }

  private spaeter() {
    if (!this.an) return;
    this.zeitgeber = setTimeout(() => this.verbinden(), this.pause);
    this.pause = Math.min(this.pause * 2, 120_000);
  }
}

// ---- DexScreener --------------------------------------------------------------------------------------

const Paar = z.object({
  chainId: z.string(),
  dexId: z.string(),
  pairAddress: z.string(),
  baseToken: z.object({ address: z.string(), name: z.string().catch(''), symbol: z.string().catch('') }),
  quoteToken: z.object({ address: z.string(), symbol: z.string().catch('') }).passthrough(),
  priceNative: Zahl,
  priceUsd: Zahl,
  txns: z.object({ m5: z.object({ buys: Zahl, sells: Zahl }).passthrough().optional().catch(undefined) }).passthrough().optional().catch(undefined),
  volume: z.object({ m5: Zahl, h1: Zahl, h24: Zahl }).passthrough().optional().catch(undefined),
  priceChange: z.object({ m5: Zahl, h1: Zahl }).passthrough().optional().catch(undefined),
  liquidity: z.object({ usd: Zahl, base: Zahl, quote: Zahl }).passthrough().optional().catch(undefined),
  marketCap: Zahl,
  fdv: Zahl,
  pairCreatedAt: Zahl,
}).passthrough();

const SOL_MINT = 'So11111111111111111111111111111111111111112';

/** Was das Dorf je Token aus einem DexScreener-Paar braucht */
export interface Schnappschuss {
  mint: string;
  zeit: number;
  symbol: string;
  name: string;
  dex: string;
  /** SOL je Token */
  preisSol: number;
  preisUsd: number | null;
  marktwertUsd: number | null;
  volumenUsdM5: number;
  kaeufeM5: number;
  verkaeufeM5: number;
  aenderungM5: number | null;
  aenderungH1: number | null;
  /** nur Pool (nach der Kurve): echte Reserven */
  poolToken: number | null;
  poolSol: number | null;
}

export class DexScreener {
  private zeiten: number[] = [];
  constructor(private o: { holen?: typeof fetch; jetzt?: () => number; proMinute?: number } = {}) {}

  /** höchstens 30 Adressen je Anfrage; hält das eigene Minutenlimit (Standard 60, DexScreener erlaubt 300) */
  async paare(mints: string[]): Promise<{ schnappschuesse: Schnappschuss[]; solUsd: number | null }> {
    if (!mints.length) return { schnappschuesse: [], solUsd: null };
    const jetzt = this.o.jetzt?.() ?? Date.now();
    this.zeiten = this.zeiten.filter((t) => jetzt - t < 60_000);
    if (this.zeiten.length >= (this.o.proMinute ?? 60)) throw new Error('DexScreener: eigenes Minutenlimit erreicht');
    this.zeiten.push(jetzt);
    const holen = this.o.holen ?? fetch;
    const r = await holen(`https://api.dexscreener.com/tokens/v1/solana/${mints.slice(0, 30).join(',')}`, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`DexScreener antwortet mit ${r.status}`);
    const daten = z.array(z.unknown()).parse(await r.json());
    // je Token das Paar gegen SOL mit dem meisten Volumen
    const beste = new Map<string, z.infer<typeof Paar>>();
    let solUsd: number | null = null;
    for (const roh of daten) {
      const p = Paar.safeParse(roh);
      if (!p.success || p.data.chainId !== 'solana' || p.data.quoteToken.address !== SOL_MINT) continue;
      const a = p.data.baseToken.address;
      const alt = beste.get(a);
      if (!alt || (p.data.volume?.h24 ?? 0) > (alt.volume?.h24 ?? 0)) beste.set(a, p.data);
      if (p.data.priceUsd && p.data.priceNative) solUsd = p.data.priceUsd / p.data.priceNative;
    }
    const schnappschuesse: Schnappschuss[] = [];
    for (const [mint, p] of beste) {
      if (!p.priceNative || !(p.priceNative > 0)) continue;
      const pool = p.dexId !== 'pumpfun';
      schnappschuesse.push({
        mint,
        zeit: jetzt,
        symbol: p.baseToken.symbol.slice(0, 20),
        name: p.baseToken.name.slice(0, 60),
        dex: p.dexId,
        preisSol: p.priceNative,
        preisUsd: p.priceUsd ?? null,
        marktwertUsd: p.marketCap ?? p.fdv ?? null,
        volumenUsdM5: p.volume?.m5 ?? 0,
        kaeufeM5: p.txns?.m5?.buys ?? 0,
        verkaeufeM5: p.txns?.m5?.sells ?? 0,
        aenderungM5: p.priceChange?.m5 ?? null,
        aenderungH1: p.priceChange?.h1 ?? null,
        poolToken: pool ? (p.liquidity?.base ?? null) : null,
        poolSol: pool ? (p.liquidity?.quote ?? null) : null,
      });
    }
    return { schnappschuesse, solUsd };
  }
}

// ---- RugCheck -----------------------------------------------------------------------------------------

const Risiko = z.object({ name: z.string().catch(''), value: z.string().catch(''), description: z.string().catch(''), score: Zahl, level: z.string().catch('') }).passthrough();
const Zusammenfassung = z.object({ score: Zahl, score_normalised: Zahl, risks: z.array(Risiko).catch([]), lpLockedPct: Zahl }).passthrough();

export interface RugBericht {
  zeit: number;
  scoreNormiert: number | null;
  risiken: { name: string; wert: string; stufe: string }[];
}

export class RugCheck {
  private zuletzt = 0;
  constructor(private o: { holen?: typeof fetch; jetzt?: () => number; abstandMs?: number } = {}) {}

  /** null = gerade nicht (eigener Abstand zwischen Anfragen, Standard 2 s) */
  bereit() {
    return (this.o.jetzt?.() ?? Date.now()) - this.zuletzt >= (this.o.abstandMs ?? 2000);
  }

  async bericht(mint: string): Promise<RugBericht> {
    const jetzt = this.o.jetzt?.() ?? Date.now();
    this.zuletzt = jetzt;
    const holen = this.o.holen ?? fetch;
    const r = await holen(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report/summary`, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`RugCheck antwortet mit ${r.status}`);
    const z2 = Zusammenfassung.parse(await r.json());
    return {
      zeit: jetzt,
      scoreNormiert: z2.score_normalised ?? null,
      risiken: z2.risks.slice(0, 30).map((x) => ({ name: x.name.slice(0, 80), wert: x.value.slice(0, 30), stufe: x.level.slice(0, 12) })),
    };
  }
}
