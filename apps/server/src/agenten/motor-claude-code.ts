import crypto from 'node:crypto';
import { AbbruchFehler, type LaufAuftrag, type LaufEreignis, type Motor } from './motor.js';
import type { WerkzeugRegister } from './register.js';
import type { WerkzeugKiste } from './werkzeuge.js';

const VAULT = '/vault';

/** Übersetzt die stream-json-Zeilen des claude-CLI in Lauf-Ereignisse. */
export class CcParser {
  sitzung?: string;
  ergebnis?: { text: string; fehler: boolean; subtype: string; gruende: string[] };
  private texte: string[] = [];
  ende?: { code: number | null; signal: string | null; stderr: string };

  constructor(
    private kiste: Pick<WerkzeugKiste, 'extern'>,
    private live: (t: string) => void,
  ) {}

  zeile(o: Record<string, unknown>): LaufEreignis[] {
    const aus: LaufEreignis[] = [];
    switch (o.type) {
      case 'system':
        if (o.subtype === 'init' && typeof o.session_id === 'string') this.sitzung = o.session_id;
        break;
      case 'stream_event': {
        const e = o.event as { type?: string; delta?: { type?: string; text?: string } } | undefined;
        if (o.parent_tool_use_id == null && e?.type === 'content_block_delta' && e.delta?.type === 'text_delta' && e.delta.text) this.live(e.delta.text);
        break;
      }
      case 'assistant': {
        if (o.parent_tool_use_id != null) break;
        const m = o.message as { content?: { type: string; text?: string; name?: string; input?: Record<string, unknown> }[] };
        for (const b of m?.content ?? []) {
          if (b.type === 'text' && b.text) this.texte.push(b.text);
          if (b.type === 'tool_use' && b.name) {
            if (b.name === 'WebSearch' || b.name === 'WebFetch') this.kiste.extern(b.name, b.input, 'web');
            else if (b.name === 'Read' || b.name === 'Grep' || b.name === 'Glob') {
              const p = String(b.input?.file_path ?? b.input?.path ?? '');
              this.kiste.extern(b.name, b.input, 'gelesen', p.startsWith(`${VAULT}/`) ? p.slice(VAULT.length + 1) : undefined);
            } else if (b.name === 'Bash') {
              // nur Codehaus (E191): jeder Befehl steht im werkzeug_log
              this.kiste.extern(b.name, { command: String(b.input?.command ?? '').slice(0, 2000) }, 'befehl');
            } else if (b.name === 'Edit' || b.name === 'Write' || b.name === 'NotebookEdit') {
              const p = String(b.input?.file_path ?? b.input?.notebook_path ?? '');
              // Inhalt nicht ins Log (kann groß sein) – nur der Pfad; Vault-Pfade wie bei vault_schreiben
              this.kiste.extern(b.name, { file_path: p }, 'geschrieben', p.startsWith(`${VAULT}/`) ? p.slice(VAULT.length + 1) : undefined);
            }
          }
        }
        break;
      }
      case 'result': {
        const u = (o.usage ?? {}) as Record<string, number>;
        aus.push({
          typ: 'verbrauch',
          ein: u.input_tokens ?? 0,
          aus: u.output_tokens ?? 0,
          cacheLesen: u.cache_read_input_tokens ?? 0,
          cacheSchreiben: u.cache_creation_input_tokens ?? 0,
        });
        // Bei Abbrüchen nennt das CLI den eigentlichen Grund in `errors` (z. B. API-Fehler) – den wollen wir sehen
        const gruende = Array.isArray(o.errors) ? (o.errors as unknown[]).map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).filter(Boolean) : [];
        this.ergebnis = {
          text: typeof o.result === 'string' ? o.result : this.texte.join('\n\n'),
          fehler: o.is_error === true || o.subtype !== 'success',
          subtype: String(o.subtype),
          gruende,
        };
        if (typeof o.session_id === 'string') this.sitzung = o.session_id;
        break;
      }
      case 'werkstatt_ende':
        this.ende = { code: (o.code as number) ?? null, signal: (o.signal as string) ?? null, stderr: String(o.stderr ?? '') };
        break;
    }
    return aus;
  }

  /** Text der Antwort (für Chat und Protokoll) */
  antwort() {
    return this.ergebnis?.text || this.texte.join('\n\n');
  }
}

