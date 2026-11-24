// E235: Muster-Dienst im Kryptowerk – lädt die gültigen Muster-Modelle (GBDTs + RL-Agent), trainiert alle paar Stunden auf den
// aufgezeichneten Echtzeit-Ticks (strom_ticks, 7 Tage) und gibt Status/Bericht für das Dorf und den Hafenmeister.
// E236: je Schlüssel (basis, pump, absturz, hoch/tief 1/5 min, Früh-Modelle) ein eigenes GBDT in muster_einzel – jedes wird
// EINZELN ersetzt, wenn musterTrainieren es „aktiv“ nennt; gültig ist je Schlüssel das neueste aktive Modell, dessen Merkmalsliste
// zu MERKMAL_NAMEN passt (sonst veraltet → nicht geladen). Der RL-Agent wechselt, wenn nach dem Training mindestens ein
// Wahrscheinlichkeits-Modell gültig ist. muster_modelle bleibt das Lauf-Protokoll (Bericht, basis-Info, RL). Fehler stehen im Status.
import { KRYPTO_MUSTER_MODELLE, type KryptoMusterModellInfo, type KryptoMusterSchluessel, type KryptoMusterStatus } from '@dorf/shared';
import type { Uhr } from '../../uhr.js';
import { KryptoFehler, type KDB } from '../motor.js';
import { gbdtVorhersagen } from './gbdt.js';
import { MERKMAL_NAMEN } from './merkmale.js';
import { musterTrainieren, type TrainingsDaten, type TrainingsErgebnis } from './training.js';
import { STANDARD_ZIEL, type GbdtModell, type RlModell, type Tick, type TokenMeta } from './typen.js';

const TAG = 86_400_000;
/** Ticks so lange lesen (wie lange sie aufbewahrt werden: motor.ts) */
const FENSTER = 7 * TAG;
/** so viele Trainingsläufe bleiben im Lauf-Protokoll (das aktive basis-Modell und der gültige RL-Agent immer) */
const BEHALTEN = 20;
/** E236: so viele Versionen je Schlüssel bleiben in muster_einzel (das gültige immer) */
const BEHALTEN_JE_SCHLUESSEL = 10;
/** E236: Schlüssel, deren Modelle Wahrscheinlichkeiten (0–1) liefern – mindestens eins muss gültig sein, damit der RL-Agent gilt */
const WAHRSCHEINLICHKEIT = new Set<KryptoMusterSchluessel>(KRYPTO_MUSTER_MODELLE.filter((m) => m.art === 'wahrscheinlichkeit').map((m) => m.schluessel));

interface ModellZeile {
  version: number;
  erstellt: number;
  gbdt_json: string | null;
  rl_json: string | null;
  modell_json: string | null;
  rl_info_json: string | null;
  bericht: string;
  aktiv: number;
  rl_aktiv: number;
}
interface EinzelZeile {
  schluessel: KryptoMusterSchluessel;
  version: number;
  erstellt: number;
  gbdt_json: string;
  info_json: string;
  aktiv: number;
}
type Einzel = { gbdt: GbdtModell; info: KryptoMusterModellInfo };
type BasisInfo = NonNullable<KryptoMusterStatus['modell']>;

export type Trainer = typeof musterTrainieren;

/** Rechenzeit abgeben (HTTP, Takt, Echtzeit-Kurse laufen weiter) */
const abgeben = () => new Promise<void>((r) => setImmediate(r));

/** passt die Merkmalsliste des Modells zu den Merkmalen, die der Code heute rechnet? (sonst veraltet) */
export function merkmaleAktuell(g: GbdtModell): boolean {
  return Array.isArray(g.merkmale) && g.merkmale.length === MERKMAL_NAMEN.length && g.merkmale.every((n, i) => n === MERKMAL_NAMEN[i]);
}

