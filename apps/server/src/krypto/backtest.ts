// E228: Backtest – eine Strategie auf den Aufzeichnungen des Kryptowerks (neue Tokens, Kurs-Schnappschüsse, RugCheck-
// Berichte, E237: Echtzeit-Ticks). Es läuft DIESELBE Maschine wie im Paper Trading (gleiche Filter, gleiches Gate, gleiche
// Gebühren, Slippage, Verzögerung, Fehlschläge), nur mit schneller Uhr. Kein Blick in die Zukunft: ein Kurs, Tick oder
// Rug-Bericht zählt erst ab seiner Zeit.
//
// E237 (Gleichlauf mit dem Paper): Die Aufzeichnung wird zu IHRER Zeit eingespielt, nicht abgefragt –
// - Kurse mit ihrem echten Zeitstempel (vorher galt ein bis zu 60 s alter Kurs als frisch → Ausführung zum Kurs vor der
//   Entscheidung, Ausstiege auf alten Kursen),
// - RugCheck-Berichte zur Zeit, zu der das Kryptowerk sie bekam (vorher: eigene Warteschlange, drei Fehlversuche sperrten),
// - Echtzeit-Ticks (strom_ticks) über kurveTick: Kurs aus dem Strom, Kaufdruck 60 s, Notausstieg, Ausstiege in Sekunden,
// - devTokens24h aus der ganzen Aufzeichnung (vorher nur das Fenster),
// - Datenende: endet die Aufzeichnung eines gehaltenen Tokens, wird zum letzten Kurs verkaufen (gezählt) statt ewig offen.
// Grenzen: nur Regel-Bots (LLM-Antworten lassen sich nicht wiederholen), der Muster-Rat ist aus (die Modelle sind auf denselben
// Daten trainiert), Kurse/Ticks nur so dicht wie aufgezeichnet – die Abdeckung steht im Ergebnis.
import type { KryptoBacktest, KryptoBacktestAbdeckung, KryptoEinstellung } from '@dorf/shared';
import type Database from 'better-sqlite3';
import { TestUhr } from '../uhr.js';
import { uhrzeitIn } from '../zeit.js';
import { einstellungPruefen } from './einstellung.js';
import { K } from './kurve.js';
import { KryptoFehler, Kryptowerk, kryptoDb, type KDB } from './motor.js';
import type { DexScreener, RugBericht, RugCheck, Schnappschuss } from './quellen.js';
import type { KurveStrom } from './strom.js';

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
  aenderung_m5: number | null;
  aenderung_h1: number | null;
}

interface TokenZeile {
  mint: string;
  symbol: string;
  name: string;
  zeit: number;
  creator: string | null;
  dev_token: number | null;
  start_sol: number | null;
  start_marktwert_sol: number | null;
}

