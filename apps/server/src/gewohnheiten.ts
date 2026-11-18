import matter from "gray-matter";
import { z } from "zod";
import type { GewohnheitStand } from "@dorf/shared";
import type { DB } from "./db.js";
import type { Uhr } from "./uhr.js";
import type { VaultDienst } from "./vault/dienst.js";
import type { LiveHub } from "./live.js";
import { DorfFehler } from "./fehler.js";

/**
 * Gewohnheiten (Nacht 18./19.11.): Leif legt fest, was er regelmäßig tun will (täglich, werktags, an bestimmten
 * Tagen). Die Liste steht in `Marktplatz/gewohnheiten.md` (Obsidian-freundlich), die Häkchen in der DB.
 * Serie = wie viele fällige Tage in Folge erledigt (Tage, an denen nichts fällig ist, unterbrechen nicht).
 */
export const GEWOHNHEITEN_PFAD = "Marktplatz/gewohnheiten.md";
const TAGE = ["so", "mo", "di", "mi", "do", "fr", "sa"] as const;

const Gewohnheit = z.object({
  name: z.string().trim().min(1).max(60),
  symbol: z.string().trim().max(8).default("✅"),
  /** täglich | werktags | wochenende | Liste wie [mo, mi, fr] */
  tage: z
    .union([
      z.enum(["täglich", "werktags", "wochenende"]),
      z.array(z.enum(TAGE)).min(1),
      // E110: „3x pro woche“ – an beliebigen Tagen, bis das Wochenziel erreicht ist
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[1-6]x pro woche$/, "z. B. „3x pro woche“"),
    ])
    .default("täglich"),
  /** E106: Uhrzeit (Wien) – dann läutet der Kirchturm und Telegram erinnert, falls noch nicht abgehakt */
  uhrzeit: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "uhrzeit als HH:MM")
    .optional(),
});
type GewohnheitT = z.infer<typeof Gewohnheit>;
const Datei = z.object({
  gewohnheiten: z.array(Gewohnheit).max(30).default([]),
});

const tagIn = (ms: number) =>
  new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Europe/Vienna" });
