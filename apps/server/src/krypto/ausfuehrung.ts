// E228: Live-Ausführung – PumpPortal Local Transaction API (pumpportal.fun/local-trading-api/trading-api, geprüft 24.11.):
// POST https://pumpportal.fun/api/trade-local {publicKey, action, mint, amount, denominatedInSol, slippage, priorityFee, pool}
// → serialisierte Transaktion. Das Kryptowerk prüft, dass das Bot-Wallet sie bezahlt, signiert sie selbst und schickt sie
// über Leifs RPC (Helius). PumpPortal nimmt 0,5 % je Trade. Ergebnis (SOL/Token) wird aus der bestätigten Transaktion gelesen.
import { Connection, PublicKey, SystemProgram, Transaction, VersionedTransaction } from '@solana/web3.js';
import type { WalletTresor } from './wallet.js';

const LAMPORTS = 1_000_000_000;

/** was das Kryptowerk vom RPC braucht (echte Connection oder Nachbau im Test) */
export interface Rpc {
  sendRawTransaction(b: Uint8Array, o?: { skipPreflight?: boolean; maxRetries?: number }): Promise<string>;
  getSignatureStatuses(s: string[]): Promise<{ value: ({ err: unknown; confirmationStatus?: string | null } | null)[] }>;
  getTransaction(s: string, o: { maxSupportedTransactionVersion: number; commitment: 'confirmed' }): Promise<TxInfo | null>;
  getBalance(p: PublicKey, c?: 'confirmed'): Promise<number>;
  getLatestBlockhash(c?: 'confirmed'): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
}

interface TokenSaldo {
  mint: string;
  owner?: string;
  uiTokenAmount: { uiAmount: number | null };
}
export interface TxInfo {
  meta: { err: unknown; fee: number; preBalances: number[]; postBalances: number[]; preTokenBalances?: TokenSaldo[] | null; postTokenBalances?: TokenSaldo[] | null } | null;
}

export interface LiveErgebnis {
  signatur: string | null;
  /** Änderung des SOL-Guthabens (negativ = ausgegeben), inkl. aller Gebühren */
  solDelta: number;
  /** Änderung der Token-Menge */
  tokenDelta: number;
  netzSol: number;
  fehler?: string;
}

export class LiveAusfuehrer {
  constructor(
    private o: {
      tresor: WalletTresor;
      rpc: Rpc;
      holen?: typeof fetch;
      portalUrl?: string;
      warten?: (ms: number) => Promise<void>;
      bestaetigungMs?: number;
    },
  ) {}

  static mitRpcUrl(tresor: WalletTresor, url: string) {
    return new LiveAusfuehrer({ tresor, rpc: new Connection(url, 'confirmed') as unknown as Rpc });
  }

  async guthabenSol(adresse: string): Promise<number> {
    return (await this.o.rpc.getBalance(new PublicKey(adresse), 'confirmed')) / LAMPORTS;
  }

  kaufen(adresse: string, mint: string, sol: number, slippageProzent: number, prioritaetSol: number) {
    return this.handeln(adresse, mint, { action: 'buy', amount: Number(sol.toFixed(9)), denominatedInSol: 'true', slippage: slippageProzent, priorityFee: prioritaetSol });
  }

  /** menge = Token oder 'alles' (PumpPortal: "100%") */
  verkaufen(adresse: string, mint: string, menge: number | 'alles', slippageProzent: number, prioritaetSol: number) {
    return this.handeln(adresse, mint, { action: 'sell', amount: menge === 'alles' ? '100%' : Number(menge.toFixed(6)), denominatedInSol: 'false', slippage: slippageProzent, priorityFee: prioritaetSol });
  }

