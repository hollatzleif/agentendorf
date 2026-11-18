import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { z } from 'zod';
import type { TodoInfo } from '@dorf/shared';
import type { Uhr } from './uhr.js';
import type { VaultDienst } from './vault/dienst.js';
import { normalisieren } from './vault/pfade.js';
import { DorfFehler } from './fehler.js';
import { dateiStempel, kurztitel } from './agenten/hilfen.js';

/**
 * To-do-Brett auf dem Marktplatz (E65): ein To-do = eine Markdown-Datei in Marktplatz/todos/ (Obsidian-freundlich,
 * Frontmatter titel/status/faellig/gebaeude/quelle, darunter Notizen). Leif (App, Telegram, Obsidian) und alle
 * Agenten (todo_*-Werkzeuge) arbeiten über diesen Dienst. Löschen = Papierkorb (wiederherstellbar).
 */
export const TODO_ORDNER = 'Marktplatz/todos';

/**
 * Etappe 7: dieselbe Listen-Technik für mehrere Listen. Jede Liste = ein Ordner, ein Eintrag = eine Datei.
 * Agenten erreichen alle über die todo_*-Werkzeuge (Parameter „liste“).
 */
export const LISTEN = {
  todo: { ordner: TODO_ORDNER, titel: 'To-do-Liste', gebaeude: 'Marktplatz' },
  einkauf: { ordner: 'Einkaufsladen/liste', titel: 'Einkaufsliste', gebaeude: 'Einkaufsladen' },
  wunsch: { ordner: 'Einkaufsladen/wunschliste', titel: 'Wunschliste', gebaeude: 'Einkaufsladen' },
  corps: { ordner: 'Corpshaus/aufgaben', titel: 'Corps-Aufgaben und Ämter', gebaeude: 'Corpshaus' },
} as const;
export type ListenName = keyof typeof LISTEN;
export const LISTEN_NAMEN = Object.keys(LISTEN) as ListenName[];
/** Erledigtes so lange auf dem Brett zeigen */
const ERLEDIGT_TAGE = 14;
const DATUM = /^\d{4}-\d{2}-\d{2}$/;
/** E94: Erinnerung als Ortszeit (Wien) */
export const ZEITPUNKT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** Wiederkehrend (E92): täglich, werktags, wöchentlich, monatlich, jährlich oder „alle N tage/wochen/monate“ */
export const WIEDERHOLEN = /^(täglich|werktags|wöchentlich|monatlich|jährlich|alle ([1-9]\d{0,2}) (tage|wochen|monate))$/;
const Wiederholen = z
  .string()
  .trim()
  .toLowerCase()
  .regex(WIEDERHOLEN, 'wiederholen: täglich, werktags, wöchentlich, monatlich, jährlich oder „alle N tage/wochen/monate“');

