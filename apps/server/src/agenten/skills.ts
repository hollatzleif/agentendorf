import matter from 'gray-matter';
import { z } from 'zod';
import type { VaultDienst } from '../vault/dienst.js';
import { gebaeudeListe } from '../vault/gebaeude.js';
import { DorfFehler } from '../fehler.js';
import { zuInfo } from './aktionen.js';
import { dateiStempel, kurztitel } from './hilfen.js';

/**
 * Skills (= Aktionen) anlegen – aus dem App-Formular oder als Vorschlag des Bürgermeisters (nach Leifs Freigabe).
 * Heraus kommt immer eine normale Markdown-Datei in <Gebäude>/aktionen/, die Leif in Obsidian weiter bearbeiten kann.
 * Vor dem Speichern wird sie genauso geprüft wie jede Aktion (Leine, Zeitplan, Ablage) – Fehlerhaftes wird nicht gespeichert.
 */
export const SkillEntwurf = z.object({
  gebaeude: z.string().min(1).max(80),
  name: z.string().trim().min(2).max(60),
  beschreibung: z.string().trim().max(400).default(''),
  anweisung: z.string().trim().min(10, 'Die Anweisung ist zu kurz.').max(50_000),
  motor: z.enum(['api', 'claude-code']).default('claude-code'),
  stufe: z.enum(['klein', 'mittel', 'gross']).default('mittel'),
  werkzeuge: z.array(z.enum(['vault_lesen', 'vault_suchen', 'vault_schreiben', 'web', 'rechenraum', 'post', 'moodle', 'kalender', 'hafen'])).default(['vault_lesen', 'vault_suchen', 'vault_schreiben']),
  fremdinhalte: z.boolean().default(false),
  zeitplan: z.string().trim().max(100).optional(),
  ablage: z.string().trim().max(200).optional(),
  eingaben: z
    .array(
      z.object({
        name: z.string().regex(/^[a-z_][a-z0-9_]*$/, 'Eingabe-Namen: Kleinbuchstaben, Ziffern, _'),
        beschriftung: z.string().max(200).optional(),
        typ: z.enum(['text', 'langtext', 'auswahl']).default('text'),
        pflicht: z.boolean().default(true),
        standard: z.string().max(500).optional(),
        optionen: z.array(z.string().max(100)).max(50).optional(),
        quelle: z.enum(['uni.faecher', 'uni.abgaben', 'post.mails']).optional(),
      }),
    )
    .max(10)
    .default([]),
});
export type SkillEntwurfT = z.infer<typeof SkillEntwurf>;

/** Markdown-Datei (Frontmatter + Anweisung) */
export function skillMarkdown(e: SkillEntwurfT): string {
  const kopf: Record<string, unknown> = { name: e.name };
  if (e.beschreibung) kopf.beschreibung = e.beschreibung;
  kopf.motor = e.motor;
  kopf.stufe = e.stufe;
  kopf.werkzeuge = e.werkzeuge;
  if (e.fremdinhalte) kopf.fremdinhalte = 'ja';
  if (e.zeitplan) kopf.zeitplan = e.zeitplan;
  if (e.ablage) kopf.ablage = e.ablage;
  if (e.eingaben.length)
    kopf.eingaben = e.eingaben.map((x) => {
      const o: Record<string, unknown> = { name: x.name, typ: x.typ };
      if (x.beschriftung) o.beschriftung = x.beschriftung;
      if (!x.pflicht) o.pflicht = 'nein';
      if (x.standard) o.standard = x.standard;
      if (x.optionen?.length) o.optionen = x.optionen;
      if (x.quelle) o.quelle = x.quelle;
      return o;
    });
  return matter.stringify(`${e.anweisung.trim()}\n`, kopf);
}

/** Felder, die der Entwurf selbst setzt – alles andere aus einer bestehenden Aktion bleibt beim Ersetzen erhalten */
const ENTWURF_FELDER = ['name', 'gebaeude', 'beschreibung', 'motor', 'stufe', 'werkzeuge', 'fremdinhalte', 'zeitplan', 'ablage', 'eingaben'];
const janein = (w: unknown) => w === true || w === 'ja' || w === 'true';

/**
 * Prüft den Entwurf wie eine echte Aktion; gibt Pfad, Markdown und ID zurück (speichert NICHT).
 * Beim Ersetzen (Review zu E185) bleiben Felder der alten Fassung, die der Entwurf nicht kennt (freigabe_vor_start,
 * zeitplan_je, anhaenge, rolle …), erhalten; `geschuetzt` nennt, was die alte Fassung an Schutz/Zeitplan hat.
 */
export async function skillPruefen(vault: VaultDienst, roh: unknown, opt: { ersetzen?: boolean } = {}) {
  const e = SkillEntwurf.parse(roh);
  const gebaeude = await gebaeudeListe(vault);
  if (!gebaeude.some((g) => g.id === e.gebaeude)) throw new DorfFehler(400, `Gebäude „${e.gebaeude}“ gibt es nicht.`);
  const datei = `${kurztitel(e.name) || 'aktion'}.md`;
  const pfad = `${e.gebaeude}/aktionen/${datei}`;
  const existiert = await vault.existiert(pfad);
  if (existiert && !opt.ersetzen) throw new DorfFehler(409, `Es gibt schon eine Aktion ${pfad} – anderen Namen wählen oder die Datei bearbeiten.`);
  let markdown = skillMarkdown(e);
  const geschuetzt: string[] = [];
  if (existiert) {
    let alt: Record<string, unknown> = {};
    try {
      alt = matter((await vault.lesen(pfad)).inhalt).data as Record<string, unknown>;
    } catch {
      // kaputtes Frontmatter der alten Fassung: nichts zu übernehmen
    }
    if (janein(alt.freigabe_vor_start)) geschuetzt.push('freigabe_vor_start');
    for (const f of ['zeitplan', 'zeitplan_je', 'rolle']) if (alt[f]) geschuetzt.push(f);
    const bleibt = Object.fromEntries(Object.entries(alt).filter(([k]) => !ENTWURF_FELDER.includes(k)));
    if (Object.keys(bleibt).length) {
      const neu = matter(markdown);
      markdown = matter.stringify(neu.content, { ...neu.data, ...bleibt });
    }
  }
  const a = zuInfo(e.gebaeude, datei, markdown);
  if (a.fehler) throw new DorfFehler(400, a.fehler.replace(/^Aktion ist fehlerhaft: /, ''));
  return { pfad, markdown, id: a.id, name: e.name, gebaeude: e.gebaeude, beschreibung: e.beschreibung, existiert, geschuetzt };
}

/**
 * Prüfen und speichern (App-Formular, Bürgermeister direkt bzw. nach Leifs Freigabe). Mit `ersetzen` wird ein
 * bestehender Skill überschrieben – die alte Fassung kommt nach <Gebäude>/archiv/aktionen/ (E185).
 */
export async function skillAnlegen(vault: VaultDienst, roh: unknown, opt: { ersetzen?: boolean; jetzt?: number } = {}) {
  const s = await skillPruefen(vault, roh, opt);
  let archiv: string | undefined;
  let version: string;
  if (s.existiert) {
    archiv = `${s.gebaeude}/archiv/aktionen/${dateiStempel(opt.jetzt ?? Date.now())}_${s.pfad.split('/').pop()}`;
    await vault.schreiben(archiv, (await vault.lesen(s.pfad)).inhalt);
    version = (await vault.schreiben(s.pfad, s.markdown)).version;
  } else version = (await vault.schreiben(s.pfad, s.markdown, { nurNeu: true })).version;
  return { id: s.id, pfad: s.pfad, archiv, version };
}
