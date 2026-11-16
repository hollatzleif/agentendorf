#!/usr/bin/env node
// Nachgebautes claude-CLI für Tests: spricht stream-json und ruft die Dorf-Werkzeuge wirklich über MCP auf.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const args = process.argv.slice(2);
const wert = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const sitzung = wert('--resume') ?? wert('--session-id');
const aus = (o) => process.stdout.write(JSON.stringify(o) + '\n');
let prompt = '';
for await (const t of process.stdin) prompt += t;

aus({ type: 'system', subtype: 'init', session_id: sitzung, model: wert('--model') });

if (prompt.includes('[warte]')) {
  process.on('SIGINT', () => process.exit(130));
  await new Promise((r) => setTimeout(r, 30_000));
}

const mcp = JSON.parse(wert('--mcp-config')).mcpServers.dorf;
const client = new Client({ name: 'fake-claude', version: '1' });
await client.connect(new StdioClientTransport({ command: mcp.command, args: mcp.args, env: { ...mcp.env, PATH: process.env.PATH } }));
const werkzeuge = (await client.listTools()).tools.map((t) => t.name);
const r1 = await client.callTool({ name: 'vault_schreiben', arguments: { pfad: 'Uni/2026-11-16_1200_aus-der-werkstatt.md', inhalt: '# Werkstatt' } });
const r2 = await client.callTool({ name: 'vault_schreiben', arguments: { pfad: 'Post/2026-11-16_1200_fremd.md', inhalt: 'nein' } });
await client.close();

aus({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hallo ' } } });
aus({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/vault/Start.md' } }] } });
const bericht = { werkzeuge, r1: r1.content[0].text, r1Fehler: !!r1.isError, r2: r2.content[0].text, r2Fehler: !!r2.isError, args, prompt };
aus({
  type: 'result',
  subtype: prompt.includes('[fehler]') ? 'error_during_execution' : 'success',
  is_error: prompt.includes('[fehler]'),
  session_id: sitzung,
  result: `BERICHT:${JSON.stringify(bericht)}\n\n## Zusammenfassung\n### Offen\nNichts.`,
  usage: { input_tokens: 500, output_tokens: 60, cache_read_input_tokens: 300, cache_creation_input_tokens: 20 },
  total_cost_usd: 0.01,
});