/** Nächstes Datum nach einer Regel – immer nach „heute“ (Erledigtes von gestern springt nicht in die Vergangenheit) */
export function naechstesDatum(regel: string, ab: string, heute: string) {
  const m = WIEDERHOLEN.exec(regel);
  if (!m) return undefined;
  const plusTage = (t: string, n: number) => {
    const d = new Date(`${t}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const plusMonate = (t: string, n: number, tag: number) => {
    const [j, mo] = t.split('-').map(Number) as [number, number];
    const ziel = new Date(Date.UTC(j, mo - 1 + n, 1, 12));
    const letzter = new Date(Date.UTC(ziel.getUTCFullYear(), ziel.getUTCMonth() + 1, 0, 12)).getUTCDate();
    ziel.setUTCDate(Math.min(tag, letzter));
    return ziel.toISOString().slice(0, 10);
  };
  const tagImMonat = Number(ab.slice(8, 10));
  const schritt = (t: string): string => {
    if (m[1] === 'täglich') return plusTage(t, 1);
    if (m[1] === 'werktags') {
      let n = plusTage(t, 1);
      while ([0, 6].includes(new Date(`${n}T12:00:00Z`).getUTCDay())) n = plusTage(n, 1);
      return n;
    }
    if (m[1] === 'wöchentlich') return plusTage(t, 7);
    if (m[1] === 'monatlich') return plusMonate(t, 1, tagImMonat);
    if (m[1] === 'jährlich') return plusMonate(t, 12, tagImMonat);
    const n = Number(m[2]);
    return m[3] === 'tage' ? plusTage(t, n) : m[3] === 'wochen' ? plusTage(t, 7 * n) : plusMonate(t, n, tagImMonat);
  };
  let n = schritt(ab);
  for (let i = 0; n <= heute && i < 5000; i++) n = schritt(n);
  return n;
}


export const TodoNeu = z.object({
  titel: z.string().trim().min(1, 'Titel fehlt').max(200),
  faellig: z.string().regex(DATUM, 'faellig als JJJJ-MM-TT').optional(),
  gebaeude: z.string().max(60).optional(),
  /** Gruppe innerhalb der Liste, z. B. Abteilung im Laden („Obst & Gemüse“) oder Amt im Corps */
  gruppe: z.string().trim().max(60).optional(),
  notiz: z.string().max(5000).optional(),
  wichtig: z.boolean().optional(),
  wiederholen: Wiederholen.optional(),
  erinnerung: z.string().regex(ZEITPUNKT, 'erinnerung als JJJJ-MM-TTTHH:MM').optional(),
});
export const TodoAenderung = z.object({
  titel: z.string().trim().min(1).max(200).optional(),
  erledigt: z.boolean().optional(),
  faellig: z.union([z.string().regex(DATUM, 'faellig als JJJJ-MM-TT'), z.literal('')]).optional(),
  gebaeude: z.union([z.string().max(60), z.literal('')]).optional(),
  gruppe: z.union([z.string().trim().max(60), z.literal('')]).optional(),
  notiz: z.string().max(5000).optional(),
  wichtig: z.boolean().optional(),
  wiederholen: z.union([Wiederholen, z.literal('')]).optional(),
  erinnerung: z.union([z.string().regex(ZEITPUNKT, 'erinnerung als JJJJ-MM-TTTHH:MM'), z.literal('')]).optional(),
});

/** Telegram/Schnelleingabe: „Wäsche jeden Montag“ → Titel, Regel und erstes Datum (E92) */
export function wiederholungAusText(text: string, heute: string): { titel: string; wiederholen?: string; faellig?: string } {
  const TAGE = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];
  const m = /^(.*?)\s+(?:🔁\s*)?(täglich|jeden tag|werktags|jeden werktag|wöchentlich|jede woche|monatlich|jeden monat|jährlich|jedes jahr|alle [1-9]\d{0,2} (?:tage|wochen|monate)|jeden (?:sonntag|montag|dienstag|mittwoch|donnerstag|freitag|samstag))$/i.exec(text.trim());
  if (!m || !m[1]!.trim()) return { titel: text.trim() };
  const w = m[2]!.toLowerCase();
  const titel = m[1]!.trim();
  const tag = TAGE.findIndex((t) => w === `jeden ${t}`);
  if (tag >= 0) {
    const d = new Date(`${heute}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + ((tag - d.getUTCDay() + 7) % 7));
    return { titel, wiederholen: 'wöchentlich', faellig: d.toISOString().slice(0, 10) };
  }
  const regel: Record<string, string> = { 'jeden tag': 'täglich', 'jeden werktag': 'werktags', 'jede woche': 'wöchentlich', 'jeden monat': 'monatlich', 'jedes jahr': 'jährlich' };
  return { titel, wiederholen: regel[w] ?? w, faellig: heute };
}

const datumText = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'string' && DATUM.test(v) ? v : undefined);

export class TodoDienst {
  /** wird nach jeder Änderung aufgerufen (z. B. für Live-Ereignisse) */
  beiAenderung: () => void = () => undefined;

  readonly ordner: string;
  constructor(private o: { vault: VaultDienst; uhr: Uhr; ordner?: string }) {
    this.ordner = o.ordner ?? TODO_ORDNER;
  }

