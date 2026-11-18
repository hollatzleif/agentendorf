import type { Uhr } from './uhr.js';
import type { VaultDienst } from './vault/dienst.js';
import { DorfFehler } from './fehler.js';
import { zeitpunktAus } from './todo-erinnerungen.js';

/**
 * Schnelle Notizen (E95): Gedanke festhalten, ohne ihn einzuordnen – je Tag eine Datei `Rathaus/notizen/JJJJ-MM-TT.md`
 * mit Zeilen „- HH:MM Text“. Angehängt wird mit basisVersion (bei gleichzeitigem Schreiben einmal neu versuchen).
 * Was Leif in Obsidian dazuschreibt, bleibt stehen.
 */
export const NOTIZ_ORDNER = 'Rathaus/notizen';

export class Notizen {
  constructor(private o: { uhr: Uhr; vault: VaultDienst }) {}

  pfad(tag: string) {
    return `${NOTIZ_ORDNER}/${tag}.md`;
  }

  async hinzufuegen(textRoh: string, quelle?: string) {
    const text = textRoh.replace(/\r/g, '').trim().replace(/\n+/g, ' ⏎ ').slice(0, 2000);
    if (!text) throw new DorfFehler(400, 'Die Notiz ist leer.');
    const zp = zeitpunktAus(this.o.uhr.jetzt());
    const tag = zp.slice(0, 10);
    const pfad = this.pfad(tag);
    const zeile = `- ${zp.slice(11)} ${text}${quelle ? ` _(${quelle})_` : ''}`;
    for (let versuch = 0; versuch < 2; versuch++) {
      const d = await this.o.vault.lesen(pfad).catch(() => null);
      const kopf = `# Notizen ${new Date(`${tag}T12:00:00Z`).toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}\n\n`;
      const neu = d ? `${d.inhalt.replace(/\s*$/, '')}\n${zeile}\n` : `${kopf}${zeile}\n`;
      const r = await this.o.vault.schreiben(pfad, neu, d ? { basisVersion: d.version } : { nurNeu: true }).catch((e) => (versuch === 0 ? null : Promise.reject(e)));
      if (r && !r.konflikt) return { pfad, zeile };
    }
    throw new DorfFehler(409, 'Die Notiz konnte nicht gespeichert werden – bitte noch einmal.');
  }

  /** Die letzten N Tage (neueste zuerst), nur Tage mit Notizen */
  async letzte(tage = 7) {
    const aus: { tag: string; pfad: string; zeilen: string[] }[] = [];
    for (let i = 0; i < tage; i++) {
      const tag = zeitpunktAus(this.o.uhr.jetzt() - i * 86_400_000).slice(0, 10);
      const d = await this.o.vault.lesen(this.pfad(tag)).catch(() => null);
      if (d) aus.push({ tag, pfad: this.pfad(tag), zeilen: d.inhalt.split('\n').filter((z) => /^- \d{2}:\d{2} /.test(z)) });
    }
    return aus;
  }

  async heute() {
    const pfad = this.pfad(zeitpunktAus(this.o.uhr.jetzt()).slice(0, 10));
    const d = await this.o.vault.lesen(pfad).catch(() => null);
    return { pfad, zeilen: d ? d.inhalt.split('\n').filter((z) => /^- \d{2}:\d{2} /.test(z)) : [] };
  }
}
