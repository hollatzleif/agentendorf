import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { apiMotor, schemaZaehlen, type ModellKlient } from '../src/agenten/motor-api.js';
import { attrappe } from '../src/agenten/motor-attrappe.js';
import { testDorf } from './hilfen.js';

type Antwort = Partial<BetaMessage> & { content: BetaMessage['content']; stop_reason: BetaMessage['stop_reason'] };

/** Nachgebautes Modell: gibt vorbereitete Antworten zurück und merkt sich jede Anfrage. */
function nachbau(antworten: (Antwort | Error)[]) {
  const anfragen: Record<string, unknown>[] = [];
  const klient: ModellKlient = {
    async streamen(params, signal, beiText) {
      anfragen.push(structuredClone(params) as Record<string, unknown>);
      if (signal.aborted) throw new Error('abort');
      const a = antworten.shift();
      if (!a) throw new Error('keine Antwort mehr vorbereitet');
      if (a instanceof Error) throw a;
      for (const b of a.content) if (b.type === 'text') beiText(b.text);
      return {
        id: 'msg',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 },
        ...a,
      } as BetaMessage;
    },
  };
  return { klient, anfragen };
}

async function dorfMit(antworten: (Antwort | Error)[], kopf = 'motor: api\nwerkzeuge: [vault_lesen, vault_schreiben]') {
  const n = nachbau(antworten);
  const d = await testDorf({ motoren: { api: apiMotor(() => n.klient), 'claude-code': attrappe('claude-code') } });
  fs.writeFileSync(path.join(d.vault.wurzel, 'Uni/aktionen/a.md'), `---\nname: A\n${kopf}\n---\nTu was.`);
  return { ...d, ...n };
}

const text = (t: string) => ({ type: 'text' as const, text: t, citations: null });

