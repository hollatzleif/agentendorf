import { z } from 'zod';
import {
  DEKO_ARTEN,
  VERSTREUT_STAND,
  dekoVerstreuen,
  fehlendePlatzieren,
  layoutPruefen,
  standardLayout,
  type DorfAntwort,
  type DorfFigur,
  type DorfGebaeudeStatus,
  type DorfLaufEnde,
  type DorfLayout,
  type DorfStatus,
  type DorfTag,
  type LaufStatus,
  type Motor,
  type Stufe,
  type Ausloeser,
  type PlanInhalt,
} from '@dorf/shared';
import type { DB } from './db.js';
import type { Uhr } from './uhr.js';
import type { Wetter } from './wetter.js';
import type { LiveHub } from './live.js';
import type { VaultDienst } from './vault/dienst.js';
import { gebaeudeListe } from './vault/gebaeude.js';
import { DorfFehler } from './fehler.js';
import type { Uni } from './uni/abgleich.js';
import type { TodoDienst } from './todos.js';
import type { Kirchturm } from './kirchturm.js';
import { tagIn } from './zeit.js';

const TAG = 86_400_000;
const feld = z.tuple([z.number().int(), z.number().int()]);
const dreh = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export const LayoutSchema = z.object({
  gebaeude: z.record(z.string().min(1).max(200), z.object({ x: z.number().int(), z: z.number().int(), dreh })),
  lager: z.array(z.string().min(1).max(200)).max(500),
  strassen: z.array(feld).max(10_000),
  wasser: z.array(feld).max(10_000),
  deko: z.array(z.object({ art: z.enum(DEKO_ARTEN), x: z.number().int(), z: z.number().int(), dreh, auto: z.boolean().optional() })).max(10_000),
  verstreut: z.number().int().min(0).optional(),
});

interface Zeile {
  inhalt_json: string;
  version: number;
}

/**
 * Das Layout des Dorfs (wo welches Gebäude steht, Straßen, Wasser, Deko). Liegt in der DB, nicht im
 * Vault: es ist Zustand der App, nicht Leifs Notiz. Jede Änderung erhöht die Version; wer mit einer
 * veralteten Version speichert, bekommt 409 und das aktuelle Layout zurück (statt still zu überschreiben).
 */
export class Dorfplan {
  constructor(private o: { db: DB; uhr: Uhr; hub: LiveHub; vault: VaultDienst; uni?: Uni; wetter?: Wetter; todos?: Pick<TodoDienst, 'liste'>; kirchturm?: Pick<Kirchturm, 'zustand'> }) {}

  private zeile(): Zeile | undefined {
    return this.o.db.prepare('SELECT inhalt_json, version FROM dorf_layout WHERE id = 1').get() as Zeile | undefined;
  }

  private schreiben(l: DorfLayout, version: number) {
    this.o.db
      .prepare(
        `INSERT INTO dorf_layout (id, inhalt_json, version, geaendert) VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET inhalt_json = excluded.inhalt_json, version = excluded.version, geaendert = excluded.geaendert`,
      )
      .run(JSON.stringify(l), version, this.o.uhr.jetzt());
    this.o.hub.senden({ typ: 'dorf.geaendert', version });
  }

  /** Aktuelles Layout; neue Gebäude aus dem Vault werden dabei automatisch platziert (und gespeichert). */
  async laden(): Promise<DorfAntwort> {
    const ids = (await gebaeudeListe(this.o.vault)).map((g) => g.id);
    return this.o.db.transaction((): DorfAntwort => {
      const z = this.zeile();
      if (!z) {
        const l = standardLayout(ids);
        this.schreiben(l, 1);
        return { layout: l, version: 1 };
      }
      const l = LayoutSchema.parse(JSON.parse(z.inhalt_json)) as DorfLayout;
      let geaendert = fehlendePlatzieren(l, ids);
      // E72: bestehende Dörfer bekommen EINMAL Häuschen und Deko dazu (Markierung im Layout selbst, keine Migration)
      if ((l.verstreut ?? 0) < VERSTREUT_STAND) {
        dekoVerstreuen(l);
        geaendert = true;
      }
      if (geaendert) {
        this.schreiben(l, z.version + 1);
        return { layout: l, version: z.version + 1 };
      }
      return { layout: l, version: z.version };
    })();
  }

