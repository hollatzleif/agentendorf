import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/**
 * MCP-Server "dorf" für einen claude-Lauf in der Werkstatt.
 * Er führt selbst nichts aus, sondern reicht jeden Aufruf an das Dorf weiter – dort sitzen Leine und Log.
 */
const url = process.env.DORF_INTERN_URL ?? 'http://dorf:3001';
const token = process.env.DORF_WERKZEUG_TOKEN ?? '';

async function dorf<T>(pfad: string, body?: unknown): Promise<T> {
  const r = await fetch(`${url}${pfad}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`Dorf antwortet ${r.status}: ${await r.text()}`);
  return (await r.json()) as T;
}

const server = new Server({ name: 'dorf', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const defs = await dorf<{ name: string; description: string; input_schema: Record<string, unknown> }[]>('/intern/werkzeuge');
  return { tools: defs.map((d) => ({ name: d.name, description: d.description, inputSchema: d.input_schema as { type: 'object' } })) };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    const r = await dorf<{ ok: boolean; text: string; bilder?: { mime: string; base64: string }[] }>('/intern/werkzeug', {
      name: req.params.name,
      eingabe: req.params.arguments ?? {},
    });
    // Bilder (z. B. gerenderte PDF-Seiten aus dem Rechenraum) gehen als Bild-Inhalt an claude
    const bilder = (r.bilder ?? []).map((b) => ({ type: 'image' as const, data: b.base64, mimeType: b.mime }));
    return { content: [{ type: 'text' as const, text: r.text }, ...bilder], isError: !r.ok };
  } catch (e) {
    return { content: [{ type: 'text', text: (e as Error).message }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