interface TickZeile {
  mint: string;
  zeit: number;
  preis: number;
  echt_sol: number;
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

/**
 * Liest eine Tabelle zeitlich vorwärts in Scheiben (SQL mit zeit > ? AND zeit <= ? ORDER BY zeit) – so liegt nie die ganze
 * Aufzeichnung im Speicher (das Kryptowerk hat 384 MB). Aufruf mit t: alle noch nicht gelieferten Zeilen mit zeit ≤ t.
 */
function leser<T extends { zeit: number }>(st: Database.Statement, ab: number, ende: number, scheibeMs: number) {
  let geladenBis = ab;
  let puffer: T[] = [];
  let i = 0;
  return (t: number): T[] => {
    const r: T[] = [];
    for (;;) {
      while (i < puffer.length && puffer[i]!.zeit <= t) r.push(puffer[i++]!);
      if (i < puffer.length || geladenBis >= ende || geladenBis >= t) return r;
      const bis = Math.min(ende, geladenBis + scheibeMs);
      puffer = st.all(geladenBis, bis) as T[];
      i = 0;
      geladenBis = bis;
    }
  };
}

/** Median einer Stichprobe */
function median(l: number[]) {
  if (!l.length) return null;
  const s = [...l].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** ab so langer Stille (kein Kurs, kein Tick) prüft der Backtest, ob die Aufzeichnung eines gehaltenen Tokens zu Ende ist */
const STILLE_MS = 2 * 60_000;

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
    if (e.art === 'rl') throw new KryptoFehler(400, 'RL-Bots testet der Zeitraffer im Training.');
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
    const ab = von - vorlauf;
    const zaehle = (sql: string, ...p: number[]) => (q.prepare(sql).get(...p) as { n: number }).n;
    job.daten = {
      tokens: zaehle('SELECT COUNT(*) AS n FROM tokens WHERE erstellt BETWEEN ? AND ?', von, bis),
      kurse: zaehle('SELECT COUNT(*) AS n FROM kurse WHERE zeit BETWEEN ? AND ?', von, bis),
      rug: zaehle('SELECT COUNT(*) AS n FROM rug_verlauf WHERE zeit BETWEEN ? AND ?', von, bis),
    };
    await abgeben();

    // Aufzeichnung zeitlich vorwärts (Tokens in Stunden-Scheiben – tokens hat keinen Zeit-Index; Kurse/Ticks in 2-min-Scheiben)
    const tokensBis = leser<TokenZeile>(q.prepare('SELECT mint, symbol, name, erstellt AS zeit, creator, dev_token, start_sol, start_marktwert_sol FROM tokens WHERE erstellt > ? AND erstellt <= ? ORDER BY erstellt'), ab - 1, bis, 3_600_000);
    const kurseBis = leser<KursZeile>(q.prepare('SELECT mint, zeit, preis_sol, marktwert_usd, vol_m5, kaeufe_m5, verkaeufe_m5, dex, pool_sol, pool_token, aenderung_m5, aenderung_h1 FROM kurse WHERE zeit > ? AND zeit <= ? ORDER BY zeit'), ab - 1, bis, 120_000);
    const ticksBis = leser<TickZeile>(q.prepare('SELECT mint, zeit, preis, echt_sol FROM strom_ticks WHERE zeit > ? AND zeit <= ? ORDER BY zeit'), ab - 1, bis, 120_000);
    const rugs = (q.prepare('SELECT mint, zeit, json FROM rug_verlauf WHERE zeit BETWEEN ? AND ? ORDER BY zeit').all(ab, bis) as { mint: string; zeit: number; json: string }[]).map((r) => ({ mint: r.mint, zeit: r.zeit, bericht: JSON.parse(r.json) as RugBericht }));
    let ri = 0;
    const rugOffen = new Map<string, RugBericht>();
    await abgeben();

    const uhr = new TestUhr(ab);
    // Kurse seit dem letzten Abruf (neuester je Token) – das Werk bekommt sie beim nächsten kurseHolen mit IHREM Zeitstempel
    let neueKurse = new Map<string, Schnappschuss>();
    const dex = {
      async paare() {
        const s = [...neueKurse.values()];
        neueKurse = new Map();
        return { schnappschuesse: s, solUsd: null };
      },
    } as unknown as DexScreener;
    // RugCheck-Berichte kommen nicht über die Warteschlange, sondern zu ihrer Zeit (rugSetzen)
    const rug = {
      bereit: () => false,
      async bericht() {
        throw new Error('Backtest: Berichte kommen aus der Aufzeichnung');
      },
    } as unknown as RugCheck;
    const strom = { setzen() {}, stop() {} } as unknown as KurveStrom;
    const wdb = kryptoDb(':memory:');
    // Muster-Rat aus: kein MusterDienst (die Modelle sind auf denselben Aufzeichnungen trainiert – das wäre geschönt)
    const werk = new Kryptowerk({ db: wdb, uhr, dex, rug, strom, zufall: zufallAus(von), datenDb: q, aufzeichnen: false });
    const bot = werk.anlegen(e);
    // Abdeckung
    const imZeitraum = new Set<string>();
    const mitKurs = new Set<string>();
    const mitRug = new Set<string>();
    const mitStrom = new Set<string>();
    const letzteDaten = new Map<string, number>();
    const abstaende: number[] = [];
    let stichprobe = 0;
    let kurseGesamt = 0;
    let kurseOhneM5 = 0;
    const ende = new Map<string, number>();
    const endeVon = (mint: string) => {
      let z = ende.get(mint);
      if (z == null) {
        const k = (q.prepare('SELECT MAX(zeit) AS z FROM kurse WHERE mint = ? AND zeit <= ?').get(mint, bis) as { z: number | null }).z ?? 0;
        const t = (q.prepare('SELECT MAX(zeit) AS z FROM strom_ticks WHERE mint = ? AND zeit <= ?').get(mint, bis) as { z: number | null }).z ?? 0;
        z = Math.max(k, t);
        ende.set(mint, z);
      }
      return z;
    };
    let datenende = 0;
    const offenSt = wdb.prepare('SELECT DISTINCT mint FROM positionen WHERE offen = 1');

    const schritt = this.o.schrittMs ?? 2000;
    // im Takt des Kryptowerks bleiben: Kurse tragen die Zeit des Takts, in dem sie geholt wurden
    const erster = (q.prepare('SELECT MIN(zeit) AS z FROM kurse WHERE zeit >= ?').get(von) as { z: number | null }).z ?? von;
    const start = von + (((erster - von) % schritt) + schritt) % schritt;
    let n = 0;
    for (let t = start; t <= bis; t += schritt) {
      // 1. neue Tokens (PumpPortal)
      for (const x of tokensBis(t)) {
        werk.neuerToken({ mint: x.mint, txType: 'create', name: x.name, symbol: x.symbol, initialBuy: x.dev_token ?? undefined, traderPublicKey: x.creator ?? undefined, solAmount: x.start_sol ?? undefined, marketCapSol: x.start_marktwert_sol ?? undefined } as never, x.zeit);
        imZeitraum.add(x.mint);
      }
      // 2. Echtzeit-Ticks zu ihrer Zeit (Uhr läuft mit – Ausstiege gehaltener Tokens passieren in kurveTick)
      for (const k of ticksBis(t)) {
        if (k.zeit > uhr.jetzt()) uhr.vor(k.zeit - uhr.jetzt());
        const vSol = Math.sqrt(K * k.preis);
        werk.kurveTick(k.mint, { preisSol: k.preis, vSol, vToken: K / vSol, echtSol: k.echt_sol, komplett: false }, k.zeit);
        mitStrom.add(k.mint);
        letzteDaten.set(k.mint, Math.max(letzteDaten.get(k.mint) ?? 0, k.zeit));
      }
      uhr.vor(t - uhr.jetzt());
      // 3. RugCheck-Berichte, die das Kryptowerk bis jetzt hatte
      while (ri < rugs.length && rugs[ri]!.zeit <= t) {
        const r = rugs[ri++]!;
        rugOffen.set(r.mint, r.bericht);
        mitRug.add(r.mint);
      }
      for (const [m, r] of rugOffen) if (werk.rugSetzen(m, r)) rugOffen.delete(m);
      // 4. Kurse bis jetzt (mit ihrem Zeitstempel)
      for (const k of kurseBis(t)) {
        neueKurse.set(k.mint, { mint: k.mint, zeit: k.zeit, symbol: '', name: '', dex: k.dex, preisSol: k.preis_sol, preisUsd: null, marktwertUsd: k.marktwert_usd, volumenUsdM5: k.vol_m5 ?? 0, kaeufeM5: k.kaeufe_m5 ?? 0, verkaeufeM5: k.verkaeufe_m5 ?? 0, aenderungM5: k.aenderung_m5, aenderungH1: k.aenderung_h1, poolSol: k.pool_sol, poolToken: k.pool_token });
        mitKurs.add(k.mint);
        const vorher = letzteDaten.get(k.mint);
        if (vorher != null && k.zeit > vorher) {
          const d = (k.zeit - vorher) / 1000;
          // Stichprobe (Reservoir) der Abstände für den Median
          if (abstaende.length < 20_000) abstaende.push(d);
          else if (++stichprobe % 7 === 0) abstaende[stichprobe % 20_000] = d;
        }
        letzteDaten.set(k.mint, Math.max(vorher ?? 0, k.zeit));
        kurseGesamt++;
        if (k.aenderung_m5 == null) kurseOhneM5++;
      }
      // 5. derselbe Takt wie im Paper
      await werk.takt();
      // 6. Datenende: gehaltener Token ohne Kurs/Tick seit 2 min, und die Aufzeichnung hat auch später nichts mehr
      if (++n % 15 === 0) {
        for (const { mint } of offenSt.all() as { mint: string }[]) {
          const zuletzt = letzteDaten.get(mint) ?? 0;
          if (t - zuletzt <= STILLE_MS || endeVon(mint) > t) continue;
          datenende += werk.datenEnde(mint, `Datenende (Backtest): keine Kurse mehr seit ${uhrzeitIn(zuletzt)}`);
        }
      }
      if (n % 20 === 0 && Date.now() - letzteAbgabe > 25) {
        job.fortschritt = Math.round(((t - von) / (bis - von)) * 100);
        await abgeben();
      }
    }
    const b = werk.bot(bot.id);
    const p = werk.protokoll(bot.id, { anzahl: 500 });
    // alle Entscheidungen zählen (das Protokoll liefert nur die letzten 500)
    const anzahl = Object.fromEntries((wdb.prepare('SELECT aktion, COUNT(*) AS n FROM entscheidungen WHERE bot_id = ? GROUP BY aktion').all(bot.id) as { aktion: string; n: number }[]).map((x) => [x.aktion, x.n]));
    const kaufMints = (wdb.prepare("SELECT mint FROM trades WHERE bot_id = ? AND art = 'kauf'").all(bot.id) as { mint: string }[]).map((x) => x.mint);
    const verfallen = (wdb.prepare("SELECT COUNT(*) AS n FROM entscheidungen WHERE bot_id = ? AND grund LIKE 'Kauf verfallen%'").get(bot.id) as { n: number }).n;
    const nur = (s: Set<string>) => [...s].filter((m) => imZeitraum.has(m)).length;
    const musterAus = (e.regeln.musterGewicht ?? 0) > 0;
    const abdeckung: KryptoBacktestAbdeckung = {
      tokens: imZeitraum.size,
      mitKurs: nur(mitKurs),
      mitRug: nur(mitRug),
      mitStrom: nur(mitStrom),
      kursAbstandSek: median(abstaende),
      ohneAenderungProzent: kurseGesamt ? Math.round((kurseOhneM5 / kurseGesamt) * 100) : 0,
      kaeufeMitStrom: kaufMints.filter((m) => mitStrom.has(m)).length,
      datenende,
      kaeufeVerfallen: verfallen,
      musterAus,
    };
    const hinweise: string[] = [];
    if (musterAus) hinweise.push('Muster-Rat im Backtest aus – die Modelle sind auf denselben Daten trainiert (musterGewicht und Alarm wirken nur im Paper).');
    if (abdeckung.ohneAenderungProzent >= 50) hinweise.push(`${abdeckung.ohneAenderungProzent} % der Kurse ohne Kursänderung 5 min (Aufzeichnung von vor E237) – Sniper-Punkte dort zu niedrig.`);
    if (!abdeckung.mitStrom) hinweise.push('Keine Echtzeit-Ticks im Zeitraum – Ausstiege nur im Takt der Kurse, kein Notausstieg.');
    if (datenende) hinweise.push(`${datenende} Position(en) zum letzten Kurs geschlossen, weil die Aufzeichnung des Tokens endete.`);
    job.ergebnis = {
      kennzahlen: b.kennzahlen,
      kurve: b.kurve,
      trades: p.trades,
      entscheidungen: { buy: anzahl.buy ?? 0, hold: anzahl.hold ?? 0, block: anzahl.block ?? 0 },
      abdeckung,
      hinweise,
    };
    job.fortschritt = 100;
    job.status = 'fertig';
    werk.beenden();
    wdb.close();
  }
}
