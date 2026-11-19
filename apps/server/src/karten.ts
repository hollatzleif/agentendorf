import crypto from 'node:crypto';
import type { KarteFaellig, KartenFach } from '@dorf/shared';
import type { DB } from './db.js';
import type { Uhr } from './uhr.js';
import type { VaultDienst } from './vault/dienst.js';
import type { LiveHub } from './live.js';
import { DorfFehler } from './fehler.js';

/**
 * Karteikarten (Nacht 18./19.11.): je Fach eine Datei `Uni/faecher/<Fach>/karten.md` (Obsidian-freundlich).
 * Zwei Schreibweisen:
 *   Frage :: Antwort                        (eine Zeile)
 *   ### Frage                               (Überschrift)
 *   Antwort über mehrere Zeilen …           (bis zur nächsten Überschrift)
 * Der Lernstand (wann wieder fällig) liegt in der DB, Schlüssel = Fach + Frage – die Antwort darf sich ändern.
 * Wiederholung in wachsenden Abständen (vereinfachtes SM-2) mit vier Knöpfen: Nochmal, Schwer, Gut, Leicht.
 */
export const KARTEN_DATEI = 'karten.md';
const UNI = 'Uni/faecher';
const TAG = 86_400_000;
/** neue Karten je Fach und Tag */
export const NEU_PRO_TAG = 15;

export interface Karte {
  id: string;
  fach: string;
  frage: string;
  antwort: string;
}

export function kartenLesen(fach: string, text: string): Karte[] {
  const aus: Karte[] = [];
  const id = (frage: string) => crypto.createHash('sha256').update(`${fach}\n${frage.trim().toLowerCase().replace(/\s+/g, ' ')}`).digest('hex').slice(0, 20);
  const zeilen = text.replace(/^---\n[\s\S]*?\n---\n/, '').split(/\r?\n/);
  let block: { frage: string; antwort: string[] } | null = null;
  const abschliessen = () => {
    if (block && block.frage && block.antwort.join('\n').trim()) aus.push({ id: id(block.frage), fach, frage: block.frage, antwort: block.antwort.join('\n').trim() });
    block = null;
  };
  for (const z of zeilen) {
    const ueberschrift = /^#{3,4}\s+(.+)$/.exec(z);
    if (ueberschrift) {
      abschliessen();
      block = { frage: ueberschrift[1]!.trim(), antwort: [] };
      continue;
    }
    if (/^#{1,2}\s/.test(z)) {
      abschliessen();
      continue;
    }
    const einzeilig = /^(?:[-*]\s+)?(.+?)\s+::\s+(.+)$/.exec(z);
    if (einzeilig && !block) {
      aus.push({ id: id(einzeilig[1]!), fach, frage: einzeilig[1]!.trim(), antwort: einzeilig[2]!.trim() });
      continue;
    }
    if (block) (block as { antwort: string[] }).antwort.push(z);
  }
  abschliessen();
  // doppelte Fragen: die erste zählt
  const gesehen = new Set<string>();
  return aus.filter((k) => !gesehen.has(k.id) && gesehen.add(k.id));
}

export type Bewertung = 'nochmal' | 'schwer' | 'gut' | 'leicht';

/** Vereinfachtes SM-2: Intervall in Tagen und Leichtigkeit */
export function naechsteWiederholung(s: { intervall: number; leichtigkeit: number; wiederholungen: number }, b: Bewertung) {
  let { intervall, leichtigkeit, wiederholungen } = s;
  if (b === 'nochmal') return { intervall: 0, leichtigkeit: Math.max(1.3, leichtigkeit - 0.2), wiederholungen: 0, inMs: 10 * 60_000 };
  if (b === 'schwer') {
    leichtigkeit = Math.max(1.3, leichtigkeit - 0.15);
    intervall = wiederholungen === 0 ? 1 : Math.max(1, intervall * 1.2);
  } else if (b === 'gut') intervall = wiederholungen === 0 ? 1 : wiederholungen === 1 ? 3 : intervall * leichtigkeit;
  else {
    leichtigkeit += 0.15;
    intervall = wiederholungen === 0 ? 4 : intervall * leichtigkeit * 1.3;
  }
  intervall = Math.min(365, Math.round(intervall * 10) / 10);
  return { intervall, leichtigkeit: Math.round(leichtigkeit * 100) / 100, wiederholungen: wiederholungen + 1, inMs: intervall * TAG };
}

export class Karteikasten {
  constructor(private o: { db: DB; uhr: Uhr; vault: VaultDienst; hub: LiveHub }) {}

