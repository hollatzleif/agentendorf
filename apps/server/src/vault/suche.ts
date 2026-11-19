import path from 'node:path';
import type { Suchtreffer } from '@dorf/shared';
import type { DB } from '../db.js';
import type { VaultDienst } from './dienst.js';

const TEXT_ENDUNGEN = new Set(['.md', '.txt', '.markdown', '.csv', '.json', '.yaml', '.yml']);
const MAX_INDEX_BYTES = 2 * 1024 * 1024;

function umschreiben(w: string) {
  return w.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss');
}

export function istText(rel: string) {
  return TEXT_ENDUNGEN.has(path.posix.extname(rel).toLowerCase());
}

/** Volltextsuche über den Vault (SQLite FTS5). */
export class Suchindex {
  constructor(
    private db: DB,
    private vault: VaultDienst,
  ) {}

  async vollIndex() {
    const gesehen = new Set<string>();
    const stand = new Map(
      (this.db.prepare('SELECT pfad, mtime, groesse FROM suche_stand').all() as { pfad: string; mtime: number; groesse: number }[]).map(
        (r) => [r.pfad, r],
      ),
    );
    for await (const d of this.vault.alleDateien()) {
      if (!istText(d.rel)) continue;
      gesehen.add(d.rel);
      const alt = stand.get(d.rel);
      if (alt && alt.mtime === Math.floor(d.st.mtimeMs) && alt.groesse === d.st.size) continue;
      await this.aktualisieren(d.rel);
    }
    for (const p of stand.keys()) if (!gesehen.has(p)) this.entfernen(p);
  }

  async aktualisieren(rel: string) {
    if (!istText(rel)) return;
    // E195: nur über den VaultDienst (folgt keinem Symlink) – sonst läse der Index fremde Dateien in die Suche
    const st = await this.vault.stat(rel, { versteckteErlaubt: true }).catch(() => null);
    if (!st || !st.isFile()) return this.entfernen(rel);
    const inhalt = st.size > MAX_INDEX_BYTES ? '' : ((await this.vault.text(rel, { versteckteErlaubt: true, max: MAX_INDEX_BYTES }).catch(() => null)) ?? '');
    const titel = path.posix.basename(rel).replace(/\.[^.]+$/, '');
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM suche WHERE pfad = ?').run(rel);
      this.db.prepare('INSERT INTO suche (pfad, titel, inhalt) VALUES (?, ?, ?)').run(rel, titel, inhalt);
      this.db
        .prepare('INSERT INTO suche_stand (pfad, mtime, groesse) VALUES (?, ?, ?) ON CONFLICT(pfad) DO UPDATE SET mtime = excluded.mtime, groesse = excluded.groesse')
        .run(rel, Math.floor(st.mtimeMs), st.size);
    })();
  }

  entfernen(rel: string) {
    this.db.prepare('DELETE FROM suche WHERE pfad = ? OR pfad LIKE ?').run(rel, `${rel}/%`);
    this.db.prepare('DELETE FROM suche_stand WHERE pfad = ? OR pfad LIKE ?').run(rel, `${rel}/%`);
  }

  suchen(anfrage: string, grenze = 30): Suchtreffer[] {
    const woerter = anfrage
      .split(/\s+/)
      .map((w) => w.replace(/"/g, '').trim())
      .filter(Boolean)
      .slice(0, 10);
    if (!woerter.length) return [];
    // Umlaute in beiden Schreibweisen finden: „Bürgermeister“, „Buergermeister“ und „Burgermeister“.
    const fts = woerter
      .map((w) => {
        const varianten = new Set([w, umschreiben(w), w.replace(/ae/gi, 'a').replace(/oe/gi, 'o').replace(/ue/gi, 'u')]);
        return `(${[...varianten].map((v) => `"${v}"*`).join(' OR ')})`;
      })
      .join(' AND ');
    return this.db
      .prepare(
        `SELECT pfad, titel, snippet(suche, 2, '«', '»', '…', 14) AS ausschnitt
         FROM suche WHERE suche MATCH ? ORDER BY bm25(suche, 0, 5.0, 1.0) LIMIT ?`,
      )
      .all(fts, grenze) as Suchtreffer[];
  }
}
