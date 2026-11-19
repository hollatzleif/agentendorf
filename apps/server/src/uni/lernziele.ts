import matter from 'gray-matter';
import { z } from 'zod';
import type { VaultDienst } from '../vault/dienst.js';
import type { LiveHub } from '../live.js';
import { DorfFehler } from '../fehler.js';

/**
 * E137: Lernziel je Fach pro Woche (Stunden) in `Uni/lernziele.md` – Frontmatter `ziele: { "Mathe III": 6 }`,
 * in Obsidian lesbar und änderbar. Gemessen wird die Fokuszeit (Pomodoro mit Fach) der laufenden Woche ab Montag.
 * Eigener Text unter dem Frontmatter und weitere Felder bleiben stehen.
 */
export const LERNZIELE_PFAD = 'Uni/lernziele.md';
const Ziele = z.record(z.string().trim().min(1).max(120), z.number().min(0).max(80));

export class Lernziele {
  private schreibKette: Promise<unknown> = Promise.resolve();
  constructor(private o: { vault: VaultDienst; hub: LiveHub }) {}

  /** Fach → Stunden je Woche; eine kaputte Datei gilt als „keine Ziele“ (sie wird nicht überschrieben, siehe setzen) */
  async lesen(): Promise<Record<string, number>> {
    const d = await this.o.vault.lesen(LERNZIELE_PFAD).catch(() => null);
    if (!d) return {};
    try {
      const r = Ziele.safeParse((matter(d.inhalt).data as { ziele?: unknown }).ziele ?? {});
      return r.success ? r.data : {};
    } catch {
      return {};
    }
  }

  /** stunden 0 = Ziel entfernen; `auch` = weitere Namen desselben Fachs (Ordner-/Anzeigename), die ersetzt werden (Review) */
  setzen(fachRoh: string, stunden: number, auch: string[] = []) {
    const fach = fachRoh.trim().slice(0, 120);
    if (!fach) throw new DorfFehler(400, 'Fach fehlt.');
    if (!(stunden >= 0 && stunden <= 80)) throw new DorfFehler(400, 'Stunden zwischen 0 und 80.');
    const lauf = this.schreibKette.then(async () => {
      const d = await this.o.vault.lesen(LERNZIELE_PFAD).catch(() => null);
      let m: { data: Record<string, unknown>; content: string };
      try {
        m = d ? (matter(d.inhalt) as unknown as { data: Record<string, unknown>; content: string }) : { data: {}, content: '\n# Lernziele je Woche\n\nStunden Fokus (Pomodoro mit Fach) pro Woche. In der App unter Uni → Studium änderbar.\n' };
      } catch {
        throw new DorfFehler(409, 'Uni/lernziele.md lässt sich nicht lesen – bitte in Obsidian prüfen.');
      }
      const alt = Ziele.safeParse(m.data.ziele ?? {});
      if (!alt.success) throw new DorfFehler(409, 'In Uni/lernziele.md stimmt das Feld „ziele“ nicht – bitte in Obsidian prüfen.');
      const ziele = { ...alt.data };
      for (const n of auch) if (n.trim() !== fach) delete ziele[n.trim()];
      if (stunden) ziele[fach] = Math.round(stunden * 2) / 2;
      else delete ziele[fach];
      const r = await this.o.vault.schreiben(LERNZIELE_PFAD, matter.stringify(m.content, { ...m.data, ziele }), d ? { basisVersion: d.version } : { nurNeu: true });
      if (r.konflikt) throw new DorfFehler(409, 'Uni/lernziele.md wurde gerade woanders geändert – bitte neu laden.');
      this.o.hub.senden({ typ: 'uni.geaendert' });
      return ziele;
    });
    this.schreibKette = lauf.catch(() => undefined);
    return lauf;
  }
}