export function fehlerErklaeren(text: string, coding = false) {
  if (/oauth|login|authenticat|401|token.*(expired|invalid)/i.test(text))
    return `Claude-Abo-Anmeldung fehlt oder ist abgelaufen. Auf dem Server: ${coding ? 'dorf coding-einrichten' : 'dorf claude-anmelden'}`;
  if (/rate.?limit|usage limit|429/i.test(text)) return 'Abo-Nutzungsgrenze erreicht – später erneut versuchen oder die Aktion auf motor: api umstellen.';
  return text.slice(-800);
}

/**
 * claude-code-Motor: schickt den Auftrag an die Werkstatt (eigener Container, Vault nur lesbar),
 * dort läuft das unveränderte claude-CLI mit Leifs Abo. Schreiben/Freigaben gehen per MCP zurück ins Dorf.
 */
export function claudeCodeMotor(o: { url: string; geheimnis: string; register: WerkzeugRegister }): Motor {
  return runnerMotor({ ...o, name: 'claude-code' });
}

/**
 * coding-Motor (E191, Codehaus): derselbe Runner, aber im Coding-Container (Profil „coding“ – das legt der Container fest,
 * nicht dieser Auftrag). Dort hat claude Bash/Edit/Write, Internet, GitHub und den Vault beschreibbar. Eigene Adresse,
 * eigenes Geheimnis; die Werkstatt bleibt, wie sie ist.
 */
export function codingMotor(o: { url: string; geheimnis: string; register: WerkzeugRegister }): Motor {
  return runnerMotor({ ...o, name: 'coding' });
}

