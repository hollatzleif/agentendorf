import Anthropic from '@anthropic-ai/sdk';
import type { BetaContentBlock, BetaContentBlockParam, BetaMessage, BetaMessageParam, BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { AbbruchFehler, type LaufAuftrag, type LaufEreignis, type Motor } from './motor.js';

/** Schmale Schnittstelle zum Modell, damit Tests ohne Netz und ohne Token laufen. */
export interface ModellKlient {
  streamen(params: Anthropic.Beta.Messages.MessageCreateParamsStreaming | Omit<Anthropic.Beta.Messages.MessageCreateParamsNonStreaming, 'stream'>, signal: AbortSignal, beiText: (t: string) => void): Promise<BetaMessage>;
}

export function sdkKlient(apiKey: string): ModellKlient {
  const client = new Anthropic({ apiKey, maxRetries: 3, timeout: 15 * 60 * 1000 });
  return {
    async streamen(params, signal, beiText) {
      const s = client.beta.messages.stream(params as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming, { signal });
      s.on('text', beiText);
      return s.finalMessage();
    },
  };
}

const MAX_RUNDEN = 40;
const BETAS = ['server-side-fallback-2026-07-01'];

function textAus(content: BetaContentBlock[]) {
  return content
    .filter((b): b is Extract<BetaContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/** Strict-Werkzeuge verlangen: jedes Objekt im Schema hat additionalProperties: false (rekursiv). */
export function strictTauglich(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') return true;
  const o = schema as Record<string, unknown>;
  if (o.type === 'object' && o.additionalProperties !== false) return false;
  for (const w of Object.values((o.properties as Record<string, unknown>) ?? {})) if (!strictTauglich(w)) return false;
  if (o.items && !strictTauglich(o.items)) return false;
  return true;
}

/**
 * Grenzen der API für strict-Werkzeuge in EINER Anfrage (sonst 400 „too many optional parameters“ o. ä.):
 * höchstens 20 strict-Werkzeuge, zusammen höchstens 24 optionale Felder und 16 Felder mit Typ-Vereinigung (anyOf/Typ-Liste).
 */
export const STRICT_GRENZEN = { werkzeuge: 20, optional: 24, vereinigungen: 16 } as const;

/** Zählt optionale Felder (properties ohne required) und Typ-Vereinigungen rekursiv. */
export function schemaZaehlen(schema: unknown): { optional: number; vereinigungen: number } {
  const z = { optional: 0, vereinigungen: 0 };
  const geh = (x: unknown) => {
    if (!x || typeof x !== 'object') return;
    const o = x as Record<string, unknown>;
    if (Array.isArray(o.type) && o.type.length > 1) z.vereinigungen++;
    for (const k of ['anyOf', 'oneOf'] as const) {
      if (Array.isArray(o[k])) {
        z.vereinigungen++;
        (o[k] as unknown[]).forEach(geh);
      }
    }
    const props = (o.properties as Record<string, unknown>) ?? {};
    const pflicht = new Set(Array.isArray(o.required) ? (o.required as string[]) : []);
    for (const [name, w] of Object.entries(props)) {
      if (!pflicht.has(name)) z.optional++;
      geh(w);
    }
    if (o.items) geh(o.items);
  };
  geh(schema);
  return z;
}

/**
 * Welche Werkzeuge strict bekommen: nur strict-taugliche, und nur so viele, dass die API-Grenzen eingehalten werden.
 * Sparsame Werkzeuge (wenige optionale Felder) zuerst – so bleiben möglichst viele strict; der Rest läuft ohne
 * strict (die WerkzeugKiste prüft die Eingaben ohnehin selbst mit Zod). Reihenfolge der Werkzeuge bleibt unverändert.
 */
export function strictAuswahl(defs: { name: string; input_schema: unknown }[]): Set<string> {
  const kandidaten = defs
    .filter((d) => strictTauglich(d.input_schema))
    .map((d) => ({ name: d.name, ...schemaZaehlen(d.input_schema) }))
    .sort((a, b) => a.optional + a.vereinigungen - (b.optional + b.vereinigungen) || a.name.localeCompare(b.name));
  const gewaehlt = new Set<string>();
  let optional = 0;
  let vereinigungen = 0;
  for (const k of kandidaten) {
    if (gewaehlt.size >= STRICT_GRENZEN.werkzeuge) break;
    if (optional + k.optional > STRICT_GRENZEN.optional || vereinigungen + k.vereinigungen > STRICT_GRENZEN.vereinigungen) continue;
    gewaehlt.add(k.name);
    optional += k.optional;
    vereinigungen += k.vereinigungen;
  }
  return gewaehlt;
}

function alsBloecke(c: BetaMessageParam['content']): BetaContentBlockParam[] {
  if (!c) return [];
  return typeof c === 'string' ? [{ type: 'text', text: c }] : (c as BetaContentBlockParam[]);
}

/**
 * api-Motor: eigene Streaming-Schleife über die Anthropic API (Beta-Endpunkt wegen serverseitiger Ausweichmodelle).
 * - Verlauf wird nur angehängt, nie verändert (Antworten unverändert zurückgeben – wichtig für Opus 5.5 / Fable 5.2).
 * - Jeder Werkzeugaufruf geht durch die WerkzeugKiste (Leine + Log).
 * - Web nur über Anthropics Server-Werkzeuge und nur, wenn die Aktion es darf.
 */
export function apiMotor(klientFabrik: () => ModellKlient): Motor {
  return {
    name: 'api',
    async *starten(a: LaufAuftrag): AsyncIterable<LaufEreignis> {
      const klient = klientFabrik();
      const verlauf = a.verlauf.apiNachrichten as BetaMessageParam[];
      const nachrichten: BetaMessageParam[] = [...verlauf];

      // Neue Nachricht: Anhänge (PDF/Bilder) vor den Text, wie empfohlen.
      const neu: BetaContentBlockParam[] = [];
      for (const an of a.anhaenge) {
        if (an.art === 'pdf' && an.base64)
          neu.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: an.base64 }, title: an.pfad });
        if (an.art === 'bild' && an.base64)
          neu.push({ type: 'image', source: { type: 'base64', media_type: an.mime as 'image/png', data: an.base64 } });
      }
      const vorspann = a.verlauf.textVerlauf ? `Bisheriger Verlauf dieses Chats (mit einem anderen Motor geführt):\n\n${a.verlauf.textVerlauf}\n\n---\n\n` : '';
      neu.push({ type: 'text', text: vorspann + a.nachricht });

      // Endete der letzte Lauf mitten in Werkzeugaufrufen, fehlen tool_results – die tragen wir nach (nur anhängen).
      const letzte = nachrichten.at(-1);
      const offen = letzte?.role === 'assistant' ? alsBloecke(letzte.content).filter((b) => b.type === 'tool_use') : [];
      const nachtrag: BetaContentBlockParam[] = offen.map((b) => ({
        type: 'tool_result',
        tool_use_id: (b as { id: string }).id,
        is_error: true,
        content: 'Der Lauf wurde unterbrochen, dieses Werkzeug wurde nicht ausgeführt.',
      }));
      const nutzerNachricht: BetaMessageParam = { role: 'user', content: [...nachtrag, ...neu] };
      if (letzte?.role === 'user') {
        // zwei Nutzer-Nachrichten hintereinander zusammenführen (vorheriger Lauf ohne Antwort)
        nachrichten[nachrichten.length - 1] = { role: 'user', content: [...alsBloecke(letzte.content), ...nutzerNachricht.content as BetaContentBlockParam[]] };
      } else nachrichten.push(nutzerNachricht);
      yield { typ: 'nachricht', rolle: 'nutzer', text: a.nachricht, roh: nutzerNachricht };

      // strict nur, wo das Schema es erlaubt (jedes Objekt mit fester Feldliste) und innerhalb der API-Grenzen
      // (E180: sonst 400 „too many optional parameters“). Die Eingaben prüft die WerkzeugKiste ohnehin selbst (Zod).
      const defs = a.werkzeuge.definitionen();
      const strict = strictAuswahl(defs);
      const werkzeuge: BetaToolUnion[] = defs.map((d) => ({ ...d, ...(strict.has(d.name) ? { strict: true } : {}) }) as BetaToolUnion);
      if (a.web) {
        werkzeuge.push({ type: 'web_search_20260209', name: 'web_search', max_uses: 8 } as BetaToolUnion);
        werkzeuge.push({ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 8 } as BetaToolUnion);
      }

      for (let runde = 0; runde < MAX_RUNDEN; runde++) {
        if (a.signal.aborted) throw new AbbruchFehler();
        let antwort: BetaMessage;
        try {
          antwort = await klient.streamen(
            {
              model: a.modell,
              max_tokens: 64000,
              system: a.system,
              messages: nachrichten,
              tools: werkzeuge,
              output_config: { effort: a.aufwand },
              cache_control: { type: 'ephemeral' },
              betas: BETAS,
              fallbacks: 'default',
            } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
            a.signal,
            a.liveText,
          );
        } catch (e) {
          if (a.signal.aborted || e instanceof Anthropic.APIUserAbortError) throw new AbbruchFehler();
          if (e instanceof Anthropic.AuthenticationError) throw new Error('API-Schlüssel ungültig (ANTHROPIC_API_KEY).');
          if (e instanceof Anthropic.RateLimitError) throw new Error('API-Ratenlimit erreicht – später erneut versuchen.');
          if (e instanceof Anthropic.APIError) throw new Error(`API-Fehler ${e.status ?? ''}: ${e.message}`);
          throw e;
        }
        const u = antwort.usage;
        yield {
          typ: 'verbrauch',
          ein: u.input_tokens ?? 0,
          aus: u.output_tokens ?? 0,
          cacheLesen: u.cache_read_input_tokens ?? 0,
          cacheSchreiben: u.cache_creation_input_tokens ?? 0,
        };
        const assistent: BetaMessageParam = { role: 'assistant', content: antwort.content as unknown as BetaContentBlockParam[] };
        nachrichten.push(assistent);
        const text = textAus(antwort.content);
        yield { typ: 'nachricht', rolle: 'agent', text, roh: assistent };
        for (const b of antwort.content) if (b.type === 'server_tool_use') a.werkzeuge.extern(b.name, b.input, 'web');

        if (antwort.stop_reason === 'pause_turn') continue;
        if (antwort.stop_reason === 'refusal') {
          const d = antwort.stop_details as { category?: string | null } | null;
          throw new Error(`Das Modell hat die Anfrage abgelehnt${d?.category ? ` (${d.category})` : ''}.`);
        }
        if (antwort.stop_reason === 'max_tokens') throw new Error('Antwort wurde bei max_tokens abgeschnitten.');
        const aufrufe = antwort.content.filter((b): b is Extract<BetaContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
        if (antwort.stop_reason !== 'tool_use' || aufrufe.length === 0) return;

        const ergebnisse: BetaContentBlockParam[] = [];
        const kurz: string[] = [];
        for (const t of aufrufe) {
          if (a.signal.aborted) throw new AbbruchFehler();
          const r = await a.werkzeuge.aufrufen(t.name, t.input);
          const inhalt = r.bilder?.length
            ? [
                { type: 'text' as const, text: r.text },
                ...r.bilder.map((b) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: b.mime, data: b.base64 } })),
              ]
            : r.text;
          ergebnisse.push({ type: 'tool_result', tool_use_id: t.id, content: inhalt, ...(r.ok ? {} : { is_error: true }) });
          kurz.push(`${t.name}${r.ok ? '' : ' (verweigert)'}: ${r.text.slice(0, 200)}`);
        }
        // E185: Hat Leif während des Laufs etwas nachgeschoben, bekommt das Modell es gleich mit den Werkzeug-Ergebnissen
        // (Textblock hinter den tool_result-Blöcken derselben Nutzer-Nachricht – der Verlauf bleibt „nur angehängt“).
        const nachschub = a.nachschub?.() ?? [];
        if (nachschub.length) ergebnisse.push({ type: 'text', text: `Neu eingetroffen, während du arbeitest (berücksichtige es ab jetzt):\n\n${nachschub.join('\n\n---\n\n')}` });
        const werkzeugNachricht: BetaMessageParam = { role: 'user', content: ergebnisse };
        nachrichten.push(werkzeugNachricht);
        yield { typ: 'nachricht', rolle: 'werkzeug', text: kurz.join('\n'), roh: werkzeugNachricht };
        for (const n of nachschub) yield { typ: 'nachricht', rolle: 'nutzer', text: n };
      }
      throw new Error(`Abgebrochen nach ${MAX_RUNDEN} Werkzeug-Runden.`);
    },
  };
}
