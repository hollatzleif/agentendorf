import type { LaufAuftrag, LaufEreignis, Motor } from './motor.js';
import { AbbruchFehler } from './motor.js';

/**
 * Motor-Attrappe für Tests und lokale Entwicklung (kein Tokenverbrauch).
 * Befehle in der Nachricht steuern das Verhalten:
 *   [schreibe <pfad>]  → ruft vault_schreiben auf
 *   [freigabe <pfad>]  → beantragt datei_loeschen
 *   [fehler]           → wirft einen Fehler
 *   [warte <ms>]       → wartet (abbrechbar)
 *   [helfer Gebäude|Auftrag]              → Bürgermeister: helfer_starten (freier Helfer; {warte ms} im Auftrag → [warte ms])
 *   [plan Gebäude|Titel; Gebäude|Titel]   → Bürgermeister: plan_vorlegen mit bestaetigen (Leif wollte einen Plan → Freigabe)
 *   [los Gebäude|Titel; Gebäude|Titel|1]  → plan_vorlegen ohne Rückfrage; dritter Teil = nach (Nummern der Vorgänger);
 *                                           {warte ms} / {fehler} / {schreibe pfad} im Titel → der Helfer wartet, scheitert bzw. schreibt
 *   [nachschub]                           → nach der Pause: nimmt Leifs nachgeschobene Nachrichten in den laufenden Lauf (wie der api-Motor)
 *   <<werkzeug name {json}>>              → beliebiges Werkzeug mit JSON-Eingabe
 *   [pause ms]                            → nach den Werkzeugen warten (abbrechbar)
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
        // {warte 5000} im Auftrag → [warte 5000] für den Helfer (eckige Klammern gehen hier nicht)
        const r = await a.werkzeuge.aufrufen('helfer_starten', { gebaeude, auftrag: (auftrag ?? 'Auftrag').replace(/\{(warte \d+)\}/g, '[$1]'), stufe: 'klein' });
        yield { typ: 'nachricht', rolle: 'werkzeug', text: `helfer_starten: ${r.text}` };
      }
      // [plan …] = Leif wollte einen Plan sehen (Freigabe); [los …] = der Bürgermeister plant von sich aus (startet sofort, E185)
      for (const [, art, inhalt] of m.matchAll(/\[(plan|los) ([^\]]+)\]/g)) {
        const teilaufgaben = inhalt!.split(';').map((t) => {
          const [gebaeude, titel, nach] = t.trim().split('|');
          const befehle = (titel ?? '').replace(/\{(warte \d+|fehler|schreibe [^}]+)\}/g, '[$1]');
          return { gebaeude, titel: (titel ?? 'Teil').replace(/\s*\{[^}]*\}/g, ''), auftrag: `Bitte erledigen: ${befehle}`, stufe: 'klein', ...(nach ? { nach: nach.split(',').map(Number) } : {}) };
        });
        const r = await a.werkzeuge.aufrufen('plan_vorlegen', { zusammenfassung: 'Testplan', begruendung: 'Test', teilaufgaben, ...(art === 'plan' ? { bestaetigen: true } : {}) });
        yield { typ: 'nachricht', rolle: 'werkzeug', text: `plan_vorlegen: ${r.text}` };
      }
      for (const [, name, json] of m.matchAll(/<<werkzeug (\w+) (\{.*?\})>>/g)) {
        const r = await a.werkzeuge.aufrufen(name!, JSON.parse(json!));
        yield { typ: 'nachricht', rolle: 'werkzeug', text: `${name}: ${r.ok ? '' : '(verweigert) '}${r.text}` };
      }
      // [pause ms]: wie [warte], aber NACH den Werkzeugen (z. B. um „gerade tut er …“ zu sehen)
      const pause = /\[pause (\d+)\]/.exec(m);
      if (pause) {
        await new Promise<void>((res, rej) => {
          const t = setTimeout(res, Number(pause[1]));
          a.signal.addEventListener('abort', () => {
            clearTimeout(t);
            rej(new AbbruchFehler());
          });
        });
      }
      if (m.includes('[nachschub]')) for (const n of a.nachschub?.() ?? []) yield { typ: 'nachricht', rolle: 'nutzer', text: n };
      const teile = ['Erledigt. ', `(${name}, ${a.modell}, ${a.anhaenge.length} Anhänge, Verlauf: ${a.verlauf.apiNachrichten.length})`];
      for (const t of teile) yield { typ: 'text', text: t };
      const antwort = `${teile.join('')}\n\n## Zusammenfassung\n### Auftrag\n${m.slice(0, 80)}\n### Getan\nTest-Lauf.\n### Entschieden\n–\n### Offen\nNichts.\n### Auffälligkeiten\n–`;
      yield { typ: 'nachricht', rolle: 'agent', text: antwort, roh: { role: 'assistant', content: [{ type: 'text', text: antwort }] } };
      if (name === 'claude-code') yield { typ: 'sitzung', id: a.verlauf.ccSitzung ?? `attrappe-${a.chatId}` };
      yield { typ: 'verbrauch', ein: 1000, aus: 200, cacheLesen: 0, cacheSchreiben: 0 };
    },
  };
}
