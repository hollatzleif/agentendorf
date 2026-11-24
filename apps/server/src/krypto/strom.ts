// E232: Echtzeit-Kurse für Tokens auf der Bonding Curve – Solana-WebSocket (accountSubscribe) über Leifs RPC (Helius,
// Standard-WebSockets im kostenlosen Tarif). Jede Änderung des Bonding-Curve-Kontos (= jeder Kauf/Verkauf) kommt sofort an;
// daraus folgen Kurs (virtuelle Reserven, wie kurve.ts) und Richtung (SOL in der Kurve mehr = Kauf).
//
// Geprüft, nicht angenommen (24.11.2026):
// - Kontolayout aus der offiziellen IDL (github.com/pump-fun/pump-public-docs, idl/pump.json): 8 Byte Diskriminator
//   [23,183,248,55,96,216,172,96], dann u64 virtual_token_reserves, u64 virtual_quote_reserves, u64 real_token_reserves,
//   u64 real_quote_reserves, u64 token_total_supply, bool complete (Offset 48). Echte Konten (49 und 151 Byte) liegen in
//   test/fixtures/pump/bonding-curves.json – Start 1,073e15 Roh-Token (6 Dezimalen) / 30e9 Lamports = genau unser K.
// - Live gegen das öffentliche Mainnet (accountSubscribe, commitment processed): Bestätigung = Abo-Nummer, jede Änderung
//   ≈ 520 Byte; Konten gibt es mit 49, 151 und 166 Byte; quote_mint ≠ SOL kommt vor (wird verworfen).
// - Adresse = PDA ["bonding-curve", mint] des Programms 6EF8…F6P (IDL) – gegen sechs echte PumpPortal-Paare
//   (mint ↔ bondingCurveKey) nachgerechnet.
// - Kosten bei Helius: Streaming zählt 20 Credits je MB (kostenloser Tarif: 1 Mio. Credits/Monat). Darum zählt der Strom
//   seine Bytes und hört bei einer Tagesgrenze auf (Standard 800 MB ≈ 16 000 Credits/Tag); DexScreener bleibt immer da.
import { PublicKey } from '@solana/web3.js';
import type { WsFabrik, WsLike } from './quellen.js';

export const PUMP_PROGRAMM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const KURVE_DISKRIMINATOR = [23, 183, 248, 55, 96, 216, 172, 96] as const;
const TOKEN_DEZIMAL = 1e6;
const SOL_MINT_BYTES = new PublicKey('So11111111111111111111111111111111111111112').toBuffer();
const LAMPORTS = 1e9;

export interface KurveStand {
  /** virtuelle Reserven in ganzen Token bzw. SOL */
  vToken: number;
  vSol: number;
  /** echte SOL in der Kurve */
  echtSol: number;
  komplett: boolean;
  preisSol: number;
}

/** Bonding-Curve-Konto (base64) → Stand; null, wenn es kein Bonding-Curve-Konto ist */
export function kurveLesen(b64: string): KurveStand | null {
  const d = Buffer.from(b64, 'base64');
  if (d.length < 49) return null;
  for (let i = 0; i < 8; i++) if (d[i] !== KURVE_DISKRIMINATOR[i]) return null;
  const vToken = Number(d.readBigUInt64LE(8)) / TOKEN_DEZIMAL;
  const vSol = Number(d.readBigUInt64LE(16)) / LAMPORTS;
  const echtSol = Number(d.readBigUInt64LE(32)) / LAMPORTS;
  const komplett = d[48] === 1;
  // neuere Konten (≥ 115 Byte) tragen quote_mint (Offset 83, nach creator 49–80, is_mayhem_mode 81, is_cashback_coin 82).
  // Live geprüft: lauter Nullen = SOL; es gibt auch Kurven gegen andere Token – deren „Reserven“ sind keine SOL → weglassen
  if (d.length >= 115) {
    const quote = d.subarray(83, 115);
    if (!quote.every((x) => x === 0) && !quote.equals(SOL_MINT_BYTES)) return null;
  }
  if (!(vToken > 0) || !(vSol > 0)) return null;
  return { vToken, vSol, echtSol, komplett, preisSol: vSol / vToken };
}

