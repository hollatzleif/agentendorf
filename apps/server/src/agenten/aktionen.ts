import path from 'node:path';
import matter from 'gray-matter';
import { z } from 'zod';
import type { AktionInfo, AktionQuelle, QuellenOption } from '@dorf/shared';
import type { VaultDienst } from '../vault/dienst.js';
import { gebaeudeListe } from '../vault/gebaeude.js';
import { DorfFehler } from '../fehler.js';
import { aktionPruefen, motorPruefen } from './leine.js';
import { zeitplanLesen } from './zeitplan.js';

// „ja“/„nein“ in Obsidian-Frontmatter als Wahrheitswerte akzeptieren
const JaNein = z.preprocess((w) => (w === 'ja' ? true : w === 'nein' ? false : w), z.boolean());

const Eingabe = z.object({
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/, 'Eingabe-Namen: Kleinbuchstaben, Ziffern, _'),
  typ: z.enum(['text', 'langtext', 'auswahl', 'datei']).default('text'),
  beschriftung: z.string().optional(),
  pflicht: JaNein.default(true),
  optionen: z.array(z.coerce.string()).optional(),
  /** Auswahl vom Server: uni.faecher (Kurse), uni.abgaben (offene Abgaben) */
  quelle: z.enum(['uni.faecher', 'uni.abgaben', 'post.mails']).optional(),
  /** Wert für automatische Läufe und Vorbelegung */
  standard: z.coerce.string().optional(),
});

/** Liefert die erlaubten Werte einer Server-Auswahl (beim Anzeigen UND beim Start geprüft). */
export type QuellenFn = (q: AktionQuelle) => QuellenOption[];

export const AktionKopf = z
  .object({
    name: z.string().min(1),
    gebaeude: z.string().optional(),
    beschreibung: z.string().default(''),
    motor: z.enum(['api', 'claude-code', 'coding']).default('claude-code'),
    stufe: z.enum(['klein', 'mittel', 'gross']).default('mittel'),
    eingaben: z.array(Eingabe).default([]),
    anhaenge: z.array(z.string()).default([]),
    werkzeuge: z.array(z.enum(['vault_lesen', 'vault_suchen', 'vault_schreiben', 'web', 'rechenraum', 'post', 'moodle', 'kalender'])).default(['vault_lesen', 'vault_suchen', 'vault_schreiben']),
    fremdinhalte: JaNein.default(false),
    freigabe_vor_start: JaNein.default(false),
    /** Sonderrolle: buergermeister bekommt aktionen_liste, helfer_starten, plan_vorlegen */
    rolle: z.enum(['buergermeister']).optional(),
    /** Läuft von selbst, z. B. „täglich 06:00“ (Motor der Aktion, meist Leifs Abo) */
    zeitplan: z.string().optional(),
    /** Ergebnis-Datei im eigenen Gebäude, die bei jedem Lauf ersetzt wird (alte Fassung → archiv/) */
    ablage: z.string().optional(),
    /** Zeitplan für jeden Wert einer Auswahl-Eingabe (z. B. „fach“ → ein Lauf je Fach in uni.faecher), E64 */
    zeitplan_je: z.string().optional(),
  })
  .superRefine((k, ctx) => {
    if (k.zeitplan) {
      try {
        zeitplanLesen(k.zeitplan);
      } catch (e) {
        ctx.addIssue({ code: 'custom', message: (e as Error).message, path: ['zeitplan'] });
      }
      const ohne = k.eingaben.find((e) => e.pflicht && !e.standard && e.name !== k.zeitplan_je);
      if (ohne) ctx.addIssue({ code: 'custom', message: `Eingabe „${ohne.name}“ braucht einen standard-Wert, damit die Aktion von selbst laufen kann`, path: ['eingaben'] });
    }
    if (k.zeitplan_je) {
      const e = k.eingaben.find((x) => x.name === k.zeitplan_je);
      if (!k.zeitplan) ctx.addIssue({ code: 'custom', message: 'zeitplan_je braucht einen zeitplan', path: ['zeitplan_je'] });
      if (!e || (!e.quelle && !e.optionen?.length))
        ctx.addIssue({ code: 'custom', message: `zeitplan_je: „${k.zeitplan_je}“ muss eine Eingabe mit quelle oder optionen sein`, path: ['zeitplan_je'] });
    }
    if (k.ablage && (!/\/[A-Za-z0-9_-]+\.(html|md)$/.test(k.ablage) || k.ablage.includes('..') || k.ablage.startsWith('/')))
      ctx.addIssue({
        code: 'custom',
        message: 'ablage: Pfad wie „Bibliothek/00_Checkliste.html“ oder „Uni/faecher/{fach}/00_Kursuebersicht.html“ (Dateiname nur Buchstaben, Ziffern, _ und -, Endung .html oder .md)',
        path: ['ablage'],
      });
    const f = aktionPruefen(k);
    if (f) ctx.addIssue({ code: 'custom', message: f, path: ['werkzeuge'] });
    const typAuswahlOhne = k.eingaben.find((e) => e.typ === 'auswahl' && !e.optionen?.length && !e.quelle);
    if (typAuswahlOhne) ctx.addIssue({ code: 'custom', message: `Eingabe „${typAuswahlOhne.name}“ (auswahl) braucht optionen oder quelle`, path: ['eingaben'] });
  });

export type AktionKopfT = z.infer<typeof AktionKopf>;

