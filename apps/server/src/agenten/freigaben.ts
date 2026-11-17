import crypto from 'node:crypto';
import { z } from 'zod';
import type { FreigabeInfo, FreigabeStatus } from '@dorf/shared';
import type { DB } from '../db.js';
import type { Uhr } from '../uhr.js';
import type { VaultDienst } from '../vault/dienst.js';
import { normalisieren } from '../vault/pfade.js';
import { DorfFehler } from '../fehler.js';

/**
 * Freigaben: Alles mit Außenwirkung oder ohne Rückweg beantragt ein Agent nur.
 * Ausgeführt wird erst nach Leifs Klick – vom Dorf selbst, nie vom Agenten.
 * Jede Freigabe kann genau einmal entschieden werden.
 */

export const FREIGABE_ARTEN = {
  datei_loeschen: z.object({ pfad: z.string().min(1) }),
  datei_ueberschreiben: z.object({ pfad: z.string().min(1), inhalt: z.string() }),
  sonstiges: z.object({ beschreibung: z.string().min(1) }),
  lauf_starten: z.object({ laufId: z.string() }),
  // Inhalt enthält zusätzlich den ganzen Plan (für Anzeige in App und Telegram)
  plan_ausfuehren: z.object({ planId: z.string() }).passthrough(),
} as const;
export type FreigabeArt = keyof typeof FREIGABE_ARTEN;
/** Arten, die ein Agent beantragen darf (lauf_starten legt nur das Dorf selbst an). */
export const AGENTEN_ARTEN = ['datei_loeschen', 'datei_ueberschreiben', 'sonstiges'] as const;

type Ausfuehrer = (inhalt: never) => Promise<string>;

interface Zeile {
  id: string;
  lauf_id: string | null;
  chat_id: string | null;
  gebaeude: string;
  art: string;
  titel: string;
  begruendung: string;
  inhalt_json: string;
  status: FreigabeStatus;
  erstellt: number;
  entschieden: number | null;
  ergebnis: string | null;
  vault_pfad: string | null;
}

function info(z: Zeile): FreigabeInfo {
  return {
    id: z.id,
    laufId: z.lauf_id ?? undefined,
    chatId: z.chat_id ?? undefined,
    gebaeude: z.gebaeude,
    art: z.art,
    titel: z.titel,
    begruendung: z.begruendung,
    inhalt: JSON.parse(z.inhalt_json),
    status: z.status,
    erstellt: new Date(z.erstellt).toISOString(),
    entschieden: z.entschieden ? new Date(z.entschieden).toISOString() : undefined,
    ergebnis: z.ergebnis ?? undefined,
  };
}

export class Freigaben {
  private ausfuehrer = new Map<string, Ausfuehrer>();
  beiAenderung: () => void = () => {};
  /** Zuhörer für neue Anträge (z. B. Telegram) */
  readonly beiNeu: ((f: FreigabeInfo) => void | Promise<void>)[] = [];
  /** Zuhörer für Entscheidungen (z. B. Telegram-Nachricht umschreiben, Plan abgelehnt) */
  readonly beiEntscheidung: ((f: FreigabeInfo) => void | Promise<void>)[] = [];

  private async melden(liste: ((f: FreigabeInfo) => void | Promise<void>)[], f: FreigabeInfo) {
    for (const fn of liste) {
      try {
        await fn(f);
      } catch (e) {
        console.error('Freigabe-Zuhörer fehlgeschlagen', e);
      }
    }
  }

  constructor(
    private db: DB,
    private uhr: Uhr,
    private vault: VaultDienst,
  ) {
    this.registrieren('datei_loeschen', async (i: { pfad: string }) => `In den Papierkorb gelegt: ${await this.vault.loeschen(i.pfad)}`);
    this.registrieren('datei_ueberschreiben', async (i: { pfad: string; inhalt: string }) => {
      await this.vault.schreiben(i.pfad, i.inhalt);
      return `Überschrieben: ${i.pfad}`;
    });
    this.registrieren('sonstiges', async () => 'Zur Kenntnis genommen – Leif erledigt das selbst.');
  }

  /** Weitere Ausführer (z. B. lauf_starten, später Mail senden) melden sich hier an. */
  registrieren<A extends FreigabeArt>(art: A, fn: (inhalt: z.infer<(typeof FREIGABE_ARTEN)[A]>) => Promise<string>) {
    this.ausfuehrer.set(art, fn as Ausfuehrer);
  }

