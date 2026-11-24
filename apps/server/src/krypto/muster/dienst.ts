// E235: Muster-Dienst im Kryptowerk – lädt das aktive Muster-Modell (GBDT + RL-Agent), trainiert alle paar Stunden auf den
// aufgezeichneten Echtzeit-Ticks (strom_ticks, 7 Tage) und gibt Status/Bericht für das Dorf und den Hafenmeister.
// Ein neues Modell ersetzt das alte nur, wenn musterTrainieren es „aktiv“ nennt (Test-AUC-Regeln in training.ts);
// das RL-Modell wechselt immer nur ZUSAMMEN mit dem GBDT (das Paar bleibt stimmig). Fehler stehen im Status.
import type { KryptoMusterStatus } from '@dorf/shared';
import type { Uhr } from '../../uhr.js';
import { KryptoFehler, type KDB } from '../motor.js';
import { gbdtVorhersagen } from './gbdt.js';
import { musterTrainieren, type TrainingsDaten, type TrainingsErgebnis } from './training.js';
import { STANDARD_ZIEL, type GbdtModell, type RlModell, type Tick, type TokenMeta } from './typen.js';

const TAG = 86_400_000;
/** Ticks so lange lesen (wie lange sie aufbewahrt werden: motor.ts) */
const FENSTER = 7 * TAG;
/** so viele Trainingsläufe bleiben in der Tabelle (das aktive Modell immer) */
const BEHALTEN = 20;

interface ModellZeile {
  version: number;
  erstellt: number;
  gbdt_json: string | null;
  rl_json: string | null;
  modell_json: string | null;
  rl_info_json: string | null;
  bericht: string;
  aktiv: number;
}

export type Trainer = typeof musterTrainieren;

/** Rechenzeit abgeben (HTTP, Takt, Echtzeit-Kurse laufen weiter) */
const abgeben = () => new Promise<void>((r) => setImmediate(r));

export class MusterDienst {
  private gbdt: GbdtModell | null = null;
  /** RL-Agent, der zum aktiven GBDT gehört */
  rl: RlModell | null = null;
  private modellInfo: KryptoMusterStatus['modell'] = null;
  private rlInfo: KryptoMusterStatus['rl'] = null;
  private bericht = 'Noch kein Training gelaufen.';
  private laeuft = false;
  private fortschritt = 0;
  private letzter: number | null = null;
  private naechster: number;
  private fehler: string | null = null;
  private dauerMs: number | null = null;
  private lauf: Promise<void> | null = null;
  private zeitgeber: ReturnType<typeof setInterval> | null = null;
  private datenCache: { zeit: number; daten: KryptoMusterStatus['daten'] } | null = null;

  constructor(
    private o: {
      db: KDB;
      uhr: Uhr;
      /** Abstand der Trainings (KRYPTO_MUSTER_STUNDEN, Standard 5) */
      stunden?: number;
      /** erstes Training so lange nach dem Start (Standard 10 min) */
      ersteNachMs?: number;
      log?: (t: string) => void;
      /** nur für Tests austauschbar */
      trainer?: Trainer;
      /** so viele Ticks je Lese-Stück (Standard 20 000) */
      stueckGroesse?: number;
    },
  ) {
    this.naechster = o.uhr.jetzt() + (o.ersteNachMs ?? 10 * 60_000);
    this.laden();
  }

  private get abstandMs() {
    return (this.o.stunden && this.o.stunden > 0 ? this.o.stunden : 5) * 3_600_000;
  }

  /** neuestes aktives Modell (Rat) + neuester Lauf (Bericht, letzter) aus der DB */
  private laden() {
    const neu = this.o.db.prepare('SELECT * FROM muster_modelle ORDER BY version DESC LIMIT 1').get() as ModellZeile | undefined;
    const aktiv = this.o.db.prepare('SELECT * FROM muster_modelle WHERE aktiv = 1 AND gbdt_json IS NOT NULL ORDER BY version DESC LIMIT 1').get() as ModellZeile | undefined;
    if (neu) {
      this.bericht = neu.bericht;
      this.letzter = neu.erstellt;
    }
    if (aktiv) {
      this.gbdt = JSON.parse(aktiv.gbdt_json!) as GbdtModell;
      this.rl = aktiv.rl_json ? (JSON.parse(aktiv.rl_json) as RlModell) : null;
      this.modellInfo = aktiv.modell_json ? (JSON.parse(aktiv.modell_json) as KryptoMusterStatus['modell']) : null;
      this.rlInfo = aktiv.rl_info_json ? (JSON.parse(aktiv.rl_info_json) as KryptoMusterStatus['rl']) : null;
    } else if (neu) {
      // kein aktives Modell: Status zeigt den letzten Lauf (aktiv: false), Rat gibt es keinen
      this.modellInfo = neu.modell_json ? (JSON.parse(neu.modell_json) as KryptoMusterStatus['modell']) : null;
      this.rlInfo = neu.rl_info_json ? (JSON.parse(neu.rl_info_json) as KryptoMusterStatus['rl']) : null;
    }
  }