  /** Pfad prüfen: genau eine .md-Datei direkt im Ordner dieser Liste */
  pfadPruefen(roh: string) {
    const p = normalisieren(roh);
    if (path.posix.dirname(p) !== this.ordner || !p.endsWith('.md')) throw new DorfFehler(400, `Kein Eintrag dieser Liste: ${p} (die Einträge liegen in ${this.ordner}/)`);
    return p;
  }

  private async lesenEines(pfad: string): Promise<TodoInfo | null> {
    const d = await this.o.vault.lesen(pfad).catch(() => null);
    if (!d) return null;
    let m: matter.GrayMatterFile<string>;
    try {
      m = matter(d.inhalt);
    } catch {
      m = { data: {}, content: d.inhalt } as matter.GrayMatterFile<string>;
    }
    const k = m.data as Record<string, unknown>;
    const titel = typeof k.titel === 'string' && k.titel.trim() ? k.titel.trim() : path.posix.basename(pfad, '.md').replace(/^\d{4}-\d{2}-\d{2}_\d{4}_/, '').replace(/[-_]/g, ' ');
    const erledigt = k.status === 'erledigt' || k.status === 'fertig' || k.erledigt === true;
    return {
      pfad,
      version: d.version,
      titel,
      erledigt,
      faellig: datumText(k.faellig),
      gebaeude: typeof k.gebaeude === 'string' && k.gebaeude ? k.gebaeude : undefined,
      gruppe: typeof k.gruppe === 'string' && k.gruppe ? k.gruppe : undefined,
      ...(k.fremd === true ? { fremd: true } : {}),
      ...(k.wichtig === true ? { wichtig: true } : {}),
      ...(typeof k.wiederholen === 'string' && WIEDERHOLEN.test(k.wiederholen) ? { wiederholen: k.wiederholen } : {}),
      ...(typeof k.erinnerung === 'string' && ZEITPUNKT.test(k.erinnerung) ? { erinnerung: k.erinnerung } : {}),
      ...(typeof k.erinnert === 'string' ? { erinnert: k.erinnert } : {}),
      quelle: typeof k.quelle === 'string' ? k.quelle : undefined,
      erstellt: typeof k.erstellt === 'string' ? k.erstellt : k.erstellt instanceof Date ? k.erstellt.toISOString() : undefined,
      erledigtAm: typeof k.erledigt_am === 'string' ? k.erledigt_am : k.erledigt_am instanceof Date ? k.erledigt_am.toISOString() : undefined,
      notiz: m.content.trim() || undefined,
    };
  }

  /** Offene zuerst (fällige nach Datum, dann neueste), danach Erledigtes der letzten 14 Tage */
  async liste(opt: { alleErledigten?: boolean } = {}): Promise<TodoInfo[]> {
    const ordner = this.o.vault.abs(this.ordner);
    const namen = (await fs.readdir(ordner).catch(() => [] as string[])).filter((n) => n.endsWith('.md') && !n.startsWith('.') && !/\.(sync-conflict-|konflikt-)/.test(n));
    const alle = (await Promise.all(namen.map((n) => this.lesenEines(`${this.ordner}/${n}`)))).filter((t): t is TodoInfo => !!t);
    const grenze = this.o.uhr.jetzt() - ERLEDIGT_TAGE * 86_400_000;
    const offen = alle
      .filter((t) => !t.erledigt)
      .sort((a, b) => Number(!!b.wichtig) - Number(!!a.wichtig) || (a.faellig ?? '9999').localeCompare(b.faellig ?? '9999') || (b.erstellt ?? '').localeCompare(a.erstellt ?? ''));
    const fertig = alle
      .filter((t) => t.erledigt && (opt.alleErledigten || !t.erledigtAm || Date.parse(t.erledigtAm) >= grenze))
      .sort((a, b) => (b.erledigtAm ?? '').localeCompare(a.erledigtAm ?? ''));
    return [...offen, ...fertig];
  }

  async holen(roh: string) {
    const t = await this.lesenEines(this.pfadPruefen(roh));
    if (!t) throw new DorfFehler(404, 'Dieses To-do gibt es nicht (mehr).');
    return t;
  }

