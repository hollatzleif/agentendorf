import matter from 'gray-matter';
import { z } from 'zod';
import type { Aufwand, Motor, MotorenKonfig, Stufe, StufenKonfig } from '@dorf/shared';
import type { VaultDienst } from '../vault/dienst.js';
import { DorfFehler } from '../fehler.js';

export const MODELLE_PFAD = '00_Stadtordnung/modelle.md';
export const MOTOREN_PFAD = '00_Stadtordnung/motoren.md';
export const STUFEN: Stufe[] = ['klein', 'mittel', 'gross'];
export const MOTOREN: Motor[] = ['api', 'claude-code', 'coding'];
const AUFWAND: Aufwand[] = ['low', 'medium', 'high', 'xhigh', 'max'];

// Rückfall, falls die Dateien fehlen oder kaputt sind (entspricht der Vorlage)
export const STANDARD_STUFEN: StufenKonfig = {
  stufen: {
    klein: { modell: 'claude-sonnet-5-5', aufwand: 'medium' },
    mittel: { modell: 'claude-opus-5-5', aufwand: 'high' },
    gross: { modell: 'claude-fable-5-2', aufwand: 'high' },
  },
  // E218 (Leif: Bürgermeister höchstens 0,50 $ am Tag): Einordnen, Zeitung & Co. mit Haiku – Cent-Beträge
  system: { modell: 'claude-haiku-5-5', aufwand: 'medium' },
  preise: {
    'claude-sonnet-5-5': { eingabe: 2, ausgabe: 10 },
    'claude-opus-5-5': { eingabe: 4, ausgabe: 20 },
    'claude-fable-5-2': { eingabe: 8, ausgabe: 40 },
    'claude-haiku-5-5': { eingabe: 0.1, ausgabe: 0.5 },
  },
};
export const STANDARD_MOTOREN: MotorenKonfig = { alleAuf: 'keiner', parallel: { 'claude-code': 2, api: 4, coding: 1 } };

const ModellId = z.string().regex(/^claude-[a-z0-9-]+$/, 'Modell-ID muss mit claude- beginnen');
const StufeSchema = z.object({ modell: ModellId, aufwand: z.enum(AUFWAND as [Aufwand, ...Aufwand[]]) });
const ModelleKopf = z.object({
  stufen: z.object({ klein: StufeSchema, mittel: StufeSchema, gross: StufeSchema }),
  // fehlt in älteren modelle.md → Haiku (E218)
  system: StufeSchema.default({ modell: 'claude-haiku-5-5', aufwand: 'medium' }),
  preise: z.record(z.string(), z.object({ eingabe: z.number().nonnegative(), ausgabe: z.number().nonnegative() })).default({}),
});
const MotorenKopf = z.object({
  alle_auf: z.enum(['keiner', 'api', 'claude-code']).default('keiner'),
  // coding fehlt in älteren motoren.md → 1 (ein Coding-Agent zur Zeit; 0 = Coding-Agenten aus)
  parallel: z
    .object({ 'claude-code': z.number().int().min(0).max(10), api: z.number().int().min(0).max(20), coding: z.number().int().min(0).max(3).default(1) })
    .default({ 'claude-code': 2, api: 4, coding: 1 }),
});

const fehlerText = (e: unknown) =>
  e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : String((e as Error).message ?? e);

/** Liest die Modell-Zuordnung. Bei Fehlern gilt der Standard, der Fehler wird mitgeliefert (sichtbar in der App). */
export async function stufenLaden(vault: VaultDienst): Promise<StufenKonfig> {
  try {
    const d = await vault.lesen(MODELLE_PFAD);
    const k = ModelleKopf.parse(matter(d.inhalt).data);
    return { stufen: k.stufen, system: k.system, preise: { ...STANDARD_STUFEN.preise, ...k.preise } };
  } catch (e) {
    return { ...STANDARD_STUFEN, fehler: `${MODELLE_PFAD}: ${fehlerText(e)} – es gilt die Standard-Zuordnung.` };
  }
}

export async function motorenLaden(vault: VaultDienst): Promise<MotorenKonfig> {
  try {
    const d = await vault.lesen(MOTOREN_PFAD);
    const k = MotorenKopf.parse(matter(d.inhalt).data);
    return { alleAuf: k.alle_auf, parallel: k.parallel };
  } catch (e) {
    return { ...STANDARD_MOTOREN, fehler: `${MOTOREN_PFAD}: ${fehlerText(e)} – es gilt der Standard.` };
  }
}

/** Ändert das Frontmatter einer Konfigurationsdatei, der Text darunter bleibt erhalten. */
async function kopfAendern(vault: VaultDienst, pfad: string, aendern: (daten: Record<string, unknown>) => void) {
  const d = await vault.lesen(pfad).catch(() => null);
  const m = d ? matter(d.inhalt) : { data: {}, content: '' };
  const daten = structuredClone(m.data) as Record<string, unknown>;
  aendern(daten);
  const neu = matter.stringify(m.content, daten);
  const r = await vault.schreiben(pfad, neu, { basisVersion: d?.version });
  if (r.konflikt) throw new DorfFehler(409, 'Die Datei wurde gerade woanders geändert. Bitte neu laden.');
}

export async function stufeSetzen(vault: VaultDienst, stufe: Stufe, modell: string, aufwand: Aufwand) {
  if (!STUFEN.includes(stufe)) throw new DorfFehler(400, 'Unbekannte Stufe.');
  ModellId.parse(modell);
  if (!AUFWAND.includes(aufwand)) throw new DorfFehler(400, 'Unbekannter Aufwand.');
  await kopfAendern(vault, MODELLE_PFAD, (d) => {
    const stufen = (d.stufen as Record<string, unknown>) ?? structuredClone(STANDARD_STUFEN.stufen);
    stufen[stufe] = { modell, aufwand };
    d.stufen = stufen;
  });
}

/** `coding` darf fehlen (ältere Oberfläche, Tests): dann bleibt der Wert aus der Datei stehen. */
export async function motorenSetzen(
  vault: VaultDienst,
  k: { alleAuf: MotorenKonfig['alleAuf']; parallel: Omit<MotorenKonfig['parallel'], 'coding'> & { coding?: number } },
) {
  const g = MotorenKopf.parse({ alle_auf: k.alleAuf, parallel: k.parallel });
  await kopfAendern(vault, MOTOREN_PFAD, (d) => {
    const bisher = (d.parallel as { coding?: unknown } | undefined)?.coding;
    d.alle_auf = g.alle_auf;
    d.parallel = { ...g.parallel, coding: k.parallel.coding ?? (typeof bisher === 'number' ? bisher : g.parallel.coding) };
  });
}

/** Geschätzte Kosten in US-Dollar (Cache-Lesen 10 %, Cache-Schreiben 125 % des Eingabepreises). */
export function kostenSchaetzen(
  preise: StufenKonfig['preise'],
  modell: string,
  t: { ein: number; aus: number; cacheLesen: number; cacheSchreiben: number },
) {
  const p = preise[modell];
  if (!p) return 0;
  return (t.ein * p.eingabe + t.aus * p.ausgabe + t.cacheLesen * p.eingabe * 0.1 + t.cacheSchreiben * p.eingabe * 1.25) / 1_000_000;
}