  /** prüft jede Minute, ob ein Training fällig ist */
  starten() {
    this.zeitgeber = setInterval(() => this.faelligPruefen(), 60_000);
    this.zeitgeber.unref?.();
  }

  beenden() {
    if (this.zeitgeber) clearInterval(this.zeitgeber);
    this.zeitgeber = null;
  }

  /** startet das Training, wenn es an der Zeit ist (true = gestartet) */
  faelligPruefen(): boolean {
    if (this.laeuft || this.o.uhr.jetzt() < this.naechster) return false;
    this.trainingStarten();
    return true;
  }

  /** gibt das Modell gerade Rat? (nur mit aktivem GBDT) */
  get aktiv(): boolean {
    return !!this.gbdt && !!this.modellInfo?.aktiv;
  }

  /** Wahrscheinlichkeit für einen Merkmals-Vektor (null ohne aktives Modell) */
  vorhersagen(x: number[]): number | null {
    if (!this.aktiv) return null;
    const p = gbdtVorhersagen(this.gbdt!, x);
    return Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : null;
  }

  /** nur für Tests: ein Modellpaar direkt einsetzen */
  modellSetzen(gbdt: GbdtModell | null, rl: RlModell | null, info?: Partial<NonNullable<KryptoMusterStatus['modell']>>) {
    this.gbdt = gbdt;
    this.rl = rl;
    this.modellInfo = gbdt
      ? { version: gbdt.version, trainiert: new Date(this.o.uhr.jetzt()).toISOString(), beispiele: 0, positivAnteil: 0, test: { beispiele: 0, auc: 0.6, praezision: null, basis: 0 }, aktiv: true, merkmale: [], ...info }
      : null;
  }

  trainingStarten() {
    if (this.laeuft) throw new KryptoFehler(409, 'Das Training läuft schon – bitte warten.');
    this.laeuft = true;
    this.fortschritt = 0;
    this.fehler = null;
    this.lauf = this.trainieren().finally(() => {
      this.laeuft = false;
    });
    return { ok: true as const };
  }

  /** für Tests: wartet auf das laufende Training */
  async fertig() {
    await this.lauf;
  }

  private async trainieren() {
    const start = Date.now();
    const jetzt = this.o.uhr.jetzt();
    try {
      const daten = await this.datenLaden(jetzt);
      this.fortschritt = 0.2;
      const version = ((this.o.db.prepare('SELECT MAX(version) AS v FROM muster_modelle').get() as { v: number | null }).v ?? 0) + 1;
      const altAuc = this.aktiv ? this.modellInfo!.test.auc : null;
      const erg = await (this.o.trainer ?? musterTrainieren)(daten, {
        jetzt,
        version,
        altAuc,
        abgeben,
        // 0–1 (größere Werte gelten als Prozent)
        fortschritt: (x) => {
          const anteil = x > 1 ? x / 100 : x;
          this.fortschritt = 0.2 + Math.max(0, Math.min(1, anteil)) * 0.8;
        },
      });
      this.speichern(version, jetzt, erg);
    } catch (e) {
      this.fehler = (e as Error).message || String(e);
      this.o.log?.(`Muster-Training: ${this.fehler}`);
    } finally {
      const ende = this.o.uhr.jetzt();
      this.letzter = ende;
      this.naechster = ende + this.abstandMs;
      this.dauerMs = Date.now() - start;
      this.fortschritt = this.fehler ? this.fortschritt : 1;
    }
  }

