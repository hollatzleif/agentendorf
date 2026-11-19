import type { DB } from './db.js';
import type { VaultDienst } from './vault/dienst.js';
import type { GmailKlient } from './post/gmail.js';
import { DorfFehler } from './fehler.js';

/**
 * Adressbuch (E185): Rathaus/kontakte.md – eine Zeile je Kontakt („- Name <adresse> · Rolle“), von Leif in Obsidian
 * pflegbar. Gesucht wird außerdem in den Absendern des Posteingangs (post_mails) und in Leifs gesendeten Mails.
 * So findet ein Agent die Adresse selbst, statt Leif zu fragen – und merkt sich, was er gefunden hat.
 */
export const KONTAKTE_PFAD = 'Rathaus/kontakte.md';
const KOPF = `---\ntitel: Kontakte\n---\n\n# Kontakte\n\nEine Zeile je Kontakt: \`- Name <adresse> · Rolle\`. Die Agenten suchen hier zuerst und tragen gefundene Adressen selbst ein.\n\n`;
const ADRESSE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export interface Kontakt {
  name: string;
  adresse: string;
  rolle?: string;
  quelle: 'Adressbuch' | 'Posteingang' | 'Gesendet';
}

/** „Name <a@b>“ oder „a@b“ → Name + Adresse (nur schlichte, gültige Adressen) */
export function adresseZerlegen(roh: string): { name: string; adresse: string } | null {
  const m = /^\s*"?([^"<]*?)"?\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(roh) ?? /^\s*()([^<>\s,;]+@[^<>\s,;]+)\s*$/.exec(roh);
  if (!m || !ADRESSE.test(m[2]!)) return null;
  return { name: sauber(m[1] ?? ''), adresse: m[2]!.toLowerCase() };
}
const sauber = (t: string) => t.replace(/[\r\n<>·|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
const passt = (text: string, woerter: string[]) => woerter.every((w) => text.toLowerCase().includes(w));

export class Kontakte {
  constructor(private o: { db: DB; vault: VaultDienst; post?: () => GmailKlient | undefined }) {}

  async adressbuch(): Promise<Kontakt[]> {
    const text = (await this.o.vault.lesen(KONTAKTE_PFAD).catch(() => null))?.inhalt ?? '';
    const aus: Kontakt[] = [];
    for (const z of text.split('\n')) {
      const m = /^\s*[-*]\s+(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*(?:·\s*(.*))?$/.exec(z);
      if (m && ADRESSE.test(m[2]!)) aus.push({ name: sauber(m[1]!), adresse: m[2]!.toLowerCase(), ...(m[3]?.trim() ? { rolle: sauber(m[3]) } : {}), quelle: 'Adressbuch' });
    }
    return aus;
  }

  /** Adressbuch → Absender im Posteingang → Empfänger gesendeter Mails; jede Adresse nur einmal */
  async suchen(name: string): Promise<Kontakt[]> {
    const woerter = name.toLowerCase().split(/\s+/).filter((w) => w.length >= 2).slice(0, 5);
    if (!woerter.length) throw new DorfFehler(400, 'Name fehlt (mindestens zwei Buchstaben).');
    const aus = new Map<string, Kontakt>();
    const dazu = (k: Kontakt) => {
      if (!aus.has(k.adresse)) aus.set(k.adresse, k);
    };
    for (const k of await this.adressbuch()) if (passt(`${k.name} ${k.adresse} ${k.rolle ?? ''}`, woerter)) dazu(k);
    const absender = this.o.db.prepare('SELECT von, MAX(datum) AS d FROM post_mails GROUP BY von ORDER BY d DESC LIMIT 5000').all() as { von: string }[];
    for (const a of absender) {
      if (!passt(a.von, woerter)) continue;
      const k = adresseZerlegen(a.von);
      if (k) dazu({ ...k, quelle: 'Posteingang' });
    }
    const gmail = this.o.post?.();
    if (gmail && aus.size < 5) {
      try {
        // nur Buchstaben/Ziffern in die Gmail-Suche – keine Suchoperatoren aus dem Namen
        const q = woerter.map((w) => w.replace(/[^\p{L}\p{N}.@-]/gu, '')).filter(Boolean);
        for (const id of q.length ? await gmail.liste(`in:sent to:(${q.join(' ')})`, 5) : []) {
          const m = await gmail.nachricht(id);
          for (const teil of m.an.split(',')) {
            const k = adresseZerlegen(teil);
            if (k && passt(teil, woerter)) dazu({ ...k, quelle: 'Gesendet' });
          }
        }
      } catch {
        // Gmail gerade nicht erreichbar – Adressbuch und Posteingang reichen
      }
    }
    return [...aus.values()].slice(0, 10);
  }

  /** Trägt einen Kontakt ein (oder ergänzt die Rolle); gleiche Adresse nie doppelt */
  async merken(roh: { name: string; adresse: string; rolle?: string }): Promise<{ neu: boolean; kontakt: Kontakt }> {
    const adresse = roh.adresse.trim().toLowerCase();
    if (!ADRESSE.test(adresse)) throw new DorfFehler(400, 'Das ist keine gültige Mail-Adresse.');
    const name = sauber(roh.name);
    if (!name) throw new DorfFehler(400, 'Name fehlt.');
    const rolle = roh.rolle ? sauber(roh.rolle) : '';
    const kontakt: Kontakt = { name, adresse, ...(rolle ? { rolle } : {}), quelle: 'Adressbuch' };
    const d = await this.o.vault.lesen(KONTAKTE_PFAD).catch(() => null);
    if ((await this.adressbuch()).some((k) => k.adresse === adresse)) return { neu: false, kontakt };
    const text = d?.inhalt ?? KOPF;
    await this.o.vault.schreiben(KONTAKTE_PFAD, `${text.replace(/\n*$/, '\n')}- ${name} <${adresse}>${rolle ? ` · ${rolle}` : ''}\n`);
    return { neu: true, kontakt };
  }
}

export const kontaktZeile = (k: Kontakt) => `${k.name || '(ohne Name)'} <${k.adresse}>${k.rolle ? ` · ${k.rolle}` : ''} (${k.quelle})`;