const ARBEIT = '/arbeit';
export const PROJEKT_MUSTER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function runnerMotor(o: { name: 'claude-code' | 'coding'; url: string; geheimnis: string; register: WerkzeugRegister }): Motor {
  const coding = o.name === 'coding';
  const ort = coding ? 'Codehaus' : 'Werkstatt';
  return {
    name: o.name,
    async *starten(a: LaufAuftrag): AsyncIterable<LaufEreignis> {
      const { token, abmelden } = o.register.anmelden(a.werkzeuge);
      const sitzung = a.verlauf.ccSitzung
        ? { art: 'fortsetzen' as const, id: a.verlauf.ccSitzung }
        : { art: 'neu' as const, id: crypto.randomUUID() };
      yield { typ: 'sitzung', id: sitzung.id };
      const vorspann = a.verlauf.textVerlauf ? `Bisheriger Verlauf dieses Chats (mit einem anderen Motor geführt):\n\n${a.verlauf.textVerlauf}\n\n---\n\n` : '';
      const binaer = a.anhaenge.filter((x) => x.art !== 'text' && !x.umgewandelt);
      // E190: Bilder aus Umwandlungen (Standbilder, HEIC → PNG …) liegen nicht im Vault – vault_lesen zeigt sie
      const umgewandelt = [...new Set(a.anhaenge.filter((x) => x.umgewandelt).map((x) => x.pfad))];
      const nachricht =
        vorspann +
        a.nachricht +
        (binaer.length ? `\n\nPDFs und Bilder öffnest du mit Read: ${binaer.map((x) => `${VAULT}/${x.pfad}`).join(', ')}` : '') +
        (umgewandelt.length ? `\n\nBilder zu diesen Anhängen zeigt dir mcp__dorf__vault_lesen: ${umgewandelt.join(', ')}` : '');
      yield { typ: 'nachricht', rolle: 'nutzer', text: a.nachricht };
      if (coding && a.projekt && !PROJEKT_MUSTER.test(a.projekt))
        throw new Error(`„${a.projekt.slice(0, 80)}“ ist kein Projektordner. Erlaubt ist ein einzelner Ordnername unter ${ARBEIT} (Buchstaben, Ziffern, Punkt, _ und -), z. B. agentendorf.`);
      const projekt = coding ? a.projekt : undefined;
      const system = coding
        ? `${a.system}

<codehaus>
Du arbeitest im Codehaus: ein eigener Container mit Shell (Bash), Dateizugriff (Read, Edit, Write, Glob, Grep) und Internet (npm, pip, git).
- Arbeitsordner: ${projekt ? `${ARBEIT}/${projekt}` : ARBEIT}. Alle Projekte liegen unter ${ARBEIT}/<name> – je Projekt ein Ordner, nichts direkt in ${ARBEIT} ablegen. Ordner, die mit einem Punkt beginnen (${ARBEIT}/.heim, ${ARBEIT}/.tmp), fasst du nicht an.
- Git und GitHub sind eingerichtet (git, gh): klonen, Branches, committen, pushen, Pull Requests anlegen und mergen sind erlaubt. Arbeite auf einem eigenen Branch und über einen Pull Request, wenn das Repository nicht dir allein gehört oder Leif es nicht anders verlangt; force-push und das Löschen von Repositories oder fremden Branches nur, wenn Leif es ausdrücklich verlangt.
- Vor dem Abschluss: Tests/Build des Projekts laufen lassen und das Ergebnis ehrlich nennen.
- Der Vault liegt unter ${VAULT} und ist les- und schreibbar. Dort gelten Stadtordnung und Arbeitsanweisungen weiter: Dateien anderer Gebäude, \`00_Stadtordnung/\`, \`aktionen/\`, \`protokolle/\`, \`chats/\` und \`gebaeude.md\` änderst du nur, wenn Leif es in diesem Auftrag verlangt.
- To-dos, Termine, Notizen, Entwürfe und Freigaben gehen weiter über die Werkzeuge mcp__dorf__* (Pfade dort relativ zum Vault).
- Geheimnisse (Token, Schlüssel) schreibst du nie in Dateien, Commits, Ausgaben oder Web-Adressen.
</codehaus>`
        : `${a.system}

<werkstatt>
Der Vault liegt unter ${VAULT} und ist nur lesbar (Read, Glob, Grep). Schreiben, Suchen und Freigaben gehen ausschließlich über die Werkzeuge mcp__dorf__* (Pfade dort relativ zum Vault).
</werkstatt>`;

      const kopf = { 'x-werkstatt-geheimnis': o.geheimnis, 'content-type': 'application/json' };
      const beiAbbruch = () => void fetch(`${o.url}/laeufe/${a.laufId}`, { method: 'DELETE', headers: kopf }).catch(() => undefined);
      a.signal.addEventListener('abort', beiAbbruch);
      const parser = new CcParser(a.werkzeuge, a.liveText);
      try {
        let r: Response;
        try {
          r = await fetch(`${o.url}/laeufe`, {
            method: 'POST',
            headers: kopf,
            body: JSON.stringify({ laufId: a.laufId, modell: a.modell, aufwand: a.aufwand, system, nachricht, sitzung, web: a.web, werkzeugToken: token, ...(projekt ? { projekt } : {}) }),
          });
        } catch (e) {
          throw new Error(`${ort} nicht erreichbar (${(e as Error).message}). Läuft der Container „${coding ? 'coding' : 'werkstatt'}“?${coding ? ' Auf dem Server: dorf coding-einrichten' : ''}`);
        }
        if (!r.ok || !r.body) throw new Error(`${ort} lehnt ab (${r.status}): ${await r.text()}`);
        let puffer = '';
        for await (const stueck of r.body.pipeThrough(new TextDecoderStream())) {
          puffer += stueck;
          let i;
          while ((i = puffer.indexOf('\n')) >= 0) {
            const z = puffer.slice(0, i).trim();
            puffer = puffer.slice(i + 1);
            if (!z) continue;
            let obj: Record<string, unknown>;
            try {
              obj = JSON.parse(z);
            } catch {
              continue;
            }
            for (const e of parser.zeile(obj)) yield e;
          }
        }
      } finally {
        a.signal.removeEventListener('abort', beiAbbruch);
        abmelden();
      }
      if (parser.sitzung && parser.sitzung !== sitzung.id) yield { typ: 'sitzung', id: parser.sitzung };
      if (a.signal.aborted) throw new AbbruchFehler();
      if (!parser.ergebnis) throw new Error(fehlerErklaeren(parser.ende?.stderr || `claude beendet ohne Ergebnis (Code ${parser.ende?.code ?? '?'})`, coding));
      const text = parser.antwort();
      yield { typ: 'nachricht', rolle: 'agent', text };
      if (parser.ergebnis.fehler) {
        // Grund des Abbruchs: errors aus dem Ergebnis, sonst das Ende der CLI-Ausgabe (stderr); erst dann der letzte Text
        const stderr = (parser.ende?.stderr ?? '').trim().split('\n').slice(-6).join(' | ').slice(-600);
        const grund = parser.ergebnis.gruende.join('; ').slice(0, 800) || stderr || text;
        throw new Error(fehlerErklaeren(`${parser.ergebnis.subtype}: ${grund}`, coding));
      }
    },
  };
}