  private speichern(version: number, jetzt: number, erg: TrainingsErgebnis) {
    const uebernehmen = !!erg.gbdt && !!erg.modell?.aktiv;
    let bericht = erg.bericht;
    if (!uebernehmen && this.aktiv) bericht += `\n\nDas bisherige Modell v${this.modellInfo!.version} (Test-AUC ${this.modellInfo!.test.auc.toFixed(3)}) bleibt aktiv.`;
    this.o.db
      .prepare('INSERT INTO muster_modelle (version, erstellt, gbdt_json, rl_json, modell_json, rl_info_json, bericht, aktiv) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(version, jetzt, erg.gbdt ? JSON.stringify(erg.gbdt) : null, erg.rl ? JSON.stringify(erg.rl) : null, erg.modell ? JSON.stringify(erg.modell) : null, erg.rlInfo ? JSON.stringify(erg.rlInfo) : null, bericht, uebernehmen ? 1 : 0);
    this.bericht = bericht;
    if (uebernehmen) {
      this.gbdt = erg.gbdt;
      this.rl = erg.rl;
      this.modellInfo = erg.modell;
      this.rlInfo = erg.rlInfo;
    } else if (!this.aktiv) {
      // noch nie ein aktives Modell: Status zeigt den neuesten (inaktiven) Lauf
      this.modellInfo = erg.modell;
      this.rlInfo = erg.rlInfo;
    }
    // alte Läufe weg (das aktive Modell bleibt)
    this.o.db.prepare('DELETE FROM muster_modelle WHERE version <= ? AND version NOT IN (SELECT version FROM muster_modelle WHERE aktiv = 1 ORDER BY version DESC LIMIT 1)').run(version - BEHALTEN);
    this.o.log?.(`Muster-Training v${version}: ${uebernehmen ? 'übernommen' : 'nicht übernommen'}`);
  }

  /** Ticks der letzten 7 Tage stückweise (rowid) lesen, je Token sortiert; Metadaten aus tokens (+ Dev-Historie 24 h) */
  private async datenLaden(jetzt: number): Promise<TrainingsDaten> {
    const von = jetzt - FENSTER;
    const st = this.o.db.prepare('SELECT rowid AS r, mint, zeit, preis, sol, echt_sol FROM strom_ticks WHERE zeit >= ? AND rowid > ? ORDER BY rowid LIMIT ?');
    const ticks = new Map<string, Tick[]>();
    const gesamt = (this.o.db.prepare('SELECT COUNT(*) AS n FROM strom_ticks WHERE zeit >= ?').get(von) as { n: number }).n;
    let ab = 0;
    let gelesen = 0;
    let min: number | null = null;
    let max: number | null = null;
    for (;;) {
      const teil = st.all(von, ab, this.o.stueckGroesse ?? 20_000) as { r: number; mint: string; zeit: number; preis: number; sol: number; echt_sol: number }[];
      if (!teil.length) break;
      for (const z of teil) {
        let l = ticks.get(z.mint);
        if (!l) ticks.set(z.mint, (l = []));
        l.push({ zeit: z.zeit, preis: z.preis, sol: z.sol, echtSol: z.echt_sol });
        if (min === null || z.zeit < min) min = z.zeit;
        if (max === null || z.zeit > max) max = z.zeit;
      }
      gelesen += teil.length;
      ab = teil.at(-1)!.r;
      this.fortschritt = gesamt ? Math.min(0.15, (gelesen / gesamt) * 0.15) : 0.15;
      await abgeben();
    }
    for (const l of ticks.values()) l.sort((a, b) => a.zeit - b.zeit);
    await abgeben();
    // Metadaten: Tokens mit Ticks; Dev-Historie wie motor.ts devTokens24h (andere Tokens desselben Erstellers in 24 h davor)
    const zeilen = this.o.db.prepare('SELECT mint, erstellt, creator FROM tokens WHERE erstellt >= ?').all(von - 2 * TAG) as { mint: string; erstellt: number; creator: string | null }[];
    const jeErsteller = new Map<string, number[]>();
    for (const z of zeilen) if (z.creator) (jeErsteller.get(z.creator) ?? jeErsteller.set(z.creator, []).get(z.creator)!).push(z.erstellt);
    for (const l of jeErsteller.values()) l.sort((a, b) => a - b);
    const meta = new Map<string, TokenMeta>();
    for (const z of zeilen) {
      if (!ticks.has(z.mint)) continue;
      const m: TokenMeta = { mint: z.mint, erstellt: z.erstellt };
      if (z.creator) {
        const l = jeErsteller.get(z.creator)!;
        // Anzahl in [erstellt − 24 h, erstellt] ohne den Token selbst
        m.devTokens24h = l.filter((t) => t >= z.erstellt - TAG && t <= z.erstellt).length - 1;
      }
      meta.set(z.mint, m);
    }
    // Ticks ohne Token-Eintrag (Alter unbekannt) werden nicht verwendet – nichts erfinden
    for (const m of [...ticks.keys()]) if (!meta.has(m)) ticks.delete(m);
    this.datenCache = { zeit: this.o.uhr.jetzt(), daten: { ticks: gelesen, tokens: meta.size, von: min != null ? new Date(min).toISOString() : null, bis: max != null ? new Date(max).toISOString() : null } };
    return { ticks, meta };
  }

  /** Umfang der Aufzeichnung (höchstens alle 5 min neu gezählt – COUNT über Millionen Zeilen) */
  private daten(): KryptoMusterStatus['daten'] {
    const jetzt = this.o.uhr.jetzt();
    if (this.datenCache && jetzt - this.datenCache.zeit < 5 * 60_000) return this.datenCache.daten;
    const r = this.o.db.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT mint) AS t, MIN(zeit) AS von, MAX(zeit) AS bis FROM strom_ticks').get() as { n: number; t: number; von: number | null; bis: number | null };
    const daten = { ticks: r.n, tokens: r.t, von: r.von != null ? new Date(r.von).toISOString() : null, bis: r.bis != null ? new Date(r.bis).toISOString() : null };
    this.datenCache = { zeit: jetzt, daten };
    return daten;
  }

  status(): KryptoMusterStatus {
    return {
      ziel: { zielProzent: STANDARD_ZIEL.zielProzent, stopProzent: STANDARD_ZIEL.stopProzent, horizontMin: STANDARD_ZIEL.horizontMs / 60_000 },
      modell: this.modellInfo,
      rl: this.rlInfo,
      training: {
        laeuft: this.laeuft,
        // in Prozent (0–100) wie beim Backtest
        fortschritt: Math.round(this.fortschritt * 100),
        letzter: this.letzter != null ? new Date(this.letzter).toISOString() : null,
        naechster: new Date(this.naechster).toISOString(),
        fehler: this.fehler,
        dauerMs: this.dauerMs,
      },
      daten: this.daten(),
      bericht: this.bericht,
    };
  }
}
