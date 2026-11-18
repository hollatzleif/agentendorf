import crypto from 'node:crypto';
import { z } from 'zod';
import type { KirchturmKlingel, KirchturmZustand, PomodoroEinstellungen } from '@dorf/shared';
import type { DB } from './db.js';
import type { Uhr } from './uhr.js';
import type { LiveHub } from './live.js';
import { DorfFehler } from './fehler.js';
import { naechsterTermin } from './agenten/zeitplan.js';

/**
 * Kirchturm (E74): Wecker, Timer, Pomodoro und Stoppuhr – auf dem SERVER, damit alles auf allen Geräten
 * gleich läuft und auch dann klingelt, wenn gerade kein Fenster offen ist. Klingeln = Live-Ereignis
 * `kirchturm.klingelt`; hörbar ist es nur im Desktop-Programm (Glocke), sonst nur sichtbar.
 * Zustand: ein JSON in dorf_stand (klein, ein Nutzer).
 */
const SCHLUESSEL = 'kirchturm';
/** Verpasste Wecker (Server war aus) klingeln nur, wenn sie höchstens so spät sind */
const VERPASST_BIS_MS = 15 * 60_000;
/** Klingeln, die niemand ausschaltet, verschwinden nach … */
const KLINGEL_HOECHSTENS_MS = 10 * 60_000;
const MIN = 60_000;

const STANDARD_POMODORO: PomodoroEinstellungen = { arbeitMin: 25, kurzMin: 5, langMin: 15, langNach: 4, runden: 4, autoWeiter: false };

interface Wecker {
  id: string;
  name: string;
  zeit: string;
  tage: number[];
  aktiv: boolean;
  schlummerMin: number;
  naechster: number | null;
  schlummerBis: number | null;
}
interface Timer {
  id: string;
  name: string;
  dauerMs: number;
  status: 'laeuft' | 'pause' | 'fertig';
  ende: number | null;
  restMs: number | null;
}
interface Klingel extends Omit<KirchturmKlingel, 'seit'> {
  seit: number;
}
interface Zustand {
  wecker: Wecker[];
  timer: Timer[];
  vorlagen: { name: string; dauerMs: number }[];
  pomodoro: { einstellungen: PomodoroEinstellungen; phase: 'aus' | 'arbeit' | 'kurz' | 'lang'; status: 'aus' | 'laeuft' | 'pause' | 'wartet'; ende: number | null; restMs: number | null; erledigt: number };
  stoppuhr: { start: number | null; bisherMs: number; runden: number[] };
  klingelt: Klingel[];
  toene: { mitteilungen: boolean; weckerWiederholen: number };
}

const leer = (): Zustand => ({
  wecker: [],
  timer: [],
  vorlagen: [
    { name: 'Tee', dauerMs: 4 * MIN },
    { name: 'Nudeln', dauerMs: 10 * MIN },
    { name: 'Powernap', dauerMs: 20 * MIN },
  ],
  pomodoro: { einstellungen: STANDARD_POMODORO, phase: 'aus', status: 'aus', ende: null, restMs: null, erledigt: 0 },
  stoppuhr: { start: null, bisherMs: 0, runden: [] },
  klingelt: [],
  toene: { mitteilungen: true, weckerWiederholen: 6 },
});

const Name = z.string().trim().max(60);
const Zeit = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit als HH:MM');
const Dauer = z.coerce
  .number()
  .int()
  .min(1000, 'mindestens 1 Sekunde')
  .max(24 * 3600_000, 'höchstens 24 Stunden');
export const PomodoroSchema = z.object({
  arbeitMin: z.coerce.number().min(1).max(240),
  kurzMin: z.coerce.number().min(1).max(120),
  langMin: z.coerce.number().min(1).max(240),
  langNach: z.coerce.number().int().min(1).max(20),
  runden: z.coerce.number().int().min(1).max(50),
  autoWeiter: z.boolean(),
  thema: z.string().trim().max(200).optional(),
});