  /** opt.fremd: von einem Lauf mit Fremdinhalten (Mails, Moodle …) → markiert; Internet-Läufe sehen den Eintrag nicht */
  async anlegen(roh: unknown, quelle: string, opt: { fremd?: boolean } = {}): Promise<TodoInfo> {
    const e = TodoNeu.parse(roh);
    const jetzt = this.o.uhr.jetzt();
    const basis = `${this.ordner}/${dateiStempel(jetzt)}_${kurztitel(e.titel, 40)}`;
    let pfad = `${basis}.md`;
    for (let i = 2; await this.o.vault.existiert(pfad); i++) pfad = `${basis}-${i}.md`;
    const daten: Record<string, unknown> = { titel: e.titel, status: 'offen' };
    if (e.faellig) daten.faellig = e.faellig;
    if (e.gebaeude) daten.gebaeude = e.gebaeude;
    if (e.gruppe) daten.gruppe = e.gruppe;
    if (e.wichtig) daten.wichtig = true;
    if (e.wiederholen) daten.wiederholen = e.wiederholen;
    if (e.erinnerung) daten.erinnerung = e.erinnerung;
    daten.quelle = quelle;
    if (opt.fremd) daten.fremd = true;
    daten.erstellt = new Date(jetzt).toISOString();
    await this.o.vault.schreiben(pfad, matter.stringify(e.notiz ? `${e.notiz.trim()}\n` : '', daten), { nurNeu: true });
    this.beiAenderung();
    return (await this.lesenEines(pfad))!;
  }

  /** Ändern (auch abhaken). basisVersion: hat sich die Datei inzwischen geändert (Obsidian, anderes Gerät) → 409 */
  async aendern(roh: string, aenderungRoh: unknown, basisVersion?: string, opt: { fremd?: boolean } = {}): Promise<TodoInfo> {
    const pfad = this.pfadPruefen(roh);
    const a = TodoAenderung.parse(aenderungRoh);
    const d = await this.o.vault.lesen(pfad).catch(() => null);
    if (!d) throw new DorfFehler(404, 'Dieses To-do gibt es nicht (mehr).');
    if (basisVersion && basisVersion !== d.version) throw new DorfFehler(409, 'Das To-do wurde inzwischen geändert – bitte neu laden.');
    const m = matter(d.inhalt);
    const k = { ...(m.data as Record<string, unknown>) };
    if (a.titel !== undefined) k.titel = a.titel;
    if (a.erledigt !== undefined) {
      k.status = a.erledigt ? 'erledigt' : 'offen';
      if (a.erledigt) k.erledigt_am = new Date(this.o.uhr.jetzt()).toISOString();
      else delete k.erledigt_am;
      delete k.erledigt;
    }
    if (a.faellig !== undefined) {
      if (a.faellig) k.faellig = a.faellig;
      else delete k.faellig;
    }
    if (a.gebaeude !== undefined) {
      if (a.gebaeude) k.gebaeude = a.gebaeude;
      else delete k.gebaeude;
    }
    if (a.gruppe !== undefined) {
      if (a.gruppe) k.gruppe = a.gruppe;
      else delete k.gruppe;
    }
    if (a.wichtig !== undefined) {
      if (a.wichtig) k.wichtig = true;
      else delete k.wichtig;
    }
    if (a.wiederholen !== undefined) {
      if (a.wiederholen) k.wiederholen = a.wiederholen;
      else delete k.wiederholen;
    }
    if (a.erinnerung !== undefined && a.erinnerung !== k.erinnerung) {
      if (a.erinnerung) k.erinnerung = a.erinnerung;
      else delete k.erinnerung;
      delete k.erinnert;
    }
    // E92: Wiederkehrendes zum ersten Mal abgehakt → nächstes anlegen (Vermerk „wiederholt“ verhindert Doppelte beim Hin- und Herklicken)
    const regel = typeof k.wiederholen === 'string' && WIEDERHOLEN.test(k.wiederholen) ? k.wiederholen : undefined;
    const naechstes = a.erledigt === true && regel && !k.wiederholt;
    // Inhalt von einem Fremdinhalt-Lauf geändert → ab jetzt „fremd“ (nur Abhaken ändert keinen Inhalt)
    if (opt.fremd && (a.titel !== undefined || a.notiz !== undefined || a.gruppe !== undefined || a.gebaeude !== undefined)) k.fremd = true;
    const inhalt = a.notiz !== undefined ? (a.notiz.trim() ? `${a.notiz.trim()}\n` : '') : m.content;
    const r = await this.o.vault.schreiben(pfad, matter.stringify(inhalt, k), { basisVersion: d.version });
    if (r.konflikt) throw new DorfFehler(409, 'Das To-do wurde gerade woanders geändert – bitte neu laden.');
    if (naechstes) {
      const heute = new Date(this.o.uhr.jetzt()).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
      const neu = await this.anlegen(
        {
          titel: k.titel ?? (await this.lesenEines(pfad))!.titel,
          faellig: naechstesDatum(regel, datumText(k.faellig) ?? heute, heute),
          ...(typeof k.gebaeude === 'string' && k.gebaeude ? { gebaeude: k.gebaeude } : {}),
          ...(typeof k.gruppe === 'string' && k.gruppe ? { gruppe: k.gruppe } : {}),
          ...(inhalt.trim() ? { notiz: inhalt.trim().slice(0, 5000) } : {}),
          wiederholen: regel,
          ...(typeof k.erinnerung === 'string' && ZEITPUNKT.test(k.erinnerung)
            ? { erinnerung: `${datumText(k.faellig) ? naechstesDatum(regel, datumText(k.faellig)!, heute) : naechstesDatum(regel, k.erinnerung.slice(0, 10), heute)}${k.erinnerung.slice(10)}` }
            : {}),
        },
        typeof k.quelle === 'string' ? k.quelle : 'Leif',
        { fremd: k.fremd === true },
      );
      const jetzt = await this.o.vault.lesen(pfad);
      const m2 = matter(jetzt.inhalt);
      await this.o.vault.schreiben(pfad, matter.stringify(m2.content, { ...(m2.data as object), wiederholt: neu.pfad }), { basisVersion: jetzt.version });
    }
    this.beiAenderung();
    return (await this.lesenEines(pfad))!;
  }