export interface Aktion extends AktionInfo {
  kopf?: AktionKopfT;
  prompt: string;
  anhaenge: string[];
}

/** Aktion aus Dateitext lesen (Fehler stehen in `fehler`) – auch zum Prüfen neuer Skills vor dem Speichern */
export function zuInfo(gebaeude: string, datei: string, roh: string): Aktion {
  const id = `${gebaeude}/${datei.replace(/\.md$/, '')}`;
  const pfad = `${gebaeude}/aktionen/${datei}`;
  try {
    const m = matter(roh);
    const k = AktionKopf.parse(m.data);
    if (k.gebaeude && k.gebaeude !== gebaeude) throw new Error(`liegt in ${gebaeude}, nennt aber gebaeude: ${k.gebaeude}`);
    const motorFehler = motorPruefen(gebaeude, k.motor);
    if (motorFehler) throw new Error(motorFehler);
    if (k.ablage && (!k.ablage.startsWith(`${gebaeude}/`) || /^[^/]+\/(aktionen|protokolle|chats|archiv)\//.test(k.ablage)))
      throw new Error(`ablage muss im eigenen Gebäude liegen (${gebaeude}/…), nicht in aktionen/, protokolle/, chats/ oder archiv/`);
    if (!m.content.trim()) throw new Error('Der Text unter dem Frontmatter (der Prompt) ist leer.');
    return {
      id,
      gebaeude,
      pfad,
      name: k.name,
      beschreibung: k.beschreibung,
      motor: k.motor,
      stufe: k.stufe,
      eingaben: k.eingaben,
      werkzeuge: k.werkzeuge,
      fremdinhalte: k.fremdinhalte,
      freigabeVorStart: k.freigabe_vor_start,
      rolle: k.rolle,
      zeitplan: k.zeitplan,
      ...(k.zeitplan_je ? { zeitplanJe: k.zeitplan_je } : {}),
      ablage: k.ablage,
      kopf: k,
      prompt: m.content.trim(),
      anhaenge: k.anhaenge,
    };
  } catch (e) {
    const grund =
      e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join('.') || 'Frontmatter'}: ${i.message}`).join('; ') : (e as Error).message;
    return {
      id,
      gebaeude,
      pfad,
      name: datei.replace(/\.md$/, ''),
      beschreibung: '',
      motor: 'claude-code',
      stufe: 'mittel',
      eingaben: [],
      werkzeuge: [],
      fremdinhalte: false,
      freigabeVorStart: false,
      prompt: '',
      anhaenge: [],
      fehler: `Aktion ist fehlerhaft: ${grund}`,
    };
  }
}

/** Alle Aktionen aller (offenen und geschlossenen) Gebäude. */
export async function aktionenListe(vault: VaultDienst, nurGebaeude?: string): Promise<Aktion[]> {
  const aus: Aktion[] = [];
  for (const g of await gebaeudeListe(vault)) {
    if (nurGebaeude && g.id !== nurGebaeude) continue;
    const dateien = (await vault.namen(`${g.id}/aktionen`)).filter((n) => n.datei).map((n) => n.name);
    for (const d of dateien.filter((n) => n.endsWith('.md')).sort((a, b) => a.localeCompare(b, 'de'))) {
      const roh = await vault.text(`${g.id}/aktionen/${d}`).catch(() => null);
      if (roh !== null) aus.push(zuInfo(g.id, d, roh));
    }
  }
  return aus;
}

export async function aktionLaden(vault: VaultDienst, id: string): Promise<Aktion> {
  const [gebaeude, name] = id.split('/');
  if (!gebaeude || !name || id.split('/').length !== 2) throw new DorfFehler(400, 'Ungültige Aktions-ID.');
  const a = (await aktionenListe(vault, gebaeude)).find((x) => x.id === id);
  if (!a) throw new DorfFehler(404, 'Aktion nicht gefunden.');
  return a;
}

/** Prüft die Eingaben gegen die Aktion und setzt Platzhalter {name} im Prompt und in den Anhängen ein. */
export function eingabenAnwenden(a: Aktion, eingaben: Record<string, string>, quellen?: QuellenFn) {
  if (a.fehler) throw new DorfFehler(400, a.fehler);
  const werte: Record<string, string> = {};
  for (const e of a.eingaben) {
    const w = (eingaben[e.name] ?? e.standard ?? '').toString();
    if (e.pflicht && !w.trim()) throw new DorfFehler(400, `Eingabe „${e.beschriftung ?? e.name}“ fehlt.`);
    if (e.quelle) {
      if (w && !(quellen?.(e.quelle) ?? []).some((o) => o.wert === w)) throw new DorfFehler(400, `Ungültige Auswahl für „${e.beschriftung ?? e.name}“ (nicht in ${e.quelle}).`);
    } else if (e.typ === 'auswahl' && w && !e.optionen?.includes(w)) throw new DorfFehler(400, `Ungültige Auswahl für „${e.name}“.`);
    if (w.length > 100_000) throw new DorfFehler(400, `Eingabe „${e.name}“ ist zu lang.`);
    werte[e.name] = w;
  }
  const ersetzen = (t: string) => t.replace(/\{([a-z_][a-z0-9_]*)\}/g, (m, n: string) => (n in werte ? werte[n]! : m));
  return { prompt: ersetzen(a.prompt), anhaenge: a.anhaenge.map(ersetzen).filter((x) => !/\{[a-z_]/.test(x)), werte, ablage: a.ablage ? ersetzen(a.ablage) : undefined };
}