export const Befehl = z.discriminatedUnion('befehl', [
  z.object({
    befehl: z.literal('wecker_speichern'),
    id: z.string().optional(),
    name: Name.default(''),
    zeit: Zeit,
    tage: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    aktiv: z.boolean().default(true),
    schlummerMin: z.coerce.number().int().min(1).max(60).default(9),
  }),
  z.object({ befehl: z.literal('wecker_loeschen'), id: z.string() }),
  z.object({ befehl: z.literal('timer_start'), name: Name.default(''), dauerMs: Dauer }),
  z.object({ befehl: z.literal('timer'), id: z.string(), aktion: z.enum(['pause', 'weiter', 'neu', 'loeschen', 'plus_minute']) }),
  z.object({ befehl: z.literal('vorlagen'), vorlagen: z.array(z.object({ name: Name.min(1), dauerMs: Dauer })).max(20) }),
  z.object({ befehl: z.literal('pomodoro_einstellen'), einstellungen: PomodoroSchema }),
  z.object({ befehl: z.literal('pomodoro'), aktion: z.enum(['start', 'pause', 'weiter', 'ueberspringen', 'stopp']) }),
  z.object({ befehl: z.literal('stoppuhr'), aktion: z.enum(['start', 'stopp', 'runde', 'zuruecksetzen']) }),
  z.object({ befehl: z.literal('klingel'), id: z.string(), aktion: z.enum(['aus', 'schlummern']) }),
  z.object({ befehl: z.literal('alle_aus') }),
  z.object({ befehl: z.literal('toene'), mitteilungen: z.boolean(), weckerWiederholen: z.coerce.number().int().min(1).max(20) }),
]);
export type KirchturmBefehl = z.infer<typeof Befehl>;

const minuten = (ms: number) => {
  const m = Math.round(ms / MIN);
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
};

export class Kirchturm {
  private z: Zustand;
  /** z. B. Tests: was geklingelt hat */
  readonly beiKlingeln: ((k: KirchturmKlingel) => void)[] = [];

  constructor(private o: { db: DB; uhr: Uhr; hub: LiveHub }) {
    const roh = (o.db.prepare('SELECT wert FROM dorf_stand WHERE schluessel = ?').get(SCHLUESSEL) as { wert: string } | undefined)?.wert;
    const basis = leer();
    const gelesen = roh ? (JSON.parse(roh) as Partial<Zustand>) : {};
    this.z = { ...basis, ...gelesen, pomodoro: { ...basis.pomodoro, ...gelesen.pomodoro }, toene: { ...basis.toene, ...gelesen.toene } };
  }

  private speichern(klingel?: Klingel) {
    this.o.db.prepare('INSERT OR REPLACE INTO dorf_stand (schluessel, wert) VALUES (?, ?)').run(SCHLUESSEL, JSON.stringify(this.z));
    this.o.hub.senden({ typ: 'kirchturm.geaendert' });
    if (klingel) {
      const k = this.klingelAus(klingel);
      this.o.hub.senden({ typ: 'kirchturm.klingelt', klingel: k });
      for (const fn of this.beiKlingeln) fn(k);
    }
  }

  private klingelAus(k: Klingel): KirchturmKlingel {
    return { ...k, seit: new Date(k.seit).toISOString() };
  }

  zustand(): KirchturmZustand {
    const iso = (n: number | null) => (n == null ? null : new Date(n).toISOString());
    const z2 = this.z;
    return {
      jetzt: new Date(this.o.uhr.jetzt()).toISOString(),
      wecker: z2.wecker.map((w) => ({ id: w.id, name: w.name, zeit: w.zeit, tage: w.tage, aktiv: w.aktiv, schlummerMin: w.schlummerMin, naechster: iso(w.aktiv ? (w.schlummerBis ?? w.naechster) : null) })),
      timer: z2.timer.map((t) => ({ ...t, ende: iso(t.ende) })),
      vorlagen: z2.vorlagen,
      pomodoro: { ...z2.pomodoro, ende: iso(z2.pomodoro.ende) },
      stoppuhr: { start: iso(z2.stoppuhr.start), bisherMs: z2.stoppuhr.bisherMs, runden: z2.stoppuhr.runden },
      klingelt: z2.klingelt.map((k) => this.klingelAus(k)),
      toene: z2.toene,
    };
  }