  /** E94: Erinnerung verschickt – der Vermerk verhindert ein zweites Läuten für denselben Zeitpunkt */
  async erinnertMarkieren(pfad: string, zeitpunkt: string) {
    const d = await this.o.vault.lesen(this.pfadPruefen(pfad));
    const m = matter(d.inhalt);
    const r = await this.o.vault.schreiben(pfad, matter.stringify(m.content, { ...(m.data as object), erinnert: zeitpunkt }), { basisVersion: d.version });
    if (r.konflikt) throw new DorfFehler(409, 'Das To-do wurde gerade woanders geändert.');
  }

  /** In den Papierkorb des Vaults (wiederherstellbar) */
  async loeschen(roh: string) {
    const pfad = this.pfadPruefen(roh);
    if (!(await this.o.vault.existiert(pfad))) throw new DorfFehler(404, 'Dieses To-do gibt es nicht (mehr).');
    const ziel = await this.o.vault.loeschen(pfad);
    this.beiAenderung();
    return ziel;
  }
}

/** Kurzer Text für Agenten und Telegram */
export function todoZeile(t: TodoInfo) {
  return `${t.erledigt ? '[x]' : '[ ]'} ${t.wichtig ? '⭐ ' : ''}${t.titel}${t.faellig ? ` (fällig ${t.faellig})` : ''}${t.wiederholen ? ` 🔁 ${t.wiederholen}` : ''}${t.gruppe ? ` [${t.gruppe}]` : ''}${t.gebaeude ? ` #${t.gebaeude}` : ''} – ${t.pfad}`;
}

/** Alle Listen (E65 + Etappe 7) – eine Instanz je Ordner */
export function listenAnlegen(o: { vault: VaultDienst; uhr: Uhr }, beiAenderung: (liste: ListenName) => void) {
  const aus = {} as Record<ListenName, TodoDienst>;
  for (const n of LISTEN_NAMEN) {
    aus[n] = new TodoDienst({ ...o, ordner: LISTEN[n].ordner });
    aus[n].beiAenderung = () => beiAenderung(n);
  }
  return aus;
}
