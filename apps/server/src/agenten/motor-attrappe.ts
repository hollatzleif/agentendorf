import type { LaufAuftrag, LaufEreignis, Motor } from './motor.js';
import { AbbruchFehler } from './motor.js';

/**
 * Motor-Attrappe für Tests und lokale Entwicklung (kein Tokenverbrauch).
 * Befehle in der Nachricht steuern das Verhalten:
 *   [schreibe <pfad>]  → ruft vault_schreiben auf
 *   [freigabe <pfad>]  → beantragt datei_loeschen
 *   [fehler]           → wirft einen Fehler
 *   [warte <ms>]       → wartet (abbrechbar)
 */
export function attrappe(name: 'api' | 'claude-code'): Motor {
  return {
    name,
    async *starten(a: LaufAuftrag): AsyncIterable<LaufEreignis> {
      const m = a.nachricht;
      yield { typ: 'nachricht', rolle: 'nutzer', text: m, roh: { role: 'user', content: m } };
      const warte = /\[warte (\d+)\]/.exec(m);
      if (warte) {
        await new Promise<void>((res, rej) => {
          const t = setTimeout(res, Number(warte[1]));
          a.signal.addEventListener('abort', () => {
            clearTimeout(t);
            rej(new AbbruchFehler());
          });
        });
      }
      if (m.includes('[fehler]')) throw new Error('Attrappe: absichtlicher Fehler');
      for (const [, p] of m.matchAll(/\[schreibe ([^\]]+)\]/g)) {
        const r = await a.werkzeuge.aufrufen('vault_schreiben', { pfad: p, inhalt: `# Von der Attrappe\n\n${m}` });
        yield { typ: 'nachricht', rolle: 'werkzeug', text: `vault_schreiben ${p}: ${r.text}` };
      }
      for (const [, p] of m.matchAll(/\[freigabe ([^\]]+)\]/g)) {
        const r = await a.werkzeuge.aufrufen('freigabe_beantragen', { art: 'datei_loeschen', titel: `${p} löschen`, begruendung: 'Test', inhalt: { pfad: p } });
        yield { typ: 'nachricht', rolle: 'werkzeug', text: `freigabe_beantragen: ${r.text}` };
      }
      const teile = ['Erledigt. ', `(${name}, ${a.modell}, ${a.anhaenge.length} Anhänge, Verlauf: ${a.verlauf.apiNachrichten.length})`];
      for (const t of teile) yield { typ: 'text', text: t };
      const antwort = `${teile.join('')}\n\n## Zusammenfassung\n### Auftrag\n${m.slice(0, 80)}\n### Getan\nTest-Lauf.\n### Entschieden\n–\n### Offen\nNichts.\n### Auffälligkeiten\n–`;
      yield { typ: 'nachricht', rolle: 'agent', text: antwort, roh: { role: 'assistant', content: [{ type: 'text', text: antwort }] } };
      if (name === 'claude-code') yield { typ: 'sitzung', id: a.verlauf.ccSitzung ?? `attrappe-${a.chatId}` };
      yield { typ: 'verbrauch', ein: 1000, aus: 200, cacheLesen: 0, cacheSchreiben: 0 };
    },
  };
}
