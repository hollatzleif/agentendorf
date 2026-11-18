import crypto from 'node:crypto';
import type { Readable } from 'node:stream';
import matter from 'gray-matter';
import type { SchreibtischAufgabe, SchreibtischStatus } from '@dorf/shared';
import type { DB } from './db.js';
import type { Uhr } from './uhr.js';
import type { VaultDienst } from './vault/dienst.js';
import type { LiveHub } from './live.js';
import { DorfFehler } from './fehler.js';
import { dateiStempel, kurztitel } from './agenten/hilfen.js';

export const SCHREIBTISCH = 'Rathaus/schreibtisch';
const NOTIZ = /^Rathaus\/schreibtisch\/[^/]+\.md$/;

interface Zeile {
  id: string;
  pfad: string;
  titel: string;
  quelle: SchreibtischAufgabe['quelle'];
  status: SchreibtischStatus;
  chat_id: string | null;
  erstellt: number;
}

/**
 * Schreibtisch des Bürgermeisters: Aufgaben sind Notizen in Rathaus/schreibtisch/.
 * Die Datenbank führt Status und Verknüpfungen, das Frontmatter der Notiz spiegelt den Status für Obsidian.
 */
export class Schreibtisch {
  constructor(
    private db: DB,
    private uhr: Uhr,
    private vault: VaultDienst,
    private hub: LiveHub,
  ) {}

  static istAufgabe(rel: string) {
    return NOTIZ.test(rel);
  }

  /** Speichert einen Anhang unter Rathaus/schreibtisch/anhaenge/<zeit>/ und gibt den Pfad zurück. */
  async anhangSpeichern(dateiname: string, strom: Readable) {
    return this.vault.hochladen(`${SCHREIBTISCH}/anhaenge/${dateiStempel(this.uhr.jetzt())}`, dateiname, strom);
  }