  private async handeln(adresse: string, mint: string, auftrag: Record<string, unknown>): Promise<LiveErgebnis> {
    const holen = this.o.holen ?? fetch;
    let r: Response;
    try {
      r = await holen(this.o.portalUrl ?? 'https://pumpportal.fun/api/trade-local', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ publicKey: adresse, mint, pool: 'auto', ...auftrag }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      return { signatur: null, solDelta: 0, tokenDelta: 0, netzSol: 0, fehler: `PumpPortal nicht erreichbar: ${(e as Error).message}` };
    }
    if (r.status !== 200) return { signatur: null, solDelta: 0, tokenDelta: 0, netzSol: 0, fehler: `PumpPortal antwortet mit ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}` };
    let tx: VersionedTransaction;
    try {
      tx = VersionedTransaction.deserialize(new Uint8Array(await r.arrayBuffer()));
    } catch {
      return { signatur: null, solDelta: 0, tokenDelta: 0, netzSol: 0, fehler: 'PumpPortal lieferte keine gültige Transaktion' };
    }
    // Sicherheit: nur Transaktionen signieren, die das Bot-Wallet selbst bezahlt
    const zahler = tx.message.staticAccountKeys[0]?.toBase58();
    if (zahler !== adresse) return { signatur: null, solDelta: 0, tokenDelta: 0, netzSol: 0, fehler: 'Transaktion wird nicht vom Bot-Wallet bezahlt – nicht signiert' };
    const kp = this.o.tresor.keypair(adresse);
    try {
      tx.sign([kp]);
    } finally {
      kp.secretKey.fill(0);
    }
    return this.sendenUndLesen(tx.serialize(), adresse, mint);
  }

  /** alles an die feste Auszahlungsadresse (minus Netzgebühr) */
  async auszahlen(adresse: string, ziel: string): Promise<LiveErgebnis> {
    const von = new PublicKey(adresse);
    const lamports = await this.o.rpc.getBalance(von, 'confirmed');
    const betrag = lamports - 5000;
    if (betrag <= 0) return { signatur: null, solDelta: 0, tokenDelta: 0, netzSol: 0, fehler: 'Kein Guthaben' };
    const { blockhash } = await this.o.rpc.getLatestBlockhash('confirmed');
    const tx = new Transaction({ feePayer: von, recentBlockhash: blockhash }).add(SystemProgram.transfer({ fromPubkey: von, toPubkey: new PublicKey(ziel), lamports: betrag }));
    const kp = this.o.tresor.keypair(adresse);
    try {
      tx.sign(kp);
    } finally {
      kp.secretKey.fill(0);
    }
    return this.sendenUndLesen(tx.serialize(), adresse, null);
  }

  private async sendenUndLesen(roh: Uint8Array, adresse: string, mint: string | null): Promise<LiveErgebnis> {
    const warten = this.o.warten ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    let signatur: string;
    try {
      signatur = await this.o.rpc.sendRawTransaction(roh, { skipPreflight: false, maxRetries: 3 });
    } catch (e) {
      return { signatur: null, solDelta: 0, tokenDelta: 0, netzSol: 0, fehler: `RPC lehnt ab: ${(e as Error).message.slice(0, 200)}` };
    }
    // bestätigen (höchstens 60 s)
    const bis = Date.now() + (this.o.bestaetigungMs ?? 60_000);
    let status: { err: unknown; confirmationStatus?: string | null } | null = null;
    while (Date.now() < bis) {
      status = (await this.o.rpc.getSignatureStatuses([signatur]).catch(() => ({ value: [null] }))).value[0] ?? null;
      if (status && (status.err || status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) break;
      await warten(1500);
    }
    if (!status) return { signatur, solDelta: 0, tokenDelta: 0, netzSol: 0, fehler: 'nicht bestätigt (Zeit abgelaufen) – Transaktion prüfen' };
    let info: TxInfo | null = null;
    for (let i = 0; i < 5 && !info; i++) {
      info = await this.o.rpc.getTransaction(signatur, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }).catch(() => null);
      if (!info) await warten(1000);
    }
    const meta = info?.meta;
    const netzSol = (meta?.fee ?? 0) / LAMPORTS;
    const solDelta = meta ? ((meta.postBalances[0] ?? 0) - (meta.preBalances[0] ?? 0)) / LAMPORTS : 0;
    const menge = (l?: TokenSaldo[] | null) => (l ?? []).filter((t) => t.mint === mint && t.owner === adresse).reduce((s, t) => s + (t.uiTokenAmount.uiAmount ?? 0), 0);
    const tokenDelta = mint && meta ? menge(meta.postTokenBalances) - menge(meta.preTokenBalances) : 0;
    const err = status.err ?? meta?.err;
    return { signatur, solDelta, tokenDelta, netzSol, ...(err ? { fehler: `Transaktion fehlgeschlagen: ${JSON.stringify(err).slice(0, 160)}` } : {}) };
  }
}
