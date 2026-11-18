import matter from 'gray-matter';
import { z } from 'zod';
import type { GewohnheitStand } from '@dorf/shared';
import type { DB } from './db.js';
import type { Uhr } from './uhr.js';
import type { VaultDienst } from './vault/dienst.js';
import type { LiveHub } from './live.js';
import { DorfFehler } from './fehler.js';

/**
 * Gewohnheiten (Nacht 18./19.11.): Leif legt fest, was er regelmäßig tun will (täglich, werktags, an bestimmten
 * Tagen). Die Liste steht in `Marktplatz/gewohnheiten.md` (Obsidian-freundlich), die Häkchen in der DB.
 * Serie = wie viele fällige Tage in Folge erledigt (Tage, an denen nichts fällig ist, unterbrechen nicht).
 */
export const GEWOHNHEITEN_PFAD = 'Marktplatz/gewohnheiten.md';
const TAGE = ['so', 'mo', 'di', 'mi', 'do', 'fr', 'sa'] as const;

const Gewohnheit = z.object({
  name: z.string().trim().min(1).max(60),
  symbol: z.string().trim().max(8).default('✅'),
  /** täglich | werktags | wochenende | Liste wie [mo, mi, fr] */
  tage: z.union([z.enum(['täglich', 'werktags', 'wochenende']), z.array(z.enum(TAGE)).min(1)]).default('täglich'),
});
type GewohnheitT = z.infer<typeof Gewohnheit>;
const Datei = z.object({ gewohnheiten: z.array(Gewohnheit).max(30).default([]) });

const tagIn = (ms: number) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
const wochentag = (tag: string) => new Date(`${tag}T12:00:00Z`).getUTCDay();
const tagPlus = (tag: string, n: number) => {
  const d = new Date(`${tag}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function faelligAm(g: Pick<GewohnheitT, 'tage'>, tag: string) {
  const wt = wochentag(tag);
  if (g.tage === 'täglich') return true;
  if (g.tage === 'werktags') return wt >= 1 && wt <= 5;
  if (g.tage === 'wochenende') return wt === 0 || wt === 6;
  return g.tage.includes(TAGE[wt]!);
}

export class Gewohnheiten {
  constructor(private o: { db: DB; uhr: Uhr; vault: VaultDienst; hub: LiveHub }) {}

  async liste(): Promise<{ gewohnheiten: GewohnheitT[]; version?: string; fehler?: string }> {
    const d = await this.o.vault.lesen(GEWOHNHEITEN_PFAD).catch(() => null);
    if (!d) return { gewohnheiten: [] };
    try {
      return { gewohnheiten: Datei.parse(matter(d.inhalt).data).gewohnheiten, version: d.version };
    } catch (e) {
      return { gewohnheiten: [], version: d.version, fehler: `${GEWOHNHEITEN_PFAD} ist fehlerhaft: ${e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : String(e)}` };
    }
  }

  private async schreiben(neu: GewohnheitT[]) {
    const d = await this.o.vault.lesen(GEWOHNHEITEN_PFAD).catch(() => null);
    const m = d ? matter(d.inhalt) : { data: {}, content: '\n# Gewohnheiten\n\nPflegst du hier oder in der App („Heute“). `tage`: täglich, werktags, wochenende oder eine Liste wie [mo, mi, fr].\n' };
    const r = await this.o.vault.schreiben(GEWOHNHEITEN_PFAD, matter.stringify(m.content, { ...(m.data as object), gewohnheiten: neu }), d ? { basisVersion: d.version } : { nurNeu: true });
    if (r.konflikt) throw new DorfFehler(409, 'gewohnheiten.md wurde gerade woanders geändert – bitte neu laden.');
    this.o.hub.senden({ typ: 'todos.geaendert', liste: 'gewohnheiten' });
  }

  async anlegen(roh: unknown) {
    const g = Gewohnheit.parse(roh);
    const l = await this.liste();
    if (l.fehler) throw new DorfFehler(409, l.fehler);
    if (l.gewohnheiten.some((x) => x.name.toLowerCase() === g.name.toLowerCase())) throw new DorfFehler(409, 'Diese Gewohnheit gibt es schon.');
    await this.schreiben([...l.gewohnheiten, g]);
  }

  async entfernen(name: string) {
    const l = await this.liste();
    if (!l.gewohnheiten.some((x) => x.name === name)) throw new DorfFehler(404, 'Diese Gewohnheit gibt es nicht.');
    await this.schreiben(l.gewohnheiten.filter((x) => x.name !== name));
  }

  async haken(name: string, erledigt: boolean, tag = tagIn(this.o.uhr.jetzt())) {
    if (!(await this.liste()).gewohnheiten.some((x) => x.name === name)) throw new DorfFehler(404, 'Diese Gewohnheit gibt es nicht.');
    if (tag > tagIn(this.o.uhr.jetzt())) throw new DorfFehler(400, 'Nur heute oder früher abhaken.');
    if (erledigt) this.o.db.prepare('INSERT OR IGNORE INTO gewohnheit_log (name, tag) VALUES (?, ?)').run(name, tag);
    else this.o.db.prepare('DELETE FROM gewohnheit_log WHERE name = ? AND tag = ?').run(name, tag);
    this.o.hub.senden({ typ: 'todos.geaendert', liste: 'gewohnheiten' });
  }

  async stand(): Promise<{ gewohnheiten: GewohnheitStand[]; fehler?: string }> {
    const l = await this.liste();
    const heute = tagIn(this.o.uhr.jetzt());
    const aus: GewohnheitStand[] = [];
    for (const g of l.gewohnheiten) {
      const tage = new Set((this.o.db.prepare('SELECT tag FROM gewohnheit_log WHERE name = ? AND tag > ?').all(g.name, tagPlus(heute, -400)) as { tag: string }[]).map((x) => x.tag));
      let serie = 0;
      // heute zählt mit, wenn erledigt – sonst ab gestern
      for (let i = tage.has(heute) ? 0 : 1, n = 0; n < 400; i++, n++) {
        const t = tagPlus(heute, -i);
        if (!faelligAm(g, t)) continue;
        if (!tage.has(t)) break;
        serie++;
      }
      const woche = Array.from({ length: 7 }, (_, i) => {
        const t = tagPlus(heute, i - 6);
        return { tag: t, faellig: faelligAm(g, t), erledigt: tage.has(t) };
      });
      aus.push({ name: g.name, symbol: g.symbol, tage: g.tage, heuteFaellig: faelligAm(g, heute), heuteErledigt: tage.has(heute), serie, woche });
    }
    return { gewohnheiten: aus, ...(l.fehler ? { fehler: l.fehler } : {}) };
  }

  /** Wochenrückblick: „Sport 3/3, Lesen 5/7“ */
  async wochenZeile(): Promise<string | null> {
    const s = await this.stand();
    if (!s.gewohnheiten.length) return null;
    return s.gewohnheiten
      .map((g) => {
        const f = g.woche.filter((t) => t.faellig);
        return `${g.symbol} ${g.name} ${f.filter((t) => t.erledigt).length}/${f.length}${g.serie > 2 ? ` (🔥 ${g.serie})` : ''}`;
      })
      .join(' · ');
  }
}