/** basis-Info im Format von E235 (KryptoMusterStatus.modell) → Info je Schlüssel (E236) */
function infoAusBasis(m: BasisInfo): KryptoMusterModellInfo {
  return {
    schluessel: 'basis',
    version: m.version,
    trainiert: m.trainiert,
    aktiv: m.aktiv,
    gruende: [],
    beispiele: m.beispiele,
    test: { beispiele: m.test.beispiele, tokens: 0, auc: m.test.auc, aucUntergrenze: null, praezision: m.test.praezision, basis: m.test.basis, fehler: null, fehlerBasis: null },
    merkmale: m.merkmale,
  };
}
/** umgekehrt (nur wenn das Lauf-Protokoll die basis-Info nicht mehr hat) – positivAnteil ist dann die Basisrate im Test */
function basisAusInfo(i: KryptoMusterModellInfo): BasisInfo {
  return { version: i.version, trainiert: i.trainiert, beispiele: i.beispiele, positivAnteil: i.test.basis ?? 0, test: { beispiele: i.test.beispiele, auc: i.test.auc ?? 0, praezision: i.test.praezision, basis: i.test.basis ?? 0 }, aktiv: i.aktiv, merkmale: i.merkmale };
}
const nameVon = (k: KryptoMusterSchluessel) => KRYPTO_MUSTER_MODELLE.find((m) => m.schluessel === k)?.name ?? k;

export class MusterDienst {
  /** E236: gültige Modelle je Schlüssel (aktiv, Merkmalsliste passt) */
  private einzel: Partial<Record<KryptoMusterSchluessel, Einzel>> = {};
  /** E236: Info des letzten Laufs je Schlüssel (Status, wenn kein gültiges Modell da ist) */
  private letzteInfos: Partial<Record<KryptoMusterSchluessel, KryptoMusterModellInfo>> = {};
  /** gültiger RL-Agent */
  rl: RlModell | null = null;
  /** basis im Format von E235 (Status `modell`) */
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

  /** gültige Modelle je Schlüssel + RL-Agent + neuester Lauf (Bericht, letzter) aus der DB */
  private laden() {
    const db = this.o.db;
    // E236: je Schlüssel das neueste aktive Modell mit passender Merkmalsliste; dazu der letzte Lauf je Schlüssel
    for (const z of db.prepare('SELECT * FROM muster_einzel ORDER BY version DESC').all() as EinzelZeile[]) {
      const info = JSON.parse(z.info_json) as KryptoMusterModellInfo;
      this.letzteInfos[z.schluessel] ??= info;
      if (!z.aktiv || this.einzel[z.schluessel]) continue;
      const gbdt = JSON.parse(z.gbdt_json) as GbdtModell;
      if (merkmaleAktuell(gbdt)) this.einzel[z.schluessel] = { gbdt, info };
    }
    const neu = db.prepare('SELECT * FROM muster_modelle ORDER BY version DESC LIMIT 1').get() as ModellZeile | undefined;
    if (neu) {
      this.bericht = neu.bericht;
      this.letzter = neu.erstellt;
    }
    // Altbestand (E235): basis aus dem Lauf-Protokoll, solange muster_einzel keins hat – nur mit passender Merkmalsliste
    if (!this.einzel.basis && !this.letzteInfos.basis) {
      const alt = db.prepare('SELECT * FROM muster_modelle WHERE aktiv = 1 AND gbdt_json IS NOT NULL ORDER BY version DESC LIMIT 1').get() as ModellZeile | undefined;
      const gbdt = alt ? (JSON.parse(alt.gbdt_json!) as GbdtModell) : null;
      const info = alt?.modell_json ? (JSON.parse(alt.modell_json) as BasisInfo) : null;
      if (gbdt && info && merkmaleAktuell(gbdt)) this.einzel.basis = { gbdt, info: infoAusBasis({ ...info, aktiv: true }) };
    }
    // Status `modell` (basis, Format E235): das gültige (Info aus seinem Lauf), sonst der neueste Lauf (aktiv: false)
    const basis = this.einzel.basis;
    if (basis) {
      const lauf = db.prepare('SELECT modell_json FROM muster_modelle WHERE version = ?').get(basis.info.version) as { modell_json: string | null } | undefined;
      const info = lauf?.modell_json ? (JSON.parse(lauf.modell_json) as BasisInfo) : null;
      this.modellInfo = info ? { ...info, aktiv: true } : basisAusInfo(basis.info);
    } else if (neu?.modell_json) {
      this.modellInfo = { ...(JSON.parse(neu.modell_json) as BasisInfo), aktiv: false };
    }
    // RL-Agent: der neueste übernommene – aber nur, wenn ein Wahrscheinlichkeits-Modell gültig ist (sonst passt er zu nichts)
    const rlZeile = db.prepare('SELECT * FROM muster_modelle WHERE rl_aktiv = 1 AND rl_json IS NOT NULL ORDER BY version DESC LIMIT 1').get() as ModellZeile | undefined;
    if (rlZeile && this.wahrscheinlichkeitGueltig()) {
      this.rl = JSON.parse(rlZeile.rl_json!) as RlModell;
      this.rlInfo = rlZeile.rl_info_json ? (JSON.parse(rlZeile.rl_info_json) as KryptoMusterStatus['rl']) : null;
    } else if (neu?.rl_info_json) {
      this.rlInfo = JSON.parse(neu.rl_info_json) as KryptoMusterStatus['rl'];
    }
  }

