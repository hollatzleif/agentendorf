import matter from "gray-matter";
import { z } from "zod";
import type { NotenStand } from "@dorf/shared";
import type { VaultDienst } from "../vault/dienst.js";
import type { LiveHub } from "../live.js";
import { DorfFehler } from "../fehler.js";

/**
 * Noten & ECTS (E98): eine Datei `Uni/noten.md` (Frontmatter, in Obsidian lesbar und änderbar).
 * Österreichische Skala: 1 Sehr gut … 4 Genügend, 5 Nicht genügend (zählt nicht, keine ECTS); „bestanden“ = mit Erfolg
 * teilgenommen ohne Note (ECTS ja, Schnitt nein). Schnitt = nach ECTS gewichtet über die benoteten, bestandenen Fächer.
 */
export const NOTEN_PFAD = "Uni/noten.md";

const Eintrag = z
  .object({
    fach: z.string().trim().min(1).max(100),
    ects: z.number().min(0).max(60).default(0),
    note: z
      .union([z.number().int().min(1).max(5), z.literal("bestanden")])
      .nullable()
      .optional(),
    semester: z.string().trim().max(20).optional(),
  })
  .passthrough(); // Review: eigene Felder aus Obsidian (z. B. pruefer, datum) bleiben erhalten
type EintragT = z.infer<typeof Eintrag>;
const Datei = z.object({
  ziel_ects: z.number().min(0).max(600).optional(),
  faecher: z.array(Eintrag).max(200).default([]),
});

export function notenStand(d: {
  ziel_ects?: number;
  faecher: EintragT[];
}): Omit<NotenStand, "vorschlaege"> {
  const bestanden = d.faecher.filter(
    (f) =>
      f.note === "bestanden" || (typeof f.note === "number" && f.note <= 4),
  );
  const benotet = bestanden.filter(
    (f): f is EintragT & { note: number } =>
      typeof f.note === "number" && f.ects > 0,
  );
  const gewicht = benotet.reduce((s, f) => s + f.ects, 0);
  return {
    faecher: d.faecher.map((f) => ({
      fach: f.fach,
      ects: f.ects,
      note: f.note ?? null,
      ...(f.semester ? { semester: f.semester } : {}),
    })),
    schnitt: gewicht
      ? Math.round(
          (benotet.reduce((s, f) => s + f.note * f.ects, 0) / gewicht) * 100,
        ) / 100
      : null,
    ectsBestanden: bestanden.reduce((s, f) => s + f.ects, 0),
    ectsOffen: d.faecher
      .filter((f) => f.note == null)
      .reduce((s, f) => s + f.ects, 0),
    zielEcts: d.ziel_ects ?? null,
  };
}

export class Noten {
  private schreibKette: Promise<unknown> = Promise.resolve();
  constructor(
    private o: {
      vault: VaultDienst;
      hub: LiveHub;
      faecher: () => { name: string; titel: string }[];
    },
  ) {}

  private async lesen() {
    const d = await this.o.vault.lesen(NOTEN_PFAD).catch(() => null);
    if (!d)
      return {
        daten: { faecher: [] as EintragT[] } as z.infer<typeof Datei>,
        version: undefined as string | undefined,
        inhalt: "",
      };
    try {
      return {
        daten: Datei.parse(matter(d.inhalt).data),
        version: d.version,
        inhalt: d.inhalt,
      };
    } catch (e) {
      throw new DorfFehler(
        409,
        `${NOTEN_PFAD} ist fehlerhaft: ${e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : String(e)}`,
      );
    }
  }

  async stand(): Promise<NotenStand> {
    const { daten } = await this.lesen();
    const bekannt = new Set(daten.faecher.map((f) => f.fach.toLowerCase()));
    return {
      ...notenStand(daten),
      vorschlaege: this.o
        .faecher()
        .map((f) => f.titel)
        .filter((t) => !bekannt.has(t.toLowerCase())),
    };
  }

  private async schreiben(f: (d: z.infer<typeof Datei>) => void) {
    // nacheinander: zwei schnelle Änderungen dürfen sich nicht gegenseitig überschreiben
    const lauf = this.schreibKette.then(async () => {
      const a = await this.lesen();
      const d = structuredClone(a.daten);
      f(d);
      const m = a.inhalt
        ? matter(a.inhalt)
        : {
            content:
              "\n# Noten & ECTS\n\nPflegst du in der App (Uni → Noten) oder hier. note: 1–5 oder „bestanden“ (ohne Note); leer = noch offen.\n",
            data: {},
          };
      const daten: Record<string, unknown> = {
        ...(m.data as object),
        faecher: d.faecher,
      };
      if (d.ziel_ects != null) daten.ziel_ects = d.ziel_ects;
      else delete daten.ziel_ects;
      const neu = matter.stringify(m.content, daten);
      const r = await this.o.vault.schreiben(
        NOTEN_PFAD,
        neu,
        a.version ? { basisVersion: a.version } : { nurNeu: true },
      );
      if (r.konflikt)
        throw new DorfFehler(
          409,
          "noten.md wurde gerade woanders geändert – bitte neu laden.",
        );
      this.o.hub.senden({ typ: "uni.geaendert" });
      return this.stand();
    });
    this.schreibKette = lauf.catch(() => undefined);
    return lauf;
  }

  setzen(roh: unknown) {
    const e = Eintrag.parse(roh);
    return this.schreiben((d) => {
      const i = d.faecher.findIndex(
        (x) => x.fach.toLowerCase() === e.fach.toLowerCase(),
      );
      // bestehenden Eintrag ergänzen statt ersetzen – unbekannte Felder bleiben
      const basis: Record<string, unknown> = i >= 0 ? { ...d.faecher[i] } : {};
      Object.assign(basis, { fach: e.fach, ects: e.ects });
      if (e.note != null) basis.note = e.note;
      else delete basis.note;
      if (e.semester) basis.semester = e.semester;
      else delete basis.semester;
      if (i >= 0) d.faecher[i] = basis as EintragT;
      else d.faecher.push(basis as EintragT);
    });
  }

  entfernen(fach: string) {
    return this.schreiben((d) => {
      const vorher = d.faecher.length;
      d.faecher = d.faecher.filter(
        (x) => x.fach.toLowerCase() !== fach.toLowerCase(),
      );
      if (d.faecher.length === vorher)
        throw new DorfFehler(404, "Dieses Fach steht nicht in der Notenliste.");
    });
  }

  zielSetzen(ects: number | null) {
    return this.schreiben((d) => {
      if (ects == null) delete d.ziel_ects;
      else d.ziel_ects = ects;
    });
  }
}