  async speichern(basisVersion: number, roh: unknown): Promise<DorfAntwort> {
    const neu = LayoutSchema.parse(roh) as DorfLayout;
    const ids = (await gebaeudeListe(this.o.vault)).map((g) => g.id);
    return this.o.db.transaction((): DorfAntwort => {
      const z = this.zeile();
      const version = z?.version ?? 0;
      if (basisVersion !== version) {
        const aktuell = z ? (JSON.parse(z.inhalt_json) as DorfLayout) : standardLayout(ids);
        throw new DorfFehler(409, 'Das Dorf wurde inzwischen auf einem anderen Gerät geändert.', { layout: aktuell, version });
      }
      const alt = z ? (JSON.parse(z.inhalt_json) as DorfLayout) : { gebaeude: {}, lager: [] };
      const erlaubt = new Set([...ids, ...Object.keys(alt.gebaeude), ...alt.lager]);
      const fehler = layoutPruefen(neu, erlaubt);
      if (fehler) throw new DorfFehler(400, fehler);
      // Die Markierung gehört dem Server: ein Gerät mit altem Stand darf sie nicht zurücksetzen (sonst würde erneut verstreut)
      const verstreut = Math.max(neu.verstreut ?? 0, (alt as Partial<DorfLayout>).verstreut ?? 0);
      if (verstreut) neu.verstreut = verstreut;
      fehlendePlatzieren(neu, ids);
      this.schreiben(neu, version + 1);
      return { layout: neu, version: version + 1 };
    })();
  }

