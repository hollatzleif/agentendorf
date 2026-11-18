import matter from 'gray-matter';
import { z } from 'zod';
import type { CorpsUebersicht } from '@dorf/shared';
import type { Uhr } from './uhr.js';
import type { VaultDienst } from './vault/dienst.js';
import type { Terminkalender } from './kalender.js';

/**
 * Corpshaus (Etappe 7): Corps-Termine aus dem Hauptkalender (erkannt an Stichworten im Titel), Corps-Mails
 * (Postbote: KI-Kategorie „Corps“ + Absenderliste, die immer Corps ist). Einstellungen in Corpshaus/einstellungen.md.
 */
export const CORPS_EINSTELLUNGEN = 'Corpshaus/einstellungen.md';

const Einstellungen = z.object({
  /** Absender (ganze Adresse oder Teil wie „@corps-beispiel.de“), deren Mails immer „Corps“ sind */
  absender: z.array(z.string().trim().min(3)).default([]),
  /** Stichworte im Kalender-Titel, an denen Corps-Termine erkannt werden */
  stichworte: z.array(z.string().trim().min(2)).default([]),
});
export type CorpsEinstellungen = z.infer<typeof Einstellungen>;

export class Corps {
  constructor(private o: { vault: VaultDienst; uhr: Uhr; kalender: Terminkalender }) {}

  async einstellungen(): Promise<{ e: CorpsEinstellungen; fehler?: string }> {
    const d = await this.o.vault.lesen(CORPS_EINSTELLUNGEN).catch(() => null);
    if (!d) return { e: Einstellungen.parse({}) };
    try {
      return { e: Einstellungen.parse(matter(d.inhalt).data) };
    } catch (err) {
      const f = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : String(err);
      return { e: Einstellungen.parse({}), fehler: `Corpshaus/einstellungen.md ist fehlerhaft: ${f}` };
    }
  }

  /** Für den Postboten: Mails dieser Absender sind immer Corps */
  async istCorpsAbsender(von: string) {
    const { e } = await this.einstellungen();
    const v = von.toLowerCase();
    return e.absender.some((a) => v.includes(a.toLowerCase()));
  }

  async uebersicht(tage = 45): Promise<CorpsUebersicht> {
    const { e, fehler } = await this.einstellungen();
    const jetzt = this.o.uhr.jetzt();
    let termine: CorpsUebersicht['termine'] = [];
    let kalenderFehler: string | undefined;
    if (e.stichworte.length && this.o.kalender.eingerichtet) {
      try {
        const st = e.stichworte.map((s) => s.toLowerCase());
        termine = (await this.o.kalender.termine(jetzt - 86_400_000, jetzt + tage * 86_400_000))
          .filter((t) => t.start && st.some((s) => t.titel.toLowerCase().includes(s)))
          .sort((a, b) => a.start! - b.start!)
          .slice(0, 40)
          .map((t) => ({ start: new Date(t.start!).toISOString(), ende: t.ende ? new Date(t.ende).toISOString() : undefined, ganztags: t.ganztags, titel: t.titel.slice(0, 200) }));
      } catch (err) {
        kalenderFehler = `Kalender nicht lesbar: ${(err as Error).message}`;
      }
    }
    return {
      termine,
      stichworte: e.stichworte,
      absender: e.absender,
      kalenderEingerichtet: this.o.kalender.eingerichtet,
      ...(fehler || kalenderFehler ? { fehler: [fehler, kalenderFehler].filter(Boolean).join(' · ') } : {}),
    };
  }
}
