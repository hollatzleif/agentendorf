// E228: Backtest – eine Strategie auf den Aufzeichnungen des Kryptowerks (neue Tokens, Kurs-Schnappschüsse, RugCheck-
// Berichte). Es läuft DIESELBE Maschine wie im Paper Trading (gleiche Filter, gleiches Gate, gleiche Gebühren, Slippage,
// Verzögerung, Fehlschläge), nur mit schneller Uhr. Kein Blick in die Zukunft: ein Kurs oder Rug-Bericht zählt erst ab
// seiner Zeit. Grenzen: nur Regel-Bots (LLM-Antworten lassen sich nicht wiederholen), Kurse nur so dicht wie aufgezeichnet.
import type { KryptoBacktest, KryptoEinstellung } from '@dorf/shared';
import { TestUhr } from '../uhr.js';
import { einstellungPruefen } from './einstellung.js';
import { KryptoFehler, Kryptowerk, kryptoDb, type KDB } from './motor.js';
import type { DexScreener, RugBericht, RugCheck, Schnappschuss } from './quellen.js';

interface KursZeile {
  mint: string;
  zeit: number;
  preis_sol: number;
  marktwert_usd: number | null;
  vol_m5: number | null;
  kaeufe_m5: number | null;
  verkaeufe_m5: number | null;
  dex: string;
  pool_sol: number | null;
  pool_token: number | null;
}

