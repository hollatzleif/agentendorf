import type { DB } from '../db.js';
import type { Uhr } from '../uhr.js';
import type { TodoDienst } from '../todos.js';
import type { Uni } from './abgleich.js';
import type { VaultDienst } from '../vault/dienst.js';
import { schritteLesen } from '../todos.js';

/**
 * E130: Standard-Teilschritte für Abgaben und Prüfungen. Eigene Vorlage: `Uni/vorlagen/schritte-abgabe.md` bzw.
 * `schritte-pruefung.md` mit Zeilen „- [ ] Schritt“ – eine Datei ohne solche Zeilen schaltet die Schritte ab.
 */
export const SCHRITTE_VORLAGE = { abgabe: 'Uni/vorlagen/schritte-abgabe.md', test: 'Uni/vorlagen/schritte-pruefung.md' } as const;
export const SCHRITTE_STANDARD = {
  abgabe: ['Angabe lesen, Fragen notieren', 'Aufgaben lösen', 'Lösung sauber aufschreiben', 'In Moodle hochladen und Abgabe prüfen'],
  test: ['Stoff und Altklausuren sammeln', 'Lernplan anlegen (Prüfungs-Wächter)', 'Karteikarten wiederholen', 'Probeklausur unter Zeitdruck rechnen', 'Am Vortag: Ort, Zeit, Ausweis, Hilfsmittel prüfen'],
} as const;

/**
 * E71: Uni-Fristen (Abgaben, Prüfungen) als To-dos auf dem Marktplatz – und Abhaken in beide Richtungen.
 *
 * - Jede künftige, offene Abgabe/Prüfung bekommt GENAU EINMAL ein To-do (Tabelle uni_todos merkt sich das).
 *   Löscht Leif das To-do, kommt es nicht wieder.
 * - Verschiebt sich die Frist, zieht das Fälligkeitsdatum des To-dos nach.
 * - Abhaken: Wer sich seit dem letzten Abgleich geändert hat (To-do oder Frist), gewinnt. Gespeichert ist der
 *   zuletzt abgeglichene Stand – so lässt sich erkennen, welche Seite sich bewegt hat.
 * - Titel kommen aus Moodle/Leifs Kalender → Fremdinhalt (fremd: true), wie Rechnungen aus Mails.
 */
export class UniTodoBruecke {
  private laeuft: Promise<void> | null = null;
  private nochmal = false;

  constructor(private o: { db: DB; uhr: Uhr; uni: Uni; todos: TodoDienst; vault?: VaultDienst; log?: (t: string) => void }) {}

  /** Schritte für ein neues Abgabe-/Prüfungs-To-do: Leifs Vorlage, sonst der Standard */
  private async schritte(art: 'abgabe' | 'test'): Promise<string[]> {
    const d = this.o.vault ? await this.o.vault.lesen(SCHRITTE_VORLAGE[art]).catch(() => null) : null;
    if (d) return schritteLesen(d.inhalt).map((x) => x.text.slice(0, 200)).slice(0, 15);
    return [...SCHRITTE_STANDARD[art]];
  }

  /** Abgleichen; parallele Aufrufe werden zusammengefasst (es läuft höchstens einer, danach ggf. noch einer) */
  abgleichen(): Promise<void> {
    if (this.laeuft) {
      this.nochmal = true;
      return this.laeuft;
    }
    this.laeuft = (async () => {
      try {
        do {
          this.nochmal = false;
          await this.einmal().catch((e) => this.o.log?.(`Uni → To-dos: ${(e as Error).message}`));
        } while (this.nochmal);
      } finally {
        this.laeuft = null;
      }
    })();
    return this.laeuft;
  }

  private async einmal() {
    const { db, uhr, uni, todos } = this.o;
    const jetzt = uhr.jetzt();
    const fristen = uni.fristen().filter((f) => (f.art === 'abgabe' || f.art === 'test') && f.frist);
    const gemerkt = new Map(
      (db.prepare('SELECT frist_id, pfad, frist, erledigt FROM uni_todos').all() as { frist_id: string; pfad: string; frist: number; erledigt: number }[]).map((z) => [z.frist_id, z]),
    );
    const merken = db.prepare(
      `INSERT INTO uni_todos (frist_id, pfad, frist, erledigt) VALUES (?, ?, ?, ?)
       ON CONFLICT(frist_id) DO UPDATE SET pfad = excluded.pfad, frist = excluded.frist, erledigt = excluded.erledigt`,
    );
    const offen = new Map((await todos.liste({ alleErledigten: true })).map((t) => [t.pfad, t]));

    for (const f of fristen) {
      const frist = Date.parse(f.frist!);
      const g = gemerkt.get(f.id);
      if (!g) {
        // nur Künftiges und noch nicht Erledigtes wird neu angelegt
        if (frist <= jetzt || f.abgegeben) continue;
        const schritte = await this.schritte(f.art === 'test' ? 'test' : 'abgabe');
        const t = await todos.anlegen(
          {
            titel: `${f.art === 'test' ? 'Prüfung' : 'Abgabe'}: ${f.titel}`.slice(0, 200),
            faellig: tagInWien(frist),
            gebaeude: 'Uni',
            ...(f.kurs ? { gruppe: f.kurs.slice(0, 60) } : {}),
            notiz: `${notiz(f.art, frist, f.kurs, f.pfad)}${schritte.length ? `\n\n${schritte.map((x) => `- [ ] ${x}`).join('\n')}` : ''}`,
          },
          'Uni',
          { fremd: true },
        );
        merken.run(f.id, t.pfad, frist, 0);
        continue;
      }
      const t = offen.get(g.pfad);
      if (!t) continue; // To-do gelöscht → Leifs Entscheidung, nicht neu anlegen
      // Frist verschoben → Fälligkeit nachziehen
      if (g.frist !== frist) {
        const neu = await todos.aendern(t.pfad, { faellig: tagInWien(frist) }, t.version).catch(() => null);
        merken.run(f.id, t.pfad, frist, g.erledigt);
        if (!neu) continue;
        t.version = neu.version;
      }
      const vorher = g.erledigt === 1;
      if (t.erledigt !== vorher) {
        // Leif hat das To-do abgehakt (oder wieder geöffnet) → Frist mitziehen
        if (f.abgegeben !== t.erledigt) uni.erledigtSetzen(f.id, t.erledigt, { still: true });
        merken.run(f.id, t.pfad, frist, t.erledigt ? 1 : 0);
      } else if (f.abgegeben !== vorher) {
        // In der Uni (App, Telegram, Kalender „✅“) abgehakt → To-do mitziehen
        await todos.aendern(t.pfad, { erledigt: f.abgegeben }, t.version).catch(() => null);
        merken.run(f.id, t.pfad, frist, f.abgegeben ? 1 : 0);
      }
    }
  }
}

/** Kalendertag in Linz (Europe/Vienna) als JJJJ-MM-TT */
export function tagInWien(ms: number) {
  return new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
}

function notiz(art: string, frist: number, kurs: string, pfad: string | null) {
  const zeit = new Date(frist).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const z = [`${art === 'test' ? 'Prüfung' : 'Abgabe'} ${art === 'test' ? 'am' : 'bis'} ${zeit}${kurs ? ` – ${kurs}` : ''}.`];
  if (pfad) z.push(`Unterlagen: [[${pfad}]]`);
  z.push('Automatisch aus den Uni-Fristen. Abhaken hier hakt auch die Frist in der Uni ab.');
  return z.join('\n\n');
}
