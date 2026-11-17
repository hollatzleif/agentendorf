import { z } from 'zod';
import {
  DEKO_ARTEN,
  fehlendePlatzieren,
  layoutPruefen,
  standardLayout,
  type DorfAntwort,
  type DorfFigur,
  type DorfGebaeudeStatus,
  type DorfLayout,
  type DorfStatus,
  type LaufStatus,
  type Motor,
  type Stufe,
  type Ausloeser,
  type PlanInhalt,
} from '@dorf/shared';
import type { DB } from './db.js';
import type { Uhr } from './uhr.js';
import type { LiveHub } from './live.js';
import type { VaultDienst } from './vault/dienst.js';
import { gebaeudeListe } from './vault/gebaeude.js';
import { DorfFehler } from './fehler.js';
import type { Uni } from './uni/abgleich.js';

const TAG = 86_400_000;
const feld = z.tuple([z.number().int(), z.number().int()]);
const dreh = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export const LayoutSchema = z.object({
  gebaeude: z.record(z.string().min(1).max(200), z.object({ x: z.number().int(), z: z.number().int(), dreh })),
  lager: z.array(z.string().min(1).max(200)).max(500),
  strassen: z.array(feld).max(10_000),
  wasser: z.array(feld).max(10_000),
  deko: z.array(z.object({ art: z.enum(DEKO_ARTEN), x: z.number().int(), z: z.number().int(), dreh })).max(10_000),
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
  constructor(private o: { db: DB; uhr: Uhr; hub: LiveHub; vault: VaultDienst; uni?: Uni }) {}

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
      if (fehlendePlatzieren(l, ids)) {
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

    return { jetzt: new Date(jetzt).toISOString(), gebaeude: g, figuren };
  }
}