/** einfacher, fester Zufall (gleiches Ergebnis bei gleicher Eingabe) */
function zufallAus(saat: number) {
  let x = saat >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

export class Backtests {
  private jobs = new Map<string, KryptoBacktest>();
  private laeuft = false;

  constructor(private o: { db: KDB; jetzt?: () => number; schrittMs?: number }) {}

  liste(): KryptoBacktest[] {
    return [...this.jobs.values()].sort((a, b) => b.erstellt.localeCompare(a.erstellt)).slice(0, 10).map((j) => ({ ...j, ...(j.ergebnis ? { ergebnis: { ...j.ergebnis, trades: j.ergebnis.trades.slice(0, 50) } } : {}) }));
  }

  hole(id: string): KryptoBacktest {
    const j = this.jobs.get(id);
    if (!j) throw new KryptoFehler(404, 'Backtest nicht gefunden');
    return j;
  }

  /** Zeitraum der Aufzeichnungen */
  bereich(): { von: number | null; bis: number | null } {
    const r = this.o.db.prepare('SELECT MIN(zeit) AS von, MAX(zeit) AS bis FROM kurse').get() as { von: number | null; bis: number | null };
    return r;
  }

  starten(roh: unknown, o: { von?: number; bis?: number } = {}): KryptoBacktest {
    const e = einstellungPruefen(roh);
    if (e.art !== 'regeln') throw new KryptoFehler(400, 'Backtests gehen nur mit Regel-Bots – die Antworten eines LLM lassen sich nicht wiederholen. Prompt-Bots testest du im Paper Trading.');
    if (this.laeuft) throw new KryptoFehler(409, 'Es läuft schon ein Backtest – bitte warten.');
    const b = this.bereich();
    if (!b.von || !b.bis) throw new KryptoFehler(409, 'Noch keine Aufzeichnungen – das Kryptowerk zeichnet auf, sobald ein Bot läuft.');
    const von = Math.max(o.von ?? b.von, b.von);
    const bis = Math.min(o.bis ?? b.bis, b.bis);
    if (bis - von < 10 * 60_000) throw new KryptoFehler(409, 'Zu wenig aufgezeichnet (mindestens 10 Minuten).');
    const id = crypto.randomUUID();
    const job: KryptoBacktest = { id, status: 'laeuft', fortschritt: 0, von: new Date(von).toISOString(), bis: new Date(bis).toISOString(), name: e.name, erstellt: new Date(this.o.jetzt?.() ?? Date.now()).toISOString() };
    this.jobs.set(id, job);
    this.laeuft = true;
    void this.lauf(job, e, von, bis)
      .catch((err) => Object.assign(job, { status: 'fehler', fehler: (err as Error).message }))
      .finally(() => {
        this.laeuft = false;
      });
    return job;
  }

  /** für Tests: wartet, bis der Job fertig ist */
  async fertig(id: string) {
    while (this.hole(id).status === 'laeuft') await new Promise((r) => setImmediate(r));
    return this.hole(id);
  }

  private async lauf(job: KryptoBacktest, e: KryptoEinstellung, von: number, bis: number) {
    const q = this.o.db;
    // spätestens alle ~25 ms Rechenzeit an das Kryptowerk zurückgeben (Takt, HTTP-Anfragen des Dorfs, Echtzeit-Kurse)
    let letzteAbgabe = Date.now();
    const abgeben = async () => {
      await new Promise((r) => setImmediate(r));
      letzteAbgabe = Date.now();
    };
    const vorlauf = e.filter.maxAlterSek * 1000;
    const tokens = q.prepare('SELECT * FROM tokens WHERE erstellt BETWEEN ? AND ? ORDER BY erstellt').all(von - vorlauf, bis) as { mint: string; symbol: string; name: string; erstellt: number; creator: string | null; dev_token: number | null; start_sol: number | null; start_marktwert_sol: number | null }[];
    // E232: stückweise lesen (nach rowid, je 5000 Zeilen) und dazwischen abgeben – vorher las ein Backtest über Stunden alle
    // Kurse in EINEM Aufruf und hielt das Kryptowerk so lange an, dass das Dorf in die Zeitgrenze lief
    const stueckweise = async <T>(sql: string): Promise<T[]> => {
      const st = q.prepare(`${sql} AND rowid > ? ORDER BY rowid LIMIT 5000`);
      const alle: T[] = [];
      let ab = 0;
      for (;;) {
        const teil = st.all(von - vorlauf, bis, ab) as (T & { _r: number })[];
        if (!teil.length) break;
        for (const z of teil) alle.push(z);
        ab = teil.at(-1)!._r;
        await abgeben();
      }
      return alle;
    };
    const kurse = await stueckweise<KursZeile>('SELECT rowid AS _r, * FROM kurse WHERE zeit BETWEEN ? AND ?');
    const rugs = await stueckweise<{ mint: string; zeit: number; json: string }>('SELECT rowid AS _r, mint, zeit, json FROM rug_verlauf WHERE zeit BETWEEN ? AND ?');
    job.daten = { tokens: tokens.length, kurse: kurse.length, rug: rugs.length };
    // je Token: Kurse und Rug-Berichte zeitlich sortiert
    const kursVon = new Map<string, KursZeile[]>();
    for (const k of kurse) (kursVon.get(k.mint) ?? kursVon.set(k.mint, []).get(k.mint)!).push(k);
    for (const l of kursVon.values()) l.sort((x, y) => x.zeit - y.zeit);
    const rugVon = new Map<string, { zeit: number; bericht: RugBericht }[]>();
    for (const r of rugs) (rugVon.get(r.mint) ?? rugVon.set(r.mint, []).get(r.mint)!).push({ zeit: r.zeit, bericht: JSON.parse(r.json) as RugBericht });
    for (const l of rugVon.values()) l.sort((x, y) => x.zeit - y.zeit);
    await abgeben();

    const uhr = new TestUhr(von);
    const letzter = <T extends { zeit: number }>(l: T[] | undefined, t: number) => {
      if (!l) return undefined;
      let x: T | undefined;
      for (const e2 of l) {
        if (e2.zeit > t) break;
        x = e2;
      }
      return x;
    };
    const dex = {
      async paare(mints: string[]) {
        const t = uhr.jetzt();
        const schnappschuesse: Schnappschuss[] = [];
        for (const m of mints) {
          const k = letzter(kursVon.get(m), t);
          // nur, was zu dem Zeitpunkt frisch war (höchstens 60 s alt)
          if (!k || t - k.zeit > 60_000) continue;
          schnappschuesse.push({ mint: m, zeit: t, symbol: '', name: '', dex: k.dex, preisSol: k.preis_sol, preisUsd: null, marktwertUsd: k.marktwert_usd, volumenUsdM5: k.vol_m5 ?? 0, kaeufeM5: k.kaeufe_m5 ?? 0, verkaeufeM5: k.verkaeufe_m5 ?? 0, aenderungM5: null, aenderungH1: null, poolSol: k.pool_sol, poolToken: k.pool_token });
        }
        return { schnappschuesse, solUsd: null };
      },
    } as unknown as DexScreener;
    const rug = {
      bereit: () => true,
      async bericht(m: string) {
        const r = letzter(rugVon.get(m), uhr.jetzt());
        if (!r) throw new Error('kein Bericht aufgezeichnet');
        return { ...r.bericht, zeit: uhr.jetzt() };
      },
    } as unknown as RugCheck;
    const werk = new Kryptowerk({ db: kryptoDb(':memory:'), uhr, dex, rug, zufall: zufallAus(von) });
    const bot = werk.anlegen(e);
    const schritt = this.o.schrittMs ?? 5000;
    let ti = 0;
    let n = 0;
    for (let t = von; t <= bis; t += schritt) {
      uhr.vor(t - uhr.jetzt());
      while (ti < tokens.length && tokens[ti]!.erstellt <= t) {
        const x = tokens[ti++]!;
        werk.neuerToken({ mint: x.mint, txType: 'create', name: x.name, symbol: x.symbol, initialBuy: x.dev_token ?? undefined, traderPublicKey: x.creator ?? undefined, solAmount: x.start_sol ?? undefined, marketCapSol: x.start_marktwert_sol ?? undefined } as never, x.erstellt);
      }
      await werk.takt();
      if (++n % 20 === 0 && Date.now() - letzteAbgabe > 25) {
        job.fortschritt = Math.round(((t - von) / (bis - von)) * 100);
        await abgeben();
      }
    }
    const b = werk.bot(bot.id);
    const p = werk.protokoll(bot.id, { anzahl: 500 });
    const zaehle = (a: string) => p.entscheidungen.filter((x) => x.aktion === a).length;
    job.ergebnis = { kennzahlen: b.kennzahlen, kurve: b.kurve, trades: p.trades, entscheidungen: { buy: zaehle('buy'), hold: zaehle('hold'), block: zaehle('block') } };
    job.fortschritt = 100;
    job.status = 'fertig';
    werk.beenden();
  }
}
