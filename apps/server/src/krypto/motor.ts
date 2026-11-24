// E227: Kryptowerk – beobachtet neue Pump.fun-Tokens, bewertet sie je Bot, simuliert Trades (Paper) und führt das
// Protokoll. Echte Trades gibt es hier nicht: kein Wallet, kein Schlüssel, keine Transaktion.
import Database from 'better-sqlite3';
import {
  KRYPTO_MODULE,
  KRYPTO_PAPER_MINDESTENS_STUNDEN,
  type KryptoBot,
  type KryptoBotStatus,
  type KryptoEinstellung,
  type KryptoEntscheidung,
  type KryptoKennzahlen,
  type KryptoKerze,
  type KryptoTokenKerzen,
  type KryptoKerzenTakt,
  KRYPTO_KERZEN_MS,
  type KryptoModul,
  type KryptoModulSchluessel,
  type KryptoPosition,
  type KryptoTerminal,
  type KryptoTrade,
  type KryptoUebersicht,
} from '@dorf/shared';
import type { Uhr } from '../uhr.js';
import { tagIn } from '../zeit.js';
import { type BotLage, type Signal, type TokenInfo, gate, marktAus, positionsGroesse, pruefen, punkte } from './bewertung.js';
import { einstellungPruefen } from './einstellung.js';
import { GRUNDGEBUEHR_SOL, gebuehrSatz, kaufen, verkaufen, verkaufsWert, ANGEBOT } from './kurve.js';
import type { LiveAusfuehrer } from './ausfuehrung.js';
import { istAdresse, type WalletTresor } from './wallet.js';
import type { DexScreener, NeuerTokenT, PumpPortal, RugBericht, RugCheck, Schnappschuss } from './quellen.js';
import type { KurveStand, KurveStrom } from './strom.js';

export type KDB = Database.Database;

const MIGRATIONEN = [
  `CREATE TABLE bots (id TEXT PRIMARY KEY, einstellung_json TEXT NOT NULL, modus TEXT NOT NULL, status TEXT NOT NULL,
     kasse_sol REAL NOT NULL, erstellt INTEGER NOT NULL, geaendert INTEGER NOT NULL);
   CREATE TABLE positionen (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, mint TEXT NOT NULL, symbol TEXT NOT NULL, name TEXT NOT NULL,
     geoeffnet INTEGER NOT NULL, token REAL NOT NULL, rest_token REAL NOT NULL, einsatz_sol REAL NOT NULL, erloes_sol REAL NOT NULL DEFAULT 0,
     einstieg_preis REAL NOT NULL, einstieg_spot REAL NOT NULL, hoechst REAL NOT NULL, tp_stufe INTEGER NOT NULL DEFAULT 0,
     offen INTEGER NOT NULL DEFAULT 1, geschlossen INTEGER, gewinn_sol REAL);
   CREATE INDEX positionen_bot ON positionen (bot_id, offen);
   CREATE TABLE trades (id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL, position_id TEXT, zeit INTEGER NOT NULL, art TEXT NOT NULL,
     mint TEXT NOT NULL, symbol TEXT NOT NULL, sol REAL NOT NULL, token REAL NOT NULL, preis REAL NOT NULL, gebuehr_sol REAL NOT NULL,
     netz_sol REAL NOT NULL, slippage REAL NOT NULL, verzoegerung_ms INTEGER NOT NULL, grund TEXT NOT NULL);
   CREATE INDEX trades_bot ON trades (bot_id, zeit);
   CREATE TABLE entscheidungen (id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL, zeit INTEGER NOT NULL, mint TEXT NOT NULL,
     symbol TEXT NOT NULL, aktion TEXT NOT NULL, sicherheit REAL, grund TEXT NOT NULL, quelle TEXT NOT NULL, module_json TEXT);
   CREATE INDEX entscheidungen_bot ON entscheidungen (bot_id, zeit);
   CREATE TABLE equity (bot_id TEXT NOT NULL, zeit INTEGER NOT NULL, wert REAL NOT NULL, PRIMARY KEY (bot_id, zeit));
   CREATE TABLE tokens (mint TEXT PRIMARY KEY, symbol TEXT NOT NULL, name TEXT NOT NULL, erstellt INTEGER NOT NULL, creator TEXT,
     dev_token REAL, start_sol REAL, start_marktwert_sol REAL, uri TEXT);
   CREATE TABLE kurse (mint TEXT NOT NULL, zeit INTEGER NOT NULL, preis_sol REAL NOT NULL, marktwert_usd REAL, vol_m5 REAL,
     kaeufe_m5 INTEGER, verkaeufe_m5 INTEGER, dex TEXT NOT NULL, pool_sol REAL, pool_token REAL, PRIMARY KEY (mint, zeit));
   CREATE TABLE rug (mint TEXT PRIMARY KEY, zeit INTEGER NOT NULL, json TEXT NOT NULL);
   CREATE TABLE stand (schluessel TEXT PRIMARY KEY, wert TEXT NOT NULL);`,
  // E228: Gebühr des Ausführungswegs, echte Transaktionen, Abschnitte (Paper → Live), Wallets, Rug-Verlauf für den Backtest
  `ALTER TABLE trades ADD COLUMN portal_sol REAL NOT NULL DEFAULT 0;
   ALTER TABLE trades ADD COLUMN signatur TEXT;
   ALTER TABLE trades ADD COLUMN live INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE positionen ADD COLUMN live INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE bots ADD COLUMN abschnitt_seit INTEGER;
   ALTER TABLE bots ADD COLUMN live_json TEXT;
   ALTER TABLE bots ADD COLUMN paper_bilanz_json TEXT;
   UPDATE bots SET abschnitt_seit = erstellt;
   CREATE TABLE wallets (adresse TEXT PRIMARY KEY, bot_id TEXT NOT NULL, geheim BLOB NOT NULL, iv BLOB NOT NULL, tag BLOB NOT NULL, erstellt INTEGER NOT NULL);
   CREATE INDEX wallets_bot ON wallets (bot_id);
   CREATE TABLE rug_verlauf (mint TEXT NOT NULL, zeit INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (mint, zeit));
   CREATE INDEX kurse_zeit ON kurse (zeit);`,
  // E233: feine Equity-Proben (jeder Takt + Echtzeit-Trades), 6 h – für 5-s- bis 5-min-Kerzen auch nach einem Neustart
  `CREATE TABLE equity_fein (bot_id TEXT NOT NULL, zeit INTEGER NOT NULL, wert REAL NOT NULL);
   CREATE INDEX equity_fein_bot ON equity_fein (bot_id, zeit);`,
];

export function kryptoDb(datei: string): KDB {
  const db = new Database(datei);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS migration (nummer INTEGER PRIMARY KEY)');
  const fertig = new Set((db.prepare('SELECT nummer FROM migration').all() as { nummer: number }[]).map((x) => x.nummer));
  MIGRATIONEN.forEach((sql, i) => {
    if (fertig.has(i)) return;
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO migration (nummer) VALUES (?)').run(i);
    })();
  });
  return db;
}

/** Was ein Prompt-Bot vom LLM bekommt (über das Dorf, Haiku, nur JSON) */
export interface LlmAnfrage {
  botId: string;
  botName: string;
  prompt: string;
  daten: Record<string, unknown>;
}
export interface LlmAntwort {
  action: 'buy' | 'sell' | 'hold';
  token: string;
  confidence: number;
  reason: string;
}

interface Beobachtung {
  info: TokenInfo;
  letzter: Schnappschuss | null;
  abgefragt: number;
  rug: RugBericht | null;
  rugFehler: number;
  /** je Bot: zuletzt bewertet */
  bewertet: Map<string, number>;
  /** ist in die Aufzeichnung (kurse) aufgenommen */
  aufzeichnen: boolean;
}

interface Auftrag {
  botId: string;
  art: 'kauf' | 'verkauf';
  mint: string;
  symbol: string;
  name: string;
  /** Kauf: SOL; Verkauf: Token */
  menge: number;
  positionId?: string;
  grund: string;
  entschieden: number;
  ab: number;
  versuche: number;
  /** Live: erledigt (ein Kauf wird nur EINMAL versucht, ein Verkauf bis er klappt) */
  erledigt?: boolean;
}

interface BotZeile {
  id: string;
  einstellung_json: string;
  modus: string;
  status: KryptoBotStatus;
  kasse_sol: number;
  erstellt: number;
  abschnitt_seit: number | null;
  live_json: string | null;
  paper_bilanz_json: string | null;
}

interface PositionZeile {
  id: string;
  bot_id: string;
  mint: string;
  symbol: string;
  name: string;
  geoeffnet: number;
  token: number;
  rest_token: number;
  einsatz_sol: number;
  erloes_sol: number;
  einstieg_preis: number;
  einstieg_spot: number;
  hoechst: number;
  tp_stufe: number;
  offen: number;
  geschlossen: number | null;
  gewinn_sol: number | null;
}

const MINUTE = 60_000;
/** so lange gilt ein Bericht von RugCheck */
const RUG_GUELTIG = 10 * MINUTE;
/** ein Token wird je Bot höchstens alle 3 min neu bewertet */
const NEU_BEWERTEN = 3 * MINUTE;
const MAX_BEOBACHTET = 600;
const KURSE_BEHALTEN = 14 * 86_400_000;

export class Kryptowerk {
  readonly tokens = new Map<string, Beobachtung>();
  private auftraege: Auftrag[] = [];
  private solUsd: number | null = null;
  private module = new Map<string, Map<KryptoModulSchluessel, { zeile: string; ton: KryptoModul['ton']; zeit: number }>>();
  private zuletztBewertet = new Map<string, number>();
  private llmLaeuft = new Set<string>();
  private llmHeute = new Map<string, { tag: string; n: number }>();
  private minutenVolumen: { zeit: number; kaeufe: number; verkaeufe: number }[] = [];
  private letzteMinute = 0;
  private taktLaeuft = false;
  private zeitgeber: ReturnType<typeof setInterval> | null = null;
  fehler: string | null = null;

  constructor(
    private o: {
      db: KDB;
      uhr: Uhr;
      dex: DexScreener;
      rug: RugCheck;
      portal?: PumpPortal;
      llm?: (a: LlmAnfrage) => Promise<LlmAntwort>;
      zufall?: () => number;
      log?: (t: string) => void;
      /** E228: Wallets und echte Ausführung (fehlen → nur Paper) */
      tresor?: WalletTresor;
      live?: LiveAusfuehrer;
      /** feste Auszahlungsadresse (krypto.env) */
      auszahlung?: string;
      /** Bot muss so lange im Paper gelaufen sein (Standard 24 h) */
      paperMindestMs?: number;
      /** E232: Echtzeit-Kurse für Tokens auf der Bonding Curve */
      strom?: KurveStrom;
    },
  ) {}