const wochentag = (tag: string) => new Date(`${tag}T12:00:00Z`).getUTCDay();
const tagPlus = (tag: string, n: number) => {
  const d = new Date(`${tag}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** E110: Wochenziel einer „Nx pro woche“-Gewohnheit, sonst null */
export function proWoche(g: Pick<GewohnheitT, "tage">) {
  return typeof g.tage === "string" && /^[1-6]x pro woche$/.test(g.tage)
    ? Number(g.tage[0])
    : null;
}
const montagVon = (tag: string) => tagPlus(tag, -((wochentag(tag) + 6) % 7));

export function faelligAm(g: Pick<GewohnheitT, "tage">, tag: string) {
  const wt = wochentag(tag);
  if (g.tage === "täglich" || proWoche(g) != null) return true;
  if (g.tage === "werktags") return wt >= 1 && wt <= 5;
  if (g.tage === "wochenende") return wt === 0 || wt === 6;
  return g.tage.includes(TAGE[wt]!);
}

export class Gewohnheiten {
  private schreibKette: Promise<unknown> = Promise.resolve();
  constructor(
    private o: { db: DB; uhr: Uhr; vault: VaultDienst; hub: LiveHub },
  ) {}

  async liste(): Promise<{
    gewohnheiten: GewohnheitT[];
    version?: string;
    fehler?: string;
  }> {
    const d = await this.o.vault.lesen(GEWOHNHEITEN_PFAD).catch(() => null);
    if (!d) return { gewohnheiten: [] };
    try {
      return {
        gewohnheiten: Datei.parse(matter(d.inhalt).data).gewohnheiten,
        version: d.version,
      };
    } catch (e) {
      return {
        gewohnheiten: [],
        version: d.version,
        fehler: `${GEWOHNHEITEN_PFAD} ist fehlerhaft: ${e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : String(e)}`,
      };
    }
  }

  /**
   * Schreibt die ROHE Liste aus der Datei weiter (Review): Felder, die Leif in Obsidian ergänzt hat (z. B. notiz),
   * bleiben erhalten, und es werden keine Standardwerte (symbol, tage) hineingeschrieben.
   */
  private async schreiben(
    f: (roh: Record<string, unknown>[]) => Record<string, unknown>[],
  ) {
    // nacheinander: zwei schnelle Änderungen dürfen sich nicht gegenseitig überschreiben
    const lauf = this.schreibKette.then(async () => {
      const d = await this.o.vault.lesen(GEWOHNHEITEN_PFAD).catch(() => null);
      const m = d
        ? matter(d.inhalt)
        : {
            data: {},
            content:
              "\n# Gewohnheiten\n\nPflegst du hier oder in der App („Heute“). `tage`: täglich, werktags, wochenende, eine Liste wie [mo, mi, fr] oder „3x pro woche“; optional `uhrzeit: 07:30`.\n",
          };
      const daten = m.data as Record<string, unknown>;
      const roh = Array.isArray(daten.gewohnheiten)
        ? (daten.gewohnheiten as Record<string, unknown>[])
        : [];
      const r = await this.o.vault.schreiben(
        GEWOHNHEITEN_PFAD,
        matter.stringify(m.content, { ...daten, gewohnheiten: f(roh) }),
        d ? { basisVersion: d.version } : { nurNeu: true },
      );
      if (r.konflikt)
        throw new DorfFehler(
          409,
          "gewohnheiten.md wurde gerade woanders geändert – bitte neu laden.",
        );
      this.o.hub.senden({ typ: "todos.geaendert", liste: "gewohnheiten" });
    });
    this.schreibKette = lauf.catch(() => undefined);
    return lauf;
  }

  async anlegen(roh: unknown) {
    const g = Gewohnheit.parse(roh);
    const eingabe = (roh ?? {}) as Record<string, unknown>;
    const l = await this.liste();
    if (l.fehler) throw new DorfFehler(409, l.fehler);
    if (
      l.gewohnheiten.some((x) => x.name.toLowerCase() === g.name.toLowerCase())
    )
      throw new DorfFehler(409, "Diese Gewohnheit gibt es schon.");
    // nur, was angegeben wurde – Standardwerte ergänzt das Lesen
    const neu: Record<string, unknown> = { name: g.name };
    if (eingabe.symbol != null && eingabe.symbol !== "") neu.symbol = g.symbol;
    if (eingabe.tage != null) neu.tage = g.tage;
    if (g.uhrzeit) neu.uhrzeit = g.uhrzeit;
    await this.schreiben((alt) => [...alt, neu]);
  }

  /** Tage, Uhrzeit, Symbol ändern – im rohen Eintrag, damit eigene Felder bleiben; Häkchen hängen am Namen und bleiben */
  async aendern(name: string, roh: unknown) {
    const a = z
      .object({
        symbol: z.string().trim().max(8).optional(),
        tage: Gewohnheit.shape.tage.removeDefault().optional(),
        uhrzeit: z
          .union([
            z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "uhrzeit als HH:MM"),
            z.literal(""),
          ])
          .optional(),
      })
      .parse(roh);
    const l = await this.liste();
    if (l.fehler) throw new DorfFehler(409, l.fehler);
    if (!l.gewohnheiten.some((x) => x.name === name))
      throw new DorfFehler(404, "Diese Gewohnheit gibt es nicht.");
    await this.schreiben((alt) =>
      alt.map((x) => {
        if (x?.name !== name) return x;
        const n = { ...x };
        if (a.symbol !== undefined) {
          if (a.symbol) n.symbol = a.symbol;
          else delete n.symbol;
        }
        if (a.tage !== undefined) n.tage = a.tage;
        if (a.uhrzeit !== undefined) {
          if (a.uhrzeit) n.uhrzeit = a.uhrzeit;
          else delete n.uhrzeit;
        }
        return n;
      }),
    );
  }

  async entfernen(name: string) {
    const l = await this.liste();
    if (!l.gewohnheiten.some((x) => x.name === name))
      throw new DorfFehler(404, "Diese Gewohnheit gibt es nicht.");
    await this.schreiben((alt) => alt.filter((x) => x?.name !== name));
  }

  async haken(
    name: string,
    erledigt: boolean,
    tag = tagIn(this.o.uhr.jetzt()),
  ) {
    if (!(await this.liste()).gewohnheiten.some((x) => x.name === name))
      throw new DorfFehler(404, "Diese Gewohnheit gibt es nicht.");
    if (tag > tagIn(this.o.uhr.jetzt()))
      throw new DorfFehler(400, "Nur heute oder früher abhaken.");
    if (erledigt)
      this.o.db
        .prepare(
          "INSERT OR IGNORE INTO gewohnheit_log (name, tag) VALUES (?, ?)",
        )
        .run(name, tag);
    else
      this.o.db
        .prepare("DELETE FROM gewohnheit_log WHERE name = ? AND tag = ?")
        .run(name, tag);
    this.o.hub.senden({ typ: "todos.geaendert", liste: "gewohnheiten" });
  }

  async stand(): Promise<{ gewohnheiten: GewohnheitStand[]; fehler?: string }> {
    const l = await this.liste();
    const heute = tagIn(this.o.uhr.jetzt());
    const aus: GewohnheitStand[] = [];
    for (const g of l.gewohnheiten) {
      const tage = new Set(
        (
          this.o.db
            .prepare(
              "SELECT tag FROM gewohnheit_log WHERE name = ? AND tag > ?",
            )
            .all(g.name, tagPlus(heute, -400)) as { tag: string }[]
        ).map((x) => x.tag),
      );
      const ziel = proWoche(g);
      const woche = Array.from({ length: 7 }, (_, i) => {
        const t = tagPlus(heute, i - 6);
        return { tag: t, faellig: faelligAm(g, t), erledigt: tage.has(t) };
      });
      if (ziel != null) {
        // E110: Wochenziel – heute dran, solange es diese Woche noch nicht erreicht ist; Serie in Wochen
        const inWoche = (mo: string) =>
          Array.from({ length: 7 }, (_, i) => tagPlus(mo, i)).filter(
            (t) => t <= heute && tage.has(t),
          ).length;
        const mo = montagVon(heute);
        const diese = inWoche(mo);
        let serie = 0;
        for (let w = diese >= ziel ? 0 : 1; w < 60; w++) {
          if (inWoche(tagPlus(mo, -7 * w)) < ziel) break;
          serie++;
        }
        aus.push({
          name: g.name,
          symbol: g.symbol,
          tage: g.tage,
          ...(g.uhrzeit ? { uhrzeit: g.uhrzeit } : {}),
          heuteFaellig: tage.has(heute) || diese < ziel,
          heuteErledigt: tage.has(heute),
          serie,
          serieEinheit: "wochen",
          wocheStand: { erledigt: diese, ziel },
          woche,
        });
        continue;
      }
      let serie = 0;
      // heute zählt mit, wenn erledigt – sonst ab gestern
      for (let i = tage.has(heute) ? 0 : 1, n = 0; n < 400; i++, n++) {
        const t = tagPlus(heute, -i);
        if (!faelligAm(g, t)) continue;
        if (!tage.has(t)) break;
        serie++;
      }
      aus.push({
        name: g.name,
        symbol: g.symbol,
        tage: g.tage,
        ...(g.uhrzeit ? { uhrzeit: g.uhrzeit } : {}),
        heuteFaellig: faelligAm(g, heute),
        heuteErledigt: tage.has(heute),
        serie,
        woche,
      });
    }
    return { gewohnheiten: aus, ...(l.fehler ? { fehler: l.fehler } : {}) };
  }

  /**
   * E106: Gewohnheiten mit Uhrzeit, deren Zeit heute gekommen ist (höchstens 3 h her), die offen sind und heute noch
   * nicht erinnert wurden. Der Vermerk (dorf_stand) wird hier gesetzt – jede läutet höchstens einmal am Tag.
   */
  async faelligeErinnerungen(): Promise<GewohnheitStand[]> {
    const jetzt = this.o.uhr.jetzt();
    const zp = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Vienna",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(jetzt));
    const heute = tagIn(jetzt);
    const schluessel = "gewohnheiten_erinnert";
    const roh = (
      this.o.db
        .prepare("SELECT wert FROM dorf_stand WHERE schluessel = ?")
        .get(schluessel) as { wert: string } | undefined
    )?.wert;
    const merk: { tag: string; namen: string[] } = roh
      ? JSON.parse(roh)
      : { tag: heute, namen: [] };
    if (merk.tag !== heute) Object.assign(merk, { tag: heute, namen: [] });
    const minuten = (hm: string) =>
      Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
    const aus = (await this.stand()).gewohnheiten.filter(
      (g) =>
        g.uhrzeit &&
        g.heuteFaellig &&
        !g.heuteErledigt &&
        !merk.namen.includes(g.name) &&
        minuten(zp) >= minuten(g.uhrzeit) &&
        minuten(zp) - minuten(g.uhrzeit) <= 180,
    );
    if (aus.length) {
      merk.namen.push(...aus.map((g) => g.name));
      this.o.db
        .prepare(
          "INSERT OR REPLACE INTO dorf_stand (schluessel, wert) VALUES (?, ?)",
        )
        .run(schluessel, JSON.stringify(merk));
    }
    return aus;
  }

  /** Statistik: je Tag fällige und erledigte Gewohnheiten (nach der heutigen Liste) */
  async jeTag(tage: string[]) {
    const l = await this.liste();
    const log = new Set(
      (
        this.o.db
          .prepare("SELECT name, tag FROM gewohnheit_log WHERE tag >= ?")
          .all(tage[0] ?? "0000") as { name: string; tag: string }[]
      ).map((x) => `${x.name}\n${x.tag}`),
    );
    // eine Gewohnheit zählt erst ab ihrem ersten Häkchen (vorher gab es sie meist noch nicht)
    const heute = tagIn(this.o.uhr.jetzt());
    const start = new Map(
      l.gewohnheiten.map((g) => [
        g.name,
        (
          this.o.db
            .prepare("SELECT MIN(tag) AS t FROM gewohnheit_log WHERE name = ?")
            .get(g.name) as { t: string | null }
        ).t ?? heute,
      ]),
    );
    return tage.map((tag) => {
      // „Nx pro Woche“ hat keinen festen Tag – zählt in der Tagesquote nicht mit
      const f = l.gewohnheiten.filter(
        (g) =>
          proWoche(g) == null && tag >= start.get(g.name)! && faelligAm(g, tag),
      );
      return {
        faellig: f.length,
        erledigt: f.filter((g) => log.has(`${g.name}\n${tag}`)).length,
      };
    });
  }

  /** Review: Stand an einem bestimmten Tag (für Telegram-Knöpfe, die nach Mitternacht getippt werden) */
  async standAm(tag: string) {
    const l = await this.liste();
    const log = new Set(
      (
        this.o.db
          .prepare("SELECT name FROM gewohnheit_log WHERE tag = ?")
          .all(tag) as { name: string }[]
      ).map((x) => x.name),
    );
    return l.gewohnheiten
      .filter((g) => faelligAm(g, tag) || log.has(g.name))
      .map((g) => ({
        name: g.name,
        symbol: g.symbol,
        erledigt: log.has(g.name),
      }));
  }

  /** Morgenzeitung: was heute dran ist */
  async heuteZeilen(): Promise<string[]> {
    const s = await this.stand();
    const h = s.gewohnheiten.filter((g) => g.heuteFaellig);
    return h.length
      ? [
          h
            .map(
              (g) =>
                `${g.symbol} ${g.name}${g.serie > 1 ? ` (🔥 ${g.serie})` : ""}`,
            )
            .join(" · "),
        ]
      : [];
  }

  /** Wochenrückblick: „Sport 3/3, Lesen 5/7“ */
  async wochenZeile(): Promise<string | null> {
    const s = await this.stand();
    if (!s.gewohnheiten.length) return null;
    return s.gewohnheiten
      .map((g) => {
        if (g.wocheStand)
          return `${g.symbol} ${g.name} ${g.wocheStand.erledigt}/${g.wocheStand.ziel}${g.serie > 1 ? ` (🔥 ${g.serie} Wochen)` : ""}`;
        const f = g.woche.filter((t) => t.faellig);
        return `${g.symbol} ${g.name} ${f.filter((t) => t.erledigt).length}/${f.length}${g.serie > 2 ? ` (🔥 ${g.serie})` : ""}`;
      })
      .join(" · ");
  }
}
