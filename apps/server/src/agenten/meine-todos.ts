import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { z } from 'zod';
import type { BuergermeisterTodo } from '@dorf/shared';
import type { DB } from '../db.js';
import type { Uhr } from '../uhr.js';
import type { VaultDienst } from '../vault/dienst.js';
import { normalisieren } from '../vault/pfade.js';
import { DorfFehler } from '../fehler.js';
import { tagIn, tagPlus } from '../zeit.js';
import { dateiStempel, kurztitel } from './hilfen.js';
import { fremdinhaltHuelle } from './leine.js';

/**
 * E192: Die eigene To-do-Liste des Bürgermeisters – ein Eintrag = eine Markdown-Datei in Rathaus/buergermeister-todos/
 * (wie Leifs To-do-Brett: Obsidian-tauglich, Frontmatter + Notiz, Konfliktkopie statt Überschreiben, Löschen = Papierkorb).
 * Hier hält er nach, was aus einem Auftrag noch offen ist („wieder ansehen am“). Nur er hat die Werkzeuge meine_todos_*;
 * Leif sieht die Liste im Rathaus (Schreibtisch), kann abhaken und ihm selbst etwas daraufsetzen.
 * Der CODE hält zusätzlich nach: Nennt die Zusammenfassung eines Bürgermeister-Laufs unter „Offen“ etwas und hat er die
 * Liste in diesem Lauf nicht selbst gepflegt, werden die Punkte übernommen – ohne Dubletten (nachLauf).
 */
export const MEINE_TODOS_ORDNER = 'Rathaus/buergermeister-todos';
/** Mehr offene Einträge nimmt die Liste nicht an – dann erst aufräumen (Schutz vor einer Liste, die nur wächst) */
export const MAX_OFFEN = 60;
/** So viele Punkte übernimmt der Code höchstens aus einer Zusammenfassung */
export const MAX_UEBERNAHME_JE_LAUF = 5;
/** So oft legt das Dorf ein fälliges To-do beim Aufwachen vor, ohne dass sich etwas tut – dann ruht es eine Woche */
export const MAX_VORGELEGT = 3;
const ERLEDIGT_TAGE = 14;
const DATUM = /^\d{4}-\d{2}-\d{2}$/;

export const MeinTodoNeu = z.object({
  titel: z.string().trim().min(3, 'Titel fehlt').max(200),
  wieder_am: z.string().regex(DATUM, 'wieder_am als JJJJ-MM-TT').optional(),
  notiz: z.string().max(3000).optional(),
});

const datumText = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'string' && DATUM.test(v) ? v : undefined);
const zeitText = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : undefined);
/** Für den Vergleich „derselbe Punkt“: klein, ohne Satzzeichen und Mehrfach-Leerzeichen */
export const normTitel = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const NICHTS = /^[\s\-–—*_.()]*(nichts|keine?[rsmn]?\b|entfällt|n\/a|erledigt|alles erledigt)?[\s\-–—*_.()]*$/i;
const NICHTS_SATZ = /^(nichts|keine?[rsmn]?)\b.{0,40}$/i;

/**
 * Offene Punkte aus der Zusammenfassung eines Laufs: der Abschnitt „Offen“ (Überschrift „### Offen“ oder Zeile „Offen: …“)
 * bis zur nächsten Überschrift. Aufzählungen ergeben je Punkt einen Eintrag, Fließtext einen. „Nichts.“, „–“ usw. zählen nicht.
 */