  async beantragen(a: { art: string; titel: string; begruendung?: string; inhalt: unknown; gebaeude: string; laufId?: string; chatId?: string }) {
    if (!(a.art in FREIGABE_ARTEN)) throw new DorfFehler(400, `Unbekannte Art „${a.art}“. Erlaubt: ${AGENTEN_ARTEN.join(', ')}.`);
    const inhalt = FREIGABE_ARTEN[a.art as FreigabeArt].parse(a.inhalt);
    if ('pfad' in inhalt) (inhalt as { pfad: string }).pfad = normalisieren(String(inhalt.pfad));
    const id = crypto.randomUUID();
    const jetzt = this.uhr.jetzt();
    this.db
      .prepare(
        `INSERT INTO freigaben (id, lauf_id, chat_id, gebaeude, art, titel, begruendung, inhalt_json, status, erstellt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'offen', ?)`,
      )
      .run(id, a.laufId ?? null, a.chatId ?? null, a.gebaeude, a.art, a.titel.slice(0, 200), (a.begruendung ?? '').slice(0, 4000), JSON.stringify(inhalt), jetzt);
    await this.spiegeln(id);
    this.beiAenderung();
    const neu = this.holen(id);
    await this.melden(this.beiNeu, neu);
    return neu;
  }

  holen(id: string): FreigabeInfo {
    const z = this.db.prepare('SELECT * FROM freigaben WHERE id = ?').get(id) as Zeile | undefined;
    if (!z) throw new DorfFehler(404, 'Freigabe nicht gefunden.');
    return info(z);
  }

  liste(status?: FreigabeStatus | 'erledigt'): FreigabeInfo[] {
    const zeilen =
      status === 'offen'
        ? this.db.prepare("SELECT * FROM freigaben WHERE status = 'offen' ORDER BY erstellt").all()
        : status === 'erledigt'
          ? this.db.prepare("SELECT * FROM freigaben WHERE status != 'offen' ORDER BY entschieden DESC LIMIT 100").all()
          : this.db.prepare('SELECT * FROM freigaben ORDER BY erstellt DESC LIMIT 200').all();
    return (zeilen as Zeile[]).map(info);
  }

  anzahlOffen() {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM freigaben WHERE status = 'offen'").get() as { n: number }).n;
  }

  /** Genau einmal: der Statuswechsel ist atomar; ein zweiter Klick (oder ein zweites Gerät) bekommt 409. */
  async entscheiden(id: string, annehmen: boolean): Promise<FreigabeInfo> {
    const jetzt = this.uhr.jetzt();
    const r = this.db
      .prepare("UPDATE freigaben SET status = ?, entschieden = ? WHERE id = ? AND status = 'offen'")
      .run(annehmen ? 'angenommen' : 'abgelehnt', jetzt, id);
    if (r.changes !== 1) {
      this.holen(id); // 404, falls es sie nicht gibt
      throw new DorfFehler(409, 'Diese Freigabe wurde schon entschieden.');
    }
    if (annehmen) {
      const f = this.holen(id);
      const fn = this.ausfuehrer.get(f.art);
      let status: FreigabeStatus = 'ausgefuehrt';
      let ergebnis: string;
      try {
        if (!fn) throw new Error(`Kein Ausführer für „${f.art}“.`);
        ergebnis = await fn(f.inhalt as never);
      } catch (e) {
        status = 'fehlgeschlagen';
        ergebnis = (e as Error).message;
      }
      this.db.prepare('UPDATE freigaben SET status = ?, ergebnis = ? WHERE id = ?').run(status, ergebnis.slice(0, 2000), id);
    }
    await this.spiegeln(id);
    this.beiAenderung();
    const f = this.holen(id);
    await this.melden(this.beiEntscheidung, f);
    return f;
  }

  /** Markdown-Spiegel in Rathaus/freigaben/ (für Obsidian). */
  private async spiegeln(id: string) {
    const f = this.holen(id);
    const z = this.db.prepare('SELECT vault_pfad FROM freigaben WHERE id = ?').get(id) as { vault_pfad: string | null };
    const d = new Date(this.db.prepare('SELECT erstellt FROM freigaben WHERE id = ?').pluck().get(id) as number);
    const pad = (n: number) => String(n).padStart(2, '0');
    const pfad =
      z.vault_pfad ??
      `Rathaus/freigaben/${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}_${f.art.replace(/_/g, '-')}-${id.slice(0, 8)}.md`;
    const text = `---
titel: ${JSON.stringify(f.titel)}
art: ${f.art}
status: ${f.status}
gebaeude: ${f.gebaeude}
erstellt: ${f.erstellt}
${f.entschieden ? `entschieden: ${f.entschieden}\n` : ''}---

# Freigabe: ${f.titel}

**Status:** ${f.status}${f.ergebnis ? ` – ${f.ergebnis}` : ''}

## Begründung des Agenten
${f.begruendung || '–'}

## Inhalt
\`\`\`json
${JSON.stringify(f.inhalt, null, 2)}
\`\`\`

*Entschieden wird in der App (Rathaus → Freigaben), nicht in dieser Datei.*
`;
    await this.vault.schreiben(pfad, text);
    if (!z.vault_pfad) this.db.prepare('UPDATE freigaben SET vault_pfad = ? WHERE id = ?').run(pfad, id);
  }
}
