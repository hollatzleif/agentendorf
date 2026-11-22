import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DorfFehler } from './fehler.js';
import type { VaultDienst } from './vault/dienst.js';

/**
 * E216 – Schriftprobe: Leifs echte Stiftstriche je Zeichen (mehrere Varianten), aufgenommen in der App
 * (/schriftprobe). handschrift_schreiben schreibt damit in SEINER Hand (Rechenraum, handformel.py).
 *
 * Format (Atelier/schriftprobe.json): { version: 1, zeichen: { "a": [Variante, …] } }
 *   Variante = [Strich, …], Strich = [[x, y, t, druck], …]
 *   x, y in Versalhöhen-Einheiten: Grundlinie y = 0, Versalhöhe y = -1, y nach unten; t in ms ab Beginn der Variante;
 *   druck 0..1 (0,5 ohne Stift). Die App rechnet aus Kästchen mit Hilfslinien um.
 */
export const PROBE_PFAD = 'Atelier/schriftprobe.json';
export const PROBE_MAX_PUNKTE = 300_000;

const Zahl = z.number().finite();
const Punkt = z
  .tuple([Zahl.min(-5).max(5), Zahl.min(-5).max(5)])
  .rest(Zahl)
  .refine((p) => p.length <= 4, 'höchstens x, y, t, druck')
  .refine((p) => p[2] === undefined || (p[2] >= 0 && p[2] <= 600_000), 'Zeit 0 bis 600000 ms')
  .refine((p) => p[3] === undefined || (p[3] >= 0 && p[3] <= 1), 'Druck 0 bis 1');
const Strich = z.array(Punkt).min(1).max(4000);
const Variante = z.array(Strich).min(1).max(40);
export const Probe = z
  .object({
    version: z.literal(1),
    zeichen: z.record(
      z.string().refine((k) => Array.from(k).length === 1, 'ein Zeichen je Eintrag'),
      z.array(Variante).min(1).max(8),
    ),
  })
  .strict()
  .refine((p) => Object.keys(p.zeichen).length <= 200, 'höchstens 200 Zeichen')
  .refine(
    (p) => Object.values(p.zeichen).reduce((n, vs) => n + vs.reduce((m, v) => m + v.reduce((k, s) => k + s.length, 0), 0), 0) <= PROBE_MAX_PUNKTE,
    `höchstens ${PROBE_MAX_PUNKTE} Punkte`,
  );
export type ProbeDaten = z.infer<typeof Probe>;

/** Die gespeicherte Schriftprobe – oder null, wenn es keine (gültige, nicht leere) gibt. */
export async function probeLesen(vault: VaultDienst): Promise<ProbeDaten | null> {
  const st = await vault.stat(PROBE_PFAD).catch(() => null);
  if (!st?.isFile()) return null;
  const d = await vault.puffer(PROBE_PFAD, { max: 20 * 1024 * 1024 }).catch(() => null);
  if (!d) return null;
  try {
    const p = Probe.parse(JSON.parse(d.inhalt.toString('utf8')));
    return Object.keys(p.zeichen).length ? p : null;
  } catch {
    return null;
  }
}

/** Kleiner speichern: x/y auf 1/1000 Versalhöhe, t auf ms, Druck auf 1/100. */
export function probeRunden(p: ProbeDaten): ProbeDaten {
  const r = (v: number, f: number) => Math.round(v * f) / f;
  const zeichen: ProbeDaten['zeichen'] = {};
  for (const [k, vs] of Object.entries(p.zeichen))
    zeichen[k] = vs.map((v) => v.map((s) => s.map((pt) => pt.map((w, i) => r(w, i < 2 ? 1000 : i === 2 ? 1 : 100)) as typeof pt)));
  return { version: 1, zeichen };
}

export function schriftprobeRouten(app: FastifyInstance, a: { vault: VaultDienst }) {
  app.get('/api/atelier/schriftprobe', async (req) => {
    const p = await probeLesen(a.vault);
    // ?kurz=1: nur wie viele Varianten je Zeichen (Atelier-Übersicht)
    if ((req.query as { kurz?: string }).kurz === '1')
      return { vorhanden: !!p, anzahl: Object.fromEntries(Object.entries(p?.zeichen ?? {}).map(([k, v]) => [k, v.length])) };
    return { vorhanden: !!p, probe: p };
  });
  // Speichern (die App schickt immer die ganze Probe – Zeichen löschen = weglassen)
  app.put('/api/atelier/schriftprobe', { bodyLimit: 12 * 1024 * 1024 }, async (req) => {
    const r = Probe.safeParse(req.body);
    if (!r.success) throw new DorfFehler(400, `Schriftprobe ungültig: ${r.error.issues[0]?.message ?? 'Format'}`);
    const erg = await a.vault.schreiben(PROBE_PFAD, JSON.stringify(probeRunden(r.data)));
    return { ok: true, zeichen: Object.keys(r.data.zeichen).length, version: erg.version };
  });
}