const programm = new PublicKey(PUMP_PROGRAMM);
const adressen = new Map<string, string>();
/** Adresse des Bonding-Curve-Kontos eines Tokens (PDA laut IDL) */
export function kurveAdresse(mint: string): string {
  let a = adressen.get(mint);
  if (!a) {
    a = PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), new PublicKey(mint).toBuffer()], programm)[0].toBase58();
    if (adressen.size > 5000) adressen.clear();
    adressen.set(mint, a);
  }
  return a;
}

/** https://…?api-key=… → wss://…?api-key=… (Helius und Solana-RPCs bieten WebSockets unter derselben Adresse) */
export function wssAusRpc(url: string): string | null {
  const u = /^https:\/\/(.+)$/.exec(url.trim());
  return u ? `wss://${u[1]}` : null;
}

export interface StromStatus {
  an: boolean;
  online: boolean;
  abos: number;
  /** Änderungen (≈ Trades) in der letzten Minute */
  ticksMinute: number;
  mbHeute: number;
  grenzeMb: number;
  grenzeErreicht: boolean;
  fehler: string | null;
}

export class KurveStrom {
  private ws: WsLike | null = null;
  private online = false;
  private pause = 2000;
  private zeitgeber: ReturnType<typeof setTimeout> | null = null;
  private naechsteId = 1;
  /** gewünscht: mint → Konto */
  private soll = new Map<string, string>();
  /** abonniert: mint → Abo-Nummer des Servers */
  private abos = new Map<string, number>();
  private aboZuMint = new Map<number, string>();
  /** offene Anfragen: id → { mint, art } */
  private offen = new Map<number, { mint: string; art: 'an' | 'ab' }>();
  private bytes = 0;
  private tag = '';
  private ticks: number[] = [];
  private leerSeit: number | null = null;
  fehler: string | null = null;

  constructor(
    private o: {
      url: string;
      fabrik?: WsFabrik;
      jetzt?: () => number;
      tick: (mint: string, stand: KurveStand, zeit: number) => void;
      log?: (t: string) => void;
      /** Obergrenze empfangener Daten je Tag (UTC), dann Pause bis morgen */
      grenzeMb?: number;
      maxAbos?: number;
    },
  ) {}

  private jetzt() {
    return this.o.jetzt?.() ?? Date.now();
  }
  get grenzeMb() {
    return this.o.grenzeMb ?? 800;
  }
  get maxAbos() {
    return this.o.maxAbos ?? 20;
  }

  private tagPruefen() {
    const t = new Date(this.jetzt()).toISOString().slice(0, 10);
    if (t !== this.tag) {
      this.tag = t;
      this.bytes = 0;
    }
  }

  private get grenzeErreicht() {
    this.tagPruefen();
    return this.bytes >= this.grenzeMb * 1024 * 1024;
  }

  /**
   * Was abonniert sein soll: `vorn` (Gehaltenes, Aufträge) immer zuerst, dann Kandidaten – schon abonnierte behalten
   * Vorrang, damit nicht bei jeder kleinen Verschiebung der Reihenfolge ab- und wieder angemeldet wird.
   */
  setzen(vorn: string[], kandidaten: string[] = []) {
    const neu = new Map<string, string>();
    const reihenfolge = [...vorn, ...kandidaten.filter((m) => this.soll.has(m)), ...kandidaten.filter((m) => !this.soll.has(m))];
    for (const m of reihenfolge) {
      if (neu.size >= this.maxAbos) break;
      if (neu.has(m)) continue;
      try {
        neu.set(m, kurveAdresse(m));
      } catch {
        /* keine gültige Adresse – überspringen */
      }
    }
    this.soll = neu;
    const jetzt = this.jetzt();
    if (!neu.size) {
      this.leerSeit ??= jetzt;
      // eine Minute nichts zu beobachten → Verbindung schließen (spart Credits)
      if (this.ws && jetzt - this.leerSeit > 60_000) this.schliessen();
    } else this.leerSeit = null;
    if (neu.size && !this.ws && !this.zeitgeber && !this.grenzeErreicht) this.verbinden();
    this.abgleichen();
  }

  private senden(method: string, params: unknown[], mint: string, art: 'an' | 'ab') {
    const id = this.naechsteId++;
    this.offen.set(id, { mint, art });
    this.ws?.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  }

