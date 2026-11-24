import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BUCHSTABEN, KARTEN, NAVIGATIONEN, DUNKEL_AUTO, ANIMATIONEN, AUSSEHEN_STANDARD, BREITEN, DICHTEN, FARB_ROLLEN, FOKUS_RINGE, HINTERGRUENDE, KNOEPFE, RAHMEN, SCHATTEN, SCHRIFTEN, STARTSEITEN, TABELLEN, TITEL_GEWICHTE, VORLAGEN, type AussehenT } from '@dorf/shared';
import type { DB } from './db.js';
import type { LiveHub } from './live.js';
import { DorfFehler } from './fehler.js';

/**
 * E224 – Aussehen der App (Einstellungen → Aussehen): auf dem Server gespeichert (dorf_stand 'aussehen'), damit es auf
 * allen Geräten gleich ist; Live-Ereignis an alle Geräte. Eigenes CSS ist erlaubt (Leifs eigene App, nur über seine
 * Sitzung) – aber ohne @import und url(), damit nichts von außen nachgeladen wird.
 */
const Farbe = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Farbe als #rrggbb');
export const AussehenSchema = z
  .object({
    version: z.literal(1),
    vorlage: z.enum(VORLAGEN),
    farben: z.partialRecord(z.enum(FARB_ROLLEN), Farbe),
    schrift: z.enum(SCHRIFTEN),
    schriftTitel: z.enum(['wie-text', ...SCHRIFTEN]),
    groesse: z.number().min(12).max(24),
    zeilenhoehe: z.number().min(1.2).max(2),
    titelGewicht: z.enum(TITEL_GEWICHTE),
    dichte: z.enum(DICHTEN),
    ecken: z.number().min(0).max(28),
    schatten: z.enum(SCHATTEN),
    rahmen: z.enum(RAHMEN),
    knoepfe: z.enum(KNOEPFE),
    hintergrund: z.enum(HINTERGRUENDE),
    breite: z.enum(BREITEN),
    animationen: z.enum(ANIMATIONEN),
    tabellen: z.enum(TABELLEN),
    kopfleiste: z.enum(['mitlaufend', 'fest']),
    symbole: z.enum(['an', 'aus']),
    fokusRing: z.enum(FOKUS_RINGE),
    startseite: z.enum(STARTSEITEN),
    dunkelAuto: z.enum(DUNKEL_AUTO),
    dunkelVorlage: z.enum(VORLAGEN),
    navigation: z.enum(NAVIGATIONEN),
    buchstaben: z.enum(BUCHSTABEN),
    karten: z.enum(KARTEN),
    css: z
      .string()
      .max(20_000)
      .refine((c) => !/@import|url\s*\(|expression\s*\(|<\/?style/i.test(c), 'Eigenes CSS ohne @import und url(…) – es soll nichts von außen laden'),
  })
  .strict();

export function aussehenLesen(db: DB): AussehenT {
  const z2 = db.prepare("SELECT wert FROM dorf_stand WHERE schluessel = 'aussehen'").get() as { wert: string } | undefined;
  if (!z2) return AUSSEHEN_STANDARD;
  // gespeicherte Fassung mit Standardwerten auffüllen (neue Felder) – Kaputtes → Standard
  const r = AussehenSchema.safeParse({ ...AUSSEHEN_STANDARD, ...(JSON.parse(z2.wert) as object) });
  return r.success ? (r.data as AussehenT) : AUSSEHEN_STANDARD;
}

export function aussehenRouten(app: FastifyInstance, a: { db: DB; hub: LiveHub }) {
  app.get('/api/aussehen', async () => aussehenLesen(a.db));
  app.put('/api/aussehen', { bodyLimit: 64 * 1024 }, async (req) => {
    const r = AussehenSchema.safeParse({ ...AUSSEHEN_STANDARD, ...(req.body as object) });
    if (!r.success) throw new DorfFehler(400, `Aussehen ungültig: ${r.error.issues[0]?.path.join('.')}: ${r.error.issues[0]?.message ?? ''}`);
    a.db.prepare("INSERT OR REPLACE INTO dorf_stand (schluessel, wert) VALUES ('aussehen', ?)").run(JSON.stringify(r.data));
    a.hub.senden({ typ: 'aussehen.geaendert' });
    return r.data;
  });
}