  /** nächstes Klingeln eines Weckers nach `ab` (Ortszeit Europe/Vienna, Sommerzeit inklusive) */
  private naechster(w: Pick<Wecker, 'zeit' | 'tage'>, ab: number) {
    const [h, m] = w.zeit.split(':').map(Number) as [number, number];
    return naechsterTermin({ tage: new Set(w.tage.length ? w.tage : [0, 1, 2, 3, 4, 5, 6]), zeiten: [{ h, m }] }, ab);
  }

  private pomodoroDauer(phase: 'arbeit' | 'kurz' | 'lang') {
    const e = this.z.pomodoro.einstellungen;
    return (phase === 'arbeit' ? e.arbeitMin : phase === 'kurz' ? e.kurzMin : e.langMin) * MIN;
  }

  ausfuehren(roh: unknown): KirchturmZustand {
    const b = Befehl.parse(roh);
    const jetzt = this.o.uhr.jetzt();
    const z2 = this.z;
    const timer = (id: string) => {
      const t = z2.timer.find((x) => x.id === id);
      if (!t) throw new DorfFehler(404, 'Diesen Timer gibt es nicht (mehr).');
      return t;
    };
    switch (b.befehl) {
      case 'wecker_speichern': {
        const w = b.id ? z2.wecker.find((x) => x.id === b.id) : undefined;
        if (b.id && !w) throw new DorfFehler(404, 'Diesen Wecker gibt es nicht (mehr).');
        if (!w && z2.wecker.length >= 30) throw new DorfFehler(400, 'Höchstens 30 Wecker.');
        const neu: Wecker = { id: w?.id ?? crypto.randomUUID(), name: b.name, zeit: b.zeit, tage: [...new Set(b.tage)].sort(), aktiv: b.aktiv, schlummerMin: b.schlummerMin, naechster: null, schlummerBis: null };
        neu.naechster = neu.aktiv ? this.naechster(neu, jetzt) : null;
        if (w) Object.assign(w, neu);
        else z2.wecker.push(neu);
        z2.wecker.sort((a, c) => a.zeit.localeCompare(c.zeit));
        break;
      }
      case 'wecker_loeschen':
        z2.wecker = z2.wecker.filter((w) => w.id !== b.id);
        z2.klingelt = z2.klingelt.filter((k) => k.bezugId !== b.id);
        break;
      case 'timer_start':
        if (z2.timer.length >= 20) throw new DorfFehler(400, 'Höchstens 20 Timer gleichzeitig.');
        z2.timer.push({ id: crypto.randomUUID(), name: b.name || `Timer ${minuten(b.dauerMs)}`, dauerMs: b.dauerMs, status: 'laeuft', ende: jetzt + b.dauerMs, restMs: null });
        break;
      case 'timer': {
        const t = timer(b.id);
        if (b.aktion === 'loeschen') {
          z2.timer = z2.timer.filter((x) => x.id !== b.id);
          z2.klingelt = z2.klingelt.filter((k) => k.bezugId !== b.id);
        } else if (b.aktion === 'pause' && t.status === 'laeuft') Object.assign(t, { status: 'pause', restMs: Math.max(0, t.ende! - jetzt), ende: null });
        else if (b.aktion === 'weiter' && t.status === 'pause') Object.assign(t, { status: 'laeuft', ende: jetzt + (t.restMs ?? 0), restMs: null });
        else if (b.aktion === 'neu') {
          Object.assign(t, { status: 'laeuft', ende: jetzt + t.dauerMs, restMs: null });
          z2.klingelt = z2.klingelt.filter((k) => k.bezugId !== b.id);
        } else if (b.aktion === 'plus_minute') {
          if (t.status === 'laeuft') t.ende = t.ende! + MIN;
          else if (t.status === 'pause') t.restMs = (t.restMs ?? 0) + MIN;
          else Object.assign(t, { status: 'laeuft', ende: jetzt + MIN, restMs: null });
          z2.klingelt = z2.klingelt.filter((k) => k.bezugId !== b.id);
        }
        break;
      }
      case 'vorlagen':
        z2.vorlagen = b.vorlagen;
        break;
      case 'pomodoro_einstellen': {
        const p = z2.pomodoro;
        const e = b.einstellungen;
        p.einstellungen = { ...e, ...(e.thema ? { thema: e.thema } : { thema: undefined }) };
        // laufende Phase an die neue Länge anpassen (verstrichene Zeit bleibt)
        if (p.phase !== 'aus' && p.status === 'wartet') p.restMs = this.pomodoroDauer(p.phase);
        break;
      }
      case 'pomodoro': {
        const p = z2.pomodoro;
        if (b.aktion === 'start') {
          if (p.status === 'wartet' && p.phase !== 'aus') Object.assign(p, { status: 'laeuft', ende: jetzt + (p.restMs ?? this.pomodoroDauer(p.phase)), restMs: null });
          else Object.assign(p, { phase: 'arbeit', status: 'laeuft', ende: jetzt + this.pomodoroDauer('arbeit'), restMs: null, erledigt: 0 });
        } else if (b.aktion === 'pause' && p.status === 'laeuft') Object.assign(p, { status: 'pause', restMs: Math.max(0, p.ende! - jetzt), ende: null });
        else if (b.aktion === 'weiter' && p.status === 'pause') Object.assign(p, { status: 'laeuft', ende: jetzt + (p.restMs ?? 0), restMs: null });
        else if (b.aktion === 'ueberspringen' && p.phase !== 'aus') this.pomodoroWeiter(jetzt, false);
        else if (b.aktion === 'stopp') Object.assign(p, { phase: 'aus', status: 'aus', ende: null, restMs: null, erledigt: 0 });
        z2.klingelt = z2.klingelt.filter((k) => k.quelle !== 'pomodoro');
        break;
      }
      case 'stoppuhr': {
        const s = z2.stoppuhr;
        const gesamt = s.bisherMs + (s.start != null ? jetzt - s.start : 0);
        if (b.aktion === 'start' && s.start == null) s.start = jetzt;
        else if (b.aktion === 'stopp' && s.start != null) Object.assign(s, { start: null, bisherMs: gesamt });
        else if (b.aktion === 'runde' && s.start != null && s.runden.length < 200) s.runden.push(gesamt);
        else if (b.aktion === 'zuruecksetzen') Object.assign(s, { start: null, bisherMs: 0, runden: [] });
        break;
      }
      case 'klingel': {
        const k = z2.klingelt.find((x) => x.id === b.id);
        z2.klingelt = z2.klingelt.filter((x) => x.id !== b.id);
        if (k && b.aktion === 'schlummern' && k.quelle === 'wecker') {
          const w = z2.wecker.find((x) => x.id === k.bezugId);
          if (w) Object.assign(w, { aktiv: true, schlummerBis: jetzt + w.schlummerMin * MIN });
        }
        break;
      }
      case 'alle_aus':
        z2.klingelt = [];
        break;
      case 'toene':
        z2.toene = { mitteilungen: b.mitteilungen, weckerWiederholen: b.weckerWiederholen };
        break;
    }
    this.speichern();
    return this.zustand();
  }