  private abgleichen() {
    if (!this.ws || !this.online) return;
    for (const [mint, sub] of this.abos)
      if (!this.soll.has(mint)) {
        this.abos.delete(mint);
        this.aboZuMint.delete(sub);
        this.senden('accountUnsubscribe', [sub], mint, 'ab');
      }
    const angefragt = new Set([...this.offen.values()].filter((x) => x.art === 'an').map((x) => x.mint));
    for (const [mint, konto] of this.soll)
      if (!this.abos.has(mint) && !angefragt.has(mint)) this.senden('accountSubscribe', [konto, { encoding: 'base64', commitment: 'processed' }], mint, 'an');
  }

  private verbinden() {
    if (this.grenzeErreicht) return;
    const fabrik = this.o.fabrik ?? ((u: string) => new WebSocket(u) as unknown as WsLike);
    let ws: WsLike;
    try {
      ws = fabrik(this.o.url);
    } catch (e) {
      this.fehler = (e as Error).message;
      return this.spaeter();
    }
    this.ws = ws;
    ws.onopen = () => {
      this.online = true;
      this.fehler = null;
      this.pause = 2000;
      this.abgleichen();
    };
    ws.onmessage = (e) => {
      const text = String(e.data);
      this.tagPruefen();
      this.bytes += text.length;
      if (this.grenzeErreicht) {
        this.fehler = `Tagesgrenze ${this.grenzeMb} MB erreicht – bis morgen nur DexScreener`;
        this.o.log?.(this.fehler);
        return this.schliessen();
      }
      let m: { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: { subscription?: number; result?: { value?: { data?: [string, string] } } } };
      try {
        m = JSON.parse(text);
      } catch {
        return;
      }
      if (typeof m.id === 'number') {
        const a = this.offen.get(m.id);
        this.offen.delete(m.id);
        if (!a) return;
        if (m.error) {
          this.fehler = m.error.message ?? 'Fehler des RPC';
          return;
        }
        if (a.art === 'an' && typeof m.result === 'number') {
          if (!this.soll.has(a.mint)) {
            this.senden('accountUnsubscribe', [m.result], a.mint, 'ab');
            return;
          }
          this.abos.set(a.mint, m.result);
          this.aboZuMint.set(m.result, a.mint);
        }
        return;
      }
      if (m.method !== 'accountNotification' || typeof m.params?.subscription !== 'number') return;
      const mint = this.aboZuMint.get(m.params.subscription);
      const daten = m.params.result?.value?.data?.[0];
      if (!mint || typeof daten !== 'string') return;
      const stand = kurveLesen(daten);
      if (!stand) return;
      const jetzt = this.jetzt();
      this.ticks.push(jetzt);
      this.o.tick(mint, stand, jetzt);
    };
    ws.onerror = (e) => {
      this.fehler = (e as { message?: string })?.message ?? 'Verbindungsfehler';
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.zuruecksetzen();
      if (this.soll.size && !this.grenzeErreicht) this.spaeter();
    };
  }

  private zuruecksetzen() {
    this.ws = null;
    this.online = false;
    this.abos.clear();
    this.aboZuMint.clear();
    this.offen.clear();
  }

  private spaeter() {
    if (this.zeitgeber) return;
    this.zeitgeber = setTimeout(() => {
      this.zeitgeber = null;
      if (this.soll.size) this.verbinden();
    }, this.pause);
    this.zeitgeber.unref?.();
    this.pause = Math.min(this.pause * 2, 120_000);
  }

  private schliessen() {
    const ws = this.ws;
    this.zuruecksetzen();
    ws?.close();
  }

  stop() {
    this.soll.clear();
    if (this.zeitgeber) clearTimeout(this.zeitgeber);
    this.zeitgeber = null;
    this.schliessen();
  }

  status(): StromStatus {
    const jetzt = this.jetzt();
    this.ticks = this.ticks.filter((t) => jetzt - t < 60_000);
    return {
      an: this.soll.size > 0,
      online: this.online,
      abos: this.abos.size,
      ticksMinute: this.ticks.length,
      mbHeute: Math.round((this.bytes / 1024 / 1024) * 10) / 10,
      grenzeMb: this.grenzeMb,
      grenzeErreicht: this.grenzeErreicht,
      fehler: this.fehler,
    };
  }
}