describe('api-Motor', () => {
  it('Werkzeug-Schleife mit Leine, Token-Zählung, Verlauf beim Fortsetzen unverändert', async () => {
    const thinking = { type: 'thinking' as const, thinking: '', signature: 'sig-abc' };
    const d = await dorfMit([
      {
        content: [
          thinking,
          text('Ich schreibe.'),
          { type: 'tool_use', id: 't1', name: 'vault_schreiben', input: { pfad: 'Uni/2026-11-16_1200_x.md', inhalt: 'Hallo' }, caller: { type: 'direct' } },
          { type: 'tool_use', id: 't2', name: 'vault_schreiben', input: { pfad: 'Post/2026-11-16_1200_x.md', inhalt: 'Nein' }, caller: { type: 'direct' } },
        ] as BetaMessage['content'],
        stop_reason: 'tool_use',
      },
      { content: [text('Fertig.\n\n## Zusammenfassung\n### Offen\nNichts.')], stop_reason: 'end_turn' },
      { content: [text('Zweite Antwort.')], stop_reason: 'end_turn' },
    ]);
    const { chatId } = await d.agenten.aktionStarten('Uni/a', {});
    await d.agenten.leerlauf();
    const c = d.agenten.chatDetail(chatId);
    expect(c.laeufe[0]).toMatchObject({ status: 'fertig', einToken: 200, ausToken: 100, cacheLesen: 20, cacheSchreiben: 10 });
    expect(await d.vault.existiert('Uni/2026-11-16_1200_x.md')).toBe(true);
    expect(await d.vault.existiert('Post/2026-11-16_1200_x.md')).toBe(false);

    // Zweite Anfrage enthält die tool_results, eines davon als Fehler
    const zweite = d.anfragen[1]!.messages as { role: string; content: { type: string; is_error?: boolean }[] }[];
    const ergebnisse = zweite.at(-1)!.content;
    expect(ergebnisse.map((b) => [b.type, !!b.is_error])).toEqual([
      ['tool_result', false],
      ['tool_result', true],
    ]);
    // Parameter: Ausweichmodelle, Caching, Aufwand aus der Stufe, keine erzwungene Werkzeugwahl, strikte Werkzeuge, kein Web
    const p = d.anfragen[0]!;
    expect(p).toMatchObject({ fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'], cache_control: { type: 'ephemeral' }, output_config: { effort: 'high' }, model: 'claude-opus-5-5' });
    expect(p.tool_choice).toBeUndefined();
    expect((p.tools as { name: string; strict?: boolean }[]).map((t) => t.name)).toEqual(['vault_lesen', 'vault_liste', 'vault_suchen', 'freigabe_beantragen', 'todo_liste', 'todo_anlegen', 'todo_bearbeiten', 'todo_loeschen', 'kirchturm_lesen', 'kirchturm_timer', 'kirchturm_wecker', 'pomodoro', 'pomodoro_einstellen', 'notiz_anlegen', 'termin_vorschlagen', 'vault_schreiben']);
    // Regel der echten API: Bei strict muss JEDES Objekt im Schema additionalProperties: false haben
    // (am 17.11.2026 hat die API genau das für freigabe_beantragen mit 400 abgelehnt).
    const objekteOhneFesteFelder = (s: unknown): boolean => {
      if (!s || typeof s !== 'object') return false;
      const o = s as Record<string, unknown>;
      if (o.type === 'object' && o.additionalProperties !== false) return true;
      return Object.values((o.properties as object) ?? {}).some(objekteOhneFesteFelder) || objekteOhneFesteFelder(o.items);
    };
    for (const t of p.tools as { name: string; strict?: boolean; input_schema: unknown }[]) {
      if (t.strict) expect(objekteOhneFesteFelder(t.input_schema), `${t.name} ist strict, aber nicht strict-tauglich`).toBe(false);
    }
    expect((p.tools as { name: string; strict?: boolean }[]).filter((t) => t.strict).map((t) => t.name)).toEqual([
      'vault_lesen',
      'vault_liste',
      'vault_suchen',
      'todo_liste',
      'todo_loeschen',
      'kirchturm_lesen',
      'kirchturm_timer',
      'kirchturm_wecker',
      'pomodoro',
      'pomodoro_einstellen',
      'notiz_anlegen',
      'termin_vorschlagen',
      'vault_schreiben',
    ]);
    // E180: zusammen höchstens 24 optionale Felder in strict-Werkzeugen (sonst 400) – todo_bearbeiten und (seit E183)
    // todo_anlegen laufen ohne strict, ihre Eingaben prüft die WerkzeugKiste mit Zod
    const optional = (p.tools as { strict?: boolean; input_schema: unknown }[]).filter((t) => t.strict).reduce((n, t) => n + schemaZaehlen(t.input_schema).optional, 0);
    expect(optional).toBeLessThanOrEqual(24);
    expect((p.system as string)).toContain('<stadtordnung>');

    // Fortsetzen: die frühere Antwort (inkl. Thinking-Block mit Signatur) wird byte-gleich mitgeschickt
    d.agenten.nachrichtSenden(chatId, 'Noch was?');
    await d.agenten.leerlauf();
    const dritte = d.anfragen[2]!.messages as { role: string; content: unknown[] }[];
    expect(dritte.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(dritte[1]!.content[0]).toEqual(thinking);
    expect(JSON.stringify(dritte.slice(0, 4))).toBe(JSON.stringify((d.anfragen[1]!.messages as unknown[]).concat([dritte[3]])));
  });

  it('Web nur, wenn die Aktion es darf', async () => {
    const d = await dorfMit([{ content: [text('ok')], stop_reason: 'end_turn' }], 'motor: api\nwerkzeuge: [vault_lesen, web]');
    await d.agenten.aktionStarten('Uni/a', {});
    await d.agenten.leerlauf();
    const namen = (d.anfragen[0]!.tools as { name: string; type?: string }[]).map((t) => t.type ?? t.name);
    expect(namen).toContain('web_search_20260209');
    expect(namen).toContain('web_fetch_20260209');
    expect(namen).not.toContain('vault_schreiben');
  });

  it('pause_turn wird fortgesetzt; refusal und max_tokens werden zu Fehlern', async () => {
    const d = await dorfMit([
      { content: [text('Suche …')], stop_reason: 'pause_turn' },
      { content: [text('Fertig.')], stop_reason: 'end_turn' },
      { content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: null } } as unknown as Antwort,
      { content: [text('abgeschn')], stop_reason: 'max_tokens' },
    ]);
    const a = await d.agenten.aktionStarten('Uni/a', {});
    await d.agenten.leerlauf();
    expect(d.agenten.chatDetail(a.chatId).laeufe[0]!.status).toBe('fertig');
    expect(d.anfragen).toHaveLength(2);
    const b = await d.agenten.aktionStarten('Uni/a', {});
    await d.agenten.leerlauf();
    expect(d.agenten.chatDetail(b.chatId).laeufe[0]).toMatchObject({ status: 'fehler', fehler: expect.stringMatching(/abgelehnt \(cyber\)/) });
    const c = await d.agenten.aktionStarten('Uni/a', {});
    await d.agenten.leerlauf();
    expect(d.agenten.chatDetail(c.chatId).laeufe[0]!.fehler).toMatch(/max_tokens/);
  });

  it('unterbrochene Werkzeugaufrufe werden beim Fortsetzen mit Fehler-Ergebnis nachgetragen', async () => {
    const d = await dorfMit([
      { content: [{ type: 'tool_use', id: 'tX', name: 'vault_lesen', input: { pfad: 'Start.md' }, caller: { type: 'direct' } }] as BetaMessage['content'], stop_reason: 'tool_use' },
      new Error('Netzwerk weg'),
      { content: [text('weiter')], stop_reason: 'end_turn' },
    ]);
    // Simuliert: Lauf 1 endet nach der Antwort, bevor die Werkzeugergebnisse gespeichert werden
    const { chatId } = await d.agenten.aktionStarten('Uni/a', {});
    await d.agenten.leerlauf();
    expect(d.agenten.chatDetail(chatId).laeufe[0]!.status).toBe('fehler');
    d.db.prepare("DELETE FROM nachrichten WHERE chat_id = ? AND rolle = 'werkzeug'").run(chatId);
    d.agenten.nachrichtSenden(chatId, 'nochmal');
    await d.agenten.leerlauf();
    const letzte = d.anfragen.at(-1)!.messages as { role: string; content: { type: string; tool_use_id?: string; is_error?: boolean }[] }[];
    expect(letzte.at(-1)!.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tX', is_error: true });
  });
});

describe('api-Motor: Bilder in Werkzeug-Ergebnissen', () => {
  it('gerenderte PDF-Seite geht als image-Block im tool_result an das Modell', async () => {
    const d = await dorfMit(
      [
        {
          content: [{ type: 'tool_use', id: 't1', name: 'rechenraum_seite_ansehen', input: { pdf: 'a.pdf', seite: 2 }, caller: { type: 'direct' } }] as BetaMessage['content'],
          stop_reason: 'tool_use',
        },
        { content: [text('Sieht gut aus.')], stop_reason: 'end_turn' },
      ],
      'motor: api\nfremdinhalte: ja\nwerkzeuge: [vault_lesen, rechenraum]',
    );
    const png = Buffer.from('\x89PNG-attrappe');
    d.agenten.rechenraum = {
      befehl: async () => ({ code: 0, abgelaufen: false, sekunden: 0, ausgabe: '' }),
      schreiben: async () => undefined,
      lesen: async () => Buffer.from(''),
      dateien: async () => [],
      seite: async (_raum, pdf, seite) => {
        expect([pdf, seite]).toEqual(['a.pdf', 2]);
        return { png, seiten: 3 };
      },
      aufraeumen: async () => undefined,
    };
    const { chatId } = await d.agenten.aktionStarten('Uni/a', {});
    await d.agenten.leerlauf();
    expect(d.agenten.chatDetail(chatId).laeufe[0]!.status).toBe('fertig');
    const tools = (d.anfragen[0]!.tools as { name: string }[]).map((t) => t.name);
    expect(tools).toContain('rechenraum_ablegen');
    expect(tools).not.toContain('vault_schreiben');
    const ergebnis = (d.anfragen[1]!.messages as { content: unknown[] }[]).at(-1)!.content[0] as { type: string; content: unknown[] };
    expect(ergebnis.type).toBe('tool_result');
    expect(ergebnis.content).toEqual([
      { type: 'text', text: 'a.pdf, Seite 2 von 3:' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } },
    ]);
  });
});