  async anlegen(a: { text: string; quelle: 'app' | 'telegram' | 'aufwachen'; fremd?: boolean; anhaenge?: string[] }): Promise<SchreibtischAufgabe> {
    const text = a.text.trim();
    const anhaenge = a.anhaenge ?? [];
    if (!text && !anhaenge.length) throw new DorfFehler(400, 'Die Aufgabe ist leer.');
    if (text.length > 100_000) throw new DorfFehler(400, 'Die Aufgabe ist zu lang.');
    const titel = (text.split('\n')[0] || (anhaenge[0] ? `Datei ${anhaenge[0].split('/').pop()}` : 'Aufgabe')).slice(0, 80);
    const jetzt = this.uhr.jetzt();
    const id = crypto.randomUUID();
    // Rundgänge und Lageberichte (von selbst) in einen Unterordner – Leifs Schreibtisch in Obsidian bleibt übersichtlich
    const ordner = a.quelle === 'aufwachen' ? `${SCHREIBTISCH}/aufwachen` : SCHREIBTISCH;
    let pfad = `${ordner}/${dateiStempel(jetzt)}_${kurztitel(titel)}.md`;
    for (let i = 2; (await this.vault.existiert(pfad)) || this.db.prepare('SELECT 1 FROM schreibtisch WHERE pfad = ?').get(pfad); i++)
      pfad = `${ordner}/${dateiStempel(jetzt)}_${kurztitel(titel)}-${i}.md`;
    // Erst die Zeile, dann die Datei – der Dateiwächter erkennt die Notiz so als schon bekannt.
    this.db
      .prepare('INSERT INTO schreibtisch (id, pfad, titel, quelle, status, erstellt, geaendert) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, pfad, titel, a.quelle, 'neu', jetzt, jetzt);
    const kopf: Record<string, unknown> = { titel, erstellt: new Date(jetzt).toISOString(), quelle: a.quelle, status: 'neu' };
    if (a.fremd) kopf.fremdinhalt = true;
    const rumpf = `${text}\n${anhaenge.length ? `\n## Anhänge\n${anhaenge.map((p) => `- [[${p}]]`).join('\n')}\n` : ''}`;
    await this.vault.schreiben(pfad, matter.stringify(rumpf, kopf), { nurNeu: true });
    this.hub.senden({ typ: 'schreibtisch.geaendert' });
    return this.holen(id);
  }

  /** Notizen, die über Obsidian oder von Agenten auf dem Schreibtisch landen: nur aufnehmen, nicht starten. */
  async vaultAufnehmen(rel: string) {
    if (!Schreibtisch.istAufgabe(rel)) return null;
    if (this.db.prepare('SELECT 1 FROM schreibtisch WHERE pfad = ?').get(rel)) return null;
    const d = await this.vault.lesen(rel).catch(() => null);
    if (!d) return null;
    const kopf = matter(d.inhalt).data as { titel?: string; status?: string };
    if (kopf.status && kopf.status !== 'neu' && kopf.status !== 'offen') return null; // schon bearbeitete Notizen nicht erneut aufnehmen
    const id = crypto.randomUUID();
    const jetzt = this.uhr.jetzt();
    const titel = String(kopf.titel ?? rel.split('/').pop()!.replace(/\.md$/, '')).slice(0, 80);
    // OR IGNORE: Dateiwächter und Abgleich können gleichzeitig dieselbe Notiz melden
    const r = this.db
      .prepare('INSERT OR IGNORE INTO schreibtisch (id, pfad, titel, quelle, status, erstellt, geaendert) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, rel, titel, 'vault', 'neu', jetzt, jetzt);
    if (r.changes !== 1) return null;
    this.hub.senden({ typ: 'schreibtisch.geaendert' });
    return id;
  }

  /** Beim Start: alle Notizen auf dem Schreibtisch aufnehmen, die noch nicht bekannt sind. */
  async abgleichen() {
    const b = await this.vault.baum(SCHREIBTISCH, 1).catch(() => null);
    for (const k of b?.kinder ?? []) if (k.art === 'datei') await this.vaultAufnehmen(k.pfad);
  }

  async statusSetzen(id: string, status: SchreibtischStatus, chatId?: string) {
    const z = this.zeile(id);
    this.db
      .prepare('UPDATE schreibtisch SET status = ?, chat_id = COALESCE(?, chat_id), geaendert = ? WHERE id = ?')
      .run(status, chatId ?? null, this.uhr.jetzt(), id);
    // Status im Frontmatter der Notiz spiegeln (Konfliktkopie, falls Leif sie gerade bearbeitet)
    const d = await this.vault.lesen(z.pfad).catch(() => null);
    if (d) {
      const m = matter(d.inhalt);
      if (m.data.status !== status) {
        m.data.status = status;
        await this.vault.schreiben(z.pfad, matter.stringify(m.content, m.data), { basisVersion: d.version }).catch(() => undefined);
      }
    }
    this.hub.senden({ typ: 'schreibtisch.geaendert' });
  }

  perPfad(pfad: string): SchreibtischAufgabe | undefined {
    const z = this.db.prepare('SELECT * FROM schreibtisch WHERE pfad = ?').get(pfad) as Zeile | undefined;
    return z ? this.info(z) : undefined;
  }

  private zeile(id: string) {
    const z = this.db.prepare('SELECT * FROM schreibtisch WHERE id = ?').get(id) as Zeile | undefined;
    if (!z) throw new DorfFehler(404, 'Aufgabe nicht gefunden.');
    return z;
  }

  holen(id: string): SchreibtischAufgabe {
    const z = this.zeile(id);
    return this.info(z);
  }

  private info(z: Zeile): SchreibtischAufgabe {
    const plan = this.db.prepare('SELECT id FROM plaene WHERE schreibtisch_id = ? ORDER BY erstellt DESC LIMIT 1').get(z.id) as { id: string } | undefined;
    return {
      id: z.id,
      pfad: z.pfad,
      titel: z.titel,
      quelle: z.quelle,
      status: z.status,
      chatId: z.chat_id ?? undefined,
      planId: plan?.id,
      erstellt: new Date(z.erstellt).toISOString(),
    };
  }

  liste(): SchreibtischAufgabe[] {
    return (this.db.prepare('SELECT * FROM schreibtisch ORDER BY erstellt DESC LIMIT 200').all() as Zeile[]).map((z) => this.info(z));
  }

  /** Inhalt der Notiz ohne Frontmatter; fremd = weitergeleitete/fremde Inhalte */
  async inhalt(id: string) {
    const z = this.zeile(id);
    const d = await this.vault.lesen(z.pfad);
    const m = matter(d.inhalt);
    return { pfad: z.pfad, text: m.content.trim(), fremd: m.data.fremdinhalt === true || m.data.fremdinhalt === 'ja', anhaenge: [...m.content.matchAll(/\[\[([^\]|]+)\]\]/g)].map((x) => x[1]!) };
  }
}
