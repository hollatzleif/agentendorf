import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claudeCodeMotor, CcParser, fehlerErklaeren } from '../src/agenten/motor-claude-code.js';
import { attrappe } from '../src/agenten/motor-attrappe.js';
import { testDorf, tempOrdner } from './hilfen.js';
import { werkzeugprofil } from '../src/agenten/leine.js';

const WERKSTATT = path.resolve(import.meta.dirname, '../../werkstatt');
const GEHEIMNIS = 'test-geheimnis-test-geheimnis-test-geheimnis';
const PORT = 4600 + Math.floor(Math.random() * 300);

let runner: ChildProcess | undefined;
let d: Awaited<ReturnType<typeof testDorf>>;

beforeAll(async () => {
  d = await testDorf({
    motoren: (register) => ({
      api: attrappe('api'),
      'claude-code': claudeCodeMotor({ url: `http://127.0.0.1:${PORT}`, geheimnis: GEHEIMNIS, register }),
    }),
  });
  await d.intern.listen({ port: 0, host: '127.0.0.1' });
  const internPort = (d.intern.server.address() as { port: number }).port;
  runner = spawn('node', [path.join(WERKSTATT, 'dist/runner.js')], {
    env: {
      PATH: process.env.PATH,
      PORT: String(PORT),
      WERKSTATT_GEHEIMNIS: GEHEIMNIS,
      CLAUDE_BIN: path.join(WERKSTATT, 'test/fake-claude.mjs'),
      MCP_BEFEHL: `node ${path.join(WERKSTATT, 'dist/mcp.js')}`,
      DORF_INTERN_URL: `http://127.0.0.1:${internPort}`,
      ARBEIT_DIR: tempOrdner('arbeit-'),
      ANTHROPIC_API_KEY: 'darf-nicht-durchsickern',
      CLAUDE_CODE_OAUTH_TOKEN: 'abo-token',
    },
    stdio: 'inherit',
  });
  for (let i = 0; i < 50; i++) {
    if (await fetch(`http://127.0.0.1:${PORT}/gesundheit`).then((r) => r.ok).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Runner startet nicht');
}, 20_000);

afterAll(() => runner?.kill());

function bericht(text: string) {
  return JSON.parse(/BERICHT:(.*)\n/.exec(text)![1]!) as {
    werkzeuge: string[];
    r1: string;
    r1Fehler: boolean;
    r2: string;
    r2Fehler: boolean;
    r3?: string[];
    args: string[];
    prompt: string;
  };
}

describe('claude-code-Motor über die Werkstatt', () => {
  it('Bilder aus Werkzeug-Ergebnissen (Rechenraum-Seite) kommen über MCP als Bild bei claude an', async () => {
    fs.writeFileSync(path.join(d.vault.wurzel, 'Uni/aktionen/cc-bild.md'), '---\nname: CC Bild\nmotor: claude-code\nwerkzeuge: [vault_lesen, rechenraum]\n---\n[seite]');
    const vorher = d.agenten.rechenraum;
    d.agenten.rechenraum = {
      befehl: async () => ({ code: 0, abgelaufen: false, sekunden: 0, ausgabe: '' }),
      schreiben: async () => undefined,
      lesen: async () => Buffer.from(''),
      dateien: async () => [],
      seite: async () => ({ png: Buffer.from('PNG!'), seiten: 1 }),
      aufraeumen: async () => undefined,
    };
    try {
      const { chatId } = await d.agenten.aktionStarten('Uni/cc-bild', {});
      await d.agenten.leerlauf(20_000);
      const b = bericht(d.agenten.chatDetail(chatId).nachrichten.at(-1)!.text);
      expect(b.werkzeuge).toEqual(expect.arrayContaining(['rechenraum_befehl', 'rechenraum_seite_ansehen', 'rechenraum_ablegen']));
      expect(b.werkzeuge).not.toContain('vault_schreiben');
      expect(b.r3).toEqual(['text:a.pdf, Seite 1 von 1:', `image:image/png:${Buffer.from('PNG!').toString('base64')}`]);
    } finally {
      d.agenten.rechenraum = vorher;
    }
  }, 30_000);

  it('ganzer Weg: Runner → claude → MCP → Leine im Dorf → Protokoll; sichere Argumente', async () => {
    fs.writeFileSync(path.join(d.vault.wurzel, 'Uni/aktionen/cc.md'), '---\nname: CC\nmotor: claude-code\nstufe: gross\n---\nMach was.');
    const { chatId } = await d.agenten.aktionStarten('Uni/cc', {});
    await d.agenten.leerlauf(20_000);
    const c = d.agenten.chatDetail(chatId);
    expect(c.laeufe[0]).toMatchObject({ status: 'fertig', motor: 'claude-code', modell: 'claude-fable-5-2', einToken: 500, ausToken: 60 });
    const b = bericht(c.nachrichten.at(-1)!.text);
    expect(b.werkzeuge.sort()).toEqual([...werkzeugprofil({ werkzeuge: ['vault_lesen', 'vault_suchen', 'vault_schreiben'], fremdinhalte: false }).dorf].sort());
    expect(b.r1Fehler).toBe(false);
    expect(b.r2Fehler).toBe(true);
    expect(b.r2).toMatch(/Verweigert/);
    expect(await d.vault.existiert('Uni/2026-11-16_1200_aus-der-werkstatt.md')).toBe(true);
    expect(await d.vault.existiert('Post/2026-11-16_1200_fremd.md')).toBe(false);

    const a = b.args;
    const wert = (f: string) => a[a.indexOf(f) + 1];
    expect(a).not.toContain('--bare');
    expect(wert('--tools')).toBe('Read,Glob,Grep');
    expect(a).toContain('--strict-mcp-config');
    expect(Object.keys(JSON.parse(wert('--mcp-config')!).mcpServers)).toEqual(['dorf']);
    expect(wert('--permission-mode')).toBe('dontAsk');
    expect(wert('--setting-sources')).toBe('user');
    expect(wert('--model')).toBe('claude-fable-5-2');
    expect(wert('--effort')).toBe('high');
    expect(a).toContain('--session-id');
    expect(a.join(' ')).not.toMatch(/Bash|Edit|Write/);

    const p = (await d.vault.lesen(c.protokollPfad!)).inhalt;
    expect(p).toContain('[[Uni/2026-11-16_1200_aus-der-werkstatt]]');
    expect(p).toContain('[[Start]]'); // Read der Werkstatt wird als gelesen protokolliert
    expect(p).toMatch(/verweigert:\*\* vault_schreiben Post/);

    // Fortsetzen nutzt --resume mit derselben Sitzung
    const sitzung = wert('--session-id');
    d.agenten.nachrichtSenden(chatId, 'weiter');
    await d.agenten.leerlauf(20_000);
    const b2 = bericht(d.agenten.chatDetail(chatId).nachrichten.at(-1)!.text);
    expect(b2.args[b2.args.indexOf('--resume') + 1]).toBe(sitzung);
    expect(b2.prompt).toBe('weiter');
  }, 30_000);

  it('Abbrechen beendet den claude-Prozess; Fehler werden verständlich gemeldet', async () => {
    fs.writeFileSync(path.join(d.vault.wurzel, 'Uni/aktionen/cc2.md'), '---\nname: CC2\nmotor: claude-code\nwerkzeuge: [vault_lesen, web]\neingaben:\n  - name: x\n---\n{x}');
    const lang = await d.agenten.aktionStarten('Uni/cc2', { x: '[warte]' });
    await new Promise((r) => setTimeout(r, 800));
    d.agenten.abbrechen(lang.laufId);
    await d.agenten.leerlauf(20_000);
    expect(d.agenten.chatDetail(lang.chatId).laeufe[0]!.status).toBe('abgebrochen');

    const f = await d.agenten.aktionStarten('Uni/cc2', { x: '[fehler]' });
    await d.agenten.leerlauf(20_000);
    const l = d.agenten.chatDetail(f.chatId).laeufe[0]!;
    expect(l.status).toBe('fehler');
    // Web erlaubt → WebSearch/WebFetch, aber weiterhin kein Schreiben eingebaut
    const b = bericht(d.agenten.chatDetail(f.chatId).nachrichten.find((n) => n.rolle === 'agent')!.text);
    expect(d.agenten.chatDetail(f.chatId).nachrichten.at(-1)!.rolle).toBe('hinweis');
    expect(b.args[b.args.indexOf('--tools') + 1]).toBe('Read,Glob,Grep,WebSearch,WebFetch');
    expect(b.werkzeuge).not.toContain('vault_schreiben');
  }, 30_000);

  it('Runner verlangt das Geheimnis und prüft Aufträge', async () => {
    const ohne = await fetch(`http://127.0.0.1:${PORT}/laeufe`, { method: 'POST', body: '{}' });
    expect(ohne.status).toBe(401);
    const kaputt = await fetch(`http://127.0.0.1:${PORT}/laeufe`, {
      method: 'POST',
      headers: { 'x-werkstatt-geheimnis': GEHEIMNIS },
      body: JSON.stringify({ laufId: 'x; rm -rf /', modell: 'claude-x' }),
    });
    expect(kaputt.status).toBe(400);
    // Werkzeug-Token nach Laufende ungültig
    const r = await fetch(`http://127.0.0.1:${(d.intern.server.address() as { port: number }).port}/intern/werkzeuge`, { headers: { authorization: 'Bearer altes-token-altes-token' } });
    expect(r.status).toBe(401);
  });
});

describe('stream-json-Parser', () => {
  it('ignoriert Unteragenten-Text, meldet Live-Text und Verbrauch', () => {
    const live: string[] = [];
    const extern: string[] = [];
    const p = new CcParser({ extern: (n: string) => void extern.push(n) }, (t) => live.push(t));
    p.zeile({ type: 'system', subtype: 'init', session_id: 's1' });
    p.zeile({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'A' } } });
    p.zeile({ type: 'stream_event', parent_tool_use_id: 'sub', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'X' } } });
    p.zeile({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name: 'WebSearch', input: {} }] } });
    const e = p.zeile({ type: 'result', subtype: 'success', result: 'Fertig', usage: { input_tokens: 1, output_tokens: 2 } });
    expect(live).toEqual(['A']);
    expect(extern).toEqual(['WebSearch']);
    expect(e).toEqual([{ typ: 'verbrauch', ein: 1, aus: 2, cacheLesen: 0, cacheSchreiben: 0 }]);
    expect(p.sitzung).toBe('s1');
    expect(p.antwort()).toBe('Fertig');
    expect(fehlerErklaeren('Error: OAuth token has expired')).toMatch(/dorf claude-anmelden/);
  });

  it('Abbruch (error_during_execution): der Grund aus errors bleibt erhalten', () => {
    const p = new CcParser({ extern: () => undefined }, () => undefined);
    p.zeile({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['API Error: 400 prompt is too long'], usage: {} });
    expect(p.ergebnis).toMatchObject({ fehler: true, subtype: 'error_during_execution', gruende: ['API Error: 400 prompt is too long'] });
  });
});