  private wahrscheinlichkeitGueltig() {
    return Object.keys(this.einzel).some((k) => WAHRSCHEINLICHKEIT.has(k as KryptoMusterSchluessel));
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

  /** ist das Grundsignal (basis) gültig? */
  get aktiv(): boolean {
    return !!this.einzel.basis;
  }

  /** E236: ist irgendein Modell gültig? (dann gibt es Rat/Signale) */
  get signaleAktiv(): boolean {
    return Object.keys(this.einzel).length > 0;
  }

  /** E236: kann ein RL-Bot kaufen? (Grundsignal oder Pump-Erkenner gültig) */
  get rlBereit(): boolean {
    return !!(this.einzel.basis || this.einzel.pump || this.einzel.fruehPump);
  }

  /** E236: die gültigen GBDTs je Schlüssel (für musterSignale) */
  gueltigeModelle(): Partial<Record<KryptoMusterSchluessel, GbdtModell>> {
    const r: Partial<Record<KryptoMusterSchluessel, GbdtModell>> = {};
    for (const [k, v] of Object.entries(this.einzel)) r[k as KryptoMusterSchluessel] = v.gbdt;
    return r;
  }

  /** Wahrscheinlichkeit des Grundsignals für einen Merkmals-Vektor (null ohne gültiges basis-Modell) */
  vorhersagen(x: number[]): number | null {
    if (!this.einzel.basis) return null;
    const p = gbdtVorhersagen(this.einzel.basis.gbdt, x);
    return Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : null;
  }

  private testInfo(k: KryptoMusterSchluessel, g: GbdtModell): KryptoMusterModellInfo {
    const wert = KRYPTO_MUSTER_MODELLE.find((m) => m.schluessel === k)?.art === 'wert';
    return { schluessel: k, version: g.version, trainiert: new Date(this.o.uhr.jetzt()).toISOString(), aktiv: true, gruende: [], beispiele: 0, test: { beispiele: 0, tokens: 0, auc: wert ? null : 0.6, aucUntergrenze: null, praezision: null, basis: null, fehler: wert ? 1 : null, fehlerBasis: wert ? 2 : null }, merkmale: [] };
  }

  /** nur für Tests: ein basis-Modell (+ RL-Agent) direkt einsetzen */
  modellSetzen(gbdt: GbdtModell | null, rl: RlModell | null, info?: Partial<NonNullable<KryptoMusterStatus['modell']>>) {
    this.rl = rl;
    this.modellInfo = gbdt
      ? { version: gbdt.version, trainiert: new Date(this.o.uhr.jetzt()).toISOString(), beispiele: 0, positivAnteil: 0, test: { beispiele: 0, auc: 0.6, praezision: null, basis: 0 }, aktiv: true, merkmale: [], ...info }
      : null;
    if (gbdt && this.modellInfo!.aktiv) this.einzel.basis = { gbdt, info: infoAusBasis(this.modellInfo!) };
    else delete this.einzel.basis;
  }

  /** E236, nur für Tests: Modelle je Schlüssel direkt einsetzen (null = entfernen); rl undefined = unverändert */
  modelleSetzen(modelle: Partial<Record<KryptoMusterSchluessel, GbdtModell | null>>, rl?: RlModell | null) {
    for (const [k, g] of Object.entries(modelle) as [KryptoMusterSchluessel, GbdtModell | null][]) {
      if (k === 'basis') {
        this.modellSetzen(g, rl === undefined ? this.rl : rl);
        continue;
      }
      if (g) this.einzel[k] = { gbdt: g, info: this.testInfo(k, g) };
      else delete this.einzel[k];
    }
    if (rl !== undefined) this.rl = rl;
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
      const db = this.o.db;
      const hoechste = Math.max(
        (db.prepare('SELECT MAX(version) AS v FROM muster_modelle').get() as { v: number | null }).v ?? 0,
        (db.prepare('SELECT MAX(version) AS v FROM muster_einzel').get() as { v: number | null }).v ?? 0,
      );
      const version = hoechste + 1;
      // E236: Maßstab je Schlüssel = das gültige Modell (AUC bzw. MAE); aktuelle = die gültigen GBDTs (für das RL-Training)
      const alt: Partial<Record<KryptoMusterSchluessel, { auc?: number | null; fehler?: number | null }>> = {};
      for (const [k, v] of Object.entries(this.einzel)) alt[k as KryptoMusterSchluessel] = { auc: v.info.test.auc, fehler: v.info.test.fehler };
      const erg = await (this.o.trainer ?? musterTrainieren)(daten, {
        jetzt,
        version,
        altAuc: this.einzel.basis?.info.test.auc ?? null,
        alt,
        aktuelle: this.gueltigeModelle(),
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
    const db = this.o.db;
    // E236: Modelle je Schlüssel (fehlt basis dort, gilt gbdt/modell – Abwärtskompatibilität)
    const modelle: Partial<Record<KryptoMusterSchluessel, Einzel>> = { ...(erg.modelle ?? {}) };
    if (!modelle.basis && erg.gbdt && erg.modell) modelle.basis = { gbdt: erg.gbdt, info: infoAusBasis(erg.modell) };
    const altBasis = this.einzel.basis;
    const altModellInfo = this.modellInfo;
    const uebernommen: KryptoMusterSchluessel[] = [];
    const einfuegen = db.prepare('INSERT OR REPLACE INTO muster_einzel (schluessel, version, erstellt, gbdt_json, info_json, aktiv) VALUES (?, ?, ?, ?, ?, ?)');
    const neuEinzel = { ...this.einzel };
    const neuLetzte = { ...this.letzteInfos };
    for (const m of KRYPTO_MUSTER_MODELLE) {
      const x = modelle[m.schluessel];
      if (!x) continue;
      const aktiv = !!x.info.aktiv && merkmaleAktuell(x.gbdt);
      einfuegen.run(m.schluessel, version, jetzt, JSON.stringify(x.gbdt), JSON.stringify(x.info), aktiv ? 1 : 0);
      neuLetzte[m.schluessel] = x.info;
      if (aktiv) {
        neuEinzel[m.schluessel] = x;
        uebernommen.push(m.schluessel);
      }
    }
    const basisNeu = uebernommen.includes('basis');
    const rlNeu = !!erg.rl && Object.keys(neuEinzel).some((k) => WAHRSCHEINLICHKEIT.has(k as KryptoMusterSchluessel));
    let bericht = erg.bericht;
    if (!basisNeu && altBasis) bericht += `\n\nDas bisherige Modell v${altBasis.info.version} (Test-AUC ${(altBasis.info.test.auc ?? 0).toFixed(3)}) bleibt aktiv.`;
    const weiter = KRYPTO_MUSTER_MODELLE.filter((m) => m.schluessel !== 'basis' && !uebernommen.includes(m.schluessel) && this.einzel[m.schluessel]).map((m) => `${nameVon(m.schluessel)} v${this.einzel[m.schluessel]!.info.version}`);
    if (weiter.length) bericht += `\n\nWeiter gültig (bisherige Modelle): ${weiter.join(', ')}.`;
    db.prepare('INSERT INTO muster_modelle (version, erstellt, gbdt_json, rl_json, modell_json, rl_info_json, bericht, aktiv, rl_aktiv) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      version,
      jetzt,
      modelle.basis ? JSON.stringify(modelle.basis.gbdt) : null,
      erg.rl ? JSON.stringify(erg.rl) : null,
      erg.modell ? JSON.stringify(erg.modell) : null,
      erg.rlInfo ? JSON.stringify(erg.rlInfo) : null,
      bericht,
      basisNeu ? 1 : 0,
      rlNeu ? 1 : 0,
    );
    this.einzel = neuEinzel;
    this.letzteInfos = neuLetzte;
    this.bericht = bericht;
    if (basisNeu) this.modellInfo = erg.modell ? { ...erg.modell, aktiv: true } : basisAusInfo(neuEinzel.basis!.info);
    else if (!altBasis) this.modellInfo = erg.modell ?? (modelle.basis ? basisAusInfo(modelle.basis.info) : altModellInfo);
    if (rlNeu) {
      this.rl = erg.rl;
      this.rlInfo = erg.rlInfo;
    } else if (!this.rl) {
      // noch kein gültiger RL-Agent: Status zeigt den neuesten Lauf
      this.rlInfo = erg.rlInfo;
    }
    // alte Läufe weg: im Protokoll das aktive basis-Modell und der gültige RL-Agent bleiben, je Schlüssel die letzten 10 + das gültige
    db.prepare(
      `DELETE FROM muster_modelle WHERE version <= ?
         AND version NOT IN (SELECT version FROM muster_modelle WHERE aktiv = 1 ORDER BY version DESC LIMIT 1)
         AND version NOT IN (SELECT version FROM muster_modelle WHERE rl_aktiv = 1 ORDER BY version DESC LIMIT 1)
         AND version NOT IN (SELECT version FROM muster_einzel WHERE schluessel = 'basis' AND aktiv = 1)`,
    ).run(version - BEHALTEN);
    const raeumen = db.prepare(
      'DELETE FROM muster_einzel WHERE schluessel = ? AND version != ? AND version NOT IN (SELECT version FROM muster_einzel WHERE schluessel = ? ORDER BY version DESC LIMIT ?)',
    );
    for (const m of KRYPTO_MUSTER_MODELLE) raeumen.run(m.schluessel, this.einzel[m.schluessel]?.info.version ?? -1, m.schluessel, BEHALTEN_JE_SCHLUESSEL);
    this.o.log?.(`Muster-Training v${version}: ${uebernommen.length ? `übernommen: ${uebernommen.join(', ')}` : 'nichts übernommen'}${rlNeu ? ' + RL' : ''}`);
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

  /** E236: je Schlüssel (Reihenfolge KRYPTO_MUSTER_MODELLE) das gültige Modell, sonst der letzte Lauf (aktiv: false) */
  private modelleStatus(): KryptoMusterModellInfo[] {
    const r: KryptoMusterModellInfo[] = [];
    for (const m of KRYPTO_MUSTER_MODELLE) {
      const g = this.einzel[m.schluessel];
      if (g) r.push({ ...g.info, aktiv: true });
      else if (this.letzteInfos[m.schluessel]) r.push({ ...this.letzteInfos[m.schluessel]!, aktiv: false });
    }
    return r;
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
      modelle: this.modelleStatus(),
    };
  }
}
