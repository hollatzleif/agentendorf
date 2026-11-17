import type { LaufAuftrag, LaufEreignis, Motor } from './motor.js';
import { AbbruchFehler } from './motor.js';

/**
 * Motor-Attrappe für Tests und lokale Entwicklung (kein Tokenverbrauch).
 * Befehle in der Nachricht steuern das Verhalten:
 *   [schreibe <pfad>]  → ruft vault_schreiben auf
 *   [freigabe <pfad>]  → beantragt datei_loeschen
 *   [fehler]           → wirft einen Fehler
 *   [warte <ms>]       → wartet (abbrechbar)
 *   [helfer Gebäude|Auftrag]              → Bürgermeister: helfer_starten (freier Helfer)
 *   [plan Gebäude|Titel; Gebäude|Titel]   → Bürgermeister: plan_vorlegen
 *   <<werkzeug name {json}>>              → beliebiges Werkzeug mit JSON-Eingabe
 */
export function attrappe(name: 'api' | 'claude-code'): Motor {
  return {
    name,
    async *starten(a: LaufAuftrag): AsyncIterable<LaufEreignis> {
      yield { typ: 'nachricht', rolle: 'nutzer', text: a.nachricht, roh: { role: 'user', content: a.nachricht } };
      // Befehle nur aus dem Auftrag selbst lesen, nicht aus angehängten Dateien
      const m = a.nachricht.split('\n# Anhänge')[0]!;
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
      for (const [, inhalt] of m.matchAll(/\[helfer ([^\]]+)\]/g)) {
        const [gebaeude, auftrag] = inhalt!.split('|');
        const r = await a.werkzeuge.aufrufen('helfer_starten', { gebaeude, auftrag: auftrag ?? 'Auftrag', stufe: 'klein' });
        yield { typ: 'nachricht', rolle: 'werkzeug', text: `helfer_starten: ${r.text}` };
      }
      for (const [, inhalt] of m.matchAll(/\[plan ([^\]]+)\]/g)) {
        const teilaufgaben = inhalt!.split(';').map((t) => {
          const [gebaeude, titel] = t.trim().split('|');
          return { gebaeude, titel: titel ?? 'Teil', auftrag: `Bitte erledigen: ${titel}`, stufe: 'klein' };
        });
        const r = await a.werkzeuge.aufrufen('plan_vorlegen', { zusammenfassung: 'Testplan', begruendung: 'Test', teilaufgaben });
        yield { typ: 'nachricht', rolle: 'werkzeug', text: `plan_vorlegen: ${r.text}` };
      }
      for (const [, name, json] of m.matchAll(/<<werkzeug (\w+) (\{.*?\})>>/g)) {
        const r = await a.werkzeuge.aufrufen(name!, JSON.parse(json!));
        yield { typ: 'nachricht', rolle: 'werkzeug', text: `${name}: ${r.ok ? '' : '(verweigert) '}${r.text}` };
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