  /** E232: letzter Kurs aus dem Strom je Token + Ticks für Kerzen und Kauf/Verkauf */
  private stromKurs = new Map<string, { zeit: number; preis: number; vSol: number }>();
  private stromTicks = new Map<string, { zeit: number; preis: number; kauf: boolean }[]>();
  private zuletztGepflegt = 0;
  /** E233: feine Equity-Probe (jeder Takt + Echtzeit-Trades gehaltener Tokens) – in der DB, damit ein Neustart nichts verliert */
  private probeMerken(botId: string, kasse: number) {
    this.o.db.prepare('INSERT INTO equity_fein (bot_id, zeit, wert) VALUES (?, ?, ?)').run(botId, this.o.uhr.jetzt(), this.equityWert(botId, kasse));
  }

  private liveLaeuft = new Set<Auftrag>();
  private aufgezeichnet = new Map<string, number>();
  private guthaben = new Map<string, { sol: number; zeit: number }>();

  // ---- Lebenszyklus ---------------------------------------------------------------------------------

  /** Takt alle 2 s; die Verbindung zu PumpPortal steht nur, solange ein Bot läuft */
  starten(taktMs = 2000) {
    // Bots von vor E228 (oder angelegt ohne Hauptschlüssel) bekommen jetzt ihr eigenes Wallet
    if (this.o.tresor?.bereit) for (const b of this.botZeilen()) if (!this.o.tresor.adresse(b.id)) this.o.tresor.erzeugen(b.id);
    this.zeitgeber = setInterval(() => void this.takt().catch((e) => this.o.log?.(`Takt: ${(e as Error).message}`)), taktMs);
    this.zeitgeber.unref?.();
    this.verbindungPruefen();
  }

  beenden() {
    if (this.zeitgeber) clearInterval(this.zeitgeber);
    this.o.portal?.stop();
    this.o.strom?.stop();
  }

  private verbindungPruefen() {
    const laeuft = this.botZeilen().some((b) => b.status === 'laeuft') && !this.notaus;
    if (laeuft) this.o.portal?.start();
    else if (!this.offenePositionen().length) this.o.portal?.stop();
  }

  get notaus() {
    return this.stand('notaus') === '1';
  }

  private stand(k: string) {
    return (this.o.db.prepare('SELECT wert FROM stand WHERE schluessel = ?').get(k) as { wert: string } | undefined)?.wert ?? null;
  }
  private standSetzen(k: string, v: string) {
    this.o.db.prepare('INSERT OR REPLACE INTO stand (schluessel, wert) VALUES (?, ?)').run(k, v);
  }

  // ---- Bots -----------------------------------------------------------------------------------------

  private botZeilen(): BotZeile[] {
    return this.o.db.prepare('SELECT * FROM bots ORDER BY erstellt').all() as BotZeile[];
  }
  private botZeile(id: string): BotZeile {
    const b = this.o.db.prepare('SELECT * FROM bots WHERE id = ?').get(id) as BotZeile | undefined;
    if (!b) throw new KryptoFehler(404, 'Bot nicht gefunden');
    return b;
  }
  private einstellung(b: BotZeile): KryptoEinstellung {
    return JSON.parse(b.einstellung_json) as KryptoEinstellung;
  }

  anlegen(roh: unknown, modus: unknown = 'paper'): KryptoBot {
    if (modus !== 'paper') throw new KryptoFehler(400, 'Live-Trading ist noch nicht gebaut – jeder Bot startet im Paper Trading.');
    const e = einstellungPruefen(roh);
    const jetzt = this.o.uhr.jetzt();
    const id = crypto.randomUUID();
    this.o.db.prepare("INSERT INTO bots (id, einstellung_json, modus, status, kasse_sol, erstellt, geaendert, abschnitt_seit) VALUES (?, ?, 'paper', ?, ?, ?, ?, ?)").run(id, JSON.stringify(e), this.notaus ? 'gestoppt' : 'laeuft', e.startkapitalSol, jetzt, jetzt, jetzt);
    // jeder Bot bekommt ein EIGENES, neu erzeugtes Wallet (nur mit Hauptschlüssel)
    this.o.tresor?.erzeugen(id);
    this.o.db.prepare('INSERT INTO equity (bot_id, zeit, wert) VALUES (?, ?, ?)').run(id, Math.floor(jetzt / MINUTE) * MINUTE, e.startkapitalSol);
    this.verbindungPruefen();
    return this.bot(id);
  }

  aendern(id: string, roh: unknown): KryptoBot {
    const b = this.botZeile(id);
    const e = einstellungPruefen(roh);
    const alt = this.einstellung(b);
    const handel = (this.o.db.prepare('SELECT COUNT(*) AS n FROM trades WHERE bot_id = ?').get(id) as { n: number }).n;
    if (handel && e.startkapitalSol !== alt.startkapitalSol) throw new KryptoFehler(400, 'Das Startkapital lässt sich nach dem ersten Trade nicht mehr ändern (sonst stimmen die Kennzahlen nicht).');
    const kasse = handel || b.modus === 'live' ? b.kasse_sol : e.startkapitalSol;
    this.o.db.prepare('UPDATE bots SET einstellung_json = ?, kasse_sol = ?, geaendert = ? WHERE id = ?').run(JSON.stringify(e), kasse, this.o.uhr.jetzt(), id);
    if (!handel) this.o.db.prepare('UPDATE equity SET wert = ? WHERE bot_id = ?').run(kasse, id);
    return this.bot(id);
  }

  statusSetzen(id: string, status: 'laeuft' | 'pausiert') {
    this.botZeile(id);
    if (status === 'laeuft' && this.notaus) throw new KryptoFehler(409, 'Not-Aus ist aktiv – erst aufheben.');
    this.o.db.prepare('UPDATE bots SET status = ?, geaendert = ? WHERE id = ?').run(status, this.o.uhr.jetzt(), id);
    this.verbindungPruefen();
    return this.bot(id);
  }

  loeschen(id: string) {
    const b = this.botZeile(id);
    if (b.modus === 'live') throw new KryptoFehler(409, 'Der Bot ist scharf – erst entschärfen (und auszahlen).');
    const g = this.o.tresor && this.o.tresor.adresse(id) ? this.guthaben.get(this.o.tresor.adresse(id)!) : undefined;
    if (g && g.sol > 0.001) throw new KryptoFehler(409, `Im Wallet liegen noch ${g.sol.toFixed(4)} SOL – erst auszahlen.`);
    this.o.tresor?.archivieren(id);
    const tx = this.o.db.transaction(() => {
      for (const t of ['positionen', 'trades', 'entscheidungen', 'equity', 'equity_fein']) this.o.db.prepare(`DELETE FROM ${t} WHERE bot_id = ?`).run(id);
      this.o.db.prepare('DELETE FROM bots WHERE id = ?').run(id);
    });
    tx();
    this.auftraege = this.auftraege.filter((a) => a.botId !== id);
    this.module.delete(id);
    this.verbindungPruefen();
  }

  /** Not-Aus: alle Bots sofort gestoppt, offene Positionen werden (simuliert) verkauft */
  notausAusloesen(grund = 'Not-Aus') {
    const jetzt = this.o.uhr.jetzt();
    this.standSetzen('notaus', '1');
    this.o.db.prepare("UPDATE bots SET status = 'gestoppt', geaendert = ?").run(jetzt);
    this.auftraege = this.auftraege.filter((a) => a.art === 'verkauf');
    for (const p of this.offenePositionen()) {
      if (this.aktiv().some((a) => a.positionId === p.id)) continue;
      const e = this.einstellung(this.botZeile(p.bot_id));
      this.auftraege.push({ botId: p.bot_id, art: 'verkauf', mint: p.mint, symbol: p.symbol, name: p.name, menge: p.rest_token, positionId: p.id, grund, entschieden: jetzt, ab: jetzt + this.verzoegerung(p.bot_id, e), versuche: 0 });
      this.entscheidungMerken(p.bot_id, p.mint, p.symbol, 'sell', null, grund, 'code');
    }
    this.o.log?.(`Not-Aus: ${grund}`);
  }

  notausAufheben() {
    this.standSetzen('notaus', '0');
    // Bots bleiben gestoppt – jeder wird einzeln wieder gestartet
    this.o.db.prepare("UPDATE bots SET status = 'pausiert' WHERE status = 'gestoppt'").run();
  }

  // ---- Daten ----------------------------------------------------------------------------------------