  /** Pomodoro: Phase vorbei (oder übersprungen) → nächste Phase; gibt den Klingeltext zurück */
  private pomodoroWeiter(jetzt: number, klingeln: boolean): Klingel | undefined {
    const p = z2Pomodoro(this.z);
    const e = p.einstellungen;
    const war = p.phase;
    if (war === 'arbeit') p.erledigt++;
    let naechste: 'arbeit' | 'kurz' | 'lang' | 'aus';
    if (war === 'arbeit') naechste = p.erledigt >= e.runden ? 'aus' : p.erledigt % e.langNach === 0 ? 'lang' : 'kurz';
    else naechste = 'arbeit';
    if (naechste === 'aus') Object.assign(p, { phase: 'aus', status: 'aus', ende: null, restMs: null });
    else if (e.autoWeiter) Object.assign(p, { phase: naechste, status: 'laeuft', ende: jetzt + this.pomodoroDauer(naechste), restMs: null });
    else Object.assign(p, { phase: naechste, status: 'wartet', ende: null, restMs: this.pomodoroDauer(naechste) });
    if (!klingeln) return undefined;
    const text =
      naechste === 'aus'
        ? `Geschafft – ${p.erledigt} ${p.erledigt === 1 ? 'Runde' : 'Runden'} fertig. 🎉`
        : naechste === 'arbeit'
          ? `Pause vorbei – Runde ${p.erledigt + 1} von ${e.runden}${e.autoWeiter ? ' läuft' : ': Start drücken'}.`
          : `Runde ${p.erledigt} von ${e.runden} fertig – ${naechste === 'lang' ? 'lange' : 'kurze'} Pause (${naechste === 'lang' ? e.langMin : e.kurzMin} min)${e.autoWeiter ? '' : ': Start drücken'}.`;
    return { id: crypto.randomUUID(), quelle: 'pomodoro', bezugId: 'pomodoro', titel: war === 'arbeit' ? '🍅 Pause!' : '🍅 Weiter geht’s', text, ton: 'schlag', seit: jetzt, schlummern: false };
  }