  /** Was im Dorf gerade los ist – nur aus DB-Fakten, ohne Modell. */
  status(): DorfStatus {
    const { db, uhr } = this.o;
    const jetzt = uhr.jetzt();
    const g: Record<string, DorfGebaeudeStatus> = {};
    const von = (id: string) => (g[id] ??= { arbeitet: 0, aufgaben: 0, freigaben: 0, frist: null });

    const laeufe = db
      .prepare(
        `SELECT l.id, l.chat_id, l.motor, l.modell, l.stufe, l.status, l.ausloeser, l.auftrag, l.erstellt, l.start,
                l.ein_token + l.aus_token + l.cache_lesen + l.cache_schreiben AS token, l.kosten_usd, c.gebaeude, c.titel, c.rolle
         FROM laeufe l JOIN chats c ON c.id = l.chat_id
         WHERE l.status IN ('wartet_freigabe', 'wartend', 'laeuft') ORDER BY l.erstellt`,
      )
      .all() as {
      id: string; chat_id: string; motor: Motor; modell: string; stufe: Stufe; status: LaufStatus; ausloeser: Ausloeser; auftrag: string;
      erstellt: number; start: number | null; token: number; kosten_usd: number; gebaeude: string; titel: string; rolle: string | null;
    }[];
    const figuren: DorfFigur[] = laeufe.map((l) => {
      if (l.status === 'laeuft') von(l.gebaeude).arbeitet++;
      return {
        laufId: l.id,
        chatId: l.chat_id,
        gebaeude: l.gebaeude,
        titel: l.titel,
        auftrag: l.auftrag.length > 400 ? `${l.auftrag.slice(0, 400)} …` : l.auftrag,
        motor: l.motor,
        modell: l.modell,
        stufe: l.stufe,
        status: l.status,
        ausloeser: l.ausloeser,
        buergermeister: l.rolle === 'buergermeister',
        erstellt: new Date(l.erstellt).toISOString(),
        ...(l.start ? { start: new Date(l.start).toISOString() } : {}),
        token: l.token,
        kostenUsd: l.kosten_usd,
      };
    });

    for (const f of db.prepare("SELECT gebaeude, COUNT(*) AS n FROM freigaben WHERE status = 'offen' GROUP BY gebaeude").all() as { gebaeude: string; n: number }[])
      von(f.gebaeude).freigaben = f.n;

    const tisch = db.prepare("SELECT COUNT(*) AS n FROM schreibtisch WHERE status IN ('neu', 'in_arbeit', 'plan_wartet', 'helfer_laufen')").get() as { n: number };
    if (tisch.n) von('Rathaus').aufgaben += tisch.n;
    for (const p of db.prepare("SELECT inhalt_json FROM plaene WHERE status = 'wartet'").all() as { inhalt_json: string }[]) {
      try {
        for (const t of (JSON.parse(p.inhalt_json) as PlanInhalt).teilaufgaben ?? []) von(t.gebaeude).aufgaben++;
      } catch {
        /* kaputter Plan – zählt nicht */
      }
    }

    const frist = this.o.uni
      ?.fristen()
      .find((f) => !f.abgegeben && (f.art === 'abgabe' || f.art === 'test') && f.frist && Date.parse(f.frist) > jetzt && Date.parse(f.frist) - jetzt < 3 * TAG);
    if (frist) von('Uni').frist = { titel: frist.kurs ? `${frist.titel} (${frist.kurs})` : frist.titel, frist: frist.frist! };

    const zuletzt = (
      db
        .prepare(
          `SELECT l.id, l.status, l.ende, c.gebaeude, c.titel, c.rolle FROM laeufe l JOIN chats c ON c.id = l.chat_id
           WHERE l.status IN ('fertig', 'fehler', 'abgebrochen') AND l.ende >= ? AND (c.rolle IS NULL OR c.rolle != 'system')
           ORDER BY l.ende DESC LIMIT 10`,
        )
        .all(jetzt - 10 * 60_000) as { id: string; status: DorfLaufEnde['status']; ende: number; gebaeude: string; titel: string; rolle: string | null }[]
    ).map((l) => ({ laufId: l.id, gebaeude: l.gebaeude, titel: l.titel, status: l.status, ende: new Date(l.ende).toISOString(), buergermeister: l.rolle === 'buergermeister' }));

    const wetter = this.o.wetter?.aktuell();
    // E131: Fokus = Pomodoro in der Arbeitsphase und nicht angehalten (unabhängig von „Nicht stören“)
    const pomodoro = this.o.kirchturm?.zustand().pomodoro;
    const fokus = pomodoro ? pomodoro.phase === 'arbeit' && pomodoro.status === 'laeuft' : undefined;
    return { jetzt: new Date(jetzt).toISOString(), gebaeude: g, figuren, zuletzt, ...(wetter ? { wetter } : {}), ...(fokus !== undefined ? { fokus } : {}) };
  }

  /** E131: To-dos von heute (Wiener Kalendertag): offen und fällig bis heute / heute erledigt */
  async tag(): Promise<DorfTag | undefined> {
    if (!this.o.todos) return undefined;
    const heute = tagIn(this.o.uhr.jetzt());
    let dran = 0;
    let erledigt = 0;
    for (const t of await this.o.todos.liste()) {
      if (!t.erledigt) {
        if (t.faellig && t.faellig <= heute) dran++;
      } else if (t.erledigtAm && tagIn(Date.parse(t.erledigtAm)) === heute) erledigt++;
    }
    return { dran, erledigt };
  }

  /** Status samt Tafel-Zahlen; ein Fehler beim Lesen der To-dos verhindert den Dorfstatus nie */
  async statusMitTag(): Promise<DorfStatus> {
    const st = this.status();
    const tag = await this.tag().catch(() => undefined);
    return tag ? { ...st, tag } : st;
  }
}