  /** neuer Token von PumpPortal */
  neuerToken(t: NeuerTokenT, zeit: number) {
    if (this.tokens.has(t.mint)) return;
    const info: TokenInfo = { mint: t.mint, symbol: (t.symbol || '?').slice(0, 20), name: (t.name || '').slice(0, 60), erstellt: zeit, devToken: t.initialBuy ?? null, creator: t.traderPublicKey ?? null };
    this.tokens.set(t.mint, { info, letzter: null, abgefragt: 0, rug: null, rugFehler: 0, bewertet: new Map(), aufzeichnen: false });
    this.o.db
      .prepare('INSERT OR IGNORE INTO tokens (mint, symbol, name, erstellt, creator, dev_token, start_sol, start_marktwert_sol, uri) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(t.mint, info.symbol, info.name, zeit, info.creator, info.devToken, t.solAmount ?? null, t.marketCapSol ?? null, t.uri?.slice(0, 300) ?? null);
    // älteste, nicht gehaltene Beobachtungen fallen weg
    if (this.tokens.size > MAX_BEOBACHTET) {
      const gehalten = new Set(this.offenePositionen().map((p) => p.mint));
      for (const [m] of this.tokens) {
        if (this.tokens.size <= MAX_BEOBACHTET) break;
        if (!gehalten.has(m) && !this.aktiv().some((a) => a.mint === m)) this.tokens.delete(m);
      }
    }
  }

  // ---- E232: Echtzeit-Kurse (Bonding Curve) --------------------------------------------------------

  /** DexScreener hinkt hinterher: ist der Strom-Kurs frischer (≤ 15 s), gilt er – Volumen & Co. bleiben von DexScreener */
  private mitStromKurs(s: Schnappschuss): Schnappschuss {
    const k = this.stromKurs.get(s.mint);
    if (s.dex !== 'pumpfun' || !k || this.o.uhr.jetzt() - k.zeit > 15_000 || !(s.preisSol > 0)) return s;
    return { ...s, zeit: Math.max(s.zeit, k.zeit), preisSol: k.preis, marktwertUsd: s.marktwertUsd != null ? (s.marktwertUsd * k.preis) / s.preisSol : null };
  }

  /** Was der Strom beobachten soll: Gehaltenes und Aufträge zuerst, dann die lebhaftesten Kandidaten auf der Kurve */
  private stromAbgleichen() {
    const strom = this.o.strom;
    if (!strom) return;
    const jetzt = this.o.uhr.jetzt();
    const vorn = [...new Set([...this.offenePositionen().map((p) => p.mint), ...this.aktiv().map((a) => a.mint)])];
    const fenster = this.fensterSek() * 1000;
    const kandidaten = this.laufendeBots().length
      ? [...this.tokens.values()]
          .filter((b) => b.letzter?.dex === 'pumpfun' && jetzt - b.letzter.zeit < 2 * MINUTE && jetzt - b.info.erstellt <= fenster && !vorn.includes(b.info.mint))
          .sort((a, b) => b.letzter!.volumenUsdM5 - a.letzter!.volumenUsdM5)
          .map((b) => b.info.mint)
      : [];
    strom.setzen(vorn, kandidaten);
    // alte Ticks weg (Kerzen zeigen 10 min)
    for (const [m, l] of this.stromTicks) {
      const rest = l.filter((t) => jetzt - t.zeit < 15 * MINUTE);
      if (rest.length) this.stromTicks.set(m, rest);
      else (this.stromTicks.delete(m), this.stromKurs.delete(m));
    }
  }

  /** Eine Änderung der Bonding Curve (≈ ein Trade): Kurs sofort übernehmen, Ausstiege gehaltener Tokens sofort prüfen */
  kurveTick(mint: string, stand: KurveStand, zeit: number) {
    const vorher = this.stromKurs.get(mint);
    this.stromKurs.set(mint, { zeit, preis: stand.preisSol, vSol: stand.vSol });
    const l = this.stromTicks.get(mint) ?? [];
    l.push({ zeit, preis: stand.preisSol, kauf: vorher ? stand.vSol >= vorher.vSol : true });
    if (l.length > 3000) l.splice(0, l.length - 3000);
    this.stromTicks.set(mint, l);
    const b = this.tokens.get(mint);
    if (!b?.letzter || b.letzter.dex !== 'pumpfun' || stand.komplett) return;
    b.letzter = this.mitStromKurs(b.letzter);
    const gehalten = this.offenePositionen().some((p) => p.mint === mint) || this.aktiv().some((a) => a.mint === mint);
    if (gehalten && zeit - this.zuletztGepflegt >= 250) {
      this.zuletztGepflegt = zeit;
      this.positionenPflegen();
      this.auftraegeAusfuehren();
      // E233: Equity der haltenden Bots sofort fein mitschreiben (5-s-Kerzen zeigen echte Ausschläge)
      for (const botId of new Set(this.offenePositionen().filter((p) => p.mint === mint).map((p) => p.bot_id))) this.probeMerken(botId, this.botZeile(botId).kasse_sol);
    }
  }

  /** Gehaltene Tokens zuerst, dann die lebhaftesten aus dem Strom – zusammen höchstens `max` Tafeln */
  private tokenKerzenFuer(gehalten: { mint: string; symbol: string }[], max = 4): KryptoTokenKerzen[] {
    const jetzt = this.o.uhr.jetzt();
    const fest = new Set(gehalten.map((g) => g.mint));
    const aktiv = [...this.stromTicks.entries()]
      .filter(([m]) => !fest.has(m))
      .map(([m, l]) => ({ mint: m, n: l.filter((t) => jetzt - t.zeit < 5 * MINUTE).length }))
      .filter((x) => x.n >= 2)
      .sort((a, b) => b.n - a.n)
      .map((x) => ({ mint: x.mint, symbol: this.tokens.get(x.mint)?.info.symbol ?? x.mint.slice(0, 4) }));
    const gehaltenKerzen = this.tokenKerzen(gehalten).map((k) => ({ ...k, gehalten: true }));
    return [...gehaltenKerzen, ...this.tokenKerzen(aktiv.slice(0, Math.max(0, max - gehaltenKerzen.length)))];
  }

  private tokenKerzen(mints: { mint: string; symbol: string }[]): KryptoTokenKerzen[] {
    const jetzt = this.o.uhr.jetzt();
    const r: KryptoTokenKerzen[] = [];
    for (const { mint, symbol } of mints) {
      const ticks = (this.stromTicks.get(mint) ?? []).filter((t) => jetzt - t.zeit < 10 * MINUTE);
      if (!ticks.length) continue;
      const kerzen: KryptoKerze[] = [];
      for (const t of ticks) {
        const z = Math.floor(t.zeit / 5000) * 5000;
        const k = kerzen.at(-1);
        if (k && k.zeit === z) ((k.h = Math.max(k.h, t.preis)), (k.l = Math.min(k.l, t.preis)), (k.c = t.preis));
        else kerzen.push({ zeit: z, o: k?.c ?? t.preis, h: Math.max(k?.c ?? t.preis, t.preis), l: Math.min(k?.c ?? t.preis, t.preis), c: t.preis });
      }
      r.push({ mint, symbol, kerzen: kerzen.slice(-120), kaeufe: ticks.filter((t) => t.kauf).length, verkaeufe: ticks.filter((t) => !t.kauf).length });
    }
    return r;
  }

  private offenePositionen(botId?: string): PositionZeile[] {
    return (botId ? this.o.db.prepare('SELECT * FROM positionen WHERE offen = 1 AND bot_id = ?').all(botId) : this.o.db.prepare('SELECT * FROM positionen WHERE offen = 1').all()) as PositionZeile[];
  }

  private laufendeBots() {
    return this.notaus ? [] : this.botZeilen().filter((b) => b.status === 'laeuft');
  }

  /** ein Takt: Kurse holen, Aufträge ausführen, Positionen pflegen, Neues bewerten, Equity merken */
  async takt() {
    if (this.taktLaeuft) return;
    this.taktLaeuft = true;
    try {
      await this.kurseHolen();
      this.stromAbgleichen();
      this.auftraegeAusfuehren();
      this.positionenPflegen();
      await this.rugHolen();
      await this.bewerten();
      this.equityMerken();
      this.guthabenAuffrischen();
      this.aufraeumen();
    } finally {
      this.taktLaeuft = false;
    }
  }

  private fensterSek() {
    const bots = this.laufendeBots();
    return bots.length ? Math.max(...bots.map((b) => this.einstellung(b).filter.maxAlterSek)) : 0;
  }

  private async kurseHolen() {
    const jetzt = this.o.uhr.jetzt();
    const gehalten = new Set([...this.offenePositionen().map((p) => p.mint), ...this.auftraege.map((a) => a.mint)]);
    const fenster = this.fensterSek() * 1000;
    // vorne: Gehaltenes und Aufträge (jeden Takt), dann die am längsten nicht abgefragten Tokens im Fenster
    const rest = [...this.tokens.values()]
      .filter((b) => !gehalten.has(b.info.mint) && jetzt - b.info.erstellt <= fenster && jetzt - b.info.erstellt >= 20_000)
      .sort((a, b) => a.abgefragt - b.abgefragt)
      .map((b) => b.info.mint);
    const auswahl = [...gehalten, ...rest].slice(0, 30);
    if (!auswahl.length) return;
    let antwort: Awaited<ReturnType<DexScreener['paare']>>;
    try {
      antwort = await this.o.dex.paare(auswahl);
      this.fehler = null;
    } catch (e) {
      this.fehler = (e as Error).message;
      return;
    }
    if (antwort.solUsd) this.solUsd = antwort.solUsd;
    for (const m of auswahl) {
      const b = this.tokens.get(m);
      if (b) b.abgefragt = jetzt;
    }
    const einfuegen = this.o.db.prepare('INSERT OR REPLACE INTO kurse (mint, zeit, preis_sol, marktwert_usd, vol_m5, kaeufe_m5, verkaeufe_m5, dex, pool_sol, pool_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const s of antwort.schnappschuesse) {
      let b = this.tokens.get(s.mint);
      if (!b) {
        // gehaltener Token nach einem Neustart: Daten aus der Aufzeichnung
        const t = this.o.db.prepare('SELECT * FROM tokens WHERE mint = ?').get(s.mint) as { symbol: string; name: string; erstellt: number; creator: string | null; dev_token: number | null } | undefined;
        b = { info: { mint: s.mint, symbol: t?.symbol ?? s.symbol, name: t?.name ?? s.name, erstellt: t?.erstellt ?? jetzt, devToken: t?.dev_token ?? null, creator: t?.creator ?? null }, letzter: null, abgefragt: jetzt, rug: null, rugFehler: 0, bewertet: new Map(), aufzeichnen: true };
        this.tokens.set(s.mint, b);
      }
      b.letzter = this.mitStromKurs(s);
      // Aufzeichnung für den Backtest: Kandidaten und Gehaltenes immer, alle anderen höchstens alle 30 s
      const zuletzt = this.aufgezeichnet.get(s.mint) ?? 0;
      if (b.aufzeichnen || gehalten.has(s.mint) || s.zeit - zuletzt >= 30_000) this.aufgezeichnet.set(s.mint, s.zeit);
      else continue;
      einfuegen.run(s.mint, s.zeit, s.preisSol, s.marktwertUsd, s.volumenUsdM5, s.kaeufeM5, s.verkaeufeM5, s.dex, s.poolSol, s.poolToken);
    }
    // Volumen je Minute (für die Balken im Terminal)
    const minute = Math.floor(jetzt / MINUTE) * MINUTE;
    if (minute !== this.letzteMinute) {
      this.letzteMinute = minute;
      let k = 0;
      let v = 0;
      for (const x of this.tokens.values()) if (x.letzter && jetzt - x.letzter.zeit < 2 * MINUTE) ((k += x.letzter.kaeufeM5), (v += x.letzter.verkaeufeM5));
      this.minutenVolumen.push({ zeit: minute, kaeufe: k, verkaeufe: v });
      this.minutenVolumen = this.minutenVolumen.slice(-30);
    }
  }

  private async rugHolen() {
    if (!this.o.rug.bereit()) return;
    const jetzt = this.o.uhr.jetzt();
    // ein Bericht je Aufruf: der Kandidat, der bei mindestens einem Bot den Vorfilter besteht und am längsten wartet
    for (const b of this.tokens.values()) {
      if (!b.letzter || (b.rug && jetzt - b.rug.zeit < RUG_GUELTIG) || b.rugFehler >= 3) continue;
      const vorfilter = this.laufendeBots().some((bot) => {
        const s = pruefen(this.einstellung(bot), b.info, b.letzter!, null, jetzt);
        return !s.some((x) => x.sperre && (x.schluessel === 'volumen' || x.schluessel === 'sniper' || x.schluessel === 'dev'));
      });
      if (!vorfilter) continue;
      b.aufzeichnen = true;
      try {
        b.rug = await this.o.rug.bericht(b.info.mint);
        this.o.db.prepare('INSERT OR REPLACE INTO rug (mint, zeit, json) VALUES (?, ?, ?)').run(b.info.mint, b.rug.zeit, JSON.stringify(b.rug));
        this.o.db.prepare('INSERT OR REPLACE INTO rug_verlauf (mint, zeit, json) VALUES (?, ?, ?)').run(b.info.mint, b.rug.zeit, JSON.stringify(b.rug));
      } catch (e) {
        b.rugFehler++;
        this.o.log?.(`RugCheck ${b.info.mint}: ${(e as Error).message}`);
      }
      return;
    }
  }

  private lage(botId: string, e: KryptoEinstellung, mint: string): BotLage {
    const b = this.botZeile(botId);
    return { kasseSol: b.kasse_sol - this.reserviert(botId), offen: this.offenePositionen(botId).length + this.ausstehendeKaeufe(botId).length, heuteSol: this.heute(botId, e), haeltSchon: this.offenePositionen(botId).some((p) => p.mint === mint) || this.aktiv().some((a) => a.botId === botId && a.mint === mint), notaus: this.notaus };
  }

  /** Käufe, die noch ausstehen oder gerade unterwegs sind (Live) – zählen für Budget und offene Positionen */
  private ausstehendeKaeufe(botId: string) {
    return this.auftraege.filter((a) => a.botId === botId && a.art === 'kauf' && (!a.erledigt || this.liveLaeuft.has(a)));
  }

  /** Aufträge, die noch nicht erledigt sind */
  private aktiv() {
    return this.auftraege.filter((a) => !a.erledigt);
  }

  private reserviert(botId: string) {
    return this.ausstehendeKaeufe(botId).reduce((x, a) => x + a.menge, 0);
  }

  private async bewerten() {
    const jetzt = this.o.uhr.jetzt();
    for (const bot of this.laufendeBots()) {
      const e = this.einstellung(bot);
      for (const b of this.tokens.values()) {
        if (!b.letzter || jetzt - b.letzter.zeit > 30_000) continue;
        if (!b.rug) {
          // Vorprüfung ohne RugCheck: nur fürs Terminal (welche Module gerade was sehen), kein Protokolleintrag
          const vorab = `vorab:${bot.id}`;
          if (jetzt - (b.bewertet.get(vorab) ?? 0) < 30_000) continue;
          b.bewertet.set(vorab, jetzt);
          this.zuletztBewertet.set(bot.id, jetzt);
          for (const s of pruefen(e, b.info, b.letzter, null, jetzt)) {
            if (s.schluessel === 'volumen' || s.schluessel === 'sniper' || s.schluessel === 'dev') this.modulMerken(bot.id, s.schluessel, `${b.info.symbol}: ${s.zeile}`, s.ton);
          }
          continue;
        }
        const zuletzt = b.bewertet.get(bot.id) ?? 0;
        if (jetzt - zuletzt < NEU_BEWERTEN) continue;
        b.bewertet.set(bot.id, jetzt);
        const signale = pruefen(e, b.info, b.letzter, b.rug, jetzt);
        this.zuletztBewertet.set(bot.id, jetzt);
        for (const s of signale) this.modulMerken(bot.id, s.schluessel, `${b.info.symbol}: ${s.zeile}`, s.ton);
        const p = punkte(signale);
        if (p === null) {
          const grund = signale.filter((s) => s.sperre).map((s) => `${KRYPTO_MODULE.find((m) => m.schluessel === s.schluessel)!.name}: ${s.zeile}`).join(' · ');
          this.entscheidungMerken(bot.id, b.info.mint, b.info.symbol, 'block', null, grund, 'code', signale, signale.some((s) => s.sperre && (s.schluessel === 'rug' || s.schluessel === 'bundle')));
          continue;
        }
        const groesse = positionsGroesse(e, bot.kasse_sol - this.reserviert(bot.id));
        if (e.art === 'regeln') {
          if (p < e.regeln.minPunkte) {
            this.entscheidungMerken(bot.id, b.info.mint, b.info.symbol, 'hold', p / 100, `${p} Punkte < ${e.regeln.minPunkte}`, 'regeln', signale);
            continue;
          }
          this.kaufVersuchen(bot.id, e, b, groesse, `${p} Punkte`, 'regeln', p / 100, signale);
        } else {
          void this.llmBewerten(bot.id, e, b, signale, p);
        }
      }
    }
  }

  private async llmBewerten(botId: string, e: KryptoEinstellung, b: Beobachtung, signale: Signal[], p: number) {
    const tag = tagIn(this.o.uhr.jetzt());
    const z = this.llmHeute.get(botId);
    const n = z?.tag === tag ? z.n : 0;
    if (!this.o.llm) return this.entscheidungMerken(botId, b.info.mint, b.info.symbol, 'hold', null, 'LLM nicht verfügbar (kein Dorf-Zugang)', 'code', signale);
    if (n >= e.limits.maxLlmProTag) return this.entscheidungMerken(botId, b.info.mint, b.info.symbol, 'hold', null, `LLM-Tageslimit (${e.limits.maxLlmProTag}) erreicht`, 'code', signale);
    if (this.llmLaeuft.has(botId)) {
      b.bewertet.delete(botId); // später nochmal
      return;
    }
    this.llmLaeuft.add(botId);
    this.llmHeute.set(botId, { tag, n: n + 1 });
    this.modulMerken(botId, 'gate', 'LLM bewertet …', 'neutral');
    try {
      const s = b.letzter!;
      const a = await this.o.llm({
        botId,
        botName: e.name,
        prompt: e.prompt,
        daten: {
          token: { mint: b.info.mint, symbol: b.info.symbol, name: b.info.name, alterSek: Math.round((this.o.uhr.jetzt() - b.info.erstellt) / 1000) },
          markt: { dex: s.dex, preisSol: s.preisSol, marktwertUsd: s.marktwertUsd, volumenUsdM5: s.volumenUsdM5, kaeufeM5: s.kaeufeM5, verkaeufeM5: s.verkaeufeM5, aenderungM5: s.aenderungM5, aenderungH1: s.aenderungH1 },
          rugcheck: b.rug,
          module: Object.fromEntries(signale.map((x) => [x.schluessel, x.zeile])),
          punkteNachRegeln: p,
        },
      });
      const sicher = Math.max(0, Math.min(1, a.confidence));
      if (a.action !== 'buy' || a.token !== b.info.mint) {
        this.entscheidungMerken(botId, b.info.mint, b.info.symbol, a.action === 'buy' ? 'hold' : a.action === 'sell' ? 'hold' : a.action, sicher, `LLM: ${a.reason}`.slice(0, 400), 'llm', signale);
      } else if (sicher < e.minSicherheit) {
        this.entscheidungMerken(botId, b.info.mint, b.info.symbol, 'hold', sicher, `LLM will kaufen, Sicherheit ${sicher.toFixed(2)} < ${e.minSicherheit} – ${a.reason}`.slice(0, 400), 'llm', signale);
      } else {
        const bot = this.botZeile(botId);
        if (bot.status === 'laeuft' && !this.notaus) this.kaufVersuchen(botId, e, b, positionsGroesse(e, bot.kasse_sol - this.reserviert(botId)), `LLM ${sicher.toFixed(2)}: ${a.reason}`.slice(0, 400), 'llm', sicher, signale);
      }
    } catch (err) {
      this.entscheidungMerken(botId, b.info.mint, b.info.symbol, 'hold', null, `LLM-Fehler: ${(err as Error).message}`.slice(0, 300), 'code', signale);
    } finally {
      this.llmLaeuft.delete(botId);
    }
  }

  /** Vorschlag „kaufen“ → das Risk-Gate entscheidet */
  private kaufVersuchen(botId: string, e: KryptoEinstellung, b: Beobachtung, groesse: number, grund: string, quelle: 'regeln' | 'llm', sicherheit: number, signale: Signal[]) {
    const g = gate(e, this.lage(botId, e, b.info.mint), groesse);
    this.modulMerken(botId, 'groesse', `${groesse.toFixed(3)} SOL`, 'neutral');
    this.modulMerken(botId, 'gate', g.erlaubt ? `frei · ${g.grund}` : g.grund, g.erlaubt ? 'gut' : 'schlecht');
    if (!g.erlaubt) return this.entscheidungMerken(botId, b.info.mint, b.info.symbol, 'hold', sicherheit, `Gate: ${g.grund} (${grund})`, quelle, signale);
    const jetzt = this.o.uhr.jetzt();
    this.auftraege.push({ botId, art: 'kauf', mint: b.info.mint, symbol: b.info.symbol, name: b.info.name, menge: groesse, grund, entschieden: jetzt, ab: jetzt + this.verzoegerung(botId, e), versuche: 0 });
    b.aufzeichnen = true;
    this.entscheidungMerken(botId, b.info.mint, b.info.symbol, 'buy', sicherheit, grund, quelle, signale);
  }

  // ---- Ausführung (Paper) ---------------------------------------------------------------------------

  private auftraegeAusfuehren() {
    const jetzt = this.o.uhr.jetzt();
    const offen: Auftrag[] = [];
    for (const a of this.auftraege) {
      if (a.erledigt) continue;
      if (this.liveLaeuft.has(a)) {
        offen.push(a);
        continue;
      }
      if (this.istLive(a.botId) && jetzt >= a.ab) {
        // echt: die Verzögerung ist die echte (PumpPortal → RPC → Block)
        offen.push(a);
        this.liveLaeuft.add(a);
        void (a.art === 'kauf' ? this.liveKaufen(a) : this.liveVerkaufen(a))
          .catch((e) => this.o.log?.(`Live ${a.art} ${a.symbol}: ${(e as Error).message}`))
          .finally(() => {
            this.liveLaeuft.delete(a);
          });
        continue;
      }
      const s = this.tokens.get(a.mint)?.letzter;
      // Ausgeführt wird zum ersten Kurs NACH der Verzögerung – nie zum Kurs, den der Bot gesehen hat
      if (jetzt < a.ab || !s || s.zeit < a.ab) {
        // ohne Kurs nach 5 min: Kauf verfällt, Verkauf bleibt stehen
        if (a.art === 'kauf' && jetzt - a.entschieden > 5 * MINUTE) this.entscheidungMerken(a.botId, a.mint, a.symbol, 'hold', null, 'Kauf verfallen: kein Kurs nach der Verzögerung', 'code');
        else offen.push(a);
        continue;
      }
      try {
        if (a.art === 'kauf') this.kaufAusfuehren(a, s);
        else if (!this.verkaufAusfuehren(a, s)) offen.push({ ...a, ab: jetzt + 2000, versuche: a.versuche + 1 });
      } catch (e) {
        this.o.log?.(`Ausführung ${a.art} ${a.symbol}: ${(e as Error).message}`);
      }
    }
    this.auftraege = offen.filter((a) => !a.erledigt);
  }

  private netz(e: KryptoEinstellung) {
    return GRUNDGEBUEHR_SOL + e.simulation.prioritaetSol;
  }

  private portalSatz(e: KryptoEinstellung) {
    return (e.simulation.portalGebuehrProzent ?? 0.5) / 100;
  }

  private istLive(botId: string) {
    return (this.o.db.prepare('SELECT modus FROM bots WHERE id = ?').get(botId) as { modus: string } | undefined)?.modus === 'live';
  }

  private verzoegerung(botId: string, e: KryptoEinstellung) {
    return this.istLive(botId) ? 0 : e.simulation.verzoegerungMs;
  }

  // ---- Live (E228): echte Trades über PumpPortal Local + RPC ------------------------------------------

  private async liveKaufen(a: Auftrag) {
    const bot = this.botZeile(a.botId);
    const e = this.einstellung(bot);
    const adresse = this.o.tresor?.adresse(a.botId);
    // ein Kauf wird genau einmal versucht – egal wie er ausgeht
    a.erledigt = true;
    if (!this.o.live || !adresse) return this.entscheidungMerken(a.botId, a.mint, a.symbol, 'hold', null, 'Live-Kauf abgebrochen: kein Wallet/RPC', 'code');
    if (bot.status !== 'laeuft' || this.notaus) return;
    // echtes Guthaben prüfen (Reserve für Gebühren und Konto-Miete)
    const guthaben = await this.o.live.guthabenSol(adresse);
    this.guthaben.set(adresse, { sol: guthaben, zeit: Date.now() });
    if (guthaben < a.menge + 0.01) return this.entscheidungMerken(a.botId, a.mint, a.symbol, 'hold', null, `Live-Kauf abgebrochen: Wallet hat ${guthaben.toFixed(4)} SOL`, 'code');
    const start = this.o.uhr.jetzt();
    const r = await this.o.live.kaufen(adresse, a.mint, a.menge, e.slippageProzent ?? 15, e.simulation.prioritaetSol);
    const jetzt = this.o.uhr.jetzt();
    const verz = jetzt - a.entschieden;
    const s = this.tokens.get(a.mint)?.letzter;
    if (r.fehler || r.tokenDelta <= 0) {
      const kosten = Math.max(0, -r.solDelta);
      this.o.db.prepare('UPDATE bots SET kasse_sol = kasse_sol - ? WHERE id = ?').run(kosten, a.botId);
      this.o.db.prepare("INSERT INTO trades (bot_id, position_id, zeit, art, mint, symbol, sol, token, preis, gebuehr_sol, portal_sol, netz_sol, slippage, verzoegerung_ms, grund, signatur, live) VALUES (?, NULL, ?, 'fehlschlag', ?, ?, 0, 0, ?, 0, 0, ?, 0, ?, ?, ?, 1)").run(a.botId, jetzt, a.mint, a.symbol, s?.preisSol ?? 0, kosten, verz, `Live-Kauf: ${r.fehler ?? 'keine Token erhalten'}`.slice(0, 300), r.signatur);
      return;
    }
    const ausgegeben = -r.solDelta; // inkl. aller Gebühren und Konto-Miete
    const spot = s?.preisSol ?? ausgegeben / r.tokenDelta;
    const pump = (a.menge - a.menge * this.portalSatz(e)) * gebuehrSatz(s?.dex === 'pumpfun' || !s ? 'kurve' : 'pool', spot * ANGEBOT);
    const id = crypto.randomUUID();
    this.o.db.transaction(() => {
      this.o.db.prepare('UPDATE bots SET kasse_sol = kasse_sol - ? WHERE id = ?').run(ausgegeben, a.botId);
      this.o.db
        .prepare('INSERT INTO positionen (id, bot_id, mint, symbol, name, geoeffnet, token, rest_token, einsatz_sol, einstieg_preis, einstieg_spot, hoechst, live) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)')
        .run(id, a.botId, a.mint, a.symbol, a.name, jetzt, r.tokenDelta, r.tokenDelta, ausgegeben, ausgegeben / r.tokenDelta, spot, spot);
      this.o.db
        .prepare("INSERT INTO trades (bot_id, position_id, zeit, art, mint, symbol, sol, token, preis, gebuehr_sol, portal_sol, netz_sol, slippage, verzoegerung_ms, grund, signatur, live) VALUES (?, ?, ?, 'kauf', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)")
        .run(a.botId, id, jetzt, a.mint, a.symbol, ausgegeben, r.tokenDelta, ausgegeben / r.tokenDelta, pump, a.menge * this.portalSatz(e), r.netzSol, (ausgegeben / r.tokenDelta / spot - 1) * 100, jetzt - start + (start - a.entschieden), a.grund, r.signatur);
    })();
    // Not-Aus kam, während die Transaktion unterwegs war → sofort wieder verkaufen
    if (this.notaus) {
      this.auftraege.push({ botId: a.botId, art: 'verkauf', mint: a.mint, symbol: a.symbol, name: a.name, menge: r.tokenDelta, positionId: id, grund: 'Not-Aus', entschieden: jetzt, ab: jetzt, versuche: 0 });
      this.entscheidungMerken(a.botId, a.mint, a.symbol, 'sell', null, 'Not-Aus (Kauf lief noch)', 'code');
    }
  }

  private async liveVerkaufen(a: Auftrag) {
    const p = this.o.db.prepare('SELECT * FROM positionen WHERE id = ?').get(a.positionId) as PositionZeile | undefined;
    const fertig = () => {
      a.erledigt = true;
    };
    if (!p || !p.offen) return fertig();
    const e = this.einstellung(this.botZeile(a.botId));
    const adresse = this.o.tresor?.adresse(a.botId);
    if (!this.o.live || !adresse) return;
    const alles = a.menge >= p.rest_token * 0.999;
    const r = await this.o.live.verkaufen(adresse, a.mint, alles ? 'alles' : a.menge, e.slippageProzent ?? 15, e.simulation.prioritaetSol);
    const jetzt = this.o.uhr.jetzt();
    const verz = jetzt - a.entschieden;
    const s = this.tokens.get(a.mint)?.letzter;
    const verkauft = -r.tokenDelta;
    if (r.fehler || verkauft <= 0) {
      const kosten = Math.max(0, -r.solDelta);
      this.o.db.prepare('UPDATE bots SET kasse_sol = kasse_sol - ? WHERE id = ?').run(kosten, a.botId);
      this.o.db.prepare('UPDATE positionen SET erloes_sol = erloes_sol - ? WHERE id = ?').run(kosten, p.id);
      this.o.db.prepare("INSERT INTO trades (bot_id, position_id, zeit, art, mint, symbol, sol, token, preis, gebuehr_sol, portal_sol, netz_sol, slippage, verzoegerung_ms, grund, signatur, live) VALUES (?, ?, ?, 'fehlschlag', ?, ?, 0, 0, ?, 0, 0, ?, 0, ?, ?, ?, 1)").run(a.botId, p.id, jetzt, a.mint, a.symbol, s?.preisSol ?? 0, kosten, verz, `Live-Verkauf: ${r.fehler ?? 'nichts verkauft'} – neuer Versuch`.slice(0, 300), r.signatur);
      // neuer Versuch mit wachsender Pause (Verkäufe geben nie auf)
      a.ab = jetzt + Math.min(60_000, 2000 * 2 ** Math.min(a.versuche, 5));
      a.versuche++;
      return;
    }
    fertig();
    const erhalten = r.solDelta;
    const rest = alles ? 0 : Math.max(0, p.rest_token - verkauft);
    const zu = rest <= p.token * 1e-6;
    const erloes = p.erloes_sol + erhalten;
    const spot = s?.preisSol ?? erhalten / verkauft;
    this.o.db.transaction(() => {
      this.o.db.prepare('UPDATE bots SET kasse_sol = kasse_sol + ? WHERE id = ?').run(erhalten, a.botId);
      this.o.db.prepare('UPDATE positionen SET rest_token = ?, erloes_sol = ?, offen = ?, geschlossen = ?, gewinn_sol = ? WHERE id = ?').run(zu ? 0 : rest, erloes, zu ? 0 : 1, zu ? jetzt : null, zu ? erloes - p.einsatz_sol : null, p.id);
      this.o.db
        .prepare("INSERT INTO trades (bot_id, position_id, zeit, art, mint, symbol, sol, token, preis, gebuehr_sol, portal_sol, netz_sol, slippage, verzoegerung_ms, grund, signatur, live) VALUES (?, ?, ?, 'verkauf', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)")
        .run(a.botId, p.id, jetzt, a.mint, a.symbol, erhalten, verkauft, erhalten / verkauft, verkauft * spot * gebuehrSatz(s?.dex === 'pumpfun' || !s ? 'kurve' : 'pool', spot * ANGEBOT), verkauft * spot * this.portalSatz(e), r.netzSol, (1 - erhalten / verkauft / spot) * 100, verz, a.grund, r.signatur);
    })();
  }

  /** Scharf schalten: nur nach Paper-Mindestzeit, ohne offene Positionen, mit Wallet-Guthaben ≥ Budget (Dorf prüft Passwort/TOTP) */
  async scharfSchalten(id: string, o: { budgetSol: number }) {
    const b = this.botZeile(id);
    if (b.modus === 'live') throw new KryptoFehler(409, 'Der Bot ist schon scharf.');
    if (this.notaus) throw new KryptoFehler(409, 'Not-Aus ist aktiv.');
    if (!this.o.tresor?.bereit) throw new KryptoFehler(503, 'Live ist nicht eingerichtet: der Hauptschlüssel der Wallets fehlt (kommt mit dorf deploy).');
    if (!this.o.live) throw new KryptoFehler(503, 'Live ist nicht eingerichtet: kein Solana-RPC – auf dem Server dorf krypto-rpc ausführen.');
    const adresse = this.o.tresor.adresse(id);
    if (!adresse) throw new KryptoFehler(409, 'Der Bot hat kein Wallet.');
    if (!(o.budgetSol >= 0.05 && o.budgetSol <= 50)) throw new KryptoFehler(400, 'Budget zwischen 0,05 und 50 SOL.');
    const mindest = this.o.paperMindestMs ?? KRYPTO_PAPER_MINDESTENS_STUNDEN * 3_600_000;
    const seit = b.abschnitt_seit ?? b.erstellt;
    if (this.o.uhr.jetzt() - seit < mindest) throw new KryptoFehler(409, `Erst ${Math.round(mindest / 3_600_000)} h im Paper Trading testen (noch ${Math.ceil((mindest - (this.o.uhr.jetzt() - seit)) / 3_600_000)} h).`);
    if (this.offenePositionen(id).length || this.aktiv().some((a) => a.botId === id)) throw new KryptoFehler(409, 'Erst alle (Paper-)Positionen schließen – Bot pausieren und warten.');
    const guthaben = await this.o.live.guthabenSol(adresse);
    this.guthaben.set(adresse, { sol: guthaben, zeit: Date.now() });
    if (guthaben < o.budgetSol + 0.02) throw new KryptoFehler(409, `Im Wallet ${adresse} liegen ${guthaben.toFixed(4)} SOL – für ${o.budgetSol} SOL Budget braucht es mindestens ${(o.budgetSol + 0.02).toFixed(2)} SOL (Reserve für Gebühren).`);
    const jetzt = this.o.uhr.jetzt();
    const bilanz = this.kennzahlen(id);
    this.o.db
      .prepare("UPDATE bots SET modus = 'live', status = 'laeuft', kasse_sol = ?, abschnitt_seit = ?, live_json = ?, paper_bilanz_json = ?, geaendert = ? WHERE id = ?")
      .run(o.budgetSol, jetzt, JSON.stringify({ seit: new Date(jetzt).toISOString(), budgetSol: o.budgetSol }), JSON.stringify(bilanz), jetzt, id);
    this.o.db.prepare('INSERT OR REPLACE INTO equity (bot_id, zeit, wert) VALUES (?, ?, ?)').run(id, Math.floor(jetzt / MINUTE) * MINUTE, o.budgetSol);
    this.o.log?.(`Bot ${id} scharf geschaltet (Budget ${o.budgetSol} SOL)`);
    this.verbindungPruefen();
    return this.bot(id);
  }

  /** zurück ins Paper Trading (neuer Abschnitt mit dem Startkapital) – nur ohne offene Positionen */
  entschaerfen(id: string) {
    const b = this.botZeile(id);
    if (b.modus !== 'live') throw new KryptoFehler(409, 'Der Bot ist nicht scharf.');
    if (this.offenePositionen(id).length || this.aktiv().some((a) => a.botId === id)) throw new KryptoFehler(409, 'Erst alle Positionen verkaufen: Not-Aus oder pausieren und warten.');
    const e = this.einstellung(b);
    const jetzt = this.o.uhr.jetzt();
    this.o.db.prepare("UPDATE bots SET modus = 'paper', status = 'pausiert', kasse_sol = ?, abschnitt_seit = ?, live_json = NULL, geaendert = ? WHERE id = ?").run(e.startkapitalSol, jetzt, jetzt, id);
    this.o.db.prepare('INSERT OR REPLACE INTO equity (bot_id, zeit, wert) VALUES (?, ?, ?)').run(id, Math.floor(jetzt / MINUTE) * MINUTE, e.startkapitalSol);
    return this.bot(id);
  }

  /** gesamtes Guthaben an die feste Adresse aus krypto.env – nur wenn der Bot nicht scharf handelt */
  async auszahlen(id: string) {
    const b = this.botZeile(id);
    if (!this.o.live || !this.o.tresor) throw new KryptoFehler(503, 'Live ist nicht eingerichtet (RPC).');
    if (!this.o.auszahlung || !istAdresse(this.o.auszahlung)) throw new KryptoFehler(409, 'Keine Auszahlungsadresse eingetragen (auf dem Server: dorf krypto-auszahlung <Adresse>).');
    if (b.modus === 'live' && (b.status === 'laeuft' || this.offenePositionen(id).length)) throw new KryptoFehler(409, 'Erst entschärfen bzw. pausieren und alle Positionen verkaufen.');
    const adresse = this.o.tresor.adresse(id);
    if (!adresse) throw new KryptoFehler(409, 'Der Bot hat kein Wallet.');
    const r = await this.o.live.auszahlen(adresse, this.o.auszahlung);
    if (r.fehler) throw new KryptoFehler(502, r.fehler);
    this.guthaben.delete(adresse);
    this.o.log?.(`Auszahlung ${adresse} → ${this.o.auszahlung}: ${r.signatur}`);
    return { signatur: r.signatur, betragSol: -r.solDelta, an: this.o.auszahlung };
  }

  /** Guthaben der Wallets nebenbei auffrischen (höchstens alle 60 s je Wallet) */
  private guthabenAuffrischen() {
    if (!this.o.live || !this.o.tresor) return;
    const jetzt = Date.now();
    for (const b of this.botZeilen()) {
      const adr = this.o.tresor.adresse(b.id);
      if (!adr) continue;
      const g = this.guthaben.get(adr);
      if (g && jetzt - g.zeit < 60_000) continue;
      this.guthaben.set(adr, { sol: g?.sol ?? NaN, zeit: jetzt });
      void this.o.live
        .guthabenSol(adr)
        .then((sol) => this.guthaben.set(adr, { sol, zeit: Date.now() }))
        .catch(() => undefined);
    }
  }

  private fehlgeschlagen(e: KryptoEinstellung) {
    return (this.o.zufall ?? Math.random)() * 100 < e.simulation.fehlschlagProzent;
  }

  private kaufAusfuehren(a: Auftrag, s: Schnappschuss) {
    const bot = this.botZeile(a.botId);
    const e = this.einstellung(bot);
    const jetzt = this.o.uhr.jetzt();
    const netz = this.netz(e);
    const markt = marktAus(s);
    const verz = s.zeit - a.entschieden;
    if (bot.status !== 'laeuft' || this.notaus) return;
    if (!markt) return this.entscheidungMerken(a.botId, a.mint, a.symbol, 'hold', null, 'Kauf abgebrochen: keine Liquiditätsdaten', 'code');
    if (bot.kasse_sol < a.menge + netz) return this.entscheidungMerken(a.botId, a.mint, a.symbol, 'hold', null, 'Kauf abgebrochen: Kapital reicht nicht', 'code');
    if (this.fehlgeschlagen(e)) {
      this.o.db.prepare('UPDATE bots SET kasse_sol = kasse_sol - ? WHERE id = ?').run(netz, a.botId);
      this.o.db.prepare("INSERT INTO trades (bot_id, position_id, zeit, art, mint, symbol, sol, token, preis, gebuehr_sol, netz_sol, slippage, verzoegerung_ms, grund) VALUES (?, NULL, ?, 'fehlschlag', ?, ?, 0, 0, ?, 0, ?, 0, ?, ?)").run(a.botId, jetzt, a.mint, a.symbol, s.preisSol, netz, verz, 'Kauf-Transaktion fehlgeschlagen (simuliert) – Netzgebühr bezahlt');
      return;
    }
    const f = kaufen(markt, a.menge, this.portalSatz(e));
    const id = crypto.randomUUID();
    this.o.db.transaction(() => {
      this.o.db.prepare('UPDATE bots SET kasse_sol = kasse_sol - ? WHERE id = ?').run(a.menge + netz, a.botId);
      this.o.db
        .prepare('INSERT INTO positionen (id, bot_id, mint, symbol, name, geoeffnet, token, rest_token, einsatz_sol, einstieg_preis, einstieg_spot, hoechst) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, a.botId, a.mint, a.symbol, a.name, jetzt, f.token, f.token, a.menge + netz, f.preis, s.preisSol, s.preisSol);
      this.o.db
        .prepare("INSERT INTO trades (bot_id, position_id, zeit, art, mint, symbol, sol, token, preis, gebuehr_sol, portal_sol, netz_sol, slippage, verzoegerung_ms, grund) VALUES (?, ?, ?, 'kauf', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(a.botId, id, jetzt, a.mint, a.symbol, a.menge, f.token, f.preis, f.gebuehrSol, f.portalSol, netz, f.slippageProzent, verz, a.grund);
    })();
  }

  /** false = fehlgeschlagen (wird erneut versucht) */
  private verkaufAusfuehren(a: Auftrag, s: Schnappschuss): boolean {
    const p = this.o.db.prepare('SELECT * FROM positionen WHERE id = ?').get(a.positionId) as PositionZeile | undefined;
    if (!p || !p.offen) return true;
    const e = this.einstellung(this.botZeile(a.botId));
    const jetzt = this.o.uhr.jetzt();
    const netz = this.netz(e);
    const markt = marktAus(s);
    const verz = s.zeit - a.entschieden;
    const menge = Math.min(a.menge, p.rest_token);
    if (!markt) return false;
    if (this.fehlgeschlagen(e) && a.versuche < 5) {
      this.o.db.prepare('UPDATE bots SET kasse_sol = kasse_sol - ? WHERE id = ?').run(netz, a.botId);
      this.o.db.prepare('UPDATE positionen SET erloes_sol = erloes_sol - ? WHERE id = ?').run(netz, p.id);
      this.o.db.prepare("INSERT INTO trades (bot_id, position_id, zeit, art, mint, symbol, sol, token, preis, gebuehr_sol, netz_sol, slippage, verzoegerung_ms, grund) VALUES (?, ?, ?, 'fehlschlag', ?, ?, 0, 0, ?, 0, ?, 0, ?, ?)").run(a.botId, p.id, jetzt, a.mint, a.symbol, s.preisSol, netz, verz, 'Verkauf fehlgeschlagen (simuliert) – neuer Versuch');
      return false;
    }
    const f = verkaufen(markt, menge, this.portalSatz(e));
    const rest = p.rest_token - menge;
    const zu = rest <= p.token * 1e-6;
    const erloes = p.erloes_sol + f.sol - netz;
    this.o.db.transaction(() => {
      this.o.db.prepare('UPDATE bots SET kasse_sol = kasse_sol + ? WHERE id = ?').run(f.sol - netz, a.botId);
      this.o.db.prepare('UPDATE positionen SET rest_token = ?, erloes_sol = ?, offen = ?, geschlossen = ?, gewinn_sol = ? WHERE id = ?').run(zu ? 0 : rest, erloes, zu ? 0 : 1, zu ? jetzt : null, zu ? erloes - p.einsatz_sol : null, p.id);
      this.o.db
        .prepare("INSERT INTO trades (bot_id, position_id, zeit, art, mint, symbol, sol, token, preis, gebuehr_sol, portal_sol, netz_sol, slippage, verzoegerung_ms, grund) VALUES (?, ?, ?, 'verkauf', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(a.botId, p.id, jetzt, a.mint, a.symbol, f.sol, menge, f.preis, f.gebuehrSol, f.portalSol, netz, f.slippageProzent, verz, a.grund);
    })();
    return true;
  }

  /** Take-Profit-Stufen, Stop-Loss, Trailing Stop, Haltedauer – alles Code */
  private positionenPflegen() {
    const jetzt = this.o.uhr.jetzt();
    for (const p of this.offenePositionen()) {
      if (this.aktiv().some((a) => a.positionId === p.id)) continue;
      const s = this.tokens.get(p.mint)?.letzter;
      if (!s || s.zeit <= p.geoeffnet) continue;
      const bot = this.botZeile(p.bot_id);
      const e = this.einstellung(bot);
      const kurs = s.preisSol;
      if (kurs > p.hoechst) this.o.db.prepare('UPDATE positionen SET hoechst = ? WHERE id = ?').run(kurs, p.id);
      const hoechst = Math.max(p.hoechst, kurs);
      const plus = (kurs / p.einstieg_spot - 1) * 100;
      const verkauf = (menge: number, grund: string, modul: KryptoModulSchluessel) => {
        this.auftraege.push({ botId: p.bot_id, art: 'verkauf', mint: p.mint, symbol: p.symbol, name: p.name, menge, positionId: p.id, grund, entschieden: jetzt, ab: jetzt + this.verzoegerung(p.bot_id, e), versuche: 0 });
        this.entscheidungMerken(p.bot_id, p.mint, p.symbol, 'sell', null, grund, 'code');
        this.modulMerken(p.bot_id, modul, `${p.symbol}: ${grund}`, modul === 'tp' ? 'gut' : 'schlecht');
      };
      if (plus <= -e.ausstieg.stopLossProzent) verkauf(p.rest_token, `Stop-Loss ${plus.toFixed(1)} %`, 'sl');
      else if (e.ausstieg.trailingProzent > 0 && hoechst > p.einstieg_spot && kurs <= hoechst * (1 - e.ausstieg.trailingProzent / 100)) verkauf(p.rest_token, `Trailing Stop ${((kurs / hoechst - 1) * 100).toFixed(1)} % vom Hoch`, 'sl');
      else if (jetzt - p.geoeffnet >= e.ausstieg.maxHaltMinuten * MINUTE) verkauf(p.rest_token, `Haltedauer ${e.ausstieg.maxHaltMinuten} min erreicht`, 'sl');
      else {
        const stufe = e.ausstieg.takeProfit[p.tp_stufe];
        if (stufe && plus >= stufe.beiProzent) {
          const letzte = p.tp_stufe === e.ausstieg.takeProfit.length - 1;
          const menge = letzte ? p.rest_token : Math.min(p.rest_token, (p.token * stufe.verkaufProzent) / 100);
          this.o.db.prepare('UPDATE positionen SET tp_stufe = tp_stufe + 1 WHERE id = ?').run(p.id);
          verkauf(menge, `Take-Profit ${p.tp_stufe + 1}: +${plus.toFixed(0)} %`, 'tp');
        }
      }
    }
  }

  // ---- Protokoll und Kennzahlen ---------------------------------------------------------------------

  private modulMerken(botId: string, k: KryptoModulSchluessel, zeile: string, ton: KryptoModul['ton']) {
    let m = this.module.get(botId);
    if (!m) this.module.set(botId, (m = new Map()));
    m.set(k, { zeile: zeile.slice(0, 60), ton, zeit: this.o.uhr.jetzt() });
  }

  private entscheidungMerken(botId: string, mint: string, symbol: string, aktion: KryptoEntscheidung['aktion'], sicherheit: number | null, grund: string, quelle: KryptoEntscheidung['quelle'], signale?: Signal[], rugGeblockt = false) {
    this.o.db
      .prepare('INSERT INTO entscheidungen (bot_id, zeit, mint, symbol, aktion, sicherheit, grund, quelle, module_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(botId, this.o.uhr.jetzt(), mint, symbol, rugGeblockt ? 'block' : aktion, sicherheit, (rugGeblockt ? `RUG · ${grund}` : grund).slice(0, 500), quelle, signale ? JSON.stringify(signale.map((s) => [s.schluessel, s.sperre, s.punkte, s.zeile])) : null);
  }

  private equityWert(botId: string, kasse: number) {
    let wert = kasse;
    const satz = this.portalSatz(this.einstellung(this.botZeile(botId)));
    for (const p of this.offenePositionen(botId)) {
      const s = this.tokens.get(p.mint)?.letzter;
      const m = s ? marktAus(s) : null;
      wert += m ? verkaufsWert(m, p.rest_token, satz) : p.einsatz_sol;
    }
    return wert;
  }

  private seit(b: BotZeile) {
    return b.abschnitt_seit ?? b.erstellt;
  }

  private startSol(b: BotZeile) {
    const live = b.live_json ? (JSON.parse(b.live_json) as { budgetSol: number }) : null;
    return live?.budgetSol ?? this.einstellung(b).startkapitalSol;
  }

  private equityMerken() {
    const minute = Math.floor(this.o.uhr.jetzt() / MINUTE) * MINUTE;
    const ein = this.o.db.prepare('INSERT OR REPLACE INTO equity (bot_id, zeit, wert) VALUES (?, ?, ?)');
    for (const b of this.botZeilen()) {
      ein.run(b.id, minute, this.equityWert(b.id, b.kasse_sol));
      this.probeMerken(b.id, b.kasse_sol);
    }
  }

  private heute(botId: string, e: KryptoEinstellung) {
    const jetzt = this.o.uhr.jetzt();
    const tag = tagIn(jetzt);
    const b = this.botZeile(botId);
    const reihe = this.o.db.prepare('SELECT zeit, wert FROM equity WHERE bot_id = ? AND zeit >= ? ORDER BY zeit').all(botId, Math.max(jetzt - 26 * 3_600_000, Math.floor(this.seit(b) / MINUTE) * MINUTE)) as { zeit: number; wert: number }[];
    const ab = reihe.find((r) => tagIn(r.zeit) === tag);
    const vorher = [...reihe].reverse().find((r) => tagIn(r.zeit) !== tag);
    const basis = vorher?.wert ?? ab?.wert ?? (b.live_json ? this.startSol(b) : e.startkapitalSol);
    return this.equityWert(botId, this.botZeile(botId).kasse_sol) - basis;
  }

  private aufraeumen() {
    const jetzt = this.o.uhr.jetzt();
    if (jetzt - Number(this.stand('aufgeraeumt') ?? 0) < 3_600_000) return;
    this.standSetzen('aufgeraeumt', String(jetzt));
    this.o.db.prepare('DELETE FROM kurse WHERE zeit < ?').run(jetzt - KURSE_BEHALTEN);
    this.o.db.prepare('DELETE FROM equity_fein WHERE zeit < ?').run(jetzt - 6 * 3_600_000);
    this.o.db.prepare("DELETE FROM entscheidungen WHERE aktion IN ('block', 'hold') AND zeit < ?").run(jetzt - 7 * 86_400_000);
    this.o.db.prepare('DELETE FROM equity WHERE zeit < ? AND zeit % 3600000 != 0').run(jetzt - 7 * 86_400_000);
    const fenster = Math.max(this.fensterSek() * 1000, 30 * MINUTE);
    const gehalten = new Set(this.offenePositionen().map((p) => p.mint));
    for (const [m, b] of this.tokens) if (!gehalten.has(m) && jetzt - b.info.erstellt > fenster + 10 * MINUTE) this.tokens.delete(m);
  }

  kennzahlen(id: string): KryptoKennzahlen {
    const b = this.botZeile(id);
    const e = this.einstellung(b);
    const seit = this.seit(b);
    const start = this.startSol(b);
    const zu = this.o.db.prepare('SELECT gewinn_sol FROM positionen WHERE bot_id = ? AND offen = 0 AND geoeffnet >= ?').all(id, seit) as { gewinn_sol: number }[];
    const gewonnen = zu.filter((x) => x.gewinn_sol > 0).length;
    const kapital = this.equityWert(id, b.kasse_sol);
    const reihe = (this.o.db.prepare('SELECT wert FROM equity WHERE bot_id = ? AND zeit >= ? ORDER BY zeit').all(id, Math.floor(seit / MINUTE) * MINUTE) as { wert: number }[]).map((x) => x.wert);
    reihe.push(kapital);
    let hoch = -Infinity;
    let dd = 0;
    for (const w of reihe) {
      hoch = Math.max(hoch, w);
      if (hoch > 0) dd = Math.max(dd, (hoch - w) / hoch);
    }
    const g = this.o.db.prepare("SELECT COALESCE(SUM(gebuehr_sol), 0) AS pump, COALESCE(SUM(portal_sol), 0) AS portal, COALESCE(SUM(netz_sol), 0) AS netz, COALESCE(SUM(CASE WHEN art != 'fehlschlag' THEN sol ELSE 0 END), 0) AS umsatz FROM trades WHERE bot_id = ? AND zeit >= ?").get(id, seit) as { pump: number; portal: number; netz: number; umsatz: number };
    const rugs = (this.o.db.prepare("SELECT COUNT(*) AS n FROM entscheidungen WHERE bot_id = ? AND aktion = 'block' AND grund LIKE 'RUG ·%' AND zeit >= ?").get(id, seit) as { n: number }).n;
    void e;
    return {
      kapitalSol: kapital,
      startSol: start,
      faktor: kapital / start,
      gewinnSol: kapital - start,
      gewinnProzent: (kapital / start - 1) * 100,
      trades: zu.length,
      gewonnen,
      verloren: zu.length - gewonnen,
      trefferquote: zu.length ? gewonnen / zu.length : null,
      maxDrawdownProzent: dd * 100,
      offen: this.offenePositionen(id).length,
      gebuehrenSol: g.pump + g.portal + g.netz,
      gebuehrenArt: { pumpSol: g.pump, portalSol: g.portal, netzSol: g.netz },
      umsatzSol: g.umsatz,
      geblockteRugs: rugs,
      heuteSol: this.heute(id, e),
    };
  }

  bot(id: string): KryptoBot {
    const b = this.botZeile(id);
    const seit = Math.floor(this.seit(b) / MINUTE) * MINUTE;
    const kurve = (this.o.db.prepare('SELECT zeit, wert FROM equity WHERE bot_id = ? AND zeit >= ? AND (zeit % 3600000 = 0 OR zeit = ?) ORDER BY zeit').all(id, seit, seit) as { zeit: number; wert: number }[]).map((x) => [x.zeit, x.wert] as [number, number]);
    const k = this.kennzahlen(id);
    kurve.push([this.o.uhr.jetzt(), k.kapitalSol]);
    const adresse = this.o.tresor?.adresse(id) ?? null;
    const g = adresse ? this.guthaben.get(adresse) : undefined;
    return {
      id,
      einstellung: this.einstellung(b),
      modus: b.modus === 'live' ? 'live' : 'paper',
      status: b.status,
      erstellt: new Date(b.erstellt).toISOString(),
      kennzahlen: k,
      kurve,
      wallet: adresse ? { adresse, guthabenSol: g && Number.isFinite(g.sol) ? g.sol : null } : null,
      live: b.live_json ? (JSON.parse(b.live_json) as KryptoBot['live']) : null,
      paperBilanz: b.paper_bilanz_json ? (JSON.parse(b.paper_bilanz_json) as KryptoKennzahlen) : null,
      abschnittSeit: new Date(this.seit(b)).toISOString(),
    };
  }

  uebersicht(): KryptoUebersicht {
    return {
      verbunden: true,
      liveMoeglich: !!this.o.live && !!this.o.tresor?.bereit,
      auszahlung: this.o.auszahlung && istAdresse(this.o.auszahlung) ? this.o.auszahlung : null,
      notaus: this.notaus,
      datenOnline: !!this.o.portal?.online,
      beobachtet: this.tokens.size,
      solUsd: this.solUsd,
      bots: this.botZeilen().map((b) => this.bot(b.id)),
      echtzeit: this.o.strom?.status() ?? null,
      ...(this.fehler || this.o.portal?.fehler ? { fehler: (this.fehler ?? this.o.portal?.fehler) as string } : {}),
    };
  }

  protokoll(id: string, o: { vor?: number; anzahl?: number } = {}) {
    this.botZeile(id);
    const anzahl = Math.min(o.anzahl ?? 100, 500);
    const vor = o.vor ?? Number.MAX_SAFE_INTEGER;
    return {
      entscheidungen: this.entscheidungen(id, anzahl, vor),
      trades: this.trades(id, anzahl, vor),
    };
  }

  private entscheidungen(id: string, anzahl: number, vor = Number.MAX_SAFE_INTEGER): KryptoEntscheidung[] {
    return (this.o.db.prepare('SELECT id, zeit, mint, symbol, aktion, sicherheit, grund, quelle FROM entscheidungen WHERE bot_id = ? AND id < ? ORDER BY id DESC LIMIT ?').all(id, vor, anzahl) as KryptoEntscheidung[]).map((x) => ({ ...x }));
  }

  private trades(id: string, anzahl: number, vor = Number.MAX_SAFE_INTEGER, abZeit?: number): KryptoTrade[] {
    const zeilen = (
      abZeit != null
        ? this.o.db.prepare("SELECT t.*, p.offen AS p_offen, p.gewinn_sol AS p_gewinn, p.einsatz_sol AS p_einsatz FROM trades t LEFT JOIN positionen p ON p.id = t.position_id WHERE t.bot_id = ? AND t.zeit >= ? AND t.art IN ('kauf', 'verkauf') ORDER BY t.id DESC LIMIT ?").all(id, abZeit, anzahl)
        : this.o.db.prepare('SELECT t.*, p.offen AS p_offen, p.gewinn_sol AS p_gewinn, p.einsatz_sol AS p_einsatz FROM trades t LEFT JOIN positionen p ON p.id = t.position_id WHERE t.bot_id = ? AND t.id < ? ORDER BY t.id DESC LIMIT ?').all(id, vor, anzahl)
    ) as (Record<string, number | string | null> & { art: KryptoTrade['art'] })[];
    return zeilen.map((t) => {
      const letzterVerkauf = t.art === 'verkauf' && t.p_offen === 0 && (this.o.db.prepare("SELECT MAX(id) AS m FROM trades WHERE position_id = ? AND art = 'verkauf'").get(t.position_id) as { m: number }).m === t.id;
      return {
        id: t.id as number,
        zeit: t.zeit as number,
        art: t.art,
        symbol: t.symbol as string,
        mint: t.mint as string,
        sol: t.sol as number,
        preis: t.preis as number,
        gebuehrSol: (t.gebuehr_sol as number) + (t.portal_sol as number) + (t.netz_sol as number),
        slippageProzent: t.slippage as number,
        verzoegerungMs: t.verzoegerung_ms as number,
        grund: t.grund as string,
        ...(t.signatur ? { signatur: t.signatur as string } : {}),
        ...(letzterVerkauf ? { gewinnSol: t.p_gewinn as number, gewinnProzent: ((t.p_gewinn as number) / (t.p_einsatz as number)) * 100 } : {}),
      };
    });
  }

  /**
   * E233: Equity-Kerzen im gewünschten Takt über den GANZEN Zeitraum (nicht erst ab jetzt): feine Proben (DB, 6 h), davor die
   * Minuten-Equity; Abschnitte ohne Bewegung werden als flache Kerze gefüllt, damit der Chart lückenlos von links bis jetzt reicht.
   */
  private equityKerzen(id: string, takt: KryptoKerzenTakt, jetzt: number, aktuell: number): KryptoKerze[] {
    const ms = KRYPTO_KERZEN_MS[takt];
    const anzahl = { '5s': 120, '15s': 120, '1m': 120, '5m': 72, '15m': 96 }[takt];
    const letzteZeit = Math.floor(jetzt / ms) * ms;
    const ab = letzteZeit - ms * (anzahl - 1);
    const fein = takt === '15m' ? [] : (this.o.db.prepare('SELECT zeit, wert FROM equity_fein WHERE bot_id = ? AND zeit >= ? ORDER BY zeit').all(id, ab) as { zeit: number; wert: number }[]);
    const grob = (this.o.db.prepare('SELECT zeit, wert FROM equity WHERE bot_id = ? AND zeit >= ? ORDER BY zeit').all(id, ab) as { zeit: number; wert: number }[]).filter((r) => !fein.length || r.zeit < fein[0]!.zeit);
    const reihe = [...grob, ...fein, { zeit: jetzt, wert: aktuell }];
    // Wert direkt vor dem Zeitraum (Startpunkt links); ohne ihn beginnt der Chart beim ersten bekannten Wert
    const vorher = this.o.db.prepare('SELECT wert FROM equity WHERE bot_id = ? AND zeit < ? ORDER BY zeit DESC LIMIT 1').get(id, ab) as { wert: number } | undefined;
    const proSlot = new Map<number, { o: number; h: number; l: number; c: number }>();
    for (const r of reihe) {
      const z = Math.floor(r.zeit / ms) * ms;
      const k = proSlot.get(z);
      if (k) ((k.h = Math.max(k.h, r.wert)), (k.l = Math.min(k.l, r.wert)), (k.c = r.wert));
      else proSlot.set(z, { o: r.wert, h: r.wert, l: r.wert, c: r.wert });
    }
    const start = vorher ? ab : Math.floor(reihe[0]!.zeit / ms) * ms;
    const kerzen: KryptoKerze[] = [];
    let zuletzt = vorher?.wert ?? reihe[0]!.wert;
    for (let z = Math.max(start, ab); z <= letzteZeit; z += ms) {
      const k = proSlot.get(z);
      // lückenlos: Eröffnung = letzter Schluss; ohne Daten im Abschnitt eine flache Kerze
      if (k) kerzen.push({ zeit: z, o: zuletzt, h: Math.max(zuletzt, k.h), l: Math.min(zuletzt, k.l), c: k.c });
      else kerzen.push({ zeit: z, o: zuletzt, h: zuletzt, l: zuletzt, c: zuletzt });
      zuletzt = kerzen.at(-1)!.c;
    }
    return kerzen;
  }

  terminal(id: string, takt: KryptoKerzenTakt = '15m'): KryptoTerminal {
    const jetzt = this.o.uhr.jetzt();
    const bot = this.bot(id);
    const e = bot.einstellung;
    const kerzen = this.equityKerzen(id, takt, jetzt, bot.kennzahlen.kapitalSol);
    const positionen: KryptoPosition[] = this.offenePositionen(id).map((p) => {
      const s = this.tokens.get(p.mint)?.letzter ?? null;
      const m = s ? marktAus(s) : null;
      const wert = m ? verkaufsWert(m, p.rest_token) : null;
      return { id: p.id, mint: p.mint, symbol: p.symbol, name: p.name, geoeffnet: p.geoeffnet, einsatzSol: p.einsatz_sol, einstiegPreis: p.einstieg_spot, preis: s?.preisSol ?? null, wertSol: wert, prozent: s ? (s.preisSol / p.einstieg_spot - 1) * 100 : null, tpStufe: p.tp_stufe };
    });
    // Module: was zuletzt gemeldet wurde; KOL/X ohne Quelle aus
    const m = this.module.get(id) ?? new Map();
    const tpZeile = positionen.length ? positionen.map((p) => `${p.symbol} → +${e.ausstieg.takeProfit[p.tpStufe]?.beiProzent ?? '–'} %`).join(' · ') : `+${e.ausstieg.takeProfit.map((t) => t.beiProzent).join('/+')} %`;
    const module: KryptoModul[] = KRYPTO_MODULE.map((x) => {
      const z = m.get(x.schluessel);
      if (x.schluessel === 'kol') return { ...x, an: false, zeile: 'aus – braucht PumpPortal-Schlüssel', zuletzt: null, ton: 'neutral' };
      if (x.schluessel === 'x') return { ...x, an: false, zeile: 'aus – braucht Grok-Schlüssel', zuletzt: null, ton: 'neutral' };
      const ersatz = x.schluessel === 'groesse' ? `${positionsGroesse(e, this.botZeile(id).kasse_sol).toFixed(3)} SOL je Trade` : x.schluessel === 'tp' ? tpZeile : x.schluessel === 'sl' ? `−${e.ausstieg.stopLossProzent} % · Trail ${e.ausstieg.trailingProzent} %` : x.schluessel === 'gate' ? `${bot.kennzahlen.offen}/${e.limits.maxOffen} offen · Tag ${bot.kennzahlen.heuteSol >= 0 ? '+' : ''}${bot.kennzahlen.heuteSol.toFixed(2)}` : 'wartet';
      return { ...x, an: true, zeile: z?.zeile ?? ersatz, zuletzt: z?.zeit ?? null, ton: z?.ton ?? 'neutral' };
    });
    const zuletzt = this.zuletztBewertet.get(id) ?? 0;
    const status = this.notaus ? 'Not-Aus' : bot.status === 'pausiert' ? 'pausiert' : bot.status === 'gestoppt' ? 'gestoppt' : this.llmLaeuft.has(id) ? 'LLM denkt …' : jetzt - zuletzt < 10_000 ? 'scoring …' : this.o.portal?.online ? 'lauscht …' : 'wartet auf Daten';
    const beobachtet = [...this.tokens.values()].filter((b) => b.letzter && jetzt - b.letzter.zeit < 5 * MINUTE);
    const gehalten = new Set(positionen.map((p) => p.mint));
    const pillen = [
      ...positionen.map((p) => ({ mint: p.mint, symbol: p.symbol, prozent: p.prozent, gehalten: true })),
      ...beobachtet
        .filter((b) => !gehalten.has(b.info.mint))
        .sort((a, b) => b.letzter!.volumenUsdM5 - a.letzter!.volumenUsdM5)
        .slice(0, 10 - positionen.length)
        .map((b) => ({ mint: b.info.mint, symbol: b.info.symbol, prozent: b.letzter!.aenderungM5, gehalten: false })),
    ];
    const topVolumen = beobachtet
      .sort((a, b) => b.letzter!.volumenUsdM5 - a.letzter!.volumenUsdM5)
      .slice(0, 5)
      .map((b) => ({ symbol: b.info.symbol, usd: b.letzter!.volumenUsdM5, kaeufe: b.letzter!.kaeufeM5, verkaeufe: b.letzter!.verkaeufeM5 }));
    // Gewinn je Stunde (Wien) heute aus geschlossenen Positionen
    const tag = tagIn(jetzt);
    const pnlStunden: (number | null)[] = Array.from({ length: 24 }, () => null);
    const stunde = (ms: number) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vienna', hour: '2-digit', hourCycle: 'h23' }).format(new Date(ms)));
    for (const p of this.o.db.prepare('SELECT geschlossen, gewinn_sol FROM positionen WHERE bot_id = ? AND offen = 0 AND geschlossen >= ?').all(id, jetzt - 26 * 3_600_000) as { geschlossen: number; gewinn_sol: number }[]) {
      if (tagIn(p.geschlossen) !== tag) continue;
      const h = stunde(p.geschlossen);
      pnlStunden[h] = (pnlStunden[h] ?? 0) + p.gewinn_sol;
    }
    const bester = (this.o.db.prepare('SELECT MAX(gewinn_sol) AS m FROM positionen WHERE bot_id = ? AND offen = 0').get(id) as { m: number | null }).m;
    return {
      bot,
      jetzt,
      datenOnline: !!this.o.portal?.online,
      solUsd: this.solUsd,
      kerzen,
      kerzenTakt: takt,
      chartTrades: kerzen.length ? this.trades(id, 500, undefined, kerzen[0]!.zeit) : [],
      lage: positionen.length ? 'LONG' : 'FLAT',
      positionen,
      trades: this.trades(id, 30),
      entscheidungen: this.entscheidungen(id, 40),
      module,
      status,
      pillen,
      topVolumen,
      volumenBalken: this.minutenVolumen,
      xFeed: [],
      xHinweis: 'X-Sentiment braucht einen Grok-Schlüssel (xAI) – noch nicht eingerichtet.',
      pnlStunden,
      besterTradeSol: bester,
      echtzeit: this.o.strom?.status() ?? null,
      tokenKerzen: this.tokenKerzenFuer(positionen.map((p) => ({ mint: p.mint, symbol: p.symbol }))),
    };
  }
}

export class KryptoFehler extends Error {
  constructor(
    readonly status: number,
    nachricht: string,
  ) {
    super(nachricht);
  }
}