  private faecher(): string[] {
    return this.o.vault
      .namenJetzt(UNI)
      .filter((d) => d.ordner)
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b, 'de'));
  }

  async karten(fach: string): Promise<Karte[]> {
    const d = await this.o.vault.lesen(`${UNI}/${fach}/${KARTEN_DATEI}`).catch(() => null);
    return d ? kartenLesen(fach, d.inhalt) : [];
  }

  private stand(ids: string[]) {
    if (!ids.length) return new Map<string, { faellig: number; intervall: number; leichtigkeit: number; wiederholungen: number }>();
    const z = this.o.db.prepare(`SELECT id, faellig, intervall, leichtigkeit, wiederholungen FROM karten_stand WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as {
      id: string;
      faellig: number;
      intervall: number;
      leichtigkeit: number;
      wiederholungen: number;
    }[];
    return new Map(z.map((x) => [x.id, x]));
  }

  private neuHeute(fach: string) {
    const tag = new Date(this.o.uhr.jetzt()).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
    return (this.o.db.prepare('SELECT COUNT(*) AS n FROM karten_stand WHERE fach = ? AND erstes = ?').get(fach, tag) as { n: number }).n;
  }

  async uebersicht(): Promise<KartenFach[]> {
    const jetzt = this.o.uhr.jetzt();
    const aus: KartenFach[] = [];
    for (const fach of this.faecher()) {
      const k = await this.karten(fach);
      if (!k.length) continue;
      const s = this.stand(k.map((x) => x.id));
      const neu = k.filter((x) => !s.has(x.id)).length;
      aus.push({
        fach,
        gesamt: k.length,
        faellig: k.filter((x) => s.has(x.id) && s.get(x.id)!.faellig <= jetzt).length + Math.min(neu, Math.max(0, NEU_PRO_TAG - this.neuHeute(fach))),
        neu,
        gelernt: k.filter((x) => (s.get(x.id)?.intervall ?? 0) >= 21).length,
      });
    }
    return aus;
  }

  /** Fällige Karten eines Fachs: erst Wiederholungen (am längsten fällig zuerst), dann neue (bis zum Tageslimit) */
  async faellig(fach: string, max = 50): Promise<KarteFaellig[]> {
    if (!this.faecher().includes(fach)) throw new DorfFehler(404, 'Dieses Fach gibt es nicht.');
    const jetzt = this.o.uhr.jetzt();
    const k = await this.karten(fach);
    const s = this.stand(k.map((x) => x.id));
    const wieder = k.filter((x) => s.has(x.id) && s.get(x.id)!.faellig <= jetzt).sort((a, b) => s.get(a.id)!.faellig - s.get(b.id)!.faellig);
    const neu = k.filter((x) => !s.has(x.id)).slice(0, Math.max(0, NEU_PRO_TAG - this.neuHeute(fach)));
    return [...wieder.map((x) => ({ ...x, neu: false })), ...neu.map((x) => ({ ...x, neu: true }))].slice(0, max);
  }

  async antworten(fach: string, id: string, b: Bewertung) {
    const k = (await this.karten(fach)).find((x) => x.id === id);
    if (!k) throw new DorfFehler(404, 'Diese Karte gibt es nicht (mehr).');
    const jetzt = this.o.uhr.jetzt();
    const alt = this.stand([id]).get(id) ?? { faellig: jetzt, intervall: 0, leichtigkeit: 2.5, wiederholungen: 0 };
    const n = naechsteWiederholung(alt, b);
    const tag = new Date(jetzt).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
    this.o.db
      .prepare(
        `INSERT INTO karten_stand (id, fach, faellig, intervall, leichtigkeit, wiederholungen, zuletzt, erstes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET faellig = excluded.faellig, intervall = excluded.intervall, leichtigkeit = excluded.leichtigkeit,
           wiederholungen = excluded.wiederholungen, zuletzt = excluded.zuletzt`,
      )
      .run(id, fach, jetzt + n.inMs, n.intervall, n.leichtigkeit, n.wiederholungen, jetzt, tag);
    this.o.hub.senden({ typ: 'uni.geaendert' });
    return { naechste: new Date(jetzt + n.inMs).toISOString(), intervall: n.intervall };
  }

  /** Summe fälliger Karten (für „Heute“, Morgenzeitung) */
  async faelligGesamt() {
    return (await this.uebersicht()).reduce((s, f) => s + f.faellig, 0);
  }
}