  /** Jede Sekunde: Fälliges klingeln lassen */
  pruefen() {
    const jetzt = this.o.uhr.jetzt();
    const z2 = this.z;
    const neu: Klingel[] = [];
    let geaendert = false;
    for (const w of z2.wecker) {
      const faellig = w.aktiv ? (w.schlummerBis ?? w.naechster) : null;
      if (faellig == null || faellig > jetzt) continue;
      geaendert = true;
      const verspaetet = jetzt - faellig > VERPASST_BIS_MS;
      w.schlummerBis = null;
      if (!w.tage.length && !(w.naechster != null && w.naechster > jetzt)) {
        // einmaliger Wecker: nach dem Klingeln aus
        w.aktiv = false;
        w.naechster = null;
      } else if (w.naechster != null && w.naechster <= jetzt) w.naechster = this.naechster(w, jetzt);
      if (!verspaetet)
        neu.push({ id: crypto.randomUUID(), quelle: 'wecker', bezugId: w.id, titel: `⏰ ${w.name || 'Wecker'}`, text: `Es ist ${w.zeit} Uhr.`, ton: 'gelaeut', seit: jetzt, schlummern: true });
    }
    for (const t of z2.timer) {
      if (t.status !== 'laeuft' || t.ende! > jetzt) continue;
      geaendert = true;
      Object.assign(t, { status: 'fertig', ende: null, restMs: 0 });
      neu.push({ id: crypto.randomUUID(), quelle: 'timer', bezugId: t.id, titel: `⏳ ${t.name}`, text: `${minuten(t.dauerMs)} sind um.`, ton: 'schlag', seit: jetzt, schlummern: false });
    }
    const p = z2.pomodoro;
    if (p.status === 'laeuft' && p.ende! <= jetzt) {
      geaendert = true;
      const k = this.pomodoroWeiter(jetzt, true);
      if (k) neu.push(k);
    }
    const vorher = z2.klingelt.length;
    z2.klingelt = z2.klingelt.filter((k) => jetzt - k.seit < KLINGEL_HOECHSTENS_MS);
    if (z2.klingelt.length !== vorher) geaendert = true;
    z2.klingelt.push(...neu);
    if (!geaendert) return;
    if (!neu.length) this.speichern();
    for (const [i, k] of neu.entries()) {
      if (i === 0) this.speichern(k);
      else {
        this.o.hub.senden({ typ: 'kirchturm.klingelt', klingel: this.klingelAus(k) });
        for (const fn of this.beiKlingeln) fn(this.klingelAus(k));
      }
    }
  }

  private takt?: NodeJS.Timeout;
  starten() {
    this.takt = setInterval(() => {
      try {
        this.pruefen();
      } catch (e) {
        console.warn(`Kirchturm: ${(e as Error).message}`);
      }
    }, 1000);
    this.takt.unref();
  }
  stoppen() {
    if (this.takt) clearInterval(this.takt);
  }
}

const z2Pomodoro = (z: Zustand) => z.pomodoro;