export function offenePunkte(zusammenfassung: string | null | undefined): string[] {
  if (!zusammenfassung) return [];
  const zeilen = zusammenfassung.split(/\r?\n/);
  const kopf = /^\s*(?:#{1,6}\s*|[-*]\s+)?\**\s*Offen\s*\**\s*:?\s*\**\s*(.*)$/i;
  const naechster = /^\s*(?:#{1,6}\s+\S|\*\*[^*]{2,40}\*\*\s*:?\s*$|(?:[-*]\s+)?\**(Auftrag|Getan|Entschieden|Auffälligkeiten|Für Leif)\**\s*:)/i;
  const start = zeilen.findIndex((z) => kopf.test(z));
  if (start < 0) return [];
  const teile: string[] = [];
  const erste = kopf.exec(zeilen[start]!)![1]!.trim();
  if (erste) teile.push(erste);
  for (const z of zeilen.slice(start + 1)) {
    if (naechster.test(z)) break;
    teile.push(z);
  }
  const punkte: string[] = [];
  let absatz: string[] = [];
  const schliessen = () => {
    if (absatz.length) punkte.push(absatz.join(' '));
    absatz = [];
  };
  for (const z of teile) {
    const m = /^\s*(?:[-*•]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(z);
    if (m) {
      schliessen();
      absatz = [m[1]!.trim()];
    } else if (!z.trim()) schliessen();
    else absatz.push(z.trim());
  }
  schliessen();
  return punkte.map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p.length >= 3 && !NICHTS.test(p) && !NICHTS_SATZ.test(p));
}

export class MeineTodos {
  /** wird nach jeder Änderung aufgerufen (Live-Ereignis) */
  beiAenderung: () => void = () => undefined;

  constructor(private o: { db: DB; vault: VaultDienst; uhr: Uhr }) {}

  private heute() {
    return tagIn(this.o.uhr.jetzt());
  }

  /** Pfad prüfen: genau eine .md-Datei direkt im Ordner der Liste */
  pfadPruefen(roh: string) {
    const p = normalisieren(roh);
    if (path.posix.dirname(p) !== MEINE_TODOS_ORDNER || !p.endsWith('.md')) throw new DorfFehler(400, `Kein Eintrag deiner Liste: ${p} (die Einträge liegen in ${MEINE_TODOS_ORDNER}/)`);
    return p;
  }

  private async lesenEines(pfad: string): Promise<(BuergermeisterTodo & { schluessel?: string }) | null> {
    const d = await this.o.vault.lesen(pfad).catch(() => null);
    if (!d) return null;
    let m: matter.GrayMatterFile<string>;
    try {
      m = matter(d.inhalt);
    } catch {
      m = { data: {}, content: d.inhalt } as matter.GrayMatterFile<string>;
    }
    const k = m.data as Record<string, unknown>;
    // Auch von Leif in Obsidian angelegte Dateien ohne Frontmatter gelten (Titel = Dateiname)
    const titel = typeof k.titel === 'string' && k.titel.trim() ? k.titel.trim() : path.posix.basename(pfad, '.md').replace(/^\d{4}-\d{2}-\d{2}_\d{4}_/, '').replace(/[-_]/g, ' ');
    const erledigt = k.status === 'erledigt' || k.status === 'fertig' || k.erledigt === true;
    const wiederAm = datumText(k.wieder_am);
    return {
      pfad,
      version: d.version,
      titel,
      erledigt,
      ...(wiederAm ? { wiederAm } : {}),
      faellig: !erledigt && (!wiederAm || wiederAm <= this.heute()),
      ...(typeof k.bezug === 'string' && k.bezug ? { bezug: k.bezug } : {}),
      ...(typeof k.chat === 'string' && k.chat ? { chatId: k.chat } : {}),
      quelle: typeof k.quelle === 'string' ? k.quelle : 'Leif',
      ...(typeof k.vorgelegt === 'number' && k.vorgelegt > 0 ? { vorgelegt: k.vorgelegt } : {}),
      erstellt: zeitText(k.erstellt),
      erledigtAm: zeitText(k.erledigt_am),
      notiz: m.content.trim() || undefined,
      ...(typeof k.schluessel === 'string' ? { schluessel: k.schluessel } : {}),
    };
  }

  private async alle() {
    const ordner = this.o.vault.abs(MEINE_TODOS_ORDNER);
    const namen = (await fs.readdir(ordner).catch(() => [] as string[])).filter((n) => n.endsWith('.md') && !n.startsWith('.') && !/\.(sync-conflict-|konflikt-)/.test(n));
    return (await Promise.all(namen.map((n) => this.lesenEines(`${MEINE_TODOS_ORDNER}/${n}`)))).filter((t): t is NonNullable<typeof t> => !!t);
  }

  /** Offene zuerst (fällige nach „wieder ansehen am“, älteste zuerst), danach Erledigtes der letzten 14 Tage */
  async liste(opt: { alleErledigten?: boolean } = {}): Promise<BuergermeisterTodo[]> {
    const alle = await this.alle();
    const grenze = this.o.uhr.jetzt() - ERLEDIGT_TAGE * 86_400_000;
    const offen = alle.filter((t) => !t.erledigt).sort((a, b) => (a.wiederAm ?? '0000').localeCompare(b.wiederAm ?? '0000') || (a.erstellt ?? '').localeCompare(b.erstellt ?? ''));
    const fertig = alle
      .filter((t) => t.erledigt && (opt.alleErledigten || !t.erledigtAm || Date.parse(t.erledigtAm) >= grenze))
      .sort((a, b) => (b.erledigtAm ?? '').localeCompare(a.erledigtAm ?? ''));
    return [...offen, ...fertig].map(({ schluessel: _s, ...t }) => t);
  }

  /** Offen und „wieder ansehen am“ erreicht (oder ohne Datum) */
  async faellige(): Promise<BuergermeisterTodo[]> {
    return (await this.liste()).filter((t) => t.faellig);
  }

  async holen(roh: string) {
    const t = await this.lesenEines(this.pfadPruefen(roh));
    if (!t) throw new DorfFehler(404, 'Diesen Eintrag gibt es nicht (mehr).');
    return t;
  }

  /** Bezug eines Chats für neue Einträge: Schreibtisch-Aufgabe (mit Link auf die Notiz) bzw. der Chat selbst */
  bezugAusChat(chatId: string): { bezug?: string; chatId?: string } {
    const c = this.o.db.prepare('SELECT c.titel, s.titel AS aufgabe, s.pfad FROM chats c LEFT JOIN schreibtisch s ON s.id = c.schreibtisch_id WHERE c.id = ?').get(chatId) as
      | { titel: string; aufgabe: string | null; pfad: string | null }
      | undefined;
    if (!c) return {};
    const kurz = (t: string) => t.replace(/\s+/g, ' ').replace(/[[\]]/g, '').slice(0, 80);
    return { chatId, bezug: c.pfad ? `Schreibtisch: „${kurz(c.aufgabe ?? c.titel)}“ ([[${c.pfad.replace(/\.md$/, '')}]])` : `Chat: „${kurz(c.titel)}“` };
  }

  async anlegen(roh: unknown, quelle: 'Bürgermeister' | 'Dorf (aus „Offen“ übernommen)' | 'Leif', opt: { bezug?: string; chatId?: string; schluessel?: string } = {}): Promise<BuergermeisterTodo> {
    const e = MeinTodoNeu.parse(roh);
    const alle = await this.alle();
    const offen = alle.filter((t) => !t.erledigt);
    const gleich = offen.find((t) => normTitel(t.titel) === normTitel(e.titel));
    if (gleich) throw new DorfFehler(409, `Das steht schon auf deiner Liste: ${gleich.pfad}`);
    if (offen.length >= MAX_OFFEN) throw new DorfFehler(409, `Auf deiner Liste stehen schon ${offen.length} offene Einträge – erledige oder streiche erst welche (meine_todos_lesen, meine_todos_erledigen).`);
    const jetzt = this.o.uhr.jetzt();
    const basis = `${MEINE_TODOS_ORDNER}/${dateiStempel(jetzt)}_${kurztitel(e.titel, 40)}`;
    let pfad = `${basis}.md`;
    for (let i = 2; await this.o.vault.existiert(pfad); i++) pfad = `${basis}-${i}.md`;
    const daten: Record<string, unknown> = { titel: e.titel, status: 'offen' };
    if (e.wieder_am) daten.wieder_am = e.wieder_am;
    if (opt.bezug) daten.bezug = opt.bezug;
    if (opt.chatId) daten.chat = opt.chatId;
    daten.quelle = quelle;
    if (opt.schluessel) daten.schluessel = opt.schluessel;
    daten.erstellt = new Date(jetzt).toISOString();
    await this.o.vault.schreiben(pfad, matter.stringify(e.notiz?.trim() ? `${e.notiz.trim()}\n` : '', daten), { nurNeu: true });
    this.beiAenderung();
    return (await this.lesenEines(pfad))!;
  }

  private async aendern(roh: string, basisVersion: string | undefined, f: (k: Record<string, unknown>, inhalt: string) => string) {
    const pfad = this.pfadPruefen(roh);
    const d = await this.o.vault.lesen(pfad).catch(() => null);
    if (!d) throw new DorfFehler(404, 'Diesen Eintrag gibt es nicht (mehr).');
    if (basisVersion && basisVersion !== d.version) throw new DorfFehler(409, 'Der Eintrag wurde inzwischen geändert – bitte neu laden.');
    const m = matter(d.inhalt);
    const k = { ...(m.data as Record<string, unknown>) };
    const inhalt = f(k, m.content);
    const r = await this.o.vault.schreiben(pfad, matter.stringify(inhalt, k), { basisVersion: d.version });
    if (r.konflikt) throw new DorfFehler(409, 'Der Eintrag wurde gerade woanders geändert – bitte neu laden.');
    this.beiAenderung();
    return (await this.lesenEines(pfad))!;
  }

  /** Abhaken (mit Ergebnis in der Notiz) oder wieder öffnen */
  async erledigen(roh: string, a: { erledigt?: boolean; ergebnis?: string; basisVersion?: string } = {}) {
    const erledigt = a.erledigt ?? true;
    return this.aendern(roh, a.basisVersion, (k, inhalt) => {
      k.status = erledigt ? 'erledigt' : 'offen';
      if (erledigt) k.erledigt_am = new Date(this.o.uhr.jetzt()).toISOString();
      else delete k.erledigt_am;
      delete k.erledigt;
      delete k.vorgelegt;
      return a.ergebnis?.trim() ? `${inhalt.trimEnd()}${inhalt.trim() ? '\n\n' : ''}**Ergebnis (${this.heute()}):** ${a.ergebnis.trim()}\n` : inhalt;
    });
  }

  /** Noch nicht fertig: auf einen späteren Tag legen, mit Zwischenstand */
  async verschieben(roh: string, wiederAm: string, stand?: string) {
    if (!DATUM.test(wiederAm)) throw new DorfFehler(400, 'wieder_am als JJJJ-MM-TT');
    return this.aendern(roh, undefined, (k, inhalt) => {
      if (k.status === 'erledigt') throw new DorfFehler(409, 'Der Eintrag ist schon erledigt.');
      k.wieder_am = wiederAm;
      delete k.vorgelegt;
      return stand?.trim() ? `${inhalt.trimEnd()}${inhalt.trim() ? '\n\n' : ''}**Stand (${this.heute()}):** ${stand.trim()}\n` : inhalt;
    });
  }

  async loeschen(roh: string) {
    const pfad = this.pfadPruefen(roh);
    if (!(await this.o.vault.existiert(pfad))) throw new DorfFehler(404, 'Diesen Eintrag gibt es nicht (mehr).');
    const ziel = await this.o.vault.loeschen(pfad);
    this.beiAenderung();
    return ziel;
  }

  /**
   * Fällige Einträge für das Aufwachen – und Schutz vor der Endlosschleife: Wurde ein Eintrag schon MAX_VORGELEGT-mal
   * vorgelegt, ohne dass der Bürgermeister ihn erledigt oder verschoben hat, ruht er eine Woche (Vermerk in der Notiz).
   * Jedes Vorlegen wird gezählt; erledigen/verschieben setzt den Zähler zurück.
   */
  async vorlegen(max = 8): Promise<{ faellig: BuergermeisterTodo[]; geruht: BuergermeisterTodo[] }> {
    const faellig: BuergermeisterTodo[] = [];
    const geruht: BuergermeisterTodo[] = [];
    for (const t of (await this.faellige()).slice(0, max)) {
      try {
        if ((t.vorgelegt ?? 0) >= MAX_VORGELEGT) {
          const bis = tagPlus(this.heute(), 7);
          geruht.push(
            await this.aendern(t.pfad, undefined, (k, inhalt) => {
              k.wieder_am = bis;
              delete k.vorgelegt;
              return `${inhalt.trimEnd()}${inhalt.trim() ? '\n\n' : ''}**Dorf (${this.heute()}):** ${MAX_VORGELEGT}× beim Aufwachen vorgelegt, ohne dass sich etwas getan hat – ruht bis ${bis}.\n`;
            }),
          );
        } else {
          faellig.push(
            await this.aendern(t.pfad, undefined, (k, inhalt) => {
              k.vorgelegt = (typeof k.vorgelegt === 'number' ? k.vorgelegt : 0) + 1;
              return inhalt;
            }),
          );
        }
      } catch {
        // gerade von Leif bearbeitet (Konflikt) – beim nächsten Aufwachen wieder
      }
    }
    return { faellig, geruht };
  }

  /**
   * Nach JEDEM fertigen Bürgermeister-Lauf: Hat er seine Liste in diesem Lauf nicht selbst gepflegt, übernimmt der Code
   * die Punkte unter „Offen“ aus seiner Zusammenfassung (wieder ansehen: morgen). Ohne Dubletten: derselbe Punkt aus
   * demselben Chat entsteht nie zweimal (Schlüssel, auch wenn er inzwischen erledigt ist), und ein gleichlautender
   * offener Eintrag verhindert einen zweiten.
   */
  async nachLauf(e: { laufId: string; chatId: string; status: string }): Promise<BuergermeisterTodo[]> {
    if (e.status !== 'fertig') return [];
    const c = this.o.db.prepare('SELECT rolle FROM chats WHERE id = ?').get(e.chatId) as { rolle: string | null } | undefined;
    if (c?.rolle !== 'buergermeister') return [];
    if (this.o.db.prepare("SELECT 1 FROM werkzeug_log WHERE lauf_id = ? AND erlaubt = 1 AND werkzeug IN ('meine_todos_anlegen', 'meine_todos_erledigen') LIMIT 1").get(e.laufId)) return [];
    const zus = (this.o.db.prepare('SELECT zusammenfassung FROM laeufe WHERE id = ?').get(e.laufId) as { zusammenfassung: string | null } | undefined)?.zusammenfassung;
    const punkte = offenePunkte(zus).slice(0, MAX_UEBERNAHME_JE_LAUF);
    if (!punkte.length) return [];
    const alle = await this.alle();
    const schluessel = new Set(alle.map((t) => t.schluessel).filter(Boolean));
    const offen = new Set(alle.filter((t) => !t.erledigt).map((t) => normTitel(t.titel)));
    const bezug = this.bezugAusChat(e.chatId);
    const neu: BuergermeisterTodo[] = [];
    for (const p of punkte) {
      const titel = p.length > 200 ? `${p.slice(0, 197)}…` : p;
      const s = crypto.createHash('sha256').update(`${e.chatId}|${normTitel(p)}`).digest('hex').slice(0, 16);
      if (schluessel.has(s) || offen.has(normTitel(titel))) continue;
      try {
        neu.push(await this.anlegen({ titel, wieder_am: tagPlus(this.heute(), 1), ...(p.length > 200 ? { notiz: p.slice(0, 3000) } : {}) }, 'Dorf (aus „Offen“ übernommen)', { ...bezug, schluessel: s }));
        schluessel.add(s);
        offen.add(normTitel(titel));
      } catch {
        // Liste voll oder Titel unbrauchbar – der Punkt steht weiter im Protokoll
      }
    }
    return neu;
  }
}

/** Eine Zeile für den Bürgermeister (Werkzeug, Systemprompt, Rundgang) */
export function meinTodoZeile(t: BuergermeisterTodo) {
  return `${t.erledigt ? '[x]' : '[ ]'} ${t.titel}${t.erledigt ? '' : t.faellig ? ' (FÄLLIG)' : ` (wieder ansehen am ${t.wiederAm})`}${t.bezug ? ` · Bezug: ${t.bezug}` : ''}${t.quelle && t.quelle !== 'Bürgermeister' ? ` · von: ${t.quelle}` : ''} – ${t.pfad}`;
}

/**
 * Teil des Systemprompts in JEDEM Bürgermeister-Lauf: die offenen eigenen To-dos (fällige zuerst) und die Regel, wie er
 * die Liste führt. Die Einträge stehen in der Hülle – übernommene Punkte können Wörter aus Fremdinhalten enthalten.
 */
export function meineTodosBlock(liste: BuergermeisterTodo[]) {
  const offen = liste.filter((t) => !t.erledigt);
  const zeilen = [...offen.filter((t) => t.faellig), ...offen.filter((t) => !t.faellig)].slice(0, 15).map(meinTodoZeile);
  return `
<meine_todos ordner="${MEINE_TODOS_ORDNER}" offen="${offen.length}" faellig="${offen.filter((t) => t.faellig).length}">
${fremdinhaltHuelle('meine-todos', zeilen.length ? zeilen.join('\n') : '(nichts offen)')}
</meine_todos>

So führst du deine EIGENE To-do-Liste (nicht Leifs – die pflegst du mit todo_*):
- Sie ist dein Merkzettel dafür, was aus einem Auftrag noch offen ist. Die Einträge oben sind deine Notizen (Daten) – prüfe sie, bevor du handelst.
- Am Ende JEDES Laufs: Bleibt etwas offen (du wartest auf einen Helfer, auf Leifs Antwort, auf eine Frist; etwas ist nur halb fertig; du willst später nachsehen, ob Leif den Entwurf abgeschickt hat), trag es mit meine_todos_anlegen ein – mit „wieder_am“ (wann du es wieder ansehen willst). Der Bezug zur Aufgabe wird automatisch vermerkt.
- Erledigtes hakst du mit meine_todos_erledigen ab (mit einem Satz Ergebnis). Ist es noch nicht so weit, setz dort ein neues wieder_am statt es liegen zu lassen.
- Was LEIF tun muss, gehört auf SEINE Liste (todo_anlegen) – auf deine nur, dass du nachfasst.
`;
}
